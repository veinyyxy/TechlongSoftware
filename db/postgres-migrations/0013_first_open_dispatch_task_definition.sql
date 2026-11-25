-- Bind a provider-acknowledged launch to its exact ECS task definition revision.
-- Existing acknowledged rows retain their original null revision and stay readable.
ALTER TABLE first_open_executions
  ADD COLUMN dispatch_task_definition_arn text,
  ADD CONSTRAINT first_open_executions_dispatch_task_definition_check CHECK ((
    dispatch_task_definition_arn IS NULL
    OR (dispatch_outcome = 'acknowledged' AND dispatch_task_arn IS NOT NULL
      AND dispatch_task_definition_arn ~ '^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/[A-Za-z0-9_-]{1,255}:[1-9][0-9]*$'
      AND split_part(dispatch_task_definition_arn, ':', 4) = split_part(dispatch_task_arn, ':', 4)
      AND split_part(dispatch_task_definition_arn, ':', 5) = split_part(dispatch_task_arn, ':', 5))
  ) IS TRUE);
