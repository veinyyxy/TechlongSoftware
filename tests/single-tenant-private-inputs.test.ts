import test from "node:test";
import assert from "node:assert/strict";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE } from "../lib/deployments/execution/single-deployment-scope.ts";
import { assertAcceptanceResourceFence, assertTestPaymentMaterial, validateAcceptanceCredentialBinding, type AcceptanceCredentialBinding } from "../lib/deployments/execution/single-tenant-private-sources.ts";
import { createAcceptanceControlBindingSources, createAcceptanceReadonlyNeonSql } from "../lib/deployments/execution/single-tenant-control-bindings.ts";
import { createAcceptanceFirstOwnerPasswordSource, type FirstOwnerSecretReadonlyPort } from "../lib/deployments/execution/single-tenant-first-owner-password.ts";
import { deriveTenantResourceIdentity, deriveTenantOwnershipMarker, deriveTenantRuntimeSecretName } from "../lib/deployments/execution/tenant-database.ts";
import type { DeploymentExecutionContext, TenantResourceFence } from "../lib/deployments/execution/contracts.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const signal = () => new AbortController().signal, roleId = "AROAV3GNMXTZMEBX7MOF7";
async function fixture() {
  const appInstanceId = `app_${"4".repeat(32)}`, workspaceId = `ws_${"1".repeat(32)}`, productId = "prd_restaurant_order_system";
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: "aws_sandbox", region: "ca-central-1", cellKey: "cell-sandbox-1" }).buildPlan({
    appInstanceId, workspaceId, productId, planId: "plan_fixture", subscriptionId: "sub_fixture", tenantKey: "first_acceptance", deploymentProfileKey: "standard-v1" });
  const configuration = { defaultStoreName: "Fixture Store", firstOwnerUsername: "fixture_admin" };
  const binding: AcceptanceCredentialBinding = { workspaceId, productId, templateVersionId: "tplver_9c175436f0a14d9aa7f5fdfc2b5c139e", plan,
    scope: { deploymentId: "dep_fixture", appInstanceId, environmentId: "env_aws_sandbox_ca_central_1", planHash: await sha256Hex(plan),
      configurationHash: await sha256Hex(configuration), artifactRef: FIRST_ACCEPTANCE_APP_IMAGE } };
  const context = { deployment: { appInstanceId, environmentId: binding.scope.environmentId, desiredPlan: plan }, appInstance: { id: appInstanceId, workspaceId, productId },
    workspace: { id: workspaceId }, environment: { id: binding.scope.environmentId, cellKey: "cell-sandbox-1" } } as DeploymentExecutionContext;
  const identity = await deriveTenantResourceIdentity(context);
  const fence: TenantResourceFence = { schemaVersion: 1, identity, generation: 1, ownerDeploymentId: binding.scope.deploymentId, ownershipMarker: deriveTenantOwnershipMarker(identity, 1) };
  const name = deriveTenantRuntimeSecretName(fence), arn = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}-AbCdEf`;
  return { binding, fence, name, arn, configuration };
}
function provider(f: Awaited<ReturnType<typeof fixture>>) {
  let version = "fixture-version-1", reads = 0;
  const metadata = () => ({ ARN: f.arn, Name: f.name, Tags: Object.entries({ ManagedBy: "techlong-deployment-worker", SecretSchema: "techlong-runtime-five-key-v1",
    ResourceGeneration: "1", OwnershipMarker: f.fence.ownershipMarker }).map(([Key, Value]) => ({ Key, Value })), VersionIdsToStages: { [version]: ["AWSCURRENT"] } });
  const sdk: FirstOwnerSecretReadonlyPort = { identity: async () => ({ Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/fixture", UserId: `${roleId}:fixture` }),
    describe: async () => metadata(), value: async (arn, v) => { reads++; assert.equal(arn, f.arn); assert.equal(v, version);
      return { ARN: f.arn, Name: f.name, VersionId: v, SecretString: JSON.stringify({ database_url: "postgresql://fixture:fixture@fixture.invalid/fixture", hmac_secret_key: Buffer.alloc(32, 7).toString("base64url"),
        jwt_secret_key: Buffer.alloc(32, 8).toString("base64url"), stripe_secret_key: `sk_test_${"a".repeat(24)}`, stripe_webhook_secret: `whsec_${"b".repeat(24)}` }) }; } };
  return { sdk, metadata, setVersion: (v: string) => { version = v; }, reads: () => reads };
}

test("acceptance scope and resource fence agree with original identity derivation, foreign owners reject", async () => {
  const f = await fixture(); await validateAcceptanceCredentialBinding(f.binding); await assertAcceptanceResourceFence(f.binding, f.fence);
  for (const mutate of [(v: TenantResourceFence) => { v.ownerDeploymentId = "dep_other"; }, (v: TenantResourceFence) => { v.identity.workspaceId = `ws_${"2".repeat(32)}`; },
    (v: TenantResourceFence) => { v.identity.secretName = "techlong/sandbox/tenant/foreign/runtime"; }]) {
    const v = structuredClone(f.fence); mutate(v); await assert.rejects(assertAcceptanceResourceFence(f.binding, v));
  }
  const b = structuredClone(f.binding); b.plan.resources.tenant.database.databaseName = "foreign_db"; await assert.rejects(validateAcceptanceCredentialBinding(b));
});

test("payment test-format validation rejects live/placeholder/mixed input", () => {
  const keys = { stripeSecretKey: `sk_test_${"a".repeat(24)}`, stripeWebhookSecret: `whsec_${"b".repeat(24)}`, stripePublishableKey: `pk_test_${"c".repeat(24)}` };
  assertTestPaymentMaterial(keys);
  for (const patch of [{ stripeSecretKey: `sk_live_${"a".repeat(24)}` }, { stripeWebhookSecret: "whsec_placeholder" }, { stripePublishableKey: "" }])
    assert.throws(() => assertTestPaymentMaterial({ ...keys, ...patch }), { code: "ACCEPTANCE_TEST_PAYMENT_INPUT_INVALID" });
});

test("independent control binding uses parameterized exact SELECT, rejects hash drift and foreign app before read", async () => {
  const f = await fixture(), queries: string[] = [];
  const sources = await createAcceptanceControlBindingSources(f.binding, { async query(text, values) {
    queries.push(text); assert.match(text, /^SELECT/); assert.equal(values[0], f.binding.scope.appInstanceId);
    return [{ configuration_snapshot: JSON.stringify(f.configuration) }];
  } });
  assert.equal((await sources.bindings.loadForAppInstance({ appInstanceId: f.binding.scope.appInstanceId, signal: signal() }))?.templateVersionId, f.binding.templateVersionId);
  await assert.rejects(sources.bindings.loadForAppInstance({ appInstanceId: "app_foreign", signal: signal() })); assert.equal(queries.length, 1);
  const drift = await createAcceptanceControlBindingSources(f.binding, { query: async () => [{ configuration_snapshot: "{}" }] });
  await assert.rejects(drift.bindings.loadForAppInstance({ appInstanceId: f.binding.scope.appInstanceId, signal: signal() }), { code: "ACCEPTANCE_CONTROL_CONFIGURATION_DRIFT" });
  assert.throws(() => createAcceptanceReadonlyNeonSql("postgresql://fixture:fixture@other.invalid/fixture"));
});

test("first-owner password is stable for exact current version, domain separated, disposed and never serializable", async () => {
  const f = await fixture(), p = provider(f); let metadataReads = 0;
  p.sdk.describe = async () => { const m = p.metadata(); if (++metadataReads % 2 === 0) m.Tags.reverse(); return m; };
  const source = await createAcceptanceFirstOwnerPasswordSource({ binding: f.binding,
    bindings: { load: async () => ({ fence: f.fence, secretArn: f.arn }) }, sdk: p.sdk, expectedProvisionerRoleId: roleId });
  const request = { appInstanceId: f.binding.scope.appInstanceId, templateVersionId: f.binding.templateVersionId, signal: signal() };
  const a = await source.lease(request), b = await source.lease(request);
  assert.equal(a.read(), b.read()); assert.match(a.read(), /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a.read(), Buffer.alloc(32, 7).toString("base64url"));
  assert.equal(JSON.stringify(source), "{}"); assert.equal(JSON.stringify(a), "{}");
  p.setVersion("fixture-version-2"); const c = await source.lease(request); assert.notEqual(c.read(), a.read());
  a.dispose(); assert.throws(() => a.read(), { code: "ACCEPTANCE_FIRST_OWNER_LEASE_DISPOSED" }); b.dispose(); c.dispose();
});

test("first-owner foreign/Source caller, absent generation, metadata drift and race reject without write or replay", async () => {
  const f = await fixture();
  for (const problem of ["foreign", "source", "role-id", "missing", "tags", "versions", "race", "provider"] as const) {
    const p = provider(f); let metadataReads = 0;
    if (problem === "source") p.sdk.identity = async () => ({ Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAfixture" });
    if (problem === "role-id") p.sdk.identity = async () => ({ Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/fixture", UserId: "AROAFOREIGN:fixture" });
    p.sdk.describe = async () => { metadataReads++; const m = p.metadata();
      if (problem === "tags") m.Tags.push({ Key: "Unexpected", Value: "tag" });
      if (problem === "versions") m.VersionIdsToStages.extra = ["AWSPREVIOUS"];
      if (problem === "race" && metadataReads === 2) p.setVersion("raced-version");
      if (problem === "provider") throw Error("raw-provider-secret-must-not-escape");
      return problem === "race" ? p.metadata() : m; };
    const source = await createAcceptanceFirstOwnerPasswordSource({ binding: f.binding, expectedProvisionerRoleId: roleId, sdk: p.sdk,
      bindings: { load: async () => { if (problem === "missing") throw Error("ACCEPTANCE_FIRST_OWNER_VERIFIED_GENERATION_REQUIRED"); return { fence: f.fence, secretArn: f.arn }; } } });
    await assert.rejects(source.lease({ appInstanceId: problem === "foreign" ? "app_foreign" : f.binding.scope.appInstanceId,
      templateVersionId: f.binding.templateVersionId, signal: signal() }), e => e instanceof Error && !e.message.includes("raw-provider-secret"));
    assert.equal(p.reads(), problem === "race" ? 1 : 0);
  }
});
