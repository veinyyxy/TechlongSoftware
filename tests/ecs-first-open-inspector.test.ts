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

test("ECS first-open self-check requires the explicitly bound RDS database profile", async t => {
  const { input, facts, steps } = await fixture(t);
  const application = { arn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:fixture-app-aBc123", versionId: "a".repeat(64) };
  const control = { arn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:fixture-control-aBc123", versionId: "b".repeat(64), jsonKey: "key" };
  const persistence = { bucket: "techlong-sandbox-synthetic-media", providerVariable: "IMAGE_STORAGE_PROVIDER" as const,
    bucketVariable: "IMAGE_S3_BUCKET" as const, verificationSha256: "c".repeat(64), mediaPublicBaseUrl: "https://synthetic.cloudfront.net" };
  const rds = { ...input, databaseProfile: "full_password" as const,
    rdsWorkload: { application, control, persistence, privateSubnetIds: ["subnet-aaaaaaaa", "subnet-bbbbbbbb"] } };
  await assert.rejects(inspectEcsFirstOpen({ ...rds, rdsWorkload: undefined }), /ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH/);
  const api = facts.taskDefinition.containerDefinitions![0];
  api.name = facts.service.loadBalancers![0].containerName = facts.tasks[0].containers![0].name = "speedfeast-backend";
  api.environment = Object.entries({ PG_DATABASE_PROFILE: "full_password", PGSSLMODE: "verify-full", PGSSL_REJECT_UNAUTHORIZED: "true",
    PGSSLROOTCERT: "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem", IMAGE_STORAGE_PROVIDER: "s3", IMAGE_S3_BUCKET: persistence.bucket,
    IMAGE_PUBLIC_BASE_URL: persistence.mediaPublicBaseUrl, ALLOW_EPHEMERAL_IMAGE_STORAGE: "false" }).map(([name, value]) => ({ name, value }));
  api.secrets = Object.entries({ DATABASE_URL: "database_url", HMAC_SECRET_KEY: "hmac_secret_key", JWT_SECRET_KEY: "jwt_secret_key",
    STRIPE_SECRET_KEY: "stripe_secret_key", STRIPE_WEBHOOK_SECRET: "stripe_webhook_secret" })
    .map(([name, key]) => ({ name, valueFrom: `${application.arn}:${key}::${application.versionId}` }));
  api.secrets.push({ name: "SAAS_CONTROL_PUBLIC_KEY", valueFrom: `${control.arn}:key::${control.versionId}` });
  await assert.rejects(inspectEcsFirstOpen(rds), /RELEASE_IMAGE_OR_COMPATIBILITY_CHANGED/);
  assert.deepEqual(steps, ["runtime"]);
  facts.databaseProfile = "full_password";
  const database = api.secrets[0], exact = database.valueFrom;
  database.valueFrom = `${application.arn}:database_url::`;
  await assert.rejects(inspectEcsFirstOpen(rds), /ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH/);
  database.valueFrom = `${application.arn}:different_key::${application.versionId}`;
  await assert.rejects(inspectEcsFirstOpen(rds), /ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH/);
  database.valueFrom = exact;
  assert.equal((await inspectEcsFirstOpen(rds)).databaseProfile, "full_password");
  assert.deepEqual(steps, ["runtime", "runtime", "runtime", "runtime", "configuration"]);
});

test("ECS first-open self-check stops before reading app configuration when the running image is wrong", async t => {
  const { input, facts, steps } = await fixture(t);
  facts.tasks[0].containers![0].imageDigest = "sha256:" + "5".repeat(64);
  await assert.rejects(inspectEcsFirstOpen(input), /RELEASE_RUNNING_DIGEST_MISMATCH/);
  assert.deepEqual(steps, ["runtime"]);
});
