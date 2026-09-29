import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  compileSharedCellAuthorCompensationPlan,
  executeReviewedSharedCellAuthorDeleteChangeSet,
  executeReviewedSharedCellAuthorDeleteStack,
  inspectSharedCellAuthorDeleteChangeSet,
  inspectSharedCellAuthorDeleteStack,
  recoverReviewedSharedCellAuthorDeleteChangeSet,
  recoverReviewedSharedCellAuthorDeleteStack,
  SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
  SHARED_CELL_AUTHOR_COMPENSATION_REGION,
  type SharedCellAuthorCompensationCandidate,
  type SharedCellAuthorCompensationPhase,
  type SharedCellAuthorCompensationReadPort,
  type SharedCellAuthorDeleteChangeSetInspectionSummary,
  type SharedCellAuthorDeleteChangeSetMutationPort,
  type SharedCellAuthorDeleteChangeSetRecoverySummary,
  type SharedCellAuthorDeleteChangeSetSummary,
  type SharedCellAuthorDeleteStackInspectionSummary,
  type SharedCellAuthorDeleteStackMutationPort,
  type SharedCellAuthorDeleteStackRecoverySummary,
  type SharedCellAuthorDeleteStackSummary,
  type StrongSharedCellAuthorAuthorityReadPort,
} from "./shared-cell-author-compensation.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "./shared-cell-cleanup-authority.ts";
import {
  assertSharedCellAuthorCompensationPhaseGrantReceipt,
  SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS,
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationClaimHandle,
  type SharedCellAuthorCompensationMutationRequest,
  type SharedCellAuthorCompensationOperationSnapshot,
  type SharedCellAuthorCompensationOperationStore,
  type SharedCellAuthorCompensationPhaseCompletionReceipt,
  type SharedCellAuthorCompensationPhaseGrantReceipt,
  type SharedCellAuthorCompensationSubmissionReceipt,
} from "./shared-cell-author-compensation-operation-store.ts";

/**
 * J5g-j2 is deliberately dormant. Importing this module never constructs an
 * AWS or Neon client and no default runtime wires these functions online.
 */
export const SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_DEFAULT_ENABLED =
  false as const;

export const SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CONTRACT_VERSION =
  "j5g-j2/v1" as const;

const phaseCapability = Object.freeze({
  DELETE_CHANGE_SET: "cloudformation:DeleteChangeSet",
  DELETE_STACK: "cloudformation:DeleteStack",
} as const);

const phaseGrantShape = Object.freeze({
  DELETE_CHANGE_SET: "AuthorCompensationDeleteChangeSetGrant",
  DELETE_STACK: "AuthorCompensationDeleteStackGrant",
} as const);

const phaseRevokeState = Object.freeze({
  DELETE_CHANGE_SET: "delete_change_set_revoke_required",
  DELETE_STACK: "delete_stack_revoke_required",
} as const);

const phasePreparedState = Object.freeze({
  DELETE_CHANGE_SET: "delete_change_set_prepared",
  DELETE_STACK: "delete_stack_prepared",
} as const);

const phaseReadyState = Object.freeze({
  DELETE_CHANGE_SET: "delete_change_set_ready",
  DELETE_STACK: "delete_stack_ready",
} as const);

const phaseRecoverOnlyState = Object.freeze({
  DELETE_CHANGE_SET: "delete_change_set_recover_only",
  DELETE_STACK: "delete_stack_recover_only",
} as const);

const digestPattern = /^[a-f0-9]{64}$/;
const claimReleaseTimeoutMs = 5_000;

export class SharedCellAuthorCompensationControllerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "SharedCellAuthorCompensationControllerError";
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellAuthorCompensationControllerError(
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

function assertExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(record(value));
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_INPUT_INVALID",
      "The controller input contains missing or unexpected fields.",
    );
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_DIGEST_INVALID",
      `${label} must be a full lowercase SHA-256 digest.`,
    );
  }
}

function assertPhase(
  value: unknown,
): asserts value is SharedCellAuthorCompensationPhase {
  if (value !== "DELETE_CHANGE_SET" && value !== "DELETE_STACK") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PHASE_INVALID",
      "The compensation controller phase is invalid.",
    );
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_INPUT_INVALID",
      `${label} must be a positive safe integer.`,
    );
  }
}

