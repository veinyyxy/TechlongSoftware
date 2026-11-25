import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DescribeTaskDefinitionCommand, ECSClient, ECSServiceException, RunTaskCommand, type ContainerDefinition,
  type RunTaskCommandInput, type TaskDefinition,
} from "@aws-sdk/client-ecs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createRdsPostgresDatabase, readRdsControlDatabaseTarget, rdsControlPoolOptions } from "../../db/postgres-rds.ts";
import { dispatchEcsFirstOpen, isFirstOpenDispatchSelection,
  type FirstOpenDispatchSelection, type FirstOpenDispatchStore } from "../../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { createFirstOpenDispatchStore } from "../../lib/deployments/execution/ecs-first-open-dispatch-store.ts";
import { isFirstOpenExecutionId } from "../../lib/deployments/execution/ecs-first-open.ts";
import { createPool } from "./control-database.mjs";
import { FIRST_OPEN_RESOURCE_BINDING_ENV, FIRST_OPEN_RESOURCE_BINDING_SHA_ENV,
  readFirstOpenRdsResourceBinding } from "./first-open-resources-binding.ts";

const account = "402010193138";
const region = "ca-central-1";
const ecsArn = `arn:aws:ecs:${region}:${account}`;
const iamArn = `arn:aws:iam::${account}:role`;
const functionName = "techlong-sandbox-first-open-launcher-v1";
const containerName = "first-open";
export const firstOpenLauncherScope = Object.freeze({
  functionName,
  invocationArn: `arn:aws:lambda:${region}:${account}:function:${functionName}:first-open`,
  clusterArn: `${ecsArn}:cluster/techlong-sandbox-platform`,
  taskFamily: "techlong-sandbox-first-open-v1",
  executionRoleArn: `${iamArn}/TechlongSandboxFirstOpenTaskExecutionRole`,
  taskRoleArn: `${iamArn}/TechlongSandboxFirstOpenTaskRole`,
  launcherRoleArn: `${iamArn}/TechlongSandboxFirstOpenLauncherRole`,
  logGroup: "/ecs/techlong-sandbox/platform-first-open",
  databaseUser: "techlong_saas_first_open_launcher",
  cpu: "512",
  memory: "1024",
});

const definition = new RegExp(`^${ecsArn}:task-definition/${firstOpenLauncherScope.taskFamily}:([1-9][0-9]{0,8})$`);
const platformImage = /^402010193138\.dkr\.ecr\.ca-central-1\.amazonaws\.com\/techlong-sandbox-platform-web@sha256:[0-9a-f]{64}$/;
const subnet = /^subnet-(?:[a-f0-9]{8}|[a-f0-9]{17})$/;
const securityGroup = /^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$/;
const dbHost = /^[a-z][a-z0-9-]{0,62}\.[a-z0-9]{6,63}\.ca-central-1\.rds\.amazonaws\.com$/;
const dbName = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const secretArn = /^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/platform\/first-open-launcher-control-[A-Za-z0-9]{6}$/;
const secretVersion = /^[A-Za-z0-9-]{32,64}$/;

type Env = Readonly<Record<string, string | undefined>>;
type Invocation = { invokedFunctionArn: string; functionVersion: string; getRemainingTimeInMillis(): number };
type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };
type LauncherPorts = {
  readDefinition(arn: string, signal: AbortSignal): Promise<TaskDefinition | undefined>;
  runTask(request: RunTaskCommandInput, signal: AbortSignal): Promise<unknown>;
};
type LaunchBinding = Readonly<{
  taskDefinitionArn: string;
  platformImage: string;
  resourceBindingSha256: string;
  selection: FirstOpenDispatchSelection;
  subnetIds: readonly string[];
  securityGroupId: string;
  controlDatabaseHost: string;
  controlDatabaseName: string;
  controlSecretArn: string;
  controlSecretVersion: string;
}>;

const bindingKeys = [
  "controlDatabaseHost", "controlDatabaseName", "controlSecretArn", "controlSecretVersion",
  "platformImage", "resourceBindingSha256", "securityGroupId", "selection", "subnetIds", "taskDefinitionArn",
];

function stop(code: string): never { throw Error(code); }

function object(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;
}

function matches(input: unknown, pattern: RegExp): input is string {
  return typeof input === "string" && input.trim() === input && pattern.test(input);
}

