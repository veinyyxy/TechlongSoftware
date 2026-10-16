import { hash, same, R } from './express-workload-recovery-plan-v1.mjs';
export { hash, same };
export const A = Object.freeze({
  stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917',
  taskDefinitionArn: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:2',
  slot: 'F:/ChatGPT_workshop/techlong-express-k2a-initialization-audit-v1.permanent-slot.json',
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-k2a-initialization-audit-risk.md',
  endpoint: 'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com',
  database: 'tenant_a0da1748bc4d5419_db', role: 'tenant_a0da1748bc4d5419_role',
  databaseOid: '16459', roleOid: '16456', managementRoleOid: '16410',
  snapshotSha256: '2c3033c1c2b92b3c2ba6717b00d6226004e26856ee7d6663a8f760c3c43dd114',
  catalog: 'ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9',
  roleSha: '941cfda905da13438878f0f5415a2d9bb56a7be217a8d813daef8fde401055d5',
  acl: '9a6a5619d26ca00ec807c83e6dbf3c2f69504b06f93af26eb9b8ce6b86d61c22',
  pristineCounts: '8fb858f29bf407a2e06afb7506078c253c4707e5eead0555483b5dca0ad7451f',
});
export function requireAudit(ok, code) { if (!ok) throw Error('INITIALIZATION_AUDIT_' + code); }
const expectedEntitlements = [
  ['branding.custom_theme.enabled', true, 'boolean'], ['branding.merchant_editable', true, 'boolean'],
  ['buyer.access.heartbeat_seconds', 300, 'integer'], ['buyer.access.lease_seconds', 900, 'integer'],
  ['buyer.accounts.max', null, 'integer_or_null'], ['buyer.concurrent_access.max', null, 'integer_or_null'],
  ['merchant.active_users.max', null, 'integer_or_null'], ['stores.max', null, 'integer_or_null'],
].map(([key, value, type]) => ({ key, value, type, source: 'default', license: null, revision: '1', updatedBy: 'migration', sameInstance: true }));

// This additional SELECT returns only counts/booleans, not operation bodies,
// password hashes, metadata objects, audit payloads or owner row values. The
// eight frozen snapshot queries also return catalog/store/entitlement metadata
// for in-memory comparison; those raw rows are never persisted by the runtime.
export const SUMMARY_SQL = `SELECT
 (SELECT count(*)::integer FROM public.saas_instances) AS instances,
 (SELECT count(*)::integer FROM public.saas_provisioning_operations) AS operations,
 (SELECT count(*)::integer FROM public.merchant_users) AS merchant_users,
 (SELECT count(*)::integer FROM public.saas_audit_logs) AS audit_rows,
 (SELECT count(*)::integer FROM public.system_config WHERE active=TRUE AND config_key='store.profile') AS profiles,
 (SELECT count(*)=1 FROM public.stores WHERE store_id=$8::text::uuid AND is_default=TRUE AND status='active') AS exact_default_store,
 (SELECT count(*)=1 FROM public.merchant_users WHERE username=$9 AND role='owner' AND active=TRUE AND must_change_password=TRUE) AS exact_owner,
 (SELECT count(*)=1 FROM public.system_config WHERE store_id=$8::text::uuid AND active=TRUE AND config_key='store.profile'
   AND app_scope='order_client' AND environment='prod' AND country_code='CA' AND region_code='MB' AND city IS NULL
   AND config_value->>'name'=$10) AS exact_profile,
 (SELECT count(*)=1 FROM public.saas_instances i JOIN public.saas_provisioning_operations o USING(instance_id)
   WHERE i.singleton_key=TRUE AND o.idempotency_key=$6 AND o.status='completed'
   AND i.external_instance_id=$1 AND i.metadata->>'configuration_hash'=$2
   AND i.metadata->>'image_revision'=$7 AND i.metadata->>'template_version_id'=$11
   AND i.external_operation_epoch=$3::integer AND i.external_operation_intent='provision'
   AND i.external_operation_marker=$4 AND i.external_operation_hash=$5
   AND i.external_operation_request_sha256=o.request_sha256 AND o.request_sha256 ~ '^[a-f0-9]{64}$'
   AND i.external_operation_result=o.result AND o.result->>'success'='true'
   AND o.result->>'external_operation_epoch'=($3::integer)::text AND o.result->>'external_operation_intent'='provision'
   AND o.result->>'external_operation_marker'=$4 AND o.result->>'external_operation_hash'=$5
   AND o.result->>'instance_id'=i.instance_id::text AND o.result->>'store_id'=$8::text
   AND o.result->'first_owner'->>'created'='true'
   AND o.result->'first_owner'->'merchant_user'->>'username'=$9) AS exact_original_completed_receipt,
 (SELECT count(*)=1 FROM public.saas_audit_logs WHERE action='instance.provisioned'
   AND after_value->>'external_instance_id'=$1 AND after_value->>'store_id'=$8::text
   AND metadata->>'idempotency_key'=$6 AND metadata->>'external_operation_epoch'=($3::integer)::text
   AND metadata->>'external_operation_marker'=$4 AND metadata->>'external_operation_hash'=$5) AS exact_provision_audit`;