function assertNarrowMutationPort(
  phase: SharedCellAuthorCompensationPhase,
  value: unknown,
): void {
  const method =
    phase === "DELETE_CHANGE_SET" ? "deleteChangeSet" : "deleteStack";
  const sibling =
    phase === "DELETE_CHANGE_SET" ? "deleteStack" : "deleteChangeSet";
  const source = record(value);
  if (
    source.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    typeof source.getCallerIdentity !== "function" ||
    typeof source[method] !== "function" ||
    typeof source[sibling] !== "undefined"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_MUTATION_PORT_INVALID",
      `The ${phase} phase requires its exact narrow mutation port.`,
    );
  }
}

function immutable<T>(value: T): Readonly<T> {
  return Object.freeze(structuredClone(value));
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function mutationFor(
  candidate: SharedCellAuthorCompensationCandidate,
  phase: SharedCellAuthorCompensationPhase,
  deleteStackClientRequestToken: string,
): SharedCellAuthorCompensationMutationRequest {
  return phase === "DELETE_CHANGE_SET"
    ? {
        phase,
        request: {
          ChangeSetName: candidate.changeSet.arn,
          StackName: candidate.stackId,
        },
      }
    : {
        phase,
        request: {
          StackName: candidate.stackId,
          DeletionMode: "STANDARD",
          ClientRequestToken: deleteStackClientRequestToken,
        },
      };
}

export interface SharedCellAuthorCompensationControllerContract {
  readonly schemaVersion: 1;
  readonly controllerContractVersion: typeof SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CONTRACT_VERSION;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly callerIdentityFence: Readonly<{
    evidenceReadCallerArn: typeof SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN;
    mutationWriteCallerArn: typeof SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN;
  }>;
  readonly authorityFence: Readonly<{
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    expectedItem: null;
    expectedRevision: 0;
  }>;
  readonly phaseCapability: (typeof phaseCapability)[SharedCellAuthorCompensationPhase];
  readonly grantSafetyMarginsMs: Readonly<{
    DELETE_CHANGE_SET: number;
    DELETE_STACK: number;
  }>;
  readonly exactMutation: Readonly<SharedCellAuthorCompensationMutationRequest>;
  readonly expectedGrantShape: (typeof phaseGrantShape)[SharedCellAuthorCompensationPhase];
  readonly controllerContractSha256: string;
}

/**
 * Pure, versioned controller contract compiler. It binds the stable operation,
 * the reviewed grant window plans and the only mutation this phase may own.
 */
export async function compileSharedCellAuthorCompensationControllerContract(
  candidate: SharedCellAuthorCompensationCandidate,
  phase: SharedCellAuthorCompensationPhase,
): Promise<Readonly<SharedCellAuthorCompensationControllerContract>> {
  assertPhase(phase);
  const plan = await compileSharedCellAuthorCompensationPlan(candidate);
  const contract = {
    schemaVersion: 1 as const,
    controllerContractVersion:
      SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CONTRACT_VERSION,
    phase,
    operationSha256: plan.operationSha256,
    compensationPlanSha256: plan.compensationPlanSha256,
    phasePlanSha256: plan.phasePlanSha256[phase],
    callerIdentityFence: {
      evidenceReadCallerArn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
      mutationWriteCallerArn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
    },
    authorityFence: {
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expectedItem: null,
      expectedRevision: 0 as const,
    },
    phaseCapability: phaseCapability[phase],
    grantSafetyMarginsMs: {
      DELETE_CHANGE_SET:
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS.DELETE_CHANGE_SET,
      DELETE_STACK:
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS.DELETE_STACK,
    },
    exactMutation: mutationFor(
      candidate,
      phase,
      plan.deleteStackClientRequestToken,
    ),
    expectedGrantShape: phaseGrantShape[phase],
  };
  const controllerContractSha256 = await sha256Hex(contract);
  return immutable({ ...contract, controllerContractSha256 });
}

type InspectionSummary =
  | SharedCellAuthorDeleteChangeSetInspectionSummary
  | SharedCellAuthorDeleteStackInspectionSummary;

type CompletionSummary =
  | SharedCellAuthorDeleteChangeSetSummary
  | SharedCellAuthorDeleteStackSummary
  | SharedCellAuthorDeleteChangeSetRecoverySummary
  | SharedCellAuthorDeleteStackRecoverySummary;

interface ReviewBaseInput {
  store: SharedCellAuthorCompensationOperationStore;
  environmentId: string;
  phase: SharedCellAuthorCompensationPhase;
  candidate: SharedCellAuthorCompensationCandidate;
  evidence: SharedCellAuthorCompensationReadPort;
  authority: StrongSharedCellAuthorAuthorityReadPort;
  signal: AbortSignal;
  now?: () => number;
}

export interface SharedCellAuthorCompensationReviewedPhase {
  readonly contract: Readonly<SharedCellAuthorCompensationControllerContract>;
  readonly inspection: Readonly<InspectionSummary>;
  readonly snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  readonly windowNumber: number;
}

/**
 * Performs only read-side provider inspection, then appends an immutable DB
 * review window. A non-actionable observation is never persisted as a grant
 * authorization.
 */
export async function inspectAndReviewSharedCellAuthorCompensationPhase(
  input: ReviewBaseInput,
): Promise<Readonly<SharedCellAuthorCompensationReviewedPhase>> {
  assertExactKeys(
    input,
    [
      "authority",
      "candidate",
      "environmentId",
      "evidence",
      "phase",
      "signal",
      "store",
    ],
    ["now"],
  );
  assertPhase(input.phase);
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    input.candidate,
    input.phase,
  );
  const inspection: InspectionSummary =
    input.phase === "DELETE_CHANGE_SET"
      ? await inspectSharedCellAuthorDeleteChangeSet({
          evidence: input.evidence,
          authority: input.authority,
          candidate: input.candidate,
          signal: input.signal,
          ...(input.now === undefined ? {} : { now: input.now }),
        })
      : await inspectSharedCellAuthorDeleteStack({
          evidence: input.evidence,
          authority: input.authority,
          candidate: input.candidate,
          signal: input.signal,
          ...(input.now === undefined ? {} : { now: input.now }),
        });

  if (!inspection.readyForPhase) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PHASE_NOT_REVIEWABLE",
      `The exact ${input.phase} target is not in a state that can authorize this phase.`,
    );
  }
  if (
    inspection.operationSha256 !== contract.operationSha256 ||
    inspection.compensationPlanSha256 !== contract.compensationPlanSha256 ||
    inspection.phasePlanSha256 !== contract.phasePlanSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_RECOMPUTE_MISMATCH",
      "The read-only inspection drifted from the freshly compiled controller contract.",
    );
  }

  const loaded = await input.store.createOrLoadOperation({
    candidate: input.candidate,
    environmentId: input.environmentId,
    signal: input.signal,
  });
  if (loaded.snapshot.operation.operationSha256 !== contract.operationSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_OPERATION_MISMATCH",
      "The durable operation does not match the reviewed operation digest.",
    );
  }
  const appended = await input.store.appendReviewedWindow({
    operationSha256: contract.operationSha256,
    expectedStateRevision: loaded.snapshot.operation.stateRevision,
    phase: input.phase,
    candidate: input.candidate,
    approvedCompensationPlanSha256: contract.compensationPlanSha256,
    approvedPhasePlanSha256: contract.phasePlanSha256,
    controllerContractSha256: contract.controllerContractSha256,
    signal: input.signal,
  });
  if (
    !appended ||
    !appended.currentWindow ||
    appended.currentWindow.phase !== input.phase ||
    appended.currentWindow.controllerContractSha256 !==
      contract.controllerContractSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_REVIEW_CAS_REJECTED",
      "The immutable reviewed window could not be appended at the exact operation revision.",
      true,
    );
  }
  return immutable({
    contract,
    inspection,
    snapshot: appended,
    windowNumber: appended.currentWindow.windowNumber,
  });
}

