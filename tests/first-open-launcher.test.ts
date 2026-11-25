import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import { test } from "node:test";
import { DescribeTaskDefinitionCommand, ECSServiceException, RunTaskCommand, type TaskDefinition } from "@aws-sdk/client-ecs";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  createFirstOpenLaunchHandler, firstOpenLauncherScope as scope, parseFirstOpenLauncherBinding,
} from "../ops/platform-hosting-v1/first-open-launcher.ts";
import { FIRST_OPEN_RESOURCE_BINDING_ENV, FIRST_OPEN_RESOURCE_BINDING_SHA_ENV } from "../ops/platform-hosting-v1/first-open-resources-binding.ts";

const executionId = "exec_" + "a".repeat(32);
const taskArn = scope.clusterArn.replace(":cluster/", ":task/") + "/" + "b".repeat(32);
const selection = { jobId: "job_" + "e".repeat(24), instanceId: "app_launcher_fixture", workspaceId: "wsp_launcher_fixture",
  releaseId: "release_" + "f".repeat(32), reviewSha256: "1".repeat(64), hostname: "launcher-fixture.sandbox.techlong.cloud" };
// The launcher's task definition supplies the v2 document. Its deeper resource
// validation occurs independently in the configured task before claim.
const resources = { version: "techlong/ecs-first-open-resources/v2", selection,
  settings: {}, scope: {}, management: { target: {}, fence: {} }, inspector: { tenant: {}, sampling: {}, ingress: {}, readSecret: {} },
  ownershipTableArn: "fixture-authority-table", cell: { cleanup: {}, privateSubnetIds: ["subnet-aaaaaaaa", "subnet-bbbbbbbb"] },
  control: { credentials: {} }, applicationSecret: {}, controlPublicKey: {} };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const resourcePayload = JSON.stringify(resources);
const binding = {
  taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-first-open-v1:12",
  platformImage: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:" + "c".repeat(64),
  resourceBindingSha256: digest(resourcePayload),
  selection,
  subnetIds: ["subnet-0123456789abcdef0"],
  securityGroupId: "sg-0123456789abcdef0",
  controlDatabaseHost: "platform-control.sample01.ca-central-1.rds.amazonaws.com",
  controlDatabaseName: "techlong_control",
  controlSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform/first-open-launcher-control-Ab1cd2",
  controlSecretVersion: "d".repeat(32),
};
const url = `postgresql://${scope.databaseUser}:dummy-only@${binding.controlDatabaseHost}/${binding.controlDatabaseName}?sslmode=verify-full`;
const context = { invokedFunctionArn: scope.invocationArn, functionVersion: "12", getRemainingTimeInMillis: () => 45_000 };

function manifest(input: Record<string, unknown> = binding) {
  const raw = JSON.stringify(input);
  return { raw, hash: digest(raw) };
}

const { raw, hash } = manifest();
const env = {
  TECHLONG_FIRST_OPEN_LAUNCH_BINDING: raw, TECHLONG_FIRST_OPEN_LAUNCH_BINDING_SHA256: hash,
  TECHLONG_FIRST_OPEN_LAUNCHER_ENABLED: "true",
  AWS_EXECUTION_ENV: "AWS_Lambda_nodejs22.x",
  AWS_LAMBDA_FUNCTION_NAME: scope.functionName, AWS_LAMBDA_FUNCTION_VERSION: context.functionVersion,
  AWS_REGION: "ca-central-1",
  AWS_ACCESS_KEY_ID: "ASIA" + "A".repeat(16), AWS_SECRET_ACCESS_KEY: "x".repeat(40), AWS_SESSION_TOKEN: "fixture-token-only-not-active",
};
const resourcesEnvironment = [
  { name: FIRST_OPEN_RESOURCE_BINDING_ENV, value: resourcePayload },
  { name: FIRST_OPEN_RESOURCE_BINDING_SHA_ENV, value: binding.resourceBindingSha256 },
];
const taskDefinition: TaskDefinition = {
  taskDefinitionArn: binding.taskDefinitionArn, family: scope.taskFamily, revision: 12,
  networkMode: "awsvpc", status: "ACTIVE", cpu: scope.cpu, memory: scope.memory,
  requiresCompatibilities: ["FARGATE"], runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
  taskRoleArn: scope.taskRoleArn, executionRoleArn: scope.executionRoleArn,
  containerDefinitions: [{
    name: "first-open", image: binding.platformImage, essential: true,
    environment: resourcesEnvironment,
    logConfiguration: { logDriver: "awslogs", options: {
      "awslogs-group": scope.logGroup, "awslogs-region": env.AWS_REGION, "awslogs-stream-prefix": "first-open",
    } },
  }],
};

