import assert from "node:assert/strict";
import test from "node:test";
import {
  executeReviewedSharedCellAuthorCompensation,
  inspectSharedCellAuthorCompensation,
  recoverSharedCellAuthorCompensation,
  SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
  SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES,
  SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
  type SharedCellAuthorCompensationCandidate,
  type SharedCellAuthorCompensationMutationPort,
  type SharedCellAuthorCompensationReadPort,
  type StrongSharedCellAuthorAuthorityReadPort,
} from "../lib/deployments/execution/shared-cell-author-compensation.ts";

const stackName = "techlong-sandbox-cell-sandbox-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${stackName}/12345678-1234-4234-8234-123456789012`;
const rawSha256 = "1".repeat(64);
const canonicalSha256 = "2".repeat(64);
const changeSetName = `${stackName}-${rawSha256.slice(0, 16)}`;
const changeSetArn =
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
  `${changeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
const templateUrl =
  "https://techlong-sandbox-build-source-402010193138-ca-central-1." +
  `s3.ca-central-1.amazonaws.com/b5-shared-cell/templates/sha256/${rawSha256}.json`;
const testNow = Date.now();
const grantReviewedAt = new Date(testNow - 60_000).toISOString();
const grantExpiresAt = new Date(testNow + 59 * 60_000).toISOString();

function candidate(input: {
  reviewedAt?: string;
  expiresAt?: string;
} = {}): SharedCellAuthorCompensationCandidate {
  return {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    stackName,
    stackId,
    compensationGrant: {
      reviewedAt: input.reviewedAt ?? grantReviewedAt,
      expiresAt: input.expiresAt ?? grantExpiresAt,
    },
    immutableTemplate: {
      url: templateUrl,
      rawSha256,
      canonicalSha256,
    },
    changeSet: {
      name: changeSetName,
      arn: changeSetArn,
      type: "CREATE",
      roleArn: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
      capabilities: [],
      includeNestedStacks: false,
      resourceTypes: [...SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES],
      parameters: [
        { ParameterKey: "AvailabilityZoneA", ParameterValue: "ca-central-1a" },
        { ParameterKey: "AvailabilityZoneB", ParameterValue: "ca-central-1b" },
        {
          ParameterKey: "CertificateArn",
          ParameterValue:
            "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-4234-8234-123456789012",
        },
        {
          ParameterKey: "ControlTrustStoreArn",
          ParameterValue:
            "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/control/0123456789abcdef",
        },
        {
          ParameterKey: "CellJanitorFunctionArn",
          ParameterValue:
            "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
        },
        {
          ParameterKey: "CellSchedulerInvokeRoleArn",
          ParameterValue:
            "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
        },
        {
          ParameterKey: "CellSchedulerGroupName",
          ParameterValue: "techlong-sandbox-cell",
        },
        { ParameterKey: "CleanupAt", ParameterValue: "2026-09-23T03:00:00" },
      ],
      tags: [
        { Key: "Environment", Value: "aws-sandbox" },
        { Key: "ManagedBy", Value: "techlong-cell-operator" },
        { Key: "CellId", Value: "cell-sandbox-1" },
        { Key: "ExpiresAt", Value: "2026-09-23T03:00:00.000Z" },
      ],
    },
  };
}

function changeSetEvidence(source = candidate()) {
  return {
    state: "present",
    changeSet: {
      changeSetName: source.changeSet.name,
      changeSetArn: source.changeSet.arn,
      stackName: source.stackName,
      stackId: source.stackId,
      changeSetType: "CREATE",
      status: "CREATE_COMPLETE",
      executionStatus: "AVAILABLE",
      roleArn: source.changeSet.roleArn,
      templateUrl: source.immutableTemplate.url,
      templateRawSha256: source.immutableTemplate.rawSha256,
      templateCanonicalSha256: source.immutableTemplate.canonicalSha256,
      capabilities: [],
      includeNestedStacks: false,
      resourceTypes: [...source.changeSet.resourceTypes],
      parameters: structuredClone(source.changeSet.parameters),
      tags: structuredClone(source.changeSet.tags),
    },
  };
}

type StackState = "review" | "deleting" | "missing" | "active";
type DeleteBehavior =
  | "success"
  | "async_then_missing"
  | "lost_then_missing"
  | "accepted_still_present"
  | "lost_still_present";

function fixture(input: {
  initialState?: StackState;
  changeSetPresent?: boolean;
  resources?: unknown[];
  authorityPresent?: boolean;
  callerArn?: string;
  denyAt?: "describeStack" | "getTemplate" | "listResources" | "describeChangeSet";
  changeSetDrift?: (value: ReturnType<typeof changeSetEvidence>) => void;
  deleteChangeSetBehavior?: DeleteBehavior;
  deleteStackBehavior?: DeleteBehavior;
  deleteChangeSetRemovesStack?: boolean;
  stackTagDrift?: boolean;
  stackRoleArn?: string | null;
  deletingReadsBeforeMissing?: number;
  staleReviewReadsAfterDeleteStack?: number;
  resourcePresenceReadsAfterStackMissing?: number;
  authoritySnapshot?: unknown;
  changeSetMissingEvidence?: unknown;
  mutationCallerArn?: string;
  mutationRegion?: string;
  mutationCallerDenied?: boolean;
  authorityBecomesPresentOnMutationCaller?: boolean;
  afterDeleteChangeSet?: () => void;
  afterDeleteStack?: () => void;
} = {}) {
  let state = input.initialState ?? "review";
  let deletingReadsRemaining = input.deletingReadsBeforeMissing ?? 1;
  let staleReviewReadsRemaining = input.staleReviewReadsAfterDeleteStack ?? 0;
  let pendingDeletion = false;
  let resourcePresenceReadsRemaining =
    input.resourcePresenceReadsAfterStackMissing ?? 0;
  let changeSetPresent = input.changeSetPresent ?? true;
  const calls: string[] = [];
  const deleteChangeSetRequests: unknown[] = [];
  const deleteStackRequests: unknown[] = [];
  const describeTargets: string[] = [];
  const templateTargets: string[] = [];
  const resourceTargets: string[] = [];
  const resources = input.resources ?? [];

  function denied(label: typeof input.denyAt): void {
    if (input.denyAt === label) throw new Error("AccessDenied");
  }

  const evidence: SharedCellAuthorCompensationReadPort = {
    region: "ca-central-1",
    async getCallerIdentity() {
      calls.push("caller");
      return {
        accountId: "402010193138",
        arn: input.callerArn ?? SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
      };
    },
    async describeStack(value) {
      calls.push("describe-stack");
      describeTargets.push(value.stackNameOrId);
      denied("describeStack");
      if (pendingDeletion && state === "review") {
        if (staleReviewReadsRemaining <= 0) {
          state = "deleting";
          pendingDeletion = false;
        } else {
          staleReviewReadsRemaining -= 1;
        }
      }
      if (state === "deleting" && deletingReadsRemaining <= 0) state = "missing";
      if (state === "missing") {
        return {
          state: "missing",
          stackName,
          proof: "NAME_BOUND_VALIDATION_ERROR",
        };
      }
      const observedState = state;
      if (state === "deleting") deletingReadsRemaining -= 1;
      return {
        state: "present",
        stack: {
          stackName,
          stackId,
          stackStatus:
            observedState === "review"
              ? "REVIEW_IN_PROGRESS"
              : observedState === "deleting"
                ? "DELETE_IN_PROGRESS"
                : "CREATE_COMPLETE",
          tags: input.stackTagDrift
            ? [
                ...structuredClone(candidate().changeSet.tags).slice(0, 3),
                { Key: "ExpiresAt", Value: "2026-08-09T04:00:00.000Z" },
              ]
            : structuredClone(candidate().changeSet.tags),
          terminationProtection: false,
          roleArn:
            input.stackRoleArn === undefined
              ? SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN
              : input.stackRoleArn,
          parentId: null,
          rootId: null,
        },
      };
    },
    async getOriginalTemplate(value) {
      calls.push("get-template");
      templateTargets.push(value.stackNameOrId);
      denied("getTemplate");
      return {
        state: "missing",
        stackNameOrId: value.stackNameOrId,
        proof: "NAME_BOUND_VALIDATION_ERROR",
      };
    },
    async listStackResourcesPage(value) {
      calls.push("list-resources");
      resourceTargets.push(value.stackNameOrId);
      denied("listResources");
      if (state === "missing") {
        if (resourcePresenceReadsRemaining > 0) {
          resourcePresenceReadsRemaining -= 1;
          return { resources: [], nextToken: null };
        }
        return {
          state: "missing",
          stackNameOrId: value.stackNameOrId,
          proof: "NAME_BOUND_VALIDATION_ERROR",
        };
      }
      return { resources: structuredClone(resources), nextToken: null };
    },
    async describeChangeSet() {
      calls.push("describe-change-set");
      denied("describeChangeSet");
      if (!changeSetPresent) {
        if (input.changeSetMissingEvidence !== undefined) {
          return structuredClone(input.changeSetMissingEvidence);
        }
        return {
          state: "missing",
          changeSetArn,
          proof: "ARN_BOUND_VALIDATION_ERROR",
        };
      }
      const value = changeSetEvidence();
      input.changeSetDrift?.(value);
      return value;
    },
  };

  const authority: StrongSharedCellAuthorAuthorityReadPort = {
    async readStrong() {
      calls.push("authority");
      if (
        input.authorityBecomesPresentOnMutationCaller &&
        calls.includes("mutation-caller")
      ) {
        return {
          authorityKey: "cell:cell-sandbox-1",
          revision: 1,
          item: { state: "provisioned" },
        };
      }
      if (input.authoritySnapshot !== undefined) {
        return structuredClone(input.authoritySnapshot);
      }
      return {
        authorityKey: "cell:cell-sandbox-1",
        revision: input.authorityPresent ? 1 : 0,
        item: input.authorityPresent ? { state: "provisioned" } : null,
      };
    },
  };

  const mutations: SharedCellAuthorCompensationMutationPort = {
    region: input.mutationRegion ?? "ca-central-1",
    async getCallerIdentity() {
      calls.push("mutation-caller");
      if (input.mutationCallerDenied) throw new Error("AccessDenied");
      return {
        accountId: "402010193138",
        arn:
          input.mutationCallerArn ??
          SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
      };
    },
    async deleteChangeSet(value) {
      calls.push("delete-change-set");
      deleteChangeSetRequests.push(structuredClone(value.request));
      const behavior = input.deleteChangeSetBehavior ?? "success";
      if (behavior === "success") {
        changeSetPresent = false;
        if (input.deleteChangeSetRemovesStack) state = "missing";
      }
      if (behavior === "lost_then_missing") {
        changeSetPresent = false;
        throw new Error("timeout after possible acceptance");
      }
      if (behavior === "lost_still_present") {
        throw new Error("timeout before acceptance");
      }
      input.afterDeleteChangeSet?.();
    },
    async deleteStack(value) {
      calls.push("delete-stack");
      deleteStackRequests.push(structuredClone(value.request));
      const behavior = input.deleteStackBehavior ?? "success";
      if (behavior === "success") state = "missing";
      if (behavior === "async_then_missing") {
        pendingDeletion = staleReviewReadsRemaining > 0;
        state = pendingDeletion ? "review" : "deleting";
        deletingReadsRemaining = input.deletingReadsBeforeMissing ?? 1;
      }
      if (behavior === "lost_then_missing") {
        state = "missing";
        throw new Error("timeout after possible acceptance");
      }
      if (behavior === "lost_still_present") {
        throw new Error("timeout before acceptance");
      }
      input.afterDeleteStack?.();
    },
  };

  return {
    evidence,
    authority,
    mutations,
    calls,
    deleteChangeSetRequests,
    deleteStackRequests,
    describeTargets,
    templateTargets,
    resourceTargets,
    setMissing: () => {
      state = "missing";
    },
  };
}

const signal = () => new AbortController().signal;
const noWait = async () => {};

async function inspectPlan(
  selected = fixture(),
  approvedCandidate = candidate(),
  now: () => number = () => testNow,
) {
  const inspected = await inspectSharedCellAuthorCompensation({
    evidence: selected.evidence,
    authority: selected.authority,
    candidate: approvedCandidate,
    signal: signal(),
    now,
  });
  return { inspected, selected };
}

test("J5g compensation inspect is read-only and emits a stable immutable plan", async () => {
  const firstFixture = fixture();
  const first = await inspectSharedCellAuthorCompensation({
    evidence: firstFixture.evidence,
    authority: firstFixture.authority,
    candidate: candidate(),
    signal: signal(),
  });
  const secondFixture = fixture();
  const second = await inspectSharedCellAuthorCompensation({
    evidence: secondFixture.evidence,
    authority: secondFixture.authority,
    candidate: candidate(),
    signal: signal(),
  });

  assert.equal(first.phase, "INSPECTED");
  assert.equal(first.observedState, "REVIEW_IN_PROGRESS");
  assert.equal(first.mutationPerformed, false);
  assert.equal(first.safeToAuthorRevoke, false);
  assert.equal(first.compensationPlanSha256, second.compensationPlanSha256);
  assert.match(first.compensationPlanSha256, /^[a-f0-9]{64}$/);
  assert.match(first.deleteStackClientRequestToken, /^b5-author-comp-[a-f0-9]{32}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(firstFixture.deleteChangeSetRequests, []);
  assert.deepEqual(firstFixture.deleteStackRequests, []);
});

test("J5g compensation Inspect can renew an exact CS-missing rollover window", async (t) => {
  const renewedCandidate = candidate({
    reviewedAt: new Date(testNow + 60_000).toISOString(),
    expiresAt: new Date(testNow + 60 * 60_000).toISOString(),
  });
  const renewedNow = () => testNow + 60_000;
  const present = await inspectPlan(fixture(), renewedCandidate, renewedNow);
  const missingFixture = fixture({ changeSetPresent: false });
  const missing = await inspectPlan(
    missingFixture,
    renewedCandidate,
    renewedNow,
  );
  const oldWindow = await inspectPlan(fixture(), candidate(), () => testNow);

  assert.equal(missing.inspected.phase, "INSPECTED");
  assert.equal(missing.inspected.observedState, "REVIEW_IN_PROGRESS");
  assert.equal(missing.inspected.safeToAuthorRevoke, false);
  assert.equal(missing.inspected.mutationPerformed, false);
  assert.equal(
    missing.inspected.compensationPlanSha256,
    present.inspected.compensationPlanSha256,
  );
  assert.notEqual(
    missing.inspected.compensationPlanSha256,
    oldWindow.inspected.compensationPlanSha256,
  );
  assert.deepEqual(missingFixture.deleteChangeSetRequests, []);
  assert.deepEqual(missingFixture.deleteStackRequests, []);

  await t.test("provider denial is never CS NotFound", async () => {
    const live = fixture({
      changeSetPresent: false,
      denyAt: "describeChangeSet",
    });
    await assert.rejects(
      inspectSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        candidate: renewedCandidate,
        signal: signal(),
        now: renewedNow,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_READ_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("non-exact missing proof is rejected as drift", async () => {
    const live = fixture({
      changeSetPresent: false,
      changeSetMissingEvidence: {
        state: "missing",
        changeSetArn,
        proof: "ACCESS_DENIED",
      },
    });
    await assert.rejects(
      inspectSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        candidate: renewedCandidate,
        signal: signal(),
        now: renewedNow,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
    );
  });
});

test("J5g compensation executes exact one-shot deletion in reviewed order", async () => {
  const reviewed = await inspectPlan();
  const live = fixture();
  const result = await executeReviewedSharedCellAuthorCompensation({
    evidence: live.evidence,
    authority: live.authority,
    mutations: live.mutations,
    candidate: candidate(),
    approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
    signal: signal(),
    readbackAttempts: 4,
    readbackDelayMs: 0,
    wait: noWait,
  });

  assert.equal(result.phase, "COMPENSATED");
  assert.equal(result.observedState, "MISSING");
  assert.equal(result.mutationPerformed, true);
  assert.equal(result.safeToAuthorRevoke, true);
  assert.deepEqual(live.deleteChangeSetRequests, [
    { ChangeSetName: changeSetArn, StackName: stackId },
  ]);
  assert.deepEqual(live.deleteStackRequests, [
    {
      StackName: stackId,
      DeletionMode: "STANDARD",
      ClientRequestToken: result.deleteStackClientRequestToken,
    },
  ]);
  assert.deepEqual(Object.keys(live.deleteStackRequests[0] as object).sort(), [
    "ClientRequestToken",
    "DeletionMode",
    "StackName",
  ]);
  const deleteChangeSetAt = live.calls.indexOf("delete-change-set");
  const missingChangeSetAt = live.calls.indexOf(
    "describe-change-set",
    deleteChangeSetAt + 1,
  );
  const deleteStackAt = live.calls.indexOf("delete-stack");
  const finalDescribeAt = live.calls.indexOf("describe-stack", deleteStackAt + 1);
  assert.ok(deleteChangeSetAt >= 0);
  assert.ok(missingChangeSetAt > deleteChangeSetAt);
  assert.ok(deleteStackAt > missingChangeSetAt);
  assert.ok(finalDescribeAt > deleteStackAt);
  assert.equal(live.calls.filter((call) => call === "delete-change-set").length, 1);
  assert.equal(live.calls.filter((call) => call === "delete-stack").length, 1);
  assert.equal(live.calls.includes("execute-change-set"), false);
  assert.equal(live.calls.includes("create-change-set"), false);
  assert.equal(live.calls.includes("put-item"), false);
  assert.ok(live.describeTargets.every((target) => target === stackName));
  assert.deepEqual(live.templateTargets, [
    stackId,
    stackId,
    stackId,
    stackId,
    stackName,
    stackName,
  ]);
  assert.deepEqual(live.resourceTargets, [
    stackId,
    stackId,
    stackId,
    stackId,
    stackName,
    stackName,
  ]);
});

test("J5g compensation already-missing path is stable and mutation-free", async () => {
  const reviewed = await inspectPlan(
    fixture({ initialState: "missing", changeSetPresent: false }),
  );
  assert.equal(reviewed.inspected.observedState, "MISSING");
  assert.equal(reviewed.inspected.safeToAuthorRevoke, true);
  const live = fixture({ initialState: "missing", changeSetPresent: false });
  const result = await executeReviewedSharedCellAuthorCompensation({
    evidence: live.evidence,
    authority: live.authority,
    mutations: live.mutations,
    candidate: candidate(),
    approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
    signal: signal(),
  });
  assert.equal(result.safeToAuthorRevoke, true);
  assert.equal(result.mutationPerformed, false);
  assert.equal(live.calls.filter((call) => call.startsWith("delete-")).length, 0);
  assert.equal(live.calls.filter((call) => call === "describe-stack").length, 2);
  assert.deepEqual(live.describeTargets, [stackName, stackName]);
  assert.deepEqual(live.templateTargets, [stackName, stackName]);
  assert.deepEqual(live.resourceTargets, [stackName, stackName]);
});

test("J5g compensation never treats Stack MISSING with an extant exact Change Set as safe", async () => {
  const live = fixture({ initialState: "missing", changeSetPresent: true });
  await assert.rejects(
    inspectSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: candidate(),
      signal: signal(),
      now: () => testNow,
    }),
    (error: unknown) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_MISSING_UNSTABLE" &&
      (error as { retryable?: boolean }).retryable === true,
  );
  assert.equal(live.calls.filter((call) => call === "describe-stack").length, 2);
  assert.equal(
    live.calls.filter((call) => call === "describe-change-set").length,
    2,
  );
  assert.deepEqual(live.deleteChangeSetRequests, []);
  assert.deepEqual(live.deleteStackRequests, []);
});

test("J5g compensation accepts stable name-bound disappearance after DeleteChangeSet", async () => {
  const reviewed = await inspectPlan();
  const live = fixture({ deleteChangeSetRemovesStack: true });
  const result = await executeReviewedSharedCellAuthorCompensation({
    evidence: live.evidence,
    authority: live.authority,
    mutations: live.mutations,
    candidate: candidate(),
    approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
    signal: signal(),
    readbackAttempts: 4,
    readbackDelayMs: 0,
    wait: noWait,
  });
  assert.equal(result.safeToAuthorRevoke, true);
  assert.equal(live.deleteChangeSetRequests.length, 1);
  assert.equal(live.deleteStackRequests.length, 0);
  assert.deepEqual(live.templateTargets.slice(-2), [stackName, stackName]);
  assert.deepEqual(live.resourceTargets.slice(-2), [stackName, stackName]);
});

test("J5g compensation reconciles lost mutation responses without repeating", async () => {
  const reviewed = await inspectPlan();
  const live = fixture({
    deleteChangeSetBehavior: "lost_then_missing",
    deleteStackBehavior: "lost_then_missing",
  });
  const result = await executeReviewedSharedCellAuthorCompensation({
    evidence: live.evidence,
    authority: live.authority,
    mutations: live.mutations,
    candidate: candidate(),
    approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
    signal: signal(),
    readbackAttempts: 4,
    readbackDelayMs: 0,
    wait: noWait,
  });
  assert.equal(result.safeToAuthorRevoke, true);
  assert.equal(live.deleteChangeSetRequests.length, 1);
  assert.equal(live.deleteStackRequests.length, 1);
});

test("J5g compensation leaves an uncertain still-present mutation blocked", async (t) => {
  const reviewed = await inspectPlan();

  await t.test("Change Set delete uncertainty never reaches DeleteStack", async () => {
    const live = fixture({ deleteChangeSetBehavior: "lost_still_present" });
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: candidate(),
        approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
        signal: signal(),
        readbackAttempts: 2,
        readbackDelayMs: 0,
        wait: noWait,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DELETE_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
    assert.equal(live.deleteChangeSetRequests.length, 1);
    assert.equal(live.deleteStackRequests.length, 0);
  });

  await t.test("Stack delete uncertainty never repeats DeleteStack", async () => {
    const live = fixture({ deleteStackBehavior: "lost_still_present" });
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: candidate(),
        approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
        signal: signal(),
        readbackAttempts: 2,
        readbackDelayMs: 0,
        wait: noWait,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DELETE_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
    assert.equal(live.deleteStackRequests.length, 1);
  });
});

test("J5g compensation reports post-submit aborts without blind replay", async (t) => {
  const reviewed = await inspectPlan();

  await t.test("DeleteChangeSet abort resumes from fresh exact inspection", async () => {
    const controller = new AbortController();
    const live = fixture({
      afterDeleteChangeSet: () => controller.abort(),
    });
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: candidate(),
        approvedCompensationPlanSha256:
          reviewed.inspected.compensationPlanSha256,
        signal: controller.signal,
        now: () => testNow,
        readbackAttempts: 4,
        readbackDelayMs: 0,
        wait: noWait,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
    assert.equal(live.deleteChangeSetRequests.length, 1);
    assert.equal(live.deleteStackRequests.length, 0);

    const resumed = await inspectSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: candidate(),
      signal: signal(),
      now: () => testNow,
    });
    assert.equal(resumed.observedState, "REVIEW_IN_PROGRESS");
    const result = await executeReviewedSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      mutations: live.mutations,
      candidate: candidate(),
      approvedCompensationPlanSha256: resumed.compensationPlanSha256,
      signal: signal(),
      now: () => testNow,
      readbackAttempts: 4,
      readbackDelayMs: 0,
      wait: noWait,
    });
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(live.deleteChangeSetRequests.length, 1);
    assert.equal(live.deleteStackRequests.length, 1);
  });

  await t.test(
    "DeleteChangeSet readback abort after a normal delegate return stays uncertain",
    async () => {
      const controller = new AbortController();
      const live = fixture({
        deleteChangeSetBehavior: "accepted_still_present",
      });
      await assert.rejects(
        executeReviewedSharedCellAuthorCompensation({
          evidence: live.evidence,
          authority: live.authority,
          mutations: live.mutations,
          candidate: candidate(),
          approvedCompensationPlanSha256:
            reviewed.inspected.compensationPlanSha256,
          signal: controller.signal,
          now: () => testNow,
          readbackAttempts: 4,
          readbackDelayMs: 0,
          wait: async (_delayMs, waitSignal) => {
            assert.equal(waitSignal, controller.signal);
            controller.abort();
          },
        }),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code ===
            "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN" &&
          (error as { retryable?: boolean }).retryable === true,
      );
      assert.equal(live.deleteChangeSetRequests.length, 1);
      assert.equal(live.deleteStackRequests.length, 0);
    },
  );

  await t.test("DeleteStack abort is reconciled by read-only Recover", async () => {
    const controller = new AbortController();
    const live = fixture({
      changeSetPresent: false,
      afterDeleteStack: () => controller.abort(),
    });
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: candidate(),
        approvedCompensationPlanSha256:
          reviewed.inspected.compensationPlanSha256,
        signal: controller.signal,
        now: () => testNow,
        readbackAttempts: 4,
        readbackDelayMs: 0,
        wait: noWait,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
    assert.equal(live.deleteChangeSetRequests.length, 0);
    assert.equal(live.deleteStackRequests.length, 1);

    const recovered = await recoverSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: candidate(),
      approvedCompensationPlanSha256:
        reviewed.inspected.compensationPlanSha256,
      signal: signal(),
      now: () => testNow,
    });
    assert.equal(recovered.safeToAuthorRevoke, true);
    assert.equal(recovered.mutationPerformed, false);
    assert.equal(live.deleteStackRequests.length, 1);
  });

  await t.test(
    "DeleteStack readback abort after a normal delegate return stays uncertain",
    async () => {
      const controller = new AbortController();
      const live = fixture({
        changeSetPresent: false,
        deleteStackBehavior: "async_then_missing",
        deletingReadsBeforeMissing: 10,
      });
      await assert.rejects(
        executeReviewedSharedCellAuthorCompensation({
          evidence: live.evidence,
          authority: live.authority,
          mutations: live.mutations,
          candidate: candidate(),
          approvedCompensationPlanSha256:
            reviewed.inspected.compensationPlanSha256,
          signal: controller.signal,
          now: () => testNow,
          readbackAttempts: 4,
          readbackDelayMs: 0,
          wait: async (_delayMs, waitSignal) => {
            assert.equal(waitSignal, controller.signal);
            controller.abort();
          },
        }),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code ===
            "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN" &&
          (error as { retryable?: boolean }).retryable === true,
      );
      assert.equal(live.deleteChangeSetRequests.length, 0);
      assert.equal(live.deleteStackRequests.length, 1);
    },
  );
});

test("J5g compensation handles real asynchronous DeleteStack without replay", async () => {
  const reviewed = await inspectPlan();
  const live = fixture({
    deleteStackBehavior: "async_then_missing",
    deletingReadsBeforeMissing: 2,
    staleReviewReadsAfterDeleteStack: 2,
    resourcePresenceReadsAfterStackMissing: 1,
  });
  const result = await executeReviewedSharedCellAuthorCompensation({
    evidence: live.evidence,
    authority: live.authority,
    mutations: live.mutations,
    candidate: candidate(),
    approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
    signal: signal(),
    now: () => testNow,
    readbackAttempts: 10,
    readbackDelayMs: 0,
    wait: noWait,
  });
  assert.equal(result.safeToAuthorRevoke, true);
  assert.equal(live.deleteChangeSetRequests.length, 1);
  assert.equal(live.deleteStackRequests.length, 1);
  assert.ok(
    live.describeTargets.filter((target) => target === stackName).length >= 4,
  );
});

test("J5g compensation Execute resumes exact partial states without replay", async (t) => {
  const reviewed = await inspectPlan();

  await t.test("missing Change Set skips directly to one DeleteStack", async () => {
    const live = fixture({ changeSetPresent: false });
    const result = await executeReviewedSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      mutations: live.mutations,
      candidate: candidate(),
      approvedCompensationPlanSha256:
        reviewed.inspected.compensationPlanSha256,
      signal: signal(),
      now: () => testNow,
      readbackAttempts: 4,
      readbackDelayMs: 0,
      wait: noWait,
    });
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(live.deleteChangeSetRequests.length, 0);
    assert.equal(live.deleteStackRequests.length, 1);
  });

  await t.test("DELETE_IN_PROGRESS only polls stable name-bound MISSING", async () => {
    const live = fixture({
      initialState: "deleting",
      changeSetPresent: false,
      deletingReadsBeforeMissing: 1,
    });
    const result = await executeReviewedSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      mutations: live.mutations,
      candidate: candidate(),
      approvedCompensationPlanSha256:
        reviewed.inspected.compensationPlanSha256,
      signal: signal(),
      now: () => testNow,
      readbackAttempts: 4,
      readbackDelayMs: 0,
      wait: noWait,
    });
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(result.mutationPerformed, false);
    assert.equal(live.deleteChangeSetRequests.length, 0);
    assert.equal(live.deleteStackRequests.length, 0);
  });
});

test("J5g compensation recovery is read-only and only stable MISSING is safe", async (t) => {
  const reviewed = await inspectPlan();

  await t.test("stable MISSING is SAFE_TO_AUTHOR_REVOKE", async () => {
    const live = fixture({ initialState: "missing", changeSetPresent: false });
    const result = await recoverSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: candidate(),
      approvedCompensationPlanSha256: reviewed.inspected.compensationPlanSha256,
      signal: signal(),
    });
    assert.equal(result.phase, "RECOVERED");
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(result.mutationPerformed, false);
    assert.equal(live.calls.some((call) => call.startsWith("delete-")), false);
  });

  for (const changeSetPresent of [true, false]) {
    await t.test(
      `review placeholder is retryably blocked when Change Set is ${
        changeSetPresent ? "present" : "missing"
      }`,
      async () => {
        const live = fixture({ changeSetPresent });
        await assert.rejects(
          recoverSharedCellAuthorCompensation({
            evidence: live.evidence,
            authority: live.authority,
            candidate: candidate(),
            approvedCompensationPlanSha256:
              reviewed.inspected.compensationPlanSha256,
            signal: signal(),
          }),
          (error: unknown) =>
            (error as { code?: string; retryable?: boolean }).code ===
              "SHARED_CELL_AUTHOR_COMPENSATION_RECOVERY_BLOCKED" &&
            (error as { retryable?: boolean }).retryable === true,
        );
        assert.equal(live.calls.some((call) => call.startsWith("delete-")), false);
      },
    );
  }

  await t.test("DELETE_IN_PROGRESS is polled read-only to stable MISSING", async () => {
    const live = fixture({
      initialState: "deleting",
      changeSetPresent: false,
      deletingReadsBeforeMissing: 2,
    });
    const result = await recoverSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: candidate(),
      approvedCompensationPlanSha256:
        reviewed.inspected.compensationPlanSha256,
      signal: signal(),
      readbackAttempts: 5,
      readbackDelayMs: 0,
      wait: noWait,
    });
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(result.mutationPerformed, false);
    assert.equal(live.calls.some((call) => call.startsWith("delete-")), false);
  });

  await t.test("malformed optional clock is rejected before provider reads", async () => {
    const live = fixture({ initialState: "missing", changeSetPresent: false });
    await assert.rejects(
      recoverSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        candidate: candidate(),
        approvedCompensationPlanSha256:
          reviewed.inspected.compensationPlanSha256,
        signal: signal(),
        now: 42 as unknown as () => number,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_CLOCK_INVALID",
    );
    assert.deepEqual(live.calls, []);
  });
});

test("J5g compensation rejects drift, resources, active state, and present authority", async (t) => {
  const cases: [string, ReturnType<typeof fixture>, string][] = [
    [
      "Change Set template binding drift",
      fixture({
        changeSetDrift(value) {
          value.changeSet.templateUrl = "https://example.invalid/drift";
        },
      }),
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
    ],
    [
      "Stack ownership tag drift",
      fixture({ stackTagDrift: true }),
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
    ],
    [
      "nonzero resources",
      fixture({ resources: [{ LogicalResourceId: "Unexpected" }] }),
      "SHARED_CELL_AUTHOR_COMPENSATION_RESOURCES_PRESENT",
    ],
    [
      "active Stack status",
      fixture({ initialState: "active" }),
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
    ],
    [
      "ordinary Inspect cannot accept DELETE_IN_PROGRESS",
      fixture({ initialState: "deleting", deletingReadsBeforeMissing: 10 }),
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
    ],
    [
      "placeholder RoleARN drift",
      fixture({ stackRoleArn: null }),
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
    ],
    [
      "strong authority present",
      fixture({ authorityPresent: true }),
      "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_PRESENT",
    ],
  ];
  for (const [name, selected, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        inspectSharedCellAuthorCompensation({
          evidence: selected.evidence,
          authority: selected.authority,
          candidate: candidate(),
          signal: signal(),
        }),
        (error: unknown) => (error as { code?: string }).code === code,
      );
      assert.deepEqual(selected.deleteChangeSetRequests, []);
      assert.deepEqual(selected.deleteStackRequests, []);
    });
  }
});

test("J5g compensation enforces the exact absent-authority revision invariant", async (t) => {
  const malformed = [
    { authorityKey: "cell:cell-sandbox-1", revision: 1, item: null },
    { authorityKey: "cell:cell-sandbox-1", revision: 0, item: { state: "x" } },
    { authorityKey: "cell:cell-sandbox-1", revision: -1, item: null },
    { authorityKey: "cell:cell-sandbox-1", revision: 0.5, item: null },
  ];
  for (const snapshot of malformed) {
    await t.test(JSON.stringify(snapshot), async () => {
      const live = fixture({ authoritySnapshot: snapshot });
      await assert.rejects(
        inspectSharedCellAuthorCompensation({
          evidence: live.evidence,
          authority: live.authority,
          candidate: candidate(),
          signal: signal(),
          now: () => testNow,
        }),
        (error: unknown) =>
          (error as { code?: string }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_INVALID",
      );
      assert.equal(live.calls.includes("describe-stack"), false);
    });
  }
});

test("J5g compensation grant is immutable, bounded, and phase-margin checked", async (t) => {
  const alternate = candidate({
    reviewedAt: new Date(testNow - 30_000).toISOString(),
    expiresAt: grantExpiresAt,
  });
  const first = await inspectPlan(fixture(), candidate(), () => testNow);
  const second = await inspectPlan(fixture(), alternate, () => testNow);
  assert.notEqual(
    first.inspected.compensationPlanSha256,
    second.inspected.compensationPlanSha256,
  );
  assert.equal(
    first.inspected.deleteStackClientRequestToken,
    second.inspected.deleteStackClientRequestToken,
  );

  await t.test("more than 60 minutes is malformed", async () => {
    const live = fixture();
    await assert.rejects(
      inspectSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        candidate: candidate({
          reviewedAt: new Date(testNow - 1_000).toISOString(),
          expiresAt: new Date(testNow + 60 * 60_000).toISOString(),
        }),
        signal: signal(),
        now: () => testNow,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
    );
    assert.deepEqual(live.calls, []);
  });

  await t.test("Inspect requires ten minutes remaining", async () => {
    const live = fixture();
    await assert.rejects(
      inspectSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        candidate: candidate({
          reviewedAt: new Date(testNow - 60_000).toISOString(),
          expiresAt: new Date(testNow + 9 * 60_000).toISOString(),
        }),
        signal: signal(),
        now: () => testNow,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
    );
    assert.deepEqual(live.calls, []);
  });

  const shortCandidate = candidate({
    reviewedAt: new Date(testNow - 20 * 60_000).toISOString(),
    expiresAt: new Date(testNow + 7 * 60_000).toISOString(),
  });
  const shortPlan = await inspectPlan(
    fixture(),
    shortCandidate,
    () => testNow - 10 * 60_000,
  );

  await t.test("DeleteChangeSet requires ten minutes remaining", async () => {
    const live = fixture();
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: shortCandidate,
        approvedCompensationPlanSha256:
          shortPlan.inspected.compensationPlanSha256,
        signal: signal(),
        now: () => testNow,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
    );
    assert.equal(live.deleteChangeSetRequests.length, 0);
    assert.equal(live.deleteStackRequests.length, 0);
  });

  await t.test(
    "final margin check runs after async mutation identity and authority reads",
    async () => {
      const tightCandidate = candidate({
        reviewedAt: new Date(testNow - 60_000).toISOString(),
        expiresAt: new Date(testNow + 11 * 60_000).toISOString(),
      });
      const tightPlan = await inspectPlan(
        fixture(),
        tightCandidate,
        () => testNow,
      );
      const live = fixture();
      const values = [testNow, testNow, testNow + 2 * 60_000];
      await assert.rejects(
        executeReviewedSharedCellAuthorCompensation({
          evidence: live.evidence,
          authority: live.authority,
          mutations: live.mutations,
          candidate: tightCandidate,
          approvedCompensationPlanSha256:
            tightPlan.inspected.compensationPlanSha256,
          signal: signal(),
          now: () => values.shift() ?? testNow + 2 * 60_000,
          readbackAttempts: 4,
          readbackDelayMs: 0,
          wait: noWait,
        }),
        (error: unknown) =>
          (error as { code?: string }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
      );
      assert.equal(live.calls.includes("mutation-caller"), true);
      assert.equal(
        live.calls.lastIndexOf("authority") >
          live.calls.indexOf("mutation-caller"),
        true,
      );
      assert.deepEqual(live.deleteChangeSetRequests, []);
      assert.deepEqual(live.deleteStackRequests, []);
    },
  );

  await t.test("CS-missing resume can use the five-minute Stack margin", async () => {
    const live = fixture({ changeSetPresent: false });
    const result = await executeReviewedSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      mutations: live.mutations,
      candidate: shortCandidate,
      approvedCompensationPlanSha256:
        shortPlan.inspected.compensationPlanSha256,
      signal: signal(),
      now: () => testNow,
      readbackAttempts: 4,
      readbackDelayMs: 0,
      wait: noWait,
    });
    assert.equal(result.safeToAuthorRevoke, true);
    assert.equal(live.deleteChangeSetRequests.length, 0);
    assert.equal(live.deleteStackRequests.length, 1);
  });

  await t.test("expiry during Change Set reconciliation blocks DeleteStack", async () => {
    const live = fixture();
    const values = [
      testNow,
      testNow,
      testNow,
      Date.parse(grantExpiresAt) - 4 * 60_000,
    ];
    await assert.rejects(
      executeReviewedSharedCellAuthorCompensation({
        evidence: live.evidence,
        authority: live.authority,
        mutations: live.mutations,
        candidate: candidate(),
        approvedCompensationPlanSha256:
          first.inspected.compensationPlanSha256,
        signal: signal(),
        now: () => values.shift() ?? testNow,
        readbackAttempts: 4,
        readbackDelayMs: 0,
        wait: noWait,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
    );
    assert.equal(live.deleteChangeSetRequests.length, 1);
    assert.equal(live.deleteStackRequests.length, 0);
  });

  await t.test("read-only Recover ignores an expired grant", async () => {
    const live = fixture({ initialState: "missing", changeSetPresent: false });
    const result = await recoverSharedCellAuthorCompensation({
      evidence: live.evidence,
      authority: live.authority,
      candidate: shortCandidate,
      approvedCompensationPlanSha256:
        shortPlan.inspected.compensationPlanSha256,
      signal: signal(),
      now: () => Date.parse(shortCandidate.compensationGrant.expiresAt) + 1,
    });
    assert.equal(result.safeToAuthorRevoke, true);
  });
});

test("J5g compensation never interprets any denied evidence read as absence", async (t) => {
  const deniedReads = [
    "describeStack",
    "getTemplate",
    "listResources",
    "describeChangeSet",
  ] as const;
  for (const denyAt of deniedReads) {
    await t.test(denyAt, async () => {
      const selected = fixture({ denyAt });
      await assert.rejects(
        inspectSharedCellAuthorCompensation({
          evidence: selected.evidence,
          authority: selected.authority,
          candidate: candidate(),
          signal: signal(),
          now: () => testNow,
        }),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code ===
            "SHARED_CELL_AUTHOR_COMPENSATION_READ_UNCERTAIN" &&
          (error as { retryable?: boolean }).retryable === true,
      );
      assert.deepEqual(selected.deleteChangeSetRequests, []);
      assert.deepEqual(selected.deleteStackRequests, []);
    });
  }
});

test("J5g compensation pins mutation region, caller, and fresh authority before writing", async (t) => {
  const reviewed = await inspectPlan(fixture(), candidate(), () => testNow);
  const cases: [string, ReturnType<typeof fixture>, string][] = [
    [
      "wrong mutation region",
      fixture({ mutationRegion: "us-east-1" }),
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
    ],
    [
      "wrong mutation caller",
      fixture({
        mutationCallerArn:
          "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/wrong-session",
      }),
      "SHARED_CELL_AUTHOR_COMPENSATION_MUTATION_CALLER_INVALID",
    ],
    [
      "mutation caller read denied",
      fixture({ mutationCallerDenied: true }),
      "SHARED_CELL_AUTHOR_COMPENSATION_READ_UNCERTAIN",
    ],
    [
      "authority reappears after mutation identity read",
      fixture({ authorityBecomesPresentOnMutationCaller: true }),
      "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_PRESENT",
    ],
  ];
  for (const [name, live, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        executeReviewedSharedCellAuthorCompensation({
          evidence: live.evidence,
          authority: live.authority,
          mutations: live.mutations,
          candidate: candidate(),
          approvedCompensationPlanSha256:
            reviewed.inspected.compensationPlanSha256,
          signal: signal(),
          now: () => testNow,
          readbackAttempts: 4,
          readbackDelayMs: 0,
          wait: noWait,
        }),
        (error: unknown) => (error as { code?: string }).code === code,
      );
      assert.deepEqual(live.deleteChangeSetRequests, []);
      assert.deepEqual(live.deleteStackRequests, []);
    });
  }
});

test("J5g compensation rejects wrong caller before reading the Cell", async () => {
  const selected = fixture({
    callerArn:
      "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/wrong-session",
  });
  await assert.rejects(
    inspectSharedCellAuthorCompensation({
      evidence: selected.evidence,
      authority: selected.authority,
      candidate: candidate(),
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_AUTHOR_COMPENSATION_CALLER_INVALID",
  );
  assert.deepEqual(selected.calls, ["caller"]);
});

test("J5g compensation rejects plan mismatch before all provider calls", async () => {
  const selected = fixture();
  await assert.rejects(
    executeReviewedSharedCellAuthorCompensation({
      evidence: selected.evidence,
      authority: selected.authority,
      mutations: selected.mutations,
      candidate: candidate(),
      approvedCompensationPlanSha256: "0".repeat(64),
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_AUTHOR_COMPENSATION_PLAN_MISMATCH",
  );
  assert.deepEqual(selected.calls, []);
});

test("J5g compensation honors an already-aborted signal without provider calls", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  const selected = fixture();
  await assert.rejects(
    inspectSharedCellAuthorCompensation({
      evidence: selected.evidence,
      authority: selected.authority,
      candidate: candidate(),
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
  assert.deepEqual(selected.calls, []);
});

test("J5g compensation candidate contract pins every immutable field", async (t) => {
  const mutations: [string, (value: SharedCellAuthorCompensationCandidate) => void][] = [
    ["account", (value) => ((value as { accountId: string }).accountId = "000000000000")],
    ["StackId", (value) => (value.stackId = "not-a-stack-id")],
    ["raw digest", (value) => (value.immutableTemplate.rawSha256 = "f".repeat(64))],
    ["capabilities", (value) => ((value.changeSet.capabilities as string[]).push("CAPABILITY_IAM"))],
    ["nested", (value) => ((value.changeSet as { includeNestedStacks: boolean }).includeNestedStacks = true)],
    ["resource type", (value) => ((value.changeSet.resourceTypes as string[])[0] = "AWS::S3::Bucket")],
    ["parameter order", (value) => (value.changeSet.parameters as SharedCellAuthorCompensationCandidate["changeSet"]["parameters"] as SharedCellAuthorCompensationCandidate["changeSet"]["parameters"] & unknown[]).reverse()],
    [
      "sparse parameters",
      (value) => {
        delete (value.changeSet.parameters as unknown[])[1];
      },
    ],
    [
      "sparse tags",
      (value) => {
        delete (value.changeSet.tags as unknown[])[1];
      },
    ],
    ["tag value", (value) => ((value.changeSet.tags[0] as { Value: string }).Value = "production")],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const selected = fixture();
      const value = candidate();
      mutate(value);
      await assert.rejects(
        inspectSharedCellAuthorCompensation({
          evidence: selected.evidence,
          authority: selected.authority,
          candidate: value,
          signal: signal(),
        }),
        (error: unknown) =>
          (error as { code?: string }).code ===
          "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      );
      assert.deepEqual(selected.calls, []);
    });
  }
});
