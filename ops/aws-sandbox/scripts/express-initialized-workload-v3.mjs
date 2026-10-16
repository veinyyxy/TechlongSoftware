import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { EXPRESS_LIVE_RESOURCES_V1 as C } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { validateExternalParameter } from '../../../lib/deployments/execution/parameters.ts';
export const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export function requireW3(ok, code) { if (!ok) throw Error('INITIALIZED_W3_' + code); }
export function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Public-data compilation, never a create/admission proof. The real observer
 * must subsequently prove all names empty before this can become a review. */
export async function prepareInitializedWorkloadV3({ root, jobPlan, cell, publicParameters }) {
  requireW3(root.materialSha256 === jobPlan.materialSha256 && same(root.material, jobPlan.material) &&
    cell.activeCellCount === 1 && cell.activeTenantCount === 0, 'RENDER_SCOPE');
  requireW3(Object.keys(publicParameters).sort().join(',') ===
    'ControlIssuer,CorsAllowedOrigins,StripeCancelUrl,StripePublishableKey,StripeSuccessUrl', 'PUBLIC_PARAMETER_KEYS');
  for (const [name, value] of Object.entries(publicParameters)) validateExternalParameter({ name, value, environment: root.material.environment });
  const rendered = await root.renderWorkload({ fence: jobPlan.externalFence, requestedAt: jobPlan.preparedAt,
    cellOutputs: cell.outputs, activeCellCount: cell.activeCellCount, activeTenantCount: cell.activeTenantCount });
  const template = structuredClone(rendered.template);
  template.Metadata.InitializedSingleJobV3 = { protocol: 'techlong/initialized-single-job/v3',
    jobPlanSha256: jobPlan.planSha256, jobId: jobPlan.jobId, initializationPostAllowed: false,
    legacyJanitorExpectedEnabled: true, guaranteedAutomaticCleanup: false };
  const parameters = { ...rendered.parameters, ...publicParameters, TaskExecutionRoleArn: C.taskExecutionRoleArn,
    ControlPublicKeyValueFrom: C.controlPublicKeyArn + ':::' + C.controlPublicKeyVersion };
  const required = rendered.requiredExternalParameters.filter(k => !(k in parameters));
  requireW3(!required.length && rendered.resourceInventory.length === 7 &&
    Date.parse(rendered.tags.ExpiresAt) > jobPlan.deadline && !template.Transform, 'TEMPLATE_INCOMPLETE');
  const body = { schema: 'techlong/initialized-workload/v3', jobPlanSha256: jobPlan.planSha256,
    materialSha256: root.materialSha256, stackName: rendered.stackName, template,
    parameters, tags: rendered.tags, resourceInventory: rendered.resourceInventory,
    workloadExpiresAt: Date.parse(rendered.tags.ExpiresAt), publicParametersSha256: await sha256Hex(publicParameters),
    cellOutputs: cell.outputs, parentStackId: cell.stackId, parentTagExpiresAt: cell.parentTagExpiresAt,
    parentTagRenewalAuthorized: false, parentDeletionAuthorized: false, iamWrites: 0,
    dnsWrites: 0, authorityWrites: 0, secretWrites: 0, initializationPosts: 0, automaticRetries: 0 };
  const request = { StackName: rendered.stackName, RoleARN: C.cloudFormationRoleArn, TemplateBody: canonicalJson(template),
    Parameters: Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: Object.entries(rendered.tags).sort(([a], [b]) => a.localeCompare(b)).map(([Key, Value]) => ({ Key, Value })),
    ResourceTypes: [...new Set(rendered.resourceInventory.map(r => r.type))].sort(),
    OnFailure: 'ROLLBACK', TimeoutInMinutes: 15, EnableTerminationProtection: false,
    ClientRequestToken: 'initialized-v3-' + (await sha256Hex(body)).slice(0, 48) };
  requireW3(Buffer.byteLength(request.TemplateBody) <= 51200, 'INLINE_TEMPLATE_TOO_LARGE');
  const plan = { ...body, request, requestSha256: await sha256Hex(request) };
  return freeze({ ...plan, workloadPlanSha256: await sha256Hex(plan) });
}

export function externalFenceFromSnapshotV3(snapshot) {
  const r = snapshot.resource, o = snapshot.operation;
  return { schemaVersion: 1, resourceFence: { schemaVersion: 1, generation: r.generation,
    ownerDeploymentId: r.owner_deployment_id, ownershipMarker: r.ownership_marker, identity: { schemaVersion: 1,
      appInstanceId: r.app_instance_id, workspaceId: r.workspace_id, productId: r.product_id,
      environmentId: r.environment_id, cellKey: r.cell_key, stableIdentityHash: r.stable_identity_hash,
      databaseName: r.database_name, roleName: r.role_name, secretName: r.secret_name } },
    ownerDeploymentId: o.owner_deployment_id, epoch: o.epoch, intent: o.intent, marker: o.marker,
    operationHash: o.operation_hash, state: o.state };
}

export function assertRunWindowV3(manifest, now) {
  requireW3(Number.isSafeInteger(now) && now >= manifest.jobPlan.preparedAt && now < manifest.jobPlan.claimBy &&
    manifest.workload.workloadExpiresAt - now >= 90 * 60000, 'REVIEW_EXPIRED_NO_WRITE');
}
