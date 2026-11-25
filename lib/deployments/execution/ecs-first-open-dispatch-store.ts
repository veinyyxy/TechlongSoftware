import { FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX } from "../first-onboarding.ts";
import { firstOpenTaskDefinitionArnPattern, isFirstOpenDispatchSelection,
  type FirstOpenDispatchState, type FirstOpenDispatchStore } from "./ecs-first-open-dispatch.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";

const RESERVE = `WITH eligible AS MATERIALIZED (
  SELECT execution.id, execution.approved_at
  FROM first_open_executions execution
  JOIN users actor ON actor.id = execution.approved_by AND actor.status = 'active' AND actor.is_platform_admin = 1
  JOIN app_instances instance ON instance.id = execution.instance_id
  JOIN app_instance_deployments deployment ON deployment.id = execution.deployment_id
    AND deployment.app_instance_id = instance.id AND deployment.subscription_id = instance.subscription_id
    AND deployment.purchase_order_id = execution.purchase_order_id AND deployment.artifact_ref = execution.artifact_ref
  JOIN deployment_jobs job ON job.id = execution.job_id AND job.deployment_id = deployment.id
  JOIN subscription_purchase_orders purchase ON purchase.id = execution.purchase_order_id
    AND purchase.subscription_id = instance.subscription_id AND purchase.workspace_id = instance.workspace_id
  JOIN payment_records payment ON payment.id = purchase.payment_record_id
    AND payment.subscription_id = purchase.subscription_id AND payment.workspace_id = purchase.workspace_id
  JOIN first_open_execution_events approval ON approval.execution_id = execution.id AND approval.sequence = 1
    AND approval.step = 'approval' AND approval.status = 'completed' AND approval.at = execution.approved_at
  WHERE execution.id = $1 AND execution.dispatch_started_at IS NULL AND execution.job_id <> $2
    AND ($3::text IS NULL OR (
      job.id = $3 AND instance.id = $4 AND instance.workspace_id = $5
      AND execution.release_id = $6 AND execution.review_sha256 = $7
      AND instance.slug || '.sandbox.techlong.cloud' = $8
    ))
    AND instance.status = 'pending' AND instance.provisioning_source = 'payment_success'
    AND instance.provisioned_at IS NULL AND instance.access_url = ''
    AND deployment.status = 'planned' AND deployment.mode = 'aws_sandbox'
    AND purchase.status = 'paid' AND purchase.completed_at IS NOT NULL
    AND payment.status = 'paid' AND payment.paid_at IS NOT NULL
    AND job.job_type = 'apply' AND job.dedupe_key = '${FIRST_ONBOARDING_PREFIX}' || instance.id
    AND job.payload::jsonb #>> '{scope,releaseId}' = execution.release_id
    AND job.status = 'pending' AND job.attempts = 0 AND job.max_attempts = 1
    AND job.available_at = ${FIRST_ONBOARDING_HOLD_AT} AND job.lease_owner IS NULL AND job.lease_token IS NULL
    AND job.lease_expires_at IS NULL AND job.completed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM first_open_execution_events event WHERE event.execution_id = execution.id AND event.sequence > 1)
  FOR SHARE OF instance, deployment, job, purchase, payment
), timed AS MATERIALIZED (
  SELECT eligible.*, (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS at FROM eligible
), reserved AS (
  UPDATE first_open_executions execution SET dispatch_token = execution.id, dispatch_started_at = timed.at
  FROM timed WHERE execution.id = timed.id AND execution.dispatch_started_at IS NULL
    AND ($3::text IS NULL OR (
      execution.job_id = $3 AND execution.instance_id = $4
      AND execution.release_id = $6 AND execution.review_sha256 = $7
    ))
    AND timed.at >= timed.approved_at AND timed.at < timed.approved_at + 3600000
  RETURNING execution.id, execution.dispatch_started_at
)
INSERT INTO first_open_execution_events (execution_id, sequence, step, status, at)
SELECT id, 2, 'task_start', 'started', dispatch_started_at FROM reserved RETURNING execution_id`;

const RECORD_RESULT = `WITH observed AS MATERIALIZED (
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS at
), completed AS (
  UPDATE first_open_executions execution SET dispatch_outcome = $2, dispatch_task_arn = $3, dispatch_task_definition_arn = $4
  FROM observed
  WHERE execution.id = $1 AND execution.dispatch_token = execution.id AND execution.dispatch_outcome IS NULL
    AND observed.at >= execution.dispatch_started_at
    AND EXISTS (SELECT 1 FROM first_open_execution_events event WHERE event.execution_id = execution.id
      AND event.sequence = 2 AND event.step = 'task_start' AND event.status = 'started' AND event.at = execution.dispatch_started_at)
  RETURNING execution.id, execution.dispatch_outcome, observed.at
)
INSERT INTO first_open_execution_events (execution_id, sequence, step, status, at, error_code)
SELECT id, 3, 'task_start', CASE WHEN dispatch_outcome = 'acknowledged' THEN 'completed' ELSE dispatch_outcome END, at,
  CASE WHEN dispatch_outcome = 'unknown' THEN 'RESULT_UNCONFIRMED' END
FROM completed RETURNING execution_id`;

const READ = `SELECT coalesce(dispatch_outcome, 'waiting') AS status, dispatch_task_arn AS "taskArn"
  FROM first_open_executions WHERE id = $1`;

export function createFirstOpenDispatchStore(db: ApplicationDatabase): FirstOpenDispatchStore {
  return {
    async begin(executionId, selection) {
      if (selection !== undefined && !isFirstOpenDispatchSelection(selection)) return false;
      return Boolean(await db.prepare(RESERVE).bind(executionId, FIRST_OPEN_BASELINE_BINDING.jobId,
        selection?.jobId ?? null, selection?.instanceId ?? null, selection?.workspaceId ?? null,
        selection?.releaseId ?? null, selection?.reviewSha256 ?? null, selection?.hostname ?? null).first<{ execution_id: string }>());
    },
    async finish(executionId, outcome, taskDefinitionArn) {
      if (taskDefinitionArn !== undefined) {
        const scope = typeof taskDefinitionArn === "string" && firstOpenTaskDefinitionArnPattern.exec(taskDefinitionArn)?.[1];
        if (!scope || outcome.status !== "acknowledged" || !outcome.taskArn.startsWith(scope + ":task/")) return false;
      }
      return Boolean(await db.prepare(RECORD_RESULT).bind(executionId, outcome.status, outcome.taskArn, taskDefinitionArn ?? null)
        .first<{ execution_id: string }>());
    },
    read(executionId) {
      return db.prepare(READ).bind(executionId).first<FirstOpenDispatchState>();
    },
  };
}
