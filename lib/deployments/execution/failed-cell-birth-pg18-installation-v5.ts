import { canonicalJson, sha256Hex } from "./hash.ts";
import { readFailedBirthInstallationStateV4, assertFailedBirthInstallPrestateV4, verifyFailedBirthInstallPoststateV4,
  FAILED_BIRTH_INSTALL_SCOPE_V4, FAILED_BIRTH_INSTALL_RISKS_V4, FAILED_BIRTH_SCHEMA_SHA_V4, FAILED_BIRTH_GRANTS_SHA_V4,
  type FailedBirthInstallReadV4, type FailedBirthInstallBindingV4 } from "./failed-cell-birth-installation-v4.ts";
import type { SealedPlanManagementSqlClientV1 } from "./sealed-plan-management-v1.ts";

type Row = Record<string, unknown>;
const table = "deployment_failed_cell_birth_fences_v1", environmentTable = "deployment_environments", digest = /^[a-f0-9]{64}$/;
export const FAILED_BIRTH_PRIOR_ATTEMPT_V5 = freeze({
  approvedSha256: "91a63757de532e1189f7c2478401e26d46cd2643965c802172cb9841477c4291",
  code68Sha256: "cd90d88625ea3c2b25226ea5a326a53bc9b34104ad05e8c628735489290f4486",
  receiptSha256: "43077c961fd125583102b8209510ab24587ba7fb4d4830d26f79fa6b344a4cee",
  consumedSlot: "techlong-f3c9d-failed-birth-installation.permanent-slot.json",
  consumedSlotSha256: "d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e",
  restorationReportSha256: "3d2853a1e4542cfaa24244b55343efcc79ed0b9de887a8caa8c5775aa7257945",
  restoredLegacyStateSha256: "e2f42d036a44235ebfede2f0703336740df95d091551540ddf21a53920c26b88",
});
export const FAILED_BIRTH_PG18_SCOPE_V5 = freeze({ ...FAILED_BIRTH_INSTALL_SCOPE_V4,
  permanentSlot: "techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json",
  priorConsumedAttempt: FAILED_BIRTH_PRIOR_ATTEMPT_V5, preservesOriginalConsumedSlot: true,
  separateFreshHumanApprovalRequired: true, newSlotClaimedOnlyAfterFreshApprovalAndLivePrestate: true,
  pg18NotNullColumnMappings: ["environment_id", "fence_json", "fence_sha256", "created_at"],
  enforcedAndValidatedConstraintsRequired: true, precommitCatalogEvidencePersisted: true,
});
export const FAILED_BIRTH_PG18_RISKS_V5 = freeze({ ...FAILED_BIRTH_INSTALL_RISKS_V4,
  previousIncompleteCatalogDoesNotUniquelyProvePriorCause: true,
  separatelyApprovedOnceOnlyAttemptMayDiscoverOtherPrecommitFailures: true,
  privatePrecommitMetadataPersistenceCanFailAndConsumeNewSlot: true,
  newAttemptDoesNotResetOrAuthorizeReplayOfOldAttempt: true,
});
export class FailedBirthPg18InstallationErrorV5 extends Error {}
function fail(code: string): never { throw new FailedBirthPg18InstallationErrorV5(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function same(a: unknown, b: unknown, code: string) { if (canonicalJson(a) !== canonicalJson(b)) fail(code); }
function exact(v: unknown, keys: string[]) { return !!v && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson(keys.sort()); }
function rows(v: unknown): Row[] { const r = (v as { rows?: unknown })?.rows; if (!Array.isArray(r) || r.some(x => !x || typeof x !== "object" || Array.isArray(x))) fail("FAILED_PG18_ROWS_INVALID"); return r as Row[]; }
function freshness(observed: number, start: number, now: number) {
  if (![observed, start, now].every(n => Number.isSafeInteger(n) && n > 0) || now < start || observed > now || now - start > 30000 || now - observed > 30000) fail("FAILED_PG18_STALE_READ");
}
export const FAILED_BIRTH_PG18_READ_SQL_V5 = freeze({
  columns: `SELECT c.relname AS relation,a.attnum::int AS number,a.attname AS name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
    a.attidentity::text AS identity,a.attgenerated::text AS generated,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS "default"
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname IN ('deployment_environments','deployment_failed_cell_birth_fences_v1')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY relation,a.attnum`,
  constraints: `SELECT c.relname AS relation,k.conname::text AS name,k.contype::text AS type,
    k.conenforced AS enforced,k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS deferred,
    k.conislocal AS local,k.coninhcount::int AS inheritance_count,k.conparentid::int AS parent_id,k.conperiod AS period,
    k.conkey::int[] AS columns,k.confkey::int[] AS referenced_columns,
    CASE WHEN k.confrelid=0 THEN NULL ELSE k.confrelid::pg_catalog.regclass::text END AS referenced_relation,
    k.confdeltype::text AS delete_action,k.confupdtype::text AS update_action,k.confmatchtype::text AS match_type,
    pg_catalog.pg_get_constraintdef(k.oid) AS definition
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('deployment_environments','deployment_failed_cell_birth_fences_v1') ORDER BY relation,name`,
});
export async function readFailedBirthPg18StateV5(client: SealedPlanManagementSqlClientV1) {
  const legacy = await readFailedBirthInstallationStateV4(client), columns = rows(await client.query(FAILED_BIRTH_PG18_READ_SQL_V5.columns)),
    constraints = rows(await client.query(FAILED_BIRTH_PG18_READ_SQL_V5.constraints));
  const state = freeze({ legacy: legacy.state, columns, constraints });
  return freeze({ state, stateSha256: await sha256Hex(state), legacyStateSha256: legacy.stateSha256, observedAt: legacy.observedAt, transaction: legacy.transaction });
}
export type FailedBirthPg18ReadV5 = Awaited<ReturnType<typeof readFailedBirthPg18StateV5>>;
async function legacyRead(read: FailedBirthPg18ReadV5): Promise<FailedBirthInstallReadV4> {
  return { state: read.state.legacy, stateSha256: await sha256Hex(read.state.legacy), observedAt: read.observedAt, transaction: read.transaction };
}
/** n rows are validated separately, never discarded just to make a count fit. */
export function verifyPg18NotNullMappingsV5(columns: Row[], constraints: Row[], relation: string) {
  const expected = columns.filter(c => c.relation === relation && c.not_null === true), actual = constraints.filter(c => c.relation === relation && c.type === "n");
  if (actual.length !== expected.length || new Set(expected.map(c => c.number)).size !== expected.length || expected.some(c => !Number.isInteger(c.number) || Number(c.number) <= 0 || typeof c.name !== "string" || !c.name)) fail("FAILED_PG18_NOT_NULL_COUNT_OR_COLUMN_DRIFT");
  for (const column of expected) {
    const matching = actual.filter(c => canonicalJson(c.columns) === canonicalJson([column.number]));
    if (matching.length !== 1 || matching[0].enforced !== true || matching[0].validated !== true || matching[0].deferrable !== false || matching[0].deferred !== false ||
      matching[0].local !== true || matching[0].inheritance_count !== 0 || matching[0].parent_id !== 0 || matching[0].period !== false)
      fail("FAILED_PG18_NOT_NULL_MAPPING_OR_ENFORCEMENT_DRIFT");
  }
}
export async function assertFailedBirthPg18PrestateV5(read: FailedBirthPg18ReadV5) {
  await assertFailedBirthInstallPrestateV4(await legacyRead(read));
  if (read.legacyStateSha256 !== FAILED_BIRTH_PRIOR_ATTEMPT_V5.restoredLegacyStateSha256 || await sha256Hex(read.state.legacy) !== read.legacyStateSha256 || await sha256Hex(read.state) !== read.stateSha256 ||
    read.state.columns.some(c => c.relation === table) || read.state.constraints.some(c => c.relation === table)) fail("FAILED_PG18_PRIOR_RESTORATION_OR_EMPTY_SLOT_DRIFT");
  verifyPg18NotNullMappingsV5(read.state.columns, read.state.constraints, environmentTable);
}
function preservedPg18(state: FailedBirthPg18ReadV5["state"]) {
  return { columns: state.columns.filter(c => c.relation === environmentTable), constraints: state.constraints.filter(c => c.relation === environmentTable &&
    !["deployment_environments_admission_state_check", "deployment_environments_admission_consistency_check"].includes(String(c.name))) };
}
export async function verifyFailedBirthPg18PoststateV5(read: FailedBirthPg18ReadV5, before: FailedBirthPg18ReadV5["state"], schema: string) {
  if (await sha256Hex(read.state) !== read.stateSha256 || await sha256Hex(read.state.legacy) !== read.legacyStateSha256) fail("FAILED_PG18_POSTSTATE_DIGEST_INVALID");
  same(preservedPg18(read.state), preservedPg18(before), "FAILED_PG18_EXISTING_COLUMNS_OR_CONSTRAINTS_DRIFT");
  const cols = read.state.columns.filter(c => c.relation === table), constraints = read.state.constraints.filter(c => c.relation === table);
  same(cols, ["environment_id", "fence_json", "fence_sha256", "created_at"].map((name, i) => ({ relation: table, number: i + 1, name,
    type: name === "created_at" ? "bigint" : "text", not_null: true, identity: "", generated: "", default: null })), "FAILED_PG18_FENCE_COLUMNS_DRIFT");
  verifyPg18NotNullMappingsV5(read.state.columns, read.state.constraints, table);
  if (["n", "c", "p", "f"].some((type, i) => constraints.filter(c => c.type === type).length !== [4, 5, 1, 1][i]) || constraints.some(c =>
    !["n", "c", "p", "f"].includes(String(c.type)) || c.enforced !== true || c.validated !== true || c.deferrable !== false || c.deferred !== false ||
    c.local !== true || c.inheritance_count !== 0 || c.parent_id !== 0 || c.period !== false)) fail("FAILED_PG18_FENCE_CONSTRAINT_TYPE_OR_ENFORCEMENT_DRIFT");
  const pk = constraints.find(c => c.type === "p")!, fk = constraints.find(c => c.type === "f")!, envId = before.columns.find(c => c.relation === environmentTable && c.name === "id");
  same(pk.columns, [1], "FAILED_PG18_PRIMARY_KEY_COLUMN_DRIFT"); same(fk.columns, [1], "FAILED_PG18_FOREIGN_KEY_COLUMN_DRIFT");
  if (!envId || fk.referenced_relation !== "public.deployment_environments" || canonicalJson(fk.referenced_columns) !== canonicalJson([envId.number]) ||
    fk.delete_action !== "r" || fk.update_action !== "a" || fk.match_type !== "s") fail("FAILED_PG18_FOREIGN_KEY_TARGET_OR_ACTION_DRIFT");
  const changed = read.state.constraints.filter(c => c.relation === environmentTable && ["deployment_environments_admission_state_check", "deployment_environments_admission_consistency_check"].includes(String(c.name)));
  if (changed.length !== 2 || changed.some(c => c.type !== "c" || c.enforced !== true || c.validated !== true || c.deferrable !== false || c.deferred !== false)) fail("FAILED_PG18_ENVIRONMENT_CHECK_NOT_ENFORCED");
  // Cross-check both independent catalog query shapes before projecting ONLY
  // the four independently verified n rows for the original v4 checker.
  const projection = structuredClone(read.state.legacy), t = projection.objects.find(o => o.kind === "table");
  if (!t) fail("FAILED_PG18_LEGACY_TABLE_MISSING");
  const props = t.properties as Row, minimal = constraints.map(c => ({ name: c.name, type: c.type, validated: c.validated, definition: c.definition })).sort((a,b) => String(a.name).localeCompare(String(b.name)));
  same(props.constraints, minimal, "FAILED_PG18_DUAL_CATALOG_QUERY_DRIFT");
  props.constraints = minimal.filter(c => c.type !== "n");
  const verified = await verifyFailedBirthInstallPoststateV4({ state: projection, stateSha256: await sha256Hex(projection), observedAt: read.observedAt, transaction: read.transaction }, before.legacy, schema);
  return freeze({ ...verified, outcome: "PG18_FAILED_BIRTH_SCHEMA_AND_NARROW_GRANTS_CATALOG_VERIFIED", stateSha256: read.stateSha256,
    legacyStateSha256: read.legacyStateSha256, pg18ConstraintTypeCounts: { n: 4, c: 5, p: 1, f: 1 },
    exactNotNullColumnMappingsVerified: true, enforcedAndValidatedVerified: true, originalV4NonCountChecksPreserved: true });
}
export async function compileFailedBirthPg18ReviewV5(read: FailedBirthPg18ReadV5, binding: FailedBirthInstallBindingV4, start: number, now: number) {
  read = freeze(structuredClone(read)); binding = freeze(structuredClone(binding));
  bindingValid(binding); freshness(read.observedAt, start, now); await assertFailedBirthPg18PrestateV5(read);
  if (read.transaction.readOnly !== "on" || read.transaction.deferrable !== "on") fail("FAILED_PG18_REVIEW_NOT_READONLY");
  const unsigned = { schemaVersion: 5, protocol: "failed-cell-birth-pg18-reviewed-installation-v5", binding: structuredClone(binding), reviewedAt: now, expiresAt: now + 3600000,
    reviewedState: read.state, prestateSha256: read.stateSha256, schemaSqlSha256: FAILED_BIRTH_SCHEMA_SHA_V4, grantsSqlSha256: FAILED_BIRTH_GRANTS_SHA_V4,
    scope: FAILED_BIRTH_PG18_SCOPE_V5, risks: FAILED_BIRTH_PG18_RISKS_V5 };
  return freeze({ ...structuredClone(unsigned), manifestSha256: await sha256Hex(unsigned) });
}
export type FailedBirthPg18ReviewV5 = Awaited<ReturnType<typeof compileFailedBirthPg18ReviewV5>>;
function bindingValid(v: FailedBirthInstallBindingV4) { if (!exact(v, ["targetFingerprintSha256", "codeSha256"]) || Object.values(v).some(x => !digest.test(x))) fail("FAILED_PG18_BINDING_INVALID"); }
export async function validateFailedBirthPg18ReviewV5(review: FailedBirthPg18ReviewV5, binding: FailedBirthInstallBindingV4, schema: string, grants: string) {
  bindingValid(binding);
  if (!exact(review, ["schemaVersion", "protocol", "binding", "reviewedAt", "expiresAt", "reviewedState", "prestateSha256", "schemaSqlSha256", "grantsSqlSha256", "scope", "risks", "manifestSha256"])) fail("FAILED_PG18_MANIFEST_INVALID");
  const { manifestSha256, ...unsigned } = review;
  if (!digest.test(manifestSha256) || await sha256Hex(unsigned) !== manifestSha256 || review.schemaVersion !== 5 || review.protocol !== "failed-cell-birth-pg18-reviewed-installation-v5" ||
    canonicalJson(review.binding) !== canonicalJson(binding) || review.schemaSqlSha256 !== FAILED_BIRTH_SCHEMA_SHA_V4 || review.grantsSqlSha256 !== FAILED_BIRTH_GRANTS_SHA_V4 ||
    await sha256Hex(schema) !== FAILED_BIRTH_SCHEMA_SHA_V4 || await sha256Hex(grants) !== FAILED_BIRTH_GRANTS_SHA_V4 || await sha256Hex(review.reviewedState) !== review.prestateSha256 ||
    canonicalJson(review.scope) !== canonicalJson(FAILED_BIRTH_PG18_SCOPE_V5) || canonicalJson(review.risks) !== canonicalJson(FAILED_BIRTH_PG18_RISKS_V5) ||
    !Number.isSafeInteger(review.reviewedAt) || !Number.isSafeInteger(review.expiresAt) || review.reviewedAt <= 0 || review.expiresAt - review.reviewedAt !== 3600000) fail("FAILED_PG18_MANIFEST_OR_SQL_DRIFT");
}
export async function runReviewedFailedBirthPg18V5(input: {
  client: SealedPlanManagementSqlClientV1; review: FailedBirthPg18ReviewV5; approvedSha: string; binding: FailedBirthInstallBindingV4; schema: string; grants: string;
  now: () => number; readState: () => Promise<FailedBirthPg18ReadV5>; verifyCodeAndPriorEvidence: () => Promise<void>; claimFreshApprovedSlot: () => Promise<void>;
  persistPrecommitEvidence: (phase: "before-ddl" | "after-ddl", read: FailedBirthPg18ReadV5) => Promise<void>;
}) {
  input = { ...input, binding: freeze(structuredClone(input.binding)) }; const review = freeze(structuredClone(input.review));
  const approval = async () => { await input.verifyCodeAndPriorEvidence(); await validateFailedBirthPg18ReviewV5(review, input.binding, input.schema, input.grants);
    const now = input.now(); if (input.approvedSha !== review.manifestSha256 || !digest.test(input.approvedSha) || !Number.isSafeInteger(now) || now < review.reviewedAt || now >= review.expiresAt) fail("FAILED_PG18_APPROVAL_OR_WINDOW_INVALID"); };
  await approval(); let transaction = false, slotConsumed = false, schemaAttempted = false, grantsAttempted = false, commitAttempted = false, afterEvidenceSaved = false, stage = "BEGIN";
  try {
    await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); transaction = true;
    await input.client.query("SET LOCAL search_path=pg_catalog"); await input.client.query("SET LOCAL lock_timeout='5s'"); await input.client.query("SET LOCAL statement_timeout='30s'");
    await input.client.query("LOCK TABLE public.deployment_environments IN ACCESS EXCLUSIVE MODE");
    await input.client.query("LOCK TABLE public.app_instance_deployments,public.app_instances,public.subscriptions,public.deployment_jobs,public.deployment_step_runs,public.deployment_cleanup_schedules,public.deployment_environment_capacity_reservations,public.deployment_tenant_resources,public.deployment_tenant_resource_events,public.deployment_tenant_external_operations,public.deployment_tenant_external_operation_events,public.deployment_tenant_cleanup_runs,public.deployment_plan_only_isolations,public.deployment_plan_only_isolation_fences IN SHARE ROW EXCLUSIVE MODE");
    stage = "LOCKED_PRESTATE"; const start = input.now(), before = await input.readState(); freshness(before.observedAt, start, input.now()); await assertFailedBirthPg18PrestateV5(before);
    if (before.stateSha256 !== review.prestateSha256) fail("FAILED_PG18_LIVE_PRESTATE_DRIFT_NO_DDL");
    await approval(); await input.persistPrecommitEvidence("before-ddl", before); await approval();
    await input.claimFreshApprovedSlot(); slotConsumed = true; await approval();
    stage = "SCHEMA_SQL"; schemaAttempted = true; await input.client.query(input.schema);
    stage = "GRANTS_SQL"; grantsAttempted = true; await input.client.query(input.grants);
    stage = "POSTDDL_READ"; const after = await input.readState();
    stage = "POSTDDL_PRIVATE_EVIDENCE"; await input.persistPrecommitEvidence("after-ddl", after); afterEvidenceSaved = true;
    stage = "POSTDDL_VALIDATE"; await verifyFailedBirthPg18PoststateV5(after, review.reviewedState, input.schema); freshness(after.observedAt, start, input.now()); await approval();
    stage = "COMMIT"; commitAttempted = true; await input.client.query("COMMIT"); transaction = false;
    return freeze({ outcome: "COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, schemaAttempted, grantsAttempted, afterEvidenceSaved, commitAttempted, commitConfirmed: true, retryAuthorized: false, runtimeEnabled: false });
  } catch (e) {
    if (transaction && !commitAttempted) await input.client.query("ROLLBACK").catch(() => undefined);
    return freeze({ outcome: commitAttempted ? "COMMIT_UNKNOWN_INSPECT_ONLY" : "STOPPED_BEFORE_COMMIT_INSPECT_ONLY", stage, slotConsumed, schemaAttempted, grantsAttempted, afterEvidenceSaved,
      commitAttempted, commitConfirmed: false, safeCode: e instanceof FailedBirthPg18InstallationErrorV5 ? e.message : /^FAILED_INSTALL_[A-Z0-9_]{1,100}$/.test(String((e as Error)?.message)) ? (e as Error).message : "FAILED_PG18_PROVIDER_OR_PRIVATE_EVIDENCE_FAILURE",
      sqlState: /^[0-9A-Z]{5}$/.test(String((e as { code?: unknown })?.code)) ? (e as { code: string }).code : null, retryAuthorized: false, runtimeEnabled: false });
  }
}
