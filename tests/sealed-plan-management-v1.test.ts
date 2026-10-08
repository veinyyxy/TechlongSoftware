import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SEALED_PLAN_MANAGEMENT_SQL_V1, readSealedPlanManagementStateV1, compileSealedPlanManagementReviewV1,
  validateSealedPlanManagementApprovalV1, validateSealedPlanManagementReviewIntegrityV1, runReviewedSealedPlanMutationV1,
  type SealedPlanManagementSqlClientV1 } from "../lib/deployments/execution/sealed-plan-management-v1.ts";

const now = Date.parse("2026-10-08T17:00:00.000Z");
const sql = readFileSync(new URL("../ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const binding = { targetFingerprintSha256: "a".repeat(64), managementCodeSha256: "b".repeat(64) };
function fixture() {
  const calls: string[] = [];
  const original = { original_row: "{\"fixture\":true}", desired_plan: JSON.stringify({ safety: { applyEnabled: false, createsAwsResources: false, storesSecretValues: false } }),
    plan_hash: "1".repeat(64), id: "dep_d00144511731f1c20991aa56", app_instance_id: "app_fb1962e93a9a4cc2acf046170593d9e3", environment_id: "env_aws_sandbox_ca_central_1",
    mode: "plan_only", status: "planned", cell_key: "cell-demo-1", attempts: 0, instance_status: "pending", subscription_status: "active", business_state: "{\"business\":true}",
    siblings: 1, jobs: 0, steps: 0, schedules: 0, capacity: 0, resources: 0, resource_events: 0, operations: 0, operation_events: 0, cleanup_runs: 0 };
  const context = { database: "fixture", role: "fixture_owner", session_role: "fixture_owner", version: "180006", replication_role: "origin", can_create_public: true,
    read_only: "on", isolation: "serializable", deferrable: "on", search_path: "pg_catalog", observed_at: now };
  const names = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules", "deployment_environment_capacity_reservations",
    "deployment_tenant_resources", "deployment_tenant_resource_events", "deployment_tenant_external_operations", "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs"];
  const tables = names.map(name => ({ name, owner: "fixture_owner", owner_member: true, triggers: name === "app_instance_deployments" ?
    [{ name: "app_instance_deployments_admission_reopen_fence", enabled: "O", function: "deployment application instance and environment are immutable" }] : [] }));
  const references = names.slice(1).map(name => `public.${name}.${["deployment_tenant_external_operations", "deployment_tenant_cleanup_runs"].includes(name) ? "owner_deployment_id" : name === "deployment_tenant_resources" ? "created_by_deployment_id" : "deployment_id"}`);
  references.push("public.deployment_tenant_resources.owner_deployment_id"); references.sort();
  const client: SealedPlanManagementSqlClientV1 = { async query(statement) {
    calls.push(statement);
    return { rows: structuredClone(statement === SEALED_PLAN_MANAGEMENT_SQL_V1.context ? [context] : statement === SEALED_PLAN_MANAGEMENT_SQL_V1.original ? [original] :
      statement === SEALED_PLAN_MANAGEMENT_SQL_V1.tables ? tables : statement === SEALED_PLAN_MANAGEMENT_SQL_V1.references ? references.map(reference => ({ reference })) : []) };
  } };
  return { client, calls, original, context, tables };
}
async function prepared() {
  const f = fixture();
  const readback = await readSealedPlanManagementStateV1(f.client);
  const review = await compileSealedPlanManagementReviewV1({ phase: "install", binding, readback, candidateSql: sql, startedAt: now, now });
  f.calls.length = 0;
  return { ...f, readback, review };
}

test("read-only review binds full schema/owner/role/preimage and is a separate unregistered installation scope", async () => {
  const f = await prepared();
  assert.equal(f.review.prestateSha256, await sha256Hex(f.readback.state));
  assert.equal(f.review.changesBusinessRows, false); assert.equal(f.review.createsRolesOrGrants, false);
  assert.equal(f.review.runtimeActivationAuthorized, false); assert.equal(f.review.retryAuthorized, false);
  await validateSealedPlanManagementApprovalV1(f.review, f.review.manifestSha256, binding, sql, now);
  assert.deepEqual(f.calls, []);
});

test("wrong SHA, changed target/code/SQL, unknown fields and expired review reject before BEGIN", async () => {
  const f = await prepared(); let claimed = 0;
  const input = { client: f.client, review: f.review, approvedSha256: f.review.manifestSha256, binding, candidateSql: sql, now: () => now,
    claimPermanentSlot: async () => { claimed++; }, persistConsumedReview: async () => undefined };
  for (const change of [{ approvedSha256: "0".repeat(64) }, { binding: { ...binding, managementCodeSha256: "0".repeat(64) } },
    { binding: { ...binding, targetFingerprintSha256: "0".repeat(64) } }, { candidateSql: sql + "-- changed" }, { now: () => f.review.expiresAt },
    { review: { ...f.review, extra: true } }]) await assert.rejects(runReviewedSealedPlanMutationV1({ ...input, ...change }));
  assert.equal(claimed, 0); assert.equal(f.calls.length, 0);
  // Historical read-only integrity validation does not require an unexpired write window.
  await validateSealedPlanManagementReviewIntegrityV1(f.review, binding, sql);
});

test("business/catalog/owner/reference drift is rejected without claiming the write slot", async () => {
  const f = await prepared(); let claimed = 0;
  f.original.business_state = "{\"changed\":true}";
  const result = await runReviewedSealedPlanMutationV1({ client: f.client, review: f.review, approvedSha256: f.review.manifestSha256, binding, candidateSql: sql,
    now: () => now, claimPermanentSlot: async () => { claimed++; }, persistConsumedReview: async () => undefined });
  assert.equal(result.commitConfirmed, false); assert.equal(result.slotConsumed, false); assert.equal(claimed, 0);
  assert.equal(result.failureCode, "SEALED_MANAGEMENT_PRESTATE_DRIFT_NO_WRITE");
  assert.equal(f.calls.includes(sql), false); assert.equal(f.calls.at(-1), "ROLLBACK");
});

test("every execution reference, missing ownership and replication-role drift blocks review", async () => {
  for (const key of ["jobs", "steps", "schedules", "capacity", "resources", "resource_events", "operations", "operation_events", "cleanup_runs"] as const) {
    const f = fixture(); f.original[key] = 1;
    await assert.rejects(compileSealedPlanManagementReviewV1({ phase: "install", binding, readback: await readSealedPlanManagementStateV1(f.client), candidateSql: sql, startedAt: now, now }));
  }
  const f = fixture(); f.tables[0].owner_member = false;
  await assert.rejects(compileSealedPlanManagementReviewV1({ phase: "install", binding, readback: await readSealedPlanManagementStateV1(f.client), candidateSql: sql, startedAt: now, now }));
  f.tables[0].owner_member = true; f.context.replication_role = "replica";
  await assert.rejects(compileSealedPlanManagementReviewV1({ phase: "install", binding, readback: await readSealedPlanManagementStateV1(f.client), candidateSql: sql, startedAt: now, now }));
});

test("consumed-slot evidence failure permanently stops before DDL and rolls back the transaction", async () => {
  const f = await prepared(); let claims = 0;
  const result = await runReviewedSealedPlanMutationV1({ client: f.client, review: f.review, approvedSha256: f.review.manifestSha256, binding, candidateSql: sql,
    now: () => now, claimPermanentSlot: async () => { claims++; }, persistConsumedReview: async () => { throw new Error("private-fixture-marker"); } });
  assert.equal(claims, 1); assert.equal(result.slotConsumed, true); assert.equal(result.commitConfirmed, false); assert.equal(result.retryAuthorized, false);
  assert.equal(f.calls.includes(sql), false); assert.equal(f.calls.at(-1), "ROLLBACK");
  assert.doesNotMatch(JSON.stringify(result), /private-fixture-marker/);
});

test("DDL failure after a consumed slot does not retry or issue COMMIT", async () => {
  const f = await prepared(); let writes = 0;
  const client: SealedPlanManagementSqlClientV1 = { async query(statement, values) {
    if (statement === sql) { writes++; throw new Error("postgres://private-fixture-marker"); } return f.client.query(statement, values);
  } };
  const result = await runReviewedSealedPlanMutationV1({ client, review: f.review, approvedSha256: f.review.manifestSha256, binding, candidateSql: sql,
    now: () => now, claimPermanentSlot: async () => undefined, persistConsumedReview: async () => undefined });
  assert.equal(writes, 1); assert.equal(result.slotConsumed, true); assert.equal(result.commitConfirmed, false);
  assert.equal(f.calls.includes("COMMIT"), false); assert.equal(f.calls.at(-1), "ROLLBACK");
});

test("production CLI is explicit, TLS-verified and uses separate permanent install/registration slots", () => {
  const runner = readFileSync(new URL("../ops/aws-sandbox/scripts/review-f3b3-sealed-management.mjs", import.meta.url), "utf8");
  assert.match(runner, /rejectUnauthorized:true/); assert.doesNotMatch(runner, /rejectUnauthorized:false|ssl:false/);
  assert.match(runner, /sealed-\$\{phase\}-v1-consumed/); assert.match(runner, /--approved-sha/);
  assert.match(runner, /BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE/);
  assert.doesNotMatch(runner, /DROP TABLE|DROP ROLE|DeleteStack|migration.*push/i);
});
