import { canonicalJson } from "./hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID,
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME,
  SharedCellAuthorCompensationLifecycleReceiptProducer,
  compileSharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContractInput,
} from "./shared-cell-author-compensation-grant-lifecycle.ts";
import {
  assertSharedCellAuthorCompensationDigest,
  assertSharedCellAuthorCompensationLifecycleActionRequest,
  assertSharedCellAuthorCompensationPhaseCompletionReceipt,
  assertSharedCellAuthorCompensationPhaseGrantReceipt,
  sharedCellAuthorCompensationLifecycleActionRequestSha256,
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationClaim,
  type SharedCellAuthorCompensationClaimHandle,
  type SharedCellAuthorCompensationLifecycleActionCompletionReceipt,
  type SharedCellAuthorCompensationLifecycleActionRequest,
  type SharedCellAuthorCompensationOperationSnapshot,
  type SharedCellAuthorCompensationOperationStore,
  type SharedCellAuthorCompensationPhaseCompletionReceipt,
  type SharedCellAuthorCompensationPhaseGrantReceipt,
} from "./shared-cell-author-compensation-operation-store.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_DEFAULT_ENABLED =
  false as const;

const phaseStatePrefix = Object.freeze({
  DELETE_CHANGE_SET: "delete_change_set",
  DELETE_STACK: "delete_stack",
} as const);

export class SharedCellAuthorCompensationGrantControllerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellAuthorCompensationGrantControllerError(
    code,
    message,
    retryable,
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value as Record<string, unknown>).sort()) ===
      canonicalJson([...keys].sort())
  );
}

function immutable<T>(value: T): Readonly<T> {
  return Object.freeze(JSON.parse(canonicalJson(value)) as T);
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      `${label} must be a positive safe integer.`,
    );
  }
}

async function assertApprovedLifecycleContract(
  contract: SharedCellAuthorCompensationLifecycleContract,
  approvedSha256: string,
): Promise<void> {
  assertSharedCellAuthorCompensationDigest(
    approvedSha256,
    "approved lifecycle contract",
  );
  const source = record(contract);
  const body = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "lifecycleContractSha256"),
  );
  const fresh = await compileSharedCellAuthorCompensationLifecycleContract(
    body as unknown as SharedCellAuthorCompensationLifecycleContractInput,
  );
  if (
    contract.lifecycleContractSha256 !== fresh.lifecycleContractSha256 ||
    approvedSha256 !== fresh.lifecycleContractSha256 ||
    canonicalJson(contract) !== canonicalJson(fresh)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_CONTRACT_MISMATCH",
      "The lifecycle contract does not match the explicitly approved digest.",
    );
  }
}

function managementChangeSetName(
  kind: "GRANT" | "REVOKE",
  lifecycleContractSha256: string,
): string {
  return `techlong-j5gj3-${kind.toLowerCase()}-${lifecycleContractSha256.slice(0, 16)}`;
}

export async function compileSharedCellAuthorCompensationGrantActionRequest(
  contract: SharedCellAuthorCompensationLifecycleContract,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleActionRequest>> {
  if (contract.rendererShape === "Locked") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_SHAPE_MISMATCH",
      "A grant action requires a split phase grant renderer shape.",
    );
  }
  const request = immutable({
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_grant" as const,
    kind: "GRANT" as const,
    operationSha256: contract.operationSha256,
    phase: contract.phase,
    windowNumber: contract.windowNumber,
    compensationPlanSha256: contract.compensationPlanSha256,
    phasePlanSha256: contract.phasePlanSha256,
    controllerContractSha256: contract.controllerContractSha256,
    lifecycleContractSha256: contract.lifecycleContractSha256,
    managementStackName:
      SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME,
    managementStackId: SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID,
    managementChangeSetName: managementChangeSetName(
      "GRANT",
      contract.lifecycleContractSha256,
    ),
    targetRendererShape: contract.rendererShape,
    targetTemplateRawSha256: contract.templateRawSha256,
    targetTemplateCanonicalSha256: contract.templateCanonicalSha256,
  });
  assertSharedCellAuthorCompensationLifecycleActionRequest(request);
  return request;
}

