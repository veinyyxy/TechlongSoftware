import { R, hash, same } from './express-workload-recovery-plan-v1.mjs';
import { JOIN_SQL, SESSION_SQL, CATALOG_SQL, CATALOG_BODY_SQL, scopeValues } from './express-ready-reconciliation-plan-v1.mjs';
export { hash, same, SESSION_SQL, CATALOG_SQL };
export const H = Object.freeze({ ...R,
  stack: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917',
  oldTask: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:2',
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-k3r-hosting-resume-risk.md',
  slot: 'F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1.permanent-slot.json',
  writeSlot: 'F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1.write-slot.json',
  inspectSlot: 'F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1.inspect-slot.json',
  ttlMs: 7200000, expiryToken: '__EXECUTION_STARTED_AT_PLUS_7200_SECONDS__', outputKey: 'workloadRestorationV1' });
export function must(ok, code) { if (!ok) throw Error('HOSTING_RESUME_' + code); }
const sha = text => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${text})::text,'UTF8')),'hex')`;
const aliases = ['d', 'a', 'j', 'r', 'o', 'e', 'w', 'sub', 'tv'];
const hashes = masked => `jsonb_build_object(${aliases.map(a => `'${a}',${sha(`to_jsonb(${a})${masked && a === 'd' ? " - ARRAY['outputs','updated_at']::text[]" : ''}`)}`).join(',')})`;
const identity = `jsonb_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'role',current_user,'roleOid',(SELECT oid::text FROM pg_roles WHERE rolname=current_user),'version',current_setting('server_version_num'),'timezone',current_setting('TimeZone'))`;
export const RESUME_STATE_SQL = `SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint::text AS db_now,
 current_setting('transaction_read_only') AS read_only,${identity} AS identity,${hashes(false)} AS hashes,${hashes(true)} AS stable_hashes,
 d.status AS deployment_status,d.artifact_ref,d.current_step,a.status AS instance_status,j.status AS job_status,j.attempts,j.max_attempts,
 j.lease_token IS NULL AND j.lease_owner IS NULL AND j.lease_expires_at IS NULL AS lease_cleared,
 d.outputs::jsonb->>'stackId' AS stack_id,d.outputs::jsonb->>'observationSha256' AS observation_sha256,
 ${sha('d.outputs')} AS outputs_text_sha256,${sha('d.outputs::jsonb')} AS outputs_json_sha256,octet_length(d.outputs::jsonb::text) AS outputs_json_octets,
 d.outputs::jsonb->'manualReadyReconciliationV1'->'receipt'=$9::jsonb AS original_receipt_intact,
 NOT(d.outputs::jsonb ? 'workloadRestorationV1') AS restoration_slot_absent,
 COALESCE(d.outputs::jsonb->'workloadRestorationV1'->'receipt'=$10::jsonb,false) AS restoration_receipt_matches,
 ${sha("d.outputs::jsonb->'workloadRestorationV1'->'previousOutputs'")} AS previous_outputs_sha256,
 d.updated_at::text AS deployment_updated_at ${JOIN_SQL}`;
export const stateValues = (input, receipt = null) => [...scopeValues(input.base.historical, input.ready.write.receipt), JSON.stringify(receipt)];
export function stable(s) { const c = { ...s }; delete c.db_now; return c; }
export function validateResumeBefore(s, input) {
  must(s.read_only === 'on' && same(s.identity, input.ready.independent.snapshot.identity) && same(s.hashes, input.ready.independent.snapshot.hashes) && s.original_receipt_intact === true &&
    s.stack_id === H.stack && s.deployment_status === 'ready' && s.instance_status === 'active' && s.job_status === 'succeeded' &&
    s.attempts === 1 && s.max_attempts === 1 && s.lease_cleared && s.restoration_slot_absent && !s.restoration_receipt_matches &&
    s.current_step === 'ready' && s.artifact_ref.endsWith('@' + H.newDigest) && s.outputs_json_octets * 2 + 8000 < 32768, 'CURRENT_READY_ROWS_CHANGED');
}
export function resumePlan(input, state, preparedAt) {
  validateResumeBefore(state.snapshot, input);
  must(state.endpointSha256 === input.k2cManifest.plan.endpointSha256 && state.catalog.server_sha256 === input.ready.independent.catalogServerSha256, 'SOURCE_OR_CATALOG_CHANGED');
  const request = structuredClone(input.base.k1.plan.request), template = JSON.parse(request.TemplateBody);
  must(same(Object.fromEntries(Object.entries(template.Resources).map(([n, v]) => [n, v.Type])), H.resources), 'RESOURCE_TYPES');
  for (const r of Object.values(template.Resources)) if (r.Properties?.Tags) {
    must(r.Properties.Tags.filter(t => t.Key === 'ExpiresAt').length === 1, 'EXPIRY_TAG');
    r.Properties.Tags.find(t => t.Key === 'ExpiresAt').Value = H.expiryToken;
  }
  template.Metadata.PublicAcceptanceRestoration = { protocol: 'techlong/hosting-resume/v1', predecessorStackId: H.stack,
    initializedDatabasePreserved: true, provisionAuthorized: false, relativeTtlSeconds: 7200 };
  request.TemplateBody = JSON.stringify(template); request.Tags.find(t => t.Key === 'ExpiresAt').Value = H.expiryToken;
  delete request.ClientRequestToken;
  must(request.Parameters.length === 20 && request.OnFailure === 'ROLLBACK' && !template.Transform && !request.DisableRollback, 'CREATE_SCOPE');
  return { schema: 'techlong/hosting-resume-plan/v1', preparedAt, approvalExpiresAt: preparedAt + 86400000,
    request, requestSkeletonSha256: hash(request), expectedState: stable(state.snapshot), catalogSha256: state.catalog.server_sha256,
    endpointSha256: state.endpointSha256, previousPlatform: input.readyPlatform, ttlFromExecutionMs: H.ttlMs,
    historicalAuthenticatedConfigurationProofAt: input.ready.independent.applicationProof.checkedAt,
    noReinitialization: true, instanceAndJobUnchanged: true, manualRecoveryNotWorkerLease: true,
    limits: { createStack: 1, neonWriteTransactions: 1, changedExistingRows: 1, publicGets: 3, privateLoads: 0,
      secretValueReads: 0, directAuroraConnections: 0, iamWrites: 0, dnsWrites: 0, ddbWrites: 0, applicationPosts: 0, automaticRetries: 0 },
    riskDocument: H.risk, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false };
}
export function admission(p, now) { must(Number.isSafeInteger(p.preparedAt) && p.approvalExpiresAt === p.preparedAt + 86400000 && now >= p.preparedAt && now < p.approvalExpiresAt, 'APPROVAL_EXPIRED'); }
export function bindExecution(p, manifestSha256, startedAt) {
  admission(p, startedAt); must(/^[a-f0-9]{64}$/.test(manifestSha256), 'MANIFEST_SHA');
  const expiresAt = new Date(startedAt + H.ttlMs).toISOString(), request = structuredClone(p.request), template = JSON.parse(request.TemplateBody);
  for (const r of Object.values(template.Resources)) if (r.Properties?.Tags) r.Properties.Tags.find(t => t.Key === 'ExpiresAt').Value = expiresAt;
  request.TemplateBody = JSON.stringify(template); request.Tags.find(t => t.Key === 'ExpiresAt').Value = expiresAt;
  request.ClientRequestToken = 'techlong-k3r-' + hash({ manifestSha256, startedAt, request }).slice(0, 48);
  must(Buffer.byteLength(request.TemplateBody) <= 51200, 'TEMPLATE_SIZE');
  return { schema: 'techlong/hosting-resume-execution/v1', manifestSha256, startedAt, expiresAt,
    finishBefore: startedAt + H.ttlMs - 300000, request, requestSha256: hash(request), retriesAllowed: false };
}
export function executionWindow(x, now) { must(now >= x.startedAt && now < x.finishBefore && Date.parse(x.expiresAt) === x.startedAt + H.ttlMs && x.finishBefore === x.startedAt + H.ttlMs - 300000, 'EXECUTION_EXPIRED'); }
export function platformProjection(row) {
  const p = structuredClone(row);
  for (const k of ['desired_plan', 'configuration_snapshot', 'environment_policy']) { p[k + '_sha256'] = hash(typeof p[k] === 'string' ? JSON.parse(p[k]) : p[k]); delete p[k]; }
  return p;
}
export function validatePlatformProjection(row, previous, receipt) {
  const p = platformProjection(row), omit = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['stack_id', 'observation_sha256', 'deployment_updated_at'].includes(k)));
  must(receipt ? same(omit(p), omit(previous)) && p.stack_id === receipt.stackId && p.observation_sha256 === hash(receipt) &&
    Number(p.deployment_updated_at) >= receipt.checkedAt : same(p, previous), 'PLATFORM_PROJECTION_CHANGED'); return p;
}
export function resumeReceipt(plan, execution, hosting, publicProof, now) {
  must(hosting.live?.stackId?.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:stack/' + H.name + '/') && hosting.live.stackId !== H.stack &&
    hosting.live.digest === H.newDigest && hosting.checkedAt >= execution.startedAt && publicProof.length === 3 &&
    same(publicProof.map(p => [p.path, p.statusCode]), [['/health', 200], ['/ready', 200], ['/api/merchant/stores', 401]]) &&
    publicProof.every(p => p.expectedResponseVerified && Date.parse(p.checkedAt) >= execution.startedAt && Date.parse(p.checkedAt) < execution.finishBefore) &&
    now === Date.parse(publicProof.at(-1).checkedAt), 'NEW_HOSTING_PUBLIC_PROOF');
  return { protocol: 'techlong/hosting-resume-receipt/v1', manifestSha256: execution.manifestSha256, checkedAt: now,
    hostingCheckedAt: hosting.checkedAt, hostingSha256: hash(hosting), publicProofSha256: hash(publicProof),
    stackId: hosting.live.stackId, taskDefinitionArn: hosting.live.taskDefinitionArn, imageDigest: H.newDigest,
    expiresAt: execution.expiresAt, predecessorStackId: H.stack, priorOutputsSha256: plan.expectedState.outputs_json_sha256,
    originalReadyAttributionPreserved: true, reinitialized: false, jobOrInstanceChanged: false,
    authenticatedConfigurationProof: 'HISTORICAL_K2C_NOT_A_FRESH_CONTROL_GET', freshPublicReadiness: true, positiveBusinessAcceptance: false };
}
export function compileRebind(plan, execution, receipt, input) {
  must(receipt.protocol === 'techlong/hosting-resume-receipt/v1' && receipt.manifestSha256 === execution.manifestSha256 &&
    receipt.expiresAt === execution.expiresAt && receipt.predecessorStackId === H.stack && receipt.imageDigest === H.newDigest, 'RECEIPT_SCOPE');
  const now = '(extract(epoch FROM clock_timestamp())*1000)::bigint', values = stateValues(input, receipt), s = plan.expectedState;
  const lock = `SELECT 1/CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (SELECT d.id ${JOIN_SQL}
    AND d.outputs::jsonb->'manualReadyReconciliationV1'->'receipt'=$9::jsonb AND $10::jsonb IS NOT NULL
    AND ${hashes(false)}=$11::jsonb AND ${identity}=$12::jsonb
    AND e.status='active' AND e.apply_enabled=0 AND e.admission_state='open' AND e.admission_epoch=0 AND e.admission_stack_id IS NULL
    AND w.status='active' AND sub.status='active' AND sub.current_period_end>${now}
    AND ${now}<$13::bigint AND ${now}>=$14::bigint AND ${now}-$14::bigint<=30000 AND ${now}>=$15::bigint AND ${now}-$15::bigint<=30000
    FOR UPDATE OF e,w,sub,tv,d,a,j,r,o) locked`;
  const statements = [{ text: SESSION_SQL, values: [] },
    { text: lock, values: [...values, JSON.stringify(s.hashes), JSON.stringify(s.identity), execution.finishBefore, receipt.checkedAt, receipt.hostingCheckedAt] },
    { text: `WITH inventory AS (${CATALOG_BODY_SQL}) SELECT 1/CASE WHEN ${sha('catalog')}=$1 THEN 1 ELSE 0 END AS accepted FROM inventory`, values: [plan.catalogSha256] },
    { text: `WITH changed AS (UPDATE public.app_instance_deployments SET outputs=(outputs::jsonb || jsonb_build_object('stackId',$2::text,'observationSha256',$3::text,
      'workloadRestorationV1',jsonb_build_object('receipt',$4::jsonb,'previousOutputs',outputs::jsonb)))::text,updated_at=${now}
      WHERE id=$1 AND status='ready' AND NOT(outputs::jsonb ? 'workloadRestorationV1') RETURNING id)
      SELECT 1/CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM changed`, values: [input.base.historical.plan.scope.deploymentId, receipt.stackId, hash(receipt), JSON.stringify(receipt)] },
    { text: `SELECT 1/CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (SELECT d.id ${JOIN_SQL}
      AND d.outputs::jsonb->'manualReadyReconciliationV1'->'receipt'=$9::jsonb AND d.outputs::jsonb->'workloadRestorationV1'->'receipt'=$10::jsonb
      AND ${hashes(true)}=$11::jsonb AND ${sha("d.outputs::jsonb->'workloadRestorationV1'->'previousOutputs'")}=$12
      AND d.outputs::jsonb->>'stackId'=$13 AND d.outputs::jsonb->>'observationSha256'=$14
      AND ${now}<$15::bigint AND ${now}>=$16::bigint AND ${now}-$16::bigint<=30000 AND ${now}>=$17::bigint AND ${now}-$17::bigint<=30000) verified`,
    values: [...values, JSON.stringify(s.stable_hashes), s.outputs_json_sha256, receipt.stackId, hash(receipt), execution.finishBefore, receipt.checkedAt, receipt.hostingCheckedAt] }];
  return { schema: 'techlong/hosting-rebind-program/v1', statements, programSha256: hash(statements), receipt, changedRows: 1, retriesAllowed: false };
}
export function validateRebound(s, plan, execution, receipt) {
  must(s.read_only === 'on' && same(s.identity, plan.expectedState.identity) && same(s.stable_hashes, plan.expectedState.stable_hashes) &&
    s.original_receipt_intact && s.restoration_receipt_matches && !s.restoration_slot_absent && s.stack_id === receipt.stackId &&
    s.observation_sha256 === hash(receipt) && s.previous_outputs_sha256 === plan.expectedState.outputs_json_sha256 &&
    Number(s.deployment_updated_at) >= receipt.checkedAt && Number(s.deployment_updated_at) < execution.finishBefore, 'REBOUND_NOT_PROVED');
}
