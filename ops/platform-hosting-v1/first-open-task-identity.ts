import { createHash } from "node:crypto";
import { get } from "node:http";

export const FIRST_OPEN_TASK_ACCOUNT = "402010193138";
export const FIRST_OPEN_TASK_REGION = "ca-central-1";
export const FIRST_OPEN_TASK_CLUSTER = `arn:aws:ecs:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:cluster/techlong-sandbox-platform`;
export const FIRST_OPEN_TASK_FAMILY = "techlong-sandbox-first-open-v1";
export const FIRST_OPEN_TASK_CONTAINER = "first-open";
export const FIRST_OPEN_TASK_ROLE = `arn:aws:iam::${FIRST_OPEN_TASK_ACCOUNT}:role/TechlongSandboxFirstOpenTaskRole`;

const metadataOrigin = "http://169.254.170.2";
const platformRepository = `${FIRST_OPEN_TASK_ACCOUNT}.dkr.ecr.${FIRST_OPEN_TASK_REGION}.amazonaws.com/techlong-sandbox-platform-web`;
const taskPrefix = `arn:aws:ecs:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:task/techlong-sandbox-platform/`;
const roleName = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,62}$/;
const databaseName = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;
const excludedEnv = /^(?:AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_CREDENTIALS_FULL_URI|CONTAINER_AUTHORIZATION_TOKEN(?:_FILE)?|ENDPOINT_URL(?:_.*)?|CA_BUNDLE)|(?:HTTP|HTTPS|ALL)_PROXY|NODE_USE_ENV_PROXY|ACTIONS_.*|(?:GH|GITHUB)_TOKEN)$/i;

type Env = Readonly<Record<string, string | undefined>>;
type Json = Record<string, unknown>;
type ReadLocal = (url: URL, signal: AbortSignal) => Promise<unknown>;

export interface FirstOpenTaskBinding {
  version: "techlong/ecs-first-open-task/v1";
  clusterArn: typeof FIRST_OPEN_TASK_CLUSTER;
  family: typeof FIRST_OPEN_TASK_FAMILY;
  containerName: typeof FIRST_OPEN_TASK_CONTAINER;
  taskRoleArn: typeof FIRST_OPEN_TASK_ROLE;
  image: string;
  controlHost: string;
  controlDatabase: string;
  writeDbRole: string;
  readDbRole: string;
}

const bindingFields = [
  "version", "clusterArn", "family", "containerName", "taskRoleArn", "image", "controlHost", "controlDatabase", "writeDbRole", "readDbRole",
] as const;

function imageDigest(image: unknown): string | null {
  if (typeof image !== "string" || !image.startsWith(platformRepository + "@")) return null;
  const value = image.slice(platformRepository.length + 1);
  return /^sha256:[0-9a-f]{64}$/.test(value) ? value : null;
}

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readFirstOpenTaskBinding(env: Env): Readonly<FirstOpenTaskBinding> {
  const payload = env.TECHLONG_FIRST_OPEN_TASK_BINDING_JSON;
  try {
    if (!payload || Buffer.byteLength(payload) > 4_096 ||
      env.TECHLONG_FIRST_OPEN_TASK_BINDING_SHA256 !== createHash("sha256").update(payload).digest("hex")) throw Error();
    const value: unknown = JSON.parse(payload);
    if (!record(value) || Object.keys(value).length !== bindingFields.length ||
      !bindingFields.every(field => typeof value[field] === "string")) throw Error();
    const binding = value as unknown as FirstOpenTaskBinding;
    if (binding.version !== "techlong/ecs-first-open-task/v1" || binding.clusterArn !== FIRST_OPEN_TASK_CLUSTER ||
      binding.family !== FIRST_OPEN_TASK_FAMILY || binding.containerName !== FIRST_OPEN_TASK_CONTAINER ||
      binding.taskRoleArn !== FIRST_OPEN_TASK_ROLE || !imageDigest(binding.image) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9]+\.ca-central-1\.rds\.amazonaws\.com$/.test(binding.controlHost) ||
      !databaseName.test(binding.controlDatabase) || !roleName.test(binding.writeDbRole) || !roleName.test(binding.readDbRole) ||
      binding.writeDbRole === binding.readDbRole) throw Error();
    return Object.freeze(binding);
  } catch {
    throw Error("ECS_FIRST_OPEN_TASK_BINDING");
  }
}

function readLocalJson(url: URL, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = get(url, { signal, agent: false }, async response => {
      try {
        if (response.statusCode !== 200) throw Error();
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of response) {
          const data = Buffer.from(chunk);
          bytes += data.byteLength;
          if (bytes > 64 * 1024) throw Error();
          chunks.push(data);
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        response.destroy();
        reject(Error("ECS_FIRST_OPEN_LOCAL_METADATA_UNAVAILABLE"));
      }
    });
    request.on("error", () => reject(Error("ECS_FIRST_OPEN_LOCAL_METADATA_UNAVAILABLE")));
  });
}

