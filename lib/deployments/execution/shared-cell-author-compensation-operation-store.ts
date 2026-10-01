import {
  compileSharedCellAuthorCompensationPlan,
  type SharedCellAuthorCompensationCandidate,
  type SharedCellAuthorCompensationCompiledPlan,
  type SharedCellAuthorCompensationPhase,
} from "./shared-cell-author-compensation.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const claimTokenPattern = /^scac_[a-f0-9]{32}$/;
const canonicalUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumGrantLifetimeMs = 60 * 60_000;

export const SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS = Object.freeze({
  DELETE_CHANGE_SET: 10 * 60_000,
  DELETE_STACK: 5 * 60_000,
} satisfies Record<SharedCellAuthorCompensationPhase, number>);

export const SHARED_CELL_AUTHOR_COMPENSATION_OPERATION_STATES = Object.freeze([
  "awaiting_delete_change_set_review",
  "delete_change_set_prepared",
  "delete_change_set_ready",
  "delete_change_set_recover_only",
  "delete_change_set_revoke_required",
  "awaiting_delete_stack_review",
  "delete_stack_prepared",
  "delete_stack_ready",
  "delete_stack_recover_only",
  "delete_stack_revoke_required",
  "missing_proven_locked",
] as const);

export type SharedCellAuthorCompensationOperationState =
  (typeof SHARED_CELL_AUTHOR_COMPENSATION_OPERATION_STATES)[number];

export class SharedCellAuthorCompensationStoreError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "SharedCellAuthorCompensationStoreError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SharedCellAuthorCompensationClaimHandle {
  readonly operationSha256: string;
  readonly workerId: string;
  readonly claimToken: string;
  readonly leaseAttempt: number;
  readonly stateRevision: number;
  readonly leaseExpiresAt: number;
}