type FixtureOptions = {
  envOverride?: Record<string, string | undefined>;
  observedDefinition?: TaskDefinition;
  denied?: boolean;
  lostAck?: boolean;
  acknowledgementDefinition?: string;
  refusedReservation?: boolean;
  durableSelection?: typeof selection;
  secretVersionOverride?: string;
  secretUrl?: string;
};

function fixture(options: FixtureOptions = {}) {
  const trace: string[] = [];
  let reserved = false;
  let state = { status: "waiting", taskArn: null as string | null };
  let command: RunTaskCommand | undefined;
  const readResult = (rows: Record<string, unknown>[]) => ({ rows, fields: [], rowCount: rows.length, command: "SELECT" });
  const handler = createFirstOpenLaunchHandler({
    env: { ...env, ...options.envOverride },
    newEcs(config) {
      assert.equal(config.endpoint, "https://ecs.ca-central-1.amazonaws.com");
      assert.equal(config.region, "ca-central-1");
      assert.equal(config.maxAttempts, 1);
      assert.equal(config.ignoreConfiguredEndpointUrls, true);
      assert.equal(config.credentials.sessionToken, env.AWS_SESSION_TOKEN);
      return { async send(request, { abortSignal }) {
        assert.equal(abortSignal.aborted, false);
        if (request instanceof DescribeTaskDefinitionCommand) {
          trace.push("describe");
          assert.deepEqual(request.input, { taskDefinition: binding.taskDefinitionArn });
          return { taskDefinition: options.observedDefinition ?? taskDefinition };
        }
        assert.ok(request instanceof RunTaskCommand);
        trace.push("run");
        command = request;
        if (options.denied) throw new ECSServiceException({
          name: "AccessDeniedException", $fault: "client", $metadata: { httpStatusCode: 403 }, message: "fixture-only",
        });
        if (options.lostAck) throw Error("fixture read timed out after send");
        return { tasks: [{ taskArn, clusterArn: scope.clusterArn,
          taskDefinitionArn: options.acknowledgementDefinition ?? binding.taskDefinitionArn }] };
      } };
    },
    newSecrets(config) {
      assert.equal(config.endpoint, "https://secretsmanager.ca-central-1.amazonaws.com");
      assert.equal(config.maxAttempts, 1);
      return { async send(request) {
        trace.push("secret");
        assert.ok(request instanceof GetSecretValueCommand);
        assert.deepEqual(request.input, { SecretId: binding.controlSecretArn, VersionId: binding.controlSecretVersion });
        return { ARN: binding.controlSecretArn, VersionId: options.secretVersionOverride ?? binding.controlSecretVersion,
          SecretString: JSON.stringify({ database_url: options.secretUrl ?? url }) };
      } };
    },
    readCa: () => rootCertificates[0],
    openPool(config) {
      trace.push("pool");
      assert.equal(config.host, binding.controlDatabaseHost);
      assert.equal(config.user, scope.databaseUser);
      assert.deepEqual({ required: config.ssl.rejectUnauthorized, sni: config.ssl.servername },
        { required: true, sni: binding.controlDatabaseHost });
      return {
        async query(sql, args) {
          assert.equal(args?.[0], executionId);
          if (sql.includes("WITH eligible")) {
            trace.push("reserve");
            assert.match(sql, /actor.status = 'active' AND actor.is_platform_admin = 1/);
            assert.match(sql, /timed\.at >= timed\.approved_at AND timed\.at < timed\.approved_at \+ 3600000/);
            assert.match(sql, /execution.job_id <> \$2/);
            assert.match(sql, /job.id = \$3 AND instance.id = \$4 AND instance.workspace_id = \$5/);
            const coordinates = Object.values(selection);
            assert.deepEqual(args?.slice(2), coordinates);
            const actual = options.durableSelection ?? selection;
            if (reserved || options.refusedReservation || JSON.stringify(Object.values(actual)) !== JSON.stringify(coordinates)) return readResult([]);
            reserved = true;
            return readResult([{ execution_id: executionId }]);
          }
          if (sql.includes("WITH observed")) {
            trace.push("finish");
            state = { status: String(args?.[1]), taskArn: args?.[2] == null ? null : String(args[2]) };
            assert.equal(args?.[3], state.status === "acknowledged" ? binding.taskDefinitionArn : null);
            return readResult([{ execution_id: executionId }]);
          }
          trace.push("read");
          return readResult([state]);
        },
        async connect() { throw Error("Unexpected batch"); },
        async end() { trace.push("close"); },
      };
    },
  });
  return { handler, trace, command: () => command };
}

