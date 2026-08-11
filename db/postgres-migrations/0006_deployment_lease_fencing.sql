-- Every claim/takeover receives a unique incarnation token. Worker identity is
-- intentionally not sufficient because the same id may be reused after a
-- process restart. Existing in-flight leases are safely returned to retry_wait
-- (or dead-lettered when already exhausted), so no pre-migration worker can
-- write through the stronger fence.
ALTER TABLE deployment_jobs
  ADD COLUMN lease_token text;

UPDATE deployment_jobs
SET status = CASE
    WHEN attempts >= max_attempts THEN 'dead_letter'
    ELSE 'retry_wait'
  END,
  available_at = (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  lease_owner = NULL,
  lease_expires_at = NULL,
  lease_token = NULL,
  last_error_code = CASE
    WHEN attempts >= max_attempts
      THEN COALESCE(last_error_code, 'LEASE_EXHAUSTED')
    ELSE last_error_code
  END,
  last_error_message = CASE
    WHEN attempts >= max_attempts
      THEN COALESCE(
        last_error_message,
        'The final pre-fencing worker lease expired before completion.'
      )
    ELSE last_error_message
  END,
  updated_at = (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  completed_at = CASE
    WHEN attempts >= max_attempts
      THEN (extract(epoch FROM clock_timestamp()) * 1000)::bigint
    ELSE NULL
  END
WHERE status = 'running';

UPDATE deployment_cleanup_schedules AS schedule
SET status = 'failed',
  last_error = COALESCE(
    schedule.last_error,
    'The cleanup worker lease was exhausted during the fencing upgrade.'
  ),
  updated_at = (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  completed_at = (extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM deployment_jobs AS job
WHERE schedule.deployment_id = job.deployment_id
  AND job.job_type IN ('cleanup', 'rollback')
  AND job.status = 'dead_letter'
  AND job.last_error_code = 'LEASE_EXHAUSTED'
  AND schedule.status <> 'succeeded';

-- The pre-0006 constraint did not require non-running rows to clear their
-- owner/expiry fields. Normalize any legacy residue before installing the
-- stronger bidirectional invariant.
UPDATE deployment_jobs
SET lease_owner = NULL,
  lease_expires_at = NULL,
  lease_token = NULL
WHERE status <> 'running'
  AND (lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL);

-- Migration 0003 did not name this table-level CHECK, so PostgreSQL generated
-- its name (and may have suffixed it because a status CHECK already existed).
-- Locate only the legacy weak lease CHECK by definition instead of assuming a
-- name that was never part of the migration history.
DO $$
DECLARE
  legacy_lease_constraint text;
BEGIN
  SELECT constraint_row.conname
  INTO legacy_lease_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'deployment_jobs'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid)
      ILIKE '%lease_owner IS NOT NULL%'
    AND pg_get_constraintdef(constraint_row.oid)
      ILIKE '%lease_expires_at IS NOT NULL%'
    AND pg_get_constraintdef(constraint_row.oid)
      NOT ILIKE '%lease_token%'
  ORDER BY constraint_row.oid
  LIMIT 1;

  IF legacy_lease_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE deployment_jobs DROP CONSTRAINT %I',
      legacy_lease_constraint
    );
  END IF;
END;
$$;

ALTER TABLE deployment_jobs
  ADD CONSTRAINT deployment_jobs_lease_token_check
    CHECK (
      lease_token IS NULL
      OR lease_token ~ '^lease_[a-f0-9]{32}$'
    ),
  ADD CONSTRAINT deployment_jobs_lease_check
    CHECK (
      (
        status = 'running'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_token IS NOT NULL
      )
      OR (
        status <> 'running'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND lease_token IS NULL
      )
    );
