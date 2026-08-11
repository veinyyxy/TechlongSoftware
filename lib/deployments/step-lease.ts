export const beginDeploymentStepStatement = `WITH owned_job AS (
  SELECT id
  FROM deployment_jobs
  WHERE id = ? AND deployment_id = ? AND status = 'running'
    AND lease_owner = ? AND lease_expires_at > ? AND attempts = ?
), inserted AS (
  INSERT INTO deployment_step_runs (
    id, deployment_id, job_id, step_key, attempt, status, input_hash,
    output, error_code, error_message, started_at, finished_at
  )
  SELECT ?, ?, ?, ?, ?, 'running', ?, '{}', NULL, NULL, ?, NULL
  FROM owned_job
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

export const finishDeploymentStepStatement = `UPDATE deployment_step_runs AS step
SET status = ?, output = ?, error_code = ?, error_message = ?, finished_at = ?
WHERE step.id = ? AND step.status = 'running'
  AND EXISTS (
    SELECT 1
    FROM deployment_jobs AS job
    WHERE job.id = step.job_id AND job.deployment_id = step.deployment_id
      AND job.status = 'running' AND job.lease_owner = ?
      AND job.lease_expires_at > ?
  )`;

export class LostDeploymentLeaseError extends Error {
  readonly code = "DEPLOYMENT_LEASE_LOST";

  constructor() {
    super("The deployment worker no longer owns a valid lease for this step.");
  }
}