test("T4.2 launcher rejects foreign input and runtime before touching credentials or data", async () => {
  const f = fixture();
  for (const event of [null, executionId, { executionId: "/relative" }, { executionId: executionId + "\n" },
    { executionId, overrides: ["other"] }, { ExecutionId: executionId }]) {
    await assert.rejects(f.handler(event, context), /FIRST_OPEN_LAUNCH_INPUT/);
  }
  for (const runtime of [{ ...context, invokedFunctionArn: scope.invocationArn.replace(/:first-open$/, "") },
    { ...context, functionVersion: "$LATEST" }, { ...context, getRemainingTimeInMillis: () => 1_000 }]) {
    await assert.rejects(f.handler({ executionId }, runtime), /FIRST_OPEN_LAUNCH_(INVOCATION|WINDOW)/);
  }
  for (const envOverride of [{ TECHLONG_FIRST_OPEN_LAUNCHER_ENABLED: "false" }, { AWS_ENDPOINT_URL_ECS: "https://example.invalid" },
    { AWS_ROLE_ARN: scope.taskRoleArn }, { PGOPTIONS: "-c search_path=public" }]) {
    const disabled = fixture({ envOverride });
    await assert.rejects(disabled.handler({ executionId }, context), /FIRST_OPEN_LAUNCH_INVOCATION/);
    assert.deepEqual(disabled.trace, []);
  }
  assert.deepEqual(f.trace, []);
});

test("T4.2 launcher pins one qualified invocation, RDS login, Fargate revision and exact RunTask", async () => {
  const f = fixture();
  assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "acknowledged", taskArn });
  assert.deepEqual(f.trace, ["secret", "pool", "reserve", "describe", "run", "finish", "close"]);
  assert.deepEqual(f.command()?.input, {
    cluster: scope.clusterArn, taskDefinition: binding.taskDefinitionArn, launchType: "FARGATE",
    count: 1, clientToken: executionId, enableExecuteCommand: false, platformVersion: "1.4.0",
    networkConfiguration: { awsvpcConfiguration: {
      assignPublicIp: "DISABLED", subnets: binding.subnetIds, securityGroups: [binding.securityGroupId],
    } },
    overrides: { containerOverrides: [{ name: "first-open", command: ["node", "ops/platform-hosting-v1/first-open.mjs", executionId] }] },
  });
  assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "acknowledged", taskArn });
  assert.equal(f.trace.filter(action => action === "describe").length, 1);
  assert.equal(f.trace.filter(action => action === "run").length, 1);
});

test("T4.2 launcher never retries an ambiguous RunTask and persists a proven provider denial", async () => {
  for (const options of [{ lostAck: true }, { denied: true }, { acknowledgementDefinition: binding.taskDefinitionArn.replace(/:12$/, ":13") }]) {
    const f = fixture(options);
    const result = { executionId, status: options.denied ? "failed" : "unknown", taskArn: null };
    assert.deepEqual(await f.handler({ executionId }, context), result);
    assert.deepEqual(await f.handler({ executionId }, context), result);
    assert.equal(f.trace.filter(action => action === "run").length, 1);
  }
  const noApproval = fixture({ refusedReservation: true });
  assert.deepEqual(await noApproval.handler({ executionId }, context), { executionId, status: "waiting", taskArn: null });
  assert.ok(!noApproval.trace.includes("describe") && !noApproval.trace.includes("run"));
});

test("T4.2 launcher refuses a paid approval for a different stable selection before the ECS calls", async () => {
  for (const drifted of [{ jobId: "job_" + "3".repeat(24) }, { instanceId: "app_unreviewed" }, { workspaceId: "wsp_unreviewed" },
    { releaseId: "release_" + "4".repeat(32) }, { reviewSha256: "5".repeat(64) }, { hostname: "unreviewed.sandbox.techlong.cloud" }]) {
    const f = fixture({ durableSelection: { ...selection, ...drifted } });
    assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "waiting", taskArn: null });
    assert.deepEqual(f.trace, ["secret", "pool", "reserve", "read", "close"]);
  }
});