function localTaskEndpoints(env: Env) {
  const taskEndpoint = env.ECS_CONTAINER_METADATA_URI_V4 ?? "";
  const credentialsPath = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? "";
  if (env.AWS_EXECUTION_ENV !== "AWS_ECS_FARGATE" || env.AWS_REGION !== FIRST_OPEN_TASK_REGION ||
    (env.AWS_DEFAULT_REGION !== undefined && env.AWS_DEFAULT_REGION !== FIRST_OPEN_TASK_REGION) ||
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" || Object.entries(env).some(([key, value]) => value && excludedEnv.test(key)) ||
    !/^http:\/\/169\.254\.170\.2\/v4\/[a-zA-Z0-9-]{1,128}$/.test(taskEndpoint) ||
    !/^\/v2\/credentials\/[a-zA-Z0-9-]{1,128}$/.test(credentialsPath)) throw Error("ECS_FIRST_OPEN_TASK_IDENTITY_ENV");
  return { task: new URL(taskEndpoint + "/task"), credentials: new URL(credentialsPath, metadataOrigin) };
}

function localReader(signal: AbortSignal, readLocal: ReadLocal) {
  return (url: URL) => {
    signal.throwIfAborted();
    return readLocal(url, AbortSignal.any([signal, AbortSignal.timeout(4_000)]));
  };
}

/** ECS-provided short-lived native credentials, bound to the caller's pinned role. */
export async function readEcsTaskCredentials({ env, expectedRoleArn, signal, now = Date.now, readLocal = readLocalJson }: {
  env: Env; expectedRoleArn: string; signal: AbortSignal; now?: () => number; readLocal?: ReadLocal;
}) {
  const expectedPrefix = `arn:aws:iam::${FIRST_OPEN_TASK_ACCOUNT}:role/`;
  if (!expectedRoleArn.startsWith(expectedPrefix) || !/^[A-Za-z0-9+=,.@_/-]{1,512}$/.test(expectedRoleArn.slice(expectedPrefix.length)) ||
    expectedRoleArn.includes("..")) throw Error("ECS_FIRST_OPEN_TASK_ROLE_SCOPE");
  const credentialsUrl = localTaskEndpoints(env).credentials;
  const read = localReader(signal, readLocal);
  const readCredentials = async () => {
    const credentials = await read(credentialsUrl);
    if (!record(credentials) || credentials.RoleArn !== expectedRoleArn ||
      typeof credentials.AccessKeyId !== "string" || !/^ASIA[A-Z0-9]{16}$/.test(credentials.AccessKeyId) ||
      typeof credentials.SecretAccessKey !== "string" || !/^[a-zA-Z0-9/+=]{40}$/.test(credentials.SecretAccessKey) ||
      typeof credentials.Token !== "string" || !/^[\x21-\x7e]{16,16384}$/.test(credentials.Token) ||
      typeof credentials.Expiration !== "string") throw Error("ECS_FIRST_OPEN_TASK_ROLE_SCOPE");
    const expiresAt = Date.parse(credentials.Expiration);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() + 5_000) throw Error("ECS_FIRST_OPEN_TASK_ROLE_SCOPE");
    return { accessKeyId: credentials.AccessKeyId, secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.Token, expiresAt };
  };
  let current = await readCredentials();
  return async () => {
    signal.throwIfAborted();
    if (now() + 5_000 >= current.expiresAt) current = await readCredentials();
    const { expiresAt, ...credentials } = current;
    return { ...credentials, expiration: new Date(expiresAt) };
  };
}

export async function attestFirstOpenTask({ env, binding, signal, now = Date.now, readLocal = readLocalJson }: {
  env: Env; binding: Readonly<FirstOpenTaskBinding>; signal: AbortSignal; now?: () => number; readLocal?: ReadLocal;
}) {
  const metadata = await localReader(signal, readLocal)(localTaskEndpoints(env).task);
  if (!record(metadata) || metadata.Cluster !== binding.clusterArn || metadata.Family !== binding.family ||
    metadata.LaunchType !== "FARGATE" || typeof metadata.TaskARN !== "string" || !metadata.TaskARN.startsWith(taskPrefix) ||
    !/^[0-9a-f]{32}$/.test(metadata.TaskARN.slice(taskPrefix.length)) ||
    !["string", "number"].includes(typeof metadata.Revision) || !/^[1-9][0-9]{0,8}$/.test(String(metadata.Revision)) ||
    !Array.isArray(metadata.Containers)) throw Error("ECS_FIRST_OPEN_TASK_METADATA_SCOPE");
  const matching = metadata.Containers.filter(container => record(container) && container.Name === binding.containerName);
  if (matching.length !== 1 || matching[0].Image !== binding.image || matching[0].ImageID !== imageDigest(binding.image)) {
    throw Error("ECS_FIRST_OPEN_TASK_IMAGE_SCOPE");
  }
  const credentials = await readEcsTaskCredentials({ env, expectedRoleArn: binding.taskRoleArn, signal, now, readLocal });
  return Object.freeze({
    taskArn: metadata.TaskARN,
    taskDefinitionArn: `arn:aws:ecs:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:task-definition/${binding.family}:${metadata.Revision}`,
    roleArn: binding.taskRoleArn,
    credentials,
  });
}
