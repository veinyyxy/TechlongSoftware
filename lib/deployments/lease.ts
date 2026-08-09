import type { DeploymentJobType } from "./state-machine.ts";

export interface DeploymentClaimStatement {
  sql: string;
  bindings: Array<string | number>;
}

export function assertDeploymentWorkerId(workerId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(workerId)) {
    throw new Error("Deployment worker id is invalid.");
  }
}

export function assertDeploymentLeaseDuration(leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 5_000 ||
    leaseDurationMs > 15 * 60_000
  ) {
    throw new Error("Deployment lease must be between 5 seconds and 15 minutes.");
  }
}

export function buildDeploymentClaimStatement(input: {
  workerId: string;
  now: number;
  leaseDurationMs: number;
  jobType?: DeploymentJobType;
}): DeploymentClaimStatement {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseDuration(input.leaseDurationMs);
  const typeClause = input.jobType ? "AND job_type = ?" : "";
  const bindings: Array<string | number> = [
    input.now,
    input.now,
    input.now,
    input.now,
    input.now,
    input.now,
  ];
  if (input.jobType) bindings.push(input.jobType);
  bindings.push(
    input.now,
    input.workerId,
    input.now + input.leaseDurationMs,
    input.now,
  );
  return {
    sql: `WITH exhausted AS (
      UPDATE deployment_jobs
      SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
          last_error_code = COALESCE(last_error_code, 'LEASE_EXHAUSTED'),
          last_error_message = COALESCE(
            last_error_message,
            'The final worker lease expired before the job completed.'
          ),
          updated_at = ?, completed_at = ?
      WHERE status = 'running' AND lease_expires_at <= ?
        AND attempts >= max_attempts
      RETURNING id
    ), candidate AS (
      SELECT id
      FROM deployment_jobs AS candidate_job
      WHERE (
          (status IN ('pending', 'retry_wait') AND available_at <= ?)
          OR (status = 'running' AND lease_expires_at <= ?)
        )
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        AND attempts < max_attempts
        ${typeClause}
        AND NOT EXISTS (
          SELECT 1
          FROM deployment_jobs AS sibling
          WHERE sibling.deployment_id = candidate_job.deployment_id
            AND sibling.id <> candidate_job.id
            AND sibling.status = 'running'
            AND sibling.lease_expires_at > ?
        )
        AND (SELECT count(*) FROM exhausted) >= 0
      ORDER BY (status = 'running') DESC, available_at ASC, created_at ASC
      FOR UPDATE OF candidate_job SKIP LOCKED
      LIMIT 1
    )
    UPDATE deployment_jobs AS job
    SET status = 'running', lease_owner = ?, lease_expires_at = ?,
        attempts = job.attempts + 1, updated_at = ?,
        last_error_code = NULL, last_error_message = NULL
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.deployment_id, job.job_type, job.dedupe_key,
      job.status, job.payload, job.attempts, job.max_attempts,
      job.available_at, job.lease_owner, job.lease_expires_at,
      job.last_error_code, job.last_error_message, job.created_at,
      job.updated_at, job.completed_at`,
    bindings,
  };
}
