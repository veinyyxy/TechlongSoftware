import assert from "node:assert/strict";
import test from "node:test";
import { CloudFormationClient, DescribeChangeSetCommand, DescribeStacksCommand, GetTemplateCommand } from "@aws-sdk/client-cloudformation";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { canonical as ordinal, hash as templateHash } from "../ops/temporary-idle/environment-cfn.mjs";
import { firstOpenInstallInspectorScope } from "../ops/aws-sandbox/first-open-install-inspector-scope.ts";
import { bindFirstOpenInstallSharedPredecessorReadback } from "../ops/aws-sandbox/first-open-inspector-authority-readback.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

test("install Observer reads only the exact completed shared predecessor and refuses replay, drift, early or late evidence", async ctx => {
  const t = Date.UTC(2030, 0, 1), { taskRelease } = await firstOpenTaskReleaseFixture(), hash = "a".repeat(64),
    commit = "b".repeat(40), startAt = t + 100_000;
  const release: FirstOpenFrozenRelease = {
    schema: "techlong/sandbox-first-open-release/v1", jobId: s.jobId, taskRelease, approvalSha256: hash,
    callerCommit: commit, runtimeCommit: commit, runtimeSourceSha256: hash, inspectorSeedSha256: hash,
    runOnceReusableCommit: commit, inspectReusableCommit: commit, managementReusableCommit: commit,
    workflowId: "12345", actorId: "14145707", nonce: "c".repeat(32), startAt,
    claimBefore: startAt + 40_000, applicationLoginBefore: startAt + 120_000, writeBefore: startAt + 300_000,
    completionReserveMs: 50_000, phaseCutoffs: [30, 60, 100, 180, 240].map(x => startAt + x * 1000) as FirstOpenFrozenRelease["phaseCutoffs"],
    lifecycleAuthoritySchedule: { grantNotBefore: startAt + 150_000, relockNotBefore: startAt + 200_000 },
  };
  const window = { startAt: t, issueBefore: t + 10_000, grantAt: t + 50_000, grantBefore: t + 60_000,
    relockAt: t + 70_000, relockBefore: t + 80_000, factsCutoff: t + 90_000 };
  const rows = [
    { LogicalResourceId: "TenantLifecycleTaskRole", ResourceType: "AWS::IAM::Role", Action: "Modify", Replacement: "False" },
    { LogicalResourceId: "FirstOpenFc41597fLifecycleBoundary", ResourceType: "AWS::IAM::ManagedPolicy", Action: "Add" },
    { LogicalResourceId: "ProvisionerRole", ResourceType: "AWS::IAM::Role", Action: "Modify", Replacement: "False" },
  ];
  const template = { Resources: Object.fromEntries(rows.map(r => [r.LogicalResourceId, { Type: r.ResourceType }])),
    Metadata: { FixtureOnly: "x".repeat(51_220) } };
  const target = { targetCanonicalSha256: templateHash(template), targetBytes: Buffer.byteLength(JSON.stringify(ordinal(template))) };
  const at = t + 30_000, before = t + 40_000, staging = { readBefore: t + 20_000, targets: { shared: target }, sharedObservation: { at, before } };
  const releaseSha256 = await sha256Hex(release), scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, staging);
  const approvedScopeSha256 = await sha256Hex(scope), calls: string[] = [];
  const name = scope.staging!.sharedObservation!.changeSetName;
  const id = `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${name}/1696ea4c-f727-4abc-b876-65c438132e9b`;
  let clock = at, drift = "", suppliedCredentials = 0;
  ctx.mock.method(CloudFormationClient.prototype, "send", async (cmd: unknown, options: { abortSignal: AbortSignal }) => {
    assert.ok(cmd instanceof DescribeStacksCommand || cmd instanceof DescribeChangeSetCommand || cmd instanceof GetTemplateCommand);
    assert.equal(cmd.input.StackName, scope.ownerStackArn);
    assert.equal(options.abortSignal.aborted, false);
    if (cmd instanceof DescribeStacksCommand) {
      calls.push("stack");
      return { Stacks: [{ StackId: scope.ownerStackArn, StackStatus: drift === "stack" ? "UPDATE_ROLLBACK_COMPLETE" : "UPDATE_COMPLETE",
        LastUpdatedTime: new Date(staging.readBefore + (drift === "stale" ? -1 : 2)),
        ...(drift === "role" && { RoleARN: "incorrect-role" }), ...(drift === "deleted" && { DeletionTime: new Date(clock) }) }] };
    }
    if (cmd instanceof DescribeChangeSetCommand) {
      calls.push("change");
      assert.equal(cmd.input.ChangeSetName, name);
      return { ChangeSetName: name, StackId: scope.ownerStackArn, ChangeSetId: drift === "id" ? id.replace(name, scope.changeSetNames[0]) : id,
        Status: "CREATE_COMPLETE", ExecutionStatus: drift === "executing" ? "EXECUTE_IN_PROGRESS" : "EXECUTE_COMPLETE",
        ...(drift === "page" && { NextToken: "another-page" }), CreationTime: new Date(staging.readBefore + 1),
        Changes: rows.map((r, i) => ({ Type: "Resource", ResourceChange: drift === "replacement" && i === 0 ? { ...r, Replacement: "True" } : r })) };
    }
    calls.push("original");
    assert.equal(cmd.input.TemplateStage, "Original");
    return { TemplateBody: JSON.stringify(drift === "template" ? { ...template, Changed: true } : template, null, 2),
      StagesAvailable: drift === "stage" ? ["Processed"] : ["Original", "Processed"] };
  });
  const bind = () => bindFirstOpenInstallSharedPredecessorReadback({ release, releaseSha256, window, staging, approvedScopeSha256,
    async credentials() { suppliedCredentials++; return { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture" }; } }, () => clock);
  const read = await bind(), signal = new AbortController().signal;
  const value = await read(signal);
  assert.equal(value.changeSetId, id);
  assert.equal(value.authorityScopeSha256, approvedScopeSha256);
  assert.equal(value.exactOwnerStackArn, scope.ownerStackArn);
  assert.equal(value.targetCanonicalSha256, target.targetCanonicalSha256);
  assert.equal(value.targetBytes, target.targetBytes);
  assert.equal(value.key, scope.staging!.targets.shared!.key);
  assert.equal(value.executionAuthorized, false);
  assert.equal(Object.hasOwn(value, "template"), false);
  assert.deepEqual(calls.splice(0), ["stack", "change", "original"]);
  await assert.rejects(read(signal), /PREDECESSOR_UNPROVED/);
  for (const when of [at - 1, before]) {
    clock = when;
    await assert.rejects((await bind())(signal), /PREDECESSOR_UNPROVED/);
  }
  assert.deepEqual(calls, []);
  assert.equal(suppliedCredentials, 1);
  clock = at;
  for (const [reason, expected] of [["stack", ["stack"]], ["role", ["stack"]], ["deleted", ["stack"]],
    ["id", ["stack", "change"]], ["executing", ["stack", "change"]], ["stale", ["stack", "change"]],
    ["page", ["stack", "change"]], ["replacement", ["stack", "change"]],
    ["template", ["stack", "change", "original"]], ["stage", ["stack", "change", "original"]]] as const) {
    drift = reason;
    await assert.rejects((await bind())(signal), /PREDECESSOR_UNPROVED/);
    assert.deepEqual(calls.splice(0), expected);
  }
});
