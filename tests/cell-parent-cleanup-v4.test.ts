import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { cellParentFixtureV4 } from "./fixtures/cell-parent-v4.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { v3StackId } from "./fixtures/cell-stack-v3.ts";
import { CELL_PARENT_WORKFLOW_KEYS_V4 as work } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys } from "../lib/deployments/execution/failed-cell-birth-ddb-v1.ts";
import { NeonCellParentDatabaseV4, assertCellParentOpenDatabaseV4, assertCellParentTtlZeroV4 } from "../lib/deployments/execution/neon-cell-parent-control-v4.ts";
import { AwsSdkCellParentCleanupJournalV4, assertParentDbClaimV4, prepareParentDeleteBoundaryV4 } from "../lib/deployments/execution/cell-parent-cleanup-v4.ts";
import { AwsSdkCellParentDeleteV4, assertCellParentDeleteObservationV4, type CellParentDeleteSdkV4 } from "../lib/deployments/execution/aws-sdk-cell-parent-delete-v4.ts";
import { PreparedCellParentCleanupRuntimeV4 } from "../lib/deployments/execution/prepared-cell-parent-cleanup-runtime-v4.ts";
import { createPreparedCellBirthParentRootV4 } from "../lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts";
import type { NeonSerializableSnapshotSqlClient } from "../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";