interface ExecuteBaseInput {
  store: SharedCellAuthorCompensationOperationStore;
  workerId: string;
  leaseDurationMs: number;
  windowNumber: number;
  candidate: SharedCellAuthorCompensationCandidate;
  approvedControllerContractSha256: string;
  grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
  /** Read only after provider evidence completes; DB time remains authoritative. */
  completionObservedAt: () => string;
  evidence: SharedCellAuthorCompensationReadPort;
  authority: StrongSharedCellAuthorAuthorityReadPort;
  signal: AbortSignal;
  now?: () => number;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export type ExecuteClaimedSharedCellAuthorCompensationPhaseInput =
  ExecuteBaseInput &
    (
      | {
          phase: "DELETE_CHANGE_SET";
          mutations: SharedCellAuthorDeleteChangeSetMutationPort;
        }
      | {
          phase: "DELETE_STACK";
          mutations: SharedCellAuthorDeleteStackMutationPort;
        }
    );

export interface SharedCellAuthorCompensationRevokeHandoff {
  readonly schemaVersion: 1;
  readonly action: "revoke_shared_cell_author_compensation_phase_grant";
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly controllerContractSha256: string;
  readonly completionReceiptSha256: string;
  readonly previousRendererShape: (typeof phaseGrantShape)[SharedCellAuthorCompensationPhase];
  readonly targetRendererShape: "Locked";
  readonly nextAfterLocked: "DELETE_STACK_REVIEW" | "COMPLETE";
  readonly safeToRevokePhaseGrant: true;
  readonly safeToFinalAuthorRevoke: boolean;
  readonly handoffSha256: string;
}

export interface SharedCellAuthorCompensationControlledResult {
  readonly summary: Readonly<CompletionSummary>;
  readonly completionReceipt: Readonly<SharedCellAuthorCompensationPhaseCompletionReceipt>;
  readonly completionReceiptSha256: string;
  readonly revokeHandoff: Readonly<SharedCellAuthorCompensationRevokeHandoff>;
  readonly snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
}

function assertContractApproval(
  contract: Readonly<SharedCellAuthorCompensationControllerContract>,
  approved: string,
): void {
  assertDigest(approved, "approvedControllerContractSha256");
  if (contract.controllerContractSha256 !== approved) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CONTRACT_MISMATCH",
      "The freshly compiled controller contract does not match the approved digest.",
    );
  }
}

