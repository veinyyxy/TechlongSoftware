import { hash, same, A } from './express-initialization-audit-plan-v1.mjs';
import { R } from './express-workload-recovery-plan-v1.mjs';
export { hash, same };
export const C = Object.freeze({
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-risk.md',
  slot: 'F:/ChatGPT_workshop/techlong-express-k2c-ready-v1.permanent-slot.json',
  writeSlot: 'F:/ChatGPT_workshop/techlong-express-k2c-ready-v1.write-slot.json',
  inspectSlot: 'F:/ChatGPT_workshop/techlong-express-k2c-ready-v1.inspect-slot.json',
  initializedManifestSha: '7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017',
  jobId: 'job_202c8dc12a8bf379f3a7c693', outputKey: 'manualReadyReconciliationV1',
});
export function must(ok, code) { if (!ok) throw Error('READY_RECONCILIATION_' + code); }
const sha = sql => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${sql})::text,'UTF8')),'hex')`;
const rowHash = alias => sha(`pg_catalog.to_jsonb(${alias})`);
const masks = {
  d: ['artifact_ref', 'status', 'current_step', 'outputs', 'ready_at', 'updated_at'],
  a: ['status', 'access_url', 'provisioned_at', 'suspended_at', 'updated_at'],
  j: ['status', 'lease_owner', 'lease_token', 'lease_expires_at', 'completed_at', 'updated_at'],
};
const maskHash = a => sha(`pg_catalog.to_jsonb(${a}) - ARRAY[${masks[a].map(s => `'${s}'`).join(',')}]::text[]`);
const aliases = ['d', 'a', 'j', 'r', 'o', 'e', 'w', 'sub', 'tv'];
const hashObject = mask => `pg_catalog.jsonb_build_object(${aliases.map(a => `'${a}',${mask && masks[a] ? maskHash(a) : rowHash(a)}`).join(',')})`;
const identitySql = `pg_catalog.jsonb_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'role',current_user,'roleOid',(SELECT oid::text FROM pg_roles WHERE rolname=current_user),
 'version',current_setting('server_version_num'),'timezone',current_setting('TimeZone'))`;
export const JOIN_SQL = `FROM public.app_instance_deployments d
 JOIN public.app_instances a ON a.id=d.app_instance_id
 JOIN public.deployment_jobs j ON j.deployment_id=d.id AND j.id=$2
 JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
 JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
 JOIN public.deployment_environments e ON e.id=d.environment_id
 JOIN public.workspaces w ON w.id=a.workspace_id
 JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id
 JOIN public.app_instance_template_versions tv ON tv.id=a.template_version_id
 WHERE d.id=$1 AND a.id=$3 AND a.workspace_id=$4 AND a.product_id=$5 AND a.template_version_id=$6
 AND d.environment_id=$7 AND d.subscription_id=$8`;
export const SESSION_SQL = `SELECT pg_catalog.set_config('search_path','pg_catalog',true) AS search_path,
 pg_catalog.set_config('statement_timeout','15000',true) AS statement_timeout,
 pg_catalog.set_config('lock_timeout','5000',true) AS lock_timeout`;
export const SNAPSHOT_SQL = `SELECT
 (extract(epoch FROM clock_timestamp())*1000)::bigint::text AS db_now,
 current_setting('transaction_read_only') AS read_only,
 ${identitySql} AS identity,
 ${hashObject(false)} AS hashes,${hashObject(true)} AS unchanged_hashes,
 d.status AS deployment_status,d.artifact_ref,d.current_step,a.status AS instance_status,a.access_url,a.suspended_at::text,
 j.status AS job_status,j.attempts,j.max_attempts,j.lease_owner,j.lease_expires_at::text,
 j.lease_token IS NOT NULL AS lease_present,j.lease_expires_at<(extract(epoch FROM clock_timestamp())*1000)::bigint AS lease_expired,
 ${sha('d.outputs')} AS outputs_text_sha256,${sha('d.outputs::jsonb')} AS outputs_json_sha256,
 octet_length(d.outputs) AS outputs_octets,octet_length(d.outputs::jsonb::text) AS outputs_json_octets,
 NOT(d.outputs::jsonb ? 'manualReadyReconciliationV1') AS receipt_slot_absent,
 COALESCE(d.outputs::jsonb->'manualReadyReconciliationV1'->'receipt'=$9::jsonb,false) AS receipt_matches,
 ${sha("d.outputs::jsonb->'manualReadyReconciliationV1'->'previousOutputs'")} AS previous_outputs_sha256,
 d.outputs::jsonb->>'stackId' AS stack_id,d.outputs::jsonb->>'observationSha256' AS observation_sha256,
 d.ready_at::text,a.provisioned_at::text,j.completed_at::text,
 d.updated_at::text AS deployment_updated_at,a.updated_at::text AS instance_updated_at,j.updated_at::text AS job_updated_at
 ${JOIN_SQL}`;
// Catalog metadata only. Function bodies are inspected during preparation and
// fingerprinted server-side; no application/lease-token row values are returned.
export const CATALOG_BODY_SQL = `SELECT pg_catalog.jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',pg_get_userbyid(c.relowner),
 'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(SELECT jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'default',pg_get_expr(ad.adbin,ad.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(x.oid) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,
 'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid),
 'rules',(SELECT jsonb_agg(pg_get_ruledef(x.oid) ORDER BY x.rulename) FROM pg_rewrite x WHERE x.ev_class=c.oid),
 'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'roles',p.polroles::text,
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid)) ORDER BY c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['app_instances','app_instance_deployments','deployment_jobs'])),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
 'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
 AND NOT EXISTS(SELECT 1 FROM pg_depend x WHERE x.classid='pg_proc'::regclass AND x.objid=p.oid AND x.deptype='e')),
 'eventTriggers',(SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'enabled',e.evtenabled,'function',e.evtfoid::regprocedure::text) ORDER BY e.evtname) FROM pg_event_trigger e)
 ) AS catalog`;
export const CATALOG_SQL = `WITH inventory AS (${CATALOG_BODY_SQL}) SELECT catalog,${sha('catalog')} AS server_sha256 FROM inventory`;
export function scopeValues(historical, receipt = null) {
  const p = historical.plan, i = p.pendingExternalFence.resourceFence.identity;
  return [p.scope.deploymentId, C.jobId, p.scope.appInstanceId, i.workspaceId, i.productId, p.templateVersionId,
    p.scope.environmentId, p.subscriptionId, JSON.stringify(receipt)];
}
export function stableSnapshot(s) { const stable = { ...s }; delete stable.db_now; return stable; }
export function validateOldSnapshot(s, historical) {
  must(s && s.read_only === 'on' && same(Object.keys(s.hashes).sort(), [...aliases].sort()) &&
    same(Object.keys(s.unchanged_hashes).sort(), [...aliases].sort()) &&
    [...Object.values(s.hashes), ...Object.values(s.unchanged_hashes)].every(v => /^[a-f0-9]{64}$/.test(v)) &&
    s.deployment_status === 'configuring' && s.artifact_ref === historical.plan.scope.artifactRef &&
    s.instance_status === 'pending' && [null, 'https://first-acceptance.sandbox.techlong.cloud'].includes(s.access_url) &&
    s.job_status === 'running' && s.attempts === 1 && s.max_attempts === 1 &&
    s.lease_owner === 'express-reviewed-first-delivery-v1' && s.lease_present === true && s.lease_expired === true &&
    s.receipt_slot_absent === true && s.receipt_matches === false && s.stack_id === null && s.observation_sha256 === null &&
    s.ready_at === null && s.provisioned_at === null && s.completed_at === null && s.outputs_octets >= 2 &&
    s.outputs_json_octets * 2 + 8000 < 32768,
  'OLD_SNAPSHOT_REJECTED');
}
// Derivation consumes a captured catalog digest, not invented catalog rows.
// The observer separately validates the real inventory and database clock.
export function readyPlan({ base, initialized, snapshot, catalogServerSha256, endpointSha256 }, preparedAt) {
  validateOldSnapshot(snapshot, base.historical);
  const proof = initialized.independent.apiProof;
  must(initialized.approvedManifestSha256 === C.initializedManifestSha && initialized.approvalConsumed === true &&
    initialized.replayAllowed === false && initialized.state === 'APPLICATION_INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED' &&
    proof.initialized.ready === true && proof.freshAuthenticatedApiReadback === true && proof.exactStoreVerified === true &&
    proof.initialized.imageRevision === R.newDigest && proof.initialized.desiredConfigurationHash === base.historical.plan.scope.configurationHash &&
    /^[a-f0-9]{64}$/.test(catalogServerSha256) && /^[a-f0-9]{64}$/.test(endpointSha256), 'INITIALIZED_OR_CATALOG_PROOF');
  const expiry = initialized.workloadExpiresAt, admission = Math.min(preparedAt + 2 * 3600000, Date.parse(expiry) - 45 * 60000);
  const plan = { schema: 'techlong/manual-ready-reconciliation-plan/v1', preparedAt, admissionExpiresAt: admission,
    executionExpiresAt: Math.min(admission + 15 * 60000, Date.parse(expiry) - 10 * 60000), workloadExpiresAt: expiry,
    historicalScope: base.historical.plan.scope, jobId: C.jobId, stackId: A.stackId, taskDefinitionArn: A.taskDefinitionArn,
    actualArtifactRef: R.registry + '/' + R.repository + '@' + R.newDigest,
    accessUrl: 'https://first-acceptance.sandbox.techlong.cloud',
    controlPolicy: { ...base.publicInputs.source.material.controlPolicy, imageRevision: R.newDigest },
    externalFence: { ...base.historical.plan.pendingExternalFence, state: 'active' },
    hostname: 'first-acceptance.sandbox.techlong.cloud', storeId: base.auditManifest.plan.program.expectedStore.store_id,
    publicParametersSha256: base.historical.plan.publicParametersSha256,
    expectedSnapshot: stableSnapshot(snapshot), sourcePlatform: initialized.platform, catalogServerSha256,
    endpointSha256, initializedEvidenceSha256: hash(initialized), riskDocument: C.risk,
    manualJobCompletionNotAWorkerLease: true, originalPlanHashAndIdempotencyPreserved: true,
    limits: { writeTransactions: 1, changedExistingRows: 3, newRows: 0, privateBundleLoads: 2, authenticatedGets: 4,
      secretValueReads: 0, auroraConnections: 0, provisionPosts: 0, cloudWrites: 0, automaticRetries: 0 },
    apiMaximumAgeMs: 30000, cloudMaximumAgeMs: 30000, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false };
  assertWindow(plan, preparedAt, true); return plan;
}
export function assertWindow(p, now, admission = false) {
  must(now >= p.preparedAt && now < (admission ? p.admissionExpiresAt : p.executionExpiresAt) &&
    p.admissionExpiresAt === Math.min(p.preparedAt + 2 * 3600000, Date.parse(p.workloadExpiresAt) - 45 * 60000) &&
    p.executionExpiresAt === Math.min(p.admissionExpiresAt + 15 * 60000, Date.parse(p.workloadExpiresAt) - 10 * 60000), 'WINDOW_EXPIRED');
}
export function makeReceipt(plan, manifestSha256, api, hosting, checkedAt) {
  must(api.ready === true && api.desiredConfigurationHash === plan.historicalScope.configurationHash &&
    api.imageRevision === plan.controlPolicy.imageRevision && hosting.live.stackId === plan.stackId &&
    hosting.live.taskDefinitionArn === plan.taskDefinitionArn, 'READY_API_OR_HOSTING');
  return { protocol: 'techlong/manual-ready-reconciliation/v1', manifestSha256, initializedEvidenceSha256: plan.initializedEvidenceSha256,
    checkedAt, hostingCheckedAt: hosting.checkedAt, hostingObservationSha256: hash(hosting),
    configurationHash: api.desiredConfigurationHash, imageRevision: api.imageRevision,
    stackId: plan.stackId, taskDefinitionArn: plan.taskDefinitionArn, initializedVerified: true, effectiveConfigurationVerified: true,
    exactStoreVerified: true, manualRecoveryNotWorkerLease: true, source: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev',
    originalArtifactRef: plan.historicalScope.artifactRef, originalPlanHash: plan.historicalScope.planHash,
    previousSnapshot: plan.expectedSnapshot.hashes, previousOutputsTextSha256: plan.expectedSnapshot.outputs_text_sha256,
    previousLease: { worker: plan.expectedSnapshot.lease_owner, expiresAt: plan.expectedSnapshot.lease_expires_at,
      rawTokenIncluded: false, fullJobSha256: plan.expectedSnapshot.hashes.j } };
}
export function compileReadyProgram(plan, receipt, historical) {
  const values = scopeValues(historical, receipt), p = plan, old = p.expectedSnapshot;
  must(receipt.protocol === 'techlong/manual-ready-reconciliation/v1' && receipt.initializedEvidenceSha256 === p.initializedEvidenceSha256 &&
    receipt.stackId === p.stackId && receipt.configurationHash === p.historicalScope.configurationHash && receipt.imageRevision === R.newDigest &&
    same(receipt.previousSnapshot, old.hashes), 'PROGRAM_RECEIPT');
  const now = `(extract(epoch FROM clock_timestamp())*1000)::bigint`;
  const add = (text, parameters) => ({ text, values: parameters });
  const lock = `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (SELECT d.id ${JOIN_SQL}
    AND $9::jsonb IS NOT NULL AND ${hashObject(false)}=$10::jsonb AND ${identitySql}=$13::jsonb AND j.lease_expires_at<${now}
    AND e.status='active' AND e.apply_enabled=0 AND e.admission_state='open' AND e.admission_epoch=0 AND e.admission_stack_id IS NULL
    AND w.status='active' AND sub.status='active' AND sub.current_period_end>${now}
    AND ${now}<$11::bigint AND ${now}>=$12::bigint AND ${now}-$12::bigint<=30000
    AND ${now}>=$14::bigint AND ${now}-$14::bigint<=30000
    FOR UPDATE OF e,w,sub,tv,d,a,j,r,o) locked`;
  const catalogGuard = `WITH inventory AS (${CATALOG_BODY_SQL}) SELECT 1 / CASE WHEN ${sha('catalog')}=$1 THEN 1 ELSE 0 END AS accepted FROM inventory`;
  const changed = text => `WITH changed AS (${text} RETURNING id) SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM changed`;
  const observationSha256 = hash(receipt);
  const statements = [add(SESSION_SQL, []), add(lock, [...values, JSON.stringify(old.hashes), p.executionExpiresAt, receipt.checkedAt, JSON.stringify(old.identity), receipt.hostingCheckedAt]),
    add(catalogGuard, [p.catalogServerSha256]),
    add(changed(`UPDATE public.app_instances SET status='active',access_url=$2,provisioned_at=${now},suspended_at=NULL,updated_at=${now}
      WHERE id=$1 AND status='pending'`), [p.historicalScope.appInstanceId, p.accessUrl]),
    add(changed(`UPDATE public.app_instance_deployments SET status='ready',artifact_ref=$2,current_step='ready',ready_at=${now},updated_at=${now},
      outputs=(outputs::jsonb || jsonb_build_object('stackId',$3::text,'observationSha256',$4::text,'initializedVerified',true,'effectiveConfigurationVerified',true,
      'manualReadyReconciliationV1',jsonb_build_object('receipt',$5::jsonb,'previousOutputs',outputs::jsonb)))::text
      WHERE id=$1 AND status='configuring' AND artifact_ref=$6 AND NOT(outputs::jsonb ? 'manualReadyReconciliationV1')`),
    [p.historicalScope.deploymentId, p.actualArtifactRef, p.stackId, observationSha256, JSON.stringify(receipt), p.historicalScope.artifactRef]),
    add(changed(`UPDATE public.deployment_jobs SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      completed_at=${now},updated_at=${now} WHERE id=$1 AND status='running' AND attempts=1 AND max_attempts=1 AND lease_expires_at<${now}`), [C.jobId]),
    add(`SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (SELECT d.id ${JOIN_SQL}
      AND ${hashObject(true)}=$10::jsonb AND d.status='ready' AND d.artifact_ref=$11 AND a.status='active' AND a.access_url=$12
      AND d.current_step='ready' AND a.suspended_at IS NULL
      AND j.status='succeeded' AND j.lease_owner IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL
      AND d.outputs::jsonb->'manualReadyReconciliationV1'->'receipt'=$9::jsonb
      AND ${sha("d.outputs::jsonb->'manualReadyReconciliationV1'->'previousOutputs'")}=$13
      AND ${now}<$14::bigint AND ${now}-$15::bigint<=30000 AND ${now}-$16::bigint<=30000) verified`,
    [...values, JSON.stringify(old.unchanged_hashes), p.actualArtifactRef, p.accessUrl, old.outputs_json_sha256, p.executionExpiresAt, receipt.checkedAt, receipt.hostingCheckedAt])];
  return { schema: 'techlong/manual-ready-program/v1', isolationLevel: 'Serializable', readOnly: false,
    statements, statementCount: 7, changedRows: 3, receipt, receiptSha256: observationSha256,
    programSha256: hash(statements), automaticRetries: 0 };
}
export function validateReadySnapshot(s, plan, receipt) {
  must(s && same(s.identity, plan.expectedSnapshot.identity) && same(s.unchanged_hashes, plan.expectedSnapshot.unchanged_hashes) &&
    s.deployment_status === 'ready' && s.artifact_ref === plan.actualArtifactRef && s.instance_status === 'active' && s.access_url === plan.accessUrl &&
    s.current_step === 'ready' && s.suspended_at === null && s.lease_expired === null &&
    s.job_status === 'succeeded' && s.attempts === 1 && s.max_attempts === 1 && s.lease_present === false && s.lease_owner === null &&
    s.lease_expires_at === null && s.receipt_slot_absent === false && s.receipt_matches === true &&
    s.stack_id === plan.stackId && s.observation_sha256 === hash(receipt) && s.previous_outputs_sha256 === plan.expectedSnapshot.outputs_json_sha256 &&
    [s.ready_at, s.provisioned_at, s.completed_at, s.deployment_updated_at, s.instance_updated_at, s.job_updated_at]
      .every(v => /^[0-9]{13}$/.test(v) && Number(v) >= receipt.checkedAt && Number(v) < plan.executionExpiresAt),
  'READY_SNAPSHOT_NOT_PROVED'); return s;
}
export function validateReadyPlatform(row, plan, receipt) {
  const safe = structuredClone(row), decode = v => typeof v === 'string' ? JSON.parse(v) : v;
  for (const key of ['desired_plan', 'configuration_snapshot', 'environment_policy']) {
    safe[key + '_sha256'] = hash(decode(safe[key])); delete safe[key];
  }
  const mutable = ['deployment_status', 'artifact_ref', 'instance_status', 'job_status', 'lease_cleared',
    'lease_expires_at', 'lease_expired', 'job_updated_at', 'deployment_updated_at', 'stack_id', 'observation_sha256'];
  const unchanged = v => Object.fromEntries(Object.entries(v).filter(([k]) => !mutable.includes(k)));
  must(same(unchanged(safe), unchanged(plan.sourcePlatform)) && safe.deployment_status === 'ready' && safe.instance_status === 'active' &&
    safe.job_status === 'succeeded' && safe.artifact_ref === plan.actualArtifactRef && safe.stack_id === plan.stackId &&
    safe.observation_sha256 === hash(receipt) && safe.lease_cleared === true && safe.lease_expires_at === null && safe.lease_expired === null &&
    [safe.deployment_updated_at, safe.job_updated_at].every(v => Number(v) >= receipt.checkedAt && Number(v) < plan.executionExpiresAt),
  'READY_PROVIDER_PLATFORM_PROJECTION'); return safe;
}
