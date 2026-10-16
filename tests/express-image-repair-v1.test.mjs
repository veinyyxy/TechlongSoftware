import test from 'node:test';
import assert from 'node:assert/strict';
import { C, canonical, hash, imageUri, makeRequest, taskProjection, expectedTaskProjection, checkWindow,
  assertResources } from '../ops/aws-sandbox/scripts/express-image-repair-plan-v1.mjs';
import { observe } from '../ops/aws-sandbox/scripts/express-image-repair-observer-v1.mjs';

function fixture() {
  const Parameters = Object.fromEntries(['ImageUri', ...Array.from({ length: 19 }, (_, n) => 'Parameter' + n)].map(k => [k, { Type: 'String' }]));
  const Resources = Object.fromEntries(Object.entries(C.resources).map(([k, Type]) => [k, { Type, Properties: { unchanged: k } }]));
  Resources.TenantTaskDefinition.Properties = { ContainerDefinitions: [{ Image: { Ref: 'ImageUri' },
    Environment: [{ Name: 'APP_IMAGE_REVISION', Value: C.oldDigest }, { Name: 'UNCHANGED', Value: 'constant' }] }] };
  return { plan: { futureTemplate: { template: { Parameters, Resources }, parameters: { ImageUri: imageUri(C.oldDigest) },
    tags: { ExpiresAt: '2026-10-15T22:10:27.000Z' } } } };
}
const task = () => ({ taskDefinitionArn: C.oldTask, revision: 1, status: 'ACTIVE', registeredAt: new Date(),
  taskRoleArn: 'original-role', family: C.family, cpu: '512', memory: '1024', unknownFutureRuntimeField: { frozen: true },
  containerDefinitions: [{ name: 'speedfeast-backend', image: imageUri(C.oldDigest),
    environment: [{ name: 'APP_IMAGE_REVISION', value: C.oldDigest }, { name: 'CONSTANT', value: 'fixed' }],
    secrets: [{ name: 'JWT_SECRET_KEY', valueFrom: 'fixed-ref:fixed-version' }] }] });

