import { getDatabase } from "@/db";
import { stableId } from "@/lib/domain/ids";
import type {
  DeploymentJobStatus,
  DeploymentJobType,
} from "./state-machine";
import {
  assertDeploymentLeaseDuration,
  assertDeploymentLeaseToken,
  assertDeploymentWorkerId,
  buildDeploymentClaimStatement,
  createDeploymentLeaseToken,
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
  leaseToken: string | null;
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
  lease_token: string | null;
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
    leaseToken: row.lease_token,
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
          lease_expires_at, lease_token, last_error_code, last_error_message,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?, NULL, NULL, NULL,
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
        lease_token,
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
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const leaseToken = createDeploymentLeaseToken();
  const statement = buildDeploymentClaimStatement({
    workerId: input.workerId,
    now: input.now ?? Date.now(),
    leaseDurationMs,
    leaseToken,
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
  attempt: number;
  leaseToken: string;
  now?: number;
  leaseDurationMs?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseToken(input.leaseToken);
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  assertDeploymentLeaseDuration(leaseDurationMs);
  const result = await getDatabase()
    .prepare(
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = ? AND job.status = 'running'
           AND job.lease_owner = ? AND job.lease_token = ?
           AND job.attempts = ?
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_jobs AS job
       SET lease_expires_at = owned_job.now_ms + ?,
           updated_at = owned_job.now_ms
       FROM owned_job
       WHERE job.id = owned_job.id`,
    )
    .bind(
      input.jobId,
      input.workerId,
      input.leaseToken,
      input.attempt,
      leaseDurationMs,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function completeDeploymentJob(input: {
  jobId: string;
  workerId: string;
  attempt: number;
  leaseToken: string;
  now?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseToken(input.leaseToken);
  const result = await getDatabase()
    .prepare(
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = ? AND job.status = 'running'
           AND job.lease_owner = ? AND job.lease_token = ?
           AND job.attempts = ?
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_jobs AS job
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
           lease_token = NULL,
           completed_at = owned_job.now_ms, updated_at = owned_job.now_ms
       FROM owned_job
       WHERE job.id = owned_job.id`,
    )
    .bind(
      input.jobId,
      input.workerId,
      input.leaseToken,
      input.attempt,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function failDeploymentJob(input: {
  jobId: string;
  workerId: string;
  attempt: number;
  leaseToken: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryDelayMs?: number;
  now?: number;
}): Promise<DeploymentJobView | null> {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseToken(input.leaseToken);
  const retryDelayMs = input.retryDelayMs ?? 30_000;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error("Deployment retry delay is invalid.");
  }
  const row = await getDatabase()
    .prepare(
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = ? AND job.status = 'running'
           AND job.lease_owner = ? AND job.lease_token = ?
           AND job.attempts = ?
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_jobs AS job
       SET status = CASE
             WHEN job.attempts >= job.max_attempts THEN 'dead_letter'
             ELSE 'retry_wait'
           END,
           available_at = owned_job.now_ms + ?,
           lease_owner = NULL, lease_expires_at = NULL,
           lease_token = NULL,
           last_error_code = ?, last_error_message = ?,
           updated_at = owned_job.now_ms,
           completed_at = CASE
             WHEN job.attempts >= job.max_attempts THEN owned_job.now_ms ELSE NULL
           END
       FROM owned_job
       WHERE job.id = owned_job.id
       RETURNING job.id, job.deployment_id, job.job_type, job.dedupe_key,
          job.status, job.payload, job.attempts, job.max_attempts,
          job.available_at, job.lease_owner, job.lease_expires_at,
          job.lease_token, job.last_error_code, job.last_error_message,
          job.created_at, job.updated_at, job.completed_at`,
    )
    .bind(
      input.jobId,
      input.workerId,
      input.leaseToken,
      input.attempt,
      retryDelayMs,
      normalizeDeploymentError(input.errorCode, "DEPLOYMENT_STEP_FAILED"),
      normalizeDeploymentError(input.errorMessage, "Deployment step failed."),
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
  leaseToken: string;
  now?: number;
}): Promise<string> {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseToken(input.leaseToken);
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 20) {
    throw new Error("Deployment step attempt must be between 1 and 20.");
  }
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(input.stepKey)) {
    throw new Error("Deployment step key is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.inputHash)) {
    throw new Error("Deployment step input hash is invalid.");
  }
  const id = await stableId(
    "step",
    `${input.deploymentId}:${input.jobId}:${input.stepKey}:${input.inputHash}:${input.attempt}`,
  );
  const row = await getDatabase()
    .prepare(beginDeploymentStepStatement)
    .bind(
      input.jobId,
      input.deploymentId,
      input.workerId,
      input.leaseToken,
      input.attempt,
      id,
      input.deploymentId,
      input.jobId,
      input.stepKey,
      input.attempt,
      input.inputHash,
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
  attempt: number;
  leaseToken: string;
  now?: number;
}): Promise<boolean> {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseToken(input.leaseToken);
  const output = input.output ?? {};
  assertSafeDeploymentOutput(output);
  const result = await getDatabase()
    .prepare(finishDeploymentStepStatement)
    .bind(
      input.workerId,
      input.leaseToken,
      input.attempt,
      input.status,
      JSON.stringify(output),
      input.errorCode
        ? normalizeDeploymentError(input.errorCode, "STEP_FAILED")
        : null,
      input.errorMessage
        ? normalizeDeploymentError(input.errorMessage, "Deployment step failed.")
        : null,
      input.stepRunId,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}
