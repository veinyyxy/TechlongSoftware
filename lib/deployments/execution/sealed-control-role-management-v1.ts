import { canonicalJson, sha256Hex } from "./hash.ts";
import { readSealedPlanManagementStateV1, type SealedPlanManagementSqlClientV1 } from "./sealed-plan-management-v1.ts";

// Deliberately separate from the consumed schema/registration entries and their bytes.
export const CONTROL_ROLE_SQL_SHA256_V1 = "7fc82e392d1745b4e7031a1449d094cd2b327cfaccb459f768e917a4754df016";
export const CONTROL_ROLE_NAMES_V1 = ["techlong_cell_cleanup_reader", "techlong_cell_drain"] as const;
const aliases = [...CONTROL_ROLE_NAMES_V1, "techlong_cell_drain_writer", "techlong_plan_only_registrar"];
const lockedTables = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules",
  "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_tenant_resource_events",
  "deployment_tenant_external_operations", "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs",
  "app_instances", "subscriptions", "deployment_environments", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"];
const digest = /^[a-f0-9]{64}$/;
export interface ControlRoleBindingV1 { targetFingerprintSha256: string; codeSha256: string; certificateSha256: string }
export class ControlRoleManagementErrorV1 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new ControlRoleManagementErrorV1(code); }
function freeze<T>(v: T): T { if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function exact(v: unknown, keys: readonly string[]) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort());
}
function rows(v: unknown): Record<string, unknown>[] {
  const r = (v as { rows?: unknown })?.rows;
  if (!Array.isArray(r) || r.some(x => x === null || typeof x !== "object" || Array.isArray(x))) fail("CONTROL_ROLE_SQL_RESULT_INVALID");
  return r;
}
function one(v: unknown) { const r = rows(v); if (r.length !== 1) fail("CONTROL_ROLE_SQL_ROW_MISSING"); return r[0]; }
function checkBinding(binding: ControlRoleBindingV1) {
  if (!exact(binding, ["targetFingerprintSha256", "codeSha256", "certificateSha256"]) || Object.values(binding).some(v => !digest.test(v)))
    fail("CONTROL_ROLE_BINDING_INVALID");
}
function fresh(observedAt: number, start: number, now: number) {
  if (![observedAt, start, now].every(n => Number.isSafeInteger(n) && n > 0) || now < start || observedAt > now ||
    now - start > 30_000 || now - observedAt > 30_000) fail("CONTROL_ROLE_FRESHNESS_INVALID");
}

