import { getDatabase } from "@/db";
import { stableId } from "@/lib/domain/ids";
import type {
  DeploymentJobStatus,
  DeploymentJobType,
} from "./state-machine";
import {
  assertDeploymentLeaseDuration,
  assertDeploymentWorkerId,
  buildDeploymentClaimStatement,
} from "./lease.ts";
import {
  assertSafeDeploymentOutput,
  normalizeDeploymentError,
} from "./safety.ts";
import {
  beginDeploymentStepStatement,
  finishDeploymentStepStatement,
  LostDeploymentLeaseError,
} from "./step-lease.ts";

export { assertSafeDeploymentOutput, redactDeploymentError } from "./safety.ts";

export interface DeploymentJobView {
  id: string;
  deploymentId: string;
  jobType: DeploymentJobType;
  dedupeKey: string;
  status: DeploymentJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface DeploymentJobRow {
  id: string;
  deployment_id: string;
  job_type: DeploymentJobType;
  dedupe_key: string;
  status: DeploymentJobStatus;
  payload: string;
  attempts: number;
  max_attempts: number;
  available_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toJobView(row: DeploymentJobRow): DeploymentJobView {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    jobType: row.job_type,
    dedupeKey: row.dedupe_key,
    status: row.status,
    payload: parseObject(row.payload),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function prepareDeploymentJobInsert(input: {
  deploymentId: string;
  jobType: DeploymentJobType;
  planHash: string;
  availableAt: number;
  now?: number;
  maxAttempts?: number;
}): Promise<{
  id: string;
  dedupeKey: string;
  statement: DatabasePreparedStatement;
}> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(input.deploymentId)) {
    throw new Error("Deployment id is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.planHash)) {
    throw new Error("Deployment plan hash is invalid.");
  }
  if (!Number.isSafeInteger(input.availableAt) || input.availableAt <= 0) {
    throw new Error("Deployment job availability time is invalid.");
  }
  const dedupeKey = `${input.jobType}:${input.deploymentId}:${input.planHash}`;
  const maxAttempts = input.maxAttempts ?? 5;
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Deployment job creation time is invalid.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("Deployment job max attempts must be between 1 and 20.");
  }
  const id = await stableId("job", dedupeKey);
  const payload = JSON.stringify({
    schemaVersion: 1,
    deploymentId: input.deploymentId,
    planHash: input.planHash,
  });
  return {
    id,
    dedupeKey,
    statement: getDatabase()
      .prepare(
        `INSERT INTO deployment_jobs (
          id, deployment_id, job_type, dedupe_key, status, payload,
          attempts, max_attempts, available_at, lease_owner,
          lease_expires_at, last_error_code, last_error_message,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?, NULL, NULL,
          NULL, NULL, ?, ?, NULL)
        ON CONFLICT (dedupe_key) DO NOTHING`,
      )
      .bind(
        id,
        input.deploymentId,
        input.jobType,
        dedupeKey,
        payload,
        maxAttempts,
        input.availableAt,
        now,
        now,
      ),
  };
}

export async function getDeploymentJob(jobId: string): Promise<DeploymentJobView | null> {
  const row = await getDatabase()
    .prepare(
      `SELECT id, deployment_id, job_type, dedupe_key, status, payload,
        attempts, max_attempts, available_at, lease_owner, lease_expires_at,
        last_error_code, last_error_message, created_at, updated_at, completed_at
       FROM deployment_jobs WHERE id = ? LIMIT 1`,
    )
    .bind(jobId)
    .first<DeploymentJobRow>();
  return row ? toJobView(row) : null;
}

/**
 * Atomically leases one ready job. The CTE and UPDATE execute as one PostgreSQL
 * statement, so concurrent workers cannot claim the same row.
 */
export async function claimNextDeploymentJob(input: {
  workerId: string;
  now?: number;
  leaseDurationMs?: number;
  jobType?: DeploymentJobType;
}): Promise<DeploymentJobView | null> {
  assertDeploymentWorkerId(input.workerId);
  const now = input.now ?? Date.now();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const statement = buildDeploymentClaimStatement({
    workerId: input.workerId,
    now,
    leaseDurationMs,
    jobType: input.jobType,
  });
  const row = await getDatabase()
    .prepare(statement.sql)
    .bind(...statement.bindings)
    .first<DeploymentJobRow>();
  return row ? toJobView(row) : null;
}

export async function heartbeatDeploymentJob(input: {
  jobId: string;
  workerId: string;
  now?: number;
  leaseDurationMs?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  const now = input.now ?? Date.now();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  assertDeploymentLeaseDuration(leaseDurationMs);
  const result = await getDatabase()
    .prepare(
      `UPDATE deployment_jobs
       SET lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?
         AND lease_expires_at > ?`,
    )
    .bind(now + leaseDurationMs, now, input.jobId, input.workerId, now)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function completeDeploymentJob(input: {
  jobId: string;
  workerId: string;
  now?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  const now = input.now ?? Date.now();
  const result = await getDatabase()
    .prepare(
      `UPDATE deployment_jobs
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?
         AND lease_expires_at > ?`,
    )
    .bind(now, now, input.jobId, input.workerId, now)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function failDeploymentJob(input: {
  jobId: string;
  workerId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryDelayMs?: number;
  now?: number;
}): Promise<DeploymentJobView | null> {
  assertDeploymentWorkerId(input.workerId);
  const now = input.now ?? Date.now();
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error("Deployment retry delay is invalid.");
  }
  const row = await getDatabase()
    .prepare(
      `UPDATE deployment_jobs
       SET status = CASE
             WHEN attempts >= max_attempts THEN 'dead_letter'
             ELSE 'retry_wait'
           END,
           available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = ?, last_error_message = ?, updated_at = ?,
           completed_at = CASE WHEN attempts >= max_attempts THEN ? ELSE NULL END
       WHERE id = ? AND status = 'running' AND lease_owner = ?
         AND lease_expires_at > ?
       RETURNING id, deployment_id, job_type, dedupe_key, status, payload,
         attempts, max_attempts, available_at, lease_owner, lease_expires_at,
         last_error_code, last_error_message, created_at, updated_at, completed_at`,
    )
    .bind(
      now + retryDelayMs,
      normalizeDeploymentError(input.errorCode, "DEPLOYMENT_STEP_FAILED"),
      normalizeDeploymentError(input.errorMessage, "Deployment step failed."),
      now,
      now,
      input.jobId,
      input.workerId,
      now,
    )
    .first<DeploymentJobRow>();
  return row ? toJobView(row) : null;
}

export async function beginDeploymentStep(input: {
  deploymentId: string;
  jobId: string;
  stepKey: string;
  inputHash: string;
  attempt: number;
  workerId: string;
  now?: number;
}): Promise<string> {
  assertDeploymentWorkerId(input.workerId);
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 20) {
    throw new Error("Deployment step attempt must be between 1 and 20.");
  }
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(input.stepKey)) {
    throw new Error("Deployment step key is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.inputHash)) {
    throw new Error("Deployment step input hash is invalid.");
  }
  const now = input.now ?? Date.now();
  const id = await stableId(
    "step",
    `${input.deploymentId}:${input.stepKey}:${input.inputHash}:${input.attempt}`,
  );
  const row = await getDatabase()
    .prepare(beginDeploymentStepStatement)
    .bind(
      input.jobId,
      input.deploymentId,
      input.workerId,
      now,
      input.attempt,
      id,
      input.deploymentId,
      input.jobId,
      input.stepKey,
      input.attempt,
      input.inputHash,
      now,
      input.deploymentId,
      input.stepKey,
      input.inputHash,
      input.attempt,
    )
    .first<{ id: string }>();
  if (!row) throw new LostDeploymentLeaseError();
  return row.id;
}

export async function finishDeploymentStep(input: {
  stepRunId: string;
  status: "succeeded" | "failed" | "skipped";
  output?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  workerId: string;
  now?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  const now = input.now ?? Date.now();
  const output = input.output ?? {};
  assertSafeDeploymentOutput(output);
  const result = await getDatabase()
    .prepare(finishDeploymentStepStatement)
    .bind(
      input.status,
      JSON.stringify(output),
      input.errorCode
        ? normalizeDeploymentError(input.errorCode, "STEP_FAILED")
        : null,
      input.errorMessage
        ? normalizeDeploymentError(input.errorMessage, "Deployment step failed.")
        : null,
      now,
      input.stepRunId,
      input.workerId,
      now,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}
