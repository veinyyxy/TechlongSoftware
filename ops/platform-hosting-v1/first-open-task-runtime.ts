import { setTimeout as delay } from "node:timers/promises";
import { createEcsFirstOpenTaskPorts } from "../../lib/deployments/execution/ecs-first-open-runtime.ts";
import { isFirstOpenExecutionId, runEcsFirstOpen, type EcsFirstOpenApproval, type EcsFirstOpenPorts } from "../../lib/deployments/execution/ecs-first-open.ts";
import { assertEcsFirstOpenRdsApproval, createEcsFirstOpenRdsAuthority } from "../../lib/deployments/execution/gates.ts";
import { FIRST_OPEN_TASK_ACCOUNT, FIRST_OPEN_TASK_REGION, attestFirstOpenTask, readFirstOpenTaskBinding } from "./first-open-task-identity.ts";
import { createFirstOpenTaskRds } from "./first-open-task-rds.mjs";

const readDispatchAck = `SELECT e.id AS "executionId", e.approved_by AS "approvedBy", e.approved_at AS "approvedAt",
  e.job_id AS "jobId", e.instance_id AS "instanceId", i.workspace_id AS "workspaceId", e.release_id AS "releaseId",
  e.review_sha256 AS "reviewSha256", i.slug || '.sandbox.techlong.cloud' AS hostname,
  e.dispatch_started_at AS "startedAt", e.dispatch_outcome AS outcome, e.dispatch_task_arn AS "taskArn",
  e.dispatch_task_definition_arn AS "taskDefinitionArn", ack.at AS "ackAt"
  FROM first_open_executions e JOIN app_instances i ON i.id = e.instance_id
  LEFT JOIN first_open_execution_events ack ON ack.execution_id = e.id AND ack.sequence = 3
    AND ack.step = 'task_start' AND ack.status = 'completed'
  WHERE e.id = $1 AND e.dispatch_token = e.id AND e.dispatch_started_at IS NOT NULL`;
const windowMs = 60 * 60_000;
const maxWaitMs = 25_000;
type TaskSettings = Pick<EcsFirstOpenApproval, "baselineDigest" | "databaseSchemaVersion" | "dnsTarget" | "writeBefore">;
type ApprovedExecution = Readonly<Omit<EcsFirstOpenApproval, keyof TaskSettings>>;
type TaskIdentity = Awaited<ReturnType<typeof attestFirstOpenTask>>;
type TaskConnections = Awaited<ReturnType<typeof createFirstOpenTaskRds>>;
type Env = Readonly<Record<string, string | undefined>>;
type AckRow = Omit<ApprovedExecution, "approvedAt"> & {
  approvedAt: number | string;
  startedAt: number | string;
  ackAt: number | string | null;
  outcome: string | null;
  taskArn: string | null;
  taskDefinitionArn: string | null;
};

export type FirstOpenTaskResources = {
  settings: TaskSettings;
  management: EcsFirstOpenPorts["management"];
  reader: EcsFirstOpenPorts["reader"];
};

/** Bind-only factory. Any preparatory observation must be read-only; business
 * writes remain in the Worker -> Management -> Inspector path after claim. */
export type FirstOpenTaskResourceFactory = (input: {
  approval: ApprovedExecution;
  identity: TaskIdentity;
  readDb: ApplicationDatabase;
  repositorySql: TaskConnections["repositorySql"];
  maxWriteBefore: number;
  signal: AbortSignal;
}) => Promise<FirstOpenTaskResources>;

async function waitForDispatch(executionId: string, { taskArn, taskDefinitionArn }: TaskIdentity, db: ApplicationDatabase,
  { now, pause, signal }: { now: () => number; pause(ms: number, signal: AbortSignal): Promise<void>; signal: AbortSignal }) {
  const stopWaiting = now() + maxWaitMs;
  // Also cap the number of reads even if an injected test clock does not move.
  for (let attempt = 0; attempt < 26; attempt++) {
    signal.throwIfAborted();
    const row = await db.prepare(readDispatchAck).bind(executionId).first<AckRow>();
    const clock = now();
    const approvedAt = Number(row?.approvedAt);
    const startedAt = Number(row?.startedAt);
    const maxWriteBefore = approvedAt + windowMs;
    if (!row || row.executionId !== executionId || !Number.isSafeInteger(approvedAt) || approvedAt <= 0 ||
      !Number.isSafeInteger(startedAt) || startedAt < approvedAt || startedAt > clock || clock >= maxWriteBefore) break;

    if (row.outcome === "acknowledged" && row.taskArn === taskArn && row.taskDefinitionArn === taskDefinitionArn) {
      const ackAt = Number(row.ackAt);
      if (!Number.isSafeInteger(ackAt) || ackAt < startedAt || ackAt > clock || ackAt >= maxWriteBefore) break;
      const { approvedBy, jobId, instanceId, workspaceId, releaseId, reviewSha256, hostname } = row;
      if (![approvedBy, instanceId, workspaceId].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{3,128}$/.test(value)) ||
        !/^job_[a-f0-9]{24}$/.test(jobId) ||
        !/^release_[a-f0-9]{32}$/.test(releaseId) || !/^[a-f0-9]{64}$/.test(reviewSha256) ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/.test(hostname)) break;
      return { approval: Object.freeze({ executionId, approvedBy, approvedAt, jobId, instanceId, workspaceId,
        releaseId, reviewSha256, hostname }), maxWriteBefore };
    }

    // An ECS container can start before the dispatcher commits its ACK.
    // Only a reserved, unresolved dispatch can be observed again.
    const remaining = Math.min(stopWaiting, maxWriteBefore) - clock;
    if (row.outcome !== null || row.taskArn !== null || row.taskDefinitionArn !== null || row.ackAt !== null || remaining <= 0) break;
    await pause(Math.min(1_000, remaining), signal);
  }
  throw Error("ECS_FIRST_OPEN_DISPATCH_ACK_REQUIRED");
}