export const CONTROL_ROLE_READ_SQL_V1 = Object.freeze({
  management: `SELECT rolname,rolsuper,rolcreaterole,pg_catalog.current_setting('createrole_self_grant') AS self_grant
    FROM pg_catalog.pg_roles WHERE rolname=current_user`,
  // Full effective table/column privileges, including inherited PUBLIC exposure, not just relacl.
  roles: `SELECT r.rolname AS name,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolcanlogin,r.rolinherit,r.rolreplication,
    r.rolconnlimit,r.rolvaliduntil::text AS valid_until,COALESCE(r.rolconfig,ARRAY[]::text[]) AS settings,
    COALESCE((SELECT pg_catalog.jsonb_agg(p.rolname ORDER BY p.rolname) FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid),'[]'::jsonb) AS memberships,
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY p.rolname)
      FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.member WHERE m.roleid=r.oid),'[]'::jsonb) AS members,
    COALESCE((SELECT pg_catalog.jsonb_agg(s.setconfig ORDER BY s.setdatabase) FROM pg_catalog.pg_db_role_setting s
      WHERE s.setrole=r.oid AND s.setdatabase<>0),'[]'::jsonb) AS database_settings,
    COALESCE((SELECT pg_catalog.jsonb_agg(n.nspname||':'||v.p ORDER BY n.nspname,v.p) FROM pg_catalog.pg_namespace n
      CROSS JOIN (VALUES ('USAGE'),('CREATE')) v(p) WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND pg_catalog.has_schema_privilege(r.oid,n.oid,v.p)),'[]'::jsonb) AS schema_privileges,
    COALESCE((SELECT pg_catalog.jsonb_agg(n.nspname||'.'||c.relname||':'||v.p ORDER BY n.nspname,c.relname,v.p)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND pg_catalog.has_table_privilege(r.oid,c.oid,v.p)),'[]'::jsonb) AS table_privileges,
    COALESCE((SELECT pg_catalog.jsonb_agg(n.nspname||'.'||c.relname||'.'||a.attname||':'||v.p ORDER BY n.nspname,c.relname,a.attname,v.p)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(p)
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.attnum>0 AND NOT a.attisdropped
      AND NOT pg_catalog.has_table_privilege(r.oid,c.oid,v.p) AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,v.p)),'[]'::jsonb) AS column_privileges,
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER')) AS owner_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND pg_catalog.has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS sequence_access,
    EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prosecdef AND p.prorettype<>'pg_catalog.trigger'::pg_catalog.regtype
      AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')) AS nontrigger_definer_access,
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND pg_catalog.has_table_privilege(r.oid,c.oid,v.p||' WITH GRANT OPTION')) OR
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(p)
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.attnum>0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,v.p||' WITH GRANT OPTION')) AS grant_option
    FROM pg_catalog.pg_roles r WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname`,
  // Track all non-system relation/column ACLs, default ACLs and schema ACLs. Only the two new grantees are excluded.
  catalog: `SELECT 'relation' AS kind,n.nspname||'.'||c.relname AS name,
    pg_catalog.jsonb_build_object('owner',c.relowner::pg_catalog.regrole::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'acl',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END,
        'grantor',x.grantor::pg_catalog.regrole::text,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantee,x.grantor,x.privilege_type)
        FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
        WHERE x.grantee=0 OR x.grantee::pg_catalog.regrole::text<>ALL($1::text[])),'[]'::jsonb),
      'columns',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'acl',
        COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END,
          'grantor',x.grantor::pg_catalog.regrole::text,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantee,x.grantor,x.privilege_type)
          FROM pg_catalog.aclexplode(a.attacl) x WHERE x.grantee=0 OR x.grantee::pg_catalog.regrole::text<>ALL($1::text[])),'[]'::jsonb)) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb)) AS properties
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    UNION ALL SELECT 'schema',n.nspname,pg_catalog.jsonb_build_object('owner',n.nspowner::pg_catalog.regrole::text,'acl',
      COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END,
        'grantor',x.grantor::pg_catalog.regrole::text,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantee,x.grantor,x.privilege_type)
        FROM pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
        WHERE x.grantee=0 OR x.grantee::pg_catalog.regrole::text<>ALL($1::text[])),'[]'::jsonb))
      FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    UNION ALL SELECT 'function',p.oid::pg_catalog.regprocedure::text,
      pg_catalog.jsonb_build_object('owner',p.proowner::pg_catalog.regrole::text,'acl',p.proacl::text,'definer',p.prosecdef,
        'definitionSha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex'))
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p')
    UNION ALL SELECT 'default_acl',d.oid::text,pg_catalog.to_jsonb(d) FROM pg_catalog.pg_default_acl d
    ORDER BY kind,name`,
});

