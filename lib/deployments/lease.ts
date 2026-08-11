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

export function assertDeploymentLeaseToken(leaseToken: string): void {
  if (!/^lease_[a-f0-9]{32}$/.test(leaseToken)) {
    throw new Error("Deployment lease token is invalid.");
  }
}

export function createDeploymentLeaseToken(): string {
  return `lease_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

export function buildDeploymentClaimStatement(input: {
  workerId: string;
  now: number;
  leaseDurationMs: number;
  leaseToken: string;
  jobType?: DeploymentJobType;
}): DeploymentClaimStatement {
  assertDeploymentWorkerId(input.workerId);
  assertDeploymentLeaseDuration(input.leaseDurationMs);
  assertDeploymentLeaseToken(input.leaseToken);
  const releasedTypeClause = input.jobType
    ? "AND deployment_jobs.job_type <> ?"
    : "AND FALSE";
  const releasedAllowedSiblingClause = input.jobType
    ? `AND EXISTS (
          SELECT 1
          FROM deployment_jobs AS allowed_sibling
          WHERE allowed_sibling.deployment_id = deployment_jobs.deployment_id
            AND allowed_sibling.id <> deployment_jobs.id
            AND allowed_sibling.job_type = ?
            AND allowed_sibling.attempts < allowed_sibling.max_attempts
            AND (
              (
                allowed_sibling.status IN ('pending', 'retry_wait')
                AND allowed_sibling.available_at <= db_clock.now_ms
              ) OR (
                allowed_sibling.status = 'running'
                AND allowed_sibling.lease_expires_at <= db_clock.now_ms
              )
            )
        )`
    : "";
  const exhaustedTypeClause = input.jobType
    ? "AND deployment_jobs.job_type = ?"
    : "";
  const candidateTypeClause = input.jobType
    ? "AND candidate_job.job_type = ?"
    : "";
  const bindings: Array<string | number> = [];
  if (input.jobType) bindings.push(input.jobType);
  if (input.jobType) bindings.push(input.jobType);
  if (input.jobType) bindings.push(input.jobType);
  if (input.jobType) bindings.push(input.jobType);
  bindings.push(
    input.workerId,
    input.leaseDurationMs,
    input.leaseToken,
  );
  return {
    sql: `WITH db_clock AS MATERIALIZED (
      SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
    ), released_disallowed AS (
      UPDATE deployment_jobs
      SET status = CASE
            WHEN attempts >= max_attempts THEN 'dead_letter'
            ELSE 'retry_wait'
          END,
          available_at = db_clock.now_ms,
          lease_owner = NULL, lease_expires_at = NULL, lease_token = NULL,
          last_error_code = CASE
            WHEN attempts >= max_attempts
              THEN COALESCE(last_error_code, 'LEASE_EXHAUSTED')
            ELSE last_error_code
          END,
          last_error_message = CASE
            WHEN attempts >= max_attempts THEN COALESCE(
              last_error_message,
              'The final worker lease expired before the job completed.'
            )
            ELSE last_error_message
          END,
          updated_at = db_clock.now_ms,
          completed_at = CASE
            WHEN attempts >= max_attempts THEN db_clock.now_ms ELSE NULL
          END
      FROM db_clock
      WHERE status = 'running' AND lease_expires_at <= db_clock.now_ms
        ${releasedTypeClause}
        ${releasedAllowedSiblingClause}
      RETURNING id, deployment_id, job_type, status
    ), exhausted AS (
      UPDATE deployment_jobs
      SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
          lease_token = NULL,
          last_error_code = COALESCE(last_error_code, 'LEASE_EXHAUSTED'),
          last_error_message = COALESCE(
            last_error_message,
            'The final worker lease expired before the job completed.'
          ),
          updated_at = db_clock.now_ms, completed_at = db_clock.now_ms
      FROM db_clock
      WHERE status = 'running' AND lease_expires_at <= db_clock.now_ms
        AND attempts >= max_attempts
        ${exhaustedTypeClause}
      RETURNING id, deployment_id, job_type, status
    ), dead_cleanup_job AS (
      SELECT deployment_id, job_type
      FROM released_disallowed
      WHERE status = 'dead_letter'
      UNION ALL
      SELECT deployment_id, job_type
      FROM exhausted
      WHERE status = 'dead_letter'
    ), failed_cleanup AS (
      UPDATE deployment_cleanup_schedules AS schedule
      SET status = 'failed',
          last_error = COALESCE(
            schedule.last_error,
            'The cleanup worker lease expired before the final attempt completed.'
          ),
          updated_at = db_clock.now_ms,
          completed_at = db_clock.now_ms
      FROM dead_cleanup_job, db_clock
      WHERE schedule.deployment_id = dead_cleanup_job.deployment_id
        AND dead_cleanup_job.job_type IN ('cleanup', 'rollback')
        AND schedule.status <> 'succeeded'
      RETURNING schedule.id
    ), candidate AS (
      SELECT candidate_job.id
      FROM deployment_jobs AS candidate_job
      INNER JOIN app_instance_deployments AS candidate_deployment
        ON candidate_deployment.id = candidate_job.deployment_id
      CROSS JOIN db_clock
      WHERE (
          (candidate_job.status IN ('pending', 'retry_wait')
            AND candidate_job.available_at <= db_clock.now_ms)
          OR (candidate_job.status = 'running'
            AND candidate_job.lease_expires_at <= db_clock.now_ms)
        )
        AND (
          candidate_job.lease_expires_at IS NULL
          OR candidate_job.lease_expires_at <= db_clock.now_ms
        )
        AND candidate_job.attempts < candidate_job.max_attempts
        ${candidateTypeClause}
        AND NOT EXISTS (
          SELECT 1
          FROM deployment_jobs AS sibling
          WHERE sibling.deployment_id = candidate_job.deployment_id
            AND sibling.id <> candidate_job.id
            AND sibling.status = 'running'
        )
        AND (SELECT count(*) FROM released_disallowed) >= 0
        AND (SELECT count(*) FROM exhausted) >= 0
        AND (SELECT count(*) FROM failed_cleanup) >= 0
      ORDER BY (candidate_job.status = 'running') DESC,
        candidate_job.available_at ASC, candidate_job.created_at ASC
      FOR UPDATE OF candidate_job, candidate_deployment SKIP LOCKED
      LIMIT 1
    )
    UPDATE deployment_jobs AS job
    SET status = 'running', lease_owner = ?,
        lease_expires_at = db_clock.now_ms + ?,
        lease_token = ?,
        attempts = job.attempts + 1, updated_at = db_clock.now_ms,
        last_error_code = NULL, last_error_message = NULL
    FROM candidate, db_clock
    WHERE job.id = candidate.id
    RETURNING job.id, job.deployment_id, job.job_type, job.dedupe_key,
      job.status, job.payload, job.attempts, job.max_attempts,
      job.available_at, job.lease_owner, job.lease_expires_at,
      job.lease_token,
      job.last_error_code, job.last_error_message, job.created_at,
      job.updated_at, job.completed_at`,
    bindings,
  };
}
