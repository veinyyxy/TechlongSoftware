-- Reserve a single dispatch per approval before contacting ECS. An unknown outcome remains consumed.
ALTER TABLE first_open_executions
  ADD COLUMN dispatch_token text,
  ADD COLUMN dispatch_started_at bigint,
  ADD COLUMN dispatch_task_arn text UNIQUE,
  ADD COLUMN dispatch_outcome text,
  ADD CONSTRAINT first_open_executions_dispatch_check CHECK ((
    (dispatch_started_at IS NULL AND dispatch_token IS NULL AND dispatch_outcome IS NULL AND dispatch_task_arn IS NULL)
    OR (dispatch_started_at >= approved_at AND dispatch_token = id AND (
      (dispatch_outcome IS NULL AND dispatch_task_arn IS NULL)
      OR (dispatch_outcome IN ('failed', 'unknown') AND dispatch_task_arn IS NULL)
      OR (dispatch_outcome = 'acknowledged'
        AND dispatch_task_arn ~ '^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task/[A-Za-z0-9_-]{1,255}/[0-9a-f]{32}$')
    ))
  ) IS TRUE);