export interface SharedCellAuthorCompensationReviewWindow {
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly windowNumber: number;
  readonly candidate: Readonly<SharedCellAuthorCompensationCandidate>;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly controllerContractSha256: string;
  readonly reviewedAt: number;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface SharedCellAuthorCompensationPhaseAttempt {
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly attemptNumber: number;
  readonly windowNumber: number;
  readonly status: "recover_only" | "completed";
  readonly request: Readonly<SharedCellAuthorCompensationMutationRequest>;
  readonly requestSha256: string;
  readonly clientRequestToken: string | null;
  readonly leaseAttempt: number;
  readonly preparedRevision: number;
  readonly completionReceipt: Readonly<SharedCellAuthorCompensationPhaseCompletionReceipt> | null;
  readonly completionReceiptSha256: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface SharedCellAuthorCompensationOperation {
  readonly schemaVersion: 1;
  readonly operationSha256: string;
  readonly environmentId: string;
  readonly accountId: string;
  readonly region: string;
  readonly stackName: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly operationIntent: Readonly<Record<string, unknown>>;
  readonly deleteStackClientRequestToken: string;
  readonly state: SharedCellAuthorCompensationOperationState;
  readonly currentPhase: SharedCellAuthorCompensationPhase | null;
  readonly currentWindowNumber: number | null;
  readonly currentAttemptNumber: number | null;
  readonly currentGrantReceiptSha256: string | null;
  readonly stateRevision: number;
  readonly leaseOwner: string | null;
  readonly claimToken: string | null;
  readonly leaseAttempt: number;
  readonly leaseExpiresAt: number | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorSha256: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface SharedCellAuthorCompensationOperationSnapshot {
  readonly operation: Readonly<SharedCellAuthorCompensationOperation>;
  readonly currentWindow: Readonly<SharedCellAuthorCompensationReviewWindow> | null;
  readonly currentAttempt: Readonly<SharedCellAuthorCompensationPhaseAttempt> | null;
  readonly currentLifecycleAction: Readonly<SharedCellAuthorCompensationLifecycleAction> | null;
}

export interface SharedCellAuthorCompensationPhaseGrantReceipt {
  readonly schemaVersion: 1;
  readonly action: "shared_cell_author_compensation_phase_grant_verified";
  readonly disposition: "PHASE_EXECUTION_ALLOWED" | "REVOKE_ONLY";
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly controllerContractSha256: string;
  readonly grantEvidenceSha256: string;
  readonly observedAt: string;
}

export interface SharedCellAuthorCompensationPhaseCompletionReceipt {
  readonly schemaVersion: 1;
  readonly action: "shared_cell_author_compensation_phase_completed";
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly controllerContractSha256: string;
  readonly observedState: "REVIEW_IN_PROGRESS" | "MISSING";
  readonly mutationPerformed: boolean;
  readonly evidenceSha256: string;
  readonly observedAt: string;
}

export interface SharedCellAuthorCompensationLockedReceipt {
  readonly schemaVersion: 1;
  readonly action: "shared_cell_author_compensation_locked_verified";
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly completionReceiptSha256: string;
  readonly lockedEvidenceSha256: string;
  readonly observedAt: string;
}

export type SharedCellAuthorCompensationLifecycleActionKind =
  | "GRANT"
  | "REVOKE";

export type SharedCellAuthorCompensationLifecycleActionRequest =
  | Readonly<{
      schemaVersion: 1;
      action: "shared_cell_author_compensation_grant";
      kind: "GRANT";
      operationSha256: string;
      phase: SharedCellAuthorCompensationPhase;
      windowNumber: number;
      compensationPlanSha256: string;
      phasePlanSha256: string;
      controllerContractSha256: string;
      lifecycleContractSha256: string;
      targetRendererShape:
        | "AuthorCompensationDeleteChangeSetGrant"
        | "AuthorCompensationDeleteStackGrant";
      targetTemplateRawSha256: string;
      targetTemplateCanonicalSha256: string;
      managementStackName: "techlong-s3-b5-cell-lifecycle-management";
      managementStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d";
      managementChangeSetName: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      action: "shared_cell_author_compensation_revoke";
      kind: "REVOKE";
      reason: "PHASE_COMPLETED";
      operationSha256: string;
      phase: SharedCellAuthorCompensationPhase;
      windowNumber: number;
      grantReceiptSha256: string;
      completionReceiptSha256: string;
      lifecycleContractSha256: string;
      targetRendererShape: "Locked";
      targetTemplateRawSha256: string;
      targetTemplateCanonicalSha256: string;
      managementStackName: "techlong-s3-b5-cell-lifecycle-management";
      managementStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d";
      managementChangeSetName: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      action: "shared_cell_author_compensation_revoke";
      kind: "REVOKE";
      reason: "WINDOW_EXPIRED";
      operationSha256: string;
      phase: SharedCellAuthorCompensationPhase;
      windowNumber: number;
      grantReceiptSha256: string;
      lifecycleContractSha256: string;
      targetRendererShape: "Locked";
      targetTemplateRawSha256: string;
      targetTemplateCanonicalSha256: string;
      managementStackName: "techlong-s3-b5-cell-lifecycle-management";
      managementStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d";
      managementChangeSetName: string;
    }>;

export interface SharedCellAuthorCompensationWindowExpiredLockedReceipt {
  readonly schemaVersion: 1;
  readonly action: "shared_cell_author_compensation_window_expired_locked_verified";
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly grantReceiptSha256: string;
  readonly lockedEvidenceSha256: string;
  readonly observedAt: string;
}

export type SharedCellAuthorCompensationLifecycleActionCompletionReceipt =
  | SharedCellAuthorCompensationPhaseGrantReceipt
  | SharedCellAuthorCompensationLockedReceipt
  | SharedCellAuthorCompensationWindowExpiredLockedReceipt;

export interface SharedCellAuthorCompensationLifecycleAction {
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly windowNumber: number;
  readonly actionNumber: number;
  readonly kind: SharedCellAuthorCompensationLifecycleActionKind;
  readonly revokeReason: "PHASE_COMPLETED" | "WINDOW_EXPIRED" | null;
  readonly status: "recover_only" | "completed";
  readonly request: Readonly<SharedCellAuthorCompensationLifecycleActionRequest>;
  readonly requestSha256: string;
  readonly leaseAttempt: number;
  readonly preparedRevision: number;
  readonly completionReceipt: Readonly<SharedCellAuthorCompensationLifecycleActionCompletionReceipt> | null;
  readonly completionReceiptSha256: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export type SharedCellAuthorCompensationMutationRequest =
  | Readonly<{
      phase: "DELETE_CHANGE_SET";
      request: Readonly<{ ChangeSetName: string; StackName: string }>;
    }>
  | Readonly<{
      phase: "DELETE_STACK";
      request: Readonly<{
        StackName: string;
        DeletionMode: "STANDARD";
        ClientRequestToken: string;
      }>;
    }>;

export interface SharedCellAuthorCompensationClaim {
  readonly mode: "PREPARE" | "RECOVER_ONLY";
  readonly handle: Readonly<SharedCellAuthorCompensationClaimHandle>;
  readonly snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
}

export interface SharedCellAuthorCompensationSubmissionReceipt {
  readonly handle: Readonly<SharedCellAuthorCompensationClaimHandle>;
  readonly attemptNumber: number;
  readonly requestSha256: string;
  readonly snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
}

export interface SharedCellAuthorCompensationOperationStore {
  createOrLoadOperation(input: {
    candidate: SharedCellAuthorCompensationCandidate;
    environmentId: string;
    signal: AbortSignal;
  }): Promise<Readonly<{
    outcome: "created" | "existing";
    snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  }>>;
  appendReviewedWindow(input: {
    operationSha256: string;
    expectedStateRevision: number;
    phase: SharedCellAuthorCompensationPhase;
    candidate: SharedCellAuthorCompensationCandidate;
    approvedCompensationPlanSha256: string;
    approvedPhasePlanSha256: string;
    controllerContractSha256: string;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null>;
  claimExactOperation(input: {
    operationSha256: string;
    workerId: string;
    leaseDurationMs: number;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null>;
  preparePhase(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    windowNumber: number;
    grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null>;
  beginSubmission(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    windowNumber: number;
    controllerContractSha256: string;
    mutation: SharedCellAuthorCompensationMutationRequest;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationSubmissionReceipt> | null>;
  completePhase(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    attemptNumber: number;
    completionReceipt: SharedCellAuthorCompensationPhaseCompletionReceipt;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null>;
  beginLifecycleAction(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    windowNumber: number;
    request: SharedCellAuthorCompensationLifecycleActionRequest;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null>;
  completeLifecycleAction(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    actionNumber: number;
    receipt: SharedCellAuthorCompensationLifecycleActionCompletionReceipt;
    signal: AbortSignal;
  }): Promise<Readonly<{
    claim: Readonly<SharedCellAuthorCompensationClaim> | null;
    snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  }> | null>;
  recordLockedAndAdvance(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    lockedReceipt: SharedCellAuthorCompensationLockedReceipt;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null>;
  heartbeat(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    leaseDurationMs: number;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaimHandle> | null>;
  releaseClaim(input: {
    handle: SharedCellAuthorCompensationClaimHandle;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null>;
  readOperation(input: {
    operationSha256: string;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  const actual = Object.keys(record(value)).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function fail(code: string, message: string): never {
  throw new SharedCellAuthorCompensationStoreError(code, message);
}

export function assertSharedCellAuthorCompensationDigest(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_DIGEST_INVALID", `${label} must be a full lowercase SHA-256 digest.`);
  }
}

function canonicalInstant(value: unknown, label: string): number {
  if (typeof value !== "string" || !canonicalUtcPattern.test(value)) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", `${label} must be a canonical UTC instant.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", `${label} is invalid.`);
  }
  return parsed;
}

function immutable<T>(value: T): Readonly<T> {
  return Object.freeze(structuredClone(value));
}

export function assertSharedCellAuthorCompensationClaimHandle(
  value: unknown,
): asserts value is SharedCellAuthorCompensationClaimHandle {
  const source = record(value);
  if (
    !exactKeys(source, [
      "claimToken",
      "leaseAttempt",
      "leaseExpiresAt",
      "operationSha256",
      "stateRevision",
      "workerId",
    ]) ||
    typeof source.workerId !== "string" ||
    source.workerId.length < 1 ||
    source.workerId.length > 200 ||
    typeof source.claimToken !== "string" ||
    !claimTokenPattern.test(source.claimToken) ||
    !Number.isSafeInteger(source.leaseAttempt) ||
    (source.leaseAttempt as number) < 1 ||
    !Number.isSafeInteger(source.stateRevision) ||
    (source.stateRevision as number) < 1 ||
    !Number.isSafeInteger(source.leaseExpiresAt) ||
    (source.leaseExpiresAt as number) < 1
  ) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_CLAIM_INVALID", "The durable compensation claim handle is malformed.");
  }
  assertSharedCellAuthorCompensationDigest(source.operationSha256, "operationSha256");
}

function assertReceiptBase(
  value: Record<string, unknown>,
  action: string,
): void {
  if (value.schemaVersion !== 1 || value.action !== action) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The durable compensation receipt has the wrong contract.");
  }
  assertSharedCellAuthorCompensationDigest(value.operationSha256, "receipt operationSha256");
  if (value.phase !== "DELETE_CHANGE_SET" && value.phase !== "DELETE_STACK") {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The durable compensation receipt phase is invalid.");
  }
  canonicalInstant(value.observedAt, "receipt observedAt");
}

export function assertSharedCellAuthorCompensationPhaseGrantReceipt(
  value: unknown,
): asserts value is SharedCellAuthorCompensationPhaseGrantReceipt {
  const source = record(value);
  const keys = [
    "action",
    "compensationPlanSha256",
    "controllerContractSha256",
    "disposition",
    "grantEvidenceSha256",
    "observedAt",
    "operationSha256",
    "phase",
    "phasePlanSha256",
    "schemaVersion",
  ];
  if (!exactKeys(source, keys)) fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The phase grant receipt has unknown or missing fields.");
  assertReceiptBase(source, "shared_cell_author_compensation_phase_grant_verified");
  if (
    source.disposition !== "PHASE_EXECUTION_ALLOWED" &&
    source.disposition !== "REVOKE_ONLY"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID",
      "The phase grant receipt disposition is invalid.",
    );
  }
  for (const [field, label] of [
    ["compensationPlanSha256", "grant compensation plan"],
    ["phasePlanSha256", "grant phase plan"],
    ["controllerContractSha256", "grant controller contract"],
    ["grantEvidenceSha256", "grant evidence"],
  ] as const) assertSharedCellAuthorCompensationDigest(source[field], label);
}

export function assertSharedCellAuthorCompensationPhaseCompletionReceipt(
  value: unknown,
): asserts value is SharedCellAuthorCompensationPhaseCompletionReceipt {
  const source = record(value);
  const keys = [
    "action",
    "compensationPlanSha256",
    "controllerContractSha256",
    "evidenceSha256",
    "mutationPerformed",
    "observedAt",
    "observedState",
    "operationSha256",
    "phase",
    "phasePlanSha256",
    "schemaVersion",
  ];
  if (!exactKeys(source, keys)) fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The phase completion receipt has unknown or missing fields.");
  assertReceiptBase(source, "shared_cell_author_compensation_phase_completed");
  for (const [field, label] of [
    ["compensationPlanSha256", "completion compensation plan"],
    ["phasePlanSha256", "completion phase plan"],
    ["controllerContractSha256", "completion controller contract"],
    ["evidenceSha256", "completion evidence"],
  ] as const) assertSharedCellAuthorCompensationDigest(source[field], label);
  if (typeof source.mutationPerformed !== "boolean") {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The completion mutation flag is invalid.");
  }
  if (
    source.observedState !== "MISSING" &&
    !(source.phase === "DELETE_CHANGE_SET" && source.observedState === "REVIEW_IN_PROGRESS")
  ) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The completion observation does not prove the phase target is absent.");
  }
}

export function assertSharedCellAuthorCompensationLockedReceipt(
  value: unknown,
): asserts value is SharedCellAuthorCompensationLockedReceipt {
  const source = record(value);
  const keys = [
    "action",
    "completionReceiptSha256",
    "lockedEvidenceSha256",
    "observedAt",
    "operationSha256",
    "phase",
    "schemaVersion",
  ];
  if (!exactKeys(source, keys)) fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID", "The Locked receipt has unknown or missing fields.");
  assertReceiptBase(source, "shared_cell_author_compensation_locked_verified");
  assertSharedCellAuthorCompensationDigest(source.completionReceiptSha256, "completion receipt");
  assertSharedCellAuthorCompensationDigest(source.lockedEvidenceSha256, "Locked evidence");
}

export function assertSharedCellAuthorCompensationWindowExpiredLockedReceipt(
  value: unknown,
): asserts value is SharedCellAuthorCompensationWindowExpiredLockedReceipt {
  const source = record(value);
  const keys = [
    "action",
    "grantReceiptSha256",
    "lockedEvidenceSha256",
    "observedAt",
    "operationSha256",
    "phase",
    "schemaVersion",
  ];
  if (!exactKeys(source, keys)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID",
      "The window-expired Locked receipt has unknown or missing fields.",
    );
  }
  assertReceiptBase(
    source,
    "shared_cell_author_compensation_window_expired_locked_verified",
  );
  assertSharedCellAuthorCompensationDigest(
    source.grantReceiptSha256,
    "window-expired grant receipt",
  );
  assertSharedCellAuthorCompensationDigest(
    source.lockedEvidenceSha256,
    "window-expired Locked evidence",
  );
}

export function assertSharedCellAuthorCompensationLifecycleActionRequest(
  value: unknown,
): asserts value is SharedCellAuthorCompensationLifecycleActionRequest {
  const source = record(value);
  const commonKeys = [
    "action",
    "kind",
    "operationSha256",
    "phase",
    "schemaVersion",
    "windowNumber",
  ];
  if (
    source.schemaVersion !== 1 ||
    (source.phase !== "DELETE_CHANGE_SET" && source.phase !== "DELETE_STACK") ||
    !Number.isSafeInteger(source.windowNumber) ||
    (source.windowNumber as number) < 1
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
      "The durable grant lifecycle request has an invalid contract.",
    );
  }
  assertSharedCellAuthorCompensationDigest(
    source.operationSha256,
    "lifecycle operationSha256",
  );
  if (source.kind === "GRANT") {
    if (
      source.action !== "shared_cell_author_compensation_grant" ||
      !exactKeys(source, [
        ...commonKeys,
        "compensationPlanSha256",
        "controllerContractSha256",
        "lifecycleContractSha256",
        "managementChangeSetName",
        "managementStackId",
        "managementStackName",
        "phasePlanSha256",
        "targetRendererShape",
        "targetTemplateCanonicalSha256",
        "targetTemplateRawSha256",
      ])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
        "The grant lifecycle request has unknown or missing fields.",
      );
    }
    for (const [field, label] of [
      ["compensationPlanSha256", "lifecycle compensation plan"],
      ["phasePlanSha256", "lifecycle phase plan"],
      ["controllerContractSha256", "lifecycle controller contract"],
      ["lifecycleContractSha256", "grant lifecycle contract"],
      ["targetTemplateRawSha256", "grant target template raw"],
      ["targetTemplateCanonicalSha256", "grant target template canonical"],
    ] as const) {
      assertSharedCellAuthorCompensationDigest(source[field], label);
    }
    const expectedShape =
      source.phase === "DELETE_CHANGE_SET"
        ? "AuthorCompensationDeleteChangeSetGrant"
        : "AuthorCompensationDeleteStackGrant";
    if (source.targetRendererShape !== expectedShape) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
        "The grant lifecycle request is not bound to the exact phase renderer shape.",
      );
    }
    if (
      source.managementStackName !==
        "techlong-s3-b5-cell-lifecycle-management" ||
      source.managementStackId !==
        "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d" ||
      source.managementChangeSetName !==
        `techlong-j5gj3-grant-${String(source.lifecycleContractSha256).slice(0, 16)}`
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
        "The lifecycle request is not bound to the exact management Stack and deterministic Change Set.",
      );
    }
    return;
  }
  if (
    source.kind !== "REVOKE" ||
    source.action !== "shared_cell_author_compensation_revoke" ||
    (source.reason !== "PHASE_COMPLETED" &&
      source.reason !== "WINDOW_EXPIRED")
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
      "The revoke lifecycle request has an invalid contract.",
    );
  }
  const reasonKeys =
    source.reason === "PHASE_COMPLETED"
      ? ["completionReceiptSha256"]
      : [];
  if (
    !exactKeys(source, [
      ...commonKeys,
      "grantReceiptSha256",
      "lifecycleContractSha256",
      "managementChangeSetName",
      "managementStackId",
      "managementStackName",
      "reason",
      "targetRendererShape",
      "targetTemplateCanonicalSha256",
      "targetTemplateRawSha256",
      ...reasonKeys,
    ])
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
      "The revoke lifecycle request has unknown or missing fields.",
    );
  }
  assertSharedCellAuthorCompensationDigest(
    source.grantReceiptSha256,
    "lifecycle grant receipt",
  );
  for (const [field, label] of [
    ["lifecycleContractSha256", "revoke lifecycle contract"],
    ["targetTemplateRawSha256", "revoke target template raw"],
    ["targetTemplateCanonicalSha256", "revoke target template canonical"],
  ] as const) {
    assertSharedCellAuthorCompensationDigest(source[field], label);
  }
  if (source.targetRendererShape !== "Locked") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
      "The revoke lifecycle request target must be the exact Locked renderer shape.",
    );
  }
  if (
    source.managementStackName !==
      "techlong-s3-b5-cell-lifecycle-management" ||
    source.managementStackId !==
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d" ||
    source.managementChangeSetName !==
      `techlong-j5gj3-${String(source.kind).toLowerCase()}-${String(source.lifecycleContractSha256).slice(0, 16)}`
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_INVALID",
      "The lifecycle request is not bound to the exact management Stack and deterministic Change Set.",
    );
  }
  if (source.reason === "PHASE_COMPLETED") {
    assertSharedCellAuthorCompensationDigest(
      source.completionReceiptSha256,
      "lifecycle completion receipt",
    );
  }
}

