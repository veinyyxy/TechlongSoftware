import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuroraLifecycleTaskV2, parseAuroraLifecycleTaskV2, encodeAuroraLifecycleTaskV2,
  decodeAuroraLifecycleTaskV2, auroraLifecycleTaskDigestV2, compileAuroraInspectionInvocationV2,
  type AuroraLifecycleTaskV2, type AuroraLifecyclePredecessor } from '../lib/deployments/execution/aurora-lifecycle-v2.ts';
const fixture = (): AuroraLifecycleTaskV2 => JSON.parse(readFileSync(new URL('./fixtures/aurora-lifecycle-v2.json', import.meta.url), 'utf8'));
test('new lifecycle packet canonical hash binds tenant, DB resource, Secret version and operation', () => {
  const t = fixture(), encoded = encodeAuroraLifecycleTaskV2(t);
  assert.deepEqual(decodeAuroraLifecycleTaskV2(encoded, auroraLifecycleTaskDigestV2(t), 'inspect'), t);
  assert.throws(() => decodeAuroraLifecycleTaskV2(encoded, 'f'.repeat(64), 'inspect'));
  assert.throws(() => parseAuroraLifecycleTaskV2({ ...t, ownerDeploymentId: 'foreign' }, 'inspect'));
  assert.throws(() => parseAuroraLifecycleTaskV2({ ...t, binding: { ...t.binding, clusterResourceId: 'cluster-FOREIGN012345678901' } }, 'inspect'));
});
test('provision steps share one fence hash but have distinct immutable receipts', () => {
  const t = fixture();
  const p = createAuroraLifecycleTaskV2({ operation: 'prepare_empty_database', scope: t.scope, ownerDeploymentId: t.ownerDeploymentId, binding: t.binding, epoch: 1 });
  const v = createAuroraLifecycleTaskV2({ operation: 'verify', scope: t.scope, ownerDeploymentId: t.ownerDeploymentId, binding: t.binding, epoch: 1 });
  assert.equal(p.externalFence.operationHash, v.externalFence.operationHash);
  assert.notEqual(auroraLifecycleTaskDigestV2(p), auroraLifecycleTaskDigestV2(v));
});
test('cleanup packet cannot accept missing, same/new epoch or foreign binding predecessor', () => {
  const t = fixture(), predecessor: AuroraLifecyclePredecessor = { stableIdentity: t.binding.stableIdentity, resourceGeneration: 1,
    epoch: 1, intent: 'provision', ownerDeploymentId: t.ownerDeploymentId, marker: t.externalFence.marker,
    operationHash: t.externalFence.operationHash, bindingSha256: t.bindingSha256 };
  const input = { operation: 'destroy' as const, scope: t.scope, ownerDeploymentId: t.ownerDeploymentId, binding: t.binding, epoch: 2 };
  assert.equal(createAuroraLifecycleTaskV2({ ...input, provisionPredecessor: predecessor }).externalFence.intent, 'cleanup');
  for (const p of [null, { ...predecessor, bindingSha256: 'f'.repeat(64) }, { ...predecessor, epoch: 2 }])
    assert.throws(() => createAuroraLifecycleTaskV2({ ...input, provisionPredecessor: p }));
});
test('diagnostic invocation uses new namespace/entrypoint and never enables writers or old authority', () => {
  const t = fixture(), c = compileAuroraInspectionInvocationV2(t);
  assert.equal(c.executionAuthorized, false); assert.equal(c.writeCommandsAvailable, false); assert.equal(c.runtimeEnabled, false);
  assert.equal(c.entrypoint[1], 'db/tenant_lifecycle_aurora_v2.js');
  assert.ok(c.coordinates.receiptKey.startsWith('tenant-lifecycle/aurora-v2/'));
  assert.ok(c.coordinates.activationKey.startsWith('runtime:d001:aurora-v2:'));
  assert.equal(Object.keys(c.overrideEnvironment).length, 2);
  assert.throws(() => compileAuroraInspectionInvocationV2(createAuroraLifecycleTaskV2({ operation: 'verify', scope: t.scope,
    ownerDeploymentId: t.ownerDeploymentId, binding: t.binding, epoch: 1 })));
});