export async function readSealedControlRoleStateV1(client: SealedPlanManagementSqlClientV1) {
  const sealed = await readSealedPlanManagementStateV1(client);
  const management = one(await client.query(CONTROL_ROLE_READ_SQL_V1.management));
  const roles = rows(await client.query(CONTROL_ROLE_READ_SQL_V1.roles, [aliases]));
  const catalog = rows(await client.query(CONTROL_ROLE_READ_SQL_V1.catalog, [CONTROL_ROLE_NAMES_V1]));
  // Known role ACL additions are separately exhaustively checked; preserve every other observed byte/permission.
  const { roles: _oldRoles, tables, ...sealedRest } = sealed.state;
  void _oldRoles;
  const preserved = { sealed: { ...sealedRest, tables: tables.map(({ acl: _acl, ...table }) => { void _acl; return table; }) }, management, catalog };
  const state = freeze({ preserved, roles });
  return freeze({ state, stateSha256: await sha256Hex(state), preservedSha256: await sha256Hex(preserved),
    observedAt: sealed.observedAt, transaction: sealed.transaction, privatePreimage: sealed.privatePreimage });
}
export type ControlRoleReadbackV1 = Awaited<ReturnType<typeof readSealedControlRoleStateV1>>;
async function assertSeal(read: ControlRoleReadbackV1, binding: ControlRoleBindingV1) {
  const s = read.state.preserved.sealed, e = s.evidence;
  const cert = s.certificates[0];
  if (s.identity.version !== 180006 || s.identity.role !== s.identity.sessionRole || s.identity.replicationRole !== "origin" ||
    read.transaction.searchPath !== "pg_catalog" || read.transaction.isolation !== "serializable" ||
    s.certificates.length !== 1 || !exact(cert, ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256", "original_plan_bytes_sha256",
      "original_plan_hash", "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"]) ||
    await sha256Hex({ ...cert, sealed_at: Number(cert.sealed_at) }) !== binding.certificateSha256 ||
    s.fence?.sealed !== true || Number(s.fence.revision) !== 2 || Number(s.fence.sealed_at) !== Number(cert.sealed_at) ||
    s.protectionSha256 !== cert.protection_schema_sha256 || e.originalRowSha256 !== cert.original_row_sha256 ||
    e.originalPlanBytesSha256 !== cert.original_plan_bytes_sha256 || e.originalPlanHash !== cert.original_plan_hash ||
    e.businessStateSha256 !== cert.business_state_sha256 || e.deploymentId !== cert.deployment_id || e.instanceId !== cert.app_instance_id ||
    e.environmentId !== cert.environment_id || e.mode !== "plan_only" || e.status !== "planned" || e.attempts !== 0 ||
    Object.values(e.executionReferences).some(n => n !== 0) || read.state.preserved.management.rolcreaterole !== true ||
    read.state.preserved.management.rolsuper !== false || read.state.preserved.management.self_grant !== "") fail("CONTROL_ROLE_SEAL_OR_MANAGEMENT_UNPROVED");
}

