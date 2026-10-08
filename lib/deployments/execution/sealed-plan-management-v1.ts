import { canonicalJson, sha256Hex } from "./hash.ts";
import { SEALED_PLAN_CATALOG_READ_V1 } from "./sealed-plan-catalog-read-v1.ts";

export const SEALED_PLAN_SQL_SHA256_V1 = "c088d1a8c75705c88d3f2bfc38cc6070c731de4cac6cd891c91af821a4e3a57a";
const target = "dep_d00144511731f1c20991aa56";
const instance = "app_fb1962e93a9a4cc2acf046170593d9e3";
const environment = "env_aws_sandbox_ca_central_1";
const digest = /^[a-f0-9]{64}$/;
const names = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules",
  "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_tenant_resource_events",
  "deployment_tenant_external_operations", "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs"];
const functions = ["sealed_plan_protection_hash_v1", "touch_sealed_plan_fence_v1", "guard_sealed_plan_fence_v1",
  "guard_sealed_plan_deployment_v1", "guard_sealed_plan_reference_v1", "validate_sealed_plan_registration_v1",
  "finalize_sealed_plan_registration_v1", "reject_sealed_plan_mutation_v1"];
const beforeReferences = ["deployment_jobs.deployment_id", "deployment_step_runs.deployment_id", "deployment_cleanup_schedules.deployment_id",
  "deployment_environment_capacity_reservations.deployment_id", "deployment_tenant_resources.owner_deployment_id",
  "deployment_tenant_resources.created_by_deployment_id", "deployment_tenant_resource_events.deployment_id",
  "deployment_tenant_external_operations.owner_deployment_id", "deployment_tenant_external_operation_events.deployment_id",
  "deployment_tenant_cleanup_runs.owner_deployment_id"].map(n => `public.${n}`).sort();

export interface SealedPlanManagementSqlClientV1 { query(sql: string, values?: readonly unknown[]): Promise<unknown> }
export interface SealedPlanManagementBindingV1 { targetFingerprintSha256: string; managementCodeSha256: string }
export type SealedPlanManagementPhaseV1 = "install" | "register";
export class SealedPlanManagementErrorV1 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new SealedPlanManagementErrorV1(code); }
function freeze<T>(v: T): T { if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function exact(v: unknown, keys: readonly string[]): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort());
}
function rows(v: unknown): Record<string, unknown>[] {
  const r = (v as { rows?: unknown })?.rows;
  if (!Array.isArray(r) || r.some(x => x === null || typeof x !== "object" || Array.isArray(x))) fail("SEALED_MANAGEMENT_RESULT_INVALID");
  return r;
}
function one(v: unknown) { const r = rows(v); if (r.length !== 1) fail("SEALED_MANAGEMENT_EXACT_ROW_MISSING"); return r[0]; }
function numeric(v: unknown): number {
  if (typeof v === "string" && !/^(0|[1-9][0-9]*)$/.test(v)) fail("SEALED_MANAGEMENT_INTEGER_INVALID");
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) fail("SEALED_MANAGEMENT_INTEGER_INVALID"); return n;
}
function checkBinding(v: SealedPlanManagementBindingV1) {
  if (!exact(v, ["targetFingerprintSha256", "managementCodeSha256"]) ||
    !digest.test(v.targetFingerprintSha256) || !digest.test(v.managementCodeSha256)) fail("SEALED_MANAGEMENT_BINDING_INVALID");
}
function freshTime(observedAt: number, startedAt: number, now: number) {
  if (!Number.isSafeInteger(now) || now <= 0 || now < startedAt || now - startedAt > 30_000 || observedAt > now || now - observedAt > 30_000)
    fail("SEALED_MANAGEMENT_CLOCK_OR_FRESHNESS_INVALID");
}

