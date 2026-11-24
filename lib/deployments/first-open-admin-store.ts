import { randomUUID } from "node:crypto";
import { stableId } from "../domain/ids.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./execution/first-onboarding-baseline-versions.ts";
import { canonicalJson } from "./execution/hash.ts";
import {
  FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX, SELECT_FIRST_ONBOARDING, loadFirstOnboardingReview,
  type FirstOnboardingReviewRow,
} from "./first-onboarding.ts";
import type { SoftwareRelease } from "./releases/contract.ts";

export type FirstOpenStep = "approval" | "task_start" | "database_initialization" | "api_deployment" | "self_check" | "activation";
export type FirstOpenStatus = "waiting" | "running" | "failed" | "unknown" | "succeeded";

export interface FirstOpenExecutionView {
  id: string;
  status: FirstOpenStatus;
  step: FirstOpenStep;
  approvedAt: number;
}

export interface FirstOpenLogEvent {
  step: FirstOpenStep;
  status: "started" | "completed" | "failed" | "unknown";
  at: number;
  errorCode: string | null;
  reason: string | null;
}

export interface FirstOpenInstanceSummary {
  instanceId: string;
  eligible: boolean;
  execution: FirstOpenExecutionView | null;
}

export interface FirstOpenInstanceView extends FirstOpenInstanceSummary {
  events: FirstOpenLogEvent[];
}

export interface FirstOpenAdminStore {
  approve(instanceId: string, actorId: string): Promise<FirstOpenExecutionView | null>;
  read(instanceId: string, actorId: string): Promise<FirstOpenInstanceView | null>;
  listSummaries(instanceIds: readonly string[], actorId: string): Promise<FirstOpenInstanceSummary[]>;
}

const publicFailureReasons = {
  AccessDenied: "执行身份无权操作目标资源。",
  DATABASE_INITIALIZATION_FAILED: "数据库初始化失败。",
  API_DEPLOYMENT_FAILED: "API 部署失败。",
  SELF_CHECK_FAILED: "技术自检失败。",
  ACTIVATION_FAILED: "实例激活失败。",
  RESULT_UNCONFIRMED: "操作结果尚未确认。",
} as const;

const paidOrderMatches = `purchase.workspace_id = instance.workspace_id AND purchase.product_id = instance.product_id
  AND purchase.subscription_id = instance.subscription_id AND purchase.template_version_id = instance.template_version_id
  AND purchase.configuration_snapshot::jsonb = instance.configuration_snapshot::jsonb
  AND purchase.order_type = 'new_subscription' AND purchase.status = 'paid' AND purchase.completed_at IS NOT NULL
  AND payment.workspace_id = purchase.workspace_id AND payment.subscription_id = purchase.subscription_id
  AND payment.status = 'paid' AND payment.paid_at IS NOT NULL AND payment.amount = purchase.amount
  AND payment.currency = purchase.currency AND payment.provider = purchase.provider
  AND payment.provider_payment_id = purchase.provider_payment_id`;

function heldApprovalTarget(lock: boolean) {
  return `SELECT reviewed.*, purchase.id AS "purchaseOrderId"
  FROM (${SELECT_FIRST_ONBOARDING}${lock ? " FOR SHARE OF j,d,a,s,w,e" : ""}) reviewed
  JOIN app_instances instance ON instance.id = reviewed."appInstanceId"
  JOIN app_instance_deployments deployment ON deployment.id = reviewed.deployment->>'id'
  JOIN subscription_purchase_orders purchase ON purchase.id = deployment.purchase_order_id
  JOIN payment_records payment ON payment.id = purchase.payment_record_id
  JOIN users actor ON actor.id = $3 AND actor.status = 'active' AND actor.is_platform_admin = 1
  WHERE instance.id = $2 AND ${paidOrderMatches} AND purchase.plan_id = reviewed."planId"
    AND reviewed."instancePendingFirstOpen" AND reviewed."subscriptionActiveAndCurrent"
    AND reviewed."scopeStillEligible" AND reviewed."noOtherDeploymentOrTenantGeneration"
  ${lock ? "FOR SHARE OF purchase,payment,actor" : ""}`;
}

const READ_RELEASE = `SELECT document || jsonb_build_object('status', status) AS document
  FROM deployment_release.releases WHERE id = $1 AND status = 'ecr_verified' AND component = 'tenant_api'
    AND product_id = document->>'productId'`;

type ApprovalTarget = FirstOnboardingReviewRow & { purchaseOrderId: string };

