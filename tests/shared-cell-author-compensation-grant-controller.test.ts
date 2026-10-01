import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_DEFAULT_ENABLED,
  SharedCellAuthorCompensationGrantControllerError,
  compileSharedCellAuthorCompensationGrantActionRequest,
  compileSharedCellAuthorCompensationRevokeActionRequest,
  executeClaimedSharedCellAuthorCompensationPhaseGrant,
  executeClaimedSharedCellAuthorCompensationPhaseRevoke,
  recoverClaimedSharedCellAuthorCompensationPhaseGrant,
  recoverClaimedSharedCellAuthorCompensationPhaseRevoke,
} from "../lib/deployments/execution/shared-cell-author-compensation-grant-controller.ts";
import {
  SharedCellAuthorCompensationLifecycleReceiptProducer,
  compileSharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContract,
} from "../lib/deployments/execution/shared-cell-author-compensation-grant-lifecycle.ts";
import {
  sharedCellAuthorCompensationLifecycleActionRequestSha256,
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationClaim,
  type SharedCellAuthorCompensationClaimHandle,
  type SharedCellAuthorCompensationLifecycleAction,
  type SharedCellAuthorCompensationLifecycleActionCompletionReceipt,
  type SharedCellAuthorCompensationOperationSnapshot,
  type SharedCellAuthorCompensationOperationStore,
  type SharedCellAuthorCompensationPhaseCompletionReceipt,
  type SharedCellAuthorCompensationPhaseGrantReceipt,
} from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";

const now = Date.parse("2026-09-29T12:05:00.000Z");
const digests = Object.freeze({
  operation: "a".repeat(64),
  compensation: "b".repeat(64),
  phase: "c".repeat(64),
  controller: "d".repeat(64),
  grantRaw: "e".repeat(64),
  grantCanonical: "f".repeat(64),
  lockedRaw: "1".repeat(64),
  lockedCanonical: "2".repeat(64),
  operatorBoundary: "3".repeat(64),
  executionBoundary: "4".repeat(64),
  operatorTrust: "5".repeat(64),
  executionTrust: "6".repeat(64),
});

async function lifecycleContract(
  rendererShape:
    | "AuthorCompensationDeleteChangeSetGrant"
    | "AuthorCompensationDeleteStackGrant"
    | "Locked",
) {
  return compileSharedCellAuthorCompensationLifecycleContract({
    schemaVersion: 1,
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    windowNumber: 1,
    compensationPlanSha256: digests.compensation,
    phasePlanSha256: digests.phase,
    controllerContractSha256: digests.controller,
    reviewedAt: "2026-09-29T12:00:00.000Z",
    expiresAt: "2026-09-29T12:20:00.000Z",
    rendererShape,
    templateRawSha256:
      rendererShape === "Locked" ? digests.lockedRaw : digests.grantRaw,
    templateCanonicalSha256:
      rendererShape === "Locked"
        ? digests.lockedCanonical
        : digests.grantCanonical,
    operatorBoundaryDocumentSha256: digests.operatorBoundary,
    executionBoundaryDocumentSha256: digests.executionBoundary,
    operatorTrustPolicySha256: digests.operatorTrust,
    executionTrustPolicySha256: digests.executionTrust,
  });
}

function grantReceipt(
  disposition: SharedCellAuthorCompensationPhaseGrantReceipt["disposition"] =
    "PHASE_EXECUTION_ALLOWED",
): SharedCellAuthorCompensationPhaseGrantReceipt {
  return {
    schemaVersion: 1,
    action: "shared_cell_author_compensation_phase_grant_verified",
    disposition,
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    compensationPlanSha256: digests.compensation,
    phasePlanSha256: digests.phase,
    controllerContractSha256: digests.controller,
    grantEvidenceSha256: "7".repeat(64),
    observedAt: "2026-09-29T12:05:00.001Z",
  };
}

