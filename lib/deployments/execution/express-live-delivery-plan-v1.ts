import { prepareExpressSingleTenantDeliveryV1, type ExpressDeliveryInputV1 } from './express-single-tenant-delivery-v1.ts';
import { deriveExpressFirstDeploymentV1 } from './express-deployment-scope-v1.ts';
import { deriveTenantResourceIdentity, deriveTenantOwnershipMarker } from './tenant-database.ts';
import type { DeploymentExecutionContext, TenantExternalOperationFence } from './contracts.ts';
import { validateExternalParameter } from './parameters.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

export const EXPRESS_LIVE_RESOURCES_V1 = Object.freeze({
  cloudFormationRoleArn: 'arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole',
  taskExecutionRoleArn: 'arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole',
  controlPublicKeyArn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq',
  controlPublicKeyVersion: '75d8da0af103e1e10e6d3341cbd50226fea7ce5e5aac8d150ab9e447b6340680',
  epochTableArn: 'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority',
});
type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
export interface ExpressComputeDeliveryOutputsV1 {
  outcome: string; stackId: string; templateSha256: string; outputs: Record<string, string>;
  loadBalancer: { arn: string; vpcId: string; dnsName: string; hostedZoneId: string };
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Concrete data-only execution plan. The active coordinate passed to the
 * renderer is explicitly a FUTURE post-activation coordinate, never a live
 * ownership proof or ApplyReady capability. No SDK/client/credentials here. */
export async function prepareExpressLiveDeliveryPlanV1(input: {
  sourceMaterial: Material; sourceMaterialSha256: string; subscriptionId: string;
  configuration: ExpressDeliveryInputV1['configuration']; configurationSchema: ExpressDeliveryInputV1['configurationSchema'];
  privateReceipt: { outcome: string; manifestSha256: string; summary: { targetMaterialSha256: string; targetScopeSha256: string };
    publicParameters: Record<string, string> };
  compute: ExpressComputeDeliveryOutputsV1; hostedZoneId: string; now: number;
}) {
  const i = structuredClone(input), m = i.sourceMaterial, c = i.compute, constants = EXPRESS_LIVE_RESOURCES_V1;
  const proposal = await deriveExpressFirstDeploymentV1({ material: m, materialSha256: i.sourceMaterialSha256, subscriptionId: i.subscriptionId });
  if (c.outcome !== 'EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD' ||
      c.stackId !== 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1' ||
      c.templateSha256 !== 'e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892' ||
      c.loadBalancer.vpcId !== c.outputs.VpcId || !/^[A-Za-z0-9-]+\.ca-central-1\.elb\.amazonaws\.com$/.test(c.loadBalancer.dnsName) ||
      !/^Z[A-Z0-9]+$/.test(c.loadBalancer.hostedZoneId) || !/^Z[A-Z0-9]+$/.test(i.hostedZoneId) ||
      !Number.isSafeInteger(i.now) || Date.parse(c.outputs.CellExpiresAt) - i.now < 30 * 60000 ||
      i.privateReceipt.outcome !== 'PRIVATE_CONTROL_PROVENANCE_REBOUND_NOT_RUNTIME_VERIFIED' ||
      i.privateReceipt.manifestSha256 !== '755fc5af86fd7eff9e00f87b17f424c0e8ed2efa5292e1770bac51313e15fe36' ||
      i.privateReceipt.summary.targetScopeSha256 !== await sha256Hex(proposal.scope)) fail('EXPRESS_LIVE_INPUT_PROVENANCE_REJECTED');
  const delivery = await prepareExpressSingleTenantDeliveryV1({ scope: { ...m.scope, ownerDeploymentId: proposal.scope.deploymentId },
    sourcePlan: m.sourcePlan, sourcePlanSha256: m.sourcePlanSha256, configuration: i.configuration,
    configurationSha256: m.configurationSha256, configurationSchema: i.configurationSchema, environment: m.environment,
    binding: m.binding, databaseOid: m.databaseOid, roleOid: m.roleOid, tenantHostname: m.tenantHostname });
  if (delivery.materialSha256 !== i.privateReceipt.summary.targetMaterialSha256) fail('EXPRESS_LIVE_PRIVATE_SCOPE_DRIFT');
  const identity = await deriveTenantResourceIdentity({ deployment: { appInstanceId: m.scope.appInstanceId, environmentId: m.scope.environmentId, desiredPlan: delivery.material.plan },
    appInstance: { id: m.scope.appInstanceId, workspaceId: m.scope.workspaceId, productId: m.scope.productId }, workspace: { id: m.scope.workspaceId },
    environment: m.environment } as DeploymentExecutionContext);
  const resourceFence = { schemaVersion: 1 as const, identity, generation: m.binding.resourceGeneration,
    ownerDeploymentId: proposal.scope.deploymentId, ownershipMarker: deriveTenantOwnershipMarker(identity, m.binding.resourceGeneration) };
  const operationHash = await sha256Hex({ schemaVersion: 1, intent: 'provision', deploymentId: proposal.scope.deploymentId,
    appInstanceId: identity.appInstanceId, generation: resourceFence.generation, ownershipMarker: resourceFence.ownershipMarker,
    planHash: proposal.scope.planHash, configurationHash: proposal.scope.configurationHash, artifactRef: proposal.scope.artifactRef });
  const pending: TenantExternalOperationFence = { schemaVersion: 1, resourceFence, ownerDeploymentId: proposal.scope.deploymentId,
    epoch: 1, intent: 'provision', marker: `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g${resourceFence.generation}_e1`, operationHash, state: 'pending_external' };
  const names = ['ClusterName', 'VpcId', 'SubnetIds', 'TaskSecurityGroupId', 'HttpsListenerArn', 'ControlListenerArn'];
  const cellOutputs = Object.fromEntries(names.map(n => [n, c.outputs[n]]));
  // Anchor the two-hour tag to the already-approved Cell deadline; this is
  // a render-time deadline calculation, NOT an actual job/creation timestamp.
  const ttlMs = m.environment.policy.ttlSeconds * 1000;
  const workloadDeadline = new Date(Math.floor(Math.min(i.now + ttlMs, Date.parse(c.outputs.CellExpiresAt)) / 1000) * 1000).toISOString();
  const requestedAt = Date.parse(workloadDeadline) - ttlMs;
  const futureTemplate = await delivery.renderWorkload({ fence: { ...pending, state: 'active' }, requestedAt,
    cellOutputs, activeCellCount: 1, activeTenantCount: 0 });
  const publicParameters = i.privateReceipt.publicParameters;
  if (Object.keys(publicParameters).sort().join(',') !== 'ControlIssuer,CorsAllowedOrigins,StripeCancelUrl,StripePublishableKey,StripeSuccessUrl') fail('EXPRESS_LIVE_PUBLIC_PARAMETERS_REJECTED');
  for (const [name, value] of Object.entries(publicParameters)) validateExternalParameter({ name, value, environment: m.environment });
  const parameters: Record<string, string> = { ...futureTemplate.parameters, ...publicParameters, TaskExecutionRoleArn: constants.taskExecutionRoleArn,
    ControlPublicKeyValueFrom: constants.controlPublicKeyArn + ':::' + constants.controlPublicKeyVersion };
  // The legacy generic validator intentionally only accepts a base public-key
  // ARN. This independent Express path pins the entire version-qualified ref.
  const required = futureTemplate.requiredExternalParameters.filter(n => !(n in parameters));
  if (required.length || parameters.ControlPublicKeyValueFrom !== constants.controlPublicKeyArn + ':::' + constants.controlPublicKeyVersion ||
      futureTemplate.tags.ExpiresAt !== workloadDeadline || futureTemplate.resourceInventory.length !== 7) fail('EXPRESS_LIVE_TEMPLATE_INCOMPLETE');
  const legacyKey = 'tenant:' + identity.stableIdentityHash, auroraKey = 'tenant:aurora-v2:' + identity.stableIdentityHash;
  const record = { schemaVersion: 1, stableIdentityHash: identity.stableIdentityHash, generation: resourceFence.generation,
    epoch: 1, intent: 'provision', ownerDeploymentId: proposal.scope.deploymentId, operationHash, marker: pending.marker, predecessor: null };
  const requestBody = { TableName: constants.epochTableArn, Item: { authority_key: { S: legacyKey }, schema_version: { N: '1' }, revision: { N: '1' }, record_json: { S: canonicalJson(record) } },
    ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'authority_key' }, ReturnValuesOnConditionCheckFailure: 'NONE' as const };
  const epochTransaction = { TransactItems: [{ ConditionCheck: { TableName: constants.epochTableArn, Key: { authority_key: { S: auroraKey } },
    ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'authority_key' }, ReturnValuesOnConditionCheckFailure: 'NONE' as const } }, { Put: requestBody }],
    // A token provides bounded provider idempotency; it is never permission
    // to retransmit a consumed API entry or overwrite an existing owner.
    ClientRequestToken: (await sha256Hex({ record, purpose: 'express-first-authority/v1' })).slice(0, 36) };
  const create = { StackName: futureTemplate.stackName, RoleARN: constants.cloudFormationRoleArn, TemplateBody: futureTemplate.templateBody,
    Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: Object.entries(futureTemplate.tags).map(([Key, Value]) => ({ Key, Value })),
    ResourceTypes: [...new Set(futureTemplate.resourceInventory.map(r => String(r.type)))].sort(),
    OnFailure: 'ROLLBACK', TimeoutInMinutes: 45, EnableTerminationProtection: false,
    ClientRequestToken: 'express-workload-' + (await sha256Hex({ parameters, template: futureTemplate.templateSha256, operationHash })).slice(0, 64) };
  const dns = { HostedZoneId: i.hostedZoneId, ChangeBatch: { Comment: 'Reviewed first Express acceptance; create exact absent name only',
    Changes: [{ Action: 'CREATE', ResourceRecordSet: { Name: m.tenantHostname + '.', Type: 'A', AliasTarget: {
      DNSName: c.loadBalancer.dnsName, HostedZoneId: c.loadBalancer.hostedZoneId, EvaluateTargetHealth: false } } }] } };
  const body = { schema: 'techlong/express-live-delivery-plan/v1' as const, sourceMaterialSha256: i.sourceMaterialSha256,
    materialSha256: delivery.materialSha256, scope: proposal.scope, idempotencyKey: proposal.idempotencyKey,
    subscriptionId: i.subscriptionId, templateVersionId: m.scope.templateVersionId, desiredPlan: delivery.material.plan, environmentPolicy: m.environment.policy,
    computeStackId: c.stackId, computeTemplateSha256: c.templateSha256, cellOutputs,
    deadlineTag: workloadDeadline, cellDeadlineTag: c.outputs.CellExpiresAt, renderRequestedAt: requestedAt, pendingExternalFence: pending,
    futureTemplate: { ...futureTemplate, parameters, requiredExternalParameters: required },
    proposedEpochTransaction: epochTransaction, proposedWorkloadCreate: create, proposedDnsCreate: dns,
    publicParametersSha256: await sha256Hex(publicParameters),
    applyRequiresActualActiveNeonAndStrongDynamoProof: true, authorityCurrentlyInstalled: false,
    firstClaimNeonPersistenceRequired: true, executionAuthorized: false, runtimeEnabled: false, readyVerified: false };
  return freeze({ ...body, planSha256: await sha256Hex(body) });
}
