import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  compileSharedCellAuthorCompensationControllerContract,
  executeClaimedSharedCellAuthorCompensationPhase,
  inspectAndReviewSharedCellAuthorCompensationPhase,
  recoverClaimedSharedCellAuthorCompensationPhase,
  SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_DEFAULT_ENABLED,
  SharedCellAuthorCompensationControllerError,
} from "../lib/deployments/execution/shared-cell-author-compensation-controller.ts";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
  SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES,
  SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
  type SharedCellAuthorCompensationCandidate,
  type SharedCellAuthorCompensationPhase,
  type SharedCellAuthorCompensationReadPort,
  type SharedCellAuthorDeleteChangeSetMutationPort,
  type StrongSharedCellAuthorAuthorityReadPort,
} from "../lib/deployments/execution/shared-cell-author-compensation.ts";
import type {
  SharedCellAuthorCompensationClaim,
  SharedCellAuthorCompensationClaimHandle,
  SharedCellAuthorCompensationMutationRequest,
  SharedCellAuthorCompensationOperation,
  SharedCellAuthorCompensationOperationSnapshot,
  SharedCellAuthorCompensationOperationStore,
  SharedCellAuthorCompensationPhaseAttempt,
  SharedCellAuthorCompensationPhaseCompletionReceipt,
  SharedCellAuthorCompensationPhaseGrantReceipt,
  SharedCellAuthorCompensationReviewWindow,
  SharedCellAuthorCompensationSubmissionReceipt,
} from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";
import { sharedCellAuthorCompensationReceiptSha256 } from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";

const stackName = "techlong-sandbox-cell-sandbox-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${stackName}/12345678-1234-4234-8234-123456789012`;
const rawSha256 = "1".repeat(64);
const changeSetTemplateBody = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: Object.fromEntries(
    SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES.map((resourceType, index) => [
      `ReviewedResource${String(index + 1).padStart(2, "0")}`,
      { Type: resourceType, Properties: {} },
    ]),
  ),
};
const canonicalSha256 = createHash("sha256")
  .update(canonicalJson(changeSetTemplateBody), "utf8")
  .digest("hex");