function completionReceipt(): SharedCellAuthorCompensationPhaseCompletionReceipt {
  return {
    schemaVersion: 1,
    action: "shared_cell_author_compensation_phase_completed",
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    compensationPlanSha256: digests.compensation,
    phasePlanSha256: digests.phase,
    controllerContractSha256: digests.controller,
    observedState: "REVIEW_IN_PROGRESS",
    mutationPerformed: true,
    evidenceSha256: "8".repeat(64),
    observedAt: "2026-09-29T12:06:00.000Z",
  };
}

function fakeProducer(input: {
  grant?: SharedCellAuthorCompensationPhaseGrantReceipt;
  completion?: SharedCellAuthorCompensationPhaseCompletionReceipt;
  expiredObservedAt?: string;
}) {
  const producer = new SharedCellAuthorCompensationLifecycleReceiptProducer({
    async readManagementObservation() {
      throw new Error("controller test replaces the strict reader");
    },
  });
  producer.reviewTarget = async ({ contract }) => ({
    schemaVersion: 1,
    lifecycleContractSha256: contract.lifecycleContractSha256,
    rendererShape: contract.rendererShape,
    firstObservedAt: "2026-09-29T12:07:00.000Z",
    observedAt: input.expiredObservedAt ?? "2026-09-29T12:07:00.001Z",
    evidenceSha256: "9".repeat(64),
  });
  producer.createPhaseGrantReceipt = async () =>
    input.grant ?? grantReceipt();
  producer.createPhaseCompletedLockedReceipt = async () => ({
    schemaVersion: 1,
    action: "shared_cell_author_compensation_locked_verified",
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    completionReceiptSha256: await sharedCellAuthorCompensationReceiptSha256(
      input.completion ?? completionReceipt(),
    ),
    lockedEvidenceSha256: "9".repeat(64),
    observedAt: "2026-09-29T12:07:00.001Z",
  });
  producer.createWindowExpiredLockedReceipt = async () => ({
    schemaVersion: 1,
    action:
      "shared_cell_author_compensation_window_expired_locked_verified",
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    grantReceiptSha256: await sharedCellAuthorCompensationReceiptSha256(
      input.grant ?? grantReceipt(),
    ),
    lockedEvidenceSha256: "9".repeat(64),
    observedAt: input.expiredObservedAt ?? "2026-09-29T12:11:00.001Z",
  });
  return producer;
}

function operationSnapshot(
  state:
    | "delete_change_set_prepared"
    | "delete_change_set_ready"
    | "delete_change_set_revoke_required",
): SharedCellAuthorCompensationOperationSnapshot {
  return {
    operation: {
      schemaVersion: 1,
      operationSha256: digests.operation,
      environmentId: "aws-sandbox",
      accountId: "402010193138",
      region: "ca-central-1",
      stackName: "techlong-sandbox-cell-sandbox-1",
      stackId:
        "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/01234567-89ab-cdef-0123-456789abcdef",
      changeSetArn:
        "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-cell-sandbox-1-0123456789abcdef/01234567-89ab-cdef-0123-456789abcdef",
      operationIntent: {},
      deleteStackClientRequestToken: `b5-author-comp-${digests.operation.slice(0, 32)}`,
      state,
      currentPhase: "DELETE_CHANGE_SET",
      currentWindowNumber: 1,
      currentAttemptNumber:
        state === "delete_change_set_revoke_required" ? 1 : null,
      currentGrantReceiptSha256: null,
      stateRevision: 10,
      leaseOwner: null,
      claimToken: null,
      leaseAttempt: 0,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorSha256: null,
      createdAt: now - 60_000,
      updatedAt: now,
      completedAt: null,
    },
    currentWindow: {
      operationSha256: digests.operation,
      phase: "DELETE_CHANGE_SET",
      windowNumber: 1,
      candidate: {} as never,
      compensationPlanSha256: digests.compensation,
      phasePlanSha256: digests.phase,
      controllerContractSha256: digests.controller,
      reviewedAt: Date.parse("2026-09-29T12:00:00.000Z"),
      expiresAt: Date.parse("2026-09-29T12:20:00.000Z"),
      createdAt: Date.parse("2026-09-29T12:00:00.000Z"),
    },
    currentAttempt: null,
    currentLifecycleAction: null,
  };
}