test("T4.2 launcher checks the ECS definition's unique v2 resource manifest and exact reviewed selection", async () => {
  const container = taskDefinition.containerDefinitions![0];
  const wrongDigest = "2".repeat(64);
  const resourceWith = (change: Record<string, unknown>) => manifest({ ...resources, ...change });
  const wrongScope = resourceWith({ selection: { ...selection, instanceId: "app_foreign" } });
  const oldLayout = resourceWith({ version: "techlong/ecs-first-open-resources/v1", taskDefinitionArn: binding.taskDefinitionArn });
  const selfRef = resourceWith({ taskDefinitionArn: binding.taskDefinitionArn });
  const futureExecution = resourceWith({ selection: { ...selection, executionId } });
  const variants = [
    { environment: [] },
    { environment: resourcesEnvironment.slice(0, 1) },
    { environment: [resourcesEnvironment[1]] },
    { environment: [...resourcesEnvironment, resourcesEnvironment[0]] },
    { environment: [...resourcesEnvironment, resourcesEnvironment[1]] },
    { environment: [resourcesEnvironment[0], { ...resourcesEnvironment[1], value: wrongDigest }] },
    { environment: [{ ...resourcesEnvironment[0], value: resourcePayload + " " }, resourcesEnvironment[1]] },
    { secrets: [{ name: FIRST_OPEN_RESOURCE_BINDING_ENV, valueFrom: "fixture-secret" }] },
    { secrets: [{ name: FIRST_OPEN_RESOURCE_BINDING_SHA_ENV, valueFrom: "fixture-secret" }] },
  ];
  for (const changed of variants) {
    const f = fixture({ observedDefinition: { ...taskDefinition, containerDefinitions: [{ ...container, ...changed }] } });
    assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "failed", taskArn: null });
    assert.ok(f.trace.includes("describe") && !f.trace.includes("run"));
  }
  for (const reviewed of [wrongScope, oldLayout, selfRef, futureExecution]) {
    const { raw, hash } = manifest({ ...binding, resourceBindingSha256: reviewed.hash });
    const f = fixture({ envOverride: { TECHLONG_FIRST_OPEN_LAUNCH_BINDING: raw, TECHLONG_FIRST_OPEN_LAUNCH_BINDING_SHA256: hash },
      observedDefinition: { ...taskDefinition, containerDefinitions: [{ ...container, environment: [
        { name: FIRST_OPEN_RESOURCE_BINDING_ENV, value: reviewed.raw }, { name: FIRST_OPEN_RESOURCE_BINDING_SHA_ENV, value: reviewed.hash },
      ] }] } });
    assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "failed", taskArn: null });
    assert.ok(f.trace.includes("describe") && !f.trace.includes("run"));
  }
});

test("T4.2 launcher rejects changed manifests, database secrets and task definition revisions", async () => {
  assert.throws(() => parseFirstOpenLauncherBinding(raw + " ", hash), /FIRST_OPEN_LAUNCH_BINDING/);
  for (const input of [{ taskDefinitionArn: binding.taskDefinitionArn.split(":12")[0] },
    { platformImage: binding.platformImage.split("@")[0] + ":latest" }, { subnetIds: ["subnet-zz"] },
    { controlSecretArn: binding.controlSecretArn.replace(":402010193138:", ":123456789012:") }, { resourceBindingSha256: "bad" },
    { selection: undefined }, { selection: { ...selection, executionId } }, { selection: { ...selection, hostname: "outside.invalid" } },
    { publicIp: "ENABLED" }]) {
    const changed = manifest({ ...binding, ...input });
    assert.throws(() => parseFirstOpenLauncherBinding(changed.raw, changed.hash), /FIRST_OPEN_LAUNCH_BINDING/);
  }
  for (const change of [{ taskRoleArn: scope.executionRoleArn }, { revision: 13 }, { executionRoleArn: scope.taskRoleArn },
    { containerDefinitions: [{ ...taskDefinition.containerDefinitions![0], entryPoint: ["ssh"] }] },
    { containerDefinitions: [{ ...taskDefinition.containerDefinitions![0], image: "unreviewed:latest" }] }]) {
    const f = fixture({ observedDefinition: { ...taskDefinition, ...change } });
    assert.deepEqual(await f.handler({ executionId }, context), { executionId, status: "failed", taskArn: null });
    assert.ok(f.trace.includes("describe") && !f.trace.includes("run"));
  }
  for (const secret of [{ secretVersionOverride: "e".repeat(32) },
    { secretUrl: url.replace(scope.databaseUser, "unexpected_login") }, { secretUrl: url.replace("verify-full", "disable") }]) {
    const f = fixture(secret);
    await assert.rejects(f.handler({ executionId }, context), /FIRST_OPEN_LAUNCH_UNAVAILABLE/);
    assert.deepEqual(f.trace, ["secret"]);
  }
});