function assertGrantReceipt(
  receipt: SharedCellAuthorCompensationPhaseGrantReceipt,
  contract: Readonly<SharedCellAuthorCompensationControllerContract>,
): void {
  assertSharedCellAuthorCompensationPhaseGrantReceipt(receipt);
  if (
    receipt.operationSha256 !== contract.operationSha256 ||
    receipt.phase !== contract.phase ||
    receipt.compensationPlanSha256 !== contract.compensationPlanSha256 ||
    receipt.phasePlanSha256 !== contract.phasePlanSha256 ||
    receipt.controllerContractSha256 !== contract.controllerContractSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_GRANT_MISMATCH",
      "The verified phase grant receipt does not match the exact controller contract.",
    );
  }
}

function assertClaimWindow(
  snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>,
  contract: Readonly<SharedCellAuthorCompensationControllerContract>,
  windowNumber: number,
): void {
  const window = snapshot.currentWindow;
  if (
    snapshot.operation.operationSha256 !== contract.operationSha256 ||
    !window ||
    window.windowNumber !== windowNumber ||
    window.phase !== contract.phase ||
    window.compensationPlanSha256 !== contract.compensationPlanSha256 ||
    window.phasePlanSha256 !== contract.phasePlanSha256 ||
    window.controllerContractSha256 !== contract.controllerContractSha256
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_WINDOW_MISMATCH",
      "The claimed durable operation is not bound to the exact reviewed window.",
    );
  }
}

async function releaseBeforeSubmission(
  store: SharedCellAuthorCompensationOperationStore,
  handle: Readonly<SharedCellAuthorCompensationClaimHandle>,
): Promise<void> {
  const cleanup = new AbortController();
  const timeout = setTimeout(() => cleanup.abort(), claimReleaseTimeoutMs);
  try {
    await store.releaseClaim({ handle, signal: cleanup.signal });
  } catch {
    // A failed release is bounded by the DB lease. Never hide the main error.
  } finally {
    clearTimeout(timeout);
  }
}