export async function sharedCellAuthorCompensationLifecycleActionRequestSha256(
  request: SharedCellAuthorCompensationLifecycleActionRequest,
): Promise<string> {
  assertSharedCellAuthorCompensationLifecycleActionRequest(request);
  return sha256Hex(JSON.parse(canonicalJson(request)) as Record<string, unknown>);
}

export async function compileSharedCellAuthorCompensationStoredIntent(
  candidate: SharedCellAuthorCompensationCandidate,
): Promise<Readonly<{
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>;
  operationIntent: Readonly<Record<string, unknown>>;
}>> {
  const plan = await compileSharedCellAuthorCompensationPlan(candidate);
  const stableCandidate: Partial<SharedCellAuthorCompensationCandidate> =
    structuredClone(candidate);
  delete stableCandidate.compensationGrant;
  const operationIntent = immutable({
    schemaVersion: 1,
    action: "delete_shared_cell_author_create_placeholder",
    candidate: stableCandidate,
  });
  return Object.freeze({ plan, operationIntent });
}

export function assertSharedCellAuthorCompensationReviewWindow(
  candidate: SharedCellAuthorCompensationCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  phase: SharedCellAuthorCompensationPhase,
  approvedCompensationPlanSha256: string,
  approvedPhasePlanSha256: string,
  controllerContractSha256: string,
): Readonly<{ reviewedAt: number; expiresAt: number }> {
  assertSharedCellAuthorCompensationDigest(approvedCompensationPlanSha256, "approved compensation plan");
  assertSharedCellAuthorCompensationDigest(approvedPhasePlanSha256, "approved phase plan");
  assertSharedCellAuthorCompensationDigest(controllerContractSha256, "controller contract");
  if (
    plan.compensationPlanSha256 !== approvedCompensationPlanSha256 ||
    plan.phasePlanSha256[phase] !== approvedPhasePlanSha256
  ) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_PLAN_MISMATCH", "The reviewed compensation window does not match the freshly compiled base and phase plans.");
  }
  const reviewedAt = canonicalInstant(candidate.compensationGrant.reviewedAt, "compensation reviewedAt");
  const expiresAt = canonicalInstant(candidate.compensationGrant.expiresAt, "compensation expiresAt");
  if (expiresAt <= reviewedAt || expiresAt - reviewedAt > maximumGrantLifetimeMs) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_WINDOW_INVALID", "The reviewed compensation window must be positive and at most 60 minutes.");
  }
  return Object.freeze({ reviewedAt, expiresAt });
}