export function parseFirstOpenLauncherBinding(raw: string | undefined, sha256: string | undefined): LaunchBinding {
  if (!raw || Buffer.byteLength(raw) > 3_000 || !matches(sha256, /^[0-9a-f]{64}$/) ||
      createHash("sha256").update(raw).digest("hex") !== sha256) return stop("FIRST_OPEN_LAUNCH_BINDING");
  let value;
  try { value = object(JSON.parse(raw)); } catch { return stop("FIRST_OPEN_LAUNCH_BINDING"); }
  if (!value || Object.keys(value).sort().join(",") !== bindingKeys.join(",") ||
      !matches(value.taskDefinitionArn, definition) || !matches(value.platformImage, platformImage) ||
      !matches(value.resourceBindingSha256, /^[0-9a-f]{64}$/) || !isFirstOpenDispatchSelection(value.selection) ||
      !Array.isArray(value.subnetIds) || value.subnetIds.length === 0 || value.subnetIds.length > 16 ||
      !value.subnetIds.every(id => matches(id, subnet)) || new Set(value.subnetIds).size !== value.subnetIds.length ||
      !matches(value.securityGroupId, securityGroup) || !matches(value.controlDatabaseHost, dbHost) ||
      !matches(value.controlDatabaseName, dbName) || !matches(value.controlSecretArn, secretArn) ||
      !matches(value.controlSecretVersion, secretVersion)) return stop("FIRST_OPEN_LAUNCH_BINDING");
  return Object.freeze({
    taskDefinitionArn: value.taskDefinitionArn, platformImage: value.platformImage,
    resourceBindingSha256: value.resourceBindingSha256, selection: Object.freeze({ ...value.selection }),
    subnetIds: Object.freeze([...value.subnetIds]), securityGroupId: value.securityGroupId,
    controlDatabaseHost: value.controlDatabaseHost, controlDatabaseName: value.controlDatabaseName,
    controlSecretArn: value.controlSecretArn, controlSecretVersion: value.controlSecretVersion,
  });
}

function executionInput(event: unknown) {
  const request = object(event);
  if (!request || Object.keys(request).length !== 1 || !Object.hasOwn(request, "executionId") ||
      typeof request.executionId !== "string" || request.executionId.length !== 37 ||
      !isFirstOpenExecutionId(request.executionId)) return stop("FIRST_OPEN_LAUNCH_INPUT");
  return request.executionId;
}

