import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SEALED_PLAN_MANAGEMENT_SQL_V1 } from "../../lib/deployments/execution/sealed-plan-management-v1.ts";
import { SEALED_PLAN_CATALOG_READ_V1 } from "../../lib/deployments/execution/sealed-plan-catalog-read-v1.ts";
import { CONTROL_ROLE_READ_SQL_V1, readSealedControlRoleStateV1, compileControlRoleReviewV1 } from "../../lib/deployments/execution/sealed-control-role-management-v1.ts";
import { compileControlCredentialReviewV1, type ControlCredentialBootstrapPortsV1, type ControlCredentialSecretReadV1 } from "../../lib/deployments/execution/control-credential-bootstrap-v1.ts";

export const fixtureNow = Date.parse("2026-10-08T22:00:00Z");
export const roleSql = readFileSync(new URL("../../ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
export async function credentialFixture() {
  const now = fixtureNow, calls: string[] = [], markers: { name: string; value: Record<string, unknown> }[] = [];
  const original = { original_row: '{}', desired_plan: '{"safety":{"applyEnabled":false,"createsAwsResources":false,"storesSecretValues":false}}',
    plan_hash: "1".repeat(64), id: "dep_d00144511731f1c20991aa56", app_instance_id: "app_fb1962e93a9a4cc2acf046170593d9e3", environment_id: "env_aws_sandbox_ca_central_1",
    mode: "plan_only", status: "planned", cell_key: "cell-demo-1", attempts: 0, instance_status: "pending", subscription_status: "active", business_state: '{}',
    siblings: 1, jobs: 0, steps: 0, schedules: 0, capacity: 0, resources: 0, resource_events: 0, operations: 0, operation_events: 0, cleanup_runs: 0 };
  const context = { database: "fixture", role: "fixture_owner", session_role: "fixture_owner", version: "180006", replication_role: "origin", can_create_public: true,
    read_only: "on", isolation: "serializable", deferrable: "on", search_path: "pg_catalog", observed_at: now };
  const cert = { deployment_id: original.id, environment_id: original.environment_id, app_instance_id: original.app_instance_id,
    original_row_sha256: await sha256Hex(original.original_row), original_plan_bytes_sha256: await sha256Hex(original.desired_plan), original_plan_hash: original.plan_hash,
    business_state_sha256: await sha256Hex(original.business_state), approved_registration_sha256: "2".repeat(64), protection_schema_sha256: "3".repeat(64), sealed_at: now - 60_000 };
  const roles: Record<string, unknown>[] = [], activeRoles = ["techlong_cell_cleanup_reader", "techlong_cell_drain"].map((name, i) => {
    const tables = i === 0 ? ["deployment_environments", "app_instance_deployments", "app_instances", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences",
      "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_cleanup_schedules"] : ["deployment_environments", "app_instance_deployments", "deployment_tenant_resources", "deployment_jobs"];
    const columns = i === 0 ? [] : [
      ...["admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at"].map(c => `public.deployment_environments.${c}:UPDATE`),
      ...["app_instance_deployments", "deployment_tenant_resources"].map(t => `public.${t}.updated_at:UPDATE`),
      ...["id", "deployment_id", "job_type", "dedupe_key", "status", "payload", "attempts", "max_attempts", "available_at", "created_at", "updated_at"].map(c => `public.deployment_jobs.${c}:INSERT`)].sort();
    return { name, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolcanlogin: false, rolinherit: false, rolreplication: false,
      rolconnlimit: -1, valid_until: null, settings: i === 0 ? ["default_transaction_read_only=on"] : [], memberships: [],
      members: [{ name: "fixture_owner", admin: true, inherit: false, set: false }], database_settings: [], schema_privileges: ["public:USAGE"],
      table_privileges: tables.map(t => `public.${t}:SELECT`).sort(), column_privileges: columns, owner_member: false, sequence_access: false, nontrigger_definer_access: false, grant_option: false };
  });
  let transactionRoles: Record<string, unknown>[] | null = null;
  const client = { async query(statement: string) {
    calls.push(statement);
    if (statement === "BEGIN ISOLATION LEVEL SERIALIZABLE") transactionRoles = structuredClone(roles);
    if (statement === "ROLLBACK" && transactionRoles) { roles.splice(0, roles.length, ...transactionRoles); transactionRoles = null; }
    if (statement === "COMMIT") transactionRoles = null;
    if (statement.startsWith("ALTER ROLE ")) { const name = statement.split(" ")[2]; roles.find(r => r.name === name)!.rolcanlogin = true; }
    return { rows: structuredClone(statement === SEALED_PLAN_MANAGEMENT_SQL_V1.context ? [context] : statement === SEALED_PLAN_MANAGEMENT_SQL_V1.original ? [original] :
      statement === SEALED_PLAN_MANAGEMENT_SQL_V1.tables ? [{ name: "app_instance_deployments", owner: "fixture_owner", acl: null, owner_member: true }] :
      statement === SEALED_PLAN_MANAGEMENT_SQL_V1.objects ? ["deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"].map(name => ({ kind: "table", name })) :
      statement === "SELECT * FROM public.deployment_plan_only_isolation_fences WHERE deployment_id=$1" ? [{ deployment_id: original.id, sealed: true, sealed_at: cert.sealed_at, revision: 2 }] :
      statement === "SELECT * FROM public.deployment_plan_only_isolations ORDER BY deployment_id" ? [cert] : statement === SEALED_PLAN_CATALOG_READ_V1 ? [{ live_protection_sha256: cert.protection_schema_sha256 }] :
      statement === CONTROL_ROLE_READ_SQL_V1.management ? [{ rolname: "fixture_owner", rolsuper: false, rolcreaterole: true, self_grant: "" }] :
      statement === CONTROL_ROLE_READ_SQL_V1.roles ? roles : statement === CONTROL_ROLE_READ_SQL_V1.catalog ? [] : []) };
  }, async end() { return undefined; } };
  const priorBinding = { targetFingerprintSha256: "a".repeat(64), codeSha256: "b".repeat(64), certificateSha256: await sha256Hex(cert) };
  const readback = await readSealedControlRoleStateV1(client);
  const roleReview = await compileControlRoleReviewV1({ readback, binding: priorBinding, sql: roleSql, startedAt: now, now });
  roles.push(...structuredClone(activeRoles));
  const endpoint = { host: "fixture.neon.tech", database: "fixture", port: 5432 as const }, binding = { ...priorBinding, codeSha256: "c".repeat(64) };
  const readDb = () => readSealedControlRoleStateV1(client);
  const readAwsAbsent = async () => ({ account: "402010193138" as const, arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" as const,
    secrets: ["techlong/sandbox/cell-cleanup-readonly-v3", "techlong/sandbox/cell-drain-control"].map(name => ({ name, state: "ABSENT" as const })), observedAt: now });
  const manifest = await compileControlCredentialReviewV1({ binding, roleReview, roleSql, read: await readDb(), aws: await readAwsAbsent(), endpoint,
    secretVersionIds: [randomUUID(), randomUUID()], price: { region: "ca-central-1", currency: "USD", perSecretMonthUsd: 0.4, perApiCallUsd: 0.000005, publicFeedSha256: "d".repeat(64) },
    startedAt: now, now });
  calls.length = 0;
  const secrets = new Map<string, ControlCredentialSecretReadV1>(), counts = { claims: 0, creates: 0 };
  const ports: ControlCredentialBootstrapPortsV1 = { now: () => now, readDb, readAwsAbsent, openDb: async () => client,
    claimSlot: async () => { counts.claims++; }, saveMarker: async (name, value) => { markers.push({ name, value }); },
    createSecret: async r => { counts.creates++; const arn = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${r.Name}-Ab1Cd2`;
      secrets.set(r.Name, { name: r.Name, arn, versionId: r.ClientRequestToken, stages: ["AWSCURRENT"], tags: r.Tags, onlyInitialVersion: true,
        rotationDisabled: true, noReplicaOrResourcePolicy: true, secretString: r.SecretString }); return { ARN: arn, Name: r.Name, VersionId: r.ClientRequestToken }; },
    readSecret: async i => [...secrets.values()][i],
  };
  return { client, calls, roles, cert, context, binding, endpoint, manifest, ports, secrets, counts, markers,
    input: { manifest, approvedSha: manifest.manifestSha256, binding, roleSql, endpoint, ports } };
}
