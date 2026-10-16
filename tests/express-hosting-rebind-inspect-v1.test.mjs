import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeFailure, verifyContext, verifyHosting } from '../ops/aws-sandbox/scripts/inspect-express-hosting-rebind-v1.mjs';
import { H, hash } from '../ops/aws-sandbox/scripts/express-hosting-resume-plan-v1.mjs';
import { taskProjection } from '../ops/aws-sandbox/scripts/express-workload-recovery-plan-v1.mjs';

function fixture() {
  const stackId = 'arn:aws:cloudformation:ca-central-1:402010193138:stack/fixed/new', td = 'arn:aws:ecs:ca-central-1:402010193138:task-definition/fixed:3';
  const target = 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:targetgroup/fixed/0123456789abcdef';
  const taskArn = 'arn:aws:ecs:ca-central-1:402010193138:task/cell-sandbox-1/fixed';
  const template = { Parameters: Object.fromEntries(Array.from({ length: 20 }, (_, n) => ['P' + n, { NoEcho: n === 0 }])), Resources: {} };
  const execution = { request: { RoleARN: 'fixed-role', Tags: [{ Key: 'ExpiresAt', Value: 'fixed' }],
    Parameters: Array.from({ length: 20 }, (_, n) => ({ ParameterKey: 'P' + n, ParameterValue: 'value' + n })), TemplateBody: JSON.stringify(template) } };
  const stack = { StackId: stackId, StackStatus: 'CREATE_COMPLETE', RoleARN: 'fixed-role', Tags: execution.request.Tags,
    Parameters: execution.request.Parameters.map(p => ({ ...p, ParameterValue: p.ParameterKey === 'P0' ? '****' : p.ParameterValue })) };
  const resources = { StackResourceSummaries: Object.entries(H.resources).map(([LogicalResourceId, ResourceType]) => ({ LogicalResourceId,
    ResourceType, ResourceStatus: 'CREATE_COMPLETE', PhysicalResourceId: LogicalResourceId === 'TenantTaskDefinition' ? td : LogicalResourceId === 'TenantTargetGroup' ? target : LogicalResourceId })) };
  const definition = { taskDefinition: { taskDefinitionArn: td, status: 'ACTIVE', cpu: '512', containerDefinitions: [{ image: 'fixed@' + H.newDigest }] } };
  const service = { status: 'ACTIVE', desiredCount: 1, runningCount: 1, pendingCount: 0, taskDefinition: td,
    deployments: [{ rolloutState: 'COMPLETED' }], loadBalancers: [{ targetGroupArn: target, containerName: 'app', containerPort: 3000 }] };
  const previous = { baseline: { expectedTaskSha256: hash(taskProjection(definition.taskDefinition)),
    serviceSpecSha256: hash({ loadBalancers: [{ containerName: 'app', containerPort: 3000 }] }) } };
  return { execution, receipt: { stackId, taskDefinitionArn: td }, previous, stack, resources,
    template: { TemplateBody: execution.request.TemplateBody }, services: { services: [service] }, listed: { taskArns: [taskArn] },
    tasks: { tasks: [{ taskArn, lastStatus: 'RUNNING', healthStatus: 'HEALTHY', taskDefinitionArn: td,
      containers: [{ imageDigest: H.newDigest }], attachments: [{ details: [{ name: 'privateIPv4Address', value: '10.0.0.1' }] }] }] }, definition,
    health: { TargetHealthDescriptions: [{ TargetHealth: { State: 'healthy' }, Target: { Port: 3000, Id: '10.0.0.1' } }] } };
}

test('narrow current hosting proof validates exact UUID, template, seven resources, task and target', () => {
  const f = fixture(), result = verifyHosting(f);
  assert.equal(result.stackId, f.receipt.stackId); assert.equal(result.healthyTargets, 1);
  assert.equal(result.parametersMatchExecution, true); assert.equal(result.resources.length, 7);
});

test('foreign UUID, image, task spec, incomplete resources and wrong target fail closed', () => {
  for (const mutate of [f => { f.stack.StackId += 'wrong'; }, f => { f.tasks.tasks[0].containers[0].imageDigest = 'sha256:wrong'; },
    f => { f.definition.taskDefinition.cpu = '1024'; }, f => { f.resources.StackResourceSummaries.pop(); },
    f => { f.health.TargetHealthDescriptions[0].Target.Id = '10.0.0.2'; }, f => { f.services.services[0].pendingCount = 1; },
    f => { f.stack.Parameters[0].ParameterValue = 'leaked-noecho'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => verifyHosting(f), /K3V_/);
  }
});

test('diagnostics preserve useful provider identity but omit all messages, SQL and arbitrary values', () => {
  const secret = 'postgres://user:do-not-expose@private/db';
  const error = Object.assign(Error(secret), { name: 'NeonDbError', code: '42501', detail: secret, query: secret,
    $metadata: { httpStatusCode: 403, requestId: 'a55e9abf-b6b6-4af4-a311-8c6efb8c57e2' } });
  const result = safeFailure(error, 'neon.ReadonlyReceiptSnapshot');
  assert.equal(result.name, 'NeonDbError'); assert.equal(result.sqlState, '42501'); assert.equal(result.httpStatus, 403);
  assert.equal(result.requestId, error.$metadata.requestId); assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(safeFailure({ name: secret, message: secret, $metadata: { requestId: secret } }, 'fixed').name, 'OTHER_ERROR');
  assert.equal(safeFailure({ name: secret, message: secret, $metadata: { requestId: secret } }, 'fixed').requestId, null);
  assert.equal(safeFailure(Error('K3V_EXACT_UUID'), 'fixed').code, 'K3V_EXACT_UUID');
});

test('context does not silently accept a different historical binding', () => {
  const body = { binding: { fixed: true } }, m = { ...body, manifestSha256: hash(body) };
  assert.throws(() => verifyContext(m, { approvedManifestSha256: m.manifestSha256 }, { binding: { fixed: false } }), /K3V_MANIFEST_BINDING/);
});

test('entry is a separately bounded reader, never an old mode, mutator, private or application client', async () => {
  const source = await readFile(new URL('../ops/aws-sandbox/scripts/inspect-express-hosting-rebind-v1.mjs', import.meta.url), 'utf8');
  for (const token of ['CreateStackCommand', 'UpdateStackCommand', 'DeleteStackCommand', 'ExecuteChangeSetCommand',
    'GetSecretValueCommand', 'publicGet(', '--mode Run', '--mode Inspect', 'readOnly: false']) assert.equal(source.includes(token), false, token);
  assert.match(source, /\+\+sdkReads <= 8/); assert.match(source, /\+\+cliReads === 1/);
  assert.match(source, /\+\+neonReadonlyTransactions === 1/); assert.match(source, /maxAttempts: 1/);
  assert.match(source, /oldFailedInspectReplayed: false/); assert.match(source, /await mkdir\(out\)/);
});
