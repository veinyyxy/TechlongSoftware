import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { R, hash, same, recoveryPlan, assertRecoveryWindow, validatePlatform } from '../ops/aws-sandbox/scripts/express-workload-recovery-plan-v1.mjs';
import { PLATFORM_SQL } from '../ops/aws-sandbox/scripts/express-workload-recovery-observer-v1.mjs';
const now = Date.parse('2026-10-16T02:00:00Z');
function fixture() {
  const configuration = { shopName: 'Fixture only' }, desiredPlan = { fixture: 'historical-plan' };
  const parameters = { ImageUri: R.registry + '/' + R.repository + '@' + R.oldDigest,
    ...Object.fromEntries(Array.from({ length: 17 }, (_, n) => ['Parameter' + n, 'fixed-' + n])) };
  const Parameters = { ...Object.fromEntries(Object.keys(parameters).map(k => [k, { Type: 'String' }])),
    DefaultOne: { Type: 'String', Default: '7d' }, DefaultTwo: { Type: 'String', Default: '12h' } };
  const Tags = [{ Key: 'ExpiresAt', Value: '2026-10-15T22:10:27.000Z' }, { Key: 'AppInstanceId', Value: 'fixture-app' }];
  const Resources = Object.fromEntries(Object.entries(R.resources).map(([k, Type]) => [k, { Type, Properties: { unchanged: k } }]));
  for (const k of ['TenantLogGroup', 'TenantTaskDefinition', 'TenantTargetGroup', 'TenantService']) Resources[k].Properties.Tags = structuredClone(Tags);
  Resources.TenantTaskDefinition.Properties.ContainerDefinitions = [{ Image: { Ref: 'ImageUri' },
    Environment: [{ Name: 'APP_IMAGE_REVISION', Value: R.oldDigest }, { Name: 'CONFIG', Value: 'keep' }] }];
  const historical = { plan: { deadlineTag: '2026-10-15T22:10:27.000Z', planSha256: 'historical-sha', desiredPlan,
    environmentPolicy: { budgetLimitCents: 5000, ttlSeconds: 7200 }, scope: { deploymentId: 'fixture-deployment', appInstanceId: 'fixture-app',
      planHash: hash(desiredPlan), configurationHash: hash(configuration), artifactRef: parameters.ImageUri },
    pendingExternalFence: { operationHash: 'same-operation', marker: 'same-marker' },
    futureTemplate: { parameters, template: { Parameters, Resources, Metadata: { AutomaticCleanupInstalled: false, fixed: true } },
      tags: Object.fromEntries(Tags.map(t => [t.Key, t.Value])) } } };
  return { historical, configuration };
}
function platformFixture() {
  const { historical, configuration } = fixture(), s = historical.plan.scope;
  return { historical, row: { deployment_id: s.deploymentId, app_instance_id: s.appInstanceId, plan_hash: s.planHash,
    configuration_hash: s.configurationHash, artifact_ref: s.artifactRef, desired_plan: JSON.stringify(historical.plan.desiredPlan),
    configuration_snapshot: JSON.stringify(configuration), deployment_status: 'configuring', instance_status: 'pending',
    job_id: 'job_202c8dc12a8bf379f3a7c693', job_status: 'running', attempts: 1, max_attempts: 1, lease_expired: true,
    lease_cleared: false, owner_deployment_id: s.deploymentId, generation: 1, lifecycle_status: 'verified', resource_marked_destroyed: false,
    epoch: 1, intent: 'provision', operation_state: 'active', operation_hash: 'same-operation', marker: 'same-marker',
    environment_status: 'active', apply_enabled: 0, admission_state: 'open', admission_epoch: 0, admission_stack_id: null,
    environment_policy: JSON.stringify(historical.plan.environmentPolicy), business_scope_matches: true, subscription_current: true,
    workspace_status: 'active', subscription_status: 'active', app_deployments: 1, deployment_jobs: 1, stack_id: null, observation_sha256: null } };
}
test('one new CreateStack, not an update/old-root replay; unchanged parameter values and finite independent expiry', () => {
  const { historical } = fixture(), copy = structuredClone(historical), p = recoveryPlan(historical, now), r = p.request;
  assert.deepEqual(historical, copy); assert.equal(r.StackName, R.name); assert.notEqual(r.StackName, R.stack); assert.equal(p.predecessorStackId, R.stack);
  assert.equal(r.RoleARN, R.role); assert.equal(r.OnFailure, 'ROLLBACK'); assert.equal(r.TimeoutInMinutes, 25);
  assert.equal(r.DisableRollback, undefined); assert.equal(r.Capabilities, undefined); assert.equal(r.Parameters.length, 20);
  assert.equal(r.Parameters.some(v => v.UsePreviousValue), false);
  for (const q of r.Parameters) assert.equal(q.ParameterValue, q.ParameterKey === 'ImageUri'
    ? R.registry + '/' + R.repository + '@' + R.newDigest : historical.plan.futureTemplate.parameters[q.ParameterKey] ?? historical.plan.futureTemplate.template.Parameters[q.ParameterKey].Default);
  assert.equal(Date.parse(p.expiresAt) - p.preparedAt, 8 * 3600000);
  assert.equal(p.limits.sourceCreateStackCalls, 1); assert.equal(p.limits.platformWrites, 0); assert.equal(p.limits.provisionPosts, 0);
  assert.equal(p.databaseGeneration, 1); assert.equal(p.externalEpoch, 1);
  assert.equal(r.ResourceTypes.some(v => v.includes('IAM') || v.includes('RDS')), false);
});
test('template changes only revision, explicit recovery metadata, and ExpiresAt on the same four tag-bearing resources', () => {
  const { historical } = fixture(), template = JSON.parse(recoveryPlan(historical, now).request.TemplateBody), old = historical.plan.futureTemplate.template;
  template.Resources.TenantTaskDefinition.Properties.ContainerDefinitions[0].Environment[0].Value = R.oldDigest;
  for (const [k, r] of Object.entries(template.Resources)) if (r.Properties.Tags) r.Properties.Tags = old.Resources[k].Properties.Tags;
  assert.equal(template.Metadata.AutomaticCleanupInstalled, true);
  assert.equal(template.Metadata.WorkloadRecovery.platformPlanNotRebound, true); template.Metadata = old.Metadata;
  assert.deepEqual(template, old);
});
test('wrong resource/macro/old image/duplicate expiry must not produce a proposal', () => {
  for (const mutate of [h => { h.plan.futureTemplate.template.Resources.TenantService.Type = 'AWS::IAM::Role'; },
    h => { h.plan.futureTemplate.template.Transform = 'macro'; },
    h => { h.plan.futureTemplate.parameters.ImageUri = 'foreign'; },
    h => { h.plan.futureTemplate.template.Resources.TenantService.Properties.Tags.push({ Key: 'ExpiresAt', Value: 'foreign' }); }]) {
    const { historical } = fixture(); mutate(historical); assert.throws(() => recoveryPlan(historical, now), /WORKLOAD_RECOVERY_/);
  }
});
test('approval admission has a strict boundary and cannot extend workload or consume another purpose slot', () => {
  const p = recoveryPlan(fixture().historical, now);
  assert.doesNotThrow(() => assertRecoveryWindow(p, now + 7200000 - 1));
  for (const t of [now - 1, now + 7200000]) assert.throws(() => assertRecoveryWindow(p, t), /APPROVAL_EXPIRED_NO_WRITE/);
  assert.throws(() => assertRecoveryWindow({ ...p, expiresAt: new Date(now + 5 * 3600000).toISOString() }, now), /APPROVAL_EXPIRED_NO_WRITE/);
  assert.match(R.slot, /c5k-workload-recovery-v1\.permanent-slot\.json$/);
  assert.equal(R.slot.includes(p.request.ClientRequestToken), false);
});
test('platform preflight preserves the expired job and historical plan; snapshot has no raw configuration', () => {
  const { historical, row } = platformFixture(), safe = validatePlatform(row, historical);
  assert.equal(safe.configuration_snapshot, undefined); assert.equal(safe.desired_plan, undefined);
  assert.equal(safe.configuration_snapshot_sha256, historical.plan.scope.configurationHash);
  assert.equal(safe.job_status, 'running'); assert.equal(safe.lease_expired, true);
  assert.equal(row.configuration_snapshot.startsWith('{'), true);
});
test('live lease, new attempt/job, image rebind, owner/epoch or applied-ready change is rejected', () => {
  for (const mutation of [{ lease_expired: false }, { attempts: 2 }, { deployment_jobs: 2 }, { artifact_ref: 'new-image' },
    { owner_deployment_id: 'other' }, { epoch: 2 }, { instance_status: 'active' }, { apply_enabled: 1 }, { admission_epoch: 1 }]) {
    const { historical, row } = platformFixture(); assert.throws(() => validatePlatform({ ...row, ...mutation }, historical), /PLATFORM_COORDINATE_CHANGED/);
  }
});
test('control-plane SQL is one parameterized SELECT with no lease or business mutation', () => {
  assert.match(PLATFORM_SQL, /^SELECT /); assert.doesNotMatch(PLATFORM_SQL, /\b(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|FOR UPDATE)\b/i);
  for (let n = 1; n <= 8; n++) assert.equal(PLATFORM_SQL.includes('$' + n), true);
});
test('live entry exposes exactly one mutation API, no secret loader or application/private request', async () => {
  const entry = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-workload-recovery-v1.mjs', import.meta.url), 'utf8');
  assert.equal((entry.match(/new CreateStackCommand\(/g) || []).length, 1);
  assert.doesNotMatch(entry, /new (UpdateStack|DeleteStack|PutItem|UpdateItem|Invoke|GetSecretValue)Command/);
  assert.equal(same({ a: 1 }, { a: 1 }), true);
});