class FakeLifecycleStore implements SharedCellAuthorCompensationOperationStore {
  snapshot: SharedCellAuthorCompensationOperationSnapshot;
  calls: string[] = [];
  beginSignals: AbortSignal[] = [];
  releaseSignalsAborted: boolean[] = [];
  abortAfterBegin: AbortController | null = null;
  rejectBegin = false;
  corruptLifecycleRequestSha = false;
  private handle: SharedCellAuthorCompensationClaimHandle | null = null;

  constructor(
    state:
      | "delete_change_set_prepared"
      | "delete_change_set_ready"
      | "delete_change_set_revoke_required" = "delete_change_set_prepared",
  ) {
    this.snapshot = operationSnapshot(state);
  }

  private setOperation(
    values: Partial<SharedCellAuthorCompensationOperationSnapshot["operation"]>,
  ) {
    this.snapshot = {
      ...this.snapshot,
      operation: { ...this.snapshot.operation, ...values },
    };
  }

  private newHandle(workerId: string) {
    const revision = this.snapshot.operation.stateRevision + 1;
    const attempt = this.snapshot.operation.leaseAttempt + 1;
    this.handle = {
      operationSha256: digests.operation,
      workerId,
      claimToken: `scac_${"a".repeat(32)}`,
      leaseAttempt: attempt,
      stateRevision: revision,
      leaseExpiresAt: now + 60_000,
    };
    this.setOperation({
      stateRevision: revision,
      leaseOwner: workerId,
      claimToken: this.handle.claimToken,
      leaseAttempt: attempt,
      leaseExpiresAt: this.handle.leaseExpiresAt,
    });
    return this.handle;
  }

  private advanceHandle() {
    assert.ok(this.handle);
    const revision = this.snapshot.operation.stateRevision + 1;
    this.handle = { ...this.handle, stateRevision: revision };
    this.setOperation({ stateRevision: revision });
    return this.handle;
  }

  async claimExactOperation(
    input: Parameters<
      SharedCellAuthorCompensationOperationStore["claimExactOperation"]
    >[0],
  ): Promise<SharedCellAuthorCompensationClaim> {
    this.calls.push("claim");
    const handle = this.newHandle(input.workerId);
    return {
      mode:
        this.snapshot.currentLifecycleAction?.status === "recover_only" ||
        this.snapshot.operation.state.endsWith("revoke_required")
          ? "RECOVER_ONLY"
          : "PREPARE",
      handle,
      snapshot: this.snapshot,
    };
  }