async function finishControlledPhase(
  store: SharedCellAuthorCompensationOperationStore,
  contract: Readonly<SharedCellAuthorCompensationControllerContract>,
  submission: Readonly<SharedCellAuthorCompensationSubmissionReceipt>,
  summary: Readonly<CompletionSummary>,
  completionObservedAt: string,
  signal: AbortSignal,
): Promise<Readonly<SharedCellAuthorCompensationControlledResult>> {
  if (
    summary.phase !== contract.phase ||
    summary.operationSha256 !== contract.operationSha256 ||
    summary.compensationPlanSha256 !== contract.compensationPlanSha256 ||
    summary.phasePlanSha256 !== contract.phasePlanSha256 ||
    summary.safeToRevokePhaseGrant !== true
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_COMPLETION_MISMATCH",
      "The phase result does not prove the exact controller contract complete.",
    );
  }
  if (
    summary.observedState !== "REVIEW_IN_PROGRESS" &&
    summary.observedState !== "MISSING"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_COMPLETION_MISMATCH",
      "The phase result is not a terminal target-absence observation.",
    );
  }
  const observedState: "REVIEW_IN_PROGRESS" | "MISSING" =
    summary.observedState;
  const completionReceipt = immutable({
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_phase_completed" as const,
    operationSha256: contract.operationSha256,
    phase: contract.phase,
    compensationPlanSha256: contract.compensationPlanSha256,
    phasePlanSha256: contract.phasePlanSha256,
    controllerContractSha256: contract.controllerContractSha256,
    observedState,
    mutationPerformed: summary.mutationPerformed,
    evidenceSha256: await sha256Hex(summary),
    observedAt: completionObservedAt,
  }) satisfies SharedCellAuthorCompensationPhaseCompletionReceipt;
  // Validate and hash before the DB terminal CAS. A malformed caller-supplied
  // observation timestamp must not commit a receipt and fail only afterwards.
  const completionReceiptSha256 =
    await sharedCellAuthorCompensationReceiptSha256(completionReceipt);
  const completed = await store.completePhase({
    handle: submission.handle,
    attemptNumber: submission.attemptNumber,
    completionReceipt,
    signal,
  });
  if (
    !completed ||
    completed.snapshot.operation.state !== phaseRevokeState[contract.phase] ||
    !completed.snapshot.currentAttempt ||
    completed.snapshot.currentAttempt.status !== "completed" ||
    completed.snapshot.currentAttempt.completionReceiptSha256 !==
      completionReceiptSha256 ||
    !exactJson(
      completed.snapshot.currentAttempt.completionReceipt,
      completionReceipt,
    )
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_COMPLETION_CAS_REJECTED",
      "The recover-only phase attempt could not be completed at the exact claim fence; never replay the mutation.",
      true,
    );
  }
  const handoffBody = {
    schemaVersion: 1 as const,
    action: "revoke_shared_cell_author_compensation_phase_grant" as const,
    operationSha256: contract.operationSha256,
    phase: contract.phase,
    compensationPlanSha256: contract.compensationPlanSha256,
    phasePlanSha256: contract.phasePlanSha256,
    controllerContractSha256: contract.controllerContractSha256,
    completionReceiptSha256,
    previousRendererShape: phaseGrantShape[contract.phase],
    targetRendererShape: "Locked" as const,
    nextAfterLocked:
      contract.phase === "DELETE_CHANGE_SET" && observedState === "REVIEW_IN_PROGRESS"
        ? ("DELETE_STACK_REVIEW" as const)
        : ("COMPLETE" as const),
    safeToRevokePhaseGrant: true as const,
    safeToFinalAuthorRevoke: summary.safeToAuthorRevoke,
  };
  const revokeHandoff = immutable({
    ...handoffBody,
    handoffSha256: await sha256Hex(handoffBody),
  });
  return immutable({
    summary,
    completionReceipt,
    completionReceiptSha256,
    revokeHandoff,
    snapshot: completed.snapshot,
  });
}

/**
 * Runs one exact claimed phase. The narrow wrapper performs the durable
 * PREPARED -> RECOVER_ONLY write-ahead CAS before it delegates the sole AWS
 * mutation. After that boundary every failure must use the read-only recovery
 * entry point; this function never retries a mutation.
 */
