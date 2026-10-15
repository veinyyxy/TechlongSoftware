import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExpressSingleTenantWorkloadV1 as render } from '../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts';
import { assertSingleTenantWorkloadRender } from '../lib/deployments/cloudformation/single-tenant-acceptance-workload.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
async function input() { const f = await expressDeliveryFixture(); return { workload: f.workload, binding: f.binding,
  databaseOid: f.policy.databaseOid, roleOid: f.policy.roleOid, configurationHash: f.policy.configurationHash }; }
test('independent Express render pins four-key version and task role, both infrastructure health paths bootstrap; no old ApplyReady brand', async () => {
  const i = await input(), before = structuredClone(i), r = await render(i); assert.deepEqual(i, before);
  assert.equal(r.resourceInventory.length, 7); assert.equal(r.safety.executionAuthorized, false); assert.equal(r.safety.applyReady, false);
  assert.throws(() => assertSingleTenantWorkloadRender(r));
  assert.equal(r.templateBody.includes('TenantCleanupSchedule'), false); assert.equal(r.templateBody.includes(':database_url:'), false);
  const resources = r.template.Resources as Record<string, { Properties: Record<string, unknown> }>;
  const [c] = resources.TenantTaskDefinition.Properties.ContainerDefinitions as { Environment: { Name: string; Value: unknown }[]; Secrets: { Name: string; ValueFrom: string }[]; HealthCheck: { Command: string[] } }[];
  const e = Object.fromEntries(c.Environment.map(x => [x.Name, x.Value])); assert.equal(e.APP_READINESS_MODE, 'tenant-v1');
  assert.equal(e.PG_DATABASE_PROFILE, 'express_iam'); assert.equal(e.PG_EXPECTED_DATABASE_OID, '16459'); assert.equal(e.PGSSLROOTCERT, '');
  assert.equal(new Set(c.Environment.map(x => x.Name)).size, c.Environment.length); assert.equal(c.Secrets.length, 5);
  assert.ok(c.Secrets.filter(s => s.Name !== 'SAAS_CONTROL_PUBLIC_KEY').every(s => s.ValueFrom.endsWith('::' + i.binding.runtimeSecret.versionId)));
  assert.ok(!c.Secrets.some(s => /DATABASE_URL|PGPASSWORD/.test(s.Name)));
  assert.match(c.HealthCheck.Command.at(-1)!, /\/bootstrap-ready/); assert.equal(resources.TenantTargetGroup.Properties.HealthCheckPath, '/bootstrap-ready');
  assert.equal(r.parameters.TaskRoleArn, i.binding.profile === 'express_iam' && i.binding.access.applicationRoleArn);
  assert.ok(r.templateBody.includes('SAAS_REQUIRE_MTLS')); assert.equal(resources.TenantService.Properties.DesiredCount, 1);
});
test('foreign binding, epoch, role/database, Secret, image tag or budget reject rather than falling back to Full', async () => {
  for (const issue of ['identity', 'epoch', 'database', 'secret', 'image', 'budget']) {
    const i = await input();
    if (issue === 'identity') i.binding = { ...i.binding, stableIdentity: '0'.repeat(64) };
    if (issue === 'epoch') i.workload.externalOperation.marker = `tl_epoch_${'0'.repeat(24)}_g1_e3`;
    if (issue === 'database') i.binding = { ...i.binding, tenantDatabase: 'foreign_db' };
    if (issue === 'secret') i.workload.runtimeSecretRef = i.workload.runtimeSecretRef.replace('-AbCdEf', '-XyZxYz');
    if (issue === 'image') i.workload.imageUri = i.workload.imageUri.replace(/@sha256:.*/, ':latest');
    if (issue === 'budget') i.workload.environment.policy.budgetLimitCents = 1000;
    await assert.rejects(render(i), issue);
  }
});