export const SEALED_PLAN_MANAGEMENT_SQL_V1 = Object.freeze({
  context: `SELECT current_database() AS database,current_user AS role,session_user AS session_role,
    pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_setting('session_replication_role') AS replication_role,
    pg_catalog.current_setting('transaction_read_only') AS read_only,pg_catalog.current_setting('transaction_isolation') AS isolation,
    pg_catalog.current_setting('transaction_deferrable') AS deferrable,pg_catalog.current_setting('search_path') AS search_path,
    (extract(epoch FROM transaction_timestamp())*1000)::bigint AS observed_at,
    pg_catalog.has_schema_privilege(current_user,'public','CREATE') AS can_create_public`,
  original: `SELECT pg_catalog.to_jsonb(d)::text AS original_row,d.desired_plan,d.plan_hash,d.id,d.app_instance_id,d.environment_id,
    d.mode,d.status,d.cell_key,d.attempts,i.status AS instance_status,s.status AS subscription_status,
    pg_catalog.jsonb_build_object('instanceId',i.id,'instanceStatus',i.status,'instanceUpdatedAt',i.updated_at,
      'subscriptionId',s.id,'subscriptionStatus',s.status)::text AS business_state,
    (SELECT count(*) FROM public.app_instance_deployments x WHERE x.app_instance_id=d.app_instance_id) AS siblings,
    (SELECT count(*) FROM public.deployment_jobs x WHERE x.deployment_id=d.id) AS jobs,
    (SELECT count(*) FROM public.deployment_step_runs x WHERE x.deployment_id=d.id) AS steps,
    (SELECT count(*) FROM public.deployment_cleanup_schedules x WHERE x.deployment_id=d.id) AS schedules,
    (SELECT count(*) FROM public.deployment_environment_capacity_reservations x WHERE x.deployment_id=d.id) AS capacity,
    (SELECT count(*) FROM public.deployment_tenant_resources x WHERE x.owner_deployment_id=d.id OR x.created_by_deployment_id=d.id OR x.app_instance_id=d.app_instance_id) AS resources,
    (SELECT count(*) FROM public.deployment_tenant_resource_events x WHERE x.deployment_id=d.id) AS resource_events,
    (SELECT count(*) FROM public.deployment_tenant_external_operations x WHERE x.owner_deployment_id=d.id) AS operations,
    (SELECT count(*) FROM public.deployment_tenant_external_operation_events x WHERE x.deployment_id=d.id) AS operation_events,
    (SELECT count(*) FROM public.deployment_tenant_cleanup_runs x WHERE x.owner_deployment_id=d.id) AS cleanup_runs
    FROM public.app_instance_deployments d JOIN public.app_instances i ON i.id=d.app_instance_id
    LEFT JOIN public.subscriptions s ON s.id=d.subscription_id WHERE d.id=$1`,
  tables: `SELECT c.relname AS name,n.nspname AS schema,c.relowner::pg_catalog.regrole::text AS owner,c.relacl::text AS acl,
    c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER') AS owner_member,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'collation',a.attcollation::pg_catalog.regcollation::text) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(k.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(k.indexrelid)) FROM pg_catalog.pg_index k WHERE k.indrelid=c.oid) AS indexes,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid),
      'function',pg_catalog.pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
    AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
  references: `SELECT n.nspname||'.'||c.relname||'.'||a.attname AS reference FROM pg_catalog.pg_constraint f
    JOIN pg_catalog.pg_class c ON c.oid=f.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.unnest(f.conkey) k(attnum) JOIN pg_catalog.pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum
    WHERE f.contype='f' AND f.confrelid='public.app_instance_deployments'::pg_catalog.regclass ORDER BY reference`,
  objects: `SELECT 'table' AS kind,c.relname AS name,NULL::text AS detail,c.relowner::pg_catalog.regrole::text AS owner,NULL::jsonb AS properties
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('deployment_plan_only_isolations','deployment_plan_only_isolation_fences')
    UNION ALL SELECT 'function',p.proname,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex'),p.proowner::pg_catalog.regrole::text,
      pg_catalog.jsonb_build_object('language',l.lanname,'definer',p.prosecdef,'config',p.proconfig,'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
       'returns',pg_catalog.format_type(p.prorettype,NULL),'publicExecute',EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=ANY($1::text[])
    UNION ALL SELECT 'trigger',t.tgname,t.tgenabled::text,c.relowner::pg_catalog.regrole::text,
      pg_catalog.jsonb_build_object('table',c.relname,'function',p.proname,'type',t.tgtype,'arguments',pg_catalog.encode(t.tgargs,'hex'))
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'aa_sealed_plan_%_v1'
    ORDER BY kind,name`,
  roles: `SELECT r.rolname AS name,r.rolsuper AS super,r.rolcreatedb AS create_db,r.rolcreaterole AS create_role,r.rolbypassrls AS bypass_rls,r.rolcanlogin AS login,
    pg_catalog.has_schema_privilege(r.oid,'public','CREATE') AS create_public,
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
     AND (pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER') OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))) AS any_public_owner_or_write,
    (SELECT pg_catalog.jsonb_agg(c.relname ORDER BY c.relname) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT')) AS readable_tables
    FROM pg_catalog.pg_roles r WHERE r.rolname IN ('techlong_cell_cleanup_reader','techlong_cell_drain_writer','techlong_plan_only_registrar') ORDER BY r.rolname`,
});

/** Runs inside the caller's pinned transaction. No management helper is executed. */
export async function readSealedPlanManagementStateV1(client: SealedPlanManagementSqlClientV1) {
  const context = one(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.context));
  const original = one(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.original, [target]));
  const tables = rows(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.tables, [[...names, "app_instances", "subscriptions", "deployment_environments",
    "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"]]));
  const references = rows(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.references)).map(r => r.reference);
  const objects = rows(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.objects, [functions]));
  const roles = rows(await client.query(SEALED_PLAN_MANAGEMENT_SQL_V1.roles));
  let fence: Record<string, unknown> | null = null, certificates: Record<string, unknown>[] = [], protectionSha256: string | null = null;
  if (objects.some(r => r.kind === "table" && r.name === "deployment_plan_only_isolations") &&
    objects.some(r => r.kind === "table" && r.name === "deployment_plan_only_isolation_fences")) {
    fence = one(await client.query("SELECT * FROM public.deployment_plan_only_isolation_fences WHERE deployment_id=$1", [target]));
    certificates = rows(await client.query("SELECT * FROM public.deployment_plan_only_isolations ORDER BY deployment_id"));
    protectionSha256 = String(one(await client.query(SEALED_PLAN_CATALOG_READ_V1)).live_protection_sha256);
  }
  const observedAt = numeric(context.observed_at);
  const identity = { database: context.database, role: context.role, sessionRole: context.session_role, version: numeric(context.version),
    replicationRole: context.replication_role, canCreatePublic: context.can_create_public };
  const originalRow = String(original.original_row), businessState = String(original.business_state);
  const originalPlan = JSON.parse(String(original.desired_plan)) as { safety?: Record<string, unknown> };
  const evidence = {
    deploymentId: original.id, instanceId: original.app_instance_id, environmentId: original.environment_id,
    mode: original.mode, status: original.status, cellKey: original.cell_key, attempts: numeric(original.attempts),
    instanceStatus: original.instance_status, subscriptionStatus: original.subscription_status,
    originalRowSha256: await sha256Hex(originalRow), originalPlanBytesSha256: await sha256Hex(String(original.desired_plan)),
    originalPlanHash: original.plan_hash, businessStateSha256: await sha256Hex(businessState), safety: originalPlan.safety,
    siblings: numeric(original.siblings), executionReferences: Object.fromEntries(["jobs", "steps", "schedules", "capacity", "resources",
      "resource_events", "operations", "operation_events", "cleanup_runs"].map(k => [k, numeric(original[k])])),
  };
  const state = freeze({ identity, evidence, tables, references, objects, roles, fence, certificates, protectionSha256 });
  return freeze({ state, stateSha256: await sha256Hex(state), observedAt, transaction: {
    readOnly: context.read_only, isolation: context.isolation, deferrable: context.deferrable, searchPath: context.search_path },
    privatePreimage: { originalRow, businessState } });
}
export type SealedPlanManagementReadbackV1 = Awaited<ReturnType<typeof readSealedPlanManagementStateV1>>;

function assertOriginal(read: SealedPlanManagementReadbackV1) {
  const { identity, evidence: e, tables } = read.state;
  if (identity.version !== 180006 || identity.role !== identity.sessionRole || identity.replicationRole !== "origin" ||
    read.transaction.isolation !== "serializable" || read.transaction.searchPath !== "pg_catalog" ||
    e.deploymentId !== target || e.instanceId !== instance || e.environmentId !== environment || e.mode !== "plan_only" || e.status !== "planned" ||
    e.cellKey !== "cell-demo-1" || e.attempts !== 0 || e.siblings !== 1 || !digest.test(String(e.originalPlanHash)) ||
    !["pending", "active"].includes(String(e.instanceStatus)) || e.subscriptionStatus !== "active" ||
    !exact(e.safety, ["applyEnabled", "createsAwsResources", "storesSecretValues"]) || Object.values(e.safety ?? {}).some(v => v !== false) ||
    Object.values(e.executionReferences).some(n => n !== 0) || names.some(n => !tables.some(t => t.name === n && t.owner_member === true)))
    fail("SEALED_MANAGEMENT_PRESTATE_NOT_ELIGIBLE");
  const old = tables.find(t => t.name === "app_instance_deployments");
  const trigger = (old?.triggers as Record<string, unknown>[] | undefined)?.find(t => t.name === "app_instance_deployments_admission_reopen_fence");
  if (!trigger || !["O", "A"].includes(String(trigger.enabled)) || !String(trigger.function).includes("deployment application instance and environment are immutable"))
    fail("SEALED_MANAGEMENT_OLD_TRIGGER_UNPROVED");
}
function assertInstalled(read: SealedPlanManagementReadbackV1, sql: string) {
  const { objects, references, fence, protectionSha256 } = read.state;
  if (objects.length !== 26 || objects.filter(o => o.kind === "table").length !== 2 ||
    objects.filter(o => o.kind === "trigger").length !== 16 || objects.some(o => o.kind === "trigger" && o.detail !== "A") ||
    canonicalJson(references) !== canonicalJson([...beforeReferences, "public.deployment_plan_only_isolations.deployment_id",
      "public.deployment_plan_only_isolation_fences.deployment_id"].sort()) || !fence || fence.deployment_id !== target || !digest.test(protectionSha256 ?? ""))
    fail("SEALED_MANAGEMENT_INSTALLED_GUARDS_INVALID");
  for (const name of functions) {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1];
    if (!body || objects.filter(o => o.kind === "function" && o.name === name).length !== 1) fail("SEALED_MANAGEMENT_FUNCTION_INVALID");
  }
  const expectedTriggers: Record<string, unknown>[] = [
    { name: "aa_sealed_plan_deployment_write_v1", table: "app_instance_deployments", function: "guard_sealed_plan_deployment_v1", type: 31, arguments: "" },
    ...names.slice(1).map(table => ({ name: `aa_sealed_plan_${table}_v1`, table, function: "guard_sealed_plan_reference_v1", type: 23,
      arguments: Array.from(new TextEncoder().encode(table === "deployment_tenant_resources" ? "owner_deployment_id\0created_by_deployment_id\0" :
        table === "deployment_tenant_external_operations" || table === "deployment_tenant_cleanup_runs" ? "owner_deployment_id\0\0" : "deployment_id\0\0"))
        .map(b => b.toString(16).padStart(2, "0")).join("") })),
    { name: "aa_sealed_plan_registry_insert_v1", table: "deployment_plan_only_isolations", function: "validate_sealed_plan_registration_v1", type: 7, arguments: "" },
    { name: "aa_sealed_plan_registry_finalize_v1", table: "deployment_plan_only_isolations", function: "finalize_sealed_plan_registration_v1", type: 5, arguments: "" },
    { name: "aa_sealed_plan_registry_immutable_v1", table: "deployment_plan_only_isolations", function: "reject_sealed_plan_mutation_v1", type: 27, arguments: "" },
    { name: "aa_sealed_plan_registry_truncate_v1", table: "deployment_plan_only_isolations", function: "reject_sealed_plan_mutation_v1", type: 34, arguments: "" },
    { name: "aa_sealed_plan_internal_fence_write_v1", table: "deployment_plan_only_isolation_fences", function: "guard_sealed_plan_fence_v1", type: 27, arguments: "" },
    { name: "aa_sealed_plan_internal_fence_truncate_v1", table: "deployment_plan_only_isolation_fences", function: "reject_sealed_plan_mutation_v1", type: 34, arguments: "" },
  ];
  for (const { name, ...properties } of expectedTriggers) {
    const matching = objects.filter(o => o.kind === "trigger" && o.name === name);
    if (matching.length !== 1 || canonicalJson(matching[0].properties) !== canonicalJson(properties)) fail("SEALED_MANAGEMENT_TRIGGER_PROFILE_INVALID");
  }
}
async function assertFunctionBodies(read: SealedPlanManagementReadbackV1, sql: string) {
  for (const name of functions) {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`))![1];
    const fn = read.state.objects.find(o => o.kind === "function" && o.name === name);
    const signature = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\(([^)]*)\\) RETURNS (text|void|trigger)`))!;
    if (fn?.detail !== await sha256Hex(body) || canonicalJson(fn.properties) !== canonicalJson({ language: "plpgsql", definer: true,
      config: ["search_path=pg_catalog"], arguments: signature[1], returns: signature[2], publicExecute: false }) ||
      fn.owner !== read.state.tables.find(t => t.name === "app_instance_deployments")?.owner) fail("SEALED_MANAGEMENT_FUNCTION_BODY_DRIFT");
  }
}
export async function assertSealedPlanManagementPrestateV1(read: SealedPlanManagementReadbackV1, phase: SealedPlanManagementPhaseV1, sql: string) {
  if (await sha256Hex(sql) !== SEALED_PLAN_SQL_SHA256_V1) fail("SEALED_MANAGEMENT_SQL_PIN_INVALID");
  assertOriginal(read);
  if (phase === "install") {
    if (read.state.objects.length !== 0 || read.state.identity.canCreatePublic !== true || canonicalJson(read.state.references) !== canonicalJson(beforeReferences))
      fail("SEALED_MANAGEMENT_INSTALL_SLOT_NOT_EMPTY");
  } else if (phase === "register") {
    assertInstalled(read, sql); await assertFunctionBodies(read, sql);
    if (read.state.certificates.length !== 0 || read.state.fence?.sealed !== false || read.state.fence.sealed_at !== null)
      fail("SEALED_MANAGEMENT_REGISTRATION_SLOT_NOT_EMPTY");
  } else { fail("SEALED_MANAGEMENT_PHASE_INVALID"); }
}

export async function compileSealedPlanManagementReviewV1(input: {
  phase: SealedPlanManagementPhaseV1; binding: SealedPlanManagementBindingV1;
  readback: SealedPlanManagementReadbackV1; candidateSql: string; startedAt: number; now: number;
}) {
  checkBinding(input.binding); freshTime(input.readback.observedAt, input.startedAt, input.now);
  if (input.readback.transaction.readOnly !== "on" || input.readback.transaction.deferrable !== "on") fail("SEALED_MANAGEMENT_REVIEW_NOT_READONLY");
  await assertSealedPlanManagementPrestateV1(input.readback, input.phase, input.candidateSql);
  const unsigned = freeze({ schemaVersion: 1 as const, protocol: "sealed-plan-management-v1" as const, phase: input.phase,
    binding: { ...input.binding }, candidateSqlSha256: SEALED_PLAN_SQL_SHA256_V1, prestateSha256: input.readback.stateSha256,
    reviewedState: input.readback.state, reviewedAt: input.now, expiresAt: input.now + 3_600_000,
    scope: input.phase === "install" ? "two_tables_eight_functions_sixteen_always_triggers_and_one_unsealed_internal_fence_only" : "one_exact_immutable_certificate_insert_and_internal_fence_finalize_only",
    createsRolesOrGrants: false as const, changesBusinessRows: false as const, changesExistingTrigger: false as const,
    downMigrationAuthorized: false as const, retryAuthorized: false as const, runtimeActivationAuthorized: false as const });
  return freeze({ ...unsigned, manifestSha256: await sha256Hex(unsigned) });
}
export type SealedPlanManagementReviewV1 = Awaited<ReturnType<typeof compileSealedPlanManagementReviewV1>>;

export async function validateSealedPlanManagementReviewIntegrityV1(review: SealedPlanManagementReviewV1,
  binding: SealedPlanManagementBindingV1, sql: string) {
  checkBinding(binding);
  if (!exact(review, ["schemaVersion", "protocol", "phase", "binding", "candidateSqlSha256", "prestateSha256", "reviewedState", "reviewedAt", "expiresAt", "scope",
    "createsRolesOrGrants", "changesBusinessRows", "changesExistingTrigger", "downMigrationAuthorized", "retryAuthorized", "runtimeActivationAuthorized", "manifestSha256"]))
    fail("SEALED_MANAGEMENT_MANIFEST_INVALID");
  const { manifestSha256, ...unsigned } = review;
  if (!digest.test(manifestSha256) || await sha256Hex(unsigned) !== manifestSha256 ||
    canonicalJson(review.binding) !== canonicalJson(binding) || review.candidateSqlSha256 !== SEALED_PLAN_SQL_SHA256_V1 ||
    await sha256Hex(sql) !== SEALED_PLAN_SQL_SHA256_V1 || await sha256Hex(review.reviewedState) !== review.prestateSha256 ||
    review.schemaVersion !== 1 || review.protocol !== "sealed-plan-management-v1" || !["install", "register"].includes(review.phase) ||
    review.createsRolesOrGrants !== false || review.changesBusinessRows !== false || review.changesExistingTrigger !== false ||
    review.downMigrationAuthorized !== false || review.retryAuthorized !== false || review.runtimeActivationAuthorized !== false ||
    review.scope !== (review.phase === "install" ? "two_tables_eight_functions_sixteen_always_triggers_and_one_unsealed_internal_fence_only" : "one_exact_immutable_certificate_insert_and_internal_fence_finalize_only") ||
    !Number.isSafeInteger(review.reviewedAt) || !Number.isSafeInteger(review.expiresAt) || review.reviewedAt <= 0 || review.expiresAt - review.reviewedAt !== 3_600_000)
    fail("SEALED_MANAGEMENT_MANIFEST_INVALID");
}
export async function validateSealedPlanManagementApprovalV1(review: SealedPlanManagementReviewV1, approvedSha256: string,
  binding: SealedPlanManagementBindingV1, sql: string, now: number) {
  await validateSealedPlanManagementReviewIntegrityV1(review, binding, sql);
  if (!digest.test(approvedSha256) || approvedSha256 !== review.manifestSha256 || !Number.isSafeInteger(now) ||
    now < review.reviewedAt || now >= review.expiresAt) fail("SEALED_MANAGEMENT_APPROVAL_OR_WINDOW_INVALID");
}

export const SEALED_PLAN_REGISTER_SQL_V1 = `INSERT INTO public.deployment_plan_only_isolations
 (deployment_id,environment_id,app_instance_id,original_row_sha256,original_plan_bytes_sha256,original_plan_hash,
 business_state_sha256,approved_registration_sha256,protection_schema_sha256,sealed_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(extract(epoch FROM transaction_timestamp())*1000)::bigint) RETURNING *`;

/** One transaction; permanent slot is supplied by the local approved CLI, not a retry hook. */
export async function runReviewedSealedPlanMutationV1(input: {
  client: SealedPlanManagementSqlClientV1; review: SealedPlanManagementReviewV1; approvedSha256: string;
  binding: SealedPlanManagementBindingV1; candidateSql: string; now: () => number;
  claimPermanentSlot: () => Promise<void>;
  persistConsumedReview: () => Promise<void>;
}) {
  const review = freeze(JSON.parse(canonicalJson(input.review)) as SealedPlanManagementReviewV1);
  await validateSealedPlanManagementApprovalV1(review, input.approvedSha256, input.binding, input.candidateSql, input.now());
  let transaction = false, slotConsumed = false, commitAttempted = false;
  try {
    await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); transaction = true;
    await input.client.query("SET LOCAL search_path=pg_catalog");
    await input.client.query("SET LOCAL lock_timeout='5s'");
    await input.client.query("SET LOCAL statement_timeout='30s'");
    // Short write locks close all reference/business races while the exact preimage is compared.
    await input.client.query(`LOCK TABLE ${[...names, "app_instances", "subscriptions", "deployment_environments"].map(n => `public.${n}`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    if (review.phase === "register") await input.client.query("LOCK TABLE public.deployment_plan_only_isolations,public.deployment_plan_only_isolation_fences IN SHARE ROW EXCLUSIVE MODE");
    const startedAt = input.now(), before = await readSealedPlanManagementStateV1(input.client);
    freshTime(before.observedAt, startedAt, input.now());
    await assertSealedPlanManagementPrestateV1(before, review.phase, input.candidateSql);
    if (before.stateSha256 !== review.prestateSha256) fail("SEALED_MANAGEMENT_PRESTATE_DRIFT_NO_WRITE");
    await validateSealedPlanManagementApprovalV1(review, input.approvedSha256, input.binding, input.candidateSql, input.now());
    await input.claimPermanentSlot(); slotConsumed = true;
    await input.persistConsumedReview();
    if (review.phase === "install") { await input.client.query(input.candidateSql); }
    else {
      const e = review.reviewedState.evidence;
      await input.client.query(SEALED_PLAN_REGISTER_SQL_V1, [target, environment, instance, e.originalRowSha256, e.originalPlanBytesSha256,
        e.originalPlanHash, e.businessStateSha256, review.manifestSha256, review.reviewedState.protectionSha256]);
    }
    const after = await readSealedPlanManagementStateV1(input.client);
    await verifySealedPlanManagementPoststateV1(after, review, input.candidateSql);
    freshTime(after.observedAt, startedAt, input.now());
    await validateSealedPlanManagementApprovalV1(review, input.approvedSha256, input.binding, input.candidateSql, input.now());
    commitAttempted = true; await input.client.query("COMMIT"); transaction = false;
    return freeze({ outcome: "COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_READBACK", phase: review.phase,
      slotConsumed, commitConfirmed: true, failureCode: null, retryAuthorized: false, runtimeActivationAuthorized: false });
  } catch (error) {
    if (transaction && !commitAttempted) await input.client.query("ROLLBACK").catch(() => undefined);
    return freeze({ outcome: commitAttempted ? "COMMIT_OUTCOME_UNKNOWN_READONLY_RECOVERY_ONLY" : "STOPPED_NO_COMMIT_READONLY_INSPECT",
      phase: review.phase, slotConsumed, commitConfirmed: false,
      failureCode: error instanceof SealedPlanManagementErrorV1 ? error.code : "SEALED_MANAGEMENT_SUBMISSION_NOT_VERIFIED",
      retryAuthorized: false, runtimeActivationAuthorized: false });
  }
}

export async function verifySealedPlanManagementPoststateV1(read: SealedPlanManagementReadbackV1, review: SealedPlanManagementReviewV1, sql: string) {
  assertOriginal(read); assertInstalled(read, sql); await assertFunctionBodies(read, sql);
  if (canonicalJson(read.state.identity) !== canonicalJson(review.reviewedState.identity) ||
    canonicalJson(read.state.evidence) !== canonicalJson(review.reviewedState.evidence) ||
    canonicalJson(read.state.roles) !== canonicalJson(review.reviewedState.roles)) fail("SEALED_MANAGEMENT_BUSINESS_OR_ROLE_DRIFT");
  const oldTriggers = (tables: typeof read.state.tables) => (tables.find(t => t.name === "app_instance_deployments")?.triggers as Record<string, unknown>[])
    .filter(t => t.name === "app_instance_deployments_admission_reopen_fence");
  if (canonicalJson(oldTriggers(read.state.tables)) !== canonicalJson(oldTriggers(review.reviewedState.tables))) fail("SEALED_MANAGEMENT_OLD_TRIGGER_DRIFT");
  if (review.phase === "install") {
    if (read.state.certificates.length !== 0 || read.state.fence?.sealed !== false || read.state.fence.sealed_at !== null || numeric(read.state.fence.revision) !== 0)
      fail("SEALED_MANAGEMENT_INSTALL_NOT_UNSEALED");
  } else {
    const cert = read.state.certificates[0], e = review.reviewedState.evidence;
    if (read.state.certificates.length !== 1 || !exact(cert, ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256",
      "original_plan_bytes_sha256", "original_plan_hash", "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"]) ||
      cert.deployment_id !== target || cert.environment_id !== environment || cert.app_instance_id !== instance ||
      cert.original_row_sha256 !== e.originalRowSha256 || cert.original_plan_bytes_sha256 !== e.originalPlanBytesSha256 ||
      cert.original_plan_hash !== e.originalPlanHash || cert.business_state_sha256 !== e.businessStateSha256 || cert.approved_registration_sha256 !== review.manifestSha256 ||
      cert.protection_schema_sha256 !== review.reviewedState.protectionSha256 || read.state.protectionSha256 !== review.reviewedState.protectionSha256 ||
      read.state.fence?.sealed !== true || numeric(read.state.fence.sealed_at) !== numeric(cert.sealed_at) || numeric(cert.sealed_at) < review.reviewedAt ||
      numeric(read.state.fence.revision) !== numeric(review.reviewedState.fence?.revision) + 2) fail("SEALED_MANAGEMENT_CERTIFICATE_READBACK_MISMATCH");
  }
  return freeze({ outcome: review.phase === "install" ? "SCHEMA_INSTALLED_UNREGISTERED_READBACK_VERIFIED" : "EXACT_CERTIFICATE_INDEPENDENT_READBACK_VERIFIED",
    stateSha256: read.stateSha256, certificate: review.phase === "register" ? { ...read.state.certificates[0], sealed_at: numeric(read.state.certificates[0].sealed_at) } : null,
    protectionSha256: read.state.protectionSha256, runtimeActivationAuthorized: false });
}