type Json = Record<string, unknown>;
const signal = () => new AbortController().signal;
// Real parsers/brands, fake SQL and atomic AWS transports only: not a live
// IAM/SQL/CFN acceptance proof. No provider credentials are read by these tests.
async function fixture(kind: "failed" | "ttl" = "failed", published = false) {
  const c = await cellParentFixtureV4(), old = await sealedEvidenceFixture(), rows = structuredClone(old.results);
  if (published) await c.publisher.publishOnce(c.event, signal());
  if (kind === "failed") c.paid.stack.StackStatus = "UPDATE_FAILED";
  else c.setTime(Date.parse(c.delegation.cellExpiresAt));
  const env = rows[1].rows[0]; Object.assign(env, { admission_state: "open", admission_epoch: 0, admission_fence_sha256: null,
    admission_provision_operation_hash: null, admission_stack_id: null, admission_cell_expires_at: null, admission_changed_at: null });
  let fence: Json[] = [], jobs: Json[] = [], steps: Json[] = [], loseSql = false, loseDelete = false, missing = false, tokenOverride: string | null = null, loads = 0;
  const sqlWrites: { statement: string; values: unknown[] }[] = [], transactions: string[][] = [], deletes: Json[] = [], events: Json[] = [];
  const sql: NeonSerializableSnapshotSqlClient = { async transaction(fn, options) {
    assert.equal(options.readOnly, true); assert.equal(options.isolationLevel, "Serializable"); assert.equal(options.deferrable, true);
    const queries = fn({ query: (statement: string) => statement } as never) as unknown as string[]; transactions.push(queries);
    env.observed_at = c.now();
    const extra = queries.length >= 14 ? [{ rows: fence }, { rows: [{ identity_sha256: "a".repeat(64) }] }, { rows: [{ protection_sha256: "e".repeat(64) }] }, { rows: jobs }, { rows: steps }, ...(queries.length === 15 ? [{ rows: jobs }] : [])] :
      [{ rows: [{ protection_sha256: "e".repeat(64) }] }, { rows: fence }, { rows: jobs }, { rows: steps }];
    assert.ok([13, 14, 15].includes(queries.length)); return structuredClone([...rows, ...extra]);
  } };
  const writer = { async query(statement: string, values: unknown[]) {
    sqlWrites.push({ statement, values });
    if (statement.includes("begin_failed_cell_birth_fence_v1")) {
      const f = JSON.parse(String(values[0])); Object.assign(env, { admission_state: "failed_unadmitted", admission_epoch: 1,
        admission_fence_sha256: values[1], admission_stack_id: f.stackId, admission_cell_expires_at: f.cellExpiresAt, admission_changed_at: c.now() });
      fence = [{ environment_id: f.environmentId, fence_json: values[0], fence_sha256: values[1], created_at: c.now() }];
      if (loseSql) throw Error("private URL/password diagnostics"); return { rows: [{ fence_sha256: values[1] }] };
    }
    if (statement.includes("INSERT INTO deployment_jobs")) return { rows: [{ environment_matched: true, target_count: 0, inserted_count: 0, active_count: 0, blocked_count: 0, db_observed_at: c.now() }] };
    Object.assign(env, { admission_state: "draining", admission_epoch: 1, admission_fence_sha256: values[7], admission_provision_operation_hash: values[6],
      admission_stack_id: values[4], admission_cell_expires_at: values[5], admission_changed_at: c.now() });
    if (loseSql) throw Error("private URL/password diagnostics"); return { rows: [{ ...env, db_observed_at: c.now(), database_cell_expired: true }] };
  } };
  const db = new NeonCellParentDatabaseV4(sql, writer, old.cert, "e".repeat(64)), journal = new AwsSdkCellParentCleanupJournalV4(c.registrySdk, c.now);
  const commands = Object.fromEntries(["identity", "deleteStack", "describe", "events"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as CellParentDeleteSdkV4["commands"];
  const send = async (raw: unknown) => { const cmd = raw as { kind: string; input: Json };
    if (cmd.kind === "identity") return { Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellLifecycleCoordinatorRoleV3/fixture-session", UserId: `${c.binding.roleId}:fixture-session` };
    assert.equal(cmd.input.StackName, v3StackId);
    if (cmd.kind === "deleteStack") { deletes.push(cmd.input); events.push({ StackId: v3StackId, EventId: "delete-event-1", PhysicalResourceId: v3StackId,
      LogicalResourceId: "techlong-sandbox-cell-sandbox-1", ResourceType: "AWS::CloudFormation::Stack", ResourceStatus: "DELETE_COMPLETE",
      Timestamp: new Date(c.now()), ClientRequestToken: cmd.input.ClientRequestToken });
      if (loseDelete) throw Error("private diagnostics"); return { $metadata: { httpStatusCode: 200 } }; }
    if (cmd.kind === "describe") { if (missing) { const e = Error("unavailable"); e.name = "ValidationError"; throw e; }
      return { Stacks: [{ StackId: v3StackId, StackName: "techlong-sandbox-cell-sandbox-1", RoleARN: c.paid.stack.RoleARN, StackStatus: events.length ? "DELETE_COMPLETE" : c.paid.stack.StackStatus }] }; }
    if (cmd.kind === "events") return { StackEvents: structuredClone(events.map(e => ({ ...e, ...(tokenOverride ? { ClientRequestToken: tokenOverride } : {}) }))) };
    throw Error("unexpected");
  };
  const deleter = new AwsSdkCellParentDeleteV4({ sts: { send }, cfn: { send }, commands }, c.now), cleanup = new PreparedCellParentCleanupRuntimeV4({ registry: c.registry,
    stack: c.paid.reader, journal, deleter, loadDatabase: async () => { loads++; return db; }, now: c.now });
  const root = createPreparedCellBirthParentRootV4({ registry: c.registry, publisher: c.publisher, stack: c.paid.reader, cleanup, now: c.now });
  return { ...c, db, journal, deleter, root, rows, transactions, deletes, events, sqlWrites, loads: () => loads,
    setJobs: (v: Json[]) => { jobs = v; }, setSteps: (v: Json[]) => { steps = v; }, loseSql: () => { loseSql = true; }, loseDelete: () => { loseDelete = true; },
    missing: () => { missing = true; }, wrongToken: () => { tokenOverride = "not-our-request"; } };
}

test("full root executes genuine failed fence + marker + unified once-delete and stores only attributed terminal receipt", async () => {
  const c = await fixture(), r = await c.root.run(c.event, signal()); assert.equal(r.outcome, "DELETE_COMPLETE_TOKEN_MATCHED");
  assert.equal(c.root.fullCleanupRootCompleted, true); assert.equal(c.sqlWrites.length, 1); assert.equal(c.deletes.length, 1);
  assert.equal(c.items.has(keys.provision), false); assert.equal(c.items.has(keys.activation), false); assert.ok(c.items.has(keys.marker));
  assert.ok(c.items.has(work.dbIntent)); assert.ok(c.items.has(work.deleteIntent)); assert.ok(c.items.has(work.deleteReceipt));
  assert.equal(c.deletes[0].DeletionMode, "STANDARD"); assert.equal(c.deletes[0].StackName, v3StackId);
  assert.equal((await c.root.run(c.event, signal())).outcome, "IMMUTABLE_DELETE_RECEIPT_REPLAYED"); assert.equal(c.deletes.length, 1); assert.equal(c.sqlWrites.length, 1);
});
test("TTL composes real drain/job producer and certified zero, for published AND missed-publication Cell", async () => {
  for (const published of [false, true]) { const c = await fixture("ttl", published), r = await c.root.run(c.event, signal());
    assert.equal(r.outcome, "DELETE_COMPLETE_TOKEN_MATCHED"); assert.equal(c.sqlWrites.length, 2); assert.equal(c.deletes.length, 1);
    assert.equal(c.items.has(keys.provision), published); assert.equal(c.items.has(keys.marker), false); assert.equal(c.items.has(keys.activation), false);
    const op = JSON.parse(String(c.items.get(work.dbIntent)!.record_json)); assert.equal(op.kind, "ttl");
    const zero = await c.db.readTtlZero(op.predecessor, signal()); assertCellParentTtlZeroV4(zero, op.predecessor, c.now());
    assert.throws(() => assertCellParentTtlZeroV4(structuredClone(zero), op.predecessor, c.now()));
    assert.ok(c.transactions.some(q => q.length === 13 && q.some(s => s.includes("'pending','running','retry_wait'"))));
  }
});
test("lost SQL commit and lost DeleteStack response recover independently without issuing either operation again", async () => {
  const c = await fixture(); c.loseSql(); c.loseDelete(); assert.equal((await c.root.run(c.event, signal())).outcome, "DELETE_COMPLETE_TOKEN_MATCHED");
  assert.equal(JSON.parse(String(c.items.get(work.dbReceipt)!.record_json)).outcome, "UNCERTAIN_INSPECT_ONLY");
  await c.root.run(c.event, signal()); assert.equal(c.sqlWrites.length, 1); assert.equal(c.deletes.length, 1);
  assert.doesNotMatch(canonicalJson([...c.items.values()]), /password|diagnostics/);
});
test("committed but lost database-slot response never grants SQL ownership or auto-retries", async () => {
  const c = await fixture(); c.loseWrite(); assert.equal((await c.root.run(c.event, signal())).outcome, "DATABASE_SLOT_NOT_OWNED_INSPECT_ONLY");
  assert.ok(c.items.has(work.dbIntent)); assert.equal(c.sqlWrites.length, 0); assert.equal(c.deletes.length, 0);
  assert.equal((await c.root.run(c.event, signal())).outcome, "DATABASE_OR_TENANT_WORK_NOT_CERTIFIED_ZERO_INSPECT_ONLY"); assert.equal(c.sqlWrites.length, 0);
});
test("concurrent cleanup contenders have distinct request tokens and at most one SQL/delete owner", async () => {
  const c = await fixture(); await Promise.allSettled([c.root.run(c.event, signal()), c.root.run(c.event, signal())]);
  assert.equal(c.sqlWrites.length, 1); assert.equal(c.deletes.length, 1); assert.equal(new Set(c.writes.map(w => w.ClientRequestToken)).size, c.writes.length);
});
test("nonterminal jobs/steps and changed protection prevent DeleteStack; copied or stale DB brands cannot pass", async () => {
  for (const phase of ["job", "step", "catalog"]) { const c = await fixture("ttl");
    if (phase === "job") c.setJobs([{ id: "job_pending" }]); else if (phase === "step") c.setSteps([{ id: "step_running" }]);
    else c.rows[2].rows[0].live_protection_sha256 = "a".repeat(64);
    if (phase === "catalog") await assert.rejects(() => c.root.run(c.event, signal()));
    else assert.equal((await c.root.run(c.event, signal())).outcome, "DATABASE_OR_TENANT_WORK_NOT_CERTIFIED_ZERO_INSPECT_ONLY");
    assert.equal(c.deletes.length, 0);
  }
  const c = await fixture(), open = await c.db.readOpen(signal(), true); assert.throws(() => assertCellParentOpenDatabaseV4(structuredClone(open), c.now(), true));
  assert.throws(() => assertCellParentOpenDatabaseV4(open, c.now() + 30001, true)); assert.throws(() => assertParentDbClaimV4({} as never));
});
test("delete-intent response loss consumes the slot; later missing Stack alone or wrong-token event is not completion", async () => {
  const c = await fixture(), send = c.registrySdk.ddb.send;
  c.registrySdk.ddb.send = async (raw, options) => { const x = raw as { kind: string; input: Json }, r = await send(raw, options);
    if (x.kind === "transactWrite" && (x.input.TransactItems as Json[]).some(a => (a.Put as Json | undefined)?.Item && ((a.Put as Json).Item as Json).authority_key === work.deleteIntent)) throw Error("lost"); return r; };
  // Journal captures its capability at construction; create a fresh one with
  // the fault at the transport boundary, not by mutating an installed class.
  const journal = new AwsSdkCellParentCleanupJournalV4(c.registrySdk, c.now), cleanup = new PreparedCellParentCleanupRuntimeV4({ registry: c.registry, stack: c.paid.reader,
    journal, deleter: c.deleter, loadDatabase: async () => c.db, now: c.now });
  const root = createPreparedCellBirthParentRootV4({ registry: c.registry, publisher: c.publisher, stack: c.paid.reader, cleanup, now: c.now });
  assert.equal((await root.run(c.event, signal())).outcome, "DELETE_SLOT_NOT_OWNED_INSPECT_ONLY"); assert.equal(c.deletes.length, 0);
  c.missing(); assert.equal((await root.run(c.event, signal())).outcome, "DELETE_SLOT_OCCUPIED_READONLY_INSPECT"); assert.equal(c.items.has(work.deleteReceipt), false);
});
test("exact terminal events can certify a no-longer-describable ARN, never a different token; copies cannot write receipts", async () => {
  const c = await fixture(); c.missing(); assert.equal((await c.root.run(c.event, signal())).outcome, "DELETE_COMPLETE_TOKEN_MATCHED");
  const p = (await c.registry.readStrong(signal()))!, w = await c.journal.read(p, signal()), o = await c.deleter.inspect(w, signal());
  assert.throws(() => assertCellParentDeleteObservationV4(structuredClone(o), w, c.now()));
  c.wrongToken(); assert.equal((await c.deleter.inspect(w, signal())).outcome, "PRESENT_NOT_ATTRIBUTED");
  await assert.rejects(() => prepareParentDeleteBoundaryV4(structuredClone(w), {} as never, {} as never, c.now()));
});
test("terminal recovery after parent deadline does not load Secrets/Neon or retry actuators", async () => {
  const c = await fixture(); await c.root.run(c.event, signal()); const n = c.loads(); c.setTime(c.delegation.notAfter + 1);
  assert.equal((await c.root.run(c.event, signal())).outcome, "IMMUTABLE_DELETE_RECEIPT_REPLAYED"); assert.equal(c.loads(), n); assert.equal(c.deletes.length, 1);
  // Model a receipt that was never committed, not an authorized cloud reset.
  c.items.delete(work.deleteReceipt); const writes = c.writes.length;
  assert.equal((await c.root.run(c.event, signal())).outcome, "DELETE_COMPLETE_TOKEN_MATCHED");
  assert.equal(c.writes.length, writes); assert.equal(c.loads(), n); assert.equal(c.deletes.length, 1);
});
test("cleanup intent blocks provision before submission and the exact transaction excludes publication races", async () => {
  const c = await fixture("ttl"); c.setJobs([{ id: "job_pending" }]); await c.root.run(c.event, signal());
  assert.ok(c.items.has(work.dbIntent)); await assert.rejects(() => c.publisher.publishOnce(c.event, signal())); assert.equal(c.items.has(keys.provision), false);
});
test("delete authority hash drift and changed runtime RoleId block recovery before any new actuator", async () => {
  const c = await fixture(); await c.root.run(c.event, signal()); const item = c.items.get(work.authority)!;
  const a = JSON.parse(String(item.record_json)); a.databaseStateSha256 = await sha256Hex("changed"); item.record_json = canonicalJson(a);
  await assert.rejects(() => c.root.run(c.event, signal())); assert.equal(c.deletes.length, 1);
  const d = await fixture(); d.readFaults.roleId = "WRONG"; await assert.rejects(() => d.root.run(d.event, signal())); assert.equal(d.sqlWrites.length, 0);
});
test("issuance response loss never re-mints metadata-write ownership or fills the consumed slot on restart", async () => {
  const c = await fixture(), send = c.registrySdk.ddb.send;
  c.registrySdk.ddb.send = async (raw, options) => { const x = raw as { kind: string; input: Json }, r = await send(raw, options);
    if (x.kind === "transactWrite" && (x.input.TransactItems as Json[]).some(a => ((a.Put as Json | undefined)?.Item as Json | undefined)?.authority_key === work.issuanceIntent)) throw Error("lost"); return r; };
  const journal = new AwsSdkCellParentCleanupJournalV4(c.registrySdk, c.now), cleanup = new PreparedCellParentCleanupRuntimeV4({ registry: c.registry, stack: c.paid.reader,
    journal, deleter: c.deleter, loadDatabase: async () => c.db, now: c.now });
  const root = createPreparedCellBirthParentRootV4({ registry: c.registry, publisher: c.publisher, stack: c.paid.reader, cleanup, now: c.now });
  assert.equal((await root.run(c.event, signal())).outcome, "ISSUANCE_SLOT_NOT_OWNED_INSPECT_ONLY"); const writes = c.writes.length;
  assert.equal((await root.run(c.event, signal())).outcome, "ISSUANCE_SLOT_OCCUPIED_NO_PUBLICATION_RETRY"); assert.equal(c.writes.length, writes);
  assert.equal(c.items.has(keys.marker), false); assert.equal(c.items.has(work.authority), false); assert.equal(c.deletes.length, 0);
});
test("failed cleanup covers real pending jobs inserted after SQL, without weakening the old 14-query parser", async () => {
  const c = await fixture(), install = c.db.failedWriter.installOnce.bind(c.db.failedWriter);
  c.db.failedWriter.installOnce = async input => { const r = await install(input); c.setJobs([{ id: "job_pending" }]); return r; };
  assert.equal((await c.root.run(c.event, signal())).outcome, "DATABASE_OR_TENANT_WORK_NOT_CERTIFIED_ZERO_INSPECT_ONLY"); assert.equal(c.deletes.length, 0);
  assert.ok(c.transactions.some(q => q.length === 15 && q[14].includes("'pending','running','retry_wait'")));
});