  async beginLifecycleAction(
    input: Parameters<
      SharedCellAuthorCompensationOperationStore["beginLifecycleAction"]
    >[0],
  ): Promise<SharedCellAuthorCompensationClaim | null> {
    this.calls.push(`begin-${input.request.kind.toLowerCase()}`);
    this.beginSignals.push(input.signal);
    if (this.rejectBegin) return null;
    const handle = this.advanceHandle();
    const actionNumber = input.request.kind === "GRANT" ? 1 : 2;
    const action: SharedCellAuthorCompensationLifecycleAction = {
      operationSha256: digests.operation,
      phase: "DELETE_CHANGE_SET",
      windowNumber: 1,
      actionNumber,
      kind: input.request.kind,
      revokeReason:
        input.request.kind === "REVOKE" ? input.request.reason : null,
      status: "recover_only",
      request: input.request,
      requestSha256: this.corruptLifecycleRequestSha
        ? "0".repeat(64)
        : await sharedCellAuthorCompensationLifecycleActionRequestSha256(
            input.request,
          ),
      leaseAttempt: handle.leaseAttempt,
      preparedRevision: handle.stateRevision,
      completionReceipt: null,
      completionReceiptSha256: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.snapshot = { ...this.snapshot, currentLifecycleAction: action };
    this.abortAfterBegin?.abort();
    input.signal.throwIfAborted();
    return { mode: "RECOVER_ONLY", handle, snapshot: this.snapshot };
  }

  async completeLifecycleAction(
    input: Parameters<
      SharedCellAuthorCompensationOperationStore["completeLifecycleAction"]
    >[0],
  ) {
    this.calls.push("complete-lifecycle");
    const action = this.snapshot.currentLifecycleAction;
    assert.ok(action);
    const receipt =
      input.receipt as SharedCellAuthorCompensationLifecycleActionCompletionReceipt;
    const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(receipt);
    const revision = this.snapshot.operation.stateRevision + 1;
    const completedAction: SharedCellAuthorCompensationLifecycleAction = {
      ...action,
      status: "completed",
      completionReceipt: receipt,
      completionReceiptSha256: receiptSha256,
      updatedAt: now + 1,
      completedAt: now + 1,
    };
    if (action.kind === "GRANT") {
      assert.ok(this.handle);
      this.handle = { ...this.handle, stateRevision: revision };
      this.setOperation({
        state: "delete_change_set_ready",
        stateRevision: revision,
        currentGrantReceiptSha256: receiptSha256,
      });
      this.snapshot = {
        ...this.snapshot,
        currentLifecycleAction: completedAction,
      };
      const claim: SharedCellAuthorCompensationClaim = {
        mode: "PREPARE",
        handle: this.handle,
        snapshot: this.snapshot,
      };
      return { claim, snapshot: this.snapshot };
    }
    const reason = action.request.kind === "REVOKE" && action.request.reason;
    const terminal =
      reason === "PHASE_COMPLETED" &&
      this.snapshot.currentAttempt?.completionReceipt?.observedState === "MISSING";
    this.setOperation({
      state: terminal
        ? "missing_proven_locked"
        : reason === "PHASE_COMPLETED"
          ? "awaiting_delete_stack_review"
          : "awaiting_delete_change_set_review",
      currentPhase: terminal
        ? null
        : reason === "PHASE_COMPLETED"
          ? "DELETE_STACK"
          : "DELETE_CHANGE_SET",
      currentWindowNumber: null,
      currentAttemptNumber: null,
      currentGrantReceiptSha256: null,
      stateRevision: revision,
      leaseOwner: null,
      claimToken: null,
      leaseExpiresAt: null,
      completedAt: terminal ? now + 1 : null,
    });
    this.snapshot = {
      operation: this.snapshot.operation,
      currentWindow: null,
      currentAttempt: null,
      currentLifecycleAction: null,
    };
    this.handle = null;
    return { claim: null, snapshot: this.snapshot };
  }

  installGrantCompleted(receipt: SharedCellAuthorCompensationPhaseGrantReceipt) {
    return (async () => {
      const request = await compileSharedCellAuthorCompensationGrantActionRequest(
        this.lastGrantContract as SharedCellAuthorCompensationLifecycleContract,
      );
      const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(receipt);
      this.snapshot = operationSnapshot("delete_change_set_ready");
      this.snapshot = {
        ...this.snapshot,
        operation: {
          ...this.snapshot.operation,
          currentGrantReceiptSha256: receiptSha256,
        },
        currentLifecycleAction: {
          operationSha256: digests.operation,
          phase: "DELETE_CHANGE_SET",
          windowNumber: 1,
          actionNumber: 1,
          kind: "GRANT",
          revokeReason: null,
          status: "completed",
          request,
          requestSha256:
            await sharedCellAuthorCompensationLifecycleActionRequestSha256(
              request,
            ),
          leaseAttempt: 1,
          preparedRevision: 11,
          completionReceipt: receipt,
          completionReceiptSha256: receiptSha256,
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        },
      };
    })();
  }

  lastGrantContract: SharedCellAuthorCompensationLifecycleContract | null = null;

  setRevokeRequired(
    grant: SharedCellAuthorCompensationPhaseGrantReceipt,
    completion: SharedCellAuthorCompensationPhaseCompletionReceipt,
  ) {
    return (async () => {
      const grantSha = await sharedCellAuthorCompensationReceiptSha256(grant);
      const completionSha =
        await sharedCellAuthorCompensationReceiptSha256(completion);
      const grantRequest =
        await compileSharedCellAuthorCompensationGrantActionRequest(
          await lifecycleContract("AuthorCompensationDeleteChangeSetGrant"),
        );
      const snapshot = operationSnapshot("delete_change_set_revoke_required");
      this.snapshot = {
        ...snapshot,
        operation: {
          ...snapshot.operation,
          currentGrantReceiptSha256: grantSha,
        },
        currentAttempt: {
          operationSha256: digests.operation,
          phase: "DELETE_CHANGE_SET",
          attemptNumber: 1,
          windowNumber: 1,
          status: "completed",
          request: {
            phase: "DELETE_CHANGE_SET",
            request: { ChangeSetName: "exact-arn", StackName: "exact-id" },
          },
          requestSha256: "0".repeat(64),
          clientRequestToken: null,
          leaseAttempt: 1,
          preparedRevision: 12,
          completionReceipt: completion,
          completionReceiptSha256: completionSha,
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        },
        currentLifecycleAction: {
          operationSha256: digests.operation,
          phase: "DELETE_CHANGE_SET",
          windowNumber: 1,
          actionNumber: 1,
          kind: "GRANT",
          revokeReason: null,
          status: "completed",
          request: grantRequest,
          requestSha256:
            await sharedCellAuthorCompensationLifecycleActionRequestSha256(
              grantRequest,
            ),
          leaseAttempt: 1,
          preparedRevision: 11,
          completionReceipt: grant,
          completionReceiptSha256: grantSha,
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        },
      };
    })();
  }

  async createOrLoadOperation(): Promise<never> {
    throw new Error("unused");
  }
  async appendReviewedWindow(): Promise<never> {
    throw new Error("unused");
  }
  async preparePhase(): Promise<never> {
    throw new Error("legacy prepare must not be called");
  }
  async beginSubmission(): Promise<never> {
    throw new Error("unused");
  }
  async completePhase(): Promise<never> {
    throw new Error("unused");
  }
  async recordLockedAndAdvance(): Promise<never> {
    throw new Error("legacy Locked advance must not be called");
  }
  async heartbeat(): Promise<never> {
    throw new Error("unused");
  }
  async releaseClaim(
    input: Parameters<
      SharedCellAuthorCompensationOperationStore["releaseClaim"]
    >[0],
  ): Promise<
    Readonly<SharedCellAuthorCompensationOperationSnapshot> | null
  > {
    this.calls.push("release");
    this.releaseSignalsAborted.push(input.signal.aborted);
    return this.snapshot;
  }
  async readOperation(): Promise<
    Readonly<SharedCellAuthorCompensationOperationSnapshot> | null
  > {
    return this.snapshot;
  }
}

function controllerError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof SharedCellAuthorCompensationGrantControllerError);
    assert.equal(error.code, code);
    return true;
  };
}

