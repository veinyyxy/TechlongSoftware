// C5j is one exact workload repair, not a generic deployment/retry controller.
import { createHash } from 'node:crypto';

export const canonical = value => JSON.stringify(order(value));
function order(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(order);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, order(v)])) : value;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const same = (a, b) => canonical(a) === canonical(b);
export function demand(ok, code) { if (!ok) throw Error('IMAGE_REPAIR_' + code); }
export const C = Object.freeze({
  stack: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/863828e0-c8d6-11f1-bd9d-06fff5ad0437',
  role: 'arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole',
  cluster: 'cell-sandbox-1', service: 'tenant-9c5ee9e64509dcad-ecs-service',
  family: 'tenant-9c5ee9e64509dcad-task-definition',
  oldTask: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:1',
  repository: 'techlong-sandbox-speedfeast', registry: '402010193138.dkr.ecr.ca-central-1.amazonaws.com',
  oldDigest: 'sha256:5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004',
  newDigest: 'sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e',
  configDigest: 'sha256:74d083066dd15c62e006cf9ad7154f1a2727e693fae4a47bffc0af0b109c63dd',
  risk: 'docs/aws-auto-deployment-aurora-dual-mode-c5j-image-repair-entry.md',
  slot: 'F:/ChatGPT_workshop/techlong-express-c5j-image-update-v1.permanent-slot.json',
  resources: {
    TenantLogGroup: 'AWS::Logs::LogGroup', TenantTaskDefinition: 'AWS::ECS::TaskDefinition',
    TenantTargetGroup: 'AWS::ElasticLoadBalancingV2::TargetGroup',
    TenantBusinessControlDenyRule: 'AWS::ElasticLoadBalancingV2::ListenerRule',
    TenantListenerRule: 'AWS::ElasticLoadBalancingV2::ListenerRule',
    TenantControlListenerRule: 'AWS::ElasticLoadBalancingV2::ListenerRule', TenantService: 'AWS::ECS::Service',
  },
});
export const imageUri = digest => `${C.registry}/${C.repository}@${digest}`;
export function makeRequest(historical) {
  const old = historical.plan.futureTemplate.template, template = structuredClone(old);
  demand(same(Object.fromEntries(Object.entries(old.Resources).map(([k, v]) => [k, v.Type])), C.resources), 'SEVEN_RESOURCES');
  demand(!old.Transform && !old.Conditions && Object.keys(old.Parameters).length === 20, 'TEMPLATE_SHAPE');
  const containers = template.Resources.TenantTaskDefinition.Properties.ContainerDefinitions;
  demand(containers.length === 1 && same(containers[0].Image, { Ref: 'ImageUri' }), 'TEMPLATE_IMAGE');
  const revisions = containers[0].Environment.filter(e => e.Name === 'APP_IMAGE_REVISION');
  demand(revisions.length === 1 && revisions[0].Value === C.oldDigest, 'OLD_REVISION');
  demand(historical.plan.futureTemplate.parameters.ImageUri === imageUri(C.oldDigest), 'OLD_IMAGE_PARAMETER');
  revisions[0].Value = C.newDigest;
  const request = {
    StackName: C.stack, RoleARN: C.role, TemplateBody: canonical(template),
    Parameters: Object.keys(old.Parameters).sort().map(ParameterKey => ParameterKey === 'ImageUri'
      ? { ParameterKey, ParameterValue: imageUri(C.newDigest) } : { ParameterKey, UsePreviousValue: true }),
    Tags: Object.entries(historical.plan.futureTemplate.tags).sort(([a], [b]) => a.localeCompare(b)).map(([Key, Value]) => ({ Key, Value })),
    DisableRollback: false,
  };
  demand(Buffer.byteLength(request.TemplateBody) <= 51200 && Array.isArray(request.Tags), 'REQUEST_SIZE_TAGS');
  request.ClientRequestToken = 'techlong-c5j-' + hash(request).slice(0, 48);
  return request;
}
// Remove provider bookkeeping only. Retain all present runtime specification fields,
// including future fields unknown here; environment/Secret ordering is not semantic.
export function taskProjection(definition) {
  const value = structuredClone(definition);
  for (const k of ['taskDefinitionArn', 'revision', 'status', 'requiresAttributes', 'compatibilities', 'registeredAt',
    'registeredBy', 'deregisteredAt']) delete value[k];
  for (const c of value.containerDefinitions || []) for (const k of ['environment', 'secrets'])
    if (c[k]) c[k].sort((a, b) => a.name.localeCompare(b.name));
  return value;
}
export function expectedTaskProjection(definition) {
  const value = taskProjection(definition), containers = value.containerDefinitions;
  demand(containers?.length === 1 && containers[0].image === imageUri(C.oldDigest), 'TASK_OLD_IMAGE');
  const revisions = containers[0].environment?.filter(e => e.name === 'APP_IMAGE_REVISION');
  demand(revisions?.length === 1 && revisions[0].value === C.oldDigest, 'TASK_OLD_REVISION');
  containers[0].image = imageUri(C.newDigest); revisions[0].value = C.newDigest;
  return value;
}
export function checkWindow(manifest, now) {
  demand(Number.isSafeInteger(manifest.preparedAt) && Number.isSafeInteger(manifest.admissionExpiresAt) &&
    manifest.admissionExpiresAt - manifest.preparedAt === 2 * 3600000 &&
    now >= manifest.preparedAt && now < manifest.admissionExpiresAt, 'APPROVAL_EXPIRED_NO_WRITE');
}
export function assertResources(rows, phase, before) {
  demand(rows?.length === 7 && same(Object.fromEntries(rows.map(r => [r.LogicalResourceId, r.ResourceType])), C.resources), 'RESOURCE_INVENTORY');
  demand(rows.every(r => ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(r.ResourceStatus) && r.PhysicalResourceId), 'RESOURCE_STATUS');
  const physical = Object.fromEntries(rows.map(r => [r.LogicalResourceId, r.PhysicalResourceId]));
  if (phase === 'before') demand(physical.TenantTaskDefinition === C.oldTask, 'OLD_TASK_ID');
  else {
    demand(before && Object.keys(physical).every(k => k === 'TenantTaskDefinition' || physical[k] === before[k]), 'RESOURCE_REPLACEMENT');
    demand(physical.TenantTaskDefinition !== C.oldTask && new RegExp('^arn:aws:ecs:ca-central-1:402010193138:task-definition/' + C.family + ':[1-9][0-9]*$').test(physical.TenantTaskDefinition), 'NEW_TASK_ID');
  }
  return physical;
}
