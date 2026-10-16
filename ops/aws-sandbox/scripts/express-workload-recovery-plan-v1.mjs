// C5k: one reviewed hosting repair. No first-claim, lease takeover or business retry.
import { C, canonical, hash, same, imageUri, taskProjection, expectedTaskProjection } from './express-image-repair-plan-v1.mjs';
export { canonical, hash, same, taskProjection, expectedTaskProjection };
export const R = Object.freeze({ ...C, name: 'techlong-sandbox-tenant-9c5ee9e64509dcad',
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-risk.md',
  slot: 'F:/ChatGPT_workshop/techlong-express-c5k-workload-recovery-v1.permanent-slot.json',
  janitorCodeSha256: 'LTQwSFbnrnl9fjdg2N7GCxLCKiKHeDBBjNWsQ4EdWdA=',
});
export function requireRecovery(ok, code) { if (!ok) throw Error('WORKLOAD_RECOVERY_' + code); }
export function recoveryPlan(historical, preparedAt) {
  requireRecovery(Number.isSafeInteger(preparedAt) && preparedAt > Date.parse(historical.plan.deadlineTag), 'PREPARED_AT');
  const old = historical.plan.futureTemplate, template = structuredClone(old.template);
  requireRecovery(!template.Transform && same(Object.fromEntries(Object.entries(template.Resources).map(([k, v]) => [k, v.Type])), R.resources), 'TEMPLATE_TYPES');
  const containers = template.Resources.TenantTaskDefinition.Properties.ContainerDefinitions;
  const revisions = containers?.[0]?.Environment?.filter(e => e.Name === 'APP_IMAGE_REVISION');
  requireRecovery(containers?.length === 1 && same(containers[0].Image, { Ref: 'ImageUri' }) &&
    revisions?.length === 1 && revisions[0].Value === R.oldDigest && old.parameters.ImageUri === imageUri(R.oldDigest), 'OLD_IMAGE');
  const expiresAt = new Date(preparedAt + 8 * 3600000).toISOString();
  revisions[0].Value = R.newDigest;
  for (const resource of Object.values(template.Resources)) {
    if (!resource.Properties?.Tags) continue;
    requireRecovery(resource.Properties.Tags.filter(t => t.Key === 'ExpiresAt').length === 1, 'RESOURCE_EXPIRY');
    for (const tag of resource.Properties.Tags) if (tag.Key === 'ExpiresAt') tag.Value = expiresAt;
  }
  // The old false flag referred only to the new path. It must not hide the
  // independently observed legacy janitor which can delete this new workload.
  template.Metadata = { ...template.Metadata, AutomaticCleanupInstalled: true,
    WorkloadRecovery: { protocol: 'techlong/workload-only-recovery/v1', predecessorStackId: R.stack,
      predecessorPlanSha256: historical.plan.planSha256, historicalPlatformPlanHash: historical.plan.scope.planHash,
      platformPlanNotRebound: true, provisionRetryAuthorized: false, legacyJanitorEnabled: true } };
  const Parameters = Object.entries(template.Parameters).sort(([a], [b]) => a.localeCompare(b)).map(([ParameterKey, spec]) => ({
    ParameterKey, ParameterValue: ParameterKey === 'ImageUri' ? imageUri(R.newDigest) : old.parameters[ParameterKey] ?? spec.Default,
  }));
  requireRecovery(Parameters.length === 20 && Parameters.every(p => typeof p.ParameterValue === 'string'), 'PARAMETERS');
  const request = { StackName: R.name, RoleARN: R.role, TemplateBody: canonical(template), Parameters,
    Tags: Object.entries({ ...old.tags, ExpiresAt: expiresAt }).sort(([a], [b]) => a.localeCompare(b)).map(([Key, Value]) => ({ Key, Value })),
    OnFailure: 'ROLLBACK', TimeoutInMinutes: 25, ResourceTypes: [...new Set(Object.values(R.resources))].sort() };
  requireRecovery(Buffer.byteLength(request.TemplateBody) <= 51200, 'TEMPLATE_SIZE');
  request.ClientRequestToken = 'techlong-c5k-' + hash(request).slice(0, 48);
  return { schema: 'techlong/workload-only-recovery-plan/v1', preparedAt, admissionExpiresAt: preparedAt + 2 * 3600000,
    expiresAt, predecessorStackId: R.stack, request, requestSha256: hash(request),
    scope: { ...historical.plan.scope, workloadImage: imageUri(R.newDigest), historicalArtifactReferenceNotRebound: true },
    limits: { sourceCreateStackCalls: 1, iamWrites: 0, platformWrites: 0, ddbWrites: 0, dnsWrites: 0,
      secretWrites: 0, operatorSecretValueReads: 0, originalPrivateReads: 0, auroraConnections: 0,
      applicationRequests: 0, provisionPosts: 0, automaticRetries: 0 },
    platformDisposition: 'PRESERVE_EXPIRED_JOB_LEASE_AND_OLD_PLAN_UNCHANGED_NO_READY',
    environmentTtlPolicySeconds: historical.plan.environmentPolicy.ttlSeconds,
    independentWindowExceptionRequiresApproval: true, environmentPolicyUnchanged: true,
    databaseGeneration: 1, externalEpoch: 1, providerRollbackEnabled: true,
    janitorDisposition: 'KEEP_ENABLED_NEW_WORKLOAD_EXPIRY_NO_SCHEDULE_OR_CODE_CHANGE',
    parentCellUnchanged: true, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false, readyVerified: false };
}
export function assertRecoveryWindow(plan, now) {
  requireRecovery(now >= plan.preparedAt && now < plan.admissionExpiresAt &&
    plan.admissionExpiresAt - plan.preparedAt === 2 * 3600000 && Date.parse(plan.expiresAt) - now >= 6 * 3600000,
  'APPROVAL_EXPIRED_NO_WRITE');
}
export function validatePlatform(row, historical) {
  const s = historical.plan.scope, decode = v => typeof v === 'string' ? JSON.parse(v) : v;
  requireRecovery(row && row.deployment_id === s.deploymentId && row.app_instance_id === s.appInstanceId &&
    row.plan_hash === s.planHash && row.configuration_hash === s.configurationHash && row.artifact_ref === s.artifactRef &&
    hash(decode(row.desired_plan)) === hash(historical.plan.desiredPlan) && hash(decode(row.configuration_snapshot)) === s.configurationHash &&
    row.deployment_status === 'configuring' && row.instance_status === 'pending' && row.job_id === 'job_202c8dc12a8bf379f3a7c693' &&
    row.job_status === 'running' && Number(row.attempts) === 1 && Number(row.max_attempts) === 1 && row.lease_expired === true &&
    row.lease_cleared === false && row.owner_deployment_id === s.deploymentId && Number(row.generation) === 1 &&
    row.lifecycle_status === 'verified' && row.resource_marked_destroyed === false && Number(row.epoch) === 1 &&
    row.intent === 'provision' && row.operation_state === 'active' && row.operation_hash === historical.plan.pendingExternalFence.operationHash &&
    row.marker === historical.plan.pendingExternalFence.marker && row.environment_status === 'active' && Number(row.apply_enabled) === 0 &&
    row.admission_state === 'open' && Number(row.admission_epoch) === 0 && row.admission_stack_id === null &&
    row.business_scope_matches === true && row.subscription_current === true && row.workspace_status === 'active' &&
    row.subscription_status === 'active' && Number(row.app_deployments) === 1 && Number(row.deployment_jobs) === 1 &&
    row.stack_id === null && row.observation_sha256 === null &&
    same(decode(row.environment_policy), historical.plan.environmentPolicy), 'PLATFORM_COORDINATE_CHANGED');
  const safe = structuredClone(row);
  for (const k of ['desired_plan', 'configuration_snapshot', 'environment_policy']) { safe[k + '_sha256'] = hash(decode(safe[k])); delete safe[k]; }
  return safe;
}
