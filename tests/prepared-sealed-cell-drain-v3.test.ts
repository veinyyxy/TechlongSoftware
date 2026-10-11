import assert from "node:assert/strict";
import test from "node:test";
import { createPreparedSealedCellDrainCoordinatorV3 } from "../lib/deployments/execution/prepared-sealed-cell-drain-coordinator-v3.ts";
import { sealedEvidenceFixture, now } from "./fixtures/sealed-cell-ownership-v3.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { compileSharedCellAdmissionDrainIntent } from "../lib/deployments/execution/shared-cell-admission-fence.ts";
import { handler as drainHandler } from "../ops/aws-sandbox/lambda/cell-drain-coordinator-v3.ts";
import { handler as ttlHandler } from "../ops/aws-sandbox/lambda/cell-ttl-executor-v3-fixed.ts";
async function fixture() {
  const f = await sealedEvidenceFixture(), predecessor = f.predecessor, compiled = await compileSharedCellAdmissionDrainIntent(predecessor), certificateSha256 = await sha256Hex(f.cert);
  const item = { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY, schema_version: 2 as const, revision: 1, record_json: canonicalJson(predecessor) }, counts = { drains: 0, jobs: 0, reads: 0 };
  const event = { schemaVersion: 3, action: "coordinate_reviewed_sealed_cell_ttl_cleanup_v3", expectedProvisionItemSha256: await sha256Hex(item), approvedDrainIntentSha256: compiled.fenceSha256, certificateSha256 };
  const receipt = { schemaVersion: 1 as const, admissionState: "draining" as const, accountId: "402010193138" as const, region: "ca-central-1" as const, cellId: "cell-sandbox-1" as const,
    environmentId: "env_aws_sandbox_ca_central_1" as const, admissionEpoch: 1, admissionFenceSha256: compiled.fenceSha256, admissionProvisionOperationHash: predecessor.provisionOperationHash,
    admissionStackId: predecessor.stackId, admissionCellExpiresAt: now - 60000, admissionChangedAt: now - 30000, dbObservedAt: now, databaseCellExpired: true as const };
  const capabilities: Parameters<typeof createPreparedSealedCellDrainCoordinatorV3>[0] = { authority: { async observe() { counts.reads++; return { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: structuredClone(item) }; } },
    admissions: { async beginAdmissionDrain() { counts.drains++; return receipt; } }, jobs: { async enqueueOwnedCleanupJobs() { counts.jobs++; return { schemaVersion: 1 as const, admissionFenceSha256: compiled.fenceSha256,
      insertedCount: 0, activeCount: 0, blockedCount: 0, targetCount: 0, dbObservedAt: now }; } }, source: f.source, certificateSha256, now: () => now };
  return { ...f, capabilities, event, counts, root: () => createPreparedSealedCellDrainCoordinatorV3(capabilities) };
}
const signal = () => new AbortController().signal;
test("v3 consumes live certified source before/after existing job producer; legacy raw 1/1 is preserved and classified", async () => {
  const f = await fixture(), r = await f.root().run(f.event, signal());
  assert.equal(r.outcome, "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW_V3"); assert.equal(r.ownershipCounts.activeTenantCount, 0); assert.equal(r.ownershipCounts.nonterminalDeploymentCount, 0);
  assert.equal(f.counts.drains, 1); assert.equal(f.counts.jobs, 1); assert.equal(f.reads(), 2); assert.equal(r.authorityWritePerformed, false); assert.equal(r.cellDeletionPerformed, false);
  assert.equal(r.runtimeActivationAuthorized, false); assert.match(r.rawOwnershipWitnessSha256, /^[a-f0-9]{64}$/);
});
test("uncertified JSON/old schema2 source cannot be used to generate jobs", async () => {
  const f = await fixture(), snap = await f.source.readCertifiedSerializableSnapshot({ accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", environmentId: "env_aws_sandbox_ca_central_1", signal: signal() });
  f.capabilities.source = { readCertifiedSerializableSnapshot: async () => structuredClone(snap) };
  await assert.rejects(f.root().run(f.event, signal()), /SEALED_DRAIN_SOURCE_UNVERIFIED/); assert.equal(f.counts.jobs, 0);
});
test("missing real provision record or not-due Cell rejects before admission/job writes", async () => {
  for (const missing of [true, false]) { const f = await fixture(); if (missing) f.capabilities.authority.observe = async () => ({ authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: null });
    else f.capabilities.now = () => now - 120000;
    await assert.rejects(f.root().run(f.event, signal())); assert.equal(f.counts.drains, 0); assert.equal(f.counts.jobs, 0); }
});
test("certificate mismatch or caller schema2/extra delete capability is refused", async () => {
  const f = await fixture(); for (const event of [{ ...f.event, schemaVersion: 1 }, { ...f.event, certificateSha256: "f".repeat(64) }, { ...f.event, enabled: true }]) await assert.rejects(f.root().run(event, signal()));
  assert.throws(() => createPreparedSealedCellDrainCoordinatorV3({ ...f.capabilities, deleter: {} } as typeof f.capabilities)); assert.equal(f.counts.drains, 0);
});
test("future unsealed association is not filtered by the historical certificate", async () => {
  const f = await fixture(); f.results[4].rows.push({ instance_id: f.cert.app_instance_id, deployment_id: "dep_future_terminal" });
  const r = await f.root().run(f.event, signal()); assert.equal(r.outcome, "TENANT_CLEANUP_PENDING"); assert.equal(r.ownershipCounts.activeTenantCount, 1); assert.equal(r.cellDeletionPerformed, false);
});
test("a protected old instance appearing as live resource stops before enqueue", async () => {
  const f = await fixture(); f.results[7].rows.push({ id: f.cert.app_instance_id }); await assert.rejects(f.root().run(f.event, signal()), /SEALED_DRAIN_PROTECTED_RESOURCE_REQUIRES_REVIEW/); assert.equal(f.counts.jobs, 0);
});
test("job write failure is surfaced, not retried or compensated", async () => {
  const f = await fixture(); f.capabilities.jobs.enqueueOwnedCleanupJobs = async () => { f.counts.jobs++; throw new Error("CELL_TTL_JOBS_WRITE_UNCERTAIN"); };
  await assert.rejects(f.root().run(f.event, signal()), /WRITE_UNCERTAIN/); assert.equal(f.counts.drains, 1); assert.equal(f.counts.jobs, 1);
});
test("candidate Lambda entry points reject before AWS credentials or database use", async () => {
  await assert.rejects(drainHandler({}, {}), /SEALED_DRAIN_EVENT_INVALID/); await assert.rejects(ttlHandler({}, {}), /SEALED_V3_EVENT_INVALID/);
});
