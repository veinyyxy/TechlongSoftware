import { A, hash, same } from './express-initialization-audit-plan-v1.mjs';
import { R } from './express-workload-recovery-plan-v1.mjs';
export { hash, same };
export const B = Object.freeze({
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-risk.md',
  slot: 'F:/ChatGPT_workshop/techlong-express-k2b-initialization-recovery-v1.permanent-slot.json',
  postSlot: 'F:/ChatGPT_workshop/techlong-express-k2b-initialization-recovery-v1.post-slot.json',
  auditManifestSha: 'e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1',
  sourceMaterialSha: 'db70c7461464910bff782619a2168a99a29adef45e8ab97a4ca2f227bdf17057',
  privateDirectory: 'F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2',
});
export function must(ok, code) { if (!ok) throw Error('INITIALIZATION_RECOVERY_' + code); }
export function assertPristine(receipt) {
  must(receipt?.readOnly === true && receipt.connections === 1 && receipt.sqlCalls === 14 && receipt.clientTlsVerified && receipt.backendTlsVerified &&
    receipt.target?.database === A.database && receipt.target.databaseOid === A.databaseOid && receipt.target.endpoint === A.endpoint &&
    receipt.facts?.outcome === 'PRISTINE_UNINITIALIZED_NO_POST_AUTHORITY' && receipt.facts.fullPristineSnapshotMatches === true &&
    receipt.facts.catalogAndOwnershipVerified === true && receipt.facts.rowCountsSha256 === A.pristineCounts &&
    receipt.facts.provisionAuthorized === false, 'CURRENT_PRISTINE_REQUIRED');
}
export function manualRecoveryPlan(input, preparedAt) {
  const { historical, k1, audit, publicInputs } = input, old = historical.plan, m = structuredClone(publicInputs.source.material);
  m.scope.ownerDeploymentId = old.scope.deploymentId;
  assertPristine(audit.sqlReceipt);
  must(audit.approvedManifestSha256 === B.auditManifestSha && audit.approvalConsumed === true && audit.replayAllowed === false &&
    audit.state === 'PRISTINE_UNINITIALIZED_AUDIT_COMPLETED_NO_POST_AUTHORITY' &&
    hash(m) === B.sourceMaterialSha && publicInputs.privatePlan.targetMaterialSha256 === B.sourceMaterialSha &&
    same(publicInputs.privatePlan.targetScope, old.scope) && m.controlPolicy.imageRevision === R.oldDigest &&
    m.controlPolicy.configurationHash === old.scope.configurationHash && hash(m.plan) === old.scope.planHash &&
    k1.plan.expiresAt === audit.workloadExpiresAt && audit.sqlReceipt.facts.statementsSha256 === input.auditManifest.plan.program.statementsSha256,
  'PROVENANCE');
  const expiry = Date.parse(k1.plan.expiresAt), admission = Math.min(preparedAt + 2 * 3600000, expiry - 45 * 60000);
  const result = { schema: 'techlong/manual-initialization-recovery-plan/v1', preparedAt, admissionExpiresAt: admission,
    executionExpiresAt: Math.min(admission + 15 * 60000, expiry - 10 * 60000), workloadExpiresAt: k1.plan.expiresAt,
    executionContract: 'EXPLICIT_MANUAL_RECOVERY_NOT_AN_EXPIRED_JOB_LEASE',
    platformDisposition: 'PRESERVE_OLD_JOB_LEASE_PLAN_ARTIFACT_EPOCH_NO_READY',
    historicalScope: old.scope, actualArtifactRef: R.registry + '/' + R.repository + '@' + R.newDigest,
    stackId: A.stackId, taskDefinitionArn: A.taskDefinitionArn,
    externalFence: { ...structuredClone(old.pendingExternalFence), state: 'active' },
    idempotencyKey: old.idempotencyKey, fencedIdempotencyKey: input.auditManifest.plan.program.fencedKey,
    storeId: input.auditManifest.plan.program.expectedStore.store_id,
    hostname: m.tenantHostname, privateDirectory: B.privateDirectory,
    publicParametersSha256: old.publicParametersSha256,
    controlPolicy: { ...m.controlPolicy, imageRevision: R.newDigest },
    sqlProgramSha256: hash(input.auditManifest.plan.program), riskDocument: B.risk,
    limits: { runAuroraConnections: 1, runReadonlySqlCalls: 14, maximumExtraRollbackCalls: 1,
      totalPrivateBundleLoadsRunAndInspect: 2, totalFixedSecretValueReads: 1,
      runPostCalls: 1, runBootstrapGets: 1, runInitializedGets: 1, runConfigurationGets: 1,
      inspectInitializedGets: 1, inspectConfigurationGets: 1, metadataGroupsRunAndInspect: 4,
      sourceCloudWrites: 0, sourcePlatformWrites: 0, automaticRetries: 0 },
    currentPristineMaximumAgeMs: 120000, metadataMaximumAgeMs: 30000,
    platformReadyAuthority: false, legacyJanitorRemainsEnabled: true,
    monthlyBudgetTargetUSD: 50, budgetIsHardCap: false };
  assertRecoveryAdmission(result, preparedAt); return result;
}
export function assertRecoveryAdmission(p, now) {
  must(Number.isSafeInteger(p.preparedAt) && now >= p.preparedAt && now < p.admissionExpiresAt &&
    p.admissionExpiresAt === Math.min(p.preparedAt + 2 * 3600000, Date.parse(p.workloadExpiresAt) - 45 * 60000) &&
    p.executionExpiresAt === Math.min(p.admissionExpiresAt + 15 * 60000, Date.parse(p.workloadExpiresAt) - 10 * 60000), 'ADMISSION_EXPIRED');
}
export function assertRecoveryExecution(p, now) {
  must(now >= p.preparedAt && now < p.executionExpiresAt && Date.parse(p.workloadExpiresAt) - now > 10 * 60000, 'EXECUTION_EXPIRED');
}
export function assertFreshPristine(receipt, p, now) {
  assertPristine(receipt); const at = Date.parse(receipt.checkedAt);
  must(Number.isSafeInteger(at) && now >= at && now - at <= p.currentPristineMaximumAgeMs, 'PRISTINE_SNAPSHOT_TOO_OLD');
}
// This is a new explicit manual capability. It neither mints a worker claim
// scope nor changes the old Full/Express validators or expired repository lease.
export function guardedControlTransport({ plan, delegate, mode, beforePost }) {
  must(['Run', 'Inspect'].includes(mode), 'TRANSPORT_MODE'); const used = {};
  const allowed = mode === 'Run' ? { 'GET /api/saas/bootstrap': 1, 'POST /api/saas/provision': 1,
    'GET /api/saas/readiness': 1, 'GET /api/saas/control': 1 }
    : { 'GET /api/saas/readiness': 1, 'GET /api/saas/control': 1 };
  return { counts: () => ({ ...used }), transport: Object.freeze({ async send(request, context) {
    context.signal.throwIfAborted(); assertRecoveryExecution(plan, Date.now());
    let url; try { url = new URL(request.url); } catch { must(false, 'HTTP_URL'); }
    const key = request.method + ' ' + url.pathname;
    must(url.protocol === 'https:' && url.hostname === plan.hostname && url.port === '8443' && !url.username && !url.password &&
      !url.search && !url.hash && allowed[key] && !used[key], 'HTTP_SCOPE_OR_LIMIT');
    // Consume the in-process attempt even if the delegate/response is ambiguous.
    used[key] = 1;
    if (request.method === 'POST') {
      must(request.headers['idempotency-key'] === plan.fencedIdempotencyKey && typeof beforePost === 'function', 'POST_COORDINATE');
      const body = JSON.parse(request.body || '{}'), metadata = body.instance?.metadata;
      must(body.instance?.external_instance_id === plan.historicalScope.appInstanceId && metadata?.image_revision === plan.controlPolicy.imageRevision &&
        metadata.configuration_hash === plan.historicalScope.configurationHash && body.first_owner?.username === plan.controlPolicy.business.firstOwnerUsername,
      'POST_PAYLOAD_COORDINATE');
      await beforePost(); context.signal.throwIfAborted(); assertRecoveryExecution(plan, Date.now());
    }
    const response = await delegate.send(request, context);
    if (response.status >= 200 && response.status < 300) {
      if (key === 'POST /api/saas/provision') must(response.body?.store_id === plan.storeId && response.body.first_owner?.created === true, 'POST_EXACT_STORE_OWNER');
      if (key === 'GET /api/saas/control') must(response.body?.control?.stores?.length === 1 && response.body.control.stores[0].store_id === plan.storeId, 'CONFIG_EXACT_STORE');
    }
    return response;
  } }) };
}
