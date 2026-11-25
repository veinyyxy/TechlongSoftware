import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import { tenantExternalOperationHash } from "../lib/deployments/execution/external-ownership-coordinator.ts";
import { FIRST_OPEN_BASELINE_OBJECTS } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan, deriveTenantRuntimeSecretName } from "../lib/deployments/execution/tenant-database.ts";
import { SELECT_FIRST_ONBOARDING, buildFirstOnboardingJob, reviewFirstOnboarding } from "../lib/deployments/first-onboarding.ts";
import { FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN } from "../ops/platform-hosting-v1/first-open-rds-ownership.ts";
import { createFirstOpenRdsManagement } from "../ops/platform-hosting-v1/first-open-rds-management.ts";
import { createFirstOpenRdsInspector } from "../ops/platform-hosting-v1/first-open-rds-inspector.ts";
import { runFirstOpenCommand } from "../ops/platform-hosting-v1/first-open.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_CLUSTER as clusterArn,
  FIRST_OPEN_TASK_FAMILY as family, FIRST_OPEN_TASK_ROLE as roleArn, FIRST_OPEN_TASK_CONTAINER as containerName } from "../ops/platform-hosting-v1/first-open-task-identity.ts";

const now = () => 1_800_000_000_000;
const hex = char => char.repeat(64);
const taskArn = clusterArn.replace(":cluster/", ":task/") + "/" + "b".repeat(32);
const taskDefinitionArn = `arn:aws:ecs:${region}:${account}:task-definition/${family}:7`;
const appInstanceId = "app_fixture", workspaceId = "wsp_fixture", slug = "fixture", hostname = `${slug}.sandbox.techlong.cloud`;
const productId = "prd_restaurant_order_system", environmentId = "env_aws_sandbox_ca_central_1";
const repoPrefix = `${account}.dkr.ecr.${region}.amazonaws.com/`, manifestDigest = `sha256:${hex("e")}`;
const stackId = name => `arn:aws:cloudformation:${region}:${account}:stack/${name}/11111111-2222-3333-4444-555555555555`;
const elbPrefix = `arn:aws:elasticloadbalancing:${region}:${account}:`;
const ingress = { albArn: elbPrefix + "loadbalancer/app/fixture/aaaaaaaaaaaaaaaa", dnsName: `internal-fixture.${region}.elb.amazonaws.com`,
  httpsListenerArn: elbPrefix + "listener/app/fixture/aaaaaaaaaaaaaaaa/1111111111111111",
  controlListenerArn: elbPrefix + "listener/app/fixture/aaaaaaaaaaaaaaaa/2222222222222222", vpcId: "vpc-12345678", clusterArn };
const secret = name => ({ arn: `arn:aws:secretsmanager:${region}:${account}:secret:${name}-abc123`, versionId: "d".repeat(32) });
const trustStoreArn = elbPrefix + "truststore/fixture/cccccccccccccccc";
const cellStackId = stackId("techlong-sandbox-cell-sandbox-1");
const cellTemplate = { Resources: {} };

function pinEnv(name, value) {
  const json = JSON.stringify(value);
  return { [name + "_JSON"]: json, [name + "_SHA256"]: createHash("sha256").update(json).digest("hex") };
}