function invocationCredentials(env: Env, context: Invocation): Credentials {
  const { AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey, AWS_SESSION_TOKEN: sessionToken } = env;
  if (env.TECHLONG_FIRST_OPEN_LAUNCHER_ENABLED !== "true" ||
      env.AWS_EXECUTION_ENV !== "AWS_Lambda_nodejs22.x" || env.AWS_LAMBDA_FUNCTION_NAME !== functionName ||
      env.AWS_REGION !== region || (env.AWS_DEFAULT_REGION && env.AWS_DEFAULT_REGION !== region) ||
      context?.invokedFunctionArn !== firstOpenLauncherScope.invocationArn ||
      !matches(context.functionVersion, /^[1-9][0-9]*$/) || context.functionVersion !== env.AWS_LAMBDA_FUNCTION_VERSION ||
      !matches(accessKeyId, /^ASIA[A-Z0-9]{16}$/) || !matches(secretAccessKey, /^[A-Za-z0-9/+=]{40}$/) ||
      !matches(sessionToken, /^[\x21-\x7e]{20,16384}$/) || env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
      Object.entries(env).some(([key, value]) => value && /^(?:AWS_(?:ENDPOINT_URL|PROFILE|DEFAULT_PROFILE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_|CA_BUNDLE)|HTTPS?_PROXY|ALL_PROXY|NODE_USE_ENV_PROXY|NODE_EXTRA_CA_CERTS|PG|GITHUB_|ACTIONS_)/i.test(key))) {
    return stop("FIRST_OPEN_LAUNCH_INVOCATION");
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

function matchesPinnedResources(container: ContainerDefinition, binding: LaunchBinding): boolean {
  const json = container.environment?.filter(item => item.name === FIRST_OPEN_RESOURCE_BINDING_ENV);
  const digest = container.environment?.filter(item => item.name === FIRST_OPEN_RESOURCE_BINDING_SHA_ENV);
  if (json?.length !== 1 || typeof json[0].value !== "string" || digest?.length !== 1 ||
    digest[0].value !== binding.resourceBindingSha256 || container.secrets?.some(item =>
      item.name === FIRST_OPEN_RESOURCE_BINDING_ENV || item.name === FIRST_OPEN_RESOURCE_BINDING_SHA_ENV)) return false;
  try {
    const resources = readFirstOpenRdsResourceBinding({
      [FIRST_OPEN_RESOURCE_BINDING_ENV]: json[0].value, [FIRST_OPEN_RESOURCE_BINDING_SHA_ENV]: digest[0].value,
    });
    return resources !== undefined && Object.entries(binding.selection).every(([field, expected]) =>
      resources.selection[field as keyof FirstOpenDispatchSelection] === expected);
  } catch {
    return false;
  }
}

function matchesTaskDefinition(task: TaskDefinition | undefined, binding: LaunchBinding) {
  const revision = Number(definition.exec(binding.taskDefinitionArn)?.[1]);
  const [container] = task?.containerDefinitions ?? [];
  return task?.taskDefinitionArn === binding.taskDefinitionArn && task.status === "ACTIVE" &&
    task.family === firstOpenLauncherScope.taskFamily && task.revision === revision &&
    task.requiresCompatibilities?.length === 1 && task.requiresCompatibilities[0] === "FARGATE" &&
    task.networkMode === "awsvpc" && task.cpu === firstOpenLauncherScope.cpu && task.memory === firstOpenLauncherScope.memory &&
    task.runtimePlatform?.cpuArchitecture === "X86_64" && task.runtimePlatform.operatingSystemFamily === "LINUX" &&
    task.executionRoleArn === firstOpenLauncherScope.executionRoleArn && task.taskRoleArn === firstOpenLauncherScope.taskRoleArn &&
    !task.volumes?.length && task.containerDefinitions?.length === 1 && container?.name === containerName &&
    container.image === binding.platformImage && container.essential === true && !container.command?.length &&
    !container.entryPoint?.length && !container.environmentFiles?.length && !container.mountPoints?.length &&
    !container.portMappings?.length && !container.privileged && !container.interactive && !container.pseudoTerminal &&
    container.logConfiguration?.logDriver === "awslogs" &&
    container.logConfiguration.options?.["awslogs-group"] === firstOpenLauncherScope.logGroup &&
    container.logConfiguration.options?.["awslogs-region"] === region &&
    container.logConfiguration.options?.["awslogs-stream-prefix"] === containerName && matchesPinnedResources(container, binding);
}

/** Reserve through the existing SaaS record before the only possible ECS write. */
export function dispatchFromFirstOpenLauncher(executionId: string, binding: LaunchBinding, store: FirstOpenDispatchStore,
  ports: LauncherPorts, signal: AbortSignal) {
  return dispatchEcsFirstOpen(executionId, {
    clusterArn: firstOpenLauncherScope.clusterArn, taskDefinitionArn: binding.taskDefinitionArn,
    containerName, subnetIds: binding.subnetIds, securityGroupIds: [binding.securityGroupId], selection: binding.selection,
  }, {
    store,
    ecs: {
      async runTask(request) {
        try {
          signal.throwIfAborted();
          const task = await ports.readDefinition(binding.taskDefinitionArn, signal);
          if (!matchesTaskDefinition(task, binding)) return { failures: [{ reason: "TASK_DEFINITION_SCOPE" }] };
          signal.throwIfAborted();
        } catch {
          // A failed preflight cannot have delivered RunTask.
          return { failures: [{ reason: "TASK_DEFINITION_UNAVAILABLE" }] };
        }
        return ports.runTask({ ...request, enableExecuteCommand: false, platformVersion: "1.4.0" }, signal);
      },
    },
  });
}

type SdkClient<T> = { send(command: T, options: { abortSignal: AbortSignal }): Promise<unknown> };
type EcsCommand = DescribeTaskDefinitionCommand | RunTaskCommand;
type SdkConfiguration = {
  region: string; endpoint: string; credentials: Credentials; maxAttempts: number;
  ignoreConfiguredEndpointUrls: boolean; useFipsEndpoint: false; useDualstackEndpoint: false;
};

function awsConfig(service: "ecs" | "secretsmanager", credentials: Credentials): SdkConfiguration {
  return { region, endpoint: `https://${service}.${region}.amazonaws.com`, credentials,
    maxAttempts: 1, ignoreConfiguredEndpointUrls: true, useFipsEndpoint: false, useDualstackEndpoint: false };
}

function readControlSecret(response: unknown, binding: LaunchBinding) {
  const read = object(response);
  if (read?.ARN !== binding.controlSecretArn || read.VersionId !== binding.controlSecretVersion ||
      typeof read.SecretString !== "string" || Buffer.byteLength(read.SecretString) > 8_192) {
    return stop("FIRST_OPEN_LAUNCH_CONTROL_SECRET_SCOPE");
  }
  let secret;
  try { secret = object(JSON.parse(read.SecretString)); } catch { return stop("FIRST_OPEN_LAUNCH_CONTROL_SECRET_SCOPE"); }
  if (!secret || Object.keys(secret).length !== 1 || typeof secret.database_url !== "string") {
    return stop("FIRST_OPEN_LAUNCH_CONTROL_SECRET_SCOPE");
  }
  const target = readRdsControlDatabaseTarget({
    AWS_REGION: region, TECHLONG_SAAS_CONTROL_RDS_URL: secret.database_url,
    TECHLONG_SAAS_CONTROL_RDS_HOST: binding.controlDatabaseHost,
    TECHLONG_SAAS_CONTROL_RDS_DATABASE: binding.controlDatabaseName,
  });
  if (target.user !== firstOpenLauncherScope.databaseUser) return stop("FIRST_OPEN_LAUNCH_CONTROL_SECRET_SCOPE");
  return target;
}

type Pool = Parameters<typeof createRdsPostgresDatabase>[0] & { end(): Promise<void> };

/** Lambda's alias and IAM boundary accept only this execution-ID entry. */
export function createFirstOpenLaunchHandler({
  env = process.env as Env,
  newEcs = (config: SdkConfiguration): SdkClient<EcsCommand> => new ECSClient(config),
  newSecrets = (config: SdkConfiguration): SdkClient<GetSecretValueCommand> => new SecretsManagerClient(config),
  readCa = () => readFileSync("/var/task/certs/amazon-rds.pem", "utf8"),
  openPool = (options: ReturnType<typeof rdsControlPoolOptions>): Pool => createPool({ ...options, max: 1, statement_timeout: 5_000 }),
} = {}) {
  return async (event: unknown, context: Invocation) => {
    const executionId = executionInput(event);
    const credentials = invocationCredentials(env, context);
    const binding = parseFirstOpenLauncherBinding(env.TECHLONG_FIRST_OPEN_LAUNCH_BINDING, env.TECHLONG_FIRST_OPEN_LAUNCH_BINDING_SHA256);
    const budget = context.getRemainingTimeInMillis();
    if (!Number.isSafeInteger(budget) || budget < 15_000) return stop("FIRST_OPEN_LAUNCH_WINDOW");
    const signal = AbortSignal.timeout(Math.min(30_000, budget - 9_000));
    try {
      const ca = readCa();
      const secrets = newSecrets(awsConfig("secretsmanager", credentials));
      const target = readControlSecret(await secrets.send(new GetSecretValueCommand({
        SecretId: binding.controlSecretArn, VersionId: binding.controlSecretVersion,
      }), { abortSignal: signal }), binding);
      signal.throwIfAborted();
      const ecs = newEcs(awsConfig("ecs", credentials));
      const pool = openPool(rdsControlPoolOptions(target, ca));
      try {
        return await dispatchFromFirstOpenLauncher(executionId, binding, createFirstOpenDispatchStore(createRdsPostgresDatabase(pool)), {
          async readDefinition(arn, abortSignal) {
            return (await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: arn }), { abortSignal }) as {
              taskDefinition?: TaskDefinition;
            }).taskDefinition;
          },
          async runTask(request, abortSignal) {
            try { return await ecs.send(new RunTaskCommand(request), { abortSignal }); }
            catch (error) {
              if (error instanceof ECSServiceException && error.name === "AccessDeniedException" &&
                  error.$metadata.httpStatusCode === 403) return { failures: [{ reason: "AccessDenied" }] };
              throw error;
            }
          },
        }, signal);
      } finally {
        await pool.end().catch(() => console.error("FIRST_OPEN_LAUNCH_CONTROL_CLOSE_UNCONFIRMED"));
      }
    } catch {
      return stop("FIRST_OPEN_LAUNCH_UNAVAILABLE");
    }
  };
}

export const handler = createFirstOpenLaunchHandler();