test('one parameter and one template literal change; nineteen values, tags and role preserved', () => {
  const input = fixture(), untouched = structuredClone(input), request = makeRequest(input);
  assert.deepEqual(input, untouched);
  assert.equal(request.StackName, C.stack); assert.equal(request.RoleARN, C.role); assert.equal(request.DisableRollback, false);
  assert.equal(request.Parameters.filter(p => p.UsePreviousValue).length, 19);
  assert.deepEqual(request.Parameters.find(p => p.ParameterKey === 'ImageUri'), { ParameterKey: 'ImageUri', ParameterValue: imageUri(C.newDigest) });
  assert.deepEqual(request.Tags, Object.entries(untouched.plan.futureTemplate.tags).map(([Key, Value]) => ({ Key, Value })));
  const newTemplate = JSON.parse(request.TemplateBody);
  newTemplate.Resources.TenantTaskDefinition.Properties.ContainerDefinitions[0].Environment[0].Value = C.oldDigest;
  assert.deepEqual(newTemplate, untouched.plan.futureTemplate.template);
  assert.deepEqual(Object.keys(request).sort(), ['ClientRequestToken', 'DisableRollback', 'Parameters', 'RoleARN', 'StackName', 'Tags', 'TemplateBody']);
});
test('reject a foreign resource, macro, old image or duplicate revision field', () => {
  for (const mutate of [f => { f.plan.futureTemplate.template.Resources.TenantService.Type = 'AWS::IAM::Role'; },
    f => { f.plan.futureTemplate.template.Transform = 'AWS::Serverless-2016-10-31'; },
    f => { f.plan.futureTemplate.parameters.ImageUri = imageUri(C.newDigest); },
    f => { f.plan.futureTemplate.template.Resources.TenantTaskDefinition.Properties.ContainerDefinitions[0].Environment.push({ Name: 'APP_IMAGE_REVISION', Value: C.oldDigest }); }]) {
    const f = fixture(); mutate(f); assert.throws(() => makeRequest(f), /IMAGE_REPAIR_/);
  }
});
test('task expected spec changes exactly two values; all Secret references, roles and future fields remain', () => {
  const old = task(), projection = taskProjection(old), next = expectedTaskProjection(old);
  assert.equal(next.containerDefinitions[0].image, imageUri(C.newDigest));
  assert.equal(next.containerDefinitions[0].environment.find(e => e.name === 'APP_IMAGE_REVISION').value, C.newDigest);
  next.containerDefinitions[0].image = imageUri(C.oldDigest);
  next.containerDefinitions[0].environment.find(e => e.name === 'APP_IMAGE_REVISION').value = C.oldDigest;
  assert.deepEqual(next, projection);
  for (const mutate of [v => { v.taskRoleArn = 'foreign-role'; }, v => { v.containerDefinitions[0].secrets[0].valueFrom = 'foreign-version'; },
    v => { v.unknownFutureRuntimeField.frozen = false; }]) {
    const changed = task(); mutate(changed); assert.notEqual(hash(taskProjection(changed)), hash(projection));
  }
});
test('task projection ignores only provider bookkeeping and nonsemantic name ordering', () => {
  const a = task(), b = structuredClone(a); b.revision = 99; b.registeredBy = 'provider';
  b.containerDefinitions[0].environment.reverse();
  assert.equal(hash(taskProjection(a)), hash(taskProjection(b)));
  a.containerDefinitions[0].image = imageUri(C.newDigest); assert.throws(() => expectedTaskProjection(a), /TASK_OLD_IMAGE/);
});
test('new admission is precisely two hours, not a renewal of expired resource tags', () => {
  const m = { preparedAt: 100, admissionExpiresAt: 7200100 };
  assert.doesNotThrow(() => checkWindow(m, 101));
  for (const now of [99, 7200100, 9000000]) assert.throws(() => checkWindow(m, now), /APPROVAL_EXPIRED_NO_WRITE/);
  assert.throws(() => checkWindow({ ...m, admissionExpiresAt: m.admissionExpiresAt + 1 }, 101), /APPROVAL_EXPIRED_NO_WRITE/);
});
test('exact seven resource identities; only task definition may replace', () => {
  const rows = Object.entries(C.resources).map(([LogicalResourceId, ResourceType]) => ({ LogicalResourceId, ResourceType,
    PhysicalResourceId: LogicalResourceId === 'TenantTaskDefinition' ? C.oldTask : 'fixed-' + LogicalResourceId, ResourceStatus: 'CREATE_COMPLETE' }));
  const before = assertResources(rows, 'before');
  const after = structuredClone(rows); after.find(r => r.LogicalResourceId === 'TenantTaskDefinition').PhysicalResourceId = C.oldTask.replace(/:1$/, ':2');
  assert.doesNotThrow(() => assertResources(after, 'after', before));
  after.find(r => r.LogicalResourceId === 'TenantTargetGroup').PhysicalResourceId = 'new-target';
  assert.throws(() => assertResources(after, 'after', before), /RESOURCE_REPLACEMENT/);
  assert.throws(() => assertResources(rows.slice(1), 'before'), /RESOURCE_INVENTORY/);
});
test('canonical hashes preserve dates and ignore object key ordering', () => {
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  assert.notEqual(hash({ at: new Date(0) }), hash({ at: new Date(1) }));
  assert.equal(canonical({ at: new Date(0) }), '{"at":"1970-01-01T00:00:00.000Z"}');
});
test('deleted exact stack is rejected before task/ECR/SQL activity and no mutation API is used', async () => {
  const calls = [], expectedRole = { arn: C.role, id: 'same-role-id', trust: {}, boundaryArn: 'same-boundary', inlineNames: [], attached: [] };
  const send = async command => {
    const name = command.constructor.name; calls.push(name);
    if (name === 'GetCallerIdentityCommand') return { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' };
    if (name === 'GetRoleCommand') return { Role: { Arn: C.role, RoleId: 'same-role-id', AssumeRolePolicyDocument: {}, PermissionsBoundary: { PermissionsBoundaryArn: 'same-boundary' } } };
    if (name === 'ListRolePoliciesCommand') return { PolicyNames: [] };
    if (name === 'ListAttachedRolePoliciesCommand') return { AttachedPolicies: [] };
    if (name === 'DescribeStacksCommand') return { Stacks: [{ StackId: C.stack, StackStatus: 'DELETE_COMPLETE', RoleARN: C.role }] };
    if (['GetTemplateCommand', 'ListStackResourcesCommand', 'DescribeServicesCommand'].includes(name)) return {};
    throw Error('UNEXPECTED_PROVIDER_CALL_' + name);
  };
  const mock = { send }, historical = fixture();
  await assert.rejects(observe({ api: { sts: mock, iam: mock, cfn: mock, ecs: mock }, historical,
    historicalPreflight: { cfnRole: expectedRole, policies: [], roles: [] },
    request: makeRequest(historical), phase: 'before', signal: AbortSignal.timeout(3000) }), /STACK_ID_STATUS_ROLE_TAGS/);
  assert.equal(calls.some(n => /Update|Create|Delete|Put|Invoke|DescribeTask/.test(n)), false);
});