export async function compileSharedCellAuthorCompensationRevokeActionRequest(input: {
  contract: SharedCellAuthorCompensationLifecycleContract;
  reason: "PHASE_COMPLETED" | "WINDOW_EXPIRED";
  grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
  completionReceipt?: SharedCellAuthorCompensationPhaseCompletionReceipt;
}): Promise<Readonly<SharedCellAuthorCompensationLifecycleActionRequest>> {
  if (
    !exactKeys(
      input,
      input.reason === "PHASE_COMPLETED"
        ? ["completionReceipt", "contract", "grantReceipt", "reason"]
        : ["contract", "grantReceipt", "reason"],
    ) ||
    input.contract.rendererShape !== "Locked"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_SHAPE_MISMATCH",
      "A revoke action requires the exact Locked renderer contract.",
    );
  }
  assertSharedCellAuthorCompensationPhaseGrantReceipt(input.grantReceipt);
  if (
    input.grantReceipt.operationSha256 !== input.contract.operationSha256 ||
    input.grantReceipt.phase !== input.contract.phase ||
    input.grantReceipt.compensationPlanSha256 !==
      input.contract.compensationPlanSha256 ||
    input.grantReceipt.phasePlanSha256 !== input.contract.phasePlanSha256 ||
    input.grantReceipt.controllerContractSha256 !==
      input.contract.controllerContractSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_RECEIPT_MISMATCH",
      "The grant receipt does not belong to the exact lifecycle contract.",
    );
  }
  const common = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_revoke" as const,
    kind: "REVOKE" as const,
    operationSha256: input.contract.operationSha256,
    phase: input.contract.phase,
    windowNumber: input.contract.windowNumber,
    grantReceiptSha256:
      await sharedCellAuthorCompensationReceiptSha256(input.grantReceipt),
    lifecycleContractSha256: input.contract.lifecycleContractSha256,
    managementStackName:
      SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME,
    managementStackId: SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID,
    managementChangeSetName: managementChangeSetName(
      "REVOKE",
      input.contract.lifecycleContractSha256,
    ),
    targetRendererShape: "Locked" as const,
    targetTemplateRawSha256: input.contract.templateRawSha256,
    targetTemplateCanonicalSha256: input.contract.templateCanonicalSha256,
  };
  let request: SharedCellAuthorCompensationLifecycleActionRequest;
  if (input.reason === "PHASE_COMPLETED") {
    if (!input.completionReceipt) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
        "A completed-phase revoke requires its exact completion receipt.",
      );
    }
    assertSharedCellAuthorCompensationPhaseCompletionReceipt(
      input.completionReceipt,
    );
    if (input.contract.cellSafety && input.contract.cellSafety.expectedState !==
        (input.completionReceipt.observedState === "MISSING" ? "MISSING" : "REVIEW_CHANGE_SET_MISSING")) {
      fail("SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_RECEIPT_MISMATCH", "The Locked Cell safety contract must match the persisted completion state before any Revoke action.");
    }
    if (
      input.completionReceipt.operationSha256 !== input.contract.operationSha256 ||
      input.completionReceipt.phase !== input.contract.phase ||
      input.completionReceipt.compensationPlanSha256 !==
        input.contract.compensationPlanSha256 ||
      input.completionReceipt.phasePlanSha256 !==
        input.contract.phasePlanSha256 ||
      input.completionReceipt.controllerContractSha256 !==
        input.contract.controllerContractSha256
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_RECEIPT_MISMATCH",
        "The completion receipt does not belong to the exact lifecycle contract.",
      );
    }
    request = immutable({
      ...common,
      reason: "PHASE_COMPLETED" as const,
      completionReceiptSha256:
        await sharedCellAuthorCompensationReceiptSha256(
          input.completionReceipt,
        ),
    });
  } else {
    request = immutable({
      ...common,
      reason: "WINDOW_EXPIRED" as const,
    });
  }
  assertSharedCellAuthorCompensationLifecycleActionRequest(request);
  return request;
}

