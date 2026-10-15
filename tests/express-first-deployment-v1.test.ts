import test from 'node:test';
import assert from 'node:assert/strict';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createExpressDeploymentClaimScopeV1, isExpressDeploymentClaimScopeV1, deriveExpressFirstDeploymentV1 } from '../lib/deployments/execution/express-deployment-scope-v1.ts';
import { NeonDeploymentExecutionRepository } from '../lib/deployments/execution/neon-repository.ts';
import { singleDeploymentClaimPredicate, validateSingleDeploymentScope } from '../lib/deployments/execution/single-deployment-scope.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { stableId } from '../lib/domain/ids.ts';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';
import { createPreparedExpressFirstDeploymentRuntimeV1 } from '../lib/deployments/execution/express-first-deployment-runtime-v1.ts';

test('new owner ID follows existing management formula, old future ID is neither reused nor claimed', async () => {
  const { root, subscriptionId } = await firstClaimFixture(), m = root.material;
  const p = await deriveExpressFirstDeploymentV1({ material: m, materialSha256: root.materialSha256, subscriptionId });
  assert.equal(p.scope.deploymentId, await stableId('dep', p.idempotencyKey)); assert.notEqual(p.scope.deploymentId, m.scope.ownerDeploymentId);
  assert.equal(p.scope.planHash, m.planSha256); assert.equal(p.scope.artifactRef, m.images.app);
  assert.equal(p.idempotencyKey, await sha256Hex({ appInstanceId: m.scope.appInstanceId, subscriptionId, templateVersionId: m.scope.templateVersionId,
    driver: 'aws_ecs_cell', workflowVersion: 'v1', deploymentProfileKey: 'standard-v1', environmentId: m.scope.environmentId,
    configurationHash: m.configurationSha256, artifactRef: m.images.app, planHash: m.planSha256 }));
  assert.equal(p.databaseOwnershipClaimed, false); assert.equal(p.epochActivated, false); assert.equal(p.enqueueAuthorized, false);
  assert.throws(() => validateSingleDeploymentScope(p.scope));
});

test('Express repository preserves all exact scoped maintenance/claim predicates, never falling back to null/global', async () => {
  const { root, subscriptionId } = await firstClaimFixture(), p = await deriveExpressFirstDeploymentV1({ material: root.material, materialSha256: root.materialSha256, subscriptionId });
  const calls: { text: string; values: unknown[] }[] = [];
  const client = { query: async (text: string, values: unknown[]) => { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } } as unknown as NeonQueryFunction<false, true>;
  const repository = new NeonDeploymentExecutionRepository('postgresql://test:fixture@localhost/test', p.scope, () => client);
  assert.equal(await repository.claimNext({ workerId: 'express-fixture', now: 1, leaseDurationMs: 120000, jobTypes: ['apply'] }), null);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].values.slice(4), Object.values(p.scope));
  assert.equal(calls[0].values.slice(4).includes(null), false);
  for (const alias of ['blocked', 'exhausted_job', 'candidate_job'] as const) assert.ok(calls[0].text.includes(singleDeploymentClaimPredicate(alias)));
  assert.equal(calls[0].text.includes(p.scope.deploymentId), false);
  await assert.rejects(repository.loadContext({ id: 'job_fixture', deploymentId: 'foreign', jobType: 'apply', payload: {},
    attempt: 1, maxAttempts: 1, leaseExpiresAt: 123, leaseToken: 'fixture' }), /SINGLE_DEPLOYMENT_CLAIM_MISMATCH/);
  assert.equal(calls.length, 1);
});

test('plain copies/undefined/null/foreign image cannot enter the new branch; revalidation is explicit', async () => {
  const { root, subscriptionId } = await firstClaimFixture(), p = await deriveExpressFirstDeploymentV1({ material: root.material, materialSha256: root.materialSha256, subscriptionId });
  assert.equal(isExpressDeploymentClaimScopeV1(p.scope), true);
  const copy = structuredClone(p.scope); assert.equal(isExpressDeploymentClaimScopeV1(copy), false);
  assert.throws(() => new NeonDeploymentExecutionRepository('postgresql://test:fixture@localhost/test', copy));
  assert.equal(isExpressDeploymentClaimScopeV1(createExpressDeploymentClaimScopeV1(copy)), true);
  for (const patch of [{ deploymentId: undefined }, { appInstanceId: null }, { artifactRef: 'latest' }, { environmentId: 'prod' },
    { deploymentId: "x' OR 1=1--" }, { extra: true }]) assert.throws(() => createExpressDeploymentClaimScopeV1({ ...copy, ...patch } as typeof copy));
  assert.equal(Object.isFrozen(p.scope), true);
});

test('tampered material, plan, binding or subscription fails before deriving any owner proposal', async () => {
  for (const issue of ['digest', 'plan', 'binding', 'subscription']) {
    const { root, subscriptionId } = await firstClaimFixture(), material = structuredClone(root.material);
    if (issue === 'plan') material.plan.resources.tenant.database.databaseName = 'foreign_db';
    if (issue === 'binding') material.binding = { ...material.binding, stableIdentity: '0'.repeat(64) };
    await assert.rejects(deriveExpressFirstDeploymentV1({ material,
      materialSha256: issue === 'digest' ? '0'.repeat(64) : await sha256Hex(material), subscriptionId: issue === 'subscription' ? '' : subscriptionId }));
  }
});

test('prepared runtime wires a real scoped repository and new control owner without claims, connections or Full lifecycle factory', async () => {
  const f = await firstClaimFixture(), before = structuredClone(f.input);
  const r = await createPreparedExpressFirstDeploymentRuntimeV1({ delivery: f.input, subscriptionId: f.subscriptionId,
    databaseUrl: 'postgresql://fixture:not-real@fixture.neon.tech/test' });
  assert.deepEqual(f.input, before); assert.notEqual(r.scope.deploymentId, f.input.scope.ownerDeploymentId);
  assert.equal(r.delivery.material.scope.ownerDeploymentId, r.scope.deploymentId);
  assert.equal(r.delivery.material.planSha256, r.scope.planHash); assert.notEqual(r.delivery.materialSha256, r.sourceMaterialSha256);
  assert.equal(r.repository instanceof NeonDeploymentExecutionRepository, true); assert.equal(r.jobClaimed, false);
  assert.equal(r.databaseOwnershipClaimed, false); assert.equal(r.epochActivated, false); assert.equal(r.workerStarted, false);
  assert.equal(r.executionAuthorized, false); assert.equal(JSON.stringify(r.delivery.material).includes('not-real'), false);
  await assert.rejects(createPreparedExpressFirstDeploymentRuntimeV1({ delivery: f.input, subscriptionId: f.subscriptionId,
    databaseUrl: 'postgresql://fixture:not-real@untrusted.invalid/test' }), /EXPRESS_FIRST_DEPLOYMENT_NEON_SOURCE_REQUIRED/);
});
