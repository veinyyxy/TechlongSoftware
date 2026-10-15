import test from 'node:test';
import assert from 'node:assert/strict';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';
import { prepareExpressSingleTenantDeliveryV1 } from '../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { FIRST_ACCEPTANCE_APP_IMAGE } from '../lib/deployments/execution/single-deployment-scope.ts';
import { prepareExpressPrivateControlRebindV1, assertExpressPrivateControlRebindV1, loadExpressPrivateControlSourcesV1 } from '../lib/deployments/execution/express-private-control-v1.ts';
import { createExpressControlBindingSourcesV1 } from '../lib/deployments/execution/express-control-binding-sources-v1.ts';
import { createPreparedExpressFirstDeploymentRuntimeV1 } from '../lib/deployments/execution/express-first-deployment-runtime-v1.ts';
import { createExpressDeploymentClaimScopeV1 } from '../lib/deployments/execution/express-deployment-scope-v1.ts';
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentity } from '../lib/deployments/execution/tenant-database.ts';
import type { DeploymentExecutionContext } from '../lib/deployments/execution/contracts.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
const signal = () => new AbortController().signal;
async function fixture() {
  const f = await firstClaimFixture();
  f.input.scope.templateVersionId = 'tplver_9c175436f0a14d9aa7f5fdfc2b5c139e';
  const root = await prepareExpressSingleTenantDeliveryV1(f.input);
  const historicalBinding = { workspaceId: f.input.scope.workspaceId, productId: f.input.scope.productId,
    templateVersionId: f.input.scope.templateVersionId, plan: f.input.sourcePlan,
    scope: { deploymentId: f.input.scope.ownerDeploymentId, appInstanceId: f.input.scope.appInstanceId, environmentId: f.input.scope.environmentId,
      planHash: f.input.sourcePlanSha256, configurationHash: f.input.configurationSha256, artifactRef: FIRST_ACCEPTANCE_APP_IMAGE } };
  const summary = { protocol: 'd001-local-private-inputs', businessIndependentReadOnlyVerified: true, runtimeEnabled: false,
    bindingSha256: await sha256Hex(historicalBinding), scopeSha256: await sha256Hex(historicalBinding.scope),
    publicKeySha256: '1'.repeat(64), clientCertificateSha256: '2'.repeat(64), clientCaSha256: '3'.repeat(64) };
  const input = { sourceMaterial: root.material, sourceMaterialSha256: root.materialSha256, subscriptionId: f.subscriptionId,
    historicalBinding, historicalSummary: summary, historicalSummarySha256: await sha256Hex(summary) };
  const plan = await prepareExpressPrivateControlRebindV1(input);
  const target = await prepareExpressSingleTenantDeliveryV1({ ...f.input, scope: { ...f.input.scope, ownerDeploymentId: plan.targetScope.deploymentId } });
  return { ...f, root, rebindInput: input, plan, target };
}
function fakeLoader(f: Awaited<ReturnType<typeof fixture>>) {
  let reads = 0, disposed = 0, tokens = 0, http = 0;
  const sources = { summary: { publicKeySha256: f.plan.publicKeySha256, clientCertificateSha256: f.plan.clientCertificateSha256, clientCaSha256: f.plan.clientCaSha256 },
    controlTokens: { issue: async () => { tokens++; return 'unit-test-not-a-real-token'; } },
    controlTransport: { send: async () => { http++; return { status: 200, body: {} }; } },
    publicParameters: { ControlIssuer: 'https://techlong.cloud', CorsAllowedOrigins: 'https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud',
      StripePublishableKey: 'pk_test_' + 'a'.repeat(24), StripeSuccessUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-success?session_id={CHECKOUT_SESSION_ID}',
      StripeCancelUrl: 'https://first-acceptance.sandbox.techlong.cloud/payment-cancel' },
    dispose() { disposed++; } };
  const loader = (async () => { reads++; return { binding: f.rebindInput.historicalBinding, sources,
    summarySha256: f.plan.historicalSummarySha256, aclVerified: true }; }) as unknown as Parameters<typeof loadExpressPrivateControlSourcesV1>[1];
  return { loader, sources, counts: () => ({ reads, disposed, tokens, http }) };
}

test('explicit provenance keeps Full validator and historical plan, computes exact newly prepared Express target hash', async () => {
  const f = await fixture(); assertExpressPrivateControlRebindV1(f.plan);
  assert.notEqual(f.plan.targetScope.deploymentId, f.plan.historicalDeploymentId);
  assert.notEqual(f.plan.targetScope.artifactRef, f.plan.historicalArtifactRef);
  assert.equal(f.plan.targetMaterialSha256, f.target.materialSha256);
  assert.equal(f.plan.executionAuthorized, false); assert.equal(f.plan.secretValuesIncluded, false);
  assert.equal(Object.isFrozen(f.plan.targetScope), true);
  assert.throws(() => assertExpressPrivateControlRebindV1(structuredClone(f.plan)));
  assert.equal(f.rebindInput.historicalBinding.plan.resources.tenant.database.databaseName, f.rebindInput.sourceMaterial.sourcePlan.resources.tenant.database.databaseName);
});