export interface SharedCellAuthorCompensationPhaseGrantMutationPort {
  installPhaseGrant(input: {
    request: Extract<
      SharedCellAuthorCompensationLifecycleActionRequest,
      { kind: "GRANT" }
    >;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface SharedCellAuthorCompensationPhaseRevokeMutationPort {
  revokePhaseGrant(input: {
    request: Extract<
      SharedCellAuthorCompensationLifecycleActionRequest,
      { kind: "REVOKE" }
    >;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface SharedCellAuthorCompensationLifecycleControlledResult {
  readonly request: Readonly<SharedCellAuthorCompensationLifecycleActionRequest>;
  readonly requestSha256: string;
  readonly receipt: Readonly<SharedCellAuthorCompensationLifecycleActionCompletionReceipt>;
  readonly receiptSha256: string;
  readonly snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  readonly claim: Readonly<SharedCellAuthorCompensationClaim> | null;
}

interface CommonInput {
  store: SharedCellAuthorCompensationOperationStore;
  receiptProducer: SharedCellAuthorCompensationLifecycleReceiptProducer;
  workerId: string;
  leaseDurationMs: number;
  approvedLifecycleContractSha256: string;
  contract: SharedCellAuthorCompensationLifecycleContract;
  signal: AbortSignal;
}

function assertCommonInput(input: CommonInput): void {
  if (
    !input.store ||
    typeof input.store.claimExactOperation !== "function" ||
    typeof input.store.beginLifecycleAction !== "function" ||
    typeof input.store.completeLifecycleAction !== "function" ||
    typeof input.store.releaseClaim !== "function" ||
    !(input.receiptProducer instanceof
      SharedCellAuthorCompensationLifecycleReceiptProducer) ||
    typeof input.workerId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(input.workerId)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      "The lifecycle controller dependencies are invalid.",
    );
  }
  assertPositiveInteger(input.leaseDurationMs, "leaseDurationMs");
}

function assertWindow(
  claim: SharedCellAuthorCompensationClaim,
  contract: SharedCellAuthorCompensationLifecycleContract,
): void {
  const snapshot = claim.snapshot;
  if (
    snapshot.operation.operationSha256 !== contract.operationSha256 ||
    snapshot.operation.currentPhase !== contract.phase ||
    snapshot.operation.currentWindowNumber !== contract.windowNumber ||
    !snapshot.currentWindow ||
    snapshot.currentWindow.windowNumber !== contract.windowNumber ||
    snapshot.currentWindow.phase !== contract.phase ||
    snapshot.currentWindow.compensationPlanSha256 !==
      contract.compensationPlanSha256 ||
    snapshot.currentWindow.phasePlanSha256 !== contract.phasePlanSha256 ||
    snapshot.currentWindow.controllerContractSha256 !==
      contract.controllerContractSha256 ||
    snapshot.currentWindow.reviewedAt !== Date.parse(contract.reviewedAt) ||
    snapshot.currentWindow.expiresAt !== Date.parse(contract.expiresAt)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WINDOW_MISMATCH",
      "The claimed operation is not bound to the exact lifecycle review window.",
    );
  }
}

const claimReleaseTimeoutMs = 5_000;
const durableMutationTimeoutMs = 30_000;

async function runIndependentDurableBoundary<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const dispatch = new AbortController();
  const timeout = setTimeout(
    () => dispatch.abort(),
    durableMutationTimeoutMs,
  );
  try {
    return await operation(dispatch.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function releaseKnownClaim(
  store: SharedCellAuthorCompensationOperationStore,
  handle: Readonly<SharedCellAuthorCompensationClaimHandle>,
): Promise<void> {
  const cleanup = new AbortController();
  const timeout = setTimeout(() => cleanup.abort(), claimReleaseTimeoutMs);
  try {
    await store.releaseClaim({ handle, signal: cleanup.signal });
  } catch {
    // A stale or failed cleanup remains bounded by the database lease.
  } finally {
    clearTimeout(timeout);
  }
}

async function assertLifecycleAction(
  claim: SharedCellAuthorCompensationClaim,
  request: SharedCellAuthorCompensationLifecycleActionRequest,
): Promise<void> {
  const action = claim.snapshot.currentLifecycleAction;
  const requestSha256 =
    await sharedCellAuthorCompensationLifecycleActionRequestSha256(request);
  if (
    claim.mode !== "RECOVER_ONLY" ||
    !action ||
    action.status !== "recover_only" ||
    action.operationSha256 !== request.operationSha256 ||
    action.phase !== request.phase ||
    action.windowNumber !== request.windowNumber ||
    action.kind !== request.kind ||
    canonicalJson(action.request) !== canonicalJson(request) ||
    action.requestSha256 !== requestSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_MISMATCH",
      "The durable lifecycle write-ahead action does not match the exact request.",
    );
  }
}

async function claim(
  input: CommonInput,
  supplied?: Readonly<SharedCellAuthorCompensationClaim>,
): Promise<Readonly<SharedCellAuthorCompensationClaim>> {
  input.signal.throwIfAborted();
  const claimed =
    supplied ??
    (await input.store.claimExactOperation({
      operationSha256: input.contract.operationSha256,
      workerId: input.workerId,
      leaseDurationMs: input.leaseDurationMs,
      signal: input.signal,
    }));
  if (!claimed) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_CLAIM_REJECTED",
      "The exact lifecycle operation could not be claimed.",
      true,
    );
  }
  if (
    claimed.handle.operationSha256 !== input.contract.operationSha256 ||
    claimed.handle.workerId !== input.workerId ||
    claimed.handle.stateRevision !== claimed.snapshot.operation.stateRevision ||
    claimed.snapshot.operation.leaseOwner !== input.workerId ||
    claimed.snapshot.operation.claimToken !== claimed.handle.claimToken ||
    claimed.snapshot.operation.leaseAttempt !== claimed.handle.leaseAttempt ||
    claimed.snapshot.operation.leaseExpiresAt !== claimed.handle.leaseExpiresAt
  ) {
    await releaseKnownClaim(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_CLAIM_REJECTED",
      "The supplied lifecycle claim does not match the exact durable operation fence.",
      true,
    );
  }
  try {
    assertWindow(claimed, input.contract);
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
  return claimed;
}

async function completeGrant(
  input: CommonInput,
  request: Extract<
    SharedCellAuthorCompensationLifecycleActionRequest,
    { kind: "GRANT" }
  >,
  actionClaim: SharedCellAuthorCompensationClaim,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  const evidence = await input.receiptProducer.reviewTarget({
    contract: input.contract,
    signal: input.signal,
  });
  const receipt = await input.receiptProducer.createPhaseGrantReceipt({
    contract: input.contract,
    evidence,
  });
  const action = actionClaim.snapshot.currentLifecycleAction;
  if (!action) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_MISMATCH",
      "The lifecycle action disappeared before its completion CAS.",
    );
  }
  const completed = await input.store.completeLifecycleAction({
    handle: actionClaim.handle,
    actionNumber: action.actionNumber,
    receipt,
    signal: input.signal,
  });
  const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(receipt);
  const completedAction = completed?.snapshot.currentLifecycleAction;
  if (
    !completed ||
    !completed.claim ||
    completed.claim.mode !== "PREPARE" ||
    completed.snapshot.operation.state !==
      `${phaseStatePrefix[input.contract.phase]}_ready` ||
    completed.snapshot.operation.currentGrantReceiptSha256 !== receiptSha256 ||
    !completedAction ||
    completedAction.kind !== "GRANT" ||
    completedAction.status !== "completed" ||
    canonicalJson(completedAction.request) !== canonicalJson(request) ||
    completedAction.requestSha256 !==
      (await sharedCellAuthorCompensationLifecycleActionRequestSha256(request)) ||
    completedAction.completionReceiptSha256 !== receiptSha256 ||
    !completedAction.completionReceipt ||
    canonicalJson(completedAction.completionReceipt) !== canonicalJson(receipt)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_COMPLETION_CAS_REJECTED",
      "The verified grant could not be committed at the exact lifecycle fence.",
      true,
    );
  }
  return immutable({
    request,
    requestSha256:
      await sharedCellAuthorCompensationLifecycleActionRequestSha256(request),
    receipt,
    receiptSha256,
    snapshot: completed.snapshot,
    claim: completed.claim,
  });
}

async function completeRevoke(
  input: CommonInput,
  request: Extract<
    SharedCellAuthorCompensationLifecycleActionRequest,
    { kind: "REVOKE" }
  >,
  actionClaim: SharedCellAuthorCompensationClaim,
  grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt,
  completionReceipt?: SharedCellAuthorCompensationPhaseCompletionReceipt,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  const evidence = await input.receiptProducer.reviewTarget({
    contract: input.contract,
    signal: input.signal,
  });
  let receipt: SharedCellAuthorCompensationLifecycleActionCompletionReceipt;
  if (request.reason === "PHASE_COMPLETED") {
    if (!completionReceipt) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
        "The completed-phase revoke recovery requires its completion receipt.",
      );
    }
    receipt =
      await input.receiptProducer.createPhaseCompletedLockedReceipt({
        contract: input.contract,
        evidence,
        completionReceipt,
      });
  } else {
    receipt = await input.receiptProducer.createWindowExpiredLockedReceipt({
      contract: input.contract,
      evidence,
      grantReceipt,
    });
  }
  const action = actionClaim.snapshot.currentLifecycleAction;
  if (!action) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_MISMATCH",
      "The lifecycle action disappeared before its completion CAS.",
    );
  }
  const completed = await input.store.completeLifecycleAction({
    handle: actionClaim.handle,
    actionNumber: action.actionNumber,
    receipt,
    signal: input.signal,
  });
  const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(receipt);
  const expectedState =
    request.reason === "WINDOW_EXPIRED"
      ? `${phaseStatePrefix[input.contract.phase]}_review`
      : completionReceipt?.observedState === "MISSING"
        ? "missing_proven_locked"
        : input.contract.phase === "DELETE_CHANGE_SET"
          ? "awaiting_delete_stack_review"
          : null;
  const expectedCurrentPhase =
    request.reason === "WINDOW_EXPIRED"
      ? input.contract.phase
      : expectedState === "awaiting_delete_stack_review"
        ? "DELETE_STACK"
        : null;
  if (
    expectedState === null ||
    !completed ||
    completed.claim !== null ||
    completed.snapshot.operation.state !==
      (request.reason === "WINDOW_EXPIRED"
        ? `awaiting_${expectedState}`
        : expectedState) ||
    completed.snapshot.operation.currentPhase !== expectedCurrentPhase ||
    completed.snapshot.operation.currentWindowNumber !== null ||
    completed.snapshot.operation.currentAttemptNumber !== null ||
    completed.snapshot.operation.leaseOwner !== null ||
    completed.snapshot.operation.claimToken !== null ||
    completed.snapshot.operation.leaseExpiresAt !== null ||
    completed.snapshot.operation.currentGrantReceiptSha256 !== null ||
    completed.snapshot.currentLifecycleAction !== null ||
    (expectedState === "missing_proven_locked") !==
      (completed.snapshot.operation.completedAt !== null)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_COMPLETION_CAS_REJECTED",
      "The verified Locked state could not close the exact lifecycle action.",
      true,
    );
  }
  return immutable({
    request,
    requestSha256:
      await sharedCellAuthorCompensationLifecycleActionRequestSha256(request),
    receipt,
    receiptSha256,
    snapshot: completed.snapshot,
    claim: null,
  });
}

