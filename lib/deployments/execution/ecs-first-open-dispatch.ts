import { isFirstOpenExecutionId } from "./ecs-first-open.ts";

export interface FirstOpenDispatchSelection {
  readonly jobId: string;
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly releaseId: string;
  readonly reviewSha256: string;
  readonly hostname: string;
}

const selectionPatterns: Record<keyof FirstOpenDispatchSelection, RegExp> = {
  jobId: /^job_[a-f0-9]{24}$/,
  instanceId: /^[A-Za-z0-9_-]{3,128}$/,
  workspaceId: /^[A-Za-z0-9_-]{3,128}$/,
  releaseId: /^release_[a-f0-9]{32}$/,
  reviewSha256: /^[a-f0-9]{64}$/,
  hostname: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/,
};

export function isFirstOpenDispatchSelection(value: unknown): value is FirstOpenDispatchSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const patterns = Object.entries(selectionPatterns);
  return Reflect.ownKeys(fields).length === patterns.length &&
    patterns.every(([field, pattern]) => {
      const item = Object.getOwnPropertyDescriptor(fields, field);
      return item?.enumerable === true && typeof item.value === "string" &&
        item.value.trim() === item.value && pattern.test(item.value);
    });
}

export interface FirstOpenEcsPlacement {
  clusterArn: string;
  taskDefinitionArn: string;
  containerName: string;
  subnetIds: readonly string[];
  securityGroupIds: readonly string[];
  selection?: FirstOpenDispatchSelection;
}

export interface FirstOpenEcsRunTaskRequest {
  cluster: string;
  taskDefinition: string;
  launchType: "FARGATE";
  count: 1;
  clientToken: string;
  networkConfiguration: {
    awsvpcConfiguration: { assignPublicIp: "DISABLED"; subnets: string[]; securityGroups: string[] };
  };
  overrides: {
    containerOverrides: [{ name: string; command: ["node", "ops/platform-hosting-v1/first-open.mjs", string] }];
  };
}

export interface FirstOpenEcsDispatchPort {
  /** Return ECS tasks or explicit service failures. Reject when delivery cannot be confirmed. */
  runTask(request: FirstOpenEcsRunTaskRequest): Promise<unknown>;
}

export type FirstOpenDispatchOutcome = { status: "acknowledged"; taskArn: string }
  | { status: "failed" | "unknown"; taskArn: null };

export type FirstOpenDispatchState = FirstOpenDispatchOutcome | { status: "waiting"; taskArn: null };

export interface FirstOpenDispatchStore {
  begin(executionId: string, selection?: FirstOpenDispatchSelection): Promise<boolean>;
  finish(executionId: string, outcome: FirstOpenDispatchOutcome, taskDefinitionArn?: string): Promise<boolean>;
  read(executionId: string): Promise<FirstOpenDispatchState | null>;
}

export type FirstOpenDispatchResult = { executionId: string } &
  (FirstOpenDispatchState | { status: "not_found"; taskArn: null });

const unknownOutcome = { status: "unknown", taskArn: null } as const;
export const firstOpenTaskDefinitionArnPattern =
  /^(arn:aws:ecs:[a-z0-9-]+:[0-9]{12}):task-definition\/[A-Za-z0-9_-]{1,255}:[1-9][0-9]*$/;

function validIds(values: readonly string[], pattern: RegExp, limit: number): boolean {
  return values.length > 0 && values.length <= limit && new Set(values).size === values.length &&
    values.every(value => pattern.test(value));
}

