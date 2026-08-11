export const beginDeploymentStepStatement = `WITH db_clock AS MATERIALIZED (
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
), owned_job AS MATERIALIZED (
  SELECT job.id
  FROM deployment_jobs AS job
  CROSS JOIN db_clock
  WHERE job.id = ? AND job.deployment_id = ? AND job.status = 'running'
    AND job.lease_owner = ? AND job.lease_token = ?
    AND job.attempts = ? AND job.lease_expires_at > db_clock.now_ms
  FOR UPDATE OF job
), inserted AS (
  INSERT INTO deployment_step_runs (
    id, deployment_id, job_id, step_key, attempt, status, input_hash,
    output, error_code, error_message, started_at, finished_at
  )
  SELECT ?, ?, ?, ?, ?, 'running', ?, '{}', NULL, NULL,
    db_clock.now_ms, NULL
  FROM owned_job
  CROSS JOIN db_clock
  ON CONFLICT (job_id, step_key, input_hash, attempt) DO NOTHING
  RETURNING id
)
SELECT id FROM inserted
UNION ALL
SELECT step.id
FROM deployment_step_runs AS step
INNER JOIN owned_job ON owned_job.id = step.job_id
WHERE step.deployment_id = ? AND step.step_key = ?
  AND step.input_hash = ? AND step.attempt = ? AND step.status = 'running'
LIMIT 1`;

export const finishDeploymentStepStatement = `WITH db_clock AS MATERIALIZED (
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
), owned_job AS MATERIALIZED (
  SELECT job.id, job.deployment_id
  FROM deployment_jobs AS job
  CROSS JOIN db_clock
  WHERE job.status = 'running' AND job.lease_owner = ?
    AND job.lease_token = ? AND job.attempts = ?
    AND job.lease_expires_at > db_clock.now_ms
  FOR UPDATE OF job
)
UPDATE deployment_step_runs AS step
SET status = ?, output = ?, error_code = ?, error_message = ?,
  finished_at = db_clock.now_ms
FROM owned_job, db_clock
WHERE step.id = ? AND step.status = 'running'
  AND owned_job.id = step.job_id
  AND owned_job.deployment_id = step.deployment_id`;

export class LostDeploymentLeaseError extends Error {
  readonly code = "DEPLOYMENT_LEASE_LOST";

  constructor() {
    super("The deployment worker no longer owns a valid lease for this step.");
  }
}