export async function executeClaimedSharedCellAuthorCompensationPhaseGrant(
  input: CommonInput & {
    mutations: SharedCellAuthorCompensationPhaseGrantMutationPort;
  },
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  if (
    !exactKeys(input, [
      "approvedLifecycleContractSha256",
      "contract",
      "leaseDurationMs",
      "mutations",
      "receiptProducer",
      "signal",
      "store",
      "workerId",
    ]) ||
    !input.mutations ||
    typeof input.mutations.installPhaseGrant !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      "The phase grant controller input is invalid.",
    );
  }
  assertCommonInput(input);
  await assertApprovedLifecycleContract(
    input.contract,
    input.approvedLifecycleContractSha256,
  );
  const request =
    (await compileSharedCellAuthorCompensationGrantActionRequest(
      input.contract,
    )) as Extract<
      SharedCellAuthorCompensationLifecycleActionRequest,
      { kind: "GRANT" }
    >;
  const claimed = await claim(input);
  if (
    claimed.mode !== "PREPARE" ||
    claimed.snapshot.operation.state !==
      `${phaseStatePrefix[input.contract.phase]}_prepared` ||
    claimed.snapshot.currentLifecycleAction !== null
  ) {
    await releaseKnownClaim(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_STATE_MISMATCH",
      "The phase is not eligible for a new grant write-ahead action.",
    );
  }
  let prepared: Readonly<SharedCellAuthorCompensationClaim> | null;
  try {
    input.signal.throwIfAborted();
    prepared = await runIndependentDurableBoundary((boundarySignal) =>
      input.store.beginLifecycleAction({
        handle: claimed.handle,
        windowNumber: input.contract.windowNumber,
        request,
        signal: boundarySignal,
      }),
    );
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
  if (!prepared) {
    await releaseKnownClaim(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_REJECTED",
      "The phase grant write-ahead CAS was rejected; no mutation was delegated.",
      true,
    );
  }
  try {
    await assertLifecycleAction(prepared, request);
  } catch (error) {
    await releaseKnownClaim(input.store, prepared.handle);
    throw error;
  }
  try {
    await runIndependentDurableBoundary((signal) =>
      input.mutations.installPhaseGrant({ request, signal }),
    );
    return await completeGrant(input, request, prepared);
  } catch (error) {
    if (
      error instanceof SharedCellAuthorCompensationGrantControllerError &&
      error.code.endsWith("COMPLETION_CAS_REJECTED")
    ) {
      await releaseKnownClaim(input.store, prepared.handle);
      throw error;
    }
    await releaseKnownClaim(input.store, prepared.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
      "The phase grant may have been accepted after durable write-ahead; recover by readback and never replay it.",
      true,
    );
  }
}

