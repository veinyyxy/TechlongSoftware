import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { credentialFixture, fixtureNow, roleSql } from "./helpers/control-credential-fixture.ts";
import { createControlCredentialMaterialsV1, controlCredentialActivationSqlV1 } from "../lib/deployments/execution/control-credential-material-v1.ts";
import { runControlCredentialBootstrapV1, inspectControlCredentialBootstrapV1, assertControlCredentialSecretV1,
  validateControlCredentialManifestV1 } from "../lib/deployments/execution/control-credential-bootstrap-v1.ts";

test("Review binds installed NOLOGIN roles, absent names, version IDs, prices and exact no-retry scope without generating credentials", async () => {
  const f = await credentialFixture(); await validateControlCredentialManifestV1(f.manifest, f.binding, roleSql, f.endpoint);
  assert.equal(f.manifest.scope.createSecretCallsMaximum, 2); assert.equal(f.manifest.scope.runtimeEnabled, false);
  assert.equal(f.counts.creates, 0); assert.equal(f.counts.claims, 0); assert.equal(f.secrets.size, 0); assert.deepEqual(f.calls, []);
});
test("bad SHA, expiry, unknown manifest, changed code/endpoint/price prevent any write or credential slot", async () => {
  const f = await credentialFixture();
  for (const change of [{ approvedSha: "0".repeat(64) }, { ports: { ...f.ports, now: () => f.manifest.expiresAt } },
    { manifest: { ...f.manifest, extra: true } }, { binding: { ...f.binding, codeSha256: "0".repeat(64) } },
    { endpoint: { ...f.endpoint, host: "foreign.neon.tech" } }, { manifest: { ...f.manifest, price: { ...f.manifest.price, perSecretMonthUsd: 0 } } }])
    await assert.rejects(runControlCredentialBootstrapV1({ ...f.input, ...change }));
  assert.equal(f.counts.creates, 0); assert.equal(f.counts.claims, 0); assert.equal(f.calls.length, 0);
});
test("fresh role/permission drift stops before slot, while slot persistence failure never creates a Secret", async () => {
  const f = await credentialFixture(); f.roles[0].rolcanlogin = true;
  const drift = await runControlCredentialBootstrapV1(f.input); assert.equal(drift.slotConsumed, false); assert.equal(f.counts.creates, 0);
  f.roles[0].rolcanlogin = false;
  const persist = await runControlCredentialBootstrapV1({ ...f.input, ports: { ...f.ports, saveMarker: async () => { throw new Error("private-marker"); } } });
  assert.equal(persist.slotConsumed, true); assert.equal(f.counts.creates, 0); assert.doesNotMatch(JSON.stringify(persist), /private-marker/);
});
test("two exact initial Secret versions precede one atomic SCRAM login transaction; no plaintext in SQL, markers or receipts", async () => {
  const f = await credentialFixture(), result = await runControlCredentialBootstrapV1(f.input);
  assert.equal(result.commitConfirmed, true); assert.equal(f.counts.creates, 2); assert.equal(f.counts.claims, 1);
  assert.deepEqual(f.roles.map(r => r.rolcanlogin), [true, true]); assert.equal(f.calls.filter(s => s.startsWith("ALTER ROLE ")).length, 2);
  for (const value of f.secrets.values()) {
    const password = new URL(JSON.parse(value.secretString).databaseUrl).password;
    assert(!JSON.stringify(f.markers).includes(password)); assert(!JSON.stringify(result).includes(password));
    assert(f.calls.filter(s => s.startsWith("ALTER ROLE ")).every(s => !s.includes(password) && s.includes("SCRAM-SHA-256$4096:")));
  }
});
test("lost first or second CreateSecret response never reissues create and never activates login", async () => {
  for (const failAt of [1, 2]) {
    const f = await credentialFixture();
    const ports = { ...f.ports, createSecret: async (request: Parameters<typeof f.ports.createSecret>[0]) => {
      const result = await f.ports.createSecret(request); if (f.counts.creates === failAt) throw new Error("private-marker"); return result;
    } };
    const result = await runControlCredentialBootstrapV1({ ...f.input, ports });
    assert.equal(result.commitConfirmed, false); assert.equal(f.counts.creates, failAt); assert.deepEqual(f.roles.map(r => r.rolcanlogin), [false, false]);
    assert.equal(f.calls.some(s => s.startsWith("ALTER ROLE ")), false); assert.equal(result.retryAuthorized, false);
  }
});
test("wrong ARN/version/stage/tag/rotation/target/shape stops before login and copied material cannot emit SQL", async () => {
  const f = await credentialFixture(); await runControlCredentialBootstrapV1(f.input); const read = [...f.secrets.values()][0];
  for (const change of [{ arn: read.arn + "wrong" }, { versionId: "wrong" }, { stages: ["AWSPREVIOUS"] }, { tags: [] },
    { rotationDisabled: false }, { onlyInitialVersion: false }, { secretString: JSON.stringify({ databaseUrl: "postgresql://foreign" }) }])
    assert.throws(() => assertControlCredentialSecretV1({ ...read, ...change }, f.manifest, f.endpoint, 0));
  const materials = await createControlCredentialMaterialsV1(f.endpoint, f.cert, f.binding.certificateSha256);
  assert.throws(() => controlCredentialActivationSqlV1({ ...materials[0] })); assert.doesNotMatch(controlCredentialActivationSqlV1(materials[0]), /postgresql:\/\//);
});
test("second ALTER failure rolls both roles back, leaves two charged Secrets, and never compensates or retries writes", async () => {
  const f = await credentialFixture(); let alters = 0;
  const client = { async query(s: string) { if (s.startsWith("ALTER ROLE ") && ++alters === 2) throw new Error("private-marker"); return f.client.query(s); }, end: f.client.end };
  const result = await runControlCredentialBootstrapV1({ ...f.input, ports: { ...f.ports, openDb: async () => client } });
  assert.equal(result.commitConfirmed, false); assert.deepEqual(f.roles.map(r => r.rolcanlogin), [false, false]); assert.equal(f.secrets.size, 2);
  assert.equal(f.calls.at(-1), "ROLLBACK"); assert.equal(result.retryAuthorized, false); assert.doesNotMatch(JSON.stringify(result), /private-marker/);
});
test("lost COMMIT is recovered only by readonly authentication and complete state reread; old approval never writes again", async () => {
  const f = await credentialFixture(); let alters = 0;
  const client = { async query(s: string) { if (s.startsWith("ALTER ROLE ")) alters++; const r = await f.client.query(s);
    if (s === "COMMIT") throw new Error("private-marker"); return r; }, end: f.client.end };
  const result = await runControlCredentialBootstrapV1({ ...f.input, ports: { ...f.ports, openDb: async () => client } });
  assert.equal(result.outcome, "CREDENTIAL_COMMIT_UNKNOWN_INSPECT_ONLY");
  const inspected = await inspectControlCredentialBootstrapV1({ manifest: f.manifest, binding: f.binding, roleSql, endpoint: f.endpoint, now: () => fixtureNow,
    readDb: f.ports.readDb, readOwnSecret: async i => [...f.secrets.values()][i], authenticate: async () => undefined });
  assert.equal(inspected.credentialReady, true); assert.equal(inspected.runtimeEnabled, false);
  const retry = await runControlCredentialBootstrapV1(f.input); assert.equal(retry.slotConsumed, false); assert.equal(alters, 2); assert.equal(f.counts.creates, 2);
});
test("Inspector never repairs partial secrets/NOLOGIN or failed authentication and never exposes a password", async () => {
  const f = await credentialFixture();
  const inspect = () => inspectControlCredentialBootstrapV1({ manifest: f.manifest, binding: f.binding, roleSql, endpoint: f.endpoint, now: () => fixtureNow,
    readDb: f.ports.readDb, readOwnSecret: async i => [...f.secrets.values()][i] ?? null, authenticate: async () => { throw new Error("postgres://private-marker"); } });
  assert.equal((await inspect()).credentialReady, false); assert.equal(f.counts.creates, 0);
  await runControlCredentialBootstrapV1(f.input); const result = await inspect(); assert.equal(result.credentialReady, false);
  assert.doesNotMatch(JSON.stringify(result), /private-marker|databaseUrl|SCRAM-SHA-256/); assert.equal(f.counts.creates, 2);
});
test("CLI is source-profile pinned, TLS/maxAttempts1, no Delete/PutSecretValue/role permission changes or Review SecretString reads", () => {
  const cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-f3b3-control-credentials.mjs", import.meta.url), "utf8");
  assert.match(cli, /profile:"techlong-sandbox-user"/); assert.match(cli, /ignoreConfiguredEndpointUrls:true,maxAttempts:1/); assert.match(cli, /rejectUnauthorized:true/);
  assert.doesNotMatch(cli, /DeleteSecretCommand|PutSecretValueCommand|UpdateSecretCommand|CreateRoleCommand|DeleteStackCommand/);
  assert.match(cli, /IncludeDeprecated:true/); assert.match(cli, /d\.PrimaryRegion&&d\.PrimaryRegion!==\"ca-central-1\"/);
  assert.match(cli, /mode===\"Review\"/); assert.match(cli, /passwordsGenerated:false,secretValuesRead:false/);
});
