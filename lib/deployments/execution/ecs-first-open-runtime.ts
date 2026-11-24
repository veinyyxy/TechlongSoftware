import { CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING, type FirstOnboardingReviewRow } from "../first-onboarding.ts";
import type { SoftwareRelease } from "../releases/contract.ts";
import { createEcsFirstOpenCompletion } from "./ecs-first-open-completion.ts";
import { FIRST_OPEN_APPROVAL_MAX_WINDOW_MS, type EcsFirstOpenApproval, type EcsFirstOpenPorts } from "./ecs-first-open.ts";

const READ_APPROVAL = `SELECT opened.id AS "executionId", opened.approved_by AS "approvedBy",
  opened.approved_at AS "approvedAt", opened.job_id AS "jobId", instance.id AS "instanceId",
  instance.workspace_id AS "workspaceId", opened.release_id AS "releaseId",
  opened.review_sha256 AS "reviewSha256", instance.slug || '.sandbox.techlong.cloud' AS hostname
  FROM first_open_executions opened JOIN app_instances instance ON instance.id = opened.instance_id
  WHERE opened.id = $1 AND opened.dispatch_token = opened.id AND opened.dispatch_outcome = 'acknowledged'
    AND opened.dispatch_task_arn = $2`;

const READ_RELEASE = `SELECT document || jsonb_build_object('status', status) AS document
  FROM deployment_release.releases WHERE id = $1 AND status = 'ecr_verified' AND component = 'tenant_api'
    AND product_id = document->>'productId'`;

// Keep the original held-job claim and lock the matching SaaS approval with it.
const CLAIM_APPROVED = CLAIM_FIRST_ONBOARDING.replace("WITH eligible", `WITH approval AS MATERIALIZED (
  SELECT opened.id FROM first_open_executions opened
  JOIN users actor ON actor.id = opened.approved_by AND actor.status = 'active' AND actor.is_platform_admin = 1
  WHERE opened.id = $2 AND opened.job_id = $1 AND opened.deployment_id = $5 AND opened.instance_id = $10
    AND opened.dispatch_token = opened.id AND opened.dispatch_outcome = 'acknowledged' AND opened.dispatch_task_arn = $19
    AND opened.approved_by = $20 AND opened.approved_at = $21::bigint
    AND opened.review_sha256 = $22 AND opened.release_id = $23
    AND opened.artifact_ref = ($8::jsonb)->>'artifactRef'
    AND $4::bigint <= opened.approved_at + ${FIRST_OPEN_APPROVAL_MAX_WINDOW_MS}
  FOR SHARE OF opened, actor
), eligible`).replace(SELECT_FIRST_ONBOARDING,
  `${SELECT_FIRST_ONBOARDING} AND EXISTS (SELECT 1 FROM approval)`);

const WRITE_EVENT = `WITH scope AS MATERIALIZED (
  SELECT opened.id, job.lease_expires_at
  FROM first_open_executions opened
  JOIN deployment_jobs job ON job.id = opened.job_id AND job.deployment_id = opened.deployment_id
  WHERE opened.id = $1 AND job.id = $2 AND opened.dispatch_token = opened.id
    AND opened.dispatch_outcome = 'acknowledged' AND opened.dispatch_task_arn = $3
    AND job.status = 'running' AND job.attempts = 1 AND job.max_attempts = 1
    AND job.lease_owner = opened.id AND job.lease_token = $4
  FOR SHARE OF opened, job
), timed AS MATERIALIZED (
  SELECT scope.*, (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms FROM scope
)
INSERT INTO first_open_execution_events (execution_id, sequence, step, status, error_code, at)
SELECT timed.id, $6::integer, $7, $8, $9, timed.now_ms FROM timed
JOIN first_open_execution_events previous ON previous.execution_id = timed.id AND previous.sequence = $6::integer - 1
WHERE timed.now_ms < $5::bigint AND timed.now_ms < timed.lease_expires_at
  AND previous.status = CASE WHEN $8 = 'started' THEN 'completed' ELSE 'started' END
RETURNING execution_id`;

const stepSequence = { database_initialization: 4, api_deployment: 6, self_check: 8 } as const;

type TaskSettings = Pick<EcsFirstOpenApproval, "writeBefore" | "baselineDigest" | "databaseSchemaVersion" | "dnsTarget">;

/** Bind the existing task entry to an injected database and task identity. */
export function createEcsFirstOpenTaskPorts(input: TaskSettings & {
  db: ApplicationDatabase;
  readDb: ApplicationDatabase;
  taskArn: string;
  management: EcsFirstOpenPorts["management"];
  reader: EcsFirstOpenPorts["reader"];
}): EcsFirstOpenPorts {
  const { db, readDb, taskArn, management, reader, writeBefore, baselineDigest, databaseSchemaVersion, dnsTarget } = input;
  return {
    management,
    reader,
    async readApproval(executionId) {
      const row = await db.prepare(READ_APPROVAL).bind(executionId, taskArn)
        .first<Omit<EcsFirstOpenApproval, keyof TaskSettings | "approvedAt"> & { approvedAt: number | string }>();
      if (!row) return null;
      const approvedAt = Number(row.approvedAt);
      return { ...row, approvedAt, writeBefore, baselineDigest, databaseSchemaVersion, dnsTarget };
    },
    readOne(sql, args) {
      if (sql !== SELECT_FIRST_ONBOARDING) throw Error("ECS_FIRST_OPEN_REVIEW_QUERY");
      return db.prepare(SELECT_FIRST_ONBOARDING).bind(...args).first<FirstOnboardingReviewRow>();
    },
    async readRelease(releaseId) {
      const row = await db.prepare(READ_RELEASE).bind(releaseId).first<{ document: SoftwareRelease }>();
      return row?.document ?? null;
    },
    async claimApproved(approval, sql, bindings) {
      if (sql !== CLAIM_FIRST_ONBOARDING) throw Error("ECS_FIRST_OPEN_CLAIM_QUERY");
      const claim = await db.prepare(CLAIM_APPROVED).bind(...bindings, taskArn, approval.approvedBy,
        approval.approvedAt, approval.reviewSha256, approval.releaseId).first<{ jobId: string }>();
      return claim && { ...claim, executionId: approval.executionId };
    },
    lifecycle: {
      async record(approval, job, event) {
        const sequence = stepSequence[event.step] + (event.status === "started" ? 0 : 1);
        const updated = await db.prepare(WRITE_EVENT).bind(approval.executionId, job.id, taskArn, job.leaseToken,
          approval.writeBefore, sequence, event.step, event.status, event.errorCode ?? null).first();
        if (!updated) throw Error("ECS_FIRST_OPEN_PROGRESS_UNCONFIRMED");
      },
      complete: createEcsFirstOpenCompletion({ db, readDb }),
    },
  };
}
