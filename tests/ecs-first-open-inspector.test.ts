import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { inspectEcsFirstOpen } from "../lib/deployments/execution/ecs-first-open-inspector.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";

async function fixture(fixtureTest: TestContext) {
  const cycle = await cycleFixture();
  fixtureTest.after(cycle.destroy);
  const facts = cycle.facts();
  const image = cycle.plan.to;
  const hostname = "tenant.sandbox.example.invalid";
  const dnsTarget = "api.sandbox.example.invalid";
  const ownershipMarker = "synthetic-owner";
  const baselineDigest = "1".repeat(64);
  const configurationHash = "2".repeat(64);
  const identity = {
    schemaVersion: 1 as const, appInstanceId: cycle.plan.selection.instanceId,
    workspaceId: cycle.plan.selection.workspaceId, productId: cycle.plan.productId,
    environmentId: cycle.plan.selection.environmentId, cellKey: "fixture-cell",
    stableIdentityHash: "3".repeat(64), databaseName: "tenant_example", roleName: "tenant_app", secretName: "tenant-secret",
  };
  const database = { name: identity.databaseName, roleName: identity.roleName, ownershipMarker, baselineDigest };
  facts.stackStatus = "CREATE_COMPLETE";
  facts.parameters.TenantHostname = hostname;
  facts.parameters.ImageUri = image.imageUri;
  facts.taskDefinition.containerDefinitions![0].image = image.imageUri;
  facts.tasks[0].containers![0].image = image.imageUri;
  facts.tasks[0].containers![0].imageDigest = image.platformDigest;
  const steps: string[] = [];
  const application = { ready: true, desiredConfigurationHash: configurationHash, imageRevision: image.imageUri.split("@")[1] };
  const input: Parameters<typeof inspectEcsFirstOpen>[0] = {
    context: {
      appInstance: { id: identity.appInstanceId },
      deployment: { id: "synthetic-deployment", artifactRef: image.imageUri, configurationHash },
      tenantExternalOperation: null,
      tenantResources: { identity, ownershipMarker, generation: 1, lifecycleStatus: "verified", baselineDigest },
    },
    stack: {
      schemaVersion: 1, protocol: "single-tenant-supervised-workload", stackName: facts.stackId.split("/")[1],
      accountId: cycle.plan.accountId, region: cycle.plan.region, clientRequestToken: "synthetic",
      onFailure: "ROLLBACK", capabilities: [], template: facts.template, templateBody: canonicalJson(facts.template),
      templateSha256: await sha256Hex(facts.template), parameters: { ...facts.parameters }, requiredExternalParameters: [],
      tags: { ...facts.tags }, cloudFormationRoleArn: facts.roleArn!,
      resourceInventory: Object.entries(facts.resources).map(([logicalId, r]) => ({ logicalId, type: r.type })),
      safety: {
        renderOnly: true, executionAuthorized: false, runtimeEnabled: false, callsAws: false,
        createsDatabaseResources: false, automaticCleanupInstalled: false, supervisedExactArnCleanupRequired: true,
        fixedTaskCount: 1, capacityProvider: "FARGATE", ownershipChecksRetained: true,
        existingWorkerRendererUnchanged: true, appReadyNotYetVerified: true, parametersValidated: true,
      },
    },
    stackId: facts.stackId, dnsTarget, databaseSchemaVersion: facts.databaseSchemaVersion,
    baselineDigest, platformDigest: image.platformDigest, now: () => cycle.sql.now,
    signal: new AbortController().signal,
    reader: { async capture(target) {
      steps.push("runtime");
      assert.deepEqual(target, { stackId: facts.stackId, hostname, databaseName: identity.databaseName, signal: input.signal });
      return { facts, dns: { hostname, target: dnsTarget }, database };
    } },
    async readConfiguration(signal) {
      assert.equal(signal, input.signal);
      steps.push("configuration");
      return application;
    },
  };
  return { input, application, facts, steps };
}

test("ECS first-open self-check reads the target and freshly reconciles application configuration", async t => {
  const { input, steps } = await fixture(t);
  const result = await inspectEcsFirstOpen(input);
  assert.deepEqual(steps, ["runtime", "configuration"]);
  assert.equal(result.instanceId, input.context.appInstance.id);
  assert.equal(result.stackId, input.stackId);
  assert.equal(result.imageUri, input.context.deployment.artifactRef);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary|customerActivated|initialBindingText/);
});

test("ECS first-open self-check rejects a healthy target with the wrong app configuration", async t => {
  const { input, application, steps } = await fixture(t);
  application.desiredConfigurationHash = "4".repeat(64);
  await assert.rejects(inspectEcsFirstOpen(input), /ECS_FIRST_OPEN_CONFIGURATION_MISMATCH/);
  assert.deepEqual(steps, ["runtime", "configuration"]);
});

test("ECS first-open self-check stops before reading app configuration when the running image is wrong", async t => {
  const { input, facts, steps } = await fixture(t);
  facts.tasks[0].containers![0].imageDigest = "sha256:" + "5".repeat(64);
  await assert.rejects(inspectEcsFirstOpen(input), /RELEASE_RUNNING_DIGEST_MISMATCH/);
  assert.deepEqual(steps, ["runtime"]);
});