// Conflicting clicks leave the winning execution and original audit time intact.
// The caller reads persisted progress from a fresh statement within the same transaction.
const REGISTER_APPROVAL = `WITH target AS MATERIALIZED (${heldApprovalTarget(true)}),
  exact AS MATERIALIZED (
    SELECT target.*, (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS approved_at
    FROM target JOIN deployment_release.releases release ON release.id = target.job #>> '{payload,scope,releaseId}'
    WHERE release.status = 'ecr_verified' AND release.component = 'tenant_api'
      AND release.product_id = release.document->>'productId'
      AND release.document || jsonb_build_object('status', release.status) = $7::jsonb
      AND jsonb_build_object('configuration', target.configuration, 'desiredPlan', target."desiredPlan",
        'deployment', target.deployment, 'job', target.job, 'purchaseOrderId', target."purchaseOrderId") = $6::jsonb
    FOR SHARE OF release
  ), inserted AS (
    INSERT INTO first_open_executions
      (id, instance_id, job_id, deployment_id, purchase_order_id, release_id, artifact_ref, review_sha256, approved_by, approved_at)
    SELECT $4, "appInstanceId", job->>'id', deployment->>'id', "purchaseOrderId", job #>> '{payload,scope,releaseId}',
      deployment->>'artifactRef', $5, $3, approved_at FROM exact
    ON CONFLICT (instance_id) DO NOTHING RETURNING id, approved_at
  )
  INSERT INTO first_open_execution_events (execution_id, sequence, step, status, at)
  SELECT id, 1, 'approval', 'completed', approved_at FROM inserted`;

const SUMMARY_COLUMNS = `instance.id AS "instanceId", (opened.id IS NULL AND instance.status = 'pending'
  AND instance.provisioning_source = 'payment_success' AND instance.provisioned_at IS NULL AND instance.access_url = ''
  AND EXISTS (
    SELECT 1 FROM app_instance_deployments deployment
    JOIN deployment_jobs job ON job.deployment_id = deployment.id
    JOIN subscription_purchase_orders purchase ON purchase.id = deployment.purchase_order_id
    JOIN payment_records payment ON payment.id = purchase.payment_record_id
    WHERE deployment.app_instance_id = instance.id AND deployment.status = 'planned' AND deployment.mode = 'aws_sandbox'
      AND deployment.subscription_id = instance.subscription_id AND ${paidOrderMatches}
      AND job.dedupe_key = '${FIRST_ONBOARDING_PREFIX}' || instance.id AND job.id <> '${FIRST_OPEN_BASELINE_BINDING.jobId}'
      AND job.job_type = 'apply' AND job.status = 'pending' AND job.attempts = 0 AND job.max_attempts = 1
      AND job.available_at = ${FIRST_ONBOARDING_HOLD_AT} AND job.lease_owner IS NULL AND job.lease_token IS NULL
      AND job.lease_expires_at IS NULL AND job.completed_at IS NULL
  )) AS eligible, opened.id AS "executionId", opened.approved_at AS "approvedAt",
  CASE
    WHEN progress.status IN ('failed', 'unknown') THEN progress.status
    WHEN progress.step = 'activation' AND progress.status = 'completed' THEN
      CASE WHEN instance.status = 'active' AND bound_deployment.status = 'ready' AND bound_job.status = 'succeeded'
        THEN 'succeeded' ELSE 'unknown' END
    WHEN bound_job.status IS NULL OR bound_job.status NOT IN ('pending', 'running')
      OR (bound_job.status = 'running' AND (bound_job.lease_owner IS DISTINCT FROM opened.id
        OR bound_job.lease_expires_at IS NULL
        OR bound_job.lease_expires_at <= (extract(epoch FROM clock_timestamp()) * 1000)::bigint)) THEN 'unknown'
    WHEN progress.step IN ('database_initialization', 'api_deployment', 'self_check', 'activation')
      OR (bound_job.status = 'running' AND bound_job.lease_owner = opened.id) THEN 'running'
    ELSE 'waiting'
  END AS status, coalesce(progress.step, 'approval') AS step`;

const SUMMARY_TABLES = `FROM app_instances instance
  JOIN users actor ON actor.id = $1 AND actor.status = 'active' AND actor.is_platform_admin = 1
  LEFT JOIN first_open_executions opened ON opened.instance_id = instance.id
  LEFT JOIN app_instance_deployments bound_deployment ON bound_deployment.id = opened.deployment_id
    AND bound_deployment.app_instance_id = instance.id
  LEFT JOIN deployment_jobs bound_job ON bound_job.id = opened.job_id AND bound_job.deployment_id = bound_deployment.id
  LEFT JOIN LATERAL (
    SELECT step, status FROM first_open_execution_events event WHERE event.execution_id = opened.id
    ORDER BY sequence DESC LIMIT 1
  ) progress ON true`;

