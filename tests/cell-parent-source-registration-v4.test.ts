import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { AwsSdkCellParentSourceRegistrarV4, decodeCellParentSourceRegistrationReviewV4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4 as attemptKey,
  CELL_PARENT_REGISTRATION_EXCLUSIONS_V4 } from "../lib/deployments/execution/cell-parent-source-registrar-v4.ts";
import { prepareCellParentBootstrapReviewV4, decodeCellParentBootstrapReviewV4, cellParentBootstrapRequestsV4, runCellParentBootstrapV4, CELL_PARENT_INSTALLATION_ORDER_V4,
  CELL_PARENT_BOOTSTRAP_V4 as targets } from "../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { AwsSdkCellParentInstallationReaderV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { NeonCellParentDatabaseV4 } from "../lib/deployments/execution/neon-cell-parent-control-v4.ts";
import { CELL_PARENT_KEY_V4 as key, decodeCellBirthParentRecordV4 } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { cellParentFixtureV4 } from "./fixtures/cell-parent-v4.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { registeredSealedCertificateV1 } from "./fixtures/registered-sealed-certificate-v1.ts";
import { v3Now } from "./fixtures/cell-stack-v3.ts";

const signal = () => new AbortController().signal, code = "5".repeat(64);
async function fixture() {
  const c = await cellParentFixtureV4(); c.useSource(); c.items.delete(key); c.setTime(v3Now + 2000);
  const old = await sealedEvidenceFixture(registeredSealedCertificateV1), rows = structuredClone(old.results); let at = c.now(), claimed = false, localClaims = 0, sqlWrites = 0;
  const env = rows[1].rows[0]; Object.assign(env, { admission_state: "open", admission_epoch: 0, admission_fence_sha256: null,
    admission_provision_operation_hash: null, admission_stack_id: null, admission_cell_expires_at: null, admission_changed_at: null });
  rows.push({ rows: [] }, { rows: [{ identity_sha256: "a".repeat(64) }] }, { rows: [{ protection_sha256: "e".repeat(64) }] }, { rows: [] }, { rows: [] });
  const db = new NeonCellParentDatabaseV4({ async transaction() { env.observed_at = at; return structuredClone(rows); } },
    { async query() { sqlWrites++; throw Error("Source may not write SQL"); } }, old.cert, "e".repeat(64));
  const client = c.registrySdk.sts, installation = new AwsSdkCellParentInstallationReaderV4({ sts: client, ddb: client, iam: client, lambda: client, commands: c.registrySdk.commands as never }, "source_inspection", () => at);
  const attempt = { async claimOnce() { localClaims++; if (claimed) return false; claimed = true; return true; } };
  const registrar = new AwsSdkCellParentSourceRegistrarV4({ sdk: c.registrySdk, installation, stack: c.source.reader, database: db, attempt, now: () => at });
  const input = { plan: c.source.plan, delegation: c.delegation, binding: c.binding, failedProtectionSha256: "e".repeat(64), codeBindingSha256: code, signal: signal() };
  const review = await registrar.review(input);
  return { ...c, registrar, review, rows, input, db, installation, attempt, now: () => at, localClaims: () => localClaims, sqlWrites: () => sqlWrites,
    setTime: (n: number) => { at = n; c.setTime(n); c.source.setTime(n); }, useOccupiedLocalSlot: () => { claimed = true; },
    run: () => registrar.installOnce({ review: structuredClone(review), approvedManifestSha256: review.manifestSha256, currentCodeBindingSha256: code, signal: signal() }) };
}