export const CONTROL_ROLE_SCOPE_V1 = freeze({
  roles: [...CONTROL_ROLE_NAMES_V1], initialNoLogin: true, readerSelectTables: 8, drainSelectTables: 4,
  drainAdmissionUpdateColumns: 7, drainQueueInsertColumns: 11,
  drainTimestampUpdateColumns: ["app_instance_deployments.updated_at", "deployment_tenant_resources.updated_at"],
  columnGrantsAreNotRowFilters: true,
  creatorAutomaticMembership: { admin: true, inherit: false, set: false },
  generatesPasswords: false, activatesLogin: false, createsSecret: false, changesBusinessRows: false,
  changesExistingRolesOrPublicPrivileges: false, changesAws: false, registersMigration: false, runtimeEnabled: false,
  automaticDownOrWriteRetry: false, permanentLocalSlot: "techlong-f3b3-control-roles-v1-consumed",
});
export interface ControlRoleReviewV1 {
  schemaVersion: 1; protocol: "sealed-control-role-installation-v1"; binding: ControlRoleBindingV1;
  reviewedAt: number; expiresAt: number; sqlSha256: string; prestateSha256: string; preservedSha256: string;
  reviewedState: ControlRoleReadbackV1["state"]; scope: typeof CONTROL_ROLE_SCOPE_V1; manifestSha256: string;
}
export async function compileControlRoleReviewV1(input: { readback: ControlRoleReadbackV1; binding: ControlRoleBindingV1; sql: string; startedAt: number; now: number }) {
  input = { ...input, readback: freeze(structuredClone(input.readback)), binding: freeze(structuredClone(input.binding)) };
  checkBinding(input.binding); fresh(input.readback.observedAt, input.startedAt, input.now);
  if (await sha256Hex(input.sql) !== CONTROL_ROLE_SQL_SHA256_V1 || input.readback.transaction.readOnly !== "on" ||
    input.readback.transaction.deferrable !== "on" || input.readback.state.roles.length !== 0 ||
    await sha256Hex(input.readback.state) !== input.readback.stateSha256 ||
    await sha256Hex(input.readback.state.preserved) !== input.readback.preservedSha256) fail("CONTROL_ROLE_REVIEW_PRESTATE_INVALID");
  await assertSeal(input.readback, input.binding);
  const body = { schemaVersion: 1 as const, protocol: "sealed-control-role-installation-v1" as const, binding: input.binding,
    reviewedAt: input.now, expiresAt: input.now + 3_600_000, sqlSha256: CONTROL_ROLE_SQL_SHA256_V1,
    prestateSha256: input.readback.stateSha256, preservedSha256: input.readback.preservedSha256, reviewedState: input.readback.state, scope: CONTROL_ROLE_SCOPE_V1 };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function validateControlRoleReviewV1(review: ControlRoleReviewV1, binding: ControlRoleBindingV1, sql: string) {
  checkBinding(binding);
  if (!exact(review, ["schemaVersion", "protocol", "binding", "reviewedAt", "expiresAt", "sqlSha256", "prestateSha256", "preservedSha256", "reviewedState", "scope", "manifestSha256"]))
    fail("CONTROL_ROLE_MANIFEST_SHAPE_INVALID");
  const { manifestSha256, ...body } = review;
  if (review.schemaVersion !== 1 || review.protocol !== "sealed-control-role-installation-v1" || !digest.test(manifestSha256) ||
    await sha256Hex(body) !== manifestSha256 || canonicalJson(binding) !== canonicalJson(review.binding) ||
    canonicalJson(review.scope) !== canonicalJson(CONTROL_ROLE_SCOPE_V1) || review.sqlSha256 !== CONTROL_ROLE_SQL_SHA256_V1 ||
    await sha256Hex(sql) !== CONTROL_ROLE_SQL_SHA256_V1 || await sha256Hex(review.reviewedState) !== review.prestateSha256 ||
    await sha256Hex(review.reviewedState.preserved) !== review.preservedSha256 || review.reviewedState.roles.length !== 0 ||
    !Number.isSafeInteger(review.reviewedAt) || review.reviewedAt <= 0 || review.expiresAt - review.reviewedAt !== 3_600_000)
    fail("CONTROL_ROLE_MANIFEST_BINDING_INVALID");
  await assertSeal({ state: review.reviewedState, stateSha256: review.prestateSha256, preservedSha256: review.preservedSha256,
    observedAt: review.reviewedAt, transaction: { readOnly: "on", isolation: "serializable", deferrable: "on", searchPath: "pg_catalog" },
    privatePreimage: { originalRow: "", businessState: "" } }, binding);
}
export async function validateControlRoleApprovalV1(review: ControlRoleReviewV1, approvedSha: string, binding: ControlRoleBindingV1, sql: string, now: number) {
  await validateControlRoleReviewV1(review, binding, sql);
  if (approvedSha !== review.manifestSha256 || !digest.test(approvedSha) || !Number.isSafeInteger(now) || now < review.reviewedAt || now >= review.expiresAt)
    fail("CONTROL_ROLE_APPROVAL_OR_WINDOW_INVALID");
}

function expectedPrivileges(role: string) {
  const reader = role === CONTROL_ROLE_NAMES_V1[0];
  const tableNames = reader ? ["deployment_environments", "app_instance_deployments", "app_instances", "deployment_plan_only_isolations",
    "deployment_plan_only_isolation_fences", "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_cleanup_schedules"] :
    ["deployment_environments", "app_instance_deployments", "deployment_tenant_resources", "deployment_jobs"];
  const table = tableNames.map(t => `public.${t}:SELECT`).sort();
  const column = reader ? [] : [
    ...["admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at"]
      .map(c => `public.deployment_environments.${c}:UPDATE`),
    ...["app_instance_deployments", "deployment_tenant_resources"].map(t => `public.${t}.updated_at:UPDATE`),
    ...["id", "deployment_id", "job_type", "dedupe_key", "status", "payload", "attempts", "max_attempts", "available_at", "created_at", "updated_at"].map(c => `public.deployment_jobs.${c}:INSERT`),
  ].sort();
  return { table, column };
}
export async function verifyControlRolePoststateV1(read: ControlRoleReadbackV1, review: ControlRoleReviewV1) {
  await assertSeal(read, review.binding);
  if (read.preservedSha256 !== review.preservedSha256 || await sha256Hex(read.state.preserved) !== review.preservedSha256 ||
    read.state.roles.length !== 2) fail("CONTROL_ROLE_PRESERVED_STATE_DRIFT");
  for (const name of CONTROL_ROLE_NAMES_V1) {
    const role = read.state.roles.find(r => r.name === name), permissions = expectedPrivileges(name);
    if (!role || ["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls", "rolcanlogin", "rolinherit", "rolreplication", "owner_member", "sequence_access", "nontrigger_definer_access", "grant_option"].some(k => role[k] !== false) ||
      role.rolconnlimit !== -1 || role.valid_until !== null || canonicalJson(role.memberships) !== "[]" || canonicalJson(role.database_settings) !== "[]" ||
      canonicalJson(role.settings) !== canonicalJson(name === CONTROL_ROLE_NAMES_V1[0] ? ["default_transaction_read_only=on"] : []) ||
      canonicalJson(role.members) !== canonicalJson([{ name: read.state.preserved.sealed.identity.role, admin: true, inherit: false, set: false }]) ||
      canonicalJson(role.schema_privileges) !== canonicalJson(["public:USAGE"]) ||
      canonicalJson(role.table_privileges) !== canonicalJson(permissions.table) || canonicalJson(role.column_privileges) !== canonicalJson(permissions.column))
      fail("CONTROL_ROLE_EXACT_PRIVILEGES_UNPROVED");
  }
  return freeze({ outcome: "TWO_EXACT_NOLOGIN_CONTROL_ROLES_INDEPENDENTLY_VERIFIED", stateSha256: read.stateSha256,
    preservedSha256: read.preservedSha256, certificateSha256: review.binding.certificateSha256, loginActivated: false, credentialsGenerated: false,
    secretCreated: false, awsMutationPerformed: false, runtimeEnabled: false, retryAuthorized: false });
}

// Catalog/role DDL is transactional, but a COMMIT response can still be lost. Never submit it twice.
export async function runReviewedControlRolesV1(input: { client: SealedPlanManagementSqlClientV1; review: ControlRoleReviewV1;
  approvedSha: string; binding: ControlRoleBindingV1; sql: string; now: () => number;
  claimPermanentSlot: () => Promise<void>; persistConsumedReview: () => Promise<void> }) {
  const review = freeze(JSON.parse(canonicalJson(input.review)) as ControlRoleReviewV1);
  await validateControlRoleApprovalV1(review, input.approvedSha, input.binding, input.sql, input.now());
  let transaction = false, slotConsumed = false, commitAttempted = false, sqlSubmitted = false;
  try {
    await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); transaction = true;
    await input.client.query("SET LOCAL search_path=pg_catalog");
    await input.client.query("SET LOCAL lock_timeout='5s'");
    await input.client.query("SET LOCAL statement_timeout='30s'");
    // No catalog table write/lock bypass. CREATE ROLE's uniqueness is the concurrent-creator fence.
    const tables = lockedTables.map(name => `public.${name}`).sort();
    await input.client.query(`LOCK TABLE ${tables.join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const start = input.now(), before = await readSealedControlRoleStateV1(input.client);
    fresh(before.observedAt, start, input.now()); await assertSeal(before, input.binding);
    if (before.stateSha256 !== review.prestateSha256) fail("CONTROL_ROLE_PRESTATE_DRIFT_NO_WRITE");
    await validateControlRoleApprovalV1(review, input.approvedSha, input.binding, input.sql, input.now());
    await input.claimPermanentSlot(); slotConsumed = true; await input.persistConsumedReview();
    fresh(before.observedAt, start, input.now());
    await validateControlRoleApprovalV1(review, input.approvedSha, input.binding, input.sql, input.now());
    sqlSubmitted = true; await input.client.query(input.sql);
    const after = await readSealedControlRoleStateV1(input.client);
    await verifyControlRolePoststateV1(after, review); fresh(after.observedAt, start, input.now());
    await validateControlRoleApprovalV1(review, input.approvedSha, input.binding, input.sql, input.now());
    commitAttempted = true; await input.client.query("COMMIT"); transaction = false;
    return freeze({ outcome: "ROLE_COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_READBACK", slotConsumed, sqlSubmitted,
      commitConfirmed: true, failureCode: null, retryAuthorized: false, runtimeEnabled: false });
  } catch (error) {
    if (transaction && !commitAttempted) await input.client.query("ROLLBACK").catch(() => undefined);
    return freeze({ outcome: commitAttempted ? "ROLE_COMMIT_OUTCOME_UNKNOWN_READONLY_RECOVERY_ONLY" : "ROLE_STOPPED_NO_COMMIT_READONLY_INSPECT",
      slotConsumed, sqlSubmitted, commitConfirmed: false,
      failureCode: error instanceof ControlRoleManagementErrorV1 ? error.code : "CONTROL_ROLE_SUBMISSION_NOT_VERIFIED",
      retryAuthorized: false, runtimeEnabled: false });
  }
}