test('foreign original owner, workspace, artifact, plan, summary or target hash fails without private loading', async () => {
  for (const issue of ['owner', 'workspace', 'artifact', 'plan', 'summary', 'material'] as const) {
    const f = await fixture(), x = structuredClone(f.rebindInput);
    if (issue === 'owner') x.historicalBinding.scope.deploymentId = 'dep_foreign';
    if (issue === 'workspace') x.historicalBinding.workspaceId = 'ws_' + '0'.repeat(32);
    if (issue === 'artifact') x.historicalBinding.scope.artifactRef = f.plan.targetScope.artifactRef;
    if (issue === 'plan') {
      x.sourceMaterial.plan.resources.tenant.costTags.Extra = 'changed';
      x.sourceMaterial.planSha256 = await sha256Hex(x.sourceMaterial.plan);
      x.sourceMaterialSha256 = await sha256Hex(x.sourceMaterial);
    }
    if (issue === 'summary') x.historicalSummary.publicKeySha256 = 'bad';
    if (issue === 'material') x.sourceMaterialSha256 = '0'.repeat(64);
    await assert.rejects(prepareExpressPrivateControlRebindV1(x));
  }
});

test('private loader is once, no token/http during load, exposes only control/public parameters, disposal blocks delegates', async () => {
  const f = await fixture(), port = fakeLoader(f);
  await assert.rejects(loadExpressPrivateControlSourcesV1({ directory: 'fixture-only', plan: structuredClone(f.plan) }, port.loader));
  assert.equal(port.counts().reads, 0);
  const v = await loadExpressPrivateControlSourcesV1({ directory: 'fixture-only', plan: f.plan }, port.loader);
  assert.deepEqual(port.counts(), { reads: 1, disposed: 0, tokens: 0, http: 0 });
  assert.equal('paymentCredentials' in v, false); assert.equal(JSON.stringify(v).includes('privateKeyPem'), false);
  await assert.rejects(async () => v.controlTokens.issue({ instanceId: 'foreign', audience: 'speedfeast-instance:foreign', scope: 'speedfeast:control', signal: signal() }));
  await assert.rejects(async () => v.controlTransport.send({ method: 'GET', url: 'https://foreign.techlong.cloud:8443/ready', headers: {} }, { signal: signal() }));
  v.dispose(); v.dispose(); assert.equal(port.counts().disposed, 1);
  await assert.rejects(async () => v.controlTokens.issue({ instanceId: f.plan.targetScope.appInstanceId,
    audience: `speedfeast-instance:${f.plan.targetScope.appInstanceId}`, scope: 'speedfeast:control', signal: signal() }));
  assert.equal(port.counts().tokens, 0); assert.equal(port.counts().http, 0);
});

test('loaded fingerprint/ACL drift is disposed and raw provider messages are sanitized', async () => {
  const f = await fixture(), p = fakeLoader(f); p.sources.summary.publicKeySha256 = '0'.repeat(64);
  await assert.rejects(loadExpressPrivateControlSourcesV1({ directory: 'fixture-only', plan: f.plan }, p.loader), /EXPRESS_PRIVATE_LOADED_PROVENANCE_CHANGED/);
  assert.equal(p.counts().disposed, 1);
  await assert.rejects(loadExpressPrivateControlSourcesV1({ directory: 'fixture-only', plan: f.plan }, async () => { throw Error('raw-secret-value'); }),
    e => e instanceof Error && e.message === 'EXPRESS_PRIVATE_LOAD_FAILED');
});

test('live bindings assemble without a SELECT; foreign app/template/plain scope reject before read', async () => {
  const f = await fixture(); let calls = 0;
  const make = (scope = f.plan.targetScope) => createExpressControlBindingSourcesV1({ material: f.target.material, materialSha256: f.target.materialSha256,
    scope, sql: { query: async () => { calls++; return []; } } });
  const s = await make(); assert.equal(calls, 0);
  await assert.rejects(s.bindings.loadForAppInstance({ appInstanceId: 'foreign', signal: signal() }));
  await assert.rejects(s.templateVersions.loadById({ templateVersionId: 'foreign', signal: signal() }));
  await assert.rejects(make(structuredClone(f.plan.targetScope))); assert.equal(calls, 0);
});

