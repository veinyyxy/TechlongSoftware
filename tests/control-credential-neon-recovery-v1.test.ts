import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { credentialFixture, fixtureNow, roleSql } from "./helpers/control-credential-fixture.ts";
import { createControlCredentialMaterialsV1 } from "../lib/deployments/execution/control-credential-material-v1.ts";
import { controlCredentialTagsV1 } from "../lib/deployments/execution/control-credential-bootstrap-v1.ts";
import { compileNeonCredentialRecoveryV1, runNeonCredentialRecoveryV1, safeNeonCredentialFailureV1,
  type NeonCredentialRecoveryPortsV1 } from "../lib/deployments/execution/control-credential-neon-recovery-v1.ts";

async function recoveryFixture() {
  const f = await credentialFixture(), material = await createControlCredentialMaterialsV1(f.endpoint, f.cert, f.binding.certificateSha256);
  let occupied = false;
  const provider = { forwardDdl: "on" as const, passwordEncryption: "scram-sha-256" as const, postgresVersion: 180006 as const, observedAt: fixtureNow };
  const secrets = { observedAt: fixtureNow, secrets: material.map((v, i) => ({
    name: v.name, arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${v.name}-Ab1Cd2`, versionId: f.manifest.secretVersionIds[i],
    stages: ["AWSCURRENT"], tags: controlCredentialTagsV1(f.manifest), onlyInitialVersion: true, rotationDisabled: true,
    noReplicaOrResourcePolicy: true, secretString: v.secretString,
  })) };
  const validation = { binding: { ...f.binding, codeSha256: "e".repeat(64) }, bootstrapBinding: f.binding,
    endpoint: f.endpoint, roleSql, priorSubmissionFileSha256: "f".repeat(64) };
  const manifest = await compileNeonCredentialRecoveryV1({ ...validation, bootstrap: f.manifest, provider, secrets,
    read: await f.ports.readDb(), startedAt: fixtureNow, now: fixtureNow });
  f.calls.length = 0;
  const ports: NeonCredentialRecoveryPortsV1 = { now: () => fixtureNow, readDb: f.ports.readDb,
    readProvider: async () => provider, readExistingSecrets: async () => secrets, openDb: async () => f.client,
    verifyProviderInTransaction: async () => provider, claimSlot: async () => {
      if (occupied) throw new Error("already occupied"); occupied = true; f.counts.claims++;
    }, saveMarker: f.ports.saveMarker };
  return { ...f, validation, provider, secrets, material, ports,
    input: { ...validation, manifest, approvedSha: manifest.manifestSha256, ports } };
}
test("recovery review binds existing versions and explicit plaintext risk without secret writes or local material", async () => {
  const f = await recoveryFixture(), m = f.input.manifest;
  assert.equal(m.scope.createSecretCallsMaximum, 0); assert.equal(m.scope.secretVersionWritesMaximum, 0);
  assert.match(m.scope.sqlPasswordForm, /plaintext.*verified TLS.*logging exposure/);
  assert.equal(m.scope.runtimeEnabled, false); assert.equal(f.counts.claims, 0);
  for (const s of f.secrets.secrets) assert(!JSON.stringify(m).includes(new URL(JSON.parse(s.secretString).databaseUrl).password));
});
test("wrong/expired SHA, scope or code drift refuses before reads, slot or ALTER", async () => {
  for (const change of ["sha", "expiry", "scope", "code"] as const) {
    const f = await recoveryFixture(), input = f.input;
    if (change === "sha") input.approvedSha = f.manifest.manifestSha256;
    if (change === "expiry") input.ports = { ...input.ports, now: () => input.manifest.expiresAt };
    if (change === "scope") input.manifest = { ...input.manifest, scope: { ...input.manifest.scope, createSecretCallsMaximum: 1 } } as unknown as typeof input.manifest;
    if (change === "code") input.binding = { ...input.binding, codeSha256: "0".repeat(64) };
    await assert.rejects(runNeonCredentialRecoveryV1(input));
    assert.equal(f.counts.claims, 0); assert.deepEqual(f.calls, []);
  }
});
test("LOGIN/privilege/provider/version/ARN drift or a used recovery slot fails closed without password writes", async () => {
  for (const drift of ["login", "privilege", "provider", "version", "arn", "slot"] as const) {
    const f = await recoveryFixture();
    if (drift === "login") f.roles[0].rolcanlogin = true;
    if (drift === "privilege") f.roles[0].rolcreatedb = true;
    if (drift === "provider") f.provider.forwardDdl = "off" as "on";
    if (drift === "version") f.secrets.secrets[0].versionId = "00000000-0000-4000-8000-000000000000";
    if (drift === "arn") f.secrets.secrets[0].arn = f.secrets.secrets[0].arn.replace("Ab1Cd2", "Ef3Gh4");
    if (drift === "slot") await f.ports.claimSlot();
    const result = await runNeonCredentialRecoveryV1(f.input);
    assert.equal(result.slotConsumed, false); assert.equal(result.alterAttempts, 0); assert.equal(result.secretWrites, 0);
    assert(!f.calls.some(s => s.startsWith("ALTER ROLE ")));
  }
});
test("exact stored passwords are reused in two ALTERs, one commit; no secret/URL/SQL in receipts or markers", async () => {
  const f = await recoveryFixture(), result = await runNeonCredentialRecoveryV1(f.input);
  assert.equal(result.commitConfirmed, true); assert.equal(result.alterAttempts, 2); assert.equal(result.secretWrites, 0);
  const alters = f.calls.filter(s => s.startsWith("ALTER ROLE ")); assert.equal(alters.length, 2);
  for (let i = 0; i < 2; i++) {
    const pw = new URL(JSON.parse(f.secrets.secrets[i].secretString).databaseUrl).password;
    assert.equal(alters[i], `ALTER ROLE ${f.material[i].role} WITH LOGIN PASSWORD '${pw}'`);
    assert(!JSON.stringify(result).includes(pw)); assert(!JSON.stringify(f.markers).includes(pw));
  }
  assert.equal(f.calls.filter(s => s === "COMMIT").length, 1); assert(!f.calls.some(s => /forward_ddl|log_statement/.test(s)));
  assert.equal(f.counts.creates, 0);
});
test("second ALTER failure rolls back locally and never retries; COMMIT loss does not submit compensation", async () => {
  for (const commit of [false, true]) {
    const f = await recoveryFixture(); let alters = 0;
    const db = { async query(sql: string) {
      if (sql.startsWith("ALTER ROLE ") && ++alters === 2 && !commit) throw Object.assign(new Error("private password/SQL detail"), { code: "42501" });
      const r = await f.client.query(sql);
      if (sql === "COMMIT" && commit) throw Object.assign(new Error("Received HTTP code 422 from control plane: private password"), { code: "XX000" });
      return r;
    }, end: f.client.end };
    const result = await runNeonCredentialRecoveryV1({ ...f.input, ports: { ...f.ports, openDb: async () => db } });
    assert.equal(result.retryAuthorized, false); assert.equal(result.commitConfirmed, false); assert.equal(result.alterAttempts, 2);
    assert.equal(result.failure?.sqlstate, commit ? "XX000" : "42501");
    assert.equal(f.calls.includes("ROLLBACK"), !commit);
    assert.doesNotMatch(JSON.stringify(result), /private password|SQL detail/);
    if (commit) assert.equal(result.failure?.classification, "NEON_CONTROL_PLANE_HTTP_ERROR");
    else assert.deepEqual(f.roles.map(r => r.rolcanlogin), [false, false]);
  }
});
test("state age, consumed marker failure, and provider drift inside the transaction stop before ALTER", async () => {
  for (const fail of ["stale", "marker", "provider"] as const) {
    const f = await recoveryFixture();
    if (fail === "stale") f.secrets.observedAt -= 30_001;
    if (fail === "marker") f.ports.saveMarker = async () => { throw new Error("private-data"); };
    if (fail === "provider") f.ports.verifyProviderInTransaction = async () => ({ ...f.provider, forwardDdl: "off" as "on" });
    const result = await runNeonCredentialRecoveryV1(f.input);
    assert.equal(result.alterAttempts, 0); assert.equal(result.slotConsumed, fail !== "stale");
    assert.doesNotMatch(JSON.stringify(result), /private-data/);
  }
});
test("SQLSTATE and a bounded HTTP status are the only provider diagnostics retained", () => {
  const detail = Object.assign(new Error("Received HTTP code 500 from control plane: postgresql://secret:password; SCRAM-SHA-256$"),
    { code: "XX000", detail: "secret", query: "ALTER ROLE ...", stack: "secret" });
  const safe = safeNeonCredentialFailureV1(detail);
  assert.deepEqual(safe, { sqlstate: "XX000", providerHttpStatus: 500, classification: "NEON_CONTROL_PLANE_HTTP_ERROR", rawDiagnosticsWithheld: true });
  assert.equal(safeNeonCredentialFailureV1({ code: "full-sensitive-password", message: "secret" }).sqlstate, null);
});
test("separate CLI pins real original receipt/ARNs and has no AWS/Neon mutator commands or hook bypass", () => {
  const cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-f3b3-neon-credential-recovery.mjs", import.meta.url), "utf8");
  assert.match(cli, /3096211ad3a9edc0621c0ef8f6abab677e2ebf5685f034ec8205cebdfe6fe0fb/);
  assert.match(cli, /cell-cleanup-readonly-v3-AWZoLG/); assert.match(cli, /cell-drain-control-QDFwQ9/);
  assert.match(cli, /SecretId:arn,VersionId:versionId,VersionStage:"AWSCURRENT"/);
  assert.match(cli, /ignoreConfiguredEndpointUrls:true,maxAttempts:1/); assert.match(cli, /rejectUnauthorized:true/);
  assert.match(cli, /IncludeDeprecated:true/); assert.match(cli, /INDEPENDENT_READONLY_INSPECT/);
  assert.doesNotMatch(cli, /CreateSecretCommand|PutSecretValueCommand|UpdateSecretCommand|DeleteSecretCommand|ResetPassword|SET.*forward_ddl/);
});