function prepareRequest(executionId: string, placement: FirstOpenEcsPlacement) {
  const { clusterArn, taskDefinitionArn, containerName, subnetIds, securityGroupIds, selection } = placement;
  const cluster = /^(arn:aws:ecs:[a-z0-9-]+:[0-9]{12}):cluster\/([A-Za-z0-9_-]{1,255})$/.exec(clusterArn);
  const taskDefinition = firstOpenTaskDefinitionArnPattern.exec(taskDefinitionArn);
  if (!isFirstOpenExecutionId(executionId) || !cluster || !taskDefinition || cluster[1] !== taskDefinition[1] ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(containerName) || !validIds(subnetIds, /^subnet-(?:[0-9a-f]{8}|[0-9a-f]{17})$/, 16) ||
    !validIds(securityGroupIds, /^sg-(?:[0-9a-f]{8}|[0-9a-f]{17})$/, 5) ||
    (selection !== undefined && !isFirstOpenDispatchSelection(selection))) {
    throw Error("ECS_FIRST_OPEN_DISPATCH_SCOPE");
  }

  const request: FirstOpenEcsRunTaskRequest = {
    cluster: clusterArn,
    taskDefinition: taskDefinitionArn,
    launchType: "FARGATE",
    count: 1,
    clientToken: executionId,
    networkConfiguration: {
      awsvpcConfiguration: { assignPublicIp: "DISABLED", subnets: [...subnetIds], securityGroups: [...securityGroupIds] },
    },
    overrides: { containerOverrides: [{ name: containerName, command: ["node", "ops/platform-hosting-v1/first-open.mjs", executionId] }] },
  };
  return { request, selection: selection && Object.freeze({ ...selection }),
    scope: { clusterArn, taskDefinitionArn, taskArnPrefix: `${cluster[1]}:task/${cluster[2]}/` } };
}

function interpretResult(response: unknown, { clusterArn, taskDefinitionArn, taskArnPrefix }: ReturnType<typeof prepareRequest>["scope"]): FirstOpenDispatchOutcome {
  if (!response || typeof response !== "object") return unknownOutcome;
  const { tasks = [], failures = [] } = response as { tasks?: unknown; failures?: unknown };
  if (!Array.isArray(tasks) || !Array.isArray(failures)) return unknownOutcome;
  if (tasks.length === 0 && failures.length > 0 &&
    failures.every(failure => typeof failure?.reason === "string" && failure.reason.trim() !== "")) {
    return { status: "failed", taskArn: null };
  }
  if (tasks.length !== 1 || failures.length !== 0) return unknownOutcome;

  const [task] = tasks;
  const taskArn = task?.taskArn;
  if (task?.clusterArn !== clusterArn || task.taskDefinitionArn !== taskDefinitionArn || typeof taskArn !== "string" ||
    !taskArn.startsWith(taskArnPrefix) || !/^[0-9a-f]{32}$/.test(taskArn.slice(taskArnPrefix.length))) return unknownOutcome;
  return { status: "acknowledged", taskArn };
}

/** Reserve the single dispatch before calling the injected port. A reserved dispatch is never replayed. */
export async function dispatchEcsFirstOpen(executionId: string, placement: FirstOpenEcsPlacement,
  { store, ecs }: { store: FirstOpenDispatchStore; ecs: FirstOpenEcsDispatchPort }): Promise<FirstOpenDispatchResult> {
  const { request, scope, selection } = prepareRequest(executionId, placement);
  const read = async () => {
    try {
      const state = await store.read(executionId);
      return state ? { executionId, ...state } : { executionId, status: "not_found" as const, taskArn: null };
    } catch {
      return { executionId, ...unknownOutcome };
    }
  };

  try {
    if (!await store.begin(executionId, selection)) return await read();
  } catch {
    // The reservation itself might have committed before its reply was lost.
    return { executionId, ...unknownOutcome };
  }

  let outcome: FirstOpenDispatchOutcome;
  try {
    outcome = interpretResult(await ecs.runTask(request), scope);
  } catch {
    outcome = unknownOutcome;
  }
  try {
    const definition = outcome.status === "acknowledged" ? scope.taskDefinitionArn : undefined;
    if (await store.finish(executionId, outcome, definition)) return { executionId, ...outcome };
  } catch {
    // A fresh read can confirm a terminal result after the persistence reply is lost.
  }
  const persisted = await read();
  return persisted.status === "waiting" || persisted.status === "not_found" ? { executionId, ...unknownOutcome } : persisted;
}
