import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenNeonActivationStatements, firstOpenNeonReserveStatements } from "../ops/aws-sandbox/first-open-neon-install.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import prepared from "../ops/aws-sandbox/first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

test("static Neon candidate reserves only the two missing first-open roles and remains locked", () => {
  const source = firstOpenNeonReserveStatements();
  const text = source.join("\n");
  assert.deepEqual(source.filter(s => s.startsWith("CREATE ROLE ")).map(s => s.split(" ")[2]),
    ["first_onboarding_fc41597f_middle_owner", "first_onboarding_fc41597f_middle"]);
  assert.ok(source.filter(s => s.startsWith("CREATE ROLE ")).every(s => s.includes(" NOLOGIN NOINHERIT ") && s.endsWith("PASSWORD NULL")));
  assert.doesNotMatch(text, /^(ALTER ROLE|GRANT |CREATE FUNCTION|COMMIT|UPDATE |DELETE |INSERT )/m);
  assert.match(text, /FOR UPDATE OF j/);
  assert.match(text, /j\.id='job_fc41597f9b5ba8e02b338ecf'/);
  assert.match(text, /j\.status='pending' AND j\.attempts=0 AND j\.max_attempts=1/);
  assert.match(text, /m\.admin_option AND NOT m\.inherit_option AND NOT m\.set_option/);
  assert.match(text, /NOINHERIT NOSUPERUSER NOCREATEDB/);
});

test("deferred Neon installation accepts only one sealed scope and returns an uncommitted private batch", async () => {
  const startAt = Date.UTC(2026, 10, 21, 19);
  const claimBefore = startAt + 300_000, writeBefore = startAt + 1_800_000;
  const release: FirstOpenFrozenRelease = {
    schema: "techlong/sandbox-first-open-release/v1", jobId: "job_fc41597f9b5ba8e02b338ecf", actorId: "14145707",
    approvalSha256: "a".repeat(64), callerCommit: "b".repeat(40), runtimeCommit: "c".repeat(40), runtimeSourceSha256: "d".repeat(64),
    inspectorSeedSha256: "e".repeat(64), runOnceReusableCommit: "f".repeat(40), inspectReusableCommit: "f".repeat(40),
    managementReusableCommit: "f".repeat(40), workflowId: "12345", nonce: "1".repeat(32),
    startAt, claimBefore, applicationLoginBefore: startAt + 1_200_000, writeBefore, completionReserveMs: 30_000,
    phaseCutoffs: [startAt + 30_000, startAt + 60_000, startAt + 90_000, startAt + 120_000, startAt + 150_000],
  };
  const window = { startAt, claimBefore, workloadExpiresAt: startAt + 7_200_000, factsExpireAt: writeBefore,
    cleanupReviewSha256: "6".repeat(64), cleanupPermissionsEvidenceSha256: "7".repeat(64) };
  const roles = Object.values(prepared.portBinding.neon.runtimeLogins);
  const verifiers = Object.fromEntries(roles.map((r, i) =>
    [r, `SCRAM-SHA-256$4096:${Buffer.alloc(16, i).toString("base64")}$${Buffer.alloc(32, i).toString("base64")}:${Buffer.alloc(32, i + 1).toString("base64")}`]));
  const input = { release, window, verifiers, protectedReleaseSha256: await sha256Hex(release),
    repositorySource: readFileSync(new URL("../lib/deployments/execution/neon-repository.ts", import.meta.url), "utf8") };
  const c = await firstOpenNeonActivationStatements(input);
  assert.equal(c.executionAuthorized, false);
  assert.equal(c.persistStatements, false);
  assert.equal(c.standaloneTransactions, 1);
  const text = c.statements.join("\n");
  assert.deepEqual(c.statements.filter(s => s.startsWith("ALTER ROLE ")).map(s => s.split(" ")[2]), roles);
  assert.equal((text.match(/^CREATE FUNCTION techlong_first_onboarding/gm) ?? []).length, 7);
  assert.equal((text.match(/GRANTED BY CURRENT_USER RESTRICT/g) ?? []).length, 3);
  assert.match(text, /VALID UNTIL '2026-11-21T19:30:00.000Z'/);
  assert.ok(c.statements.every(s => !/^(?:COMMIT|ROLLBACK)\b|^UPDATE public\./.test(s)));
  await assert.rejects(firstOpenNeonActivationStatements({ ...input, protectedReleaseSha256: "0".repeat(64) }), /RELEASE_BINDING/);
  await assert.rejects(firstOpenNeonActivationStatements({ ...input,
    verifiers: { ...verifiers, [roles[1]]: verifiers[roles[0]] } }), /SCRAM_VERIFIERS/);
  await assert.rejects(firstOpenNeonActivationStatements({ ...input,
    verifiers: { ...verifiers, unreviewed: verifiers[roles[0]] } }), /SCRAM_VERIFIERS/);
});