export async function executeClaimedSharedCellAuthorCompensationPhase(
  input: ExecuteClaimedSharedCellAuthorCompensationPhaseInput,
): Promise<Readonly<SharedCellAuthorCompensationControlledResult>> {
  assertExactKeys(
    input,
    [
      "approvedControllerContractSha256",
      "authority",
      "candidate",
      "completionObservedAt",
      "evidence",
      "grantReceipt",
      "leaseDurationMs",
      "mutations",
      "phase",
      "signal",
      "store",
      "windowNumber",
      "workerId",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertPhase(input.phase);
  assertPositiveInteger(input.leaseDurationMs, "leaseDurationMs");
  assertPositiveInteger(input.windowNumber, "windowNumber");
  if (typeof input.completionObservedAt !== "function") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_INPUT_INVALID",
      "completionObservedAt must be a post-evidence clock function.",
    );
  }
  assertNarrowMutationPort(input.phase, input.mutations);
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    input.candidate,
    input.phase,
  );
  assertContractApproval(contract, input.approvedControllerContractSha256);
  assertGrantReceipt(input.grantReceipt, contract);
  const grantReceiptSha256 =
    await sharedCellAuthorCompensationReceiptSha256(input.grantReceipt);

  const claimed = await input.store.claimExactOperation({
    operationSha256: contract.operationSha256,
    workerId: input.workerId,
    leaseDurationMs: input.leaseDurationMs,
    signal: input.signal,
  });
  if (!claimed) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CLAIM_REJECTED",
      "The exact durable operation could not be claimed.",
      true,
    );
  }
  let resumePreparedGrant = false;
  try {
    assertClaimWindow(claimed.snapshot, contract, input.windowNumber);
    if (claimed.mode !== "PREPARE") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_RECOVERY_REQUIRED",
        "The phase has crossed its write-ahead boundary and can only use read-only recovery.",
        true,
      );
    }
    const state = claimed.snapshot.operation.state;
    if (state === phaseReadyState[input.phase]) {
      if (
        claimed.snapshot.operation.currentGrantReceiptSha256 !==
        grantReceiptSha256
      ) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_GRANT_MISMATCH",
          "The already prepared phase is not bound to the exact verified grant receipt.",
        );
      }
      resumePreparedGrant = true;
    } else if (state !== phasePreparedState[input.phase]) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_STATE_MISMATCH",
        "The claimed phase is neither awaiting its grant receipt nor safely resumable after that receipt.",
      );
    }
  } catch (error) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    throw error;
  }

  let activeHandle = claimed.handle;
  let submissionBoundaryEntered = false;
  let submission: Readonly<SharedCellAuthorCompensationSubmissionReceipt> | null =
    null;
  let writeAheadFailure: unknown = null;
  try {
    if (!resumePreparedGrant) {
      const prepared = await input.store.preparePhase({
        handle: activeHandle,
        windowNumber: input.windowNumber,
        grantReceipt: input.grantReceipt,
        signal: input.signal,
      });
      if (prepared) activeHandle = prepared.handle;
      if (!prepared || prepared.mode !== "PREPARE") {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PREPARE_CAS_REJECTED",
          "The exact reviewed phase could not be prepared at the durable claim fence.",
          true,
        );
      }
      if (
        prepared.snapshot.operation.state !== phaseReadyState[input.phase] ||
        prepared.snapshot.operation.currentGrantReceiptSha256 !==
          grantReceiptSha256
      ) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_PREPARE_CAS_REJECTED",
          "The prepared durable phase did not preserve the exact verified grant receipt.",
          true,
        );
      }
    }

    const beginSubmission = async (
      mutation: SharedCellAuthorCompensationMutationRequest,
      signal: AbortSignal,
    ): Promise<Readonly<SharedCellAuthorCompensationSubmissionReceipt>> => {
      if (submissionBoundaryEntered) {
        return fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_REPLAY_BLOCKED",
          "The phase mutation boundary may be entered only once.",
        );
      }
      if (!exactJson(mutation, contract.exactMutation)) {
        return fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_REQUEST_MISMATCH",
          "The core mutation request drifted from the exact controller contract.",
        );
      }
      submissionBoundaryEntered = true;
      try {
        const receipt = await input.store.beginSubmission({
          handle: activeHandle,
          windowNumber: input.windowNumber,
          controllerContractSha256: contract.controllerContractSha256,
          mutation,
          signal,
        });
        if (!receipt) {
          fail(
            "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_SUBMISSION_CAS_REJECTED",
            "The phase write-ahead CAS was rejected; no AWS mutation was delegated.",
            true,
          );
        }
        if (
          receipt.snapshot.operation.state !==
            phaseRecoverOnlyState[input.phase] ||
          !receipt.snapshot.currentAttempt ||
          receipt.snapshot.currentAttempt.status !== "recover_only" ||
          receipt.snapshot.currentAttempt.attemptNumber !==
            receipt.attemptNumber ||
          receipt.snapshot.currentAttempt.requestSha256 !==
            receipt.requestSha256 ||
          !exactJson(receipt.snapshot.currentAttempt.request, mutation)
        ) {
          fail(
            "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_SUBMISSION_CAS_REJECTED",
            "The write-ahead receipt did not preserve the exact recover-only mutation attempt.",
            true,
          );
        }
        submission = receipt;
        activeHandle = receipt.handle;
        return receipt;
      } catch (error) {
        writeAheadFailure = error;
        throw error;
      }
    };

    let summary: Readonly<CompletionSummary>;
    if (input.phase === "DELETE_CHANGE_SET") {
      const delegate = input.mutations;
      const mutations: SharedCellAuthorDeleteChangeSetMutationPort = {
        region: delegate.region,
        getCallerIdentity: (value) => delegate.getCallerIdentity(value),
        async deleteChangeSet(value) {
          await beginSubmission(
            { phase: "DELETE_CHANGE_SET", request: value.request },
            value.signal,
          );
          value.signal.throwIfAborted();
          return delegate.deleteChangeSet(value);
        },
      };
      summary = await executeReviewedSharedCellAuthorDeleteChangeSet({
        approvedCompensationPlanSha256: contract.compensationPlanSha256,
        approvedPhasePlanSha256: contract.phasePlanSha256,
        authority: input.authority,
        candidate: input.candidate,
        evidence: input.evidence,
        mutations,
        signal: input.signal,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.readbackAttempts === undefined
          ? {}
          : { readbackAttempts: input.readbackAttempts }),
        ...(input.readbackDelayMs === undefined
          ? {}
          : { readbackDelayMs: input.readbackDelayMs }),
        ...(input.wait === undefined ? {} : { wait: input.wait }),
      });
    } else {
      const delegate = input.mutations;
      const mutations: SharedCellAuthorDeleteStackMutationPort = {
        region: delegate.region,
        getCallerIdentity: (value) => delegate.getCallerIdentity(value),
        async deleteStack(value) {
          await beginSubmission(
            { phase: "DELETE_STACK", request: value.request },
            value.signal,
          );
          value.signal.throwIfAborted();
          return delegate.deleteStack(value);
        },
      };
      summary = await executeReviewedSharedCellAuthorDeleteStack({
        approvedCompensationPlanSha256: contract.compensationPlanSha256,
        approvedPhasePlanSha256: contract.phasePlanSha256,
        authority: input.authority,
        candidate: input.candidate,
        evidence: input.evidence,
        mutations,
        signal: input.signal,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.readbackAttempts === undefined
          ? {}
          : { readbackAttempts: input.readbackAttempts }),
        ...(input.readbackDelayMs === undefined
          ? {}
          : { readbackDelayMs: input.readbackDelayMs }),
        ...(input.wait === undefined ? {} : { wait: input.wait }),
      });
    }

    if (writeAheadFailure) throw writeAheadFailure;
    if (!submission) {
      // The target disappeared after review but before the core needed its
      // mutation. Conservatively create a recover-only attempt before writing
      // completion so every terminal receipt has the same durable fence.
      submission = await beginSubmission(contract.exactMutation, input.signal);
    }
    return await finishControlledPhase(
      input.store,
      contract,
      submission,
      summary,
      input.completionObservedAt(),
      input.signal,
    );
  } catch (error) {
    if (!submissionBoundaryEntered) {
      await releaseBeforeSubmission(input.store, activeHandle);
    }
    if (writeAheadFailure) throw writeAheadFailure;
    throw error;
  }
}