const READ_SUMMARY = `SELECT ${SUMMARY_COLUMNS} ${SUMMARY_TABLES} WHERE instance.id = $2`;
const LIST_SUMMARIES = `SELECT ${SUMMARY_COLUMNS} ${SUMMARY_TABLES}
  WHERE instance.id IN (SELECT jsonb_array_elements_text($2::jsonb))`;
const READ_LOG = `SELECT ${SUMMARY_COLUMNS}, coalesce((
    SELECT jsonb_agg(jsonb_build_object('step', event.step, 'status', event.status, 'at', event.at,
      'errorCode', event.error_code) ORDER BY event.sequence)
    FROM first_open_execution_events event WHERE event.execution_id = opened.id
  ), '[]'::jsonb) AS events ${SUMMARY_TABLES} WHERE instance.id = $2`;

interface SummaryRow {
  instanceId: string;
  eligible: boolean;
  executionId: string | null;
  approvedAt: number | string | null;
  status: FirstOpenStatus;
  step: FirstOpenStep;
}

function summary(row: SummaryRow): FirstOpenInstanceSummary {
  const { instanceId, eligible, executionId, approvedAt, status, step } = row;
  return { instanceId, eligible, execution: executionId ? { id: executionId, status, step, approvedAt: Number(approvedAt) } : null };
}

function logEvent(event: Omit<FirstOpenLogEvent, "reason">): FirstOpenLogEvent {
  const { step, status, at, errorCode: code } = event;
  const errorCode = code && Object.hasOwn(publicFailureReasons, code) ? code as keyof typeof publicFailureReasons : null;
  const reason = errorCode ? publicFailureReasons[errorCode] : status === "failed" ? "当前阶段失败。"
    : status === "unknown" ? publicFailureReasons.RESULT_UNCONFIRMED : null;
  return { step, status, at, errorCode, reason };
}

export function createFirstOpenAdminStore(db: ApplicationDatabase): FirstOpenAdminStore {
  return {
    async listSummaries(instanceIds: readonly string[], actorId: string): Promise<FirstOpenInstanceSummary[]> {
      if (instanceIds.length === 0) return [];
      const { results } = await db.prepare(LIST_SUMMARIES).bind(actorId, JSON.stringify(instanceIds)).all<SummaryRow>();
      return results.map(summary);
    },
    async read(instanceId: string, actorId: string): Promise<FirstOpenInstanceView | null> {
      const row = await db.prepare(READ_LOG).bind(actorId, instanceId)
        .first<SummaryRow & { events: Omit<FirstOpenLogEvent, "reason">[] }>();
      return row ? { ...summary(row), events: row.events.map(logEvent) } : null;
    },
    async approve(instanceId: string, actorId: string): Promise<FirstOpenExecutionView | null> {
      const readLatest = () => db.prepare(READ_SUMMARY).bind(actorId, instanceId);
      const readExecution = async () => {
        const row = await readLatest().first<SummaryRow>();
        return row ? summary(row).execution : null;
      };
      const initial = await readLatest().first<SummaryRow>();
      if (!initial) return null;
      if (initial.executionId || !initial.eligible) return summary(initial).execution;

      const jobId = await stableId("job", FIRST_ONBOARDING_PREFIX + instanceId);
      if (jobId === FIRST_OPEN_BASELINE_BINDING.jobId) return null;
      const target = await db.prepare(heldApprovalTarget(false)).bind(jobId, instanceId, actorId).first<ApprovalTarget>();
      if (!target) return readExecution();
      let release: SoftwareRelease | null = null;
      const review = await loadFirstOnboardingReview(jobId, {
        readOne: async () => target,
        async readRelease(id) {
          const row = await db.prepare(READ_RELEASE).bind(id).first<{ document: SoftwareRelease }>();
          return release = row?.document ?? null;
        },
      });
      if (!review || !release) return readExecution();

      const executionId = `exec_${randomUUID().replaceAll("-", "")}`;
      const { configuration, desiredPlan, deployment, job, purchaseOrderId } = target;
      const [, current] = await db.batch<SummaryRow>([db.prepare(REGISTER_APPROVAL).bind(jobId, instanceId, actorId,
        executionId, review.reviewSha256, canonicalJson({ configuration, desiredPlan, deployment, job, purchaseOrderId }),
        canonicalJson(release)), readLatest()]);
      const [row] = current.results;
      return row ? summary(row).execution : null;
    },
  };
}