export async function compileSharedCellAuthorCompensationMutationRequest(
  operation: Pick<
    SharedCellAuthorCompensationOperation,
    "changeSetArn" | "deleteStackClientRequestToken" | "stackId"
  >,
  mutation: SharedCellAuthorCompensationMutationRequest,
): Promise<Readonly<{ request: SharedCellAuthorCompensationMutationRequest; requestSha256: string; clientRequestToken: string | null }>> {
  const source = record(mutation);
  if (!exactKeys(source, ["phase", "request"])) {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_REQUEST_INVALID", "The mutation request envelope is malformed.");
  }
  const request = record(source.request);
  if (source.phase === "DELETE_CHANGE_SET") {
    if (
      !exactKeys(request, ["ChangeSetName", "StackName"]) ||
      request.ChangeSetName !== operation.changeSetArn ||
      request.StackName !== operation.stackId
    ) fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_REQUEST_INVALID", "DeleteChangeSet is not bound to the exact durable targets.");
  } else if (source.phase === "DELETE_STACK") {
    if (
      !exactKeys(request, ["ClientRequestToken", "DeletionMode", "StackName"]) ||
      request.StackName !== operation.stackId ||
      request.DeletionMode !== "STANDARD" ||
      request.ClientRequestToken !== operation.deleteStackClientRequestToken
    ) fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_REQUEST_INVALID", "DeleteStack is not bound to the exact durable target and stable token.");
  } else {
    fail("SHARED_CELL_AUTHOR_COMPENSATION_STORE_REQUEST_INVALID", "The mutation phase is invalid.");
  }
  const normalized = immutable(mutation);
  return Object.freeze({
    request: normalized,
    requestSha256: await sha256Hex(JSON.parse(canonicalJson(normalized)) as Record<string, unknown>),
    clientRequestToken:
      normalized.phase === "DELETE_STACK" ? normalized.request.ClientRequestToken : null,
  });
}

export async function sharedCellAuthorCompensationReceiptSha256(
  receipt:
    | SharedCellAuthorCompensationPhaseGrantReceipt
    | SharedCellAuthorCompensationPhaseCompletionReceipt
    | SharedCellAuthorCompensationLockedReceipt
    | SharedCellAuthorCompensationWindowExpiredLockedReceipt,
): Promise<string> {
  if (receipt.action === "shared_cell_author_compensation_phase_grant_verified") {
    assertSharedCellAuthorCompensationPhaseGrantReceipt(receipt);
  } else if (receipt.action === "shared_cell_author_compensation_phase_completed") {
    assertSharedCellAuthorCompensationPhaseCompletionReceipt(receipt);
  } else if (receipt.action === "shared_cell_author_compensation_locked_verified") {
    assertSharedCellAuthorCompensationLockedReceipt(receipt);
  } else {
    assertSharedCellAuthorCompensationWindowExpiredLockedReceipt(receipt);
  }
  return sha256Hex(JSON.parse(canonicalJson(receipt)) as Record<string, unknown>);
}