type PrepareOptions = {
  env: Env;
  signal: AbortSignal;
  createResources?: FirstOpenTaskResourceFactory;
  now?: () => number;
  readLocal?: NonNullable<Parameters<typeof attestFirstOpenTask>[0]["readLocal"]>;
  openRds?: (env: Env, binding: ReturnType<typeof readFirstOpenTaskBinding>) => TaskConnections;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export async function prepareFirstOpenTaskRuntime(executionId: string, {
  env, signal, createResources, now = Date.now, readLocal, openRds = createFirstOpenTaskRds,
  pause = async (ms, signal) => { await delay(ms, undefined, { signal }); },
}: PrepareOptions) {
  if (!isFirstOpenExecutionId(executionId)) throw Error("ECS_FIRST_OPEN_EXECUTION_ID");
  if (!createResources) throw Error("ECS_FIRST_OPEN_RUNTIME_UNAVAILABLE");
  const binding = readFirstOpenTaskBinding(env);
  const identity = await attestFirstOpenTask({ env, binding, signal, now, readLocal });
  const connections = openRds(env, binding);
  try {
    // Couple the dispatcher's provider ACK to this task and revision before binding resources.
    const { approval, maxWriteBefore } = await waitForDispatch(executionId, identity, connections.readDb, { now, pause, signal });
    signal.throwIfAborted();
    const { settings, management, reader } = await createResources({ approval, identity, readDb: connections.readDb,
      repositorySql: connections.repositorySql, maxWriteBefore, signal });
    if (!Number.isSafeInteger(settings.writeBefore) || settings.writeBefore > maxWriteBefore || settings.writeBefore <= now() ||
      management.databaseProfile !== "full_password" || management.express || management.config.workerEnabled || management.config.applyEnabled ||
      management.config.expectedAccountId !== FIRST_OPEN_TASK_ACCOUNT || management.config.expectedRegion !== FIRST_OPEN_TASK_REGION ||
      management.config.workerRoleArn !== identity.roleArn || !management.dependencies.tenantExternalOperationCoordinator ||
      !management.dependencies.tenantDatabase || typeof reader?.capture !== "function") {
      throw Error("ECS_FIRST_OPEN_MANAGEMENT_SCOPE");
    }
    const exact = { ...approval, writeBefore: settings.writeBefore };
    const rdsAuthority = createEcsFirstOpenRdsAuthority({ ...identity, ...exact });
    assertEcsFirstOpenRdsApproval(rdsAuthority, management.config, exact, now());
    const ports = createEcsFirstOpenTaskPorts({ ...settings, ...connections, management: { ...management, rdsAuthority },
      reader, taskArn: identity.taskArn, taskDefinitionArn: identity.taskDefinitionArn });
    const readApproval = ports.readApproval;
    ports.readApproval = async (id) => {
      signal.throwIfAborted();
      if (id !== executionId) return null;
      const row = await readApproval(id);
      return row && Object.entries(approval).every(([key, value]) => row[key as keyof ApprovedExecution] === value) ? row : null;
    };
    return { ports, verifyWriter: connections.verifyWriter, close: connections.close };
  } catch (error) {
    await connections.close();
    throw error;
  }
}

export async function runPreparedFirstOpenTask(executionId: string, options: PrepareOptions) {
  const runtime = await prepareFirstOpenTaskRuntime(executionId, options);
  try {
    await runtime.verifyWriter();
    return await runEcsFirstOpen(executionId, runtime.ports);
  } finally {
    await runtime.close();
  }
}