test("lifecycle action requests bind the exact management Stack, deterministic Change Set, and target template", async () => {
  assert.equal(
    SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_DEFAULT_ENABLED,
    false,
  );
  const grantContract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const grant = await compileSharedCellAuthorCompensationGrantActionRequest(
    grantContract,
  );
  assert.equal(grant.kind, "GRANT");
  assert.equal(
    grant.managementStackName,
    "techlong-s3-b5-cell-lifecycle-management",
  );
  assert.match(grant.managementStackId, /fb742b50-afb2-11f1-85b7-02588681429d$/);
  assert.equal(
    grant.managementChangeSetName,
    `techlong-j5gj3-grant-${grantContract.lifecycleContractSha256.slice(0, 16)}`,
  );
  assert.equal(grant.targetTemplateRawSha256, digests.grantRaw);

  const lockedContract = await lifecycleContract("Locked");
  const revoke = await compileSharedCellAuthorCompensationRevokeActionRequest({
    contract: lockedContract,
    reason: "PHASE_COMPLETED",
    grantReceipt: grantReceipt(),
    completionReceipt: completionReceipt(),
  });
  assert.equal(revoke.kind, "REVOKE");
  assert.equal(
    revoke.managementChangeSetName,
    `techlong-j5gj3-revoke-${lockedContract.lifecycleContractSha256.slice(0, 16)}`,
  );
  assert.equal(revoke.targetRendererShape, "Locked");
});

