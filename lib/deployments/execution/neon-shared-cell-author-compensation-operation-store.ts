import { neon } from "@neondatabase/serverless";
import { canonicalJson } from "./hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS,
  SharedCellAuthorCompensationStoreError,
  assertSharedCellAuthorCompensationClaimHandle,
  assertSharedCellAuthorCompensationDigest,
  assertSharedCellAuthorCompensationLifecycleActionRequest,
  assertSharedCellAuthorCompensationLockedReceipt,
  assertSharedCellAuthorCompensationPhaseCompletionReceipt,
  assertSharedCellAuthorCompensationPhaseGrantReceipt,
  assertSharedCellAuthorCompensationReviewWindow,
  assertSharedCellAuthorCompensationWindowExpiredLockedReceipt,
  compileSharedCellAuthorCompensationMutationRequest,
  compileSharedCellAuthorCompensationStoredIntent,
  sharedCellAuthorCompensationReceiptSha256,
  sharedCellAuthorCompensationLifecycleActionRequestSha256,
  type SharedCellAuthorCompensationClaim,
  type SharedCellAuthorCompensationClaimHandle,
  type SharedCellAuthorCompensationLifecycleAction,
  type SharedCellAuthorCompensationLifecycleActionKind,
  type SharedCellAuthorCompensationLifecycleActionRequest,
  type SharedCellAuthorCompensationMutationRequest,
  type SharedCellAuthorCompensationOperation,
  type SharedCellAuthorCompensationOperationSnapshot,
  type SharedCellAuthorCompensationOperationState,
  type SharedCellAuthorCompensationOperationStore,
  type SharedCellAuthorCompensationPhaseAttempt,
  type SharedCellAuthorCompensationReviewWindow,
  type SharedCellAuthorCompensationSubmissionReceipt,
} from "./shared-cell-author-compensation-operation-store.ts";
import type {
  SharedCellAuthorCompensationCandidate,
  SharedCellAuthorCompensationPhase,
} from "./shared-cell-author-compensation.ts";

export interface NeonSharedCellAuthorCompensationSqlClient {
  query(
    statement: string,
    values: unknown[],
    options: { fullResults: true; fetchOptions: { signal: AbortSignal } },
  ): Promise<unknown>;
}

export type SharedCellAuthorCompensationClaimTokenFactory = () => string;

const operationStates = new Set<SharedCellAuthorCompensationOperationState>([
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
]);
const phaseValues = new Set<SharedCellAuthorCompensationPhase>([
  "DELETE_CHANGE_SET",
  "DELETE_STACK",
]);
const claimTokenPattern = /^scac_[a-f0-9]{32}$/;
const databaseUrlPattern = /^postgres(?:ql)?:\/\//;
const minimumLeaseDurationMs = 5_000;
const maximumLeaseDurationMs = 5 * 60_000;

const snapshotProjection = `
  row_to_json(operation_row)::text AS operation_record,
  CASE WHEN review_window.operation_sha256 IS NULL
    THEN NULL ELSE row_to_json(review_window)::text END AS window_record,
  CASE WHEN phase_attempt.operation_sha256 IS NULL
    THEN NULL ELSE row_to_json(phase_attempt)::text END AS attempt_record,
  CASE WHEN lifecycle_action.operation_sha256 IS NULL
    THEN NULL ELSE row_to_json(lifecycle_action)::text END AS lifecycle_action_record`;

const currentLifecycleActionJoin = `
  LEFT JOIN LATERAL (
    SELECT action.*
    FROM shared_cell_author_compensation_lifecycle_actions action
    WHERE action.operation_sha256 = operation_row.operation_sha256
      AND action.phase = operation_row.current_phase
      AND action.window_number = operation_row.current_window_number
    ORDER BY action.action_number DESC
    LIMIT 1
  ) lifecycle_action ON true`;

function record(value: unknown): Record<string, unknown> {
  try {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rows(value: unknown): unknown[] {
  const resultRows = record(value).rows;
  if (!Array.isArray(resultRows)) {
    throw new SharedCellAuthorCompensationStoreError(
      "NEON_SHARED_CELL_AUTHOR_COMPENSATION_RECEIPT_INVALID",
      "The durable compensation database returned an invalid response.",
      true,
    );
  }
  return resultRows;
}

function parseRecord(
  value: unknown,
  label: string,
  allowEmpty = false,
): Record<string, unknown> {
  let parsed = value;
  try {
    if (typeof value === "string") parsed = JSON.parse(value) as unknown;
  } catch {
    parsed = null;
  }
  const result = record(parsed);
  if (!allowEmpty && Object.keys(result).length === 0) {
    throw new SharedCellAuthorCompensationStoreError(
      "NEON_SHARED_CELL_AUTHOR_COMPENSATION_RECEIPT_INVALID",
      `The durable compensation ${label} record is invalid.`,
      true,
    );
  }
  return result;
}

function nullableRecord(
  value: unknown,
  label: string,
  allowEmpty = false,
): Record<string, unknown> | null {
  return value === null || value === undefined
    ? null
    : parseRecord(value, label, allowEmpty);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalidRow(label);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) invalidRow(label);
  return parsed;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, label);
}

function invalidRow(label: string): never {
  throw new SharedCellAuthorCompensationStoreError(
    "NEON_SHARED_CELL_AUTHOR_COMPENSATION_RECEIPT_INVALID",
    `The durable compensation database returned an invalid ${label}.`,
    true,
  );
}

function operationFromRow(row: Record<string, unknown>): SharedCellAuthorCompensationOperation {
  const state = text(row.state, "operation state") as SharedCellAuthorCompensationOperationState;
  if (!operationStates.has(state)) invalidRow("operation state");
  const currentPhase = nullableText(row.current_phase, "current phase") as SharedCellAuthorCompensationPhase | null;
  if (currentPhase !== null && !phaseValues.has(currentPhase)) invalidRow("current phase");
  const schemaVersion = integer(row.schema_version, "schema version");
  if (schemaVersion !== 1) invalidRow("schema version");
  const operationSha256 = text(row.operation_sha256, "operation digest");
  assertSharedCellAuthorCompensationDigest(operationSha256, "stored operationSha256");
  const claimToken = nullableText(row.claim_token, "claim token");
  if (claimToken !== null && !claimTokenPattern.test(claimToken)) invalidRow("claim token");
  const operationIntent = parseRecord(row.operation_intent, "operation intent");
  return Object.freeze({
    schemaVersion: 1,
    operationSha256,
    environmentId: text(row.environment_id, "environment id"),
    accountId: text(row.account_id, "account id"),
    region: text(row.region, "region"),
    stackName: text(row.stack_name, "stack name"),
    stackId: text(row.stack_id, "stack id"),
    changeSetArn: text(row.change_set_arn, "change set ARN"),
    operationIntent: Object.freeze(operationIntent),
    deleteStackClientRequestToken: text(
      row.delete_stack_client_request_token,
      "delete stack client request token",
    ),
    state,
    currentPhase,
    currentWindowNumber: nullableInteger(row.current_window_number, "window number"),
    currentAttemptNumber: nullableInteger(row.current_attempt_number, "attempt number"),
    currentGrantReceiptSha256: nullableText(row.current_grant_receipt_sha256, "grant digest"),
    stateRevision: integer(row.state_revision, "state revision"),
    leaseOwner: nullableText(row.lease_owner, "lease owner"),
    claimToken,
    leaseAttempt: integer(row.lease_attempt, "lease attempt"),
    leaseExpiresAt: nullableInteger(row.lease_expires_at, "lease expiry"),
    lastErrorCode: nullableText(row.last_error_code, "last error code"),
    lastErrorSha256: nullableText(row.last_error_sha256, "last error digest"),
    createdAt: integer(row.created_at, "created time"),
    updatedAt: integer(row.updated_at, "updated time"),
    completedAt: nullableInteger(row.completed_at, "completed time"),
  });
}