test("Source cold approval crosses process boundary only after full live proofs, commits exactly two transactions without DB writes", async () => {
  const c = await fixture(), cold = await decodeCellParentSourceRegistrationReviewV4(JSON.parse(JSON.stringify(c.review)));
  assert.equal(cold.manifestSha256, c.review.manifestSha256); assert.equal((await c.run()).outcome, "PARENT_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT");
  assert.equal(c.writes.length, 2); assert.equal(c.sqlWrites(), 0); assert.equal(c.localClaims(), 1); assert.ok(c.items.has(attemptKey));
  const record = await decodeCellBirthParentRecordV4(JSON.parse(String(c.items.get(key)!.record_json))); assert.equal(record.manifest.scope.publishActivation, false);
  assert.equal(record.approvedManifestSha256, c.review.parentReview.manifestSha256); await assert.rejects(c.run); assert.equal(c.writes.length, 2);
  assert.equal(new Set(c.writes.map(w => w.ClientRequestToken)).size, 2);
});
test("old parent/drain review, altered hashes/scope/risk or wrong approval never consume a local/cloud slot", async () => {
  const c = await fixture(); await assert.rejects(() => decodeCellParentSourceRegistrationReviewV4(c.review.parentReview));
  for (const change of ["scope", "certificateSha256", "manifestSha256", "codeBindingSha256"]) {
    const v = structuredClone(c.review) as unknown as Record<string, unknown>; v[change] = change === "scope" ? { sourceTransactionsMaximum: 99 } : "f".repeat(64);
    await assert.rejects(() => decodeCellParentSourceRegistrationReviewV4(v));
  }
  await assert.rejects(() => c.registrar.installOnce({ review: c.review, approvedManifestSha256: "0".repeat(64), currentCodeBindingSha256: code, signal: signal() }));
  await assert.rejects(() => c.registrar.installOnce({ review: c.review, approvedManifestSha256: c.review.manifestSha256, currentCodeBindingSha256: "0".repeat(64), signal: signal() }));
  assert.equal(c.localClaims(), 0); assert.equal(c.writes.length, 0);
});
test("expired review, metadata drift, non-RESERVED and pending jobs are all pre-attempt blockers", async () => {
  for (const kind of ["expired", "function", "stack", "job", "identity"]) { const c = await fixture();
    if (kind === "expired") c.setTime(c.review.expiresAt);
    if (kind === "function") (c.data.functionConfig as Record<string, unknown>).RevisionId = "changed";
    if (kind === "stack") c.source.stack.StackStatus = "UPDATE_FAILED";
    if (kind === "job") c.rows[12].rows = [{ id: "job_pending" }];
    if (kind === "identity") { const other = await cellParentFixtureV4(); await assert.rejects(() => new AwsSdkCellParentSourceRegistrarV4({ sdk: other.registrySdk, installation: c.installation,
      stack: c.source.reader, database: c.db, attempt: c.attempt, now: c.now }).installOnce({ review: c.review, approvedManifestSha256: c.review.manifestSha256, currentCodeBindingSha256: code, signal: signal() })); }
    else await assert.rejects(c.run);
    assert.equal(c.localClaims(), 0); assert.equal(c.writes.length, 0);
  }
});
test("every historical and new exclusion, including an existing attempt, blocks registration without modifying originals", async () => {
  for (const k of [...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, attemptKey]) { const c = await fixture(), item = { authority_key: k, historical: true };
    c.items.set(k, item); await assert.rejects(c.run); assert.equal(c.localClaims(), 0); assert.equal(c.writes.length, 0); assert.deepEqual(c.items.get(k), item);
  }
});
test("lost attempt response cannot manufacture ownership from later readback or retry SQL/parent writes", async () => {
  const c = await fixture(); c.loseWrite(); assert.equal((await c.run()).outcome, "REGISTRATION_ATTEMPT_UNCERTAIN_INSPECT_ONLY");
  assert.equal(c.items.has(attemptKey), true); assert.equal(c.items.has(key), false); await assert.rejects(c.run); assert.equal(c.writes.length, 1); assert.equal(c.sqlWrites(), 0);
});
test("durable local slot prevents a new process retry even if the cloud claim was not committed", async () => {
  const c = await fixture(); c.useOccupiedLocalSlot(); assert.equal((await c.run()).outcome, "LOCAL_REGISTRATION_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(c.writes.length, 0);
});
test("concurrent Source contenders yield one parent owner and preserve distinct transaction tokens", async () => {
  const c = await fixture(), r = await Promise.allSettled([c.run(), c.run()]);
  assert.equal(r.filter(v => v.status === "fulfilled" && v.value.outcome === "PARENT_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT").length, 1);
  assert.equal(c.writes.length, 2); assert.equal(c.sqlWrites(), 0);
});
test("DB/CFN drift after durable claim consumes ownership but blocks parent publication without compensation", async () => {
  const c = await fixture(), dbRead = c.db.readOpen.bind(c.db); let reads = 0;
  c.db.readOpen = async (...args) => { if (++reads > 1) c.rows[13].rows = [{ id: "step_active" }]; return dbRead(...args); };
  const registrar = new AwsSdkCellParentSourceRegistrarV4({ sdk: c.registrySdk, installation: c.installation, stack: c.source.reader, database: c.db, attempt: c.attempt, now: c.now });
  await assert.rejects(() => registrar.installOnce({ review: c.review, approvedManifestSha256: c.review.manifestSha256, currentCodeBindingSha256: code, signal: signal() }));
  assert.ok(c.items.has(attemptKey)); assert.equal(c.items.has(key), false); assert.equal(c.writes.length, 1);
});
test("locked bootstrap exact cold scope binds six writes and never grants runtime/full parent/paid permissions", async () => {
  const now = v3Now, inventory = { observedAt: now, boundaryAbsent: true, roleAbsent: true, functionAbsent: true, logGroupAbsent: true, parentAndAllWorkflowAndRegistrationSlotsAbsent: true, cellStackNameAbsent: true, sourceIdentityVerified: true },
    review = await prepareCellParentBootstrapReviewV4(inventory, code, now), cold = await decodeCellParentBootstrapReviewV4(JSON.parse(JSON.stringify(review))), requests = cellParentBootstrapRequestsV4(review.manifestSha256);
  assert.equal(cold.manifestSha256, review.manifestSha256); assert.equal(requests.length, 6); assert.equal(requests[5].input.ReservedConcurrentExecutions, 0);
  assert.equal(requests[0].input.PolicyName, targets.boundaryName); assert.match(String(requests[0].input.PolicyDocument), /"Deny"/);
  assert.doesNotMatch(canonicalJson(requests), /PutItem|DeleteStack|InvokeFunction|CreateSchedule|PutResourcePolicy|GetSecretValue/);
  for (const k of Object.keys(inventory).filter(k => k !== "observedAt")) await assert.rejects(() => prepareCellParentBootstrapReviewV4({ ...inventory, [k]: false }, code, now));
  const altered = structuredClone(review); (altered.scope as { reservedConcurrency: number }).reservedConcurrency = 1;
  await assert.rejects(() => decodeCellParentBootstrapReviewV4(altered));
  assert.equal(CELL_PARENT_INSTALLATION_ORDER_V4[0].phase, "LOCKED_CONTROL_BOOTSTRAP"); assert.equal(CELL_PARENT_INSTALLATION_ORDER_V4.at(-1)?.phase, "ARMED_THEN_PAID");
});
test("CLI keeps read-only modes disjoint, fixed artifact/file slots and exact original schema candidate history", async () => {
  const script = await readFile(new URL("../ops/aws-sandbox/scripts/review-cell-parent-bootstrap-v4.mjs", import.meta.url), "utf8"),
    slot = await readFile(new URL("../lib/deployments/execution/cell-parent-private-attempt-v4.ts", import.meta.url), "utf8"),
    old = await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-fence.sql", import.meta.url), "utf8"),
    next = await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql", import.meta.url), "utf8");
  assert.match(script, /mode !== "Run"/); assert.match(script, /options\["--approved-sha"\] !== review.manifestSha256/); assert.match(slot, /flag: "wx", flush: true/);
  assert.doesNotMatch(script, /InvokeCommand|InvokeFunctionCommand|PutResourcePolicyCommand|PutRolePolicyCommand|GetSecretValueCommand/);
  assert.equal(next.replace("-- F3c9c UNINSTALLED replacement candidate;", "-- UNINSTALLED candidate;").replace("j.status IN ('pending','running','retry_wait')", "j.status IN ('queued','running')").trim(), old.trim());
  assert.notEqual(await sha256Hex(next), await sha256Hex(old));
});
test("the actual CLI's six-action runner stops at every ambiguous write without retry, rollback, or downstream permission enablement", async () => {
  const at = v3Now, inventory = { observedAt: at, boundaryAbsent: true, roleAbsent: true, functionAbsent: true, logGroupAbsent: true, parentAndAllWorkflowAndRegistrationSlotsAbsent: true, cellStackNameAbsent: true, sourceIdentityVerified: true },
    review = await prepareCellParentBootstrapReviewV4(inventory, code, at);
  for (const failed of [-1, 0, 1, 2, 3, 4, 5]) {
    const calls: string[] = []; let slot = false, inspected = false;
    const r = await runCellParentBootstrapV4(review, review.manifestSha256, code, {
      readFreshInventory: async () => inventory, verifySourceAndBytes: async () => {}, claimPermanentLocal: async () => { slot = true; return true; },
      beforeWrite: async () => {}, write: async (i, request) => { calls.push(request.action); if (i === failed) throw Error("private provider diagnostics"); },
      inspectLocked: async () => { inspected = true; return true; },
    }, () => at);
    assert.equal(slot, true); assert.equal(calls.length, failed < 0 ? 6 : failed + 1); assert.equal(inspected, failed < 0);
    assert.equal(r.retryAuthorized, false); assert.equal(r.runtimeEnabled, false); assert.doesNotMatch(canonicalJson(r), /private|diagnostics/);
  }
});
test("bootstrap runner rejects expired/changed code or occupied slots before writes, and fail-closed metadata drift after claim", async () => {
  const at = v3Now, inventory = { observedAt: at, boundaryAbsent: true, roleAbsent: true, functionAbsent: true, logGroupAbsent: true, parentAndAllWorkflowAndRegistrationSlotsAbsent: true, cellStackNameAbsent: true, sourceIdentityVerified: true },
    review = await prepareCellParentBootstrapReviewV4(inventory, code, at); let writes = 0, claims = 0;
  const port = { readFreshInventory: async () => inventory, verifySourceAndBytes: async () => {}, claimPermanentLocal: async () => { claims++; return false; },
    beforeWrite: async () => {}, write: async () => { writes++; }, inspectLocked: async () => true };
  await assert.rejects(() => runCellParentBootstrapV4(review, "0".repeat(64), code, port, () => at));
  await assert.rejects(() => runCellParentBootstrapV4(review, review.manifestSha256, "0".repeat(64), port, () => at));
  await assert.rejects(() => runCellParentBootstrapV4(review, review.manifestSha256, code, port, () => review.expiresAt));
  assert.equal(claims, 0); assert.equal((await runCellParentBootstrapV4(review, review.manifestSha256, code, port, () => at)).outcome, "BOOTSTRAP_LOCAL_SLOT_OCCUPIED_NO_RETRY");
  await assert.rejects(() => runCellParentBootstrapV4(review, review.manifestSha256, code, { ...port, claimPermanentLocal: async () => true, beforeWrite: async () => { throw Error("Deny-all drift"); } }, () => at));
  assert.equal(writes, 0);
});