test('live app/schema readback uses exact bound values and catches actual configuration/schema drift', async () => {
  const f = await fixture(), m = f.target.material; let drift = false; const calls: unknown[][] = [];
  const s = await createExpressControlBindingSourcesV1({ material: m, materialSha256: f.target.materialSha256,
    scope: createExpressDeploymentClaimScopeV1(f.plan.targetScope), sql: { async query(text, values) {
      assert.match(text, /^SELECT/); calls.push(values);
      if (text.includes('FROM public.app_instance_template_versions')) return [{ id: m.scope.templateVersionId, status: 'published', configuration_schema: f.input.configurationSchema }];
      return [{ id: m.scope.appInstanceId, template_version_id: m.scope.templateVersionId, configuration_snapshot: JSON.stringify(drift ? {} : f.configuration) }];
    } } });
  assert.equal((await s.templateVersions.loadById({ templateVersionId: m.scope.templateVersionId, signal: signal() }))?.id, m.scope.templateVersionId);
  assert.equal(calls.length, 2); assert.equal(calls[1][0], m.scope.appInstanceId);
  drift = true; await assert.rejects(s.bindings.loadForAppInstance({ appInstanceId: m.scope.appInstanceId, signal: signal() }), /EXPRESS_CONTROL_CONFIGURATION_DRIFT/);
});

test('live generation lookup requires exact physical identity and active epoch, never fabricates a missing owner', async () => {
  const f = await fixture(), m = f.target.material;
  const identity = await deriveTenantResourceIdentity({ deployment: { appInstanceId: m.scope.appInstanceId, environmentId: m.scope.environmentId, desiredPlan: m.plan },
    appInstance: { id: m.scope.appInstanceId, workspaceId: m.scope.workspaceId, productId: m.scope.productId }, workspace: { id: m.scope.workspaceId }, environment: m.environment } as DeploymentExecutionContext);
  const row = { app_instance_id: identity.appInstanceId, workspace_id: identity.workspaceId, product_id: identity.productId, environment_id: identity.environmentId,
    cell_key: identity.cellKey, stable_identity_hash: identity.stableIdentityHash, database_name: identity.databaseName, role_name: identity.roleName,
    secret_name: identity.secretName, generation: 1, owner_deployment_id: f.plan.targetScope.deploymentId, created_by_deployment_id: f.plan.targetScope.deploymentId,
    ownership_marker: deriveTenantOwnershipMarker(identity, 1), runtime_secret_ref: m.binding.runtimeSecret.arn, lifecycle_status: 'verified', destroyed_at: null,
    external_operation_epoch: 1, observed_epoch: 1, observed_operation_hash: 'a'.repeat(64), observed_marker: `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g1_e1` };
  let rows: Record<string, unknown>[] = [];
  const s = await createExpressControlBindingSourcesV1({ material: m, materialSha256: f.target.materialSha256, scope: f.plan.targetScope,
    sql: { async query(text, values) { assert.match(text, /r.created_by_deployment_id=\$1/); assert.equal(values[0], f.plan.targetScope.deploymentId); return rows; } } });
  const request = { appInstanceId: m.scope.appInstanceId, templateVersionId: m.scope.templateVersionId, signal: signal() };
  await assert.rejects(s.runtimeBindings.load(request), /EXPRESS_CONTROL_VERIFIED_GENERATION_REQUIRED/);
  rows = [row]; assert.equal((await s.runtimeBindings.load(request)).secretArn, m.binding.runtimeSecret.arn);
  for (const patch of [{ owner_deployment_id: 'dep_foreign' }, { database_name: 'other' }, { generation: 2 }, { external_operation_epoch: 2 }, { observed_marker: 'wrong' }]) {
    rows = [{ ...row, ...patch }]; await assert.rejects(s.runtimeBindings.load(request), /EXPRESS_CONTROL_RESOURCE_BINDING_DRIFT/);
  }
});

test('prepared runtime composes real Express ports lazily and rejects foreign private target before connecting', async () => {
  const f = await fixture(), p = fakeLoader(f), sources = await loadExpressPrivateControlSourcesV1({ directory: 'fixture-only', plan: f.plan }, p.loader);
  const runtime = await createPreparedExpressFirstDeploymentRuntimeV1({ delivery: f.input, subscriptionId: f.subscriptionId, databaseUrl: 'postgresql://fixture:fixture@fixture.neon.tech/test' });
  const sdk = { identity: async () => { throw Error('should-not-read'); }, describe: async () => ({}), value: async () => ({}) };
  const c = await runtime.composeLiveControl({ sources, sdk, expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' });
  assert.equal(c.executionAuthorized, false); assert.equal(c.readyWritebackImplemented, false); assert.equal(p.counts().tokens, 0);
  await assert.rejects(runtime.composeLiveControl({ sources: { ...sources, summary: { ...sources.summary, targetMaterialSha256: '0'.repeat(64) } }, sdk,
    expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' }), /EXPRESS_FIRST_DEPLOYMENT_PRIVATE_SCOPE_REJECTED/);
  sources.dispose();
});
