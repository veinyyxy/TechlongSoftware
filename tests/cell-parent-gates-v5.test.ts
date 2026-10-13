import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { cellParentFixtureV4 } from "./fixtures/cell-parent-v4.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { v3StackId } from "./fixtures/cell-stack-v3.ts";
import { AwsSdkCellParentInstallationReaderV5, AwsSdkCellParentRegistryReaderV5, normalizeCellParentConfigV5, normalizeCellParentLatestArnV5,
  cellParentJobsSqlAdapterV5, CELL_PARENT_JOBS_SQL_V5, CELL_PARENT_LEGACY_JOBS_SQL_V5 } from "../lib/deployments/execution/cell-parent-compatibility-v5.ts";
import { assertCellParentInstallationV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { CELL_PARENT_GATE_SPEC_V5 as spec, CELL_PARENT_GATE_FALSE_CONDITION_V5 as impossible, cellParentGateRequestsV5,
  classifyCellParentGateErrorV5, validateCellParentGateEventV5, runCellParentGatesV5, type CellParentGateEventV5, type CellParentGatePortsV5 } from "../lib/deployments/execution/cell-parent-gates-v5.ts";
import { inspectCellParentGateSnapshotV5 } from "../lib/deployments/execution/cell-parent-gates-v5.ts";
import { CELL_PARENT_KEY_V4, prepareCellBirthParentReviewV4, approveCellBirthParentRecordV4 } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { CELL_PARENT_ASYNC_PLAN_V5, assertCellParentAsyncLockedV5 } from "../lib/deployments/execution/cell-parent-async-plan-v5.ts";
import { CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 as protection, cellParentControlEndpointV5, readCellParentGateReaderV5 } from "../lib/deployments/execution/cell-parent-runtime-material-v5.ts";
import { NeonCellParentDatabaseV4 } from "../lib/deployments/execution/neon-cell-parent-control-v4.ts";
import type { NeonSerializableSnapshotSqlClient } from "../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";
const signal = () => new AbortController().signal;
// Focused real parser/private-brand tests with fake transports. No credentials,
// provider SQL/Secret read, cloud invocation or data-plane permission proof.
async function fixture() {
  const f = await cellParentFixtureV4(), old = await sealedEvidenceFixture();
  const binding = { ...f.binding, roleId: spec.roleId };
  (f.data.role.Role as Record<string, unknown>).RoleId = spec.roleId; f.readFaults.roleId = spec.roleId;
  f.data.functionConfig.FunctionArn = `${spec.functionArn}:$LATEST`; f.data.functionConfig.Layers = null;
  const reader = new AwsSdkCellParentInstallationReaderV5({ ...f.registrySdk, iam: f.registrySdk.sts, lambda: f.registrySdk.sts,
    commands: f.registrySdk.commands as never }, "lifecycle_coordinator", f.now);
  const body = { schemaVersion: 5 as const, action: "inspect_fixed_cell_parent_gates_v5" as const, gateSpecSha256: await sha256Hex(spec),
    binding, stackId: v3StackId, reviewedAt: f.now(), expiresAt: f.now() + 900000, expectedParentSha256: null };
  const event: CellParentGateEventV5 = { ...body, manifestSha256: await sha256Hex(body) };
  const rows = structuredClone(old.results);
  Object.assign(rows[1].rows[0], { admission_state: "open", admission_epoch: 0, admission_fence_sha256: null, admission_provision_operation_hash: null,
    admission_stack_id: null, admission_cell_expires_at: null, admission_changed_at: null, observed_at: f.now() });
  const sql: NeonSerializableSnapshotSqlClient = { async transaction(queries, options) {
    assert.equal(options.readOnly, true); assert.equal(options.deferrable, true); assert.equal(options.isolationLevel, "Serializable");
    const q = queries({ query: (statement: string) => statement } as never); assert.equal(q.length, 14);
    return [...rows, { rows: [] }, { rows: [{ identity_sha256: "a".repeat(64) }] }, { rows: [{ protection_sha256: protection }] }, { rows: [] }, { rows: [] }];
  } };
  const db = new NeonCellParentDatabaseV4(sql, { query: async () => { assert.fail("gate must not use DB writer"); } }, old.cert, protection);
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const ports: CellParentGatePortsV5 = {
    now: f.now, installation: (e, s) => reader.read(e.binding, e.stackId, s, { ...f.local, invokedFunctionArn: `${spec.functionArn}:$LATEST` }),
    snapshot: async () => ({ Responses: spec.readKeys.map(() => ({})) }), reader: s => db.readOpen(s, true),
    conditional: async (operation, input) => {
      const index = calls.length; calls.push({ operation, input });
      if (index < 2) throw { name: "TransactionCanceledException", CancellationReasons: (input.TransactItems as unknown[]).map(() => ({ Code: "ConditionalCheckFailed" })) };
      throw { name: "AccessDeniedException", message: "PRIVATE_DIAGNOSTIC" };
    },
  };
  return { f, reader, binding, event, ports, calls };
}
test("V5 normalization admits only exact qualified/unqualified latest and empty/null Layers", () => {
  for (const FunctionArn of [spec.functionArn, `${spec.functionArn}:$LATEST`]) for (const Layers of [undefined, null, []]) {
    const input = { FunctionArn, FunctionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", Version: "$LATEST", Layers, CodeSha256: "retain", RevisionId: "retain" };
    const out = normalizeCellParentConfigV5(input); assert.equal(out.FunctionArn, spec.functionArn); assert.equal(out.CodeSha256, "retain"); assert.equal(out.RevisionId, "retain"); assert.equal(input.FunctionArn, FunctionArn);
  }
  for (const arn of [`${spec.functionArn}:1`, `${spec.functionArn}:current`, `${spec.functionArn}:$LATEST:other`, spec.functionArn + "-other", spec.functionArn.replace("402010193138", "111111111111")])
    assert.throws(() => normalizeCellParentLatestArnV5(arn, "techlong-sandbox-cell-lifecycle-coordinator-v3", "$LATEST"));
  assert.throws(() => normalizeCellParentLatestArnV5(spec.functionArn, "other", "$LATEST"));
  assert.throws(() => normalizeCellParentLatestArnV5(spec.functionArn, "techlong-sandbox-cell-lifecycle-coordinator-v3", "1"));
  for (const Layers of [{}, "[]", false, [{ Arn: "layer" }]]) assert.throws(() => normalizeCellParentConfigV5({ FunctionArn: spec.functionArn, FunctionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", Version: "$LATEST", Layers }));
});
test("V5 compatibility retains genuine V4 proof and exact ZIP/Revision/local bundle/source checks", async () => {
  const { f, reader, binding } = await fixture();
  const proof = await reader.read(binding, v3StackId, signal(), { ...f.local, invokedFunctionArn: `${spec.functionArn}:$LATEST` });
  assertCellParentInstallationV4(proof, f.now(), true); assert.equal(proof.effectiveDataPlaneDenyProved, false);
  for (const drift of [{ CodeSha256: "wrong" }, { RevisionId: "wrong" }, { Role: "wrong" }, { Environment: { Variables: { x: "secret" } } }, { Architectures: ["arm64"] }]) {
    const saved = structuredClone(f.data.functionConfig); Object.assign(f.data.functionConfig, drift);
    await assert.rejects(reader.read(binding, v3StackId, signal(), f.local)); f.data.functionConfig = saved;
  }
  await assert.rejects(reader.read(binding, v3StackId, signal(), { ...f.local, bundleSha256: "0".repeat(64) }));
  const source = new AwsSdkCellParentInstallationReaderV5({ ...f.registrySdk, iam: f.registrySdk.sts, lambda: f.registrySdk.sts, commands: f.registrySdk.commands as never }, "source_inspection", f.now);
  await assert.rejects(source.read(binding, v3StackId, signal(), f.local), /SOURCE_CANNOT_CLAIM/);
});
test("jobs adapter changes only exact legacy SQL in the same transaction; options, values and objects survive", async () => {
  const seen: string[] = [], values = ["env"], marker = {}, options = { isolationLevel: "Serializable" as const, readOnly: true as const, deferrable: true as const, fullResults: true as const, fetchOptions: { signal: signal() } };
  const sql: NeonSerializableSnapshotSqlClient = { async transaction(q, o) {
    assert.equal(o, options); const list = q({ query: (s, v) => { seen.push(s); assert.equal(v, values); return marker; } });
    assert.ok(list.every(x => x === marker)); return [];
  } };
  await cellParentJobsSqlAdapterV5(sql).transaction(tx => [tx.query(CELL_PARENT_LEGACY_JOBS_SQL_V5, values), tx.query(CELL_PARENT_JOBS_SQL_V5, values), tx.query("SELECT 'queued'", values)], options);
  assert.deepEqual(seen, [CELL_PARENT_JOBS_SQL_V5, CELL_PARENT_JOBS_SQL_V5, "SELECT 'queued'"]);
  assert.match(seen[0], /pending.*running.*retry_wait/);
});
test("runtime registry rejects a genuine parent bound to different protection before publication or DB material", async () => {
  const f = await cellParentFixtureV4(), registry = new AwsSdkCellParentRegistryReaderV5(f.registrySdk, f.runtimeMeta, "lifecycle_coordinator", f.local, f.now);
  await assert.rejects(registry.readStrong(signal()), /REGISTERED_PROTECTION_MISMATCH/); assert.equal(f.writes.length, 0);
});
test("all seven gate calls have fixed targets, impossible conditions and no Update/Delete or returned item", () => {
  const requests = cellParentGateRequestsV5(); assert.equal(requests.length, spec.conditionalWriteApiCallsMaximum);
  for (const r of requests) {
    const input = r.input as Record<string, unknown>, actions = input.TransactItems as Record<string, unknown>[] | undefined;
    for (const a of actions ?? [{ Put: input }]) {
      assert.equal(Object.keys(a).length, 1); assert.ok(a.Put || a.ConditionCheck);
      const x = (a.Put ?? a.ConditionCheck) as Record<string, unknown>;
      assert.equal(x.TableName, spec.tableArn); assert.equal(x.ConditionExpression, impossible); assert.equal(x.ReturnValuesOnConditionCheckFailure, "NONE");
    }
  }
  assert.equal(requests.filter(x => x.expect === "condition_failed").length, 2);
  assert.equal(requests.filter(x => x.expect === "access_denied").length, 5);
});
test("negative gates accept only AccessDenied; incomplete/validation/throttle/conditional results never prove deny or allow", () => {
  assert.equal(classifyCellParentGateErrorV5({ name: "AccessDeniedException" }, "access_denied", 1), true);
  const condition = { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
  assert.equal(classifyCellParentGateErrorV5(condition, "condition_failed", 1), true);
  assert.equal(classifyCellParentGateErrorV5(condition, "access_denied", 1), false);
  for (const error of [null, { name: "ValidationException" }, { name: "TransactionCanceledException" }, { ...condition, CancellationReasons: [{ Code: "None" }] },
    { ...condition, CancellationReasons: [{ Code: "ConditionalCheckFailed", Item: { private: "value" } }] }, { name: "ThrottlingException" }])
    assert.equal(classifyCellParentGateErrorV5(error, "condition_failed", 1), false);
  assert.equal(classifyCellParentGateErrorV5(condition, "condition_failed", 2), false);
});
test("request digest/window/role/scope validated before any transport", async () => {
  const { event, f, ports, calls } = await fixture();
  for (const e of [{ ...event, sql: "SELECT 1" }, { ...event, gateSpecSha256: "0".repeat(64) }, { ...event, manifestSha256: "0".repeat(64) }, { ...event, expiresAt: f.now() },
    { ...event, stackId: v3StackId.replace("cell-sandbox-1", "other") }, { ...event, binding: { ...event.binding, roleId: "AROAV3GNMXTZOTHERROLE" } }])
    await assert.rejects(runCellParentGatesV5(e, ports, signal()));
  assert.equal(calls.length, 0); await assert.rejects(validateCellParentGateEventV5(event, event.expiresAt));
});
test("finite gate composition returns observations, not runtime/deletion/other-principal or writer proof", async () => {
  const { event, ports, calls } = await fixture(), result = await runCellParentGatesV5(event, ports, signal());
  assert.equal(calls.length, 7); assert.equal(result.mutationPerformed, false); assert.equal(result.readerAuthenticated, true);
  assert.equal(result.writerAuthenticated, false); assert.equal(result.otherPrincipalsProved, false); assert.equal(result.deleteOrPassRoleProved, false);
  assert.equal(result.authorityIssued, false); assert.equal(result.retryAuthorized, false); assert.equal(result.tenantRuntimeEnabled, false);
  assert.doesNotMatch(canonicalJson(result), /PRIVATE_DIAGNOSTIC|password|databaseUrl/);
});
test("occupied parent stops before conditional APIs; uncertain result stops once without repair/retry", async () => {
  const { event, ports, calls } = await fixture();
  await assert.rejects(runCellParentGatesV5(event, { ...ports, snapshot: async () => ({ Responses: spec.readKeys.map(() => ({ Item: {} })) }) }, signal()), /OCCUPIED/);
  assert.equal(calls.length, 0);
  let count = 0; await assert.rejects(runCellParentGatesV5(event, { ...ports, conditional: async () => { count++; return {}; } }, signal()), /UNEXPECTED_RESULT/); assert.equal(count, 1);
});
test("post-registration snapshot requires exact complete parent, protection/binding/window and absent workflow slots", async () => {
  const { f, event } = await fixture(), at = f.review.manifest.reviewedAt;
  const review = await prepareCellBirthParentReviewV4({ plan: f.source.plan, reserved: f.reserved, delegation: f.delegation, installation: f.installedMeta, failedProtectionSha256: protection, now: at });
  const record = await approveCellBirthParentRecordV4({ review, approvedManifestSha256: review.manifestSha256, now: at });
  // Snapshot parser test; runtime event validation independently pins real
  // bootstrap RoleId before transport. No fixture identity is a cloud proof.
  const bound = { ...event, binding: f.binding, expectedParentSha256: record.parentSha256 };
  const responses = spec.readKeys.map(() => ({})) as Record<string, unknown>[];
  responses[0] = { Item: { authority_key: CELL_PARENT_KEY_V4, schema_version: 4, record_json: canonicalJson(record) } };
  assert.equal(await inspectCellParentGateSnapshotV5({ Responses: responses }, bound, f.now()), record.parentSha256);
  for (const drift of [{ ...bound, expectedParentSha256: "0".repeat(64) }, { ...bound, binding: { ...bound.binding, revisionId: "wrong-revision-123" } }, { ...bound, expectedParentSha256: null }])
    await assert.rejects(inspectCellParentGateSnapshotV5({ Responses: responses }, drift, f.now()));
  await assert.rejects(inspectCellParentGateSnapshotV5({ Responses: responses }, bound, record.manifest.delegation.notAfter));
  responses[1] = { Item: {} }; await assert.rejects(inspectCellParentGateSnapshotV5({ Responses: responses }, bound, f.now()), /WORKFLOW_OCCUPIED/);
});
test("fixed reader parsing rejects wrong versions and endpoint/owner material without exposing credentials", async () => {
  await assert.rejects(readCellParentGateReaderV5(async () => ({ ARN: "wrong", SecretString: "PRIVATE_PASSWORD" }), signal()), /GATE_SECRET_INVALID/);
  for (const u of ["postgres://owner:private@ep-example.ca-central-1.aws.neon.tech/db?sslmode=require", "postgres://techlong_cell_cleanup_reader:private@example.com/db?sslmode=require",
    "postgres://techlong_cell_cleanup_reader:private@ep-example.ca-central-1.aws.neon.tech/db", "postgres://techlong_cell_cleanup_reader:private@ep-example.ca-central-1.aws.neon.tech/db?sslmode=require&sslmode=disable"])
    assert.throws(() => cellParentControlEndpointV5(u, "techlong_cell_cleanup_reader"), e => !String(e).includes("private"));
  assert.equal(cellParentControlEndpointV5("postgres://techlong_cell_cleanup_reader:private@ep-example.ca-central-1.aws.neon.tech/db?sslmode=verify-full", "techlong_cell_cleanup_reader"), "ep-example.ca-central-1.aws.neon.tech/db");
});
test("async plan keeps concurrency zero and rejects aliases, extra destinations, age/retry/concurrency drift", () => {
  const config = { FunctionArn: `${spec.functionArn}:$LATEST`, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0, DestinationConfig: {} }, concurrency = { ReservedConcurrentExecutions: 0 };
  assert.equal(CELL_PARENT_ASYNC_PLAN_V5.installationAuthorized, false); assert.equal(assertCellParentAsyncLockedV5(config, concurrency).exactlyOnceProved, false);
  for (const DestinationConfig of [{ OnSuccess: {}, OnFailure: {} }, { OnFailure: { Destination: "" } }])
    assert.equal(assertCellParentAsyncLockedV5({ ...config, DestinationConfig }, concurrency).destinations, 0);
  for (const drift of [{ FunctionArn: `${spec.functionArn}:current` }, { MaximumEventAgeInSeconds: 61 }, { MaximumRetryAttempts: 1 }, { DestinationConfig: { OnFailure: { Destination: "other" } } }, { DestinationConfig: undefined }])
    assert.throws(() => assertCellParentAsyncLockedV5({ ...config, ...drift }, concurrency));
  assert.throws(() => assertCellParentAsyncLockedV5(config, { ReservedConcurrentExecutions: 1 }));
});
