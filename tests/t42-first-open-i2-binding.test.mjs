import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { DescribeTaskDefinitionCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createEcsFirstOpenTaskPorts } from "../lib/deployments/execution/ecs-first-open-runtime.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { buildFirstOnboardingJob, CLAIM_FIRST_ONBOARDING, firstOnboardingClaimBindings,
  loadFirstOnboardingReview } from "../lib/deployments/first-onboarding.ts";
import { createFirstOpenAdminHandlers } from "../lib/deployments/first-open-admin-http.ts";
import { createFirstOpenAdminStore } from "../lib/deployments/first-open-admin-store.ts";
import { createFirstOpenLaunchHandler, firstOpenLauncherScope } from "../ops/platform-hosting-v1/first-open-launcher.ts";
import { FIRST_OPEN_RESOURCE_BINDING_ENV, FIRST_OPEN_RESOURCE_BINDING_SHA_ENV,
  readFirstOpenRdsResourceBinding } from "../ops/platform-hosting-v1/first-open-resources-binding.ts";
import { createFirstOpenWebInvokeBinding } from "../ops/platform-hosting-v1/first-open-web-invoke.ts";

const account = "402010193138", region = "ca-central-1", revision = 19, now = 1_800_000_000_000;
const taskDefinitionArn = `arn:aws:ecs:${region}:${account}:task-definition/${firstOpenLauncherScope.taskFamily}:${revision}`;
const taskArn = firstOpenLauncherScope.clusterArn.replace(":cluster/", ":task/") + "/" + "7".repeat(32);
const registry = `${account}.dkr.ecr.${region}.amazonaws.com/`;
const platformImage = registry + "techlong-sandbox-platform-web@sha256:" + "a".repeat(64);
const actor = { id: "admin_i2_fixture", isPlatformAdmin: true, status: "active" };
const manifestDigest = "sha256:" + "b".repeat(64);
const release = { id: "release_" + "e".repeat(32), productId: "prd_restaurant_order_system", component: "tenant_api", status: "ecr_verified",
  source: { repository: "fixture/tenant", commit: "3".repeat(40) }, image: { repository: registry + "techlong-sandbox-speedfeast",
    manifestDigest, platformDigest: "sha256:" + "d".repeat(64), verificationSha256: "4".repeat(64), runtimePlatform: "linux/amd64" },
  compatibility: { applicationPort: 3000, databaseProfiles: ["full_password"], schemaVersions: ["sample"], clientApiVersions: ["v1"],
    startupWrites: false, requiresMigration: false } };

