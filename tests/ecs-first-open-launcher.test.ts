import assert from "node:assert/strict";
import test from "node:test";
import type {
  FirstOpenDispatchState,
  FirstOpenDispatchStore,
  FirstOpenEcsRunTaskRequest,
} from "../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { createEcsFirstOpenLaunchHandler } from "../lib/deployments/execution/ecs-first-open-launcher.ts";

const arn = "arn:aws:ecs:ca-central-1:123456789012";
const executionId = "exec_" + "a".repeat(32);
const clusterArn = arn + ":cluster/synthetic-platform";
const taskDefinitionArn = arn + ":task-definition/synthetic-first-open:12";
const taskArn = arn + ":task/synthetic-platform/" + "1".repeat(32);

function fixture() {
  const placement = {
    clusterArn,
    taskDefinitionArn,
    containerName: "first-open",
    subnetIds: ["subnet-0123456789abcdef0", "subnet-fedcba9876543210f"],
    securityGroupIds: ["sg-0123456789abcdef0"],
  };
  const operations: string[] = [];
  const launches: FirstOpenEcsRunTaskRequest[] = [];
  let reserved = false;
  let state: FirstOpenDispatchState = { status: "waiting", taskArn: null };
  const store: FirstOpenDispatchStore = {
    async begin(id) {
      operations.push("begin");
      if (id !== executionId || reserved) return false;
      reserved = true;
      return true;
    },
    async finish(id, outcome) {
      operations.push("finish");
      assert.equal(id, executionId);
      state = outcome;
      return true;
    },
    async read(id) {
      operations.push("read");
      return id === executionId ? state : null;
    },
  };
  const launch = createEcsFirstOpenLaunchHandler({ placement, store, ecs: {
    async runTask(request) {
      launches.push(request);
      return { tasks: [{ clusterArn, taskDefinitionArn, taskArn }] };
    },
  } });
  return { launch, placement, launches, operations };
}

test("first-open launcher rejects caller-supplied overrides before reading or writing the start intent", async () => {
  const { launch, operations, launches } = fixture();
  for (const extras of [
    { command: ["other"] }, { image: "other" }, { count: 2 }, { cluster: "other" },
    { taskDefinition: "other" }, { taskRoleArn: "other" }, { executionRoleArn: "other" },
    { subnetIds: ["other"] }, { securityGroupIds: ["other"] }, { networkConfiguration: {} },
    { overrides: { containerOverrides: [{ environment: [] }] } }, { assignPublicIp: "ENABLED" },
  ]) await assert.rejects(launch({ executionId, ...extras }), /ECS_FIRST_OPEN_LAUNCH_INPUT/);
  for (const input of [executionId, null, [executionId], {}, { executionId: 42 }, { executionId: "exec_bad" },
    Object.create({ executionId }), { get executionId() { return assert.fail("parsed payload must be a data property"); } },
    Object.defineProperty({ executionId }, "command", { value: ["other"] })]) {
    await assert.rejects(launch(input), /ECS_FIRST_OPEN_LAUNCH_INPUT/);
  }
  assert.deepEqual(operations, []);
  assert.deepEqual(launches, []);
});

test("first-open launcher submits only fixed placement and one start for a shared execution id", async () => {
  const { launch, placement, launches, operations } = fixture();
  const expectedSubnets = [...placement.subnetIds];
  const expectedGroups = [...placement.securityGroupIds];
  placement.subnetIds[0] = "subnet-00000000000000000";
  placement.securityGroupIds.push("sg-00000000000000000");
  placement.clusterArn = arn + ":cluster/other";
  placement.taskDefinitionArn = arn + ":task-definition/other:99";
  placement.containerName = "other";

  const otherExecutionId = "exec_" + "b".repeat(32);
  assert.deepEqual(await launch({ executionId: otherExecutionId }), {
    executionId: otherExecutionId, status: "not_found", taskArn: null,
  });
  assert.deepEqual(launches, []);
  await Promise.all([launch({ executionId }), launch({ executionId })]);
  assert.deepEqual(await launch({ executionId }), { executionId, status: "acknowledged", taskArn });
  assert.deepEqual(launches, [{
    cluster: clusterArn, taskDefinition: taskDefinitionArn, launchType: "FARGATE", count: 1,
    clientToken: executionId,
    networkConfiguration: { awsvpcConfiguration: {
      assignPublicIp: "DISABLED", subnets: expectedSubnets, securityGroups: expectedGroups,
    } },
    overrides: { containerOverrides: [{
      name: "first-open", command: ["node", "ops/platform-hosting-v1/first-open.mjs", executionId],
    }] },
  }]);
  assert.equal(operations.filter(operation => operation === "finish").length, 1);
});
