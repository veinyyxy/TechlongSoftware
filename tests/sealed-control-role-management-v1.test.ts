import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SEALED_PLAN_MANAGEMENT_SQL_V1, type SealedPlanManagementSqlClientV1 } from "../lib/deployments/execution/sealed-plan-management-v1.ts";
import { SEALED_PLAN_CATALOG_READ_V1 } from "../lib/deployments/execution/sealed-plan-catalog-read-v1.ts";
import { CONTROL_ROLE_READ_SQL_V1, readSealedControlRoleStateV1, compileControlRoleReviewV1, validateControlRoleReviewV1,
  runReviewedControlRolesV1, verifyControlRolePoststateV1 } from "../lib/deployments/execution/sealed-control-role-management-v1.ts";

const now = Date.parse("2026-10-08T20:30:00Z");
const sql = readFileSync(new URL("../ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
async function fixture() {
  const calls: string[] = [];
  const original = { original_row: '{"fixture":true}', desired_plan: '{"safety":{"applyEnabled":false,"createsAwsResources":false,"storesSecretValues":false}}',
    plan_hash: "1".repeat(64), id: "dep_d00144511731f1c20991aa56", app_instance_id: "app_fb1962e93a9a4cc2acf046170593d9e3", environment_id: "env_aws_sandbox_ca_central_1",
    mode: "plan_only", status: "planned", cell_key: "cell-demo-1", attempts: 0, instance_status: "pending", subscription_status: "active", business_state: '{"business":true}',
    siblings: 1, jobs: 0, steps: 0, schedules: 0, capacity: 0, resources: 0, resource_events: 0, operations: 0, operation_events: 0, cleanup_runs: 0 };
  const context = { database: "fixture", role: "fixture_owner", session_role: "fixture_owner", version: "180006", replication_role: "origin", can_create_public: true,
    read_only: "on", isolation: "serializable", deferrable: "on", search_path: "pg_catalog", observed_at: now };
  const cert = { deployment_id: original.id, environment_id: original.environment_id, app_instance_id: original.app_instance_id,
    original_row_sha256: await sha256Hex(original.original_row), original_plan_bytes_sha256: await sha256Hex(original.desired_plan), original_plan_hash: original.plan_hash,
    business_state_sha256: await sha256Hex(original.business_state), approved_registration_sha256: "2".repeat(64), protection_schema_sha256: "3".repeat(64), sealed_at: now - 60_000 };
  const management = { rolname: "fixture_owner", rolsuper: false, rolcreaterole: true, self_grant: "" };
  const catalog = [{ kind: "schema", name: "public", properties: { owner: "fixture_owner", acl: [] } }];
  let roles: Record<string, unknown>[] = [];
  const tableNames = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules", "deployment_environment_capacity_reservations",
    "deployment_tenant_resources", "deployment_tenant_resource_events", "deployment_tenant_external_operations", "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs",
    "app_instances", "subscriptions", "deployment_environments", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"];
  const postRoles = ["techlong_cell_cleanup_reader", "techlong_cell_drain"].map(name => {
    const reader = name.endsWith("reader");
    const table = (reader ? ["deployment_environments", "app_instance_deployments", "app_instances", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences",
      "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_cleanup_schedules"] :
      ["deployment_environments", "app_instance_deployments", "deployment_tenant_resources", "deployment_jobs"]).map(t => `public.${t}:SELECT`).sort();
    const column = reader ? [] : [
      ...["admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at"].map(c => `public.deployment_environments.${c}:UPDATE`),
      ...["app_instance_deployments", "deployment_tenant_resources"].map(t => `public.${t}.updated_at:UPDATE`),
      ...["id", "deployment_id", "job_type", "dedupe_key", "status", "payload", "attempts", "max_attempts", "available_at", "created_at", "updated_at"].map(c => `public.deployment_jobs.${c}:INSERT`),
    ].sort();
    return { name, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolcanlogin: false, rolinherit: false, rolreplication: false,
      rolconnlimit: -1, valid_until: null, settings: reader ? ["default_transaction_read_only=on"] : [], memberships: [],
      members: [{ name: "fixture_owner", admin: true, inherit: false, set: false }], database_settings: [], schema_privileges: ["public:USAGE"],
      table_privileges: table, column_privileges: column, owner_member: false, sequence_access: false, nontrigger_definer_access: false, grant_option: false };
  });
  const client: SealedPlanManagementSqlClientV1 = { async query(statement) {
    calls.push(statement);
    if (statement === sql) roles = structuredClone(postRoles);
    return { rows: structuredClone(statement === SEALED_PLAN_MANAGEMENT_SQL_V1.context ? [context] : statement === SEALED_PLAN_MANAGEMENT_SQL_V1.original ? [original] :
      statement === SEALED_PLAN_MANAGEMENT_SQL_V1.tables ? tableNames.map(name => ({ name, owner: "fixture_owner", acl: null, owner_member: true })) :
      statement === SEALED_PLAN_MANAGEMENT_SQL_V1.objects ? ["deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"].map(name => ({ kind: "table", name })) :
      statement === "SELECT * FROM public.deployment_plan_only_isolation_fences WHERE deployment_id=$1" ? [{ deployment_id: original.id, sealed: true, sealed_at: cert.sealed_at, revision: 2 }] :
      statement === "SELECT * FROM public.deployment_plan_only_isolations ORDER BY deployment_id" ? [cert] : statement === SEALED_PLAN_CATALOG_READ_V1 ? [{ live_protection_sha256: cert.protection_schema_sha256 }] :
      statement === CONTROL_ROLE_READ_SQL_V1.management ? [management] : statement === CONTROL_ROLE_READ_SQL_V1.roles ? roles : statement === CONTROL_ROLE_READ_SQL_V1.catalog ? catalog : []) };
  } };
  const binding = { targetFingerprintSha256: "a".repeat(64), codeSha256: "b".repeat(64), certificateSha256: await sha256Hex(cert) };
  const readback = await readSealedControlRoleStateV1(client);
  const review = await compileControlRoleReviewV1({ readback, binding, sql, startedAt: now, now }); calls.length = 0;
  const input = { client, review, binding, sql, approvedSha: review.manifestSha256, now: () => now,
    claimPermanentSlot: async () => undefined, persistConsumedReview: async () => undefined };
  return { client, calls, original, context, cert, management, catalog, binding, readback, review, input, postRoles };
}

test("NOLOGIN review is exact, independent of consumed schema/registration entries, and grants no credentials or cloud activation", async () => {
  const f = await fixture(); await validateControlRoleReviewV1(f.review, f.binding, sql);
  assert.equal(f.review.sqlSha256, await sha256Hex(sql)); assert.equal(f.review.prestateSha256, await sha256Hex(f.readback.state));
  assert.equal(f.review.scope.activatesLogin, false); assert.equal(f.review.scope.createsSecret, false); assert.equal(f.review.scope.changesAws, false);
  assert.equal(f.review.scope.columnGrantsAreNotRowFilters, true); assert.equal(f.review.scope.automaticDownOrWriteRetry, false);
  assert.deepEqual(f.review.scope.creatorAutomaticMembership, { admin: true, inherit: false, set: false }); assert.deepEqual(f.calls, []);
});
test("wrong approval, expiry, code/target/certificate/SQL drift and outer fields fail before connecting a write transaction", async () => {
  const f = await fixture(); let claims = 0;
  const input = { ...f.input, claimPermanentSlot: async () => { claims++; } };
  for (const change of [{ approvedSha: "0".repeat(64) }, { now: () => f.review.expiresAt }, { sql: sql + "-- changed" },
    { binding: { ...f.binding, codeSha256: "0".repeat(64) } }, { binding: { ...f.binding, targetFingerprintSha256: "0".repeat(64) } },
    { binding: { ...f.binding, certificateSha256: "0".repeat(64) } }, { review: { ...f.review, extra: true } }])
    await assert.rejects(runReviewedControlRolesV1({ ...input, ...change }));
  assert.equal(claims, 0); assert.equal(f.calls.length, 0);
});
test("review snapshots caller inputs before awaiting hashes and does not freeze or mutate the caller", async () => {
  const f = await fixture(), readback = structuredClone(f.readback), binding = structuredClone(f.binding);
  const pending = compileControlRoleReviewV1({ readback, binding, sql, startedAt: now, now });
  binding.codeSha256 = "0".repeat(64); readback.state.preserved.sealed.certificates[0].original_row_sha256 = "0".repeat(64);
  const review = await pending;
  assert.equal(review.binding.codeSha256, f.binding.codeSha256); assert.equal(review.prestateSha256, f.readback.stateSha256);
  assert.equal(Object.isFrozen(binding), false); await validateControlRoleReviewV1(review, f.binding, sql);
});
test("live seal, business, catalog, identity and management drift never consume slot or submit SQL", async () => {
  for (const kind of ["business", "catalog", "identity", "management", "cert"] as const) {
    const f = await fixture(); let claims = 0;
    if (kind === "business") f.original.business_state = "changed";
    if (kind === "catalog") f.catalog[0].properties.owner = "changed";
    if (kind === "identity") f.context.database = "changed";
    if (kind === "management") f.management.self_grant = "inherit";
    if (kind === "cert") f.cert.approved_registration_sha256 = "0".repeat(64);
    const result = await runReviewedControlRolesV1({ ...f.input, claimPermanentSlot: async () => { claims++; } });
    assert.equal(result.slotConsumed, false); assert.equal(result.sqlSubmitted, false); assert.equal(claims, 0); assert.equal(f.calls.at(-1), "ROLLBACK");
  }
});
test("one transaction creates roles, preserves seal, and later occupied state cannot submit even with the old approval", async () => {
  const f = await fixture(); let claims = 0;
  const input = { ...f.input, claimPermanentSlot: async () => { claims++; } };
  const result = await runReviewedControlRolesV1(input); assert.equal(result.commitConfirmed, true); assert.equal(claims, 1);
  const after = await readSealedControlRoleStateV1(f.client); assert.equal((await verifyControlRolePoststateV1(after, f.review)).loginActivated, false);
  const retry = await runReviewedControlRolesV1(input); assert.equal(retry.sqlSubmitted, false); assert.equal(claims, 1);
  assert.equal(f.calls.filter(s => s === sql).length, 1);
});
test("broader effective column/table grants, login, memberships, grant options, sequences and definers are rejected", async () => {
  const f = await fixture(); await f.client.query(sql); const after = await readSealedControlRoleStateV1(f.client);
  for (const change of [{ rolcanlogin: true }, { grant_option: true }, { sequence_access: true }, { nontrigger_definer_access: true },
    { memberships: ["neondb_owner"] }, { members: [{ name: "fixture_owner", admin: true, inherit: true, set: true }] },
    { settings: ["default_transaction_read_only=off"] }, { schema_privileges: ["public:CREATE", "public:USAGE"] },
    { table_privileges: ["public.app_instance_deployments:UPDATE"] }, { column_privileges: ["public.app_instance_deployments.status:UPDATE"] }]) {
    const altered = structuredClone(after); Object.assign(altered.state.roles[0], change);
    await assert.rejects(verifyControlRolePoststateV1(altered, f.review));
  }
});
test("lost COMMIT response remains unknown, independently recovered once, and never retries DDL", async () => {
  const f = await fixture(); const client = { async query(statement: string, values?: readonly unknown[]) {
    const result = await f.client.query(statement, values); if (statement === "COMMIT") throw new Error("private-marker"); return result;
  } };
  const result = await runReviewedControlRolesV1({ ...f.input, client });
  assert.equal(result.outcome, "ROLE_COMMIT_OUTCOME_UNKNOWN_READONLY_RECOVERY_ONLY"); assert.equal(result.retryAuthorized, false);
  assert.doesNotMatch(JSON.stringify(result), /private-marker/); assert.equal(f.calls.at(-1), "COMMIT");
  await verifyControlRolePoststateV1(await readSealedControlRoleStateV1(f.client), f.review);
  await runReviewedControlRolesV1({ ...f.input, client }); assert.equal(f.calls.filter(s => s === sql).length, 1);
});
test("slot persistence failure, slot collision, or slow persistence stops before SQL without resetting slot", async () => {
  for (const kind of ["persist", "collision", "slow"] as const) {
    const f = await fixture(); let clock = now;
    const result = await runReviewedControlRolesV1({ ...f.input, now: () => clock,
      claimPermanentSlot: async () => { if (kind === "collision") throw new Error("exists"); },
      persistConsumedReview: async () => { if (kind === "persist") throw new Error("private-marker"); if (kind === "slow") clock += 30_001; } });
    assert.equal(result.sqlSubmitted, false); assert.equal(result.commitConfirmed, false); assert.equal(result.retryAuthorized, false);
    assert.equal(f.calls.includes(sql), false); assert.equal(f.calls.at(-1), "ROLLBACK");
  }
});
test("SQL submission failure rolls back and suppresses raw connection diagnostics", async () => {
  const f = await fixture(); let writes = 0;
  const client = { async query(statement: string, values?: readonly unknown[]) { if (statement === sql) { writes++; throw new Error("postgres://private-marker"); } return f.client.query(statement, values); } };
  const result = await runReviewedControlRolesV1({ ...f.input, client }); assert.equal(result.slotConsumed, true); assert.equal(writes, 1);
  assert.equal(result.commitConfirmed, false); assert.equal(f.calls.at(-1), "ROLLBACK"); assert.doesNotMatch(JSON.stringify(result), /private-marker/);
});
test("post-submission SQL errors retain only bounded stage and SQLSTATE, without messages or automatic retry", async () => {
  const f = await fixture(); let submitted = false;
  const client = { async query(statement: string, values?: readonly unknown[]) {
    if (statement === sql) submitted = true;
    if (submitted && statement === CONTROL_ROLE_READ_SQL_V1.roles) throw Object.assign(new Error("postgres://private-marker"), { code: "42809" });
    return f.client.query(statement, values);
  } };
  const result = await runReviewedControlRolesV1({ ...f.input, client });
  assert("failureStage" in result); assert.equal(result.failureStage, "POSTSTATE_READ"); assert.equal(result.failureCode, "SQLSTATE_42809");
  assert.equal(result.retryAuthorized, false); assert.equal(f.calls.at(-1), "ROLLBACK"); assert.doesNotMatch(JSON.stringify(result), /private-marker/);
});
test("type-specific sequence privilege function is CASE-guarded against optimizer predicate reordering", () => {
  assert.match(CONTROL_ROLE_READ_SQL_V1.roles, /CASE WHEN c\.relkind='S'\s+THEN pg_catalog\.has_sequence_privilege/);
});
test("CLI fixes TLS, production certificate, bounded private files and new permanent slot, without password or AWS writes", () => {
  const cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-f3b3-control-roles.mjs", import.meta.url), "utf8");
  assert.match(cli, /rejectUnauthorized:true/); assert.match(cli, /techlong-f3b3-control-roles-v1-consumed/);
  assert.match(cli, /dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f/);
  assert.match(cli, /BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE/);
  assert.doesNotMatch(cli, /DROP ROLE|DROP OWNED|CreateSecret|DeleteStack|randomBytes|ALTER ROLE.*PASSWORD/);
});