export async function recoverClaimedSharedCellAuthorCompensationPhaseGrant(
  input: CommonInput,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  if (
    !exactKeys(input, [
      "approvedLifecycleContractSha256",
      "contract",
      "leaseDurationMs",
      "receiptProducer",
      "signal",
      "store",
      "workerId",
    ])
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      "The phase grant recovery input is invalid.",
    );
  }
  assertCommonInput(input);
  await assertApprovedLifecycleContract(
    input.contract,
    input.approvedLifecycleContractSha256,
  );
  const request =
    (await compileSharedCellAuthorCompensationGrantActionRequest(
      input.contract,
    )) as Extract<
      SharedCellAuthorCompensationLifecycleActionRequest,
      { kind: "GRANT" }
    >;
  const claimed = await claim(input);
  try {
    await assertLifecycleAction(claimed, request);
    return await completeGrant(input, request, claimed);
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
}

interface RevokeInput extends CommonInput {
  reason: "PHASE_COMPLETED" | "WINDOW_EXPIRED";
  grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
  completionReceipt?: SharedCellAuthorCompensationPhaseCompletionReceipt;
}

async function revokeRequest(
  input: RevokeInput,
): Promise<Extract<
  SharedCellAuthorCompensationLifecycleActionRequest,
  { kind: "REVOKE" }