const changeSetName = `${stackName}-${rawSha256.slice(0, 16)}`;
const changeSetArn =
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
  `${changeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
const testNow = Date.parse("2026-09-28T12:00:00.000Z");
const observedAt = "2026-09-28T12:01:00.000Z";

function candidate(input: { expiresAt?: string } = {}): SharedCellAuthorCompensationCandidate {
  return {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    stackName,
    stackId,
    compensationGrant: {
      reviewedAt: "2026-09-28T11:59:00.000Z",
      expiresAt: input.expiresAt ?? "2026-09-28T12:59:00.000Z",
    },
    immutableTemplate: {
      url:
        "https://techlong-sandbox-build-source-402010193138-ca-central-1." +
        `s3.ca-central-1.amazonaws.com/b5-shared-cell/templates/sha256/${rawSha256}.json`,
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
        { ParameterKey: "CleanupAt", ParameterValue: "2026-09-28T15:00:00" },
      ],
      tags: [
        { Key: "Environment", Value: "aws-sandbox" },
        { Key: "ManagedBy", Value: "techlong-cell-operator" },
        { Key: "CellId", Value: "cell-sandbox-1" },
        { Key: "ExpiresAt", Value: "2026-09-28T15:00:00.000Z" },
      ],
    },
  };
}

function changeSetEvidence(source: SharedCellAuthorCompensationCandidate) {
  return {
    state: "present",
    changeSet: {
      changeSetName: source.changeSet.name,
      changeSetArn: source.changeSet.arn,
      stackName: source.stackName,
      stackId: source.stackId,
      description: "Reviewed compensation controller candidate",
      status: "CREATE_COMPLETE",
      executionStatus: "AVAILABLE",
      capabilities: [],
      includeNestedStacks: false,
      parameters: structuredClone(source.changeSet.parameters),
      tags: structuredClone(source.changeSet.tags),
      notificationArns: [],
      parentChangeSetId: null,
      rootChangeSetId: null,
      onStackFailure: "DELETE",
      importExistingResources: false,
      changes: Object.entries(changeSetTemplateBody.Resources).map(
        ([logicalResourceId, resource]) => ({
          type: "Resource",
          action: "Add",
          logicalResourceId,
          resourceType: resource.Type,
        }),
      ),
    },
  };
}

function evidenceFixture(
  source: SharedCellAuthorCompensationCandidate,
  input: { changeSetPresent?: boolean; stackMissing?: boolean } = {},
) {
  let stackMissing = input.stackMissing ?? false;
  let changeSetPresent = input.changeSetPresent ?? !stackMissing;
  const calls: string[] = [];
  const evidence: SharedCellAuthorCompensationReadPort = {
    region: "ca-central-1",
    async getCallerIdentity() {
      calls.push("evidence-caller");
      return {
        accountId: "402010193138",
        arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
      };
    },
    async describeStack() {
      calls.push("describe-stack");
      if (stackMissing) {
        return {
          state: "missing",
          stackName: source.stackName,
          proof: "NAME_BOUND_VALIDATION_ERROR",
        };
      }
      return {
        state: "present",
        stack: {
          stackName: source.stackName,
          stackId: source.stackId,
          stackStatus: "REVIEW_IN_PROGRESS",
          tags: structuredClone(source.changeSet.tags),
          terminationProtection: false,
          roleArn: source.changeSet.roleArn,
          parentId: null,
          rootId: null,
        },
      };
    },
    async getOriginalTemplate(value) {
      calls.push("get-original-template");
      return {
        state: "missing",
        stackNameOrId: stackMissing ? source.stackName : value.stackNameOrId,
        proof: "NAME_BOUND_VALIDATION_ERROR",
      };
    },
    async listStackResourcesPage() {
      calls.push("list-resources");
      return stackMissing
        ? {
            state: "missing",
            stackNameOrId: source.stackName,
            proof: "NAME_BOUND_VALIDATION_ERROR",
          }
        : { resources: [], nextToken: null };
    },
    async describeChangeSet() {
      calls.push("describe-change-set");
      return changeSetPresent
        ? changeSetEvidence(source)
        : {
            state: "missing",
            changeSetArn: source.changeSet.arn,
            proof: "ARN_BOUND_CHANGE_SET_NOT_FOUND",
          };
    },
    async getChangeSetTemplate() {
      calls.push("get-change-set-template");
      return {
        state: "present",
        changeSetArn: source.changeSet.arn,
        stackId: source.stackId,
        templateBody: structuredClone(changeSetTemplateBody),
      };
    },
  };
  const authority: StrongSharedCellAuthorAuthorityReadPort = {
    async readStrong() {
      calls.push("authority");
      return {
        authorityKey: "cell:cell-sandbox-1",
        revision: 0,
        item: null,
      };
    },
  };
  return {
    evidence,
    authority,
    calls,
    setChangeSetPresent(value: boolean) {
      changeSetPresent = value;
    },
    setStackMissing(value: boolean) {
      stackMissing = value;
      if (value) changeSetPresent = false;
    },
  };
}

type Contract = Awaited<
  ReturnType<typeof compileSharedCellAuthorCompensationControllerContract>
>;

class FakeStore implements SharedCellAuthorCompensationOperationStore {
  readonly calls: string[] = [];
  readonly preparedHandles: SharedCellAuthorCompensationClaimHandle[] = [];
  readonly releasedHandles: SharedCellAuthorCompensationClaimHandle[] = [];
  readonly releaseSignalsAborted: boolean[] = [];
  rejectBegin = false;
  corruptPreparedSnapshot = false;
  snapshot: SharedCellAuthorCompensationOperationSnapshot;
  private contract: Contract;
  private candidate: SharedCellAuthorCompensationCandidate;

  constructor(
    source: SharedCellAuthorCompensationCandidate,
    contract: Contract,
    reviewed = true,
  ) {
    this.candidate = structuredClone(source);
    this.contract = contract;
    const operation: SharedCellAuthorCompensationOperation = {
      schemaVersion: 1,
      operationSha256: contract.operationSha256,
      environmentId: "aws-sandbox",
      accountId: source.accountId,
      region: source.region,
      stackName: source.stackName,
      stackId: source.stackId,
      changeSetArn: source.changeSet.arn,
      operationIntent: {},
      deleteStackClientRequestToken:
        contract.exactMutation.phase === "DELETE_STACK"
          ? contract.exactMutation.request.ClientRequestToken
          : `b5-author-comp-${contract.operationSha256.slice(0, 32)}`,
      state: reviewed
        ? contract.phase === "DELETE_CHANGE_SET"
          ? "delete_change_set_prepared"
          : "delete_stack_prepared"
        : "awaiting_delete_change_set_review",
      currentPhase: reviewed ? contract.phase : null,
      currentWindowNumber: reviewed ? 1 : null,
      currentAttemptNumber: null,
      currentGrantReceiptSha256: null,
      stateRevision: reviewed ? 2 : 1,
      leaseOwner: null,
      claimToken: null,
      leaseAttempt: 0,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorSha256: null,
      createdAt: testNow,
      updatedAt: testNow,
      completedAt: null,
    };
    this.snapshot = {
      operation,
      currentWindow: reviewed ? this.window(1) : null,
      currentAttempt: null,
    };
  }

  private window(windowNumber: number): SharedCellAuthorCompensationReviewWindow {
    return {
      operationSha256: this.contract.operationSha256,
      phase: this.contract.phase,
      windowNumber,
      candidate: structuredClone(this.candidate),
      compensationPlanSha256: this.contract.compensationPlanSha256,
      phasePlanSha256: this.contract.phasePlanSha256,
      controllerContractSha256: this.contract.controllerContractSha256,
      reviewedAt: Date.parse(this.candidate.compensationGrant.reviewedAt),
      expiresAt: Date.parse(this.candidate.compensationGrant.expiresAt),
      createdAt: testNow,
    };
  }

  private operation(
    patch: Partial<SharedCellAuthorCompensationOperation>,
  ): SharedCellAuthorCompensationOperation {
    return { ...this.snapshot.operation, ...patch };
  }

  private handle(workerId = "controller-test"): SharedCellAuthorCompensationClaimHandle {
    return {
      operationSha256: this.contract.operationSha256,
      workerId,
      claimToken: `scac_${"a".repeat(32)}`,
      leaseAttempt: Math.max(1, this.snapshot.operation.leaseAttempt),
      stateRevision: this.snapshot.operation.stateRevision,
      leaseExpiresAt: testNow + 60_000,
    };
  }

  async createOrLoadOperation(): Promise<Readonly<{
    outcome: "created" | "existing";
    snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  }>> {
    this.calls.push("create-or-load");
    return { outcome: "created", snapshot: this.snapshot };
  }

  async appendReviewedWindow(input: {
    phase: SharedCellAuthorCompensationPhase;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    this.calls.push("append-window");
    const revision = this.snapshot.operation.stateRevision + 1;
    this.snapshot = {
      operation: this.operation({
        state:
          input.phase === "DELETE_CHANGE_SET"
            ? "delete_change_set_prepared"
            : "delete_stack_prepared",
        currentPhase: input.phase,
        currentWindowNumber: 1,
        stateRevision: revision,
        updatedAt: testNow,
      }),
      currentWindow: this.window(1),
      currentAttempt: null,
    };
    return this.snapshot;
  }

  async claimExactOperation(input: {
    workerId: string;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    this.calls.push("claim");
    const recoverOnly = this.snapshot.operation.state.endsWith("recover_only");
    const revision = this.snapshot.operation.stateRevision + 1;
    this.snapshot = {
      ...this.snapshot,
      operation: this.operation({
        stateRevision: revision,
        leaseOwner: input.workerId,
        claimToken: `scac_${"a".repeat(32)}`,
        leaseAttempt: this.snapshot.operation.leaseAttempt + 1,
        leaseExpiresAt: testNow + 60_000,
      }),
    };
    return {
      mode: recoverOnly ? "RECOVER_ONLY" : "PREPARE",
      handle: this.handle(input.workerId),
      snapshot: this.snapshot,
    };
  }

  async preparePhase(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    this.calls.push("prepare");
    const revision = this.snapshot.operation.stateRevision + 1;
    this.snapshot = {
      ...this.snapshot,
      operation: this.operation({
        state:
          this.corruptPreparedSnapshot
            ? this.contract.phase === "DELETE_CHANGE_SET"
              ? "delete_change_set_prepared"
              : "delete_stack_prepared"
            : this.contract.phase === "DELETE_CHANGE_SET"
            ? "delete_change_set_ready"
            : "delete_stack_ready",
        currentGrantReceiptSha256:
          await sharedCellAuthorCompensationReceiptSha256(input.grantReceipt),
        stateRevision: revision,
      }),
    };
    const handle = { ...input.handle, stateRevision: revision };
    this.preparedHandles.push(structuredClone(handle));
    return {
      mode: "PREPARE",
      handle,
      snapshot: this.snapshot,
    };
  }

  async beginSubmission(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    mutation: SharedCellAuthorCompensationMutationRequest;
  }): Promise<Readonly<SharedCellAuthorCompensationSubmissionReceipt> | null> {
    this.calls.push("begin-submission");
    if (this.rejectBegin) return null;
    const revision = this.snapshot.operation.stateRevision + 1;
    const attemptNumber = 1;
    const requestSha256 = await createHash("sha256")
      .update(canonicalJson(input.mutation), "utf8")
      .digest("hex");
    const attempt: SharedCellAuthorCompensationPhaseAttempt = {
      operationSha256: this.contract.operationSha256,
      phase: this.contract.phase,
      attemptNumber,
      windowNumber: 1,
      status: "recover_only",
      request: structuredClone(input.mutation),
      requestSha256,
      clientRequestToken:
        input.mutation.phase === "DELETE_STACK"
          ? input.mutation.request.ClientRequestToken
          : null,
      leaseAttempt: input.handle.leaseAttempt,
      preparedRevision: input.handle.stateRevision,
      completionReceipt: null,
      completionReceiptSha256: null,
      startedAt: testNow,
      updatedAt: testNow,
      completedAt: null,
    };
    this.snapshot = {
      operation: this.operation({
        state:
          this.contract.phase === "DELETE_CHANGE_SET"
            ? "delete_change_set_recover_only"
            : "delete_stack_recover_only",
        currentAttemptNumber: attemptNumber,
        stateRevision: revision,
      }),
      currentWindow: this.snapshot.currentWindow,
      currentAttempt: attempt,
    };
    const handle = { ...input.handle, stateRevision: revision };
    return { handle, attemptNumber, requestSha256, snapshot: this.snapshot };
  }

  async completePhase(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    completionReceipt: SharedCellAuthorCompensationPhaseCompletionReceipt;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    this.calls.push("complete");
    const revision = this.snapshot.operation.stateRevision + 1;
    const attempt = this.snapshot.currentAttempt;
    assert.ok(attempt);
    const completionReceiptSha256 =
      await sharedCellAuthorCompensationReceiptSha256(input.completionReceipt);
    this.snapshot = {
      operation: this.operation({
        state:
          this.contract.phase === "DELETE_CHANGE_SET"
            ? "delete_change_set_revoke_required"
            : "delete_stack_revoke_required",
        stateRevision: revision,
      }),
      currentWindow: this.snapshot.currentWindow,
      currentAttempt: {
        ...attempt,
        status: "completed",
        completionReceipt: input.completionReceipt,
        completionReceiptSha256,
        completedAt: testNow,
      },
    };
    return {
      mode: "RECOVER_ONLY",
      handle: { ...input.handle, stateRevision: revision },
      snapshot: this.snapshot,
    };
  }

  async recordLockedAndAdvance(): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    this.calls.push("locked");
    return this.snapshot;
  }

  async heartbeat(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
  }): Promise<Readonly<SharedCellAuthorCompensationClaimHandle> | null> {
    this.calls.push("heartbeat");
    return input.handle;
  }

  async releaseClaim(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    this.calls.push("release");
    this.releasedHandles.push(structuredClone(input.handle));
    this.releaseSignalsAborted.push(input.signal.aborted);
    this.snapshot = {
      ...this.snapshot,
      operation: this.operation({
        leaseOwner: null,
        claimToken: null,
        leaseExpiresAt: null,
      }),
    };
    return this.snapshot;
  }

  async readOperation(): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    this.calls.push("read");
    return this.snapshot;
  }
}

function grantReceipt(contract: Contract): SharedCellAuthorCompensationPhaseGrantReceipt {
  return {
    schemaVersion: 1,
    action: "shared_cell_author_compensation_phase_grant_verified",
    operationSha256: contract.operationSha256,
    phase: contract.phase,
    compensationPlanSha256: contract.compensationPlanSha256,
    phasePlanSha256: contract.phasePlanSha256,
    controllerContractSha256: contract.controllerContractSha256,
    grantEvidenceSha256: "e".repeat(64),
    observedAt,
  };
}

test("controller is dormant by default and its versioned digest binds every safety fence", async () => {
  assert.equal(SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_DEFAULT_ENABLED, false);
  const source = candidate();
  const changeSet = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_CHANGE_SET",
  );
  const stack = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_STACK",
  );
  assert.equal(changeSet.controllerContractVersion, "j5g-j2/v1");
  assert.equal(changeSet.callerIdentityFence.evidenceReadCallerArn, SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN);
  assert.equal(changeSet.callerIdentityFence.mutationWriteCallerArn, SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN);
  assert.deepEqual(changeSet.authorityFence, {
    authorityKey: "cell:cell-sandbox-1",
    expectedItem: null,
    expectedRevision: 0,
  });
  assert.deepEqual(changeSet.grantSafetyMarginsMs, {
    DELETE_CHANGE_SET: 600_000,
    DELETE_STACK: 300_000,
  });
  assert.equal(changeSet.phaseCapability, "cloudformation:DeleteChangeSet");
  assert.equal(stack.phaseCapability, "cloudformation:DeleteStack");
  assert.equal(changeSet.expectedGrantShape, "AuthorCompensationDeleteChangeSetGrant");
  assert.equal(stack.expectedGrantShape, "AuthorCompensationDeleteStackGrant");
  assert.deepEqual(changeSet.exactMutation, {
    phase: "DELETE_CHANGE_SET",
    request: { ChangeSetName: changeSetArn, StackName: stackId },
  });
  assert.match(
    stack.exactMutation.phase === "DELETE_STACK"
      ? stack.exactMutation.request.ClientRequestToken
      : "",
    /^b5-author-comp-[a-f0-9]{32}$/,
  );
  assert.notEqual(changeSet.controllerContractSha256, stack.controllerContractSha256);

  const nextWindow = await compileSharedCellAuthorCompensationControllerContract(
    candidate({ expiresAt: "2026-09-28T12:58:00.000Z" }),
    "DELETE_CHANGE_SET",
  );
  assert.equal(nextWindow.operationSha256, changeSet.operationSha256);
  assert.notEqual(nextWindow.compensationPlanSha256, changeSet.compensationPlanSha256);
  assert.notEqual(nextWindow.controllerContractSha256, changeSet.controllerContractSha256);
});

test("read-only review distinguishes Change Set presence and requires exact absence for DeleteStack", async () => {
  const source = candidate();
  const csContract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const present = evidenceFixture(source);
  const csStore = new FakeStore(source, csContract, false);
  const reviewed = await inspectAndReviewSharedCellAuthorCompensationPhase({
    store: csStore,
    environmentId: "aws-sandbox",
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    evidence: present.evidence,
    authority: present.authority,
    signal: new AbortController().signal,
    now: () => testNow,
  });
  assert.equal(reviewed.inspection.changeSetState, "PRESENT");
  assert.deepEqual(csStore.calls, ["create-or-load", "append-window"]);

  const missing = evidenceFixture(source, { changeSetPresent: false });
  const rejectedStore = new FakeStore(source, csContract, false);
  await assert.rejects(
    inspectAndReviewSharedCellAuthorCompensationPhase({
      store: rejectedStore,
      environmentId: "aws-sandbox",
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      evidence: missing.evidence,
      authority: missing.authority,
      signal: new AbortController().signal,
      now: () => testNow,
    }),
    (error) =>
      error instanceof SharedCellAuthorCompensationControllerError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PHASE_NOT_REVIEWABLE",
  );
  assert.deepEqual(rejectedStore.calls, []);

  const dsContract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_STACK");
  const dsStore = new FakeStore(source, dsContract, false);
  const deleteStackReview = await inspectAndReviewSharedCellAuthorCompensationPhase({
    store: dsStore,
    environmentId: "aws-sandbox",
    phase: "DELETE_STACK",
    candidate: source,
    evidence: missing.evidence,
    authority: missing.authority,
    signal: new AbortController().signal,
    now: () => testNow,
  });
  assert.equal(deleteStackReview.inspection.changeSetState, "MISSING");
  assert.equal(deleteStackReview.inspection.readyForPhase, true);
});

test("write-ahead CAS precedes the sole AWS mutation and completion stops at revoke handoff", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source);
  const order: string[] = store.calls;
  const mutations: SharedCellAuthorDeleteChangeSetMutationPort = {
    region: "ca-central-1",
    async getCallerIdentity() {
      order.push("aws-caller");
      return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
    },
    async deleteChangeSet() {
      order.push("aws-delete-change-set");
      fixture.setChangeSetPresent(false);
      return {};
    },
  };
  const result = await executeClaimedSharedCellAuthorCompensationPhase({
    store,
    workerId: "controller-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    grantReceipt: grantReceipt(contract),
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    mutations,
    signal: new AbortController().signal,
    now: () => testNow,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  });
  assert.ok(order.indexOf("begin-submission") < order.indexOf("aws-delete-change-set"));
  assert.equal(result.summary.mutationPerformed, true);
  assert.equal(result.snapshot.operation.state, "delete_change_set_revoke_required");
  assert.equal(result.revokeHandoff.previousRendererShape, "AuthorCompensationDeleteChangeSetGrant");
  assert.equal(result.revokeHandoff.targetRendererShape, "Locked");
  assert.equal(result.revokeHandoff.nextAfterLocked, "DELETE_STACK_REVIEW");
  assert.equal(result.revokeHandoff.safeToRevokePhaseGrant, true);
  assert.equal(result.revokeHandoff.safeToFinalAuthorRevoke, false);
  assert.match(result.revokeHandoff.handoffSha256, /^[a-f0-9]{64}$/);
  assert.equal(store.calls.includes("locked"), false);
});

test("takeover resumes a grant-ready phase without replaying prepare", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const receipt = grantReceipt(contract);
  const store = new FakeStore(source, contract);
  store.snapshot = {
    ...store.snapshot,
    operation: {
      ...store.snapshot.operation,
      state: "delete_change_set_ready",
      currentGrantReceiptSha256:
        await sharedCellAuthorCompensationReceiptSha256(receipt),
    },
  };
  const fixture = evidenceFixture(source);
  await executeClaimedSharedCellAuthorCompensationPhase({
    store,
    workerId: "takeover-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    grantReceipt: receipt,
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    mutations: {
      region: "ca-central-1",
      async getCallerIdentity() {
        return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
      },
      async deleteChangeSet() {
        fixture.setChangeSetPresent(false);
      },
    },
    signal: new AbortController().signal,
    now: () => testNow,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  });
  assert.equal(store.calls.includes("prepare"), false);
  assert.equal(store.calls.filter((call) => call === "begin-submission").length, 1);
});

test("grant-ready takeover past the phase cutoff releases without submission or AWS mutation", async () => {
  const source = candidate({
    expiresAt: "2026-09-28T12:10:00.000Z",
  });
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_CHANGE_SET",
  );
  const receipt = grantReceipt(contract);
  const store = new FakeStore(source, contract);
  store.snapshot = {
    ...store.snapshot,
    operation: {
      ...store.snapshot.operation,
      state: "delete_change_set_ready",
      currentGrantReceiptSha256:
        await sharedCellAuthorCompensationReceiptSha256(receipt),
    },
  };
  const fixture = evidenceFixture(source);
  let awsCalls = 0;

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase({
      store,
      workerId: "expired-window-takeover-test",
      leaseDurationMs: 60_000,
      windowNumber: 1,
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      approvedControllerContractSha256: contract.controllerContractSha256,
      grantReceipt: receipt,
      completionObservedAt: () => observedAt,
      evidence: fixture.evidence,
      authority: fixture.authority,
      mutations: {
        region: "ca-central-1",
        async getCallerIdentity() {
          awsCalls += 1;
          return {
            accountId: source.accountId,
            arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
          };
        },
        async deleteChangeSet() {
          awsCalls += 1;
        },
      },
      signal: new AbortController().signal,
      now: () => testNow,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: async () => {},
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
  );

  assert.equal(awsCalls, 0);
  assert.deepEqual(fixture.calls, []);
  assert.equal(store.calls.includes("prepare"), false);
  assert.equal(store.calls.includes("begin-submission"), false);
  assert.deepEqual(store.releaseSignalsAborted, [false]);
  assert.equal(store.releasedHandles.length, 1);
  assert.equal(store.calls.at(-1), "release");
});

test("a pre-boundary abort releases the claim with an independent live cleanup signal", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_CHANGE_SET",
  );
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase({
      store,
      workerId: "aborted-controller-test",
      leaseDurationMs: 60_000,
      windowNumber: 1,
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      approvedControllerContractSha256: contract.controllerContractSha256,
      grantReceipt: grantReceipt(contract),
      completionObservedAt: () => observedAt,
      evidence: fixture.evidence,
      authority: fixture.authority,
      mutations: {
        region: "ca-central-1",
        async getCallerIdentity() {
          return {
            accountId: source.accountId,
            arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
          };
        },
        async deleteChangeSet() {
          assert.fail("an aborted pre-boundary execution must not mutate AWS");
        },
      },
      signal: controller.signal,
      now: () => testNow,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: async () => {},
    }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );

  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(store.releaseSignalsAborted, [false]);
  assert.equal(store.releasedHandles.length, 1);
  assert.equal(store.calls.includes("begin-submission"), false);
  assert.equal(store.calls.at(-1), "release");
});

test("an invalid prepared snapshot releases with the returned advanced handle", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_CHANGE_SET",
  );
  const store = new FakeStore(source, contract);
  store.corruptPreparedSnapshot = true;
  const fixture = evidenceFixture(source);

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase({
      store,
      workerId: "invalid-prepare-controller-test",
      leaseDurationMs: 60_000,
      windowNumber: 1,
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      approvedControllerContractSha256: contract.controllerContractSha256,
      grantReceipt: grantReceipt(contract),
      completionObservedAt: () => observedAt,
      evidence: fixture.evidence,
      authority: fixture.authority,
      mutations: {
        region: "ca-central-1",
        async getCallerIdentity() {
          return {
            accountId: source.accountId,
            arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
          };
        },
        async deleteChangeSet() {
          assert.fail("an invalid prepared snapshot must not mutate AWS");
        },
      },
      signal: new AbortController().signal,
      now: () => testNow,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: async () => {},
    }),
    (error) =>
      error instanceof SharedCellAuthorCompensationControllerError &&
      error.code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PREPARE_CAS_REJECTED",
  );

  assert.equal(store.preparedHandles.length, 1);
  assert.equal(store.releasedHandles.length, 1);
  assert.deepEqual(store.releasedHandles[0], store.preparedHandles[0]);
  assert.equal(
    store.releasedHandles[0]?.stateRevision,
    store.snapshot.operation.stateRevision,
  );
  assert.deepEqual(store.releaseSignalsAborted, [false]);
  assert.equal(store.calls.includes("begin-submission"), false);
  assert.equal(store.calls.at(-1), "release");
});

test("a rejected write-ahead CAS delegates zero AWS mutations", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const store = new FakeStore(source, contract);
  store.rejectBegin = true;
  const fixture = evidenceFixture(source);
  let awsMutations = 0;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase({
      store,
      workerId: "controller-test",
      leaseDurationMs: 60_000,
      windowNumber: 1,
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      approvedControllerContractSha256: contract.controllerContractSha256,
      grantReceipt: grantReceipt(contract),
      completionObservedAt: () => observedAt,
      evidence: fixture.evidence,
      authority: fixture.authority,
      mutations: {
        region: "ca-central-1",
        async getCallerIdentity() {
          return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
        },
        async deleteChangeSet() {
          awsMutations += 1;
        },
      },
      signal: new AbortController().signal,
      now: () => testNow,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: async () => {},
    }),
    (error) =>
      error instanceof SharedCellAuthorCompensationControllerError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_SUBMISSION_CAS_REJECTED",
  );
  assert.equal(awsMutations, 0);
  assert.equal(store.calls.filter((call) => call === "begin-submission").length, 1);
  assert.equal(store.calls.includes("complete"), false);
});

test("after write-ahead uncertainty execute cannot replay and mutation-free recover completes", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source);
  let awsMutations = 0;
  const uncertainMutations: SharedCellAuthorDeleteChangeSetMutationPort = {
    region: "ca-central-1",
    async getCallerIdentity() {
      return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
    },
    async deleteChangeSet() {
      awsMutations += 1;
      throw new Error("connection lost after possible acceptance");
    },
  };
  const executeInput = {
    store,
    workerId: "controller-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET" as const,
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    grantReceipt: grantReceipt(contract),
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    mutations: uncertainMutations,
    signal: new AbortController().signal,
    now: () => testNow,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  };
  await assert.rejects(executeClaimedSharedCellAuthorCompensationPhase(executeInput));
  assert.equal(awsMutations, 1);
  assert.equal(store.snapshot.operation.state, "delete_change_set_recover_only");

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase(executeInput),
    (error) =>
      error instanceof SharedCellAuthorCompensationControllerError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_RECOVERY_REQUIRED",
  );
  assert.equal(awsMutations, 1);

  fixture.setChangeSetPresent(false);
  const recovered = await recoverClaimedSharedCellAuthorCompensationPhase({
    store,
    workerId: "recovery-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    signal: new AbortController().signal,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  });
  assert.equal(recovered.summary.mutationPerformed, false);
  assert.equal(recovered.snapshot.operation.state, "delete_change_set_revoke_required");
  assert.equal(awsMutations, 1);
});

test("a target that vanished before delegation still receives write-ahead and no AWS call", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source, { changeSetPresent: false });
  let awsMutations = 0;
  const result = await executeClaimedSharedCellAuthorCompensationPhase({
    store,
    workerId: "controller-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    grantReceipt: grantReceipt(contract),
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    mutations: {
      region: "ca-central-1",
      async getCallerIdentity() {
        return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
      },
      async deleteChangeSet() {
        awsMutations += 1;
      },
    },
    signal: new AbortController().signal,
    now: () => testNow,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  });
  assert.equal(awsMutations, 0);
  assert.equal(result.summary.mutationPerformed, false);
  assert.deepEqual(
    store.calls.filter((call) => call === "begin-submission" || call === "complete"),
    ["begin-submission", "complete"],
  );
});

test("a Change Set phase that proves the Stack missing hands Locked directly to completion", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    source,
    "DELETE_CHANGE_SET",
  );
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source, { stackMissing: true });
  let awsMutations = 0;
  const result = await executeClaimedSharedCellAuthorCompensationPhase({
    store,
    workerId: "controller-test",
    leaseDurationMs: 60_000,
    windowNumber: 1,
    phase: "DELETE_CHANGE_SET",
    candidate: source,
    approvedControllerContractSha256: contract.controllerContractSha256,
    grantReceipt: grantReceipt(contract),
    completionObservedAt: () => observedAt,
    evidence: fixture.evidence,
    authority: fixture.authority,
    mutations: {
      region: "ca-central-1",
      async getCallerIdentity() {
        return {
          accountId: source.accountId,
          arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
        };
      },
      async deleteChangeSet() {
        awsMutations += 1;
      },
    },
    signal: new AbortController().signal,
    now: () => testNow,
    readbackAttempts: 2,
    readbackDelayMs: 0,
    wait: async () => {},
  });

  assert.equal(awsMutations, 0);
  assert.equal(result.summary.observedState, "MISSING");
  assert.equal(result.revokeHandoff.nextAfterLocked, "COMPLETE");
  assert.equal(result.revokeHandoff.safeToFinalAuthorRevoke, true);
  assert.deepEqual(
    store.calls.filter((call) => call === "begin-submission" || call === "complete"),
    ["begin-submission", "complete"],
  );
});

test("phase isolation rejects a sibling-only mutation port before write-ahead", async () => {
  const source = candidate();
  const contract = await compileSharedCellAuthorCompensationControllerContract(source, "DELETE_CHANGE_SET");
  const store = new FakeStore(source, contract);
  const fixture = evidenceFixture(source);
  let deleteStackCalls = 0;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhase({
      store,
      workerId: "controller-test",
      leaseDurationMs: 60_000,
      windowNumber: 1,
      phase: "DELETE_CHANGE_SET",
      candidate: source,
      approvedControllerContractSha256: contract.controllerContractSha256,
      grantReceipt: grantReceipt(contract),
      completionObservedAt: () => observedAt,
      evidence: fixture.evidence,
      authority: fixture.authority,
      mutations: {
        region: "ca-central-1",
        async getCallerIdentity() {
          return { accountId: source.accountId, arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN };
        },
        async deleteStack() {
          deleteStackCalls += 1;
        },
      },
      signal: new AbortController().signal,
      now: () => testNow,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: async () => {},
    } as unknown as Parameters<
      typeof executeClaimedSharedCellAuthorCompensationPhase
    >[0]),
  );
  assert.equal(deleteStackCalls, 0);
  assert.equal(store.calls.includes("begin-submission"), false);
  assert.deepEqual(store.calls, []);
});
