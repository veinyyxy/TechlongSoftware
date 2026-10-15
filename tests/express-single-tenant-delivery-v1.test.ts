import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareExpressSingleTenantDeliveryV1, type ExpressDeliveryInputV1 } from '../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { EXPRESS_DELIVERY_IMAGES_V1 as images } from '../lib/deployments/execution/express-delivery-images-v1.ts';
import { FIRST_ACCEPTANCE_APP_IMAGE, validateSingleDeploymentScope } from '../lib/deployments/execution/single-deployment-scope.ts';
import { compileProvisioningConfiguration, compileProvisioningConfigurationForReview } from '../lib/templates/provisioning.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { expressDeliveryFixture } from './fixtures/express-delivery-v1.ts';
import { getTemplateVersionPreset } from '../lib/templates/presets.ts';
import type { DeploymentExecutionContext } from '../lib/deployments/execution/contracts.ts';
import { v3Now } from './fixtures/cell-stack-v3.ts';

async function fixture() {
  const f = await expressDeliveryFixture();
  const preset = getTemplateVersionPreset('restaurant-order-system')!;
  const configuration = { ...preset.defaultConfiguration, defaultStoreName: 'Fixture Store', firstOwnerUsername: 'fixture_admin' };
  const configurationSchema = preset.configurationSchema;
  // Existing physical DB names may differ from the original plan. Preserve
  // the source, explicitly capture the new physical-name revision.
  f.binding = { ...f.binding, tenantDatabase: 'tenant_existing_db', tenantUsername: 'tenant_existing_role' };
  const input: ExpressDeliveryInputV1 = { scope: { ...f.scope, ownerDeploymentId: f.fence.ownerDeploymentId, templateVersionId: 'tpl_fixture' },
    sourcePlan: f.plan, sourcePlanSha256: await sha256Hex(f.plan), configuration, configurationSha256: await sha256Hex(configuration),
    configurationSchema, environment: f.workload.environment, binding: f.binding, databaseOid: '16459', roleOid: '16456',
    tenantHostname: 'first-acceptance.sandbox.techlong.cloud' };
  f.external.resourceFence.identity.databaseName = f.binding.tenantDatabase;
  f.external.resourceFence.identity.roleName = f.binding.tenantUsername;
  const outputs = { ClusterName: 'cell-sandbox-1', VpcId: 'vpc-0123456789abcdef0',
    SubnetIds: 'subnet-0123456789abcdef0,subnet-0123456789abcdef1', TaskSecurityGroupId: 'sg-0123456789abcdef0',
    HttpsListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef',
    ControlListenerArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdee' };
  return { f, input, outputs };
}

test('pins match actual publication capsule; legacy image allowlist stays separate', () => {
  const executed = JSON.parse(readFileSync(new URL('../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-publication.executed.json', import.meta.url), 'utf8'));
  assert.equal(images.app, executed.publication.images.find((i: { kind: string }) => i.kind === 'app').pinnedImageUri);
  assert.equal(images.lifecycle, executed.publication.images.find((i: { kind: string }) => i.kind === 'lifecycle').pinnedImageUri);
  assert.equal(images.sourceCommit, executed.publication.sourceCommit);
  assert.notEqual(images.app, FIRST_ACCEPTANCE_APP_IMAGE);
  assert.throws(() => validateSingleDeploymentScope({ deploymentId: 'dep_fixture', appInstanceId: 'app_fixture',
    environmentId: 'env_aws_sandbox_ca_central_1', planHash: 'a'.repeat(64), configurationHash: 'b'.repeat(64), artifactRef: images.app }));
});

test('non-secret projection never manufactures a password or relaxes the existing execution compiler', async () => {
  const { input } = await fixture(), before = structuredClone(input);
  const r = compileProvisioningConfigurationForReview({ schema: input.configurationSchema, configuration: input.configuration });
  assert.ok(r.data); assert.deepEqual(r.data.first_owner, { username: 'fixture_admin' });
  assert.equal(compileProvisioningConfiguration({ schema: input.configurationSchema, configuration: input.configuration }).data, null);
  assert.ok(compileProvisioningConfiguration({ schema: input.configurationSchema, configuration: input.configuration,
    runtimeSecrets: { firstOwnerPassword: 'test-only-strong-password' } }).data);
  assert.deepEqual(input, before);
});

test('composition hashes an explicit physical-name revision without changing owner, generation, image or source plan', async () => {
  const { input } = await fixture(), before = structuredClone(input), root = await prepareExpressSingleTenantDeliveryV1(input), m = root.material;
  assert.deepEqual(input, before); assert.equal(m.sourcePlanSha256, input.sourcePlanSha256); assert.notEqual(m.planSha256, m.sourcePlanSha256);
  assert.equal(m.plan.resources.tenant.database.databaseName, input.binding.tenantDatabase);
  assert.equal(m.sourcePlan.resources.tenant.database.databaseName, before.sourcePlan.resources.tenant.database.databaseName);
  assert.equal(m.scope.ownerDeploymentId, input.scope.ownerDeploymentId); assert.equal(m.binding.resourceGeneration, 1);
  assert.equal(m.lifecycle.runRestoreOrMigration, false); assert.equal(m.lifecycle.oldPreparedV2ReceiptIssued, false);
  assert.equal(m.executionAuthorized, false); assert.equal(m.runtimeEnabled, false); assert.equal(m.readyVerified, false);
  assert.equal(m.controlPolicy.imageRevision, images.app.split('@')[1]);
  assert.equal(m.controlPolicy.business.firstOwnerUsername, 'fixture_admin'); assert.equal(root.materialSha256, await sha256Hex(m));
  input.configuration.buyerAccountsMax = 999; assert.notEqual(m.configurationSha256, await sha256Hex(input.configuration));
  assert.throws(() => { m.plan.resources.tenant.database.databaseName = 'tamper'; }, TypeError);
  const cell = await root.renderCell({ requestedAt: v3Now, availabilityZones: ['ca-central-1a', 'ca-central-1b'],
    certificateArn: 'arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789012',
    controlTrustStoreArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/fixture/abc123' });
  assert.equal(cell.resourceInventory.length, 16); assert.equal(cell.safety.executionAuthorized, false);
});

test('workload wires real registry digest, existing DB/fixed Secret, current epoch and network outputs; no one-shot parameter', async () => {
  const { input, f, outputs } = await fixture(), root = await prepareExpressSingleTenantDeliveryV1(input);
  const w = await root.renderWorkload({ fence: f.external, requestedAt: v3Now, cellOutputs: outputs, activeCellCount: 1, activeTenantCount: 0 });
  assert.equal(w.parameters.ImageUri, images.app); assert.equal(w.parameters.TenantRuntimeSecretArn, input.binding.runtimeSecret.arn);
  assert.equal(w.parameters.VpcId, outputs.VpcId); assert.equal(w.requiredExternalParameters.includes('VpcId'), false);
  assert.equal(w.requiredExternalParameters.includes('OneShotTaskSecurityGroupId'), false);
  assert.ok(w.templateBody.includes('tenant_existing_db')); assert.ok(w.templateBody.includes('/bootstrap-ready'));
  assert.equal(w.tags.ExternalOperationMarker, f.external.marker); assert.equal(w.resourceInventory.length, 7);
  assert.equal(w.safety.applyReady, false); assert.equal(w.safety.bootstrapHealthIsNotDeploymentReady, true);
});

test('foreign owner/generation/DB/epoch/network and mutable source hashes reject', async () => {
  for (const issue of ['hash', 'configuration', 'identity', 'budget', 'enabled']) {
    const { input } = await fixture();
    if (issue === 'hash') input.sourcePlanSha256 = '0'.repeat(64);
    if (issue === 'configuration') input.configurationSha256 = '0'.repeat(64);
    if (issue === 'identity') input.scope.workspaceId = 'ws_foreign';
    if (issue === 'budget') input.environment.policy.budgetLimitCents = 1000;
    if (issue === 'enabled') input.environment.applyEnabled = true;
    await assert.rejects(prepareExpressSingleTenantDeliveryV1(input), /EXPRESS_DELIVERY_/);
  }
  const { input, f, outputs } = await fixture(), root = await prepareExpressSingleTenantDeliveryV1(input);
  for (const issue of ['owner', 'epoch', 'database', 'generation', 'network', 'listeners', 'oneshot']) {
    const fence = structuredClone(f.external), cellOutputs = { ...outputs };
    if (issue === 'owner') fence.ownerDeploymentId = 'dep_foreign';
    if (issue === 'epoch') fence.state = 'pending_external';
    if (issue === 'database') fence.resourceFence.identity.databaseName = 'foreign_db';
    if (issue === 'generation') fence.resourceFence.generation = 2;
    if (issue === 'network') cellOutputs.VpcId = 'not-an-id';
    if (issue === 'listeners') cellOutputs.ControlListenerArn = cellOutputs.HttpsListenerArn;
    if (issue === 'oneshot') Object.assign(cellOutputs, { OneShotTaskSecurityGroupId: 'sg-0123456789abcdef0' });
    await assert.rejects(root.renderWorkload({ fence, requestedAt: v3Now, cellOutputs, activeCellCount: 1, activeTenantCount: 0 }), issue);
  }
});

test('control assembly performs zero I/O, fences wrong target/context before any private reads', async () => {
  const { input, f } = await fixture(), root = await prepareExpressSingleTenantDeliveryV1(input), calls: string[] = [];
  const forbidden = async () => { calls.push('unexpected'); throw Error('I/O not approved'); };
  const c = await root.composeControl({ transport: { send: forbidden }, tokens: { issue: forbidden }, bindings: { loadForAppInstance: forbidden },
    templateVersions: { loadById: forbidden }, runtimeBindings: { load: forbidden },
    sdk: { identity: forbidden, describe: forbidden, value: forbidden }, expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' });
  assert.deepEqual(calls, []); const signal = new AbortController().signal;
  await assert.rejects(async () => c.control.waitUntilHealthy({ hostname: 'foreign.sandbox.techlong.cloud', appInstanceId: input.scope.appInstanceId,
    externalFence: f.external, signal }), /EXPRESS_DELIVERY_CONTROL_TARGET_REJECTED/);
  await assert.rejects(c.compiler.compile({ context: { deployment: { id: 'foreign' } } as DeploymentExecutionContext,
    configurationHash: input.configurationSha256, externalFence: f.external, signal }), /EXPRESS_DELIVERY_CONTEXT_REJECTED/);
  assert.deepEqual(calls, []); assert.equal(c.readyWritebackImplemented, false);
});

test('scoped compiler uses independent template/configuration and fixed four-key lease; old image/schema drift reject before value read', async () => {
  for (const scenario of ['valid', 'old-image', 'schema-drift']) {
    const { input, f } = await fixture(), root = await prepareExpressSingleTenantDeliveryV1(input), calls: string[] = [];
    const context = { deployment: { id: input.scope.ownerDeploymentId, appInstanceId: input.scope.appInstanceId,
      environmentId: input.scope.environmentId, artifactRef: images.app, planHash: root.material.planSha256,
      desiredPlan: root.material.plan, configurationHash: input.configurationSha256 },
      appInstance: { id: input.scope.appInstanceId, workspaceId: input.scope.workspaceId, productId: input.scope.productId,
        templateVersionId: input.scope.templateVersionId, configurationSnapshot: input.configuration },
      workspace: { id: input.scope.workspaceId }, environment: input.environment, tenantExternalOperation: f.external } as DeploymentExecutionContext;
    if (scenario === 'old-image') context.deployment.artifactRef = FIRST_ACCEPTANCE_APP_IMAGE;
    const metadata = { ARN: f.arn, Name: f.name,
      Tags: Object.entries({ ManagedBy: 'techlong-sandbox', SecretSchema: 'techlong-runtime-four-key-v2', DatabaseProfile: 'express_iam',
        ResourceGeneration: '1', StableIdentity: input.binding.stableIdentity }).map(([Key, Value]) => ({ Key, Value })),
      VersionIdsToStages: { [input.binding.runtimeSecret.versionId]: ['AWSCURRENT'] } };
    const c = await root.composeControl({ transport: { async send() { throw Error('not called in this compiler test'); } },
      tokens: { async issue() { throw Error('not called'); } },
      bindings: { async loadForAppInstance() { calls.push('configuration'); return { appInstanceId: input.scope.appInstanceId,
        templateVersionId: input.scope.templateVersionId, resolvedConfiguration: input.configuration }; } },
      templateVersions: { async loadById() { calls.push('template'); const schema = structuredClone(input.configurationSchema);
        if (scenario === 'schema-drift') schema.fields[0].label += 'changed';
        return { id: input.scope.templateVersionId, status: 'published', configurationSchema: schema }; } },
      runtimeBindings: { async load() { calls.push('runtime'); return { fence: f.external.resourceFence, secretArn: f.arn }; } },
      sdk: { async identity() { calls.push('identity'); return { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' }; },
        async describe() { calls.push('metadata'); return metadata; },
        async value(arn, version) { calls.push('value'); assert.equal(version, input.binding.runtimeSecret.versionId);
          return { ARN: arn, Name: f.name, VersionId: version, VersionStages: ['AWSCURRENT'], SecretString: JSON.stringify({
            hmac_secret_key: Buffer.alloc(32, 7).toString('base64url'), jwt_secret_key: Buffer.alloc(32, 8).toString('base64url'),
            stripe_secret_key: 'sk_test_fixture', stripe_webhook_secret: 'whsec_fixture' }) }; } },
      expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' });
    assert.equal(calls.length, 0);
    const request = { context, externalFence: f.external, configurationHash: input.configurationSha256, signal: new AbortController().signal };
    if (scenario !== 'valid') {
      await assert.rejects(c.compiler.compile(request), /EXPRESS_DELIVERY_/); assert.equal(calls.includes('value'), false); continue;
    }
    const result = await c.compiler.compile(request), payload = result.compiledPayload;
    assert.equal((payload.instance as { metadata: { image_revision: string } }).metadata.image_revision, images.app.split('@')[1]);
    assert.deepEqual(payload.entitlements, root.material.controlPolicy.business.entitlements);
    assert.deepEqual(payload.default_store, root.material.controlPolicy.business.default_store);
    const owner = payload.first_owner as { username: string; password?: string };
    assert.equal(owner.username, 'fixture_admin'); assert.match(owner.password!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(calls.filter(x => x === 'value').length, 1);
    await assert.rejects(c.control.provision({ hostname: 'foreign.sandbox.techlong.cloud', appInstanceId: input.scope.appInstanceId,
      externalFence: f.external, compiledPayload: payload, idempotencyKey: 'fixture-only', signal: request.signal }));
    assert.equal('password' in owner, false); // Even wrapper-level rejection clears it.
  }
});