interface RecoverInput {
  store: SharedCellAuthorCompensationOperationStore;
  workerId: string;
  leaseDurationMs: number;
  windowNumber: number;
  phase: SharedCellAuthorCompensationPhase;
  candidate: SharedCellAuthorCompensationCandidate;
  approvedControllerContractSha256: string;
  /** Read only after provider evidence completes; DB time remains authoritative. */
  completionObservedAt: () => string;
  evidence: SharedCellAuthorCompensationReadPort;
  authority: StrongSharedCellAuthorAuthorityReadPort;
  signal: AbortSignal;
  now?: () => number;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Read-only recovery. Its input shape deliberately has no mutation port and it
 * never constructs one. A present target fails closed instead of resubmitting.
 */
export async function recoverClaimedSharedCellAuthorCompensationPhase(
  input: RecoverInput,
): Promise<Readonly<SharedCellAuthorCompensationControlledResult>> {
  assertExactKeys(
    input,
    [
      "approvedControllerContractSha256",
      "authority",
      "candidate",
      "completionObservedAt",
      "evidence",
      "leaseDurationMs",
      "phase",
      "signal",
      "store",
      "windowNumber",
      "workerId",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertPhase(input.phase);
  assertPositiveInteger(input.leaseDurationMs, "leaseDurationMs");
  assertPositiveInteger(input.windowNumber, "windowNumber");
  if (typeof input.completionObservedAt !== "function") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_INPUT_INVALID",
      "completionObservedAt must be a post-evidence clock function.",
    );
  }
  const contract = await compileSharedCellAuthorCompensationControllerContract(
    input.candidate,
    input.phase,
  );
  assertContractApproval(contract, input.approvedControllerContractSha256);
  const claimed = await input.store.claimExactOperation({
    operationSha256: contract.operationSha256,
    workerId: input.workerId,
    leaseDurationMs: input.leaseDurationMs,
    signal: input.signal,
  });
  if (!claimed) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_CLAIM_REJECTED",
      "The exact recover-only operation could not be claimed.",
      true,
    );
  }
  try {
    assertClaimWindow(claimed.snapshot, contract, input.windowNumber);
  } catch (error) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    throw error;
  }
  if (claimed.mode !== "RECOVER_ONLY" || !claimed.snapshot.currentAttempt) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_RECOVERY_NOT_REQUIRED",
      "Read-only recovery is accepted only after a durable write-ahead attempt exists.",
    );
  }
  if (
    claimed.snapshot.operation.state !== phaseRecoverOnlyState[input.phase]
  ) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_RECOVERY_NOT_REQUIRED",
      "A revoke-required phase is complete and must proceed only through the separate Locked handoff.",
    );
  }
  const attempt = claimed.snapshot.currentAttempt;
  if (
    attempt.phase !== input.phase ||
    attempt.windowNumber !== input.windowNumber ||
    attempt.status !== "recover_only" ||
    !exactJson(attempt.request, contract.exactMutation)
  ) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_ATTEMPT_MISMATCH",
      "The recover-only attempt is not bound to the exact phase request.",
    );
  }
  const coreInput = {
    approvedCompensationPlanSha256: contract.compensationPlanSha256,
    approvedPhasePlanSha256: contract.phasePlanSha256,
    authority: input.authority,
    candidate: input.candidate,
    evidence: input.evidence,
    signal: input.signal,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.readbackAttempts === undefined
      ? {}
      : { readbackAttempts: input.readbackAttempts }),
    ...(input.readbackDelayMs === undefined
      ? {}
      : { readbackDelayMs: input.readbackDelayMs }),
    ...(input.wait === undefined ? {} : { wait: input.wait }),
  };
  let summary: Readonly<CompletionSummary>;
  try {
    summary =
      input.phase === "DELETE_CHANGE_SET"
        ? await recoverReviewedSharedCellAuthorDeleteChangeSet(coreInput)
        : await recoverReviewedSharedCellAuthorDeleteStack(coreInput);
  } catch (error) {
    await releaseBeforeSubmission(input.store, claimed.handle);
    throw error;
  }
  const submission: SharedCellAuthorCompensationSubmissionReceipt = {
    handle: claimed.handle,
    attemptNumber: attempt.attemptNumber,
    requestSha256: attempt.requestSha256,
    snapshot: claimed.snapshot,
  };
  return finishControlledPhase(
    input.store,
    contract,
    submission,
    summary,
    input.completionObservedAt(),
    input.signal,
  );
}