function reviewWindowFromRow(row: Record<string, unknown>): SharedCellAuthorCompensationReviewWindow {
  const phase = text(row.phase, "window phase") as SharedCellAuthorCompensationPhase;
  if (!phaseValues.has(phase)) invalidRow("window phase");
  const candidate = parseRecord(row.candidate, "review candidate") as unknown as SharedCellAuthorCompensationCandidate;
  const operationSha256 = text(row.operation_sha256, "window operation digest");
  const compensationPlanSha256 = text(row.compensation_plan_sha256, "window base plan digest");
  const phasePlanSha256 = text(row.phase_plan_sha256, "window phase plan digest");
  const controllerContractSha256 = text(row.controller_contract_sha256, "controller contract digest");
  for (const [value, label] of [
    [operationSha256, "window operationSha256"],
    [compensationPlanSha256, "window compensation plan"],
    [phasePlanSha256, "window phase plan"],
    [controllerContractSha256, "window controller contract"],
  ] as const) assertSharedCellAuthorCompensationDigest(value, label);
  return Object.freeze({
    operationSha256,
    phase,
    windowNumber: integer(row.window_number, "window number"),
    candidate: Object.freeze(candidate),
    compensationPlanSha256,
    phasePlanSha256,
    controllerContractSha256,
    reviewedAt: integer(row.reviewed_at, "reviewed time"),
    expiresAt: integer(row.expires_at, "expiry time"),
    createdAt: integer(row.created_at, "window created time"),
  });
}

function attemptFromRow(row: Record<string, unknown>): SharedCellAuthorCompensationPhaseAttempt {
  const phase = text(row.phase, "attempt phase") as SharedCellAuthorCompensationPhase;
  if (!phaseValues.has(phase)) invalidRow("attempt phase");
  const status = text(row.status, "attempt status");
  if (status !== "recover_only" && status !== "completed") invalidRow("attempt status");
  const completionReceiptValue = nullableRecord(
    row.completion_receipt,
    "completion receipt",
    true,
  );
  const completionReceipt =
    completionReceiptValue && Object.keys(completionReceiptValue).length > 0
      ? completionReceiptValue
      : null;
  if (completionReceipt) assertSharedCellAuthorCompensationPhaseCompletionReceipt(completionReceipt);
  return Object.freeze({
    operationSha256: text(row.operation_sha256, "attempt operation digest"),
    phase,
    attemptNumber: integer(row.attempt_number, "attempt number"),
    windowNumber: integer(row.window_number, "attempt window number"),
    status,
    request: Object.freeze(parseRecord(row.request, "mutation request")) as unknown as SharedCellAuthorCompensationMutationRequest,
    requestSha256: text(row.request_sha256, "request digest"),
    clientRequestToken: nullableText(row.client_request_token, "client request token"),
    leaseAttempt: integer(row.lease_attempt, "attempt lease number"),
    preparedRevision: integer(row.prepared_revision, "prepared revision"),
    completionReceipt: completionReceipt as SharedCellAuthorCompensationPhaseAttempt["completionReceipt"],
    completionReceiptSha256: nullableText(row.completion_receipt_sha256, "completion receipt digest"),
    startedAt: integer(row.started_at, "attempt started time"),
    updatedAt: integer(row.updated_at, "attempt updated time"),
    completedAt: nullableInteger(row.completed_at, "attempt completed time"),
  });
}

function lifecycleActionFromRow(
  row: Record<string, unknown>,
): SharedCellAuthorCompensationLifecycleAction {
  const phase = text(row.phase, "lifecycle action phase") as SharedCellAuthorCompensationPhase;
  if (!phaseValues.has(phase)) invalidRow("lifecycle action phase");
  const kind = text(
    row.action_kind,
    "lifecycle action kind",
  ) as SharedCellAuthorCompensationLifecycleActionKind;
  if (kind !== "GRANT" && kind !== "REVOKE") {
    invalidRow("lifecycle action kind");
  }
  const status = text(row.status, "lifecycle action status");
  if (status !== "recover_only" && status !== "completed") {
    invalidRow("lifecycle action status");
  }
  const request = parseRecord(row.request, "lifecycle action request");
  assertSharedCellAuthorCompensationLifecycleActionRequest(request);
  const requestReason = request.kind === "REVOKE" ? request.reason : null;
  const revokeReason = nullableText(
    row.revoke_reason,
    "lifecycle revoke reason",
  ) as "PHASE_COMPLETED" | "WINDOW_EXPIRED" | null;
  if (
    request.kind !== kind ||
    request.phase !== phase ||
    (kind === "GRANT" && revokeReason !== null) ||
    (kind === "REVOKE" &&
      (revokeReason !== requestReason ||
        (revokeReason !== "PHASE_COMPLETED" &&
          revokeReason !== "WINDOW_EXPIRED")))
  ) {
    invalidRow("lifecycle action request linkage");
  }
  const receiptValue = nullableRecord(
    row.completion_receipt,
    "lifecycle completion receipt",
    true,
  );
  const receipt =
    receiptValue && Object.keys(receiptValue).length > 0 ? receiptValue : null;
  if (receipt) {
    if (kind === "GRANT") {
      assertSharedCellAuthorCompensationPhaseGrantReceipt(receipt);
    } else if (request.kind === "REVOKE" && request.reason === "PHASE_COMPLETED") {
      assertSharedCellAuthorCompensationLockedReceipt(receipt);
    } else {
      assertSharedCellAuthorCompensationWindowExpiredLockedReceipt(receipt);
    }
  }
  const operationSha256 = text(
    row.operation_sha256,
    "lifecycle action operation digest",
  );
  const windowNumber = integer(
    row.window_number,
    "lifecycle action window number",
  );
  const actionNumber = integer(row.action_number, "lifecycle action number");
  if (
    request.operationSha256 !== operationSha256 ||
    request.windowNumber !== windowNumber ||
    actionNumber !== (kind === "GRANT" ? 1 : 2)
  ) {
    invalidRow("lifecycle action request linkage");
  }
  const requestSha256 = text(row.request_sha256, "lifecycle request digest");
  assertSharedCellAuthorCompensationDigest(
    operationSha256,
    "stored lifecycle operationSha256",
  );
  assertSharedCellAuthorCompensationDigest(
    requestSha256,
    "stored lifecycle requestSha256",
  );
  const receiptSha256 = nullableText(
    row.completion_receipt_sha256,
    "lifecycle completion receipt digest",
  );
  if (receiptSha256 !== null) {
    assertSharedCellAuthorCompensationDigest(
      receiptSha256,
      "stored lifecycle completion receiptSha256",
    );
  }
  const completedAt = nullableInteger(
    row.completed_at,
    "lifecycle action completed time",
  );
  if (
    (status === "recover_only" &&
      (receipt !== null || receiptSha256 !== null || completedAt !== null)) ||
    (status === "completed" &&
      (receipt === null || receiptSha256 === null || completedAt === null)) ||
    (receipt !== null &&
      (receipt.operationSha256 !== operationSha256 ||
        receipt.phase !== phase)) ||
    (receipt?.action === "shared_cell_author_compensation_phase_grant_verified" &&
      (request.kind !== "GRANT" ||
        receipt.compensationPlanSha256 !== request.compensationPlanSha256 ||
        receipt.phasePlanSha256 !== request.phasePlanSha256 ||
        receipt.controllerContractSha256 !== request.controllerContractSha256)) ||
    (receipt?.action === "shared_cell_author_compensation_locked_verified" &&
      (request.kind !== "REVOKE" ||
        request.reason !== "PHASE_COMPLETED" ||
        receipt.completionReceiptSha256 !== request.completionReceiptSha256)) ||
    (receipt?.action ===
      "shared_cell_author_compensation_window_expired_locked_verified" &&
      (request.kind !== "REVOKE" ||
        request.reason !== "WINDOW_EXPIRED" ||
        receipt.grantReceiptSha256 !== request.grantReceiptSha256))
  ) {
    invalidRow("lifecycle action receipt linkage");
  }
  return Object.freeze({
    operationSha256,
    phase,
    windowNumber,
    actionNumber,
    kind,
    revokeReason,
    status,
    request: Object.freeze(request) as unknown as SharedCellAuthorCompensationLifecycleActionRequest,
    requestSha256,
    leaseAttempt: integer(row.lease_attempt, "lifecycle action lease number"),
    preparedRevision: integer(
      row.prepared_revision,
      "lifecycle action prepared revision",
    ),
    completionReceipt:
      receipt as SharedCellAuthorCompensationLifecycleAction["completionReceipt"],
    completionReceiptSha256: receiptSha256,
    startedAt: integer(row.started_at, "lifecycle action started time"),
    updatedAt: integer(row.updated_at, "lifecycle action updated time"),
    completedAt,
  });
}