export function auditProgram({ historical, seed, readiness }) {
  requireAudit(seed.target.endpoint === A.endpoint && seed.target.database === A.database && seed.target.role === A.role &&
    seed.target.databaseOid === A.databaseOid && seed.target.roleOid === A.roleOid && seed.target.managementRoleOid === A.managementRoleOid &&
    seed.snapshot.length === 8 && hash(seed.snapshot) === A.snapshotSha256 && readiness.STATE_FLAGS.length === 13, 'PROGRAM_SOURCE');
  const p = historical.plan, epoch = p.pendingExternalFence;
  const fencedKey = 'tlctl-' + hash(p.idempotencyKey).slice(0, 32) + '-e1-' + epoch.operationHash.slice(0, 16);
  const summaryValues = [p.scope.appInstanceId, p.scope.configurationHash, 1, epoch.marker, epoch.operationHash, fencedKey,
    R.oldDigest, seed.seed.expectedReturnedRow.store_id, 'techlong_sandbox_admin', 'Techlong Sandbox', p.templateVersionId];
  const statements = [...structuredClone(seed.snapshot), { text: readiness.STATE_SQL,
    values: [p.scope.appInstanceId, p.scope.configurationHash, [...readiness.ENTITLEMENTS]] }, { text: SUMMARY_SQL, values: summaryValues }];
  return { schema: 'techlong/initialization-audit-program/v1', target: seed.target, comments: seed.comments,
    expectedStore: seed.seed.expectedReturnedRow, flags: [...readiness.STATE_FLAGS], fencedKey,
    begin: 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY', search: 'SET LOCAL search_path = pg_catalog',
    lock: "SET LOCAL lock_timeout = '5000ms'", statements, statementsSha256: hash(statements),
    normalSqlCalls: 14, maximumRollbackCalls: 1, maximumConnections: 1, automaticRetries: 0 };
}
export function verifyCatalog(results) {
  requireAudit(results.length >= 4, 'ENVELOPE_ROWS');
  const [identity, roles, databases, catalog] = results, v = identity.rows?.[0];
  requireAudit(identity.rowCount === 1 && v?.database === A.database && v.database_oid === A.databaseOid &&
    v.username === 'postgres' && v.session_username === 'postgres' && v.role_oid === A.managementRoleOid &&
    v.server_version_num === 170009 && v.read_only === 'on' && v.isolation === 'serializable' && v.backend_tls_active === true &&
    roles.rowCount === 1 && hash(roles.rows[0]) === A.roleSha && databases.rowCount === 4 && hash(databases.rows) === A.acl &&
    catalog.rowCount === 1 && hash(catalog.rows[0]?.identity) === A.catalog, 'CATALOG_OR_IDENTITY_DIVERGED');
}
export function classifyInitialization(results, program) {
  verifyCatalog(results);
  return { ...classifyAuditDataRows(results.slice(4), program), catalogAndOwnershipVerified: true };
}
// Pure classification only, never an execution/admission capability. Runtime
// calls the catalog-validating wrapper above, not this data-only helper.
export function classifyAuditDataRows(data, program) {
  requireAudit(data.length === 6 && data.slice(1).every(r => r.rowCount === 1) && data[0].rowCount === 73, 'RESULT_SHAPE');
  const [counts, guard, singleton, store, ready, extra] = data;
  requireAudit(same(guard.rows[0], { database_comment: program.comments.database, role_comment: program.comments.role, bootstrap_guard_absent: true }), 'OWNER_COMMENT_DIVERGED');
  const flags = ready.rows[0], summary = extra.rows[0];
  requireAudit(same(Object.keys(flags).sort(), [...program.flags].sort()) && Object.values(flags).every(v => [true, false, null].includes(v)) &&
    same(Object.keys(summary).sort(), ['instances', 'operations', 'merchant_users', 'audit_rows', 'profiles', 'exact_default_store',
      'exact_owner', 'exact_profile', 'exact_original_completed_receipt', 'exact_provision_audit'].sort()) &&
    ['instances', 'operations', 'merchant_users', 'audit_rows', 'profiles'].every(k => Number.isSafeInteger(summary[k]) && summary[k] >= 0) &&
    ['exact_default_store', 'exact_owner', 'exact_profile', 'exact_original_completed_receipt', 'exact_provision_audit'].every(k => typeof summary[k] === 'boolean'), 'FLAGS_OR_SUMMARY_SHAPE');
  const sameStore = same(store.rows[0], { ...program.expectedStore, empty_contact: true, initial_timestamps: true });
  const pristine = singleton.rows[0].pristine === true && hash(counts.rows) === A.pristineCounts && sameStore &&
    same(singleton.rows[0].entitlements, expectedEntitlements) && summary.instances === 1 && summary.operations === 0 &&
    summary.merchant_users === 0 && summary.audit_rows === 0 && summary.profiles === 0 && summary.exact_default_store &&
    !summary.exact_owner && !summary.exact_profile && !summary.exact_original_completed_receipt && !summary.exact_provision_audit &&
    ['instance_matches', 'provisioned', 'configuration_matches', 'epoch_valid', 'receipt_matches', 'owner_present'].every(k => flags[k] !== true);
  const committed = program.flags.every(k => flags[k] === true) && summary.instances === 1 && summary.operations === 1 &&
    summary.merchant_users === 1 && summary.exact_default_store && summary.exact_owner && summary.exact_profile &&
    summary.exact_original_completed_receipt && summary.exact_provision_audit;
  return { schema: 'techlong/initialization-audit-facts/v1', outcome: pristine ? 'PRISTINE_UNINITIALIZED_NO_POST_AUTHORITY'
    : committed ? 'ORIGINAL_COMMIT_CANDIDATE_CONTROL_VERIFICATION_REQUIRED' : 'DIVERGED_OR_PARTIAL_NO_RETRY',
    ownershipCommentsVerified: true, fullPristineSnapshotMatches: pristine, originalCommitCandidate: committed,
    runtimeReadinessFlags: flags, countsAndBooleanSummary: summary, rowCountsSha256: hash(counts.rows),
    defaultStoreUnchanged: sameStore, statementsSha256: program.statementsSha256,
    initializedApiVerified: false, effectiveConfigurationApiVerified: false, platformReady: false, provisionAuthorized: false };
}
export function auditWindow(preparedAt, workloadExpiresAt) {
  return { preparedAt, admissionExpiresAt: Math.min(preparedAt + 2 * 3600000, Date.parse(workloadExpiresAt) - 10 * 60000),
    workloadExpiresAt };
}
export function assertAuditWindow(plan, now) {
  requireAudit(Number.isSafeInteger(plan.preparedAt) && now >= plan.preparedAt && now < plan.admissionExpiresAt &&
    plan.admissionExpiresAt === Math.min(plan.preparedAt + 2 * 3600000, Date.parse(plan.workloadExpiresAt) - 10 * 60000) &&
    Date.parse(plan.workloadExpiresAt) - now > 10 * 60000, 'APPROVAL_EXPIRED_NO_SQL');
}
