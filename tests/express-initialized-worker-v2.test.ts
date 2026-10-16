import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareExpressInitializedWorkerV2 } from '../lib/deployments/execution/express-initialized-worker-v2.ts';
import { EXPRESS_DELIVERY_IMAGES_V2 as images } from '../lib/deployments/execution/express-delivery-images-v2.ts';
import { EXPRESS_DELIVERY_IMAGES_V1 as oldImages } from '../lib/deployments/execution/express-delivery-images-v1.ts';
import { prepareExpressSingleTenantDeliveryV1, type ExpressDeliveryInputV1 } from '../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { createDefaultDisabledWorkerRuntime } from '../lib/deployments/execution/runtime-composition.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { getTemplateVersionPreset } from '../lib/templates/presets.ts';
import { databaseBindingDigestV2 } from '../lib/deployments/execution/aurora-database-v2.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
import type { SaaSControlRequest } from '../lib/deployments/execution/control-client.ts';

const storeId = 'add89a8c-f43e-81b9-8287-0cb6c5c54f87'; // Version-8 IDs remain valid.
async function fixture() {
  const f = await expressDeliveryFixture(), preset = getTemplateVersionPreset('restaurant-order-system')!;
  const configuration = { ...preset.defaultConfiguration, defaultStoreName: 'Fixture Store', firstOwnerUsername: 'fixture_admin' };
  const delivery: ExpressDeliveryInputV1 = { scope: { ...f.scope, ownerDeploymentId: f.fence.ownerDeploymentId, templateVersionId: 'tpl_fixture' },
    sourcePlan: f.plan, sourcePlanSha256: await sha256Hex(f.plan), configuration, configurationSha256: await sha256Hex(configuration),
    configurationSchema: preset.configurationSchema, environment: f.workload.environment, binding: f.binding,
    databaseOid: '16459', roleOid: '16456', tenantHostname: 'first-acceptance.sandbox.techlong.cloud' };
  const input = { delivery, existingDefaultStoreId: storeId }, root = await prepareExpressInitializedWorkerV2(input), p = root.material.controlPolicy;
  const op = { external_operation_epoch: f.external.epoch, external_operation_intent: f.external.intent,
    external_operation_marker: f.external.marker, external_operation_hash: f.external.operationHash };
  const instance = { external_instance_id: p.appInstanceId, status: 'active' };
  const store = { store_id: storeId, is_default: true, status: 'active', branding: { store_name: p.business.default_store.name,
    buyer_theme: p.business.default_store.buyer_theme, merchant_theme: p.business.default_store.merchant_theme } };
  const actual = { instance, entitlements: p.business.entitlements, stores: [{ store_id: storeId, status: store.status,
    store_name: store.branding.store_name, buyer_theme: store.branding.buyer_theme, merchant_theme: store.branding.merchant_theme }] };
  const bodies: Record<string, unknown> = { '/api/saas/readiness': { success: true, readiness: {
    protocol: 'techlong/tenant-initialized/v1', ready: true, initialization_verified: true, external_epoch_claimed: false,
    readiness_mode: 'tenant-v1', database_profile: 'express_iam', app_instance_id: p.appInstanceId,
    database_binding_sha256: databaseBindingDigestV2(p.binding), database_oid: p.databaseOid, role_oid: p.roleOid,
    desired_configuration_hash: p.configurationHash, image_revision: p.imageRevision } },
  '/api/saas/control': { success: true, control: { control_api_version: '1.2', ...op, instance, stores: [store],
    entitlements: p.business.entitlements, configuration_hash: await sha256Hex(canonicalJson(actual)),
    desired_configuration_hash: p.configurationHash, image_revision: p.imageRevision } } };
  const calls: SaaSControlRequest[] = []; let tokens = 0;
  const ports = { transport: { async send(req: SaaSControlRequest) { calls.push(req); return { status: 200, body: bodies[new URL(req.url).pathname] }; } },
    tokens: { async issue() { tokens++; return 'test-only-token'; } } };
  const outputs = { ClusterName: 'cell-sandbox-1', VpcId: 'vpc-0123456789abcdef0', SubnetIds: 'subnet-0123456789abcdef0,subnet-0123456789abcdef1',
    TaskSecurityGroupId: 'sg-0123456789abcdef0', HttpsListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef',
    ControlListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdee' };
  return { f, input, root, p, bodies, actual, calls, ports, outputs, tokens: () => tokens };
}

test('V2 pins both actual C5i manifests and preserves historical V1 and disabled worker', async () => {
  const c = JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/aurora-dual-mode-c5i-publication.executed.json', import.meta.url), 'utf8'));
  for (const kind of ['app', 'lifecycle'] as const) assert.equal(images[kind], c.images.find((i: { kind: string }) => i.kind === kind).pinnedImageUri);
  assert.equal(images.sourceCommit, c.sourceCommit); assert.equal(images.publicationRunId, c.run.id);
  assert.notEqual(images.app, oldImages.app); assert.notEqual(images.lifecycle, oldImages.lifecycle);
  assert.equal(createDefaultDisabledWorkerRuntime().applyRuntimeReady, false);
});
test('candidate is immutable, non-executing and exposes no initialize/password capability', async () => {
  const { input, root, calls, ports } = await fixture(), original = structuredClone(input);
  const prior = await prepareExpressSingleTenantDeliveryV1(input.delivery);
  assert.deepEqual(input, original); assert.equal(root.material.predecessorMaterialSha256, prior.materialSha256);
  assert.equal(root.materialSha256, await sha256Hex(root.material));
  assert.equal(root.material.runtimeEnabled, false); assert.equal(root.material.executionAuthorized, false);
  assert.equal(root.material.lifecycle.mode, 'reuse_initialized_only'); assert.equal(root.material.lifecycle.initializationPostAllowed, false);
  assert.equal('composeControl' in root, false); assert.equal('compiler' in root, false);
  const c = root.composeInitializedReadback(ports); assert.equal('provision' in c, false); assert.deepEqual(calls, []);
  assert.throws(() => { root.material.existingDefaultStoreId = 'changed'; }, TypeError);
});
test('new workload renders repaired image and APP_IMAGE_REVISION together, preserving seven resources/fence/Secret', async () => {
  const { root, f, outputs } = await fixture();
  const w = await root.renderWorkload({ fence: f.external, requestedAt: f.workload.requestedAt, cellOutputs: outputs, activeCellCount: 1, activeTenantCount: 0 });
  assert.equal(w.parameters.ImageUri, images.app); assert.ok(w.templateBody.includes(images.app.split('@')[1]));
  assert.equal(w.templateBody.includes(oldImages.app.split('@')[1]), false); assert.equal(w.resourceInventory.length, 7);
  assert.equal(w.parameters.TenantRuntimeSecretArn, f.binding.runtimeSecret.arn); assert.equal(w.tags.ExternalOperationMarker, f.external.marker);
  assert.equal(w.initializationPostAllowed, false); assert.equal(w.safety.applyReady, false);
});
test('fresh initialized readback uses only two authenticated GETs and exact existing store/config/image', async () => {
  const { root, f, ports, calls, tokens, p } = await fixture();
  const r = await root.composeInitializedReadback(ports).readConfiguration({ externalFence: f.external, signal: new AbortController().signal });
  assert.deepEqual(r, { ready: true, desiredConfigurationHash: p.configurationHash, imageRevision: p.imageRevision });
  assert.deepEqual(calls.map(c => [c.method, new URL(c.url).pathname]), [['GET', '/api/saas/readiness'], ['GET', '/api/saas/control']]);
  assert.equal(tokens(), 2); assert.ok(calls.every(c => c.body === undefined && new URL(c.url).port === '8443'));
});
test('uninitialized, image/config drift or transport failure never falls back to provision', async () => {
  for (const issue of ['uninitialized', 'image', 'configuration', 'transport']) {
    const { root, f, ports, bodies, calls } = await fixture();
    const readiness = (bodies['/api/saas/readiness'] as { readiness: Record<string, unknown> }).readiness;
    if (issue === 'uninitialized') readiness.initialization_verified = false;
    if (issue === 'image') readiness.image_revision = oldImages.app.split('@')[1];
    if (issue === 'configuration') readiness.desired_configuration_hash = '0'.repeat(64);
    if (issue === 'transport') ports.transport.send = async req => { calls.push(req); throw Error('test transport failed'); };
    const invoke = () => root.composeInitializedReadback(ports).readConfiguration({ externalFence: f.external, signal: new AbortController().signal });
    if (issue === 'transport') await assert.rejects(invoke); else assert.equal((await invoke()).ready, false);
    assert.ok(calls.every(c => c.method === 'GET')); assert.equal(calls.length, 1);
  }
});
test('another otherwise-valid store rejects; wrong fence rejects before JWT or transport', async () => {
  const x = await fixture(), c = (x.bodies['/api/saas/control'] as { control: { stores: { store_id: string }[] } }).control;
  c.stores[0].store_id = '11111111-1111-4111-8111-111111111111';
  x.actual.stores[0].store_id = c.stores[0].store_id;
  (x.bodies['/api/saas/control'] as { control: { configuration_hash: string } }).control.configuration_hash = await sha256Hex(canonicalJson(x.actual));
  await assert.rejects(x.root.composeInitializedReadback(x.ports).readConfiguration({ externalFence: x.f.external, signal: new AbortController().signal }), /EXACT_STORE_READBACK/);
  for (const kind of ['owner', 'epoch', 'database', 'generation']) {
    const z = await fixture(), f = structuredClone(z.f.external);
    if (kind === 'owner') f.ownerDeploymentId = 'dep_foreign';
    if (kind === 'epoch') f.state = 'pending_external';
    if (kind === 'database') f.resourceFence.identity.databaseName = 'foreign_db';
    if (kind === 'generation') f.resourceFence.generation++;
    await assert.rejects(z.root.composeInitializedReadback(z.ports).readConfiguration({ externalFence: f, signal: new AbortController().signal }));
    assert.equal(z.tokens(), 0); assert.equal(z.calls.length, 0);
  }
});
test('caller fence mutation during token issuance cannot change admitted epoch headers', async () => {
  const z = await fixture(), epoch = z.f.external.epoch, ports = { ...z.ports,
    tokens: { async issue() { z.f.external.epoch = 99; return 'test-only-token'; } } };
  assert.equal((await z.root.composeInitializedReadback(ports).readConfiguration({ externalFence: z.f.external, signal: new AbortController().signal })).ready, true);
  assert.ok(z.calls.every(c => c.headers['x-techlong-external-operation-epoch'] === String(epoch)));
});