>> {
  const compileInput =
    input.reason === "PHASE_COMPLETED"
      ? {
          contract: input.contract,
          reason: input.reason,
          grantReceipt: input.grantReceipt,
          completionReceipt: input.completionReceipt,
        }
      : {
          contract: input.contract,
          reason: input.reason,
          grantReceipt: input.grantReceipt,
        };
  return (await compileSharedCellAuthorCompensationRevokeActionRequest(
    compileInput,
  )) as Extract<
    SharedCellAuthorCompensationLifecycleActionRequest,
    { kind: "REVOKE" }
  >;
}

async function assertRevokePredecessors(
  claimValue: SharedCellAuthorCompensationClaim,
  request: Extract<
    SharedCellAuthorCompensationLifecycleActionRequest,
    { kind: "REVOKE" }
  >,
  grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt,
  completionReceipt?: SharedCellAuthorCompensationPhaseCompletionReceipt,
  requireCompletedGrantAction = false,
): Promise<void> {
  const snapshot = claimValue.snapshot;
  const grantAction = snapshot.currentLifecycleAction;
  if (
    snapshot.operation.currentGrantReceiptSha256 !== request.grantReceiptSha256 ||
    (requireCompletedGrantAction &&
      (!grantAction ||
        grantAction.kind !== "GRANT" ||
        grantAction.status !== "completed" ||
        grantAction.completionReceiptSha256 !== request.grantReceiptSha256 ||
        !grantAction.completionReceipt ||
        canonicalJson(grantAction.completionReceipt) !==
          canonicalJson(grantReceipt) ||
        grantAction.request.kind !== "GRANT" ||
        grantAction.requestSha256 !==
          (await sharedCellAuthorCompensationLifecycleActionRequestSha256(
            grantAction.request,
          )))) ||
    (request.reason === "PHASE_COMPLETED" &&
      (snapshot.currentAttempt?.completionReceiptSha256 !==
        request.completionReceiptSha256 ||
        !snapshot.currentAttempt.completionReceipt ||
        !completionReceipt ||
        canonicalJson(snapshot.currentAttempt.completionReceipt) !==
          canonicalJson(completionReceipt)))
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_RECEIPT_MISMATCH",
      "The durable revoke predecessors do not match the exact receipts.",
    );
  }
}