async function paidFixture(label) {
  const configuration = { label }, desiredPlan = { mode: "aws_sandbox" };
  const scope = { appInstanceId: `app_fixture_${label}`, workspaceId: `ws_fixture_${label}`, tenantKey: `tenant_fixture_${label}`,
    subscriptionId: `sub_fixture_${label}`, environmentId: "env_aws_sandbox_ca_central_1", planId: "plan_fixture",
    templateVersionId: "tplver_fixture", accountId: account, artifactRef: `${release.image.repository}@${manifestDigest}`,
    releaseId: release.id, configurationHash: await sha256Hex(configuration), planHash: await sha256Hex(desiredPlan) };
  const held = await buildFirstOnboardingJob(scope);
  assert.ok(held);
  const row = { ...scope, configuration, desiredPlan, slug: `i2-${label}`, subscriptionEnd: now + 3_600_000, purchaseOrderId: `order_${label}`,
    instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true, scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, jobType: "apply", status: "pending", payload: held.payload, dedupeKey: held.dedupeKey,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const review = await loadFirstOnboardingReview(held.jobId, { databaseProfile: "full_password", readOne: async () => row, readRelease: async () => release });
  assert.ok(review);
  return { row, review, selection: { jobId: held.jobId, instanceId: scope.appInstanceId, workspaceId: scope.workspaceId, releaseId: release.id,
    reviewSha256: review.reviewSha256, hostname: row.slug + ".sandbox.techlong.cloud" } };
}

test("reviewed I2 installation binds a later Web execution to the one attested task definition and one claim", async () => {
  const [wanted, other] = await Promise.all([paidFixture("a"), paidFixture("b")]);
  const instances = new Map([wanted, other].map(f => [f.selection.instanceId, f]));
  const executions = new Map();
  const approvedIds = new Map();
  const calls = [];
  let claims = 0;
  const rawResources = JSON.stringify({ version: "techlong/ecs-first-open-resources/v2", selection: wanted.selection, settings: {}, scope: {},
    management: { target: {}, fence: {} }, inspector: { tenant: {}, ingress: {}, sampling: {}, readSecret: {} },
    ownershipTableArn: "fixture", cell: { cleanup: {}, privateSubnetIds: ["subnet-aaaaaaaa", "subnet-bbbbbbbb"] },
    applicationSecret: {}, controlPublicKey: {}, control: { credentials: {} } });
  const digest = raw => createHash("sha256").update(raw).digest("hex");
  const resourcesEnv = { [FIRST_OPEN_RESOURCE_BINDING_ENV]: rawResources, [FIRST_OPEN_RESOURCE_BINDING_SHA_ENV]: digest(rawResources) };
  const pin = readFirstOpenRdsResourceBinding(resourcesEnv);
  assert.deepEqual(pin.selection, wanted.selection);
  assert.deepEqual(pin.cell.privateSubnetIds, ["subnet-aaaaaaaa", "subnet-bbbbbbbb"]);
  assert.ok(!Object.hasOwn(pin, "taskDefinitionArn") && !Object.hasOwn(pin.selection, "executionId"));
  const launcherBinding = { taskDefinitionArn, platformImage, subnetIds: ["subnet-0123456789abcdef0"], securityGroupId: "sg-0123456789abcdef0",
    controlDatabaseHost: "fixture-control.abcdef.ca-central-1.rds.amazonaws.com", controlDatabaseName: "techlong_control",
    controlSecretArn: `arn:aws:secretsmanager:${region}:${account}:secret:techlong/sandbox/platform/first-open-launcher-control-abc123`,
    controlSecretVersion: "5".repeat(32), selection: wanted.selection, resourceBindingSha256: digest(rawResources) };
  const launchRaw = JSON.stringify(launcherBinding);
  const summary = instanceId => {
    const record = executions.get(approvedIds.get(instanceId));
    return { instanceId, eligible: !record, executionId: record?.executionId ?? null, approvedAt: record?.approvedAt ?? null,
      status: "waiting", step: record?.dispatchToken ? "task_start" : "approval", events: [],
      dispatchToken: record?.dispatchToken ?? null, dispatchStartedAt: record?.startedAt ?? null,
      dispatchOutcome: record?.outcome ?? null, dispatchTaskArn: record?.taskArn ?? null, dispatchTaskDefinitionArn: record?.taskDefinitionArn ?? null };
  };
  const statements = new WeakMap();
  function execute(sql, values) {
    if (sql.includes('purchase.id AS "purchaseOrderId"')) {
      assert.match(sql, /purchase.status = 'paid'/);
      assert.match(sql, /payment.status = 'paid'/);
      const entry = instances.get(values[1]);
      assert.deepEqual(values, [entry.row.job.id, entry.row.appInstanceId, actor.id]);
      return [entry.row];
    }
    if (sql.startsWith("SELECT document")) { assert.deepEqual(values, [release.id]); return [{ document: release }]; }
    if (sql.startsWith('SELECT instance.id AS "instanceId"')) return [summary(values[1])];
    if (sql.startsWith("WITH eligible AS MATERIALIZED")) {
      assert.match(sql, /job\.id = \$3 AND instance\.id = \$4 AND instance\.workspace_id = \$5/);
      assert.match(sql, /execution\.release_id = \$6 AND execution\.review_sha256 = \$7/);
      assert.match(sql, /instance\.slug \|\| '\.sandbox\.techlong\.cloud' = \$8/);
      assert.match(sql, /execution\.dispatch_started_at IS NULL/);
      const stored = executions.get(values[0]);
      calls.push(["reserve", values[0]]);
      const s = stored?.selection;
      if (!s || stored.dispatchToken || [s.jobId, s.instanceId, s.workspaceId, s.releaseId, s.reviewSha256, s.hostname]
        .some((expected, index) => values[index + 2] !== expected)) return [];
      stored.dispatchToken = stored.executionId;
      stored.startedAt = now + 1;
      return [{ execution_id: stored.executionId }];
    }
    if (sql.startsWith("WITH observed AS MATERIALIZED")) {
      assert.match(sql, /dispatch_task_definition_arn = \$4/);
      const record = executions.get(values[0]);
      assert.deepEqual(values, [record.executionId, "acknowledged", taskArn, taskDefinitionArn]);
      assert.ok(record.dispatchToken && !record.outcome);
      [record.outcome, record.taskArn, record.taskDefinitionArn] = values.slice(1);
      calls.push(["ack", record.executionId]);
      return [{ execution_id: record.executionId }];
    }
    if (sql.startsWith("SELECT coalesce(dispatch_outcome")) {
      const record = executions.get(values[0]);
      return record ? [{ status: record.outcome ?? "waiting", taskArn: record.taskArn ?? null }] : [];
    }
    if (sql.startsWith("SELECT opened.id AS")) {
      assert.match(sql, /opened\.dispatch_task_definition_arn = \$3/);
      const record = executions.get(values[0]);
      return record?.outcome === "acknowledged" && record.taskArn === values[1] && record.taskDefinitionArn === values[2]
        ? [{ ...record.selection, executionId: record.executionId, approvedAt: record.approvedAt, approvedBy: actor.id }] : [];
    }
    if (sql.startsWith("WITH approval AS MATERIALIZED")) {
      assert.match(sql, /opened\.dispatch_task_definition_arn = \$24/);
      assert.match(sql, /j.status='pending' AND j.attempts=0/);
      const record = executions.get(values[1]);
      if (record?.outcome !== "acknowledged" || record.claimed || record.taskArn !== values[18] || record.taskDefinitionArn !== values[23]) return [];
      assert.deepEqual([values[0], values[9], ...values.slice(19, 23)], [record.selection.jobId, record.selection.instanceId,
        actor.id, now, record.selection.reviewSha256, record.selection.releaseId]);
      record.claimed = true;
      claims++;
      return [{ jobId: values[0] }];
    }
    return assert.fail("unexpected statement");
  }
  function prepare(sql, values = []) {
    const stmt = { bind: (...args) => prepare(sql, args), async first() { return execute(sql, values)[0] ?? null; } };
    statements.set(stmt, { sql, values });
    return stmt;
  }
  const db = { prepare, async batch([insert, read]) {
    const { sql, values } = statements.get(insert);
    assert.match(sql, /ON CONFLICT \(instance_id\) DO NOTHING/);
    const [, instanceId, actorId, executionId, reviewSha256] = values;
    const entry = instances.get(instanceId);
    assert.equal(actorId, actor.id);
    assert.equal(reviewSha256, entry.selection.reviewSha256);
    assert.match(executionId, /^exec_[a-f0-9]{32}$/);
    assert.ok(!rawResources.includes(executionId) && !launchRaw.includes(executionId));
    executions.set(executionId, { executionId, selection: entry.selection, approvedAt: now });
    approvedIds.set(instanceId, executionId);
    calls.push(["committed", executionId]);
    return [{ results: [], meta: {} }, { results: [await read.first()], meta: {} }];
  } };

  const { functionName, invocationArn, taskFamily, cpu, memory, taskRoleArn, executionRoleArn, logGroup, databaseUser, clusterArn } = firstOpenLauncherScope;
  const session = { RoleArn: `arn:aws:iam::${account}:role/TechlongSandboxPlatformWebFirstOpenInvokeRole`, AccessKeyId: "ASIA" + "A".repeat(16),
    SecretAccessKey: "z".repeat(40), Token: "fixture-session-token-valid-shape", Expiration: new Date(now + 300_000).toISOString() };
  const launch = createFirstOpenLaunchHandler({
    env: { AWS_REGION: region, AWS_EXECUTION_ENV: "AWS_Lambda_nodejs22.x", AWS_LAMBDA_FUNCTION_NAME: functionName, AWS_LAMBDA_FUNCTION_VERSION: "1",
      AWS_ACCESS_KEY_ID: session.AccessKeyId, AWS_SECRET_ACCESS_KEY: session.SecretAccessKey, AWS_SESSION_TOKEN: session.Token,
      TECHLONG_FIRST_OPEN_LAUNCHER_ENABLED: "true", TECHLONG_FIRST_OPEN_LAUNCH_BINDING: launchRaw, TECHLONG_FIRST_OPEN_LAUNCH_BINDING_SHA256: digest(launchRaw) },
    readCa: () => rootCertificates[0],
    newSecrets: () => ({ async send(command) {
      assert.ok(command instanceof GetSecretValueCommand);
      assert.deepEqual(command.input, { SecretId: launcherBinding.controlSecretArn, VersionId: launcherBinding.controlSecretVersion });
      return { ARN: launcherBinding.controlSecretArn, VersionId: launcherBinding.controlSecretVersion, SecretString: JSON.stringify({
        database_url: `postgresql://${databaseUser}:offline@${launcherBinding.controlDatabaseHost}/${launcherBinding.controlDatabaseName}?sslmode=verify-full`,
      }) };
    } }),
    newEcs: () => ({ async send(command) {
      if (command instanceof DescribeTaskDefinitionCommand) {
        calls.push(["describe", command.input.taskDefinition]);
        assert.deepEqual(command.input, { taskDefinition: taskDefinitionArn });
        return { taskDefinition: { taskDefinitionArn, family: taskFamily, revision, status: "ACTIVE", requiresCompatibilities: ["FARGATE"],
          networkMode: "awsvpc", cpu, memory, runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" }, taskRoleArn, executionRoleArn,
          containerDefinitions: [{ name: "first-open", image: platformImage, essential: true,
            environment: Object.entries(resourcesEnv).map(([name, value]) => ({ name, value })),
            logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": logGroup, "awslogs-region": region, "awslogs-stream-prefix": "first-open" } } }] } };
      }
      assert.ok(command instanceof RunTaskCommand);
      const { clientToken, overrides } = command.input;
      assert.equal(clientToken, approvedIds.get(wanted.selection.instanceId));
      assert.equal(command.input.taskDefinition, taskDefinitionArn);
      assert.equal(command.input.networkConfiguration.awsvpcConfiguration.assignPublicIp, "DISABLED");
      assert.deepEqual(overrides, { containerOverrides: [{ name: "first-open", command: ["node", "ops/platform-hosting-v1/first-open.mjs", clientToken] }] });
      calls.push(["run", clientToken]);
      return { tasks: [{ taskArn, taskDefinitionArn, clusterArn }] };
    } }),
    openPool: () => ({ async query(sql, values) { const rows = execute(sql, values); return { rows, fields: [], rowCount: rows.length }; },
      async end() {}, connect() { return assert.fail("launcher fakes use a single statement"); } }),
  });
  const notify = createFirstOpenWebInvokeBinding({ AWS_REGION: region, AWS_EXECUTION_ENV: "AWS_ECS_FARGATE", TECHLONG_FIRST_OPEN_WEB_INVOKE: "true",
    TECHLONG_SAAS_CONTROL_DATABASE_MODE: "rds-postgresql", ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/i2-fixture",
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/i2-fixture" }, { now: () => now, readLocal: async () => session,
    async send(url, request) {
      assert.equal(url, `https://lambda.${region}.amazonaws.com/2015-03-31/functions/${encodeURIComponent(invocationArn)}/invocations`);
      assert.match(new Headers(request.headers).get("authorization"), /\/ca-central-1\/lambda\/aws4_request/);
      const event = JSON.parse(request.body);
      assert.deepEqual(Object.keys(event), ["executionId"]);
      assert.ok(executions.has(event.executionId), "notification follows the durable approval");
      const response = await launch(event, { invokedFunctionArn: invocationArn, functionVersion: "1", getRemainingTimeInMillis: () => 45_000 });
      assert.equal(response.status, event.executionId === approvedIds.get(wanted.selection.instanceId) ? "acknowledged" : "waiting");
      return Response.json(response, { headers: { "x-amz-executed-version": "1" } });
    } })();
  assert.ok(notify);
  const handlers = createFirstOpenAdminHandlers({ authorize: async () => ({ account: { user: actor }, response: null }),
    store: () => createFirstOpenAdminStore(db), approvalOptions: () => ({ databaseProfile: "full_password", afterCommit: notify }) });
  const approve = async instanceId => {
    const response = await handlers.POST(new Request(`https://fixture.invalid/api/admin/instances/${instanceId}/first-open`, {
      method: "POST", headers: { origin: "https://fixture.invalid" },
    }), { params: Promise.resolve({ instanceId }) });
    assert.equal(response.status, 200);
    return (await response.json()).data.id;
  };
  const rejectedId = await approve(other.selection.instanceId), id = await approve(wanted.selection.instanceId);
  assert.notEqual(rejectedId, id);
  assert.equal(await approve(wanted.selection.instanceId), id);
  assert.deepEqual(calls, [["committed", rejectedId], ["reserve", rejectedId], ["committed", id], ["reserve", id],
    ["describe", taskDefinitionArn], ["run", id], ["ack", id]]);
  assert.equal(executions.get(rejectedId).dispatchToken, undefined);
  const settings = { writeBefore: now + 30_000, baselineDigest: "8".repeat(64), databaseSchemaVersion: "sample", dnsTarget: "fixture.internal" };
  const readDb = { prepare() { return assert.fail("this regression ends after the single claim"); } };
  const portsFor = taskDefinitionArn => createEcsFirstOpenTaskPorts({ ...settings, db, readDb, taskArn, taskDefinitionArn,
    management: {}, reader: {} });
  const correct = portsFor(taskDefinitionArn), wrong = portsFor(taskDefinitionArn.replace(/:19$/, ":20"));
  const approval = await correct.readApproval(id);
  assert.equal(approval?.executionId, id);
  assert.equal(await correct.readApproval(rejectedId), null);
  assert.equal(await wrong.readApproval(id), null);
  const bindings = firstOnboardingClaimBindings(wanted.review, wanted.row, id, "lease_" + "c".repeat(32), settings.writeBefore);
  assert.equal(await wrong.claimApproved(approval, CLAIM_FIRST_ONBOARDING, bindings), null);
  assert.deepEqual(await correct.claimApproved(approval, CLAIM_FIRST_ONBOARDING, bindings), { executionId: id, jobId: wanted.selection.jobId });
  assert.equal(await correct.claimApproved(approval, CLAIM_FIRST_ONBOARDING, bindings), null);
  assert.equal(claims, 1);
});