function snapshotFromResultRow(value: unknown): SharedCellAuthorCompensationOperationSnapshot {
  const row = record(value);
  const operation = operationFromRow(parseRecord(row.operation_record, "operation"));
  const windowRow = nullableRecord(row.window_record, "review window");
  const attemptRow = nullableRecord(row.attempt_record, "phase attempt");
  const lifecycleActionRow = nullableRecord(
    row.lifecycle_action_record,
    "lifecycle action",
  );
  const currentWindow = windowRow ? reviewWindowFromRow(windowRow) : null;
  const currentAttempt = attemptRow ? attemptFromRow(attemptRow) : null;
  const currentLifecycleAction = lifecycleActionRow
    ? lifecycleActionFromRow(lifecycleActionRow)
    : null;
  if (
    (operation.currentWindowNumber === null) !== (currentWindow === null) ||
    (operation.currentAttemptNumber === null) !== (currentAttempt === null) ||
    (currentWindow !== null &&
      (currentWindow.operationSha256 !== operation.operationSha256 ||
        currentWindow.phase !== operation.currentPhase ||
        currentWindow.windowNumber !== operation.currentWindowNumber)) ||
    (currentAttempt !== null &&
      (currentAttempt.operationSha256 !== operation.operationSha256 ||
        currentAttempt.phase !== operation.currentPhase ||
        currentAttempt.windowNumber !== operation.currentWindowNumber ||
        currentAttempt.attemptNumber !== operation.currentAttemptNumber)) ||
    (currentLifecycleAction !== null &&
      (currentLifecycleAction.operationSha256 !== operation.operationSha256 ||
        currentLifecycleAction.phase !== operation.currentPhase ||
        currentLifecycleAction.windowNumber !== operation.currentWindowNumber))
  ) invalidRow("snapshot linkage");
  return Object.freeze({
    operation,
    currentWindow,
    currentAttempt,
    currentLifecycleAction,
  });
}

function singleSnapshot(value: unknown): SharedCellAuthorCompensationOperationSnapshot | null {
  const resultRows = rows(value);
  if (resultRows.length === 0) return null;
  if (resultRows.length !== 1) invalidRow("snapshot cardinality");
  return snapshotFromResultRow(resultRows[0]);
}

function handleFromSnapshot(snapshot: SharedCellAuthorCompensationOperationSnapshot): SharedCellAuthorCompensationClaimHandle {
  const operation = snapshot.operation;
  if (
    operation.leaseOwner === null ||
    operation.claimToken === null ||
    operation.leaseExpiresAt === null ||
    operation.leaseAttempt < 1
  ) invalidRow("claimed operation");
  return Object.freeze({
    operationSha256: operation.operationSha256,
    workerId: operation.leaseOwner,
    claimToken: operation.claimToken,
    leaseAttempt: operation.leaseAttempt,
    stateRevision: operation.stateRevision,
    leaseExpiresAt: operation.leaseExpiresAt,
  });
}

function claimFromSnapshot(snapshot: SharedCellAuthorCompensationOperationSnapshot): SharedCellAuthorCompensationClaim {
  const recoverOnly =
    snapshot.currentLifecycleAction?.status === "recover_only" ||
    /_(?:recover_only|revoke_required)$/.test(snapshot.operation.state);
  return Object.freeze({
    mode: recoverOnly ? "RECOVER_ONLY" : "PREPARE",
    handle: handleFromSnapshot(snapshot),
    snapshot,
  });
}

function validateLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < minimumLeaseDurationMs || value > maximumLeaseDurationMs) {
    throw new SharedCellAuthorCompensationStoreError(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LEASE_INVALID",
      "The durable compensation lease must be between 5 seconds and 5 minutes.",
    );
  }
}

function validateWorkerId(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new SharedCellAuthorCompensationStoreError(
      "SHARED_CELL_AUTHOR_COMPENSATION_STORE_WORKER_INVALID",
      "The durable compensation worker identifier is invalid.",
    );
  }
}

function defaultClaimToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `scac_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function sanitizedProviderFailure(write: boolean): SharedCellAuthorCompensationStoreError {
  return new SharedCellAuthorCompensationStoreError(
    write
      ? "NEON_SHARED_CELL_AUTHOR_COMPENSATION_WRITE_UNCERTAIN"
      : "NEON_SHARED_CELL_AUTHOR_COMPENSATION_READ_FAILED",
    write
      ? "The durable compensation write may have committed; read the exact operation before any external mutation."
      : "The durable compensation operation could not be read.",
    true,
  );
}

function sqlState(phase: SharedCellAuthorCompensationPhase, suffix: string): string {
  return `${phase === "DELETE_CHANGE_SET" ? "delete_change_set" : "delete_stack"}_${suffix}`;
}

export class NeonSharedCellAuthorCompensationOperationStore
implements SharedCellAuthorCompensationOperationStore {
  private readonly sql: NeonSharedCellAuthorCompensationSqlClient;
  private readonly claimTokenFactory: SharedCellAuthorCompensationClaimTokenFactory;

  constructor(
    sql: NeonSharedCellAuthorCompensationSqlClient,
    claimTokenFactory: SharedCellAuthorCompensationClaimTokenFactory = defaultClaimToken,
  ) {
    if (!sql || typeof sql.query !== "function") {
      throw new SharedCellAuthorCompensationStoreError(
        "NEON_SHARED_CELL_AUTHOR_COMPENSATION_CLIENT_INVALID",
        "The durable compensation store requires a Neon query client.",
      );
    }
    if (typeof claimTokenFactory !== "function") {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_CLAIM_INVALID",
        "The durable compensation claim token factory is invalid.",
      );
    }
    this.sql = sql;
    this.claimTokenFactory = claimTokenFactory;
  }

  private async query(
    statement: string,
    values: unknown[],
    signal: AbortSignal,
    write: boolean,
  ): Promise<unknown> {
    signal.throwIfAborted();
    try {
      const result = await this.sql.query(statement, values, {
        fullResults: true,
        fetchOptions: { signal },
      });
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof SharedCellAuthorCompensationStoreError) throw error;
      throw sanitizedProviderFailure(write);
    }
  }

  async createOrLoadOperation(input: {
    candidate: SharedCellAuthorCompensationCandidate;
    environmentId: string;
    signal: AbortSignal;
  }): Promise<Readonly<{ outcome: "created" | "existing"; snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot> }>> {
    if (typeof input.environmentId !== "string" || input.environmentId.length < 1 || input.environmentId.length > 200) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_ENVIRONMENT_INVALID",
        "The durable compensation environment identifier is invalid.",
      );
    }
    const compiled = await compileSharedCellAuthorCompensationStoredIntent(input.candidate);
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), inserted AS (
         INSERT INTO shared_cell_author_compensation_operations (
           operation_sha256, schema_version, environment_id, account_id, region,
           stack_name, stack_id, change_set_arn, operation_intent,
           delete_stack_client_request_token, state, current_phase,
           state_revision, lease_attempt, created_at, updated_at
         )
         SELECT $1, 1, $2, $3, $4, $5, $6, $7, $8, $9,
           'awaiting_delete_change_set_review', 'DELETE_CHANGE_SET', 1, 0,
           db_clock.now_ms, db_clock.now_ms
         FROM db_clock
         ON CONFLICT DO NOTHING
         RETURNING *
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, event_type,
           from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT inserted.operation_sha256, 1, 'DELETE_CHANGE_SET',
           'operation_created', NULL, inserted.state, $1,
           jsonb_build_object('operationSha256', $1)::text, inserted.created_at
         FROM inserted
         RETURNING operation_sha256
       ), selected AS (
         SELECT inserted.*, true AS was_created
         FROM inserted
         UNION ALL
         SELECT operation.*, false AS was_created
         FROM shared_cell_author_compensation_operations operation
         WHERE operation.operation_sha256 = $1
           AND operation.environment_id = $2
           AND operation.account_id = $3
           AND operation.region = $4
           AND operation.stack_name = $5
           AND operation.stack_id = $6
           AND operation.change_set_arn = $7
           AND operation.operation_intent = $8
           AND operation.delete_stack_client_request_token = $9
           AND NOT EXISTS (SELECT 1 FROM inserted)
       )
       SELECT ${snapshotProjection}, operation_row.was_created
       FROM selected operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}`,
      [
        compiled.plan.operationSha256,
        input.environmentId,
        input.candidate.accountId,
        input.candidate.region,
        input.candidate.stackName,
        input.candidate.stackId,
        input.candidate.changeSet.arn,
        canonicalJson(compiled.operationIntent),
        compiled.plan.deleteStackClientRequestToken,
      ],
      input.signal,
      true,
    );
    const resultRows = rows(raw);
    if (resultRows.length !== 1) {
      throw new SharedCellAuthorCompensationStoreError(
        "NEON_SHARED_CELL_AUTHOR_COMPENSATION_CREATE_REJECTED",
        "The exact durable compensation operation conflicts with existing state.",
      );
    }
    const row = record(resultRows[0]);
    return Object.freeze({
      outcome: row.was_created === true || row.was_created === "t" ? "created" : "existing",
      snapshot: snapshotFromResultRow(row),
    });
  }

  async appendReviewedWindow(input: {
    operationSha256: string;
    expectedStateRevision: number;
    phase: SharedCellAuthorCompensationPhase;
    candidate: SharedCellAuthorCompensationCandidate;
    approvedCompensationPlanSha256: string;
    approvedPhasePlanSha256: string;
    controllerContractSha256: string;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    assertSharedCellAuthorCompensationDigest(input.operationSha256, "operationSha256");
    if (!Number.isSafeInteger(input.expectedStateRevision) || input.expectedStateRevision < 1) {
      invalidRow("expected state revision");
    }
    if (!phaseValues.has(input.phase)) invalidRow("review phase");
    const compiled = await compileSharedCellAuthorCompensationStoredIntent(input.candidate);
    if (compiled.plan.operationSha256 !== input.operationSha256) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_PLAN_MISMATCH",
        "The reviewed candidate is not the exact durable operation.",
      );
    }
    const window = assertSharedCellAuthorCompensationReviewWindow(
      input.candidate,
      compiled.plan,
      input.phase,
      input.approvedCompensationPlanSha256,
      input.approvedPhasePlanSha256,
      input.controllerContractSha256,
    );
    const awaitingState = sqlState(input.phase, "review").replace("_review", "_review");
    const expectedState = `awaiting_${awaitingState}`;
    const preparedState = sqlState(input.phase, "prepared");
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, db_clock.now_ms,
           COALESCE((SELECT max(window_number) + 1
             FROM shared_cell_author_compensation_review_windows prior
             WHERE prior.operation_sha256 = operation.operation_sha256
               AND prior.phase = $3), 1) AS next_window
          FROM shared_cell_author_compensation_operations operation
          LEFT JOIN shared_cell_author_compensation_review_windows current_window
            ON current_window.operation_sha256 = operation.operation_sha256
           AND current_window.phase = operation.current_phase
           AND current_window.window_number = operation.current_window_number
          CROSS JOIN db_clock
          WHERE operation.operation_sha256 = $1
            AND operation.state_revision = $2
            AND (
              operation.state = $4
              OR (
                operation.state = $5
                AND operation.current_attempt_number IS NULL
                AND operation.current_grant_receipt_sha256 IS NULL
                AND current_window.operation_sha256 IS NOT NULL
                AND current_window.expires_at - db_clock.now_ms <= $12
                AND NOT EXISTS (
                  SELECT 1
                  FROM shared_cell_author_compensation_lifecycle_actions action
                  WHERE action.operation_sha256 = operation.operation_sha256
                    AND action.phase = operation.current_phase
                    AND action.window_number = operation.current_window_number
                )
              )
            )
            AND operation.current_phase = $3
            AND operation.lease_owner IS NULL
           AND db_clock.now_ms >= $10
           AND $11 - db_clock.now_ms > $12
          FOR UPDATE OF operation
        ), window_insert AS (
         INSERT INTO shared_cell_author_compensation_review_windows (
           operation_sha256, phase, window_number, candidate,
           compensation_plan_sha256, phase_plan_sha256,
           controller_contract_sha256, reviewed_at, expires_at, created_at
         )
         SELECT eligible.operation_sha256, $3, eligible.next_window, $7,
           $8, $9, $6, $10, $11, eligible.now_ms
         FROM eligible
         RETURNING *
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = $5, current_window_number = window_insert.window_number,
           current_attempt_number = NULL, current_grant_receipt_sha256 = NULL,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible, window_insert
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $2
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $3,
           window_insert.window_number, 'window_reviewed', eligible.state, $5, $6,
           jsonb_build_object(
             'compensationPlanSha256', $8,
             'phasePlanSha256', $9,
             'controllerContractSha256', $6
           )::text, updated.updated_at
         FROM updated, window_insert, eligible
         RETURNING operation_sha256
       )
       SELECT row_to_json(operation_row)::text AS operation_record,
         row_to_json(review_window)::text AS window_record,
         NULL::text AS attempt_record,
         NULL::text AS lifecycle_action_record
       FROM updated operation_row
       JOIN window_insert review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number`,
      [
        input.operationSha256,
        input.expectedStateRevision,
        input.phase,
        expectedState,
        preparedState,
        input.controllerContractSha256,
        canonicalJson(input.candidate),
        input.approvedCompensationPlanSha256,
        input.approvedPhasePlanSha256,
        window.reviewedAt,
        window.expiresAt,
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[input.phase],
      ],
      input.signal,
      true,
    );
    return singleSnapshot(raw);
  }

  async claimExactOperation(input: {
    operationSha256: string;
    workerId: string;
    leaseDurationMs: number;
    signal: AbortSignal;
  }): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    assertSharedCellAuthorCompensationDigest(input.operationSha256, "operationSha256");
    validateWorkerId(input.workerId);
    validateLeaseDuration(input.leaseDurationMs);
    let claimToken: string;
    try {
      claimToken = this.claimTokenFactory();
    } catch {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_CLAIM_INVALID",
        "The durable compensation claim token factory failed closed.",
      );
    }
    if (!claimTokenPattern.test(claimToken)) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_CLAIM_INVALID",
        "The durable compensation claim token factory returned an invalid token.",
      );
    }
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, db_clock.now_ms,
           operation.lease_owner IS NOT NULL AS was_claimed
         FROM shared_cell_author_compensation_operations operation
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.state IN (
             'delete_change_set_prepared', 'delete_change_set_ready',
             'delete_change_set_recover_only', 'delete_change_set_revoke_required',
             'delete_stack_prepared', 'delete_stack_ready',
             'delete_stack_recover_only', 'delete_stack_revoke_required'
           )
           AND (operation.lease_owner IS NULL OR operation.lease_expires_at <= db_clock.now_ms)
         FOR UPDATE
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET lease_owner = $2, claim_token = $3,
           lease_attempt = operation.lease_attempt + 1,
           lease_expires_at = eligible.now_ms + $4,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = eligible.state_revision
         RETURNING operation.*, eligible.was_claimed, eligible.state AS prior_state
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision,
           updated.current_phase, updated.current_window_number,
           updated.current_attempt_number,
           CASE WHEN updated.was_claimed THEN 'claim_taken_over' ELSE 'claim_acquired' END,
           updated.prior_state, updated.state, NULL,
           jsonb_build_object('leaseAttempt', updated.lease_attempt)::text,
           updated.updated_at
         FROM updated
         RETURNING operation_sha256
       )
       SELECT ${snapshotProjection}
        FROM updated operation_row
        LEFT JOIN shared_cell_author_compensation_review_windows review_window
          ON review_window.operation_sha256 = operation_row.operation_sha256
         AND review_window.phase = operation_row.current_phase
         AND review_window.window_number = operation_row.current_window_number
        LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
          ON phase_attempt.operation_sha256 = operation_row.operation_sha256
         AND phase_attempt.phase = operation_row.current_phase
         AND phase_attempt.window_number = operation_row.current_window_number
         AND phase_attempt.attempt_number = operation_row.current_attempt_number
        ${currentLifecycleActionJoin}`,
      [input.operationSha256, input.workerId, claimToken, input.leaseDurationMs],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    return snapshot ? claimFromSnapshot(snapshot) : null;
  }

  async beginLifecycleAction(
    input: Parameters<SharedCellAuthorCompensationOperationStore["beginLifecycleAction"]>[0],
  ): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    if (!Number.isSafeInteger(input.windowNumber) || input.windowNumber < 1) {
      invalidRow("lifecycle window number");
    }
    assertSharedCellAuthorCompensationLifecycleActionRequest(input.request);
    if (
      input.request.operationSha256 !== input.handle.operationSha256 ||
      input.request.windowNumber !== input.windowNumber
    ) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_REQUEST_MISMATCH",
        "The lifecycle request is not bound to the exact claimed operation and review window.",
      );
    }
    const requestSha256 =
      await sharedCellAuthorCompensationLifecycleActionRequestSha256(
        input.request,
      );
    const phase = input.request.phase;
    const kind = input.request.kind;
    const reason = kind === "REVOKE" ? input.request.reason : null;
    const expectedState =
      kind === "GRANT"
        ? sqlState(phase, "prepared")
        : reason === "WINDOW_EXPIRED"
          ? sqlState(phase, "ready")
          : sqlState(phase, "revoke_required");
    const actionNumber = kind === "GRANT" ? 1 : 2;
    const grantReceiptSha256 =
      kind === "REVOKE" ? input.request.grantReceiptSha256 : null;
    const predecessorReceiptSha256 =
      kind === "REVOKE" &&
      reason === "PHASE_COMPLETED" &&
      "completionReceiptSha256" in input.request
        ? input.request.completionReceiptSha256
        : null;
    const compensationPlanSha256 =
      kind === "GRANT" ? input.request.compensationPlanSha256 : null;
    const phasePlanSha256 =
      kind === "GRANT" ? input.request.phasePlanSha256 : null;
    const controllerContractSha256 =
      kind === "GRANT" ? input.request.controllerContractSha256 : null;
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, review_window.reviewed_at,
           review_window.expires_at, db_clock.now_ms
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_review_windows review_window
           ON review_window.operation_sha256 = operation.operation_sha256
          AND review_window.phase = operation.current_phase
          AND review_window.window_number = operation.current_window_number
         LEFT JOIN shared_cell_author_compensation_phase_attempts attempt
           ON attempt.operation_sha256 = operation.operation_sha256
          AND attempt.phase = operation.current_phase
          AND attempt.window_number = operation.current_window_number
          AND attempt.attempt_number = operation.current_attempt_number
         LEFT JOIN shared_cell_author_compensation_lifecycle_actions grant_action
           ON grant_action.operation_sha256 = operation.operation_sha256
          AND grant_action.phase = operation.current_phase
          AND grant_action.window_number = operation.current_window_number
          AND grant_action.action_kind = 'GRANT'
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.current_phase = $7
           AND operation.current_window_number = $8
           AND operation.state = $11
           AND NOT EXISTS (
             SELECT 1
             FROM shared_cell_author_compensation_lifecycle_actions uncertain
             WHERE uncertain.operation_sha256 = operation.operation_sha256
               AND uncertain.status = 'recover_only'
           )
           AND (
             ($9 = 'GRANT'
               AND operation.current_attempt_number IS NULL
               AND operation.current_grant_receipt_sha256 IS NULL
               AND review_window.compensation_plan_sha256 = $18
               AND review_window.phase_plan_sha256 = $19
               AND review_window.controller_contract_sha256 = $20
               AND db_clock.now_ms >= review_window.reviewed_at
               AND review_window.expires_at - db_clock.now_ms > $14)
             OR
             ($9 = 'REVOKE'
               AND operation.current_grant_receipt_sha256 = $16
               AND grant_action.status = 'completed'
               AND grant_action.completion_receipt_sha256 = $16
               AND (
                 ($10 = 'PHASE_COMPLETED'
                   AND attempt.status = 'completed'
                   AND attempt.completion_receipt_sha256 = $17)
                 OR
                 ($10 = 'WINDOW_EXPIRED'
                   AND operation.current_attempt_number IS NULL
                   AND review_window.expires_at - db_clock.now_ms <= $14)
               ))
           )
         FOR UPDATE OF operation
       ), action_insert AS (
         INSERT INTO shared_cell_author_compensation_lifecycle_actions (
           operation_sha256, phase, window_number, action_number,
           action_kind, revoke_reason, status, request, request_sha256,
           lease_attempt, prepared_revision, started_at, updated_at
         )
         SELECT eligible.operation_sha256, $7, $8, $15, $9, $10,
           'recover_only', $12, $13, eligible.lease_attempt,
           eligible.state_revision + 1, eligible.now_ms, eligible.now_ms
         FROM eligible
         RETURNING *
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible, action_insert
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $7, $8,
           'lifecycle_action_started', $11, $11, $13,
           jsonb_build_object(
             'actionNumber', $15,
             'kind', $9,
             'requestSha256', $13
           )::text, updated.updated_at
         FROM updated
         RETURNING operation_sha256
       )
       SELECT row_to_json(operation_row)::text AS operation_record,
         row_to_json(review_window)::text AS window_record,
         CASE WHEN phase_attempt.operation_sha256 IS NULL
           THEN NULL ELSE row_to_json(phase_attempt)::text END AS attempt_record,
         row_to_json(lifecycle_action)::text AS lifecycle_action_record
       FROM updated operation_row
       JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       JOIN action_insert lifecycle_action
         ON lifecycle_action.operation_sha256 = operation_row.operation_sha256
        AND lifecycle_action.phase = operation_row.current_phase
        AND lifecycle_action.window_number = operation_row.current_window_number`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        phase,
        input.windowNumber,
        kind,
        reason,
        expectedState,
        canonicalJson(input.request),
        requestSha256,
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[phase],
        actionNumber,
        grantReceiptSha256,
        predecessorReceiptSha256,
        compensationPlanSha256,
        phasePlanSha256,
        controllerContractSha256,
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    return snapshot ? claimFromSnapshot(snapshot) : null;
  }

  async completeLifecycleAction(
    input: Parameters<SharedCellAuthorCompensationOperationStore["completeLifecycleAction"]>[0],
  ): Promise<Readonly<{
    claim: Readonly<SharedCellAuthorCompensationClaim> | null;
    snapshot: Readonly<SharedCellAuthorCompensationOperationSnapshot>;
  }> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    if (!Number.isSafeInteger(input.actionNumber) || input.actionNumber < 1) {
      invalidRow("lifecycle action number");
    }
    const receipt = input.receipt;
    let kind: SharedCellAuthorCompensationLifecycleActionKind;
    let reason: "PHASE_COMPLETED" | "WINDOW_EXPIRED" | null;
    if (receipt.action === "shared_cell_author_compensation_phase_grant_verified") {
      assertSharedCellAuthorCompensationPhaseGrantReceipt(receipt);
      kind = "GRANT";
      reason = null;
    } else if (receipt.action === "shared_cell_author_compensation_locked_verified") {
      assertSharedCellAuthorCompensationLockedReceipt(receipt);
      kind = "REVOKE";
      reason = "PHASE_COMPLETED";
    } else {
      assertSharedCellAuthorCompensationWindowExpiredLockedReceipt(receipt);
      kind = "REVOKE";
      reason = "WINDOW_EXPIRED";
    }
    if (
      receipt.operationSha256 !== input.handle.operationSha256 ||
      input.actionNumber !== (kind === "GRANT" ? 1 : 2)
    ) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_LIFECYCLE_RECEIPT_MISMATCH",
        "The lifecycle completion receipt is not bound to the exact durable action.",
      );
    }
    const phase = receipt.phase;
    const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(
      receipt,
    );
    const receiptObservedAt = Date.parse(receipt.observedAt);
    const preparedState = sqlState(phase, "prepared");
    const readyState = sqlState(phase, "ready");
    const revokeRequiredState = sqlState(phase, "revoke_required");
    const awaitingReviewState = `awaiting_${sqlState(phase, "review")}`;
    const grantReceiptSha256 =
      receipt.action ===
      "shared_cell_author_compensation_window_expired_locked_verified"
        ? receipt.grantReceiptSha256
        : null;
    const completionReceiptSha256 =
      receipt.action === "shared_cell_author_compensation_locked_verified"
        ? receipt.completionReceiptSha256
        : null;
    const grantCompensationPlanSha256 =
      receipt.action === "shared_cell_author_compensation_phase_grant_verified"
        ? receipt.compensationPlanSha256
        : null;
    const grantPhasePlanSha256 =
      receipt.action === "shared_cell_author_compensation_phase_grant_verified"
        ? receipt.phasePlanSha256
        : null;
    const grantControllerContractSha256 =
      receipt.action === "shared_cell_author_compensation_phase_grant_verified"
        ? receipt.controllerContractSha256
        : null;
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, review_window.reviewed_at,
           review_window.expires_at, action.request,
           action.request_sha256, db_clock.now_ms,
           CASE
             WHEN $9 = 'GRANT' THEN $15
             WHEN $10 = 'WINDOW_EXPIRED' THEN $17
             WHEN (attempt.completion_receipt::jsonb #>> '{observedState}') = 'MISSING'
               THEN 'missing_proven_locked'
             ELSE 'awaiting_delete_stack_review'
           END AS next_state
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_review_windows review_window
           ON review_window.operation_sha256 = operation.operation_sha256
          AND review_window.phase = operation.current_phase
          AND review_window.window_number = operation.current_window_number
         JOIN shared_cell_author_compensation_lifecycle_actions action
           ON action.operation_sha256 = operation.operation_sha256
          AND action.phase = operation.current_phase
          AND action.window_number = operation.current_window_number
          AND action.action_number = $7
         LEFT JOIN shared_cell_author_compensation_phase_attempts attempt
           ON attempt.operation_sha256 = operation.operation_sha256
          AND attempt.phase = operation.current_phase
          AND attempt.window_number = operation.current_window_number
          AND attempt.attempt_number = operation.current_attempt_number
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.current_phase = $8
           AND action.action_kind = $9
           AND action.revoke_reason IS NOT DISTINCT FROM $10
           AND action.status = 'recover_only'
           AND (action.request::jsonb #>> '{operationSha256}') = operation.operation_sha256
           AND (action.request::jsonb #>> '{phase}') = operation.current_phase
           AND (action.request::jsonb #>> '{windowNumber}')::integer = operation.current_window_number
           AND (action.request::jsonb #>> '{kind}') = action.action_kind
           AND $13 >= action.started_at
           AND $13 <= db_clock.now_ms
           AND (
             ($9 = 'GRANT'
               AND operation.state = $14
               AND operation.current_attempt_number IS NULL
               AND operation.current_grant_receipt_sha256 IS NULL
               AND review_window.compensation_plan_sha256 = $21
               AND review_window.phase_plan_sha256 = $22
               AND review_window.controller_contract_sha256 = $23
               AND (action.request::jsonb #>> '{compensationPlanSha256}') = $21
               AND (action.request::jsonb #>> '{phasePlanSha256}') = $22
                AND (action.request::jsonb #>> '{controllerContractSha256}') = $23
                AND $13 >= review_window.reviewed_at
                AND review_window.expires_at - action.started_at > $18
                AND (
                  (($11::jsonb #>> '{disposition}') = 'PHASE_EXECUTION_ALLOWED'
                    AND review_window.expires_at - $13 > $18
                    AND review_window.expires_at - db_clock.now_ms > $18)
                  OR
                  (($11::jsonb #>> '{disposition}') = 'REVOKE_ONLY'
                    AND review_window.expires_at - $13 <= $18)
                ))
             OR
             ($10 = 'PHASE_COMPLETED'
               AND operation.state = $16
               AND operation.current_grant_receipt_sha256 =
                 (action.request::jsonb #>> '{grantReceiptSha256}')
               AND attempt.status = 'completed'
               AND attempt.completion_receipt_sha256 = $20
               AND (action.request::jsonb #>> '{completionReceiptSha256}') = $20)
             OR
             ($10 = 'WINDOW_EXPIRED'
               AND operation.state = $15
               AND operation.current_attempt_number IS NULL
               AND operation.current_grant_receipt_sha256 = $19
               AND (action.request::jsonb #>> '{grantReceiptSha256}') = $19
               AND review_window.expires_at - db_clock.now_ms <= $18
               AND review_window.expires_at - $13 <= $18)
           )
         FOR UPDATE OF operation, action
       ), action_complete AS (
         UPDATE shared_cell_author_compensation_lifecycle_actions action
         SET status = 'completed', completion_receipt = $11,
           completion_receipt_sha256 = $12,
           updated_at = eligible.now_ms, completed_at = eligible.now_ms
         FROM eligible
         WHERE action.operation_sha256 = eligible.operation_sha256
           AND action.phase = $8
           AND action.window_number = eligible.current_window_number
           AND action.action_number = $7
           AND action.status = 'recover_only'
         RETURNING action.*
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = eligible.next_state,
           current_phase = CASE
             WHEN $9 = 'GRANT' THEN operation.current_phase
             WHEN eligible.next_state = 'awaiting_delete_stack_review'
               THEN 'DELETE_STACK'
             WHEN eligible.next_state IN (
               'awaiting_delete_change_set_review', 'awaiting_delete_stack_review'
             ) THEN operation.current_phase
             ELSE NULL
           END,
           current_window_number = CASE WHEN $9 = 'GRANT'
             THEN operation.current_window_number ELSE NULL END,
           current_attempt_number = CASE WHEN $9 = 'GRANT'
             THEN operation.current_attempt_number ELSE NULL END,
           current_grant_receipt_sha256 = CASE WHEN $9 = 'GRANT'
             THEN $12 ELSE NULL END,
           lease_owner = CASE WHEN $9 = 'GRANT' THEN operation.lease_owner ELSE NULL END,
           claim_token = CASE WHEN $9 = 'GRANT' THEN operation.claim_token ELSE NULL END,
           lease_expires_at = CASE WHEN $9 = 'GRANT' THEN operation.lease_expires_at ELSE NULL END,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms,
           completed_at = CASE WHEN eligible.next_state = 'missing_proven_locked'
             THEN eligible.now_ms ELSE NULL END
         FROM eligible, action_complete
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $8,
           eligible.current_window_number, eligible.current_attempt_number,
           'lifecycle_action_completed', eligible.state, eligible.next_state,
           $12, $11, updated.updated_at
         FROM updated, eligible
         RETURNING operation_sha256
       )
       SELECT row_to_json(operation_row)::text AS operation_record,
         CASE WHEN $9 = 'GRANT' THEN row_to_json(review_window)::text
           ELSE NULL::text END AS window_record,
         CASE WHEN $9 = 'GRANT' AND phase_attempt.operation_sha256 IS NOT NULL
           THEN row_to_json(phase_attempt)::text ELSE NULL::text END AS attempt_record,
         CASE WHEN $9 = 'GRANT' THEN row_to_json(lifecycle_action)::text
           ELSE NULL::text END AS lifecycle_action_record
       FROM updated operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       LEFT JOIN action_complete lifecycle_action ON $9 = 'GRANT'`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        input.actionNumber,
        phase,
        kind,
        reason,
        canonicalJson(receipt),
        receiptSha256,
        receiptObservedAt,
        preparedState,
        readyState,
        revokeRequiredState,
        awaitingReviewState,
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[phase],
        grantReceiptSha256,
        completionReceiptSha256,
        grantCompensationPlanSha256,
        grantPhasePlanSha256,
        grantControllerContractSha256,
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    if (!snapshot) return null;
    return Object.freeze({
      claim: kind === "GRANT" ? claimFromSnapshot(snapshot) : null,
      snapshot,
    });
  }

  async preparePhase(input: Parameters<SharedCellAuthorCompensationOperationStore["preparePhase"]>[0]): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    if (!Number.isSafeInteger(input.windowNumber) || input.windowNumber < 1) invalidRow("window number");
    assertSharedCellAuthorCompensationPhaseGrantReceipt(input.grantReceipt);
    if (input.grantReceipt.operationSha256 !== input.handle.operationSha256) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_MISMATCH",
        "The phase grant receipt is not bound to the claimed operation.",
      );
    }
    const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(input.grantReceipt);
    const preparedState = sqlState(input.grantReceipt.phase, "prepared");
    const readyState = sqlState(input.grantReceipt.phase, "ready");
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, review_window.compensation_plan_sha256,
           review_window.phase_plan_sha256, review_window.controller_contract_sha256,
           db_clock.now_ms
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_review_windows review_window
           ON review_window.operation_sha256 = operation.operation_sha256
          AND review_window.phase = operation.current_phase
          AND review_window.window_number = operation.current_window_number
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.state = $8 AND operation.current_phase = $7
           AND operation.current_window_number = $9
           AND review_window.compensation_plan_sha256 = $10
           AND review_window.phase_plan_sha256 = $11
           AND review_window.controller_contract_sha256 = $12
           AND db_clock.now_ms >= review_window.reviewed_at
           AND review_window.expires_at - db_clock.now_ms > $14
           AND $17 >= review_window.reviewed_at
           AND $17 < review_window.expires_at
           AND $17 <= db_clock.now_ms
         FOR UPDATE OF operation
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = $13, current_grant_receipt_sha256 = $15,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $7, $9,
           'phase_prepared', $8, $13, $15, $16, updated.updated_at
         FROM updated
         RETURNING operation_sha256
       )
       SELECT ${snapshotProjection}
        FROM updated operation_row
        LEFT JOIN shared_cell_author_compensation_review_windows review_window
          ON review_window.operation_sha256 = operation_row.operation_sha256
         AND review_window.phase = operation_row.current_phase
         AND review_window.window_number = operation_row.current_window_number
        LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
          ON phase_attempt.operation_sha256 = operation_row.operation_sha256
         AND phase_attempt.phase = operation_row.current_phase
         AND phase_attempt.window_number = operation_row.current_window_number
         AND phase_attempt.attempt_number = operation_row.current_attempt_number
        ${currentLifecycleActionJoin}`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        input.grantReceipt.phase,
        preparedState,
        input.windowNumber,
        input.grantReceipt.compensationPlanSha256,
        input.grantReceipt.phasePlanSha256,
        input.grantReceipt.controllerContractSha256,
        readyState,
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[input.grantReceipt.phase],
        receiptSha256,
        canonicalJson(input.grantReceipt),
        Date.parse(input.grantReceipt.observedAt),
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    return snapshot ? claimFromSnapshot(snapshot) : null;
  }

  async beginSubmission(input: Parameters<SharedCellAuthorCompensationOperationStore["beginSubmission"]>[0]): Promise<Readonly<SharedCellAuthorCompensationSubmissionReceipt> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    assertSharedCellAuthorCompensationDigest(input.controllerContractSha256, "controllerContractSha256");
    if (!Number.isSafeInteger(input.windowNumber) || input.windowNumber < 1) invalidRow("window number");
    const current = await this.readOperation({
      operationSha256: input.handle.operationSha256,
      signal: input.signal,
    });
    if (!current) return null;
    const mutation = await compileSharedCellAuthorCompensationMutationRequest(
      current.operation,
      input.mutation,
    );
    const phase = mutation.request.phase;
    const readyState = sqlState(phase, "ready");
    const recoverOnlyState = sqlState(phase, "recover_only");
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, review_window.controller_contract_sha256,
           db_clock.now_ms,
           COALESCE((SELECT max(attempt_number) + 1
             FROM shared_cell_author_compensation_phase_attempts prior
             WHERE prior.operation_sha256 = operation.operation_sha256
               AND prior.phase = $7), 1) AS next_attempt
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_review_windows review_window
           ON review_window.operation_sha256 = operation.operation_sha256
          AND review_window.phase = operation.current_phase
          AND review_window.window_number = operation.current_window_number
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.state = $8 AND operation.current_phase = $7
           AND operation.current_window_number = $9
           AND review_window.controller_contract_sha256 = $10
           AND db_clock.now_ms >= review_window.reviewed_at
           AND review_window.expires_at - db_clock.now_ms > $11
           AND (($7 = 'DELETE_CHANGE_SET'
                 AND ($12::jsonb #>> '{request,ChangeSetName}') = operation.change_set_arn
                 AND ($12::jsonb #>> '{request,StackName}') = operation.stack_id)
             OR ($7 = 'DELETE_STACK'
                 AND ($12::jsonb #>> '{request,StackName}') = operation.stack_id
                 AND ($12::jsonb #>> '{request,DeletionMode}') = 'STANDARD'
                 AND ($12::jsonb #>> '{request,ClientRequestToken}') = operation.delete_stack_client_request_token))
         FOR UPDATE OF operation
       ), attempt_insert AS (
         INSERT INTO shared_cell_author_compensation_phase_attempts (
           operation_sha256, phase, attempt_number, window_number, status,
           request, request_sha256, client_request_token, lease_attempt,
           prepared_revision, started_at, updated_at
         )
         SELECT eligible.operation_sha256, $7, eligible.next_attempt, $9,
           'recover_only', $12, $13, $14, eligible.lease_attempt,
           eligible.state_revision + 1, eligible.now_ms, eligible.now_ms
         FROM eligible
         RETURNING *
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = $15, current_attempt_number = attempt_insert.attempt_number,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible, attempt_insert
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $7, $9,
           attempt_insert.attempt_number, 'submission_started', $8, $15,
           $13, jsonb_build_object(
             'requestSha256', $13,
             'controllerContractSha256', $10
           )::text, updated.updated_at
         FROM updated, attempt_insert
         RETURNING operation_sha256
       )
       SELECT ${snapshotProjection}
       FROM updated operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       JOIN attempt_insert phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        phase,
        readyState,
        input.windowNumber,
        input.controllerContractSha256,
        SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[phase],
        canonicalJson(mutation.request),
        mutation.requestSha256,
        mutation.clientRequestToken,
        recoverOnlyState,
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    if (!snapshot || !snapshot.currentAttempt) return null;
    return Object.freeze({
      handle: handleFromSnapshot(snapshot),
      attemptNumber: snapshot.currentAttempt.attemptNumber,
      requestSha256: snapshot.currentAttempt.requestSha256,
      snapshot,
    });
  }

  async completePhase(input: Parameters<SharedCellAuthorCompensationOperationStore["completePhase"]>[0]): Promise<Readonly<SharedCellAuthorCompensationClaim> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) invalidRow("attempt number");
    assertSharedCellAuthorCompensationPhaseCompletionReceipt(input.completionReceipt);
    if (input.completionReceipt.operationSha256 !== input.handle.operationSha256) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_MISMATCH",
        "The phase completion receipt is not bound to the claimed operation.",
      );
    }
    const receiptSha256 = await sharedCellAuthorCompensationReceiptSha256(input.completionReceipt);
    const phase = input.completionReceipt.phase;
    const recoverOnlyState = sqlState(phase, "recover_only");
    const revokeRequiredState = sqlState(phase, "revoke_required");
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, db_clock.now_ms
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_review_windows review_window
           ON review_window.operation_sha256 = operation.operation_sha256
          AND review_window.phase = operation.current_phase
          AND review_window.window_number = operation.current_window_number
         JOIN shared_cell_author_compensation_phase_attempts attempt
           ON attempt.operation_sha256 = operation.operation_sha256
          AND attempt.phase = operation.current_phase
          AND attempt.window_number = operation.current_window_number
          AND attempt.attempt_number = operation.current_attempt_number
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.state = $8 AND operation.current_phase = $7
           AND operation.current_attempt_number = $9
           AND attempt.status = 'recover_only'
           AND review_window.compensation_plan_sha256 = $10
           AND review_window.phase_plan_sha256 = $11
           AND review_window.controller_contract_sha256 = $12
           AND $16 >= attempt.started_at
           AND $16 <= db_clock.now_ms
         FOR UPDATE OF operation, attempt
       ), attempt_complete AS (
         UPDATE shared_cell_author_compensation_phase_attempts attempt
         SET status = 'completed', completion_receipt = $13,
           completion_receipt_sha256 = $14,
           updated_at = eligible.now_ms, completed_at = eligible.now_ms
         FROM eligible
         WHERE attempt.operation_sha256 = eligible.operation_sha256
           AND attempt.phase = $7 AND attempt.attempt_number = $9
           AND attempt.status = 'recover_only'
         RETURNING attempt.*
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = $15, state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible, attempt_complete
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $7,
           updated.current_window_number, $9, 'phase_completed', $8, $15,
           $14, $13, updated.updated_at
         FROM updated
         RETURNING operation_sha256
       )
       SELECT ${snapshotProjection}
       FROM updated operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       JOIN attempt_complete phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        phase,
        recoverOnlyState,
        input.attemptNumber,
        input.completionReceipt.compensationPlanSha256,
        input.completionReceipt.phasePlanSha256,
        input.completionReceipt.controllerContractSha256,
        canonicalJson(input.completionReceipt),
        receiptSha256,
        revokeRequiredState,
        Date.parse(input.completionReceipt.observedAt),
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    return snapshot ? claimFromSnapshot(snapshot) : null;
  }

  async recordLockedAndAdvance(input: Parameters<SharedCellAuthorCompensationOperationStore["recordLockedAndAdvance"]>[0]): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    assertSharedCellAuthorCompensationLockedReceipt(input.lockedReceipt);
    if (input.lockedReceipt.operationSha256 !== input.handle.operationSha256) {
      throw new SharedCellAuthorCompensationStoreError(
        "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_MISMATCH",
        "The Locked receipt is not bound to the claimed operation.",
      );
    }
    const lockedReceiptSha256 = await sharedCellAuthorCompensationReceiptSha256(input.lockedReceipt);
    const phase = input.lockedReceipt.phase;
    const revokeRequiredState = sqlState(phase, "revoke_required");
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, db_clock.now_ms,
           CASE
             WHEN (attempt.completion_receipt::jsonb #>> '{observedState}') = 'MISSING'
               THEN 'missing_proven_locked'
             ELSE 'awaiting_delete_stack_review'
           END AS next_state
         FROM shared_cell_author_compensation_operations operation
         JOIN shared_cell_author_compensation_phase_attempts attempt
           ON attempt.operation_sha256 = operation.operation_sha256
          AND attempt.phase = operation.current_phase
          AND attempt.window_number = operation.current_window_number
          AND attempt.attempt_number = operation.current_attempt_number
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND operation.state = $8 AND operation.current_phase = $7
           AND attempt.status = 'completed'
           AND attempt.completion_receipt_sha256 = $9
           AND (
             ($7 = 'DELETE_CHANGE_SET'
               AND (attempt.completion_receipt::jsonb #>> '{observedState}')
                 IN ('REVIEW_IN_PROGRESS', 'MISSING'))
             OR ($7 = 'DELETE_STACK'
               AND (attempt.completion_receipt::jsonb #>> '{observedState}') = 'MISSING')
           )
           AND $12 >= attempt.completed_at
           AND $12 <= db_clock.now_ms
         FOR UPDATE OF operation
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET state = eligible.next_state,
           current_phase = CASE
             WHEN eligible.next_state = 'awaiting_delete_stack_review'
               THEN 'DELETE_STACK'
             ELSE NULL
           END,
           current_window_number = NULL, current_attempt_number = NULL,
           current_grant_receipt_sha256 = NULL,
           lease_owner = NULL, claim_token = NULL, lease_expires_at = NULL,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms,
           completed_at = CASE
             WHEN eligible.next_state = 'missing_proven_locked'
               THEN eligible.now_ms
             ELSE NULL
           END
         FROM eligible
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence_sha256, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision, $7,
           eligible.current_window_number, eligible.current_attempt_number,
           'locked_proven', $8, eligible.next_state, $10, $11, updated.updated_at
         FROM updated, eligible
         RETURNING operation_sha256
       )
       SELECT row_to_json(operation_row)::text AS operation_record,
         NULL::text AS window_record, NULL::text AS attempt_record,
         NULL::text AS lifecycle_action_record
       FROM updated operation_row`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        phase,
        revokeRequiredState,
        input.lockedReceipt.completionReceiptSha256,
        lockedReceiptSha256,
        canonicalJson(input.lockedReceipt),
        Date.parse(input.lockedReceipt.observedAt),
      ],
      input.signal,
      true,
    );
    return singleSnapshot(raw);
  }

  async heartbeat(input: Parameters<SharedCellAuthorCompensationOperationStore["heartbeat"]>[0]): Promise<Readonly<SharedCellAuthorCompensationClaimHandle> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    validateLeaseDuration(input.leaseDurationMs);
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET lease_expires_at = db_clock.now_ms + $7,
           updated_at = db_clock.now_ms
         FROM db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
           AND db_clock.now_ms + $7 > operation.lease_expires_at
         RETURNING operation.*
       )
       SELECT ${snapshotProjection}
       FROM updated operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
        input.leaseDurationMs,
      ],
      input.signal,
      true,
    );
    const snapshot = singleSnapshot(raw);
    return snapshot ? handleFromSnapshot(snapshot) : null;
  }

  async releaseClaim(input: Parameters<SharedCellAuthorCompensationOperationStore["releaseClaim"]>[0]): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    assertSharedCellAuthorCompensationClaimHandle(input.handle);
    const raw = await this.query(
      `WITH db_clock AS (
         SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS (
         SELECT operation.*, db_clock.now_ms
         FROM shared_cell_author_compensation_operations operation
         CROSS JOIN db_clock
         WHERE operation.operation_sha256 = $1
           AND operation.lease_owner = $2 AND operation.claim_token = $3
           AND operation.lease_attempt = $4 AND operation.state_revision = $5
           AND operation.lease_expires_at = $6
           AND operation.lease_expires_at > db_clock.now_ms
         FOR UPDATE
       ), updated AS (
         UPDATE shared_cell_author_compensation_operations operation
         SET lease_owner = NULL, claim_token = NULL, lease_expires_at = NULL,
           state_revision = operation.state_revision + 1,
           updated_at = eligible.now_ms
         FROM eligible
         WHERE operation.operation_sha256 = eligible.operation_sha256
           AND operation.state_revision = $5
         RETURNING operation.*, eligible.state AS prior_state
       ), event_insert AS (
         INSERT INTO shared_cell_author_compensation_events (
           operation_sha256, state_revision, phase, window_number, attempt_number,
           event_type, from_state, to_state, evidence, created_at
         )
         SELECT updated.operation_sha256, updated.state_revision,
           updated.current_phase, updated.current_window_number,
           updated.current_attempt_number, 'claim_released',
           updated.prior_state, updated.state,
           jsonb_build_object('leaseAttempt', updated.lease_attempt)::text,
           updated.updated_at
         FROM updated
         RETURNING operation_sha256
       )
       SELECT ${snapshotProjection}
       FROM updated operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}`,
      [
        input.handle.operationSha256,
        input.handle.workerId,
        input.handle.claimToken,
        input.handle.leaseAttempt,
        input.handle.stateRevision,
        input.handle.leaseExpiresAt,
      ],
      input.signal,
      true,
    );
    return singleSnapshot(raw);
  }

  async readOperation(input: Parameters<SharedCellAuthorCompensationOperationStore["readOperation"]>[0]): Promise<Readonly<SharedCellAuthorCompensationOperationSnapshot> | null> {
    assertSharedCellAuthorCompensationDigest(input.operationSha256, "operationSha256");
    const raw = await this.query(
      `SELECT ${snapshotProjection}
       FROM shared_cell_author_compensation_operations operation_row
       LEFT JOIN shared_cell_author_compensation_review_windows review_window
         ON review_window.operation_sha256 = operation_row.operation_sha256
        AND review_window.phase = operation_row.current_phase
        AND review_window.window_number = operation_row.current_window_number
       LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt
         ON phase_attempt.operation_sha256 = operation_row.operation_sha256
        AND phase_attempt.phase = operation_row.current_phase
        AND phase_attempt.window_number = operation_row.current_window_number
        AND phase_attempt.attempt_number = operation_row.current_attempt_number
       ${currentLifecycleActionJoin}
       WHERE operation_row.operation_sha256 = $1`,
      [input.operationSha256],
      input.signal,
      false,
    );
    return singleSnapshot(raw);
  }
}

export function createNeonSharedCellAuthorCompensationOperationStore(
  databaseUrl: string,
  claimTokenFactory?: SharedCellAuthorCompensationClaimTokenFactory,
): NeonSharedCellAuthorCompensationOperationStore {
  if (typeof databaseUrl !== "string" || !databaseUrlPattern.test(databaseUrl)) {
    throw new SharedCellAuthorCompensationStoreError(
      "NEON_SHARED_CELL_AUTHOR_COMPENSATION_DATABASE_URL_INVALID",
      "The durable compensation store requires a PostgreSQL DATABASE_URL.",
    );
  }
  try {
    const sql = neon(databaseUrl, { fullResults: true });
    return new NeonSharedCellAuthorCompensationOperationStore(
      sql as unknown as NeonSharedCellAuthorCompensationSqlClient,
      claimTokenFactory,
    );
  } catch {
    throw new SharedCellAuthorCompensationStoreError(
      "NEON_SHARED_CELL_AUTHOR_COMPENSATION_DATABASE_URL_INVALID",
      "The durable compensation store requires a valid PostgreSQL DATABASE_URL.",
    );
  }
}
