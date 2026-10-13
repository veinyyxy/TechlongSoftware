import { canonicalJson, sha256Hex } from "./hash.ts";
import { readSealedControlRoleStateV1 } from "./sealed-control-role-management-v1.ts";
import type { SealedPlanManagementSqlClientV1 } from "./sealed-plan-management-v1.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "./sealed-cell-cleanup-lambda-context-v3.ts";
import { FAILED_BIRTH_PROTECTION_CATALOG_V1 } from "./neon-failed-cell-birth-source-v1.ts";

const environment = "env_aws_sandbox_ca_central_1", table = "deployment_failed_cell_birth_fences_v1";
const functionNames = ["enforce_deployment_environment_admission_transition", "reject_failed_cell_birth_fence_mutation_v1", "guard_failed_cell_birth_environment_v1", "begin_failed_cell_birth_fence_v1"];
const triggerNames = ["failed_birth_fence_mutation_v1", "failed_birth_fence_truncate_v1", "failed_birth_environment_mutation_v1", "failed_birth_environment_truncate_v1"];
const changedConstraints = ["deployment_environments_admission_state_check", "deployment_environments_admission_consistency_check"];
export const FAILED_BIRTH_SCHEMA_SHA_V4 = "f4f0bf14bb0b5b126be50dae9c52e21c22ff88bfc36add877db97ae8a45188d9";
export const FAILED_BIRTH_GRANTS_SHA_V4 = "a9b2bca56d3ead7d964f25c00a1a721f5a5fe7dd4a1105ab2c82efeb07391e92";
export const FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4 = freeze({
  techlong_cell_cleanup_reader: { table_privileges: ["app_instances", "app_instance_deployments", "deployment_environments", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences", "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_cleanup_schedules"].map(t => `public.${t}:SELECT`).sort(), column_privileges: [] as string[], settings: ["default_transaction_read_only=on"] },
  techlong_cell_drain: { table_privileges: ["deployment_environments", "app_instance_deployments", "deployment_tenant_resources", "deployment_jobs"].map(t => `public.${t}:SELECT`).sort(),
    column_privileges: [...["admission_state", "admission_epoch", "admission_fence_sha256", "admission_provision_operation_hash", "admission_stack_id", "admission_cell_expires_at", "admission_changed_at"].map(c => `public.deployment_environments.${c}:UPDATE`),
      ...["app_instance_deployments", "deployment_tenant_resources"].map(t => `public.${t}.updated_at:UPDATE`),
      ...["id", "deployment_id", "job_type", "dedupe_key", "status", "payload", "attempts", "max_attempts", "available_at", "created_at", "updated_at"].map(c => `public.deployment_jobs.${c}:INSERT`)].sort(), settings: [] as string[] },
});
export const FAILED_BIRTH_INSTALL_SCOPE_V4 = freeze({
  environment, newTable: table, newFunctions: 3, replacedEnvironmentTransitionFunctions: 1,
  replacedEnvironmentChecks: 2, newAlwaysTriggers: 4, existingTransitionAlwaysEnabled: true,
  readerTableSelect: table, readerJobAndStepSelectColumns: ["id", "deployment_id", "status"],
  drainExecute: "public.begin_failed_cell_birth_fence_v1(text,text)",
  changesBusinessRows: false, callsFailureEntry: false, changesRoleAttributesOrPasswords: false,
  changesAwsOrSecrets: false, registersMigration: false, runtimeEnabled: false,
  permanentSlot: "techlong-f3c9d-failed-birth-installation.permanent-slot.json", retryAuthorized: false, automaticDownAuthorized: false,
});
export const FAILED_BIRTH_INSTALL_RISKS_V4 = Object.freeze({
  accessExclusiveEnvironmentAndBusinessWriteLocks: true, newConstraintsAndAlwaysTriggers: true,
  existingLoginDrainGainsSecurityDefinerWriteEntry: true, columnSelectIsNotRowFiltering: true,
  ownerAndProviderLogsMayExposeSqlIdentifiers: true, administratorConcurrencyAndRoleAclRaces: true,
  tlsConnectionAndCommitResponseCanFail: true, commitUnknownRequiresReadOnlyInspect: true,
  committedDdlAndGrantsNotAutomaticallyReversed: true, fixedSlotConsumedBeforeDdlAndNeverResetOrRetried: true,
  installCatalogVerificationIsNotActualRestrictedRuntimeOrBehavioralAcceptance: true, nonzeroServiceFeesPossible: true,
});
export class FailedBirthInstallationErrorV4 extends Error {}
function fail(code: string): never { throw new FailedBirthInstallationErrorV4(code); }
const digest = /^[a-f0-9]{64}$/;
type Row = Record<string, unknown>;
function rows(v: unknown): Row[] { const r = (v as { rows?: unknown })?.rows; if (!Array.isArray(r) || r.some(x => !x || typeof x !== "object" || Array.isArray(x))) fail("FAILED_INSTALL_ROWS_INVALID"); return r as Row[]; }
function one(v: unknown) { const r = rows(v); if (r.length !== 1) fail("FAILED_INSTALL_SINGLE_ROW_REQUIRED"); return r[0]; }
function exact(v: unknown, keys: string[]) { return !!v && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson(keys.sort()); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function same(a: unknown, b: unknown, code = "FAILED_INSTALL_UNREVIEWED_DRIFT") { if (canonicalJson(a) !== canonicalJson(b)) fail(code); }
function fresh(observed: number, start: number, now: number) { if (![observed, start, now].every(n => Number.isSafeInteger(n) && n > 0) || now < start || observed > now || now - start > 30000 || now - observed > 30000) fail("FAILED_INSTALL_STALE_READ"); }
export interface FailedBirthInstallBindingV4 { targetFingerprintSha256: string; codeSha256: string }
function bindingValid(v: FailedBirthInstallBindingV4) { if (!exact(v, ["targetFingerprintSha256", "codeSha256"]) || Object.values(v).some(x => !digest.test(x))) fail("FAILED_INSTALL_BINDING_INVALID"); }
export const FAILED_BIRTH_INSTALL_READ_SQL_V4 = Object.freeze({
  environment: `SELECT to_jsonb(e) AS environment,
    (SELECT count(*) FROM public.app_instance_deployments d WHERE d.environment_id=e.id AND d.id<>'dep_d00144511731f1c20991aa56' AND d.status NOT IN ('rolled_back','canceled')) AS other_deployments,
    (SELECT count(*) FROM public.deployment_environment_capacity_reservations WHERE environment_id=e.id) AS capacity,
    (SELECT count(*) FROM public.deployment_tenant_resources WHERE environment_id=e.id AND lifecycle_status<>'destroyed') AS resources,
    (SELECT count(*) FROM public.deployment_cleanup_schedules WHERE environment_id=e.id AND status NOT IN ('succeeded','canceled')) AS schedules,
    (SELECT count(*) FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=e.id AND j.status IN ('pending','running','retry_wait')) AS jobs,
    (SELECT count(*) FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id WHERE d.environment_id=e.id AND s.status IN ('pending','running')) AS steps
    FROM public.deployment_environments e WHERE e.id=$1`,
  objects: `SELECT 'function' AS kind,p.proname AS name,pg_catalog.jsonb_build_object('owner',p.proowner::regrole::text,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'arguments',pg_get_function_identity_arguments(p.oid),'returns',format_type(p.prorettype,NULL),'definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,
    'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb)) AS properties
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=ANY($1::text[])
    UNION ALL SELECT 'table',c.relname,jsonb_build_object('owner',c.relowner::regrole::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
      'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
        FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a),'[]'::jsonb)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deployment_failed_cell_birth_fences_v1'
    UNION ALL SELECT 'trigger',t.tgname,jsonb_build_object('table',c.relname,'function',p.proname,'type',t.tgtype,'enabled',t.tgenabled,'arguments',encode(t.tgargs,'hex'),'definition',pg_get_triggerdef(t.oid))
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND (t.tgname LIKE 'failed_birth_%_v1' OR t.tgname='deployment_environments_admission_transition')
    UNION ALL SELECT 'environment_constraint',k.conname,jsonb_build_object('type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) FROM pg_constraint k
      WHERE k.conrelid='public.deployment_environments'::regclass ORDER BY kind,name`,
});
export async function readFailedBirthInstallationStateV4(client: SealedPlanManagementSqlClientV1) {
  const base = await readSealedControlRoleStateV1(client), environmentState = one(await client.query(FAILED_BIRTH_INSTALL_READ_SQL_V4.environment, [environment])),
    objects = rows(await client.query(FAILED_BIRTH_INSTALL_READ_SQL_V4.objects, [functionNames]));
  const tablePresent = objects.some(x => x.kind === "table"), fenceRows = tablePresent ? Number(one(await client.query("SELECT count(*) AS n FROM public.deployment_failed_cell_birth_fences_v1")).n) : null,
    protectionSha256 = String(one(await client.query(FAILED_BIRTH_PROTECTION_CATALOG_V1)).protection_sha256);
  const state = freeze({ base: base.state, environmentState, objects, fenceRows, protectionSha256 });
  return freeze({ state, stateSha256: await sha256Hex(state), observedAt: base.observedAt, transaction: base.transaction });
}
export type FailedBirthInstallReadV4 = Awaited<ReturnType<typeof readFailedBirthInstallationStateV4>>;
export async function assertFailedBirthInstallPrestateV4(read: FailedBirthInstallReadV4) {
  const s = read.state.base.preserved.sealed, cert = s.certificates[0], e = read.state.environmentState.environment as Row;
  if (s.identity.version !== 180006 || s.identity.role !== s.identity.sessionRole || s.identity.replicationRole !== "origin" || s.identity.canCreatePublic !== true ||
    !s.tables.some(t => t.name === "deployment_environments" && t.owner_member === true) ||
    read.transaction.searchPath !== "pg_catalog" || read.transaction.isolation !== "serializable" ||
    s.certificates.length !== 1 || await sha256Hex({ ...cert, sealed_at: Number(cert?.sealed_at) }) !== REGISTERED_SEALED_CERTIFICATE_SHA256_V3 ||
    s.fence?.sealed !== true || s.protectionSha256 !== cert.protection_schema_sha256 || s.evidence.originalRowSha256 !== cert.original_row_sha256 ||
    s.evidence.originalPlanBytesSha256 !== cert.original_plan_bytes_sha256 || s.evidence.originalPlanHash !== cert.original_plan_hash ||
    s.evidence.businessStateSha256 !== cert.business_state_sha256 || Object.values(s.evidence.executionReferences).some(v => v !== 0) ||
    e.id !== environment || e.expected_account_id !== "402010193138" || e.region !== "ca-central-1" || e.cell_key !== "cell-sandbox-1" ||
    e.kind !== "aws_sandbox" || e.driver !== "aws_ecs_cell" || e.base_domain !== "sandbox.techlong.cloud" || e.status !== "active" || e.apply_enabled !== 0 ||
    e.admission_state !== "open" || Number(e.admission_epoch) !== 0 || read.state.fenceRows !== null ||
    Object.entries(read.state.environmentState).some(([k,v]) => k !== "environment" && Number(v) !== 0)) fail("FAILED_INSTALL_PRESTATE_NOT_ELIGIBLE");
  const roles = read.state.base.roles;
  for (const [name, privileges] of Object.entries(FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4)) {
    const role = roles.find(r => r.name === name);
    if (!role || role.rolinherit !== false || role.sequence_access !== false) fail("FAILED_INSTALL_CONTROL_ROLE_BASELINE_DRIFT");
    for (const [key, value] of Object.entries(privileges)) same(role[key], value, "FAILED_INSTALL_CONTROL_ROLE_BASELINE_DRIFT");
    same(role.schema_privileges, ["public:USAGE"], "FAILED_INSTALL_CONTROL_ROLE_BASELINE_DRIFT");
  }
  if (roles.length !== 2 || !roles.some(r => r.name === "techlong_cell_cleanup_reader") || !roles.some(r => r.name === "techlong_cell_drain") || roles.some(r =>
    r.rolcanlogin !== true || r.rolsuper !== false || r.rolcreatedb !== false || r.rolcreaterole !== false || r.rolbypassrls !== false || r.rolreplication !== false ||
    r.owner_member !== false || r.grant_option !== false || r.nontrigger_definer_access !== false || canonicalJson(r.memberships) !== "[]")) fail("FAILED_INSTALL_CONTROL_ROLES_NOT_LIMITED");
  if (read.state.objects.some(x => x.kind === "table" || (x.kind === "function" && x.name !== functionNames[0]) ||
    (x.kind === "trigger" && x.name !== "deployment_environments_admission_transition")) ||
    read.state.objects.filter(x => x.kind === "function").length !== 1 || read.state.objects.filter(x => x.kind === "trigger").length !== 1 ||
    !changedConstraints.every(n => read.state.objects.some(x => x.kind === "environment_constraint" && x.name === n && !(x.properties as Row).definition?.toString().includes("failed_unadmitted"))))
    fail("FAILED_INSTALL_OBJECT_SLOT_NOT_EMPTY");
  if (await sha256Hex(read.state) !== read.stateSha256) fail("FAILED_INSTALL_STATE_DIGEST_INVALID");
}
function preserved(state: FailedBirthInstallReadV4["state"]) {
  const { tables, ...sealed } = state.base.preserved.sealed;
  return { ...state.base.preserved, sealed: { ...sealed, tables: tables.map(t => t.name !== "deployment_environments" ? t : { ...t, constraints: undefined,
    triggers: (t.triggers as Row[]).filter(x => !triggerNames.includes(String(x.name)) && x.name !== "deployment_environments_admission_transition") }) },
    catalog: state.base.preserved.catalog.filter(x => !(x.kind === "relation" && x.name === `public.${table}`) &&
      !(x.kind === "function" && functionNames.some(n => String(x.name).startsWith(`public.${n}(`) || String(x.name).startsWith(`${n}(`)))),
    environmentState: state.environmentState,
    unchangedEnvironmentConstraints: state.objects.filter(x => x.kind === "environment_constraint" && !changedConstraints.includes(String(x.name))) };
}
export async function verifyFailedBirthInstallPoststateV4(read: FailedBirthInstallReadV4, before: FailedBirthInstallReadV4["state"], sql: string) {
  same(preserved(read.state), preserved(before), "FAILED_INSTALL_PRESERVED_STATE_DRIFT");
  const roleExpected = structuredClone(before.base.roles);
  const reader = roleExpected.find(x => x.name === "techlong_cell_cleanup_reader")!, drain = roleExpected.find(x => x.name === "techlong_cell_drain")!;
  reader.table_privileges = [...new Set([...(reader.table_privileges as string[]), `public.${table}:SELECT`])].sort();
  reader.column_privileges = [...new Set([...(reader.column_privileges as string[]), ...["deployment_jobs", "deployment_step_runs"].flatMap(t =>
    (reader.table_privileges as string[]).includes(`public.${t}:SELECT`) ? [] : ["id", "deployment_id", "status"].map(c => `public.${t}.${c}:SELECT`))])].sort();
  drain.nontrigger_definer_access = true;
  same(read.state.base.roles, roleExpected, "FAILED_INSTALL_ROLE_DELTA_EXCEEDS_SCOPE");
  if (read.state.fenceRows !== 0 || !digest.test(read.state.protectionSha256)) fail("FAILED_INSTALL_FENCE_NOT_EMPTY");
  const objects = read.state.objects;
  if (objects.filter(x => x.kind === "table").length !== 1 || objects.filter(x => x.kind === "function").length !== 4 || objects.filter(x => x.kind === "trigger").length !== 5) fail("FAILED_INSTALL_OBJECT_COUNT_INVALID");
  for (const name of functionNames) {
    const matching = objects.filter(x => x.kind === "function" && x.name === name), body = sql.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1];
    if (matching.length !== 1 || !body) fail("FAILED_INSTALL_FUNCTION_MISSING");
    const p = matching[0].properties as Row, isEntry = name === "begin_failed_cell_birth_fence_v1";
    if (p.bodySha256 !== await sha256Hex(body) || p.language !== "plpgsql" || canonicalJson(p.config) !== '["search_path=pg_catalog"]' ||
      p.returns !== (isEntry ? "text" : "trigger") || p.arguments !== (isEntry ? "input_json text, input_sha256 text" : "") ||
      p.definer !== (isEntry || name === "guard_failed_cell_birth_environment_v1")) fail("FAILED_INSTALL_FUNCTION_BODY_OR_SECURITY_DRIFT");
    if (name === functionNames[0]) { const old = before.objects.find(x => x.kind === "function" && x.name === name)!.properties as Row; same(p.acl, old.acl); same(p.owner, old.owner); }
    else {
      same(p.owner, before.base.preserved.sealed.identity.role);
      const grants = p.acl as Row[];
      if (grants.some(a => a.grantee !== p.owner && !(isEntry && a.grantee === "techlong_cell_drain" && a.privilege === "EXECUTE" && a.grantable === false)) ||
        (isEntry && !grants.some(a => a.grantee === "techlong_cell_drain" && a.privilege === "EXECUTE" && a.grantable === false))) fail("FAILED_INSTALL_FUNCTION_ACL_TOO_BROAD");
    }
  }
  for (const [name, relation, fn, type] of [
    [triggerNames[0], table, functionNames[1], 27], [triggerNames[1], table, functionNames[1], 34],
    [triggerNames[2], "deployment_environments", functionNames[2], 27], [triggerNames[3], "deployment_environments", functionNames[2], 34],
    ["deployment_environments_admission_transition", "deployment_environments", functionNames[0], 19],
  ]) {
    const match = objects.filter(x => x.kind === "trigger" && x.name === name); if (match.length !== 1) fail("FAILED_INSTALL_TRIGGER_MISSING");
    const { definition: _definition, ...p } = match[0].properties as Row; void _definition;
    same(p, { table: relation, function: fn, type, enabled: "A", arguments: "" }, "FAILED_INSTALL_TRIGGER_DRIFT");
    if (name === "deployment_environments_admission_transition") same(_definition, (before.objects.find(x => x.kind === "trigger" && x.name === name)!.properties as Row).definition, "FAILED_INSTALL_EXISTING_TRIGGER_DEFINITION_DRIFT");
  }
  const t = objects.find(x => x.kind === "table")!.properties as Row;
  same(t.columns, ["environment_id", "fence_json", "fence_sha256", "created_at"].map(name => ({ name, type: name === "created_at" ? "bigint" : "text", notNull: true, default: null })), "FAILED_INSTALL_TABLE_COLUMNS_DRIFT");
  if (t.owner !== before.base.preserved.sealed.identity.role || t.kind !== "r" || t.rls !== false || t.forceRls !== false || (t.constraints as Row[]).length !== 7 ||
    (t.constraints as Row[]).some(c => c.validated !== true) || ["c", "p", "f"].some((kind, i) => (t.constraints as Row[]).filter(c => c.type === kind).length !== [5, 1, 1][i]) || (t.acl as Row[]).some(a => a.grantee !== t.owner &&
      !(a.grantee === "techlong_cell_cleanup_reader" && a.privilege === "SELECT" && a.grantable === false))) fail("FAILED_INSTALL_TABLE_GUARDS_OR_ACL_INVALID");
  if (!changedConstraints.every(n => { const a = objects.filter(x => x.kind === "environment_constraint" && x.name === n); const p = a[0]?.properties as Row;
    return a.length === 1 && p.type === "c" && p.validated === true && ["open", "draining", "failed_unadmitted"].every(v => String(p.definition).includes(`'${v}'`)); })) fail("FAILED_INSTALL_ENVIRONMENT_CHECKS_INVALID");
  return freeze({ outcome: "FAILED_BIRTH_SCHEMA_AND_NARROW_GRANTS_CATALOG_VERIFIED", stateSha256: read.stateSha256,
    failedBirthProtectionSha256: read.state.protectionSha256, historicalSealAndBusinessStateUnchanged: true, emptyNewFence: true,
    actualRestrictedRuntimeProofProduced: false, failureEntryBehaviorExercised: false, runtimeEnabled: false });
}
export async function compileFailedBirthInstallReviewV4(read: FailedBirthInstallReadV4, binding: FailedBirthInstallBindingV4, start: number, now: number) {
  bindingValid(binding); fresh(read.observedAt, start, now); await assertFailedBirthInstallPrestateV4(read);
  if (read.transaction.readOnly !== "on" || read.transaction.deferrable !== "on") fail("FAILED_INSTALL_REVIEW_NOT_READONLY");
  const unsigned = { schemaVersion: 4, protocol: "failed-cell-birth-schema-role-installation-v4", binding, reviewedAt: now, expiresAt: now + 3600000,
    prestateSha256: read.stateSha256, reviewedState: read.state, schemaSqlSha256: FAILED_BIRTH_SCHEMA_SHA_V4, grantsSqlSha256: FAILED_BIRTH_GRANTS_SHA_V4,
    scope: FAILED_BIRTH_INSTALL_SCOPE_V4, risks: FAILED_BIRTH_INSTALL_RISKS_V4 };
  return freeze({ ...structuredClone(unsigned), manifestSha256: await sha256Hex(unsigned) });
}
export type FailedBirthInstallReviewV4 = Awaited<ReturnType<typeof compileFailedBirthInstallReviewV4>>;
export async function validateFailedBirthInstallReviewV4(review: FailedBirthInstallReviewV4, binding: FailedBirthInstallBindingV4, schema: string, grants: string) {
  bindingValid(binding);
  if (!exact(review, ["schemaVersion", "protocol", "binding", "reviewedAt", "expiresAt", "prestateSha256", "reviewedState", "schemaSqlSha256", "grantsSqlSha256", "scope", "risks", "manifestSha256"])) fail("FAILED_INSTALL_MANIFEST_INVALID");
  const { manifestSha256, ...unsigned } = review;
  if (!digest.test(manifestSha256) || await sha256Hex(unsigned) !== manifestSha256 || canonicalJson(review.binding) !== canonicalJson(binding) ||
    review.schemaVersion !== 4 || review.protocol !== "failed-cell-birth-schema-role-installation-v4" ||
    await sha256Hex(schema) !== FAILED_BIRTH_SCHEMA_SHA_V4 || await sha256Hex(grants) !== FAILED_BIRTH_GRANTS_SHA_V4 ||
    review.schemaSqlSha256 !== FAILED_BIRTH_SCHEMA_SHA_V4 || review.grantsSqlSha256 !== FAILED_BIRTH_GRANTS_SHA_V4 ||
    await sha256Hex(review.reviewedState) !== review.prestateSha256 || canonicalJson(review.scope) !== canonicalJson(FAILED_BIRTH_INSTALL_SCOPE_V4) ||
    canonicalJson(review.risks) !== canonicalJson(FAILED_BIRTH_INSTALL_RISKS_V4) || !Number.isSafeInteger(review.reviewedAt) || !Number.isSafeInteger(review.expiresAt) ||
    review.reviewedAt <= 0 || review.expiresAt - review.reviewedAt !== 3600000) fail("FAILED_INSTALL_MANIFEST_OR_CODE_DRIFT");
}
export async function runReviewedFailedBirthInstallationV4(input: {
  client: SealedPlanManagementSqlClientV1; review: FailedBirthInstallReviewV4; approvedSha: string; binding: FailedBirthInstallBindingV4;
  schema: string; grants: string; now: () => number; readState: () => Promise<FailedBirthInstallReadV4>; verifyCode: () => Promise<void>; claimPermanentSlot: () => Promise<void>;
}) {
  input = { ...input, binding: freeze(structuredClone(input.binding)) };
  const review = freeze(structuredClone(input.review));
  const approval = async () => { await input.verifyCode(); await validateFailedBirthInstallReviewV4(review, input.binding, input.schema, input.grants);
    const now = input.now(); if (!digest.test(input.approvedSha) || input.approvedSha !== review.manifestSha256 || !Number.isSafeInteger(now) || now < review.reviewedAt || now >= review.expiresAt) fail("FAILED_INSTALL_APPROVAL_OR_WINDOW_INVALID"); };
  await approval(); let transaction = false, slotConsumed = false, commitAttempted = false, ddlAttempted = false;
  try {
    await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); transaction = true;
    await input.client.query("SET LOCAL search_path=pg_catalog"); await input.client.query("SET LOCAL lock_timeout='5s'"); await input.client.query("SET LOCAL statement_timeout='30s'");
    await input.client.query("LOCK TABLE public.deployment_environments IN ACCESS EXCLUSIVE MODE");
    await input.client.query("LOCK TABLE public.app_instance_deployments,public.app_instances,public.subscriptions,public.deployment_jobs,public.deployment_step_runs,public.deployment_cleanup_schedules,public.deployment_environment_capacity_reservations,public.deployment_tenant_resources,public.deployment_tenant_resource_events,public.deployment_tenant_external_operations,public.deployment_tenant_external_operation_events,public.deployment_tenant_cleanup_runs,public.deployment_plan_only_isolations,public.deployment_plan_only_isolation_fences IN SHARE ROW EXCLUSIVE MODE");
    const start = input.now(), before = await input.readState(); fresh(before.observedAt, start, input.now()); await assertFailedBirthInstallPrestateV4(before);
    if (before.stateSha256 !== review.prestateSha256) fail("FAILED_INSTALL_PRESTATE_DRIFT_NO_DDL");
    await approval(); await input.claimPermanentSlot(); slotConsumed = true; await approval();
    ddlAttempted = true; await input.client.query(input.schema); await input.client.query(input.grants);
    const after = await input.readState(); await verifyFailedBirthInstallPoststateV4(after, review.reviewedState, input.schema); fresh(after.observedAt, start, input.now());
    await approval(); commitAttempted = true; await input.client.query("COMMIT"); transaction = false;
    return freeze({ outcome: "COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, ddlAttempted, commitAttempted, commitConfirmed: true, retryAuthorized: false, runtimeEnabled: false });
  } catch (e) {
    if (transaction && !commitAttempted) await input.client.query("ROLLBACK").catch(() => undefined);
    return freeze({ outcome: commitAttempted ? "COMMIT_UNKNOWN_READONLY_INSPECT_ONLY" : "STOPPED_BEFORE_COMMIT_READONLY_INSPECT_ONLY", slotConsumed, ddlAttempted, commitAttempted,
      commitConfirmed: false, safeCode: e instanceof FailedBirthInstallationErrorV4 ? e.message : "FAILED_INSTALL_PROVIDER_OR_SLOT_FAILURE", retryAuthorized: false, runtimeEnabled: false });
  }
}