async function fixture() {
  const calls = [];
  const release = { id: "release_" + "a".repeat(32), productId, component: "tenant_api", status: "ecr_verified", source: { repository: "test/backend" },
    image: { repository: repoPrefix + "techlong-sandbox-speedfeast", manifestDigest, platformDigest: `sha256:${hex("f")}`,
      runtimePlatform: "linux/amd64", verificationSha256: hex("0") },
    compatibility: { applicationPort: 3000, schemaVersions: ["fixture-v1"], clientApiVersions: ["v1"], databaseProfiles: ["full_password"],
      requiresMigration: false, startupWrites: false } };
  const seed = { appInstanceId, workspaceId, productId, subscriptionId: "sub_fixture", planId: "plan_fixture", tenantKey: "pending_fixture",
    deploymentProfileKey: "standard-v1" };
  const desiredPlan = new AwsEcsCellPlanOnlyDriver({ region, cellKey: "cell-sandbox-1", mode: "aws_sandbox" }).buildPlan(seed);
  const configuration = { fixture: true };
  const scope = { appInstanceId, environmentId, planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration),
    artifactRef: `${release.image.repository}@${manifestDigest}` };
  const fullScope = { ...scope, workspaceId, subscriptionId: seed.subscriptionId, tenantKey: seed.tenantKey, planId: seed.planId,
    templateVersionId: "tplver_restaurant_standard_v1", releaseId: release.id, accountId: account };
  const held = await buildFirstOnboardingJob(fullScope);
  const row = { ...fullScope, configuration, desiredPlan, slug, subscriptionEnd: now() + 3_600_000, instancePendingFirstOpen: true,
    subscriptionActiveAndCurrent: true, scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", ...scope },
    job: { id: held.jobId, deploymentId: held.deploymentId, status: "pending", jobType: "apply", payload: held.payload, dedupeKey: held.dedupeKey,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const review = await reviewFirstOnboarding({ ...row, scope: fullScope, release }, undefined, "full_password");
  assert.ok(review);
  const selection = { jobId: held.jobId, instanceId: appInstanceId, workspaceId, releaseId: release.id, reviewSha256: review.reviewSha256, hostname };
  const settings = { baselineDigest: FIRST_OPEN_BASELINE_OBJECTS.archive.sha256, databaseSchemaVersion: "fixture-v1", dnsTarget: ingress.dnsName,
    writeBefore: now() + 60_000 };
  const identity = await deriveTenantResourceIdentityFromPlan({ appInstanceId, workspaceId, productId, environmentId, cellKey: desiredPlan.cellKey },
    desiredPlan.resources.tenant.database);
  const resourceFence = { schemaVersion: 1, identity, generation: 1, ownerDeploymentId: held.deploymentId,
    ownershipMarker: deriveTenantOwnershipMarker(identity, 1) };
  const fence = { schemaVersion: 1, state: "active", intent: "provision", epoch: 1, ownerDeploymentId: held.deploymentId, resourceFence,
    marker: `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g1_e1`, operationHash: await tenantExternalOperationHash("provision", resourceFence, row.deployment) };
  const applicationSecret = secret(deriveTenantRuntimeSecretName(resourceFence)), controlPublicKey = secret("techlong/sandbox/fixture/control-public");
  const dbInstanceIdentifier = "fixture-db", host = `${dbInstanceIdentifier}.abcdef.${region}.rds.amazonaws.com`;
  const target = { kind: "rds", engine: "postgres", host, port: 5432, dbInstanceIdentifier, database: identity.databaseName,
    owner: "fixture_owner", username: "fixture_owner", databaseOid: "15000", ownershipMarker: resourceFence.ownershipMarker, isolatedEmpty: true };
  const tenant = { host, dbInstanceIdentifier, database: target.database, databaseOid: target.databaseOid, owner: target.owner,
    ownershipMarker: target.ownershipMarker, username: "fixture_reader", applicationRole: identity.roleName, dbiResourceId: "db-" + "A".repeat(22),
    runtimeSecretArn: applicationSecret.arn };
  const binding = { environmentId, status: "active", workerRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`,
    cloudFormationRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxCloudFormationExecutionRole`, tenantStackParameters: {
      VpcId: ingress.vpcId, HttpsListenerArn: ingress.httpsListenerArn, ControlListenerArn: ingress.controlListenerArn, ClusterName: clusterArn,
      ControlPublicKeyValueFrom: controlPublicKey.arn, ControlIssuer: "https://techlong.cloud",
    } };
  const boundScope = { ...scope, deploymentId: held.deploymentId };
  const pin = { version: "techlong/ecs-first-open-resources/v2", selection, settings, scope: boundScope,
    management: { fence, target, managementSecret: secret("fixture/management"), baselineVersions: { archive: "archive-v1", manifest: "manifest-v1" },
      stack: { templateSha256: hex("1"), parametersSha256: hex("2") } },
    applicationSecret, controlPublicKey, ownershipTableArn: FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN,
    inspector: { stackName: awsSandboxTenantStackName(appInstanceId), tenant, ingress, readSecret: secret("fixture/inspector-read"),
      route53Endpoint: "https://vpce-123456789-abc.route53.us-east-1.vpce.amazonaws.com", mediaPublicBaseUrl: "https://fixture.cloudfront.net",
      sampling: { cellStackId, platformStackId: stackId("techlong-sandbox-platform-hosting-v1"), apiHostname: hostname, hostedZoneId: "ZFIXTURE1",
        cellOutputParameters: { HttpsListenerArn: "HttpsListenerArn", ControlListenerArn: "ControlListenerArn", ClusterName: "ClusterName" },
        database: { identifier: dbInstanceIdentifier, kind: "instance", profile: "full_password", schemaVersion: "fixture-v1" },
        secrets: [{ ...applicationSecret }, { ...controlPublicKey }], persistence: { bucket: "fixture-private-media", providerVariable: "IMAGE_STORAGE_PROVIDER",
          bucketVariable: "IMAGE_S3_BUCKET", verificationSha256: hex("3") } } },
    cell: { templateSha256: await sha256Hex(cellTemplate), parametersSha256: await sha256Hex(binding.tenantStackParameters), trustStoreArn,
      cleanup: { scopeSha256: await sha256Hex(boundScope), reviewSha256: hex("4"), permissionsEvidenceSha256: hex("5"),
        observedAt: now() - 1_000, validUntil: now() + 120_000, expiresAt: now() + 900_000,
        responsibleCallerArn: `arn:aws:iam::${account}:user/techlong-sandbox-dev` } },
    control: { configurationSchemaSha256: hex("6"), credentials: { ...secret("fixture/control-private"), subject: "fixture-agent",
      signingPublicKeySha256: await sha256Hex("fixture-public-key"), clientCertificateSha256: hex("8"), clientCaSha256: hex("9") } },
  };
  const taskBinding = { version: "techlong/ecs-first-open-task/v1", clusterArn, family, containerName, taskRoleArn: roleArn,
    image: `${repoPrefix}techlong-sandbox-platform-web@${manifestDigest}`, controlHost: `control.abcdef.${region}.rds.amazonaws.com`,
    controlDatabase: "control_fixture", readDbRole: "fixture_read", writeDbRole: "fixture_write" };
  const env = { ...pinEnv("TECHLONG_FIRST_OPEN_TASK_BINDING", taskBinding), AWS_REGION: region, AWS_EXECUTION_ENV: "AWS_ECS_FARGATE",
    ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/fixture", AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/fixture" };
  const executionId = "exec_" + randomUUID().replaceAll("-", "");
  const approved = { ...selection, executionId, approvedBy: "user_fixture", approvedAt: now() - 5_000 };
  let claimAttempts = 0;
  const port = (sql, args, readOnly) => {
    if (/e\.dispatch_outcome AS outcome/.test(sql)) {
      assert.ok(readOnly);
      assert.deepEqual(args, [executionId]);
      return { ...approved, startedAt: now() - 4_000, ackAt: now() - 3_000, outcome: "acknowledged", taskArn, taskDefinitionArn };
    }
    if (sql === SELECT_FIRST_ONBOARDING) { assert.deepEqual(args, [held.jobId]); calls.push("held-review"); return row; }
    if (sql.includes("FROM deployment_release.releases")) { assert.deepEqual(args, [release.id]); calls.push("release"); return { document: release }; }
    if (sql.includes("FROM deployment_environment_bindings")) {
      assert.ok(readOnly);
      assert.deepEqual(args, [environmentId]);
      calls.push("binding");
      return binding;
    }
    assert.equal(readOnly, false);
    if (sql.includes("SELECT opened.id AS")) { assert.deepEqual(args, [executionId, taskArn, taskDefinitionArn]); return approved; }
    if (sql.startsWith("WITH approval AS MATERIALIZED")) {
      assert.match(sql, /opened\.dispatch_task_definition_arn = \$24/);
      assert.equal(args[23], taskDefinitionArn);
      calls.push("claim-attempt");
      claimAttempts++;
      return null;
    }
    assert.fail("unexpected control query");
  };
  const db = readOnly => ({ prepare: sql => ({ bind: (...args) => ({ first: async () => port(sql, args, readOnly) }) }) });
  const cloudCredentialCalls = () => assert.fail("a real SDK requested credentials");
  const options = { now, verifyImage: async () => { calls.push("image"); },
    readLocal: async url => url.pathname.endsWith("/task") ? { Cluster: clusterArn, Family: family, Revision: "7", LaunchType: "FARGATE", TaskARN: taskArn,
      Containers: [{ Name: containerName, Image: taskBinding.image, ImageID: manifestDigest }] } : {
      RoleArn: roleArn, AccessKeyId: "ASIA" + "A".repeat(16), SecretAccessKey: "b".repeat(40), Token: "c".repeat(32),
      Expiration: new Date(now() + 60_000).toISOString(),
    },
    openRds: () => ({ db: db(false), readDb: db(true), repositorySql: { query: cloudCredentialCalls },
      async verifyWriter() { calls.push("writer"); }, async close() { calls.push("close"); } }),
    resourceAdapters: {
      management(input) {
        assert.deepEqual(input.scope.fence, fence);
        assert.equal(input.scope.applicationSecretRef, applicationSecret.arn);
        assert.equal(input.identity.roleArn, roleArn);
        calls.push("bind-management");
        return createFirstOpenRdsManagement(input);
      },
      inspector(input) {
        assert.deepEqual(input.scope, { productId, environmentId });
        assert.equal(input.approval.executionId, executionId);
        assert.equal(input.release.id, release.id);
        calls.push("bind-inspector");
        return createFirstOpenRdsInspector(input);
      },
      openInspectorCloud: (credentials, endpoint) => {
      assert.equal(endpoint, pin.inspector.route53Endpoint);
      assert.equal(typeof credentials, "function");
      return { async caller() { calls.push("task-role"); return { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/TechlongSandboxFirstOpenTaskRole/fixture` }; },
        async read(service, action) {
          calls.push(`${service}/${action}`);
          if (action === "describe-stacks") return { Stacks: [{ StackId: cellStackId, StackStatus: "CREATE_COMPLETE", Outputs: [
            ["VpcId", ingress.vpcId], ["HttpsListenerArn", ingress.httpsListenerArn], ["ControlListenerArn", ingress.controlListenerArn], ["ClusterName", clusterArn],
          ].map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] };
          if (action === "get-template") return { TemplateBody: JSON.stringify(cellTemplate) };
          if (action === "describe-load-balancers") return { LoadBalancers: [{ LoadBalancerArn: ingress.albArn, Scheme: "internal", DNSName: ingress.dnsName, VpcId: ingress.vpcId }] };
          if (action === "describe-listeners") return { Listeners: [[ingress.httpsListenerArn, 443], [ingress.controlListenerArn, 8443]].map(([ListenerArn, Port]) => ({
            ListenerArn, Port, Protocol: "HTTPS", LoadBalancerArn: ingress.albArn,
            MutualAuthentication: { Mode: "verify", TrustStoreArn: trustStoreArn, TrustStoreAssociationStatus: "active" },
          })) };
          if (action === "describe-db-instances") return { DBInstances: [{ DBInstanceArn: `arn:aws:rds:${region}:${account}:db:${dbInstanceIdentifier}`,
            DbiResourceId: tenant.dbiResourceId, Engine: "postgres", EngineVersion: "16.14", DBInstanceStatus: "available", PubliclyAccessible: false,
            StorageEncrypted: true, DeletionProtection: true, Endpoint: { Address: host, Port: 5432 }, DBSubnetGroup: { VpcId: ingress.vpcId },
          }] };
          assert.fail("unexpected provider read");
        } };
    }, async readSecret(secretRef) { assert.deepEqual(secretRef, controlPublicKey); calls.push("public-key-version"); return "fixture-public-key"; } },
  };
  const start = (adjusted = pin) => runFirstOpenCommand([executionId], undefined, { ...options,
    env: { ...env, ...pinEnv("TECHLONG_FIRST_OPEN_RESOURCES", adjusted) } });
  return { pin, env, options, calls, start, executionId, claimAttempts: () => claimAttempts };
}

test("existing opening command assembles production ports for the exact local fixture and reaches the single claim boundary", async () => {
  const f = await fixture();
  await assert.rejects(f.start(), /ECS_FIRST_OPEN_CLAIM_UNCONFIRMED/);
  assert.equal(f.claimAttempts(), 1);
  assert.deepEqual(f.calls, ["image", "held-review", "release", "bind-inspector", "bind-management", "binding", "task-role", "cloudformation/describe-stacks",
    "cloudformation/get-template", "elbv2/describe-load-balancers", "elbv2/describe-listeners", "rds/describe-db-instances", "public-key-version", "writer",
    "held-review", "release", "claim-attempt", "close"]);
});

test("existing opening command refuses absent or drifted binding before writer, claim or provider reads", async () => {
  const missing = await fixture();
  await assert.rejects(runFirstOpenCommand([missing.executionId], undefined, { ...missing.options, env: {} }), /ECS_FIRST_OPEN_RUNTIME_UNAVAILABLE/);
  assert.deepEqual(missing.calls, ["image"]);
  for (const change of [
    pin => { pin.version = "techlong/ecs-first-open-resources/v1"; },
    pin => { pin.taskDefinitionArn = taskDefinitionArn; },
    pin => { pin.selection.executionId = missing.executionId; },
  ]) {
    const f = await fixture();
    const pin = structuredClone(f.pin);
    change(pin);
    await assert.rejects(f.start(pin), /ECS_FIRST_OPEN_RESOURCE_BINDING/);
    assert.equal(f.claimAttempts(), 0);
    assert.deepEqual(f.calls, ["image"]);
  }
  for (const change of [pin => { pin.selection.workspaceId = "other"; },
    pin => { pin.inspector.sampling.secrets[0].versionId = "0".repeat(32); }, pin => { pin.inspector.tenant.databaseOid = "16000"; }]) {
    const f = await fixture();
    const pin = structuredClone(f.pin);
    change(pin);
    await assert.rejects(f.start(pin), /ECS_FIRST_OPEN_RESOURCE_BINDING/);
    assert.equal(f.claimAttempts(), 0);
    assert.deepEqual(f.calls, ["image", "close"]);
  }
});

test("the version-pinned public signing key must match the private signer's reviewed digest before claim", async () => {
  const f = await fixture();
  f.pin.control.credentials.signingPublicKeySha256 = hex("0");
  await assert.rejects(f.start(), /ECS_FIRST_OPEN_RESOURCE_CONTROL_KEY_CHANGED/);
  assert.equal(f.claimAttempts(), 0);
  assert.ok(f.calls.includes("public-key-version"));
  assert.ok(!f.calls.includes("writer"));
  assert.equal(f.calls.at(-1), "close");
});