test("grant execution persists recover-only intent before the sole delegate and commits only trusted readback", async () => {
  const contract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const store = new FakeLifecycleStore();
  store.lastGrantContract = contract;
  let mutations = 0;
  const result = await executeClaimedSharedCellAuthorCompensationPhaseGrant({
    store,
    receiptProducer: fakeProducer({}),
    workerId: "grant-controller-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: contract.lifecycleContractSha256,
    contract,
    mutations: {
      async installPhaseGrant() {
        assert.equal(store.snapshot.currentLifecycleAction?.status, "recover_only");
        store.calls.push("delegate-grant");
        mutations += 1;
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(mutations, 1);
  assert.deepEqual(store.calls, [
    "claim",
    "begin-grant",
    "delegate-grant",
    "complete-lifecycle",
  ]);
  assert.equal(result.snapshot.operation.state, "delete_change_set_ready");
  assert.equal(result.snapshot.currentLifecycleAction?.status, "completed");
  assert.ok(result.claim);
});

test("a rejected grant write-ahead delegates zero mutation", async () => {
  const contract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const store = new FakeLifecycleStore();
  store.lastGrantContract = contract;
  store.rejectBegin = true;
  let mutations = 0;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseGrant({
      store,
      receiptProducer: fakeProducer({}),
      workerId: "grant-controller-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256: contract.lifecycleContractSha256,
      contract,
      mutations: {
        async installPhaseGrant() {
          mutations += 1;
        },
      },
      signal: new AbortController().signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_REJECTED",
    ),
  );
  assert.equal(mutations, 0);
  assert.equal(store.calls.at(-1), "release");
  assert.deepEqual(store.releaseSignalsAborted, [false]);
});

test("a mismatched durable lifecycle request digest delegates zero mutation", async () => {
  const contract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const store = new FakeLifecycleStore();
  store.corruptLifecycleRequestSha = true;
  let mutations = 0;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseGrant({
      store,
      receiptProducer: fakeProducer({}),
      workerId: "grant-controller-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256: contract.lifecycleContractSha256,
      contract,
      mutations: {
        async installPhaseGrant() {
          mutations += 1;
        },
      },
      signal: new AbortController().signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_MISMATCH",
    ),
  );
  assert.equal(mutations, 0);
  assert.equal(store.snapshot.currentLifecycleAction?.status, "recover_only");
  assert.equal(store.calls.at(-1), "release");
  assert.deepEqual(store.releaseSignalsAborted, [false]);
});

test("a caller abort after lifecycle write-ahead cannot suppress the sole Grant or Revoke delegate", async () => {
  const grantContract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const grantStore = new FakeLifecycleStore();
  grantStore.lastGrantContract = grantContract;
  const grantCaller = new AbortController();
  grantStore.abortAfterBegin = grantCaller;
  let grants = 0;

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseGrant({
      store: grantStore,
      receiptProducer: fakeProducer({}),
      workerId: "grant-post-write-ahead-abort-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256:
        grantContract.lifecycleContractSha256,
      contract: grantContract,
      mutations: {
        async installPhaseGrant({ signal }) {
          assert.notEqual(signal, grantCaller.signal);
          assert.equal(signal.aborted, false);
          grants += 1;
          throw new Error("response lost");
        },
      },
      signal: grantCaller.signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
    ),
  );
  assert.equal(grantCaller.signal.aborted, true);
  assert.equal(grants, 1);
  assert.notEqual(grantStore.beginSignals[0], grantCaller.signal);
  assert.equal(grantStore.beginSignals[0]?.aborted, false);
  assert.equal(
    grantStore.snapshot.currentLifecycleAction?.status,
    "recover_only",
  );

  const lockedContract = await lifecycleContract("Locked");
  const grant = grantReceipt();
  const completion = completionReceipt();
  const revokeStore = new FakeLifecycleStore(
    "delete_change_set_revoke_required",
  );
  await revokeStore.setRevokeRequired(grant, completion);
  const revokeCaller = new AbortController();
  revokeStore.abortAfterBegin = revokeCaller;
  let revokes = 0;

  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseRevoke({
      store: revokeStore,
      receiptProducer: fakeProducer({ grant, completion }),
      workerId: "revoke-post-write-ahead-abort-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256:
        lockedContract.lifecycleContractSha256,
      contract: lockedContract,
      reason: "PHASE_COMPLETED",
      grantReceipt: grant,
      completionReceipt: completion,
      mutations: {
        async revokePhaseGrant({ signal }) {
          assert.notEqual(signal, revokeCaller.signal);
          assert.equal(signal.aborted, false);
          revokes += 1;
          throw new Error("response lost");
        },
      },
      signal: revokeCaller.signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
    ),
  );
  assert.equal(revokeCaller.signal.aborted, true);
  assert.equal(revokes, 1);
  assert.notEqual(revokeStore.beginSignals[0], revokeCaller.signal);
  assert.equal(revokeStore.beginSignals[0]?.aborted, false);
  assert.equal(
    revokeStore.snapshot.currentLifecycleAction?.status,
    "recover_only",
  );
});

test("lost grant response becomes recover-only and recovery never receives a mutation port", async () => {
  const contract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const store = new FakeLifecycleStore();
  store.lastGrantContract = contract;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseGrant({
      store,
      receiptProducer: fakeProducer({}),
      workerId: "grant-controller-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256: contract.lifecycleContractSha256,
      contract,
      mutations: {
        async installPhaseGrant() {
          throw new Error("response lost");
        },
      },
      signal: new AbortController().signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
    ),
  );
  assert.equal(store.snapshot.currentLifecycleAction?.status, "recover_only");
  const recovered = await recoverClaimedSharedCellAuthorCompensationPhaseGrant({
    store,
    receiptProducer: fakeProducer({}),
    workerId: "grant-recovery-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: contract.lifecycleContractSha256,
    contract,
    signal: new AbortController().signal,
  });
  assert.equal(recovered.snapshot.operation.state, "delete_change_set_ready");
  assert.equal(
    store.calls.filter((call) => call === "begin-grant").length,
    1,
  );
});

test("late grant reconciliation hands its live claim directly to revoke-only cleanup", async () => {
  const grantContract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const lockedContract = await lifecycleContract("Locked");
  const store = new FakeLifecycleStore();
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseGrant({
      store,
      receiptProducer: fakeProducer({}),
      workerId: "late-grant-recovery-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256: grantContract.lifecycleContractSha256,
      contract: grantContract,
      mutations: {
        async installPhaseGrant() {
          throw new Error("response lost");
        },
      },
      signal: new AbortController().signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
    ),
  );

  const lateGrant = grantReceipt("REVOKE_ONLY");
  const recovered = await recoverClaimedSharedCellAuthorCompensationPhaseGrant({
    store,
    receiptProducer: fakeProducer({ grant: lateGrant }),
    workerId: "late-grant-recovery-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: grantContract.lifecycleContractSha256,
    contract: grantContract,
    signal: new AbortController().signal,
  });
  assert.equal(
    (recovered.receipt as SharedCellAuthorCompensationPhaseGrantReceipt)
      .disposition,
    "REVOKE_ONLY",
  );
  assert.ok(recovered.claim);

  let revokes = 0;
  const revoked = await executeClaimedSharedCellAuthorCompensationPhaseRevoke({
    store,
    receiptProducer: fakeProducer({
      grant: lateGrant,
      expiredObservedAt: "2026-09-29T12:11:00.001Z",
    }),
    workerId: "late-grant-recovery-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: lockedContract.lifecycleContractSha256,
    contract: lockedContract,
    reason: "WINDOW_EXPIRED",
    grantReceipt: lateGrant,
    claim: recovered.claim,
    mutations: {
      async revokePhaseGrant() {
        revokes += 1;
      },
    },
    signal: new AbortController().signal,
  });

  assert.equal(revokes, 1);
  assert.equal(revoked.snapshot.operation.state, "awaiting_delete_change_set_review");
  assert.equal(store.calls.filter((call) => call === "claim").length, 2);
});

test("completed-phase revoke accepts the live phase claim without waiting or reclaiming", async () => {
  const contract = await lifecycleContract("Locked");
  const grant = grantReceipt();
  const completion = completionReceipt();
  const store = new FakeLifecycleStore("delete_change_set_revoke_required");
  await store.setRevokeRequired(grant, completion);
  const phaseClaim = await store.claimExactOperation({
    operationSha256: digests.operation,
    workerId: "revoke-controller-test",
    leaseDurationMs: 60_000,
    signal: new AbortController().signal,
  });
  let mutations = 0;
  const result = await executeClaimedSharedCellAuthorCompensationPhaseRevoke({
    store,
    receiptProducer: fakeProducer({ grant, completion }),
    workerId: "revoke-controller-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: contract.lifecycleContractSha256,
    contract,
    reason: "PHASE_COMPLETED",
    grantReceipt: grant,
    completionReceipt: completion,
    claim: phaseClaim,
    mutations: {
      async revokePhaseGrant() {
        assert.equal(store.snapshot.currentLifecycleAction?.status, "recover_only");
        mutations += 1;
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(mutations, 1);
  assert.equal(result.snapshot.operation.state, "awaiting_delete_stack_review");
  assert.equal(result.snapshot.currentLifecycleAction, null);
  assert.equal(result.claim, null);
  assert.equal(store.calls.filter((call) => call === "claim").length, 1);
});

test("ready grant after cutoff revokes to Locked and returns to fresh review without rollover", async () => {
  const grantContract = await lifecycleContract(
    "AuthorCompensationDeleteChangeSetGrant",
  );
  const lockedContract = await lifecycleContract("Locked");
  const grant = grantReceipt();
  const store = new FakeLifecycleStore("delete_change_set_ready");
  store.lastGrantContract = grantContract;
  await store.installGrantCompleted(grant);
  const result = await executeClaimedSharedCellAuthorCompensationPhaseRevoke({
    store,
    receiptProducer: fakeProducer({
      grant,
      expiredObservedAt: "2026-09-29T12:11:00.001Z",
    }),
    workerId: "expiry-revoke-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: lockedContract.lifecycleContractSha256,
    contract: lockedContract,
    reason: "WINDOW_EXPIRED",
    grantReceipt: grant,
    mutations: {
      async revokePhaseGrant() {},
    },
    signal: new AbortController().signal,
  });
  assert.equal(
    result.snapshot.operation.state,
    "awaiting_delete_change_set_review",
  );
  assert.equal(result.snapshot.operation.currentWindowNumber, null);
  assert.equal(result.snapshot.operation.currentGrantReceiptSha256, null);
});

test("lost revoke response is reconciled read-only without a second delegate", async () => {
  const contract = await lifecycleContract("Locked");
  const grant = grantReceipt();
  const completion = completionReceipt();
  const store = new FakeLifecycleStore("delete_change_set_revoke_required");
  await store.setRevokeRequired(grant, completion);
  let mutations = 0;
  await assert.rejects(
    executeClaimedSharedCellAuthorCompensationPhaseRevoke({
      store,
      receiptProducer: fakeProducer({ grant, completion }),
      workerId: "revoke-controller-test",
      leaseDurationMs: 60_000,
      approvedLifecycleContractSha256: contract.lifecycleContractSha256,
      contract,
      reason: "PHASE_COMPLETED",
      grantReceipt: grant,
      completionReceipt: completion,
      mutations: {
        async revokePhaseGrant() {
          mutations += 1;
          throw new Error("response lost");
        },
      },
      signal: new AbortController().signal,
    }),
    controllerError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
    ),
  );
  const recovered = await recoverClaimedSharedCellAuthorCompensationPhaseRevoke({
    store,
    receiptProducer: fakeProducer({ grant, completion }),
    workerId: "revoke-recovery-test",
    leaseDurationMs: 60_000,
    approvedLifecycleContractSha256: contract.lifecycleContractSha256,
    contract,
    reason: "PHASE_COMPLETED",
    grantReceipt: grant,
    completionReceipt: completion,
    signal: new AbortController().signal,
  });
  assert.equal(mutations, 1);
  assert.equal(recovered.snapshot.operation.state, "awaiting_delete_stack_review");
});
