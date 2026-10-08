import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY, sharedCellAuthorityMarker, sharedCellProvisionOperationIntent, type SharedCellProvisionAuthorityRecord } from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { compileSharedCellAdmissionDrainIntent } from "../lib/deployments/execution/shared-cell-admission-fence.ts";
import { createPreparedCellDrainCoordinator } from "../lib/deployments/execution/prepared-cell-drain-coordinator.ts";
import { NeonSharedCellAdmissionFenceWriter, type NeonSharedCellAdmissionFenceSqlClient } from "../lib/deployments/execution/neon-shared-cell-admission-fence.ts";
import { NeonCellTtlCleanupJobProducer, CELL_TTL_CLEANUP_JOBS_SQL } from "../lib/deployments/execution/neon-cell-ttl-cleanup-jobs.ts";
import { NeonSerializableSharedCellOwnershipSnapshotSource, type NeonSerializableSnapshotSqlClient } from "../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";
import { SerializableSharedCellCleanupDeletionZeroTenantAdapter } from "../lib/deployments/execution/shared-cell-cleanup-deletion-zero-tenant.ts";
import { handler as drainHandler } from "../ops/aws-sandbox/lambda/cell-drain-coordinator.ts";
import { handler as deleteHandler } from "../ops/aws-sandbox/lambda/cell-ttl-executor.ts";
import { cellCleanupInvocationSignal } from "../lib/deployments/execution/cell-cleanup-lambda-context.ts";

const now = Date.parse("2026-10-08T00:00:00.000Z");
const stackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012";
const signal = () => new AbortController().signal;
async function fixture(options: { pending?: boolean; blocked?: boolean; driftAt?: number; lostJobResponse?: boolean; wrongSnapshotFence?: boolean; clock?: () => number } = {}) {
  const operation = { schemaVersion: 2 as const, accountId: "402010193138" as const, region: "ca-central-1" as const, cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const, stackId, stackStatus: "CREATE_COMPLETE" as const, cellExpiresAt: new Date(now - 60_000).toISOString(),
    cloudFormationRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
    templateCanonicalSha256: "a".repeat(64), resourceInventorySha256: "b".repeat(64), ownerDeploymentId: "deployment_cell_owner_1", generation: 1,
    provisionEpoch: 1, provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }) };
  const unsigned = { ...operation, provisionOperationHash: await sha256Hex(sharedCellProvisionOperationIntent(operation)), revision: 1, state: "provision_verified" as const };
  const record: SharedCellProvisionAuthorityRecord = { ...unsigned, recordHash: await sha256Hex(unsigned) };
  const item = { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY, schema_version: 2 as const, revision: 1, record_json: canonicalJson(record) };
  const compiled = await compileSharedCellAdmissionDrainIntent(record);
  const event = { schemaVersion: 1, action: "coordinate_reviewed_cell_ttl_cleanup", expectedProvisionItemSha256: await sha256Hex(item), approvedDrainIntentSha256: compiled.fenceSha256 };
  const state = { reads: 0, drains: 0, jobWrites: 0, snapshots: 0, queued: false, failJobs: options.lostJobResponse ?? false, jobValues: [] as unknown[], trace: [] as string[] };
  const env = { environment_id: "env_aws_sandbox_ca_central_1", account_id: "402010193138", region: "ca-central-1", cell_key: "cell-sandbox-1",
    admission_state: "draining", admission_epoch: 1, admission_fence_sha256: compiled.fenceSha256,
    admission_provision_operation_hash: record.provisionOperationHash, admission_stack_id: stackId, admission_cell_expires_at: now - 60_000,
    admission_changed_at: now, db_observed_at: now, database_cell_expired: true };
  const admissionsSql: NeonSharedCellAdmissionFenceSqlClient = { async query(_statement, values) {
    state.drains++; state.trace.push("drain"); assert.equal(values[7], compiled.fenceSha256); return { rows: [{ ...env }] };
  } };
  const jobsSql: NeonSharedCellAdmissionFenceSqlClient = { async query(statement, values) {
    state.jobWrites++; state.trace.push("enqueue"); state.jobValues = values;
    assert.equal(statement, CELL_TTL_CLEANUP_JOBS_SQL);
    const inserted = options.pending && !state.queued && !options.blocked ? 1 : 0;
    const active = options.pending && state.queued && !options.blocked ? 1 : 0;
    state.queued ||= Boolean(inserted);
    if (state.failJobs) { state.failJobs = false; throw new Error("postgres://private-password@host/db"); }
    return { rows: [{ environment_matched: true, inserted_count: String(inserted), active_count: String(active), blocked_count: options.blocked ? "1" : "0",
      target_count: options.pending || options.blocked ? "1" : "0", db_observed_at: String(now) }] };
  } };
  const snapshotSql: NeonSerializableSnapshotSqlClient = { async transaction(build, settings) {
    state.snapshots++; state.trace.push("snapshot");
    const handles = build({ query: (statement, values = []) => ({ queryData: { statement, values } }) }); assert.equal(handles.length, 6);
    assert.equal(settings.readOnly, true); assert.equal(settings.isolationLevel, "Serializable");
    return [{ rows: [{ ...env, admission_fence_sha256: options.wrongSnapshotFence ? "c".repeat(64) : env.admission_fence_sha256 }] },
      { rows: options.pending ? [{ id: "instance_1" }] : [] }, { rows: [] }, { rows: [] },
      { rows: options.pending ? [{ id: "instance_1" }] : [] }, { rows: [] }];
  } };
  const clock = options.clock ?? (() => now);
  const root = createPreparedCellDrainCoordinator({ authority: { async observe() {
    state.reads++; state.trace.push("authority"); return { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1,
      item: options.driftAt === state.reads ? null : structuredClone(item) };
  } }, admissions: new NeonSharedCellAdmissionFenceWriter(admissionsSql), jobs: new NeonCellTtlCleanupJobProducer(jobsSql),
    ownership: new SerializableSharedCellCleanupDeletionZeroTenantAdapter(new NeonSerializableSharedCellOwnershipSnapshotSource(snapshotSql), { now: clock }), now: clock });
  return { root, event, state };
}

