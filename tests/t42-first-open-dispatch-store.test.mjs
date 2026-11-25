import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { dispatchEcsFirstOpen, isFirstOpenDispatchSelection } from "../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { createFirstOpenDispatchStore } from "../lib/deployments/execution/ecs-first-open-dispatch-store.ts";

const id = "exec_" + "a".repeat(32);
const account = "arn:aws:ecs:ca-central-1:123456789012";
const placement = { clusterArn: account + ":cluster/fixture-first-open", taskDefinitionArn: account + ":task-definition/fixture-first-open:9",
  subnetIds: ["subnet-0123abcd"], securityGroupIds: ["sg-0123abcd"], containerName: "first-open" };
const taskArn = account + ":task/fixture-first-open/" + "b".repeat(32);
const selection = { jobId: "job_" + "c".repeat(24), instanceId: "app_fixture_first_open", workspaceId: "workspace_fixture",
  releaseId: "release_" + "d".repeat(32), reviewSha256: "e".repeat(64), hostname: "first-open.sandbox.techlong.cloud" };
const fields = ["jobId", "instanceId", "workspaceId", "releaseId", "reviewSha256", "hostname"];
const expected = fields.map(key => selection[key]);
const launchResponse = { tasks: [{ taskArn, taskDefinitionArn: placement.taskDefinitionArn, clusterArn: placement.clusterArn }] };
const acknowledged = { status: "acknowledged", taskArn };

function fakeControlDb({ historical = false } = {}) {
  const calls = [];
  let reserved = historical;
  let record = historical ? { ...acknowledged, definition: null } : { status: "waiting", taskArn: null, definition: null };
  const store = createFirstOpenDispatchStore({
    prepare(sql) {
      return { bind(...args) {
        assert.equal(args[0], id);
        return { async first() {
          if (sql.startsWith("WITH eligible")) {
            calls.push("reserve");
            assert.equal(args[1], FIRST_OPEN_BASELINE_BINDING.jobId);
            assert.match(sql, /job\.id = \$3 AND instance\.id = \$4 AND instance\.workspace_id = \$5/);
            assert.match(sql, /execution\.release_id = \$6 AND execution\.review_sha256 = \$7/);
            assert.match(sql, /instance\.slug \|\| '\.sandbox\.techlong\.cloud' = \$8/);
            assert.match(sql, /FOR SHARE OF instance, deployment, job, purchase, payment/);
            assert.match(sql, /UPDATE first_open_executions execution SET dispatch_token = execution\.id, dispatch_started_at = timed\.at[\s\S]*?execution\.job_id = \$3 AND execution\.instance_id = \$4/);
            if (reserved || (args[2] !== null && !expected.every((value, index) => args[index + 2] === value))) return null;
            reserved = true;
            return { execution_id: id };
          }
          if (sql.startsWith("WITH observed")) {
            calls.push("finish");
            assert.match(sql, /dispatch_task_definition_arn = \$4/);
            assert.match(sql, /execution\.dispatch_outcome IS NULL/);
            record = { status: args[1], taskArn: args[2], definition: args[3] };
            return { execution_id: id };
          }
          calls.push("read");
          assert.doesNotMatch(sql, /UPDATE|INSERT|dispatch_task_definition_arn/);
          return { status: record.status, taskArn: record.taskArn };
        } };
      } };
    },
  });
  return { calls, store, record: () => record };
}

test("the launch selection accepts exactly the reviewed held-job scope", () => {
  assert.equal(isFirstOpenDispatchSelection(selection), true);
  for (const value of [null, [], { ...selection, executionId: id }, { ...selection, hostname: "elsewhere.invalid" },
    { ...selection, reviewSha256: "A".repeat(64) }, { ...selection, jobId: id }, Object.create(selection),
    { ...selection, hostname: selection.hostname + "\n" }, { ...selection, workspaceId: " " + selection.workspaceId },
    Object.defineProperty({ ...selection }, "hostname", { enumerable: false })]) {
    assert.equal(isFirstOpenDispatchSelection(value), false);
  }
});

test("mismatched durable approval selection never launches or consumes a matching future reservation", async () => {
  const f = fakeControlDb();
  const ecs = { async runTask() { assert.fail("foreign approval reached ECS"); } };
  const wrong = ["job_" + "9".repeat(24), "app_different", "workspace_different", "release_" + "8".repeat(32),
    "7".repeat(64), "other.sandbox.techlong.cloud"];
  for (const [index, field] of fields.entries()) {
    const result = await dispatchEcsFirstOpen(id, { ...placement, selection: { ...selection, [field]: wrong[index] } }, { store: f.store, ecs });
    assert.deepEqual(result, { executionId: id, status: "waiting", taskArn: null });
  }
  assert.equal(f.calls.filter(call => call === "finish").length, 0);
  let launches = 0;
  const once = { async runTask() { launches++; return launchResponse; } };
  const launch = () => dispatchEcsFirstOpen(id, { ...placement, selection }, { store: f.store, ecs: once });
  await Promise.all([launch(), launch()]);
  assert.equal(launches, 1);
  assert.deepEqual(f.record(), { ...acknowledged, definition: placement.taskDefinitionArn });
  assert.deepEqual(await launch(), { executionId: id, ...acknowledged });
  assert.equal(launches, 1);
});

test("only a provider ACK for the exact task definition records its revision", async () => {
  for (const [status, response] of [
    ["unknown", { tasks: [{ ...launchResponse.tasks[0], taskDefinitionArn: account + ":task-definition/fixture-first-open:8" }] }],
    ["failed", { failures: [{ reason: "MISSING" }] }],
  ]) {
    const f = fakeControlDb();
    assert.deepEqual(await dispatchEcsFirstOpen(id, placement, { store: f.store, ecs: { async runTask() { return response; } } }),
      { executionId: id, status, taskArn: null });
    assert.deepEqual(f.record(), { status, taskArn: null, definition: null });
    assert.equal(await f.store.finish(id, { status, taskArn: null }, placement.taskDefinitionArn), false);
    assert.equal(await f.store.finish(id, acknowledged, placement.taskDefinitionArn.replace("123456789012", "234567890123")), false);
    assert.equal(f.calls.filter(call => call === "finish").length, 1);
  }
  const old = fakeControlDb({ historical: true });
  assert.deepEqual(await dispatchEcsFirstOpen(id, placement, { store: old.store, ecs: { async runTask() { assert.fail("historical ACK replayed"); } } }),
    { executionId: id, ...acknowledged });
  assert.equal(old.record().definition, null);
});

test("the forward task definition migration and baseline preserve historical null revisions", async () => {
  const [migration, baseline, schema] = await Promise.all([
    "../db/postgres-migrations/0013_first_open_dispatch_task_definition.sql", "../db/postgres-schema.sql", "../db/postgres-schema.ts",
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const normalize = text => text.replaceAll("\r\n", "\n").trim();
  assert.ok(normalize(baseline).includes(normalize(migration)));
  assert.match(migration, /ADD COLUMN dispatch_task_definition_arn text,/);
  assert.match(migration, /dispatch_task_definition_arn IS NULL\s+OR \(dispatch_outcome = 'acknowledged' AND dispatch_task_arn IS NOT NULL/);
  assert.match(migration, /split_part\(dispatch_task_definition_arn, ':', 4\) = split_part\(dispatch_task_arn, ':', 4\)/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b/);
  assert.match(schema, /dispatchTaskDefinitionArn: text\("dispatch_task_definition_arn"\)/);
});