export async function executeClaimedSharedCellAuthorCompensationPhaseRevoke(
  input: RevokeInput & {
    claim?: Readonly<SharedCellAuthorCompensationClaim>;
    mutations: SharedCellAuthorCompensationPhaseRevokeMutationPort;
  },
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  const expectedKeys = [
    "approvedLifecycleContractSha256",
    "contract",
    "grantReceipt",
    "leaseDurationMs",
    "mutations",
    "reason",
    "receiptProducer",
    "signal",
    "store",
    "workerId",
    ...(input.claim === undefined ? [] : ["claim"]),
    ...(input.reason === "PHASE_COMPLETED" ? ["completionReceipt"] : []),
  ];
  if (
    !exactKeys(input, expectedKeys) ||
    !input.mutations ||
    typeof input.mutations.revokePhaseGrant !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      "The phase revoke controller input is invalid.",
    );
  }
  assertCommonInput(input);
  await assertApprovedLifecycleContract(
    input.contract,
    input.approvedLifecycleContractSha256,
  );
  const request = await revokeRequest(input);
  const claimed = await claim(input, input.claim);
  const expectedState = `${phaseStatePrefix[input.contract.phase]}_${
    input.reason === "PHASE_COMPLETED" ? "revoke_required" : "ready"
  }`;
  if (
    claimed.mode !==
      (input.reason === "PHASE_COMPLETED" ? "RECOVER_ONLY" : "PREPARE") ||
    claimed.snapshot.operation.state !== expectedState ||
    claimed.snapshot.currentLifecycleAction?.status === "recover_only"
  ) {
    await releaseKnownClaim(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_STATE_MISMATCH",
      "The phase is not eligible for a new revoke write-ahead action.",
    );
  }
  try {
    await assertRevokePredecessors(
      claimed,
      request,
      input.grantReceipt,
      input.completionReceipt,
      true,
    );
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
  let prepared: Readonly<SharedCellAuthorCompensationClaim> | null;
  try {
    input.signal.throwIfAborted();
    prepared = await runIndependentDurableBoundary((boundarySignal) =>
      input.store.beginLifecycleAction({
        handle: claimed.handle,
        windowNumber: input.contract.windowNumber,
        request,
        signal: boundarySignal,
      }),
    );
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
  if (!prepared) {
    await releaseKnownClaim(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_WRITE_AHEAD_REJECTED",
      "The phase revoke write-ahead CAS was rejected; no mutation was delegated.",
      true,
    );
  }
  try {
    await assertLifecycleAction(prepared, request);
  } catch (error) {
    await releaseKnownClaim(input.store, prepared.handle);
    throw error;
  }
  try {
    await runIndependentDurableBoundary((signal) =>
      input.mutations.revokePhaseGrant({ request, signal }),
    );
    return await completeRevoke(
      input,
      request,
      prepared,
      input.grantReceipt,
      input.completionReceipt,
    );
  } catch (error) {
    if (
      error instanceof SharedCellAuthorCompensationGrantControllerError &&
      error.code.endsWith("COMPLETION_CAS_REJECTED")
    ) {
      await releaseKnownClaim(input.store, prepared.handle);
      throw error;
    }
    await releaseKnownClaim(input.store, prepared.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_POST_SUBMIT_UNCERTAIN",
      "The phase revoke may have been accepted after durable write-ahead; recover by readback and never replay it.",
      true,
    );
  }
}

export async function recoverClaimedSharedCellAuthorCompensationPhaseRevoke(
  input: RevokeInput,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleControlledResult>> {
  const expectedKeys = [
    "approvedLifecycleContractSha256",
    "contract",
    "grantReceipt",
    "leaseDurationMs",
    "reason",
    "receiptProducer",
    "signal",
    "store",
    "workerId",
    ...(input.reason === "PHASE_COMPLETED" ? ["completionReceipt"] : []),
  ];
  if (!exactKeys(input, expectedKeys)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_INPUT_INVALID",
      "The phase revoke recovery input is invalid.",
    );
  }
  assertCommonInput(input);
  await assertApprovedLifecycleContract(
    input.contract,
    input.approvedLifecycleContractSha256,
  );
  const request = await revokeRequest(input);
  const claimed = await claim(input);
  try {
    await assertLifecycleAction(claimed, request);
    await assertRevokePredecessors(
      claimed,
      request,
      input.grantReceipt,
      input.completionReceipt,
    );
    return await completeRevoke(
      input,
      request,
      claimed,
      input.grantReceipt,
      input.completionReceipt,
    );
  } catch (error) {
    await releaseKnownClaim(input.store, claimed.handle);
    throw error;
  }
}