test("coordinator wires real Neon drain/job/snapshot adapters in order without CAS/deletion", async () => {
  const f = await fixture(); const result = await f.root.run(f.event, signal());
  assert.equal(result.outcome, "ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW"); assert.equal(result.authorityWritePerformed, false); assert.equal(result.cellDeletionPerformed, false);
  assert.equal(result.runtimeActivationAuthorized, false); assert.equal(f.state.drains, 1); assert.equal(f.state.jobWrites, 1); assert.equal(f.state.snapshots, 1);
  assert.deepEqual(f.state.trace, ["authority", "authority", "drain", "authority", "enqueue", "authority", "snapshot", "authority"]);
  assert.equal(f.state.jobValues[6], stackId); assert.match(String(result.ownershipSnapshotSha256), /^[a-f0-9]{64}$/);
});
test("pending tenants queue an idempotent cleanup and never become Cell deletion approval", async () => {
  const f = await fixture({ pending: true }); const first = await f.root.run(f.event, signal()); const replay = await f.root.run(f.event, signal());
  assert.equal(first.outcome, "TENANT_CLEANUP_PENDING"); assert.equal(first.jobReceipt.insertedCount, 1); assert.equal(replay.jobReceipt.activeCount, 1);
  assert.equal(replay.jobReceipt.insertedCount, 0); assert.equal(replay.ownershipCounts.activeTenantCount, 1); assert.equal(replay.cellDeletionPerformed, false);
});
test("terminal cleanup jobs remain blocked and are not reset", async () => {
  const f = await fixture({ blocked: true }); const result = await f.root.run(f.event, signal());
  assert.equal(result.outcome, "BLOCKED_CLEANUP_JOB_REQUIRES_REVIEW"); assert.equal(result.jobReceipt.blockedCount, 1);
  assert.equal(result.runtimeActivationAuthorized, false);
  assert.doesNotMatch(CELL_TTL_CLEANUP_JOBS_SQL, /UPDATE\s+deployment_jobs|DELETE\s+FROM|TRUNCATE/i);
});
test("invalid/unreviewed event and drifted predecessor reject before Neon writes", async () => {
  const f = await fixture();
  for (const event of [{ ...f.event, enabled: true }, { ...f.event, stackId }, { ...f.event, approvedDrainIntentSha256: "a".repeat(64) }, { ...f.event, expectedProvisionItemSha256: "a".repeat(64) }])
    await assert.rejects(f.root.run(event, signal()));
  assert.equal(f.state.drains, 0); assert.equal(f.state.jobWrites, 0);
});
test("before-expiry clocks cannot drain or enqueue", async () => {
  const f = await fixture({ clock: () => now - 120_000 });
  await assert.rejects(f.root.run(f.event, signal()), (e: { code: string }) => e.code === "CELL_DRAIN_NOT_DUE");
  assert.equal(f.state.drains, 0); assert.equal(f.state.jobWrites, 0);
});
test("authority drift after drain stops before job creation", async () => {
  const f = await fixture({ driftAt: 3 });
  await assert.rejects(f.root.run(f.event, signal()), (e: { code: string }) => e.code === "CELL_DRAIN_PREDECESSOR_DRIFT");
  assert.equal(f.state.drains, 1); assert.equal(f.state.jobWrites, 0);
});
test("job response loss exposes only fixed code and later delivery reuses the job key", async () => {
  const f = await fixture({ pending: true, lostJobResponse: true });
  await assert.rejects(f.root.run(f.event, signal()), (e: { code: string; message: string }) => e.code === "CELL_TTL_JOBS_WRITE_UNCERTAIN" && !e.message.includes("password"));
  const recovered = await f.root.run(f.event, signal()); assert.equal(recovered.jobReceipt.activeCount, 1); assert.equal(recovered.jobReceipt.insertedCount, 0);
});
test("wrong post-drain serializable fence cannot emit zero-tenant review material", async () => {
  const f = await fixture({ wrongSnapshotFence: true }); await assert.rejects(f.root.run(f.event, signal()), (e: { code: string }) => e.code === "CELL_DRAIN_SNAPSHOT_INVALID");
});
test("SQL targets only locked, owned sandbox generations and preserves existing Worker payload/dedupe semantics", () => {
  assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /FOR UPDATE OF environment/); assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /FOR UPDATE OF resource, deployment/);
  assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /resource.owner_deployment_id/); assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /deployment.app_instance_id = resource.app_instance_id/);
  assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /ON CONFLICT \(dedupe_key\) DO NOTHING/); assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /LIMIT 10/);
  assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /THEN 'cleanup' ELSE 'rollback'/); assert.match(CELL_TTL_CLEANUP_JOBS_SQL, /attempts < max_attempts/);
});
test("new handlers reject events/context before credentials and do not replace PLAN_ONLY target", async () => {
  await assert.rejects(drainHandler({}, {}), /CELL_DRAIN_EVENT_INVALID/); await assert.rejects(deleteHandler({}, {}), /CELL_TTL_EVENT_INVALID/);
  const f = await fixture(); await assert.rejects(drainHandler(f.event, {}), /CELL_CLEANUP_LAMBDA_CONTEXT_INVALID/);
  await assert.rejects(deleteHandler({ schemaVersion: 1, action: "execute_reviewed_cell_ttl_cleanup", approvedDeletionPlanSha256: "a".repeat(64) }, {}), /CELL_CLEANUP_LAMBDA_CONTEXT_INVALID/);
});
test("foreign function ARN or unsafe Lambda deadline rejects before runtime construction", () => {
  assert.throws(() => cellCleanupInvocationSignal({ functionName: "test", invokedFunctionArn: "foreign", getRemainingTimeInMillis: () => 60000 }, "test"));
  assert.throws(() => cellCleanupInvocationSignal({ functionName: "test", invokedFunctionArn: "arn:aws:lambda:ca-central-1:402010193138:function:test", getRemainingTimeInMillis: () => 1000 }, "test"));
});
