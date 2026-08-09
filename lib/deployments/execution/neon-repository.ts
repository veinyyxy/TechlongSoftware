import {
  neon,
  type NeonQueryFunction,
  type NeonQueryFunctionInTransaction,
} from "@neondatabase/serverless";
import {
  parseDeploymentEnvironmentPolicy,
  type DeploymentEnvironment,
} from "../environment.ts";
import type { DeploymentStatus } from "../state-machine.ts";
import { assertSafeDeploymentOutput, normalizeDeploymentError } from "../safety.ts";
import type {
  ClaimedDeploymentJob,
  DeploymentCleanupSchedule,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentStepHandle,
} from "./contracts.ts";
import { sha256Hex } from "./hash.ts";

type SqlClient = NeonQueryFunction<false, true>;
type TransactionClient = NeonQueryFunctionInTransaction<false, true>;
type SqlValues = Array<string | number | boolean | null | string[]>;

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const parsed = text(value);
  return parsed || null;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("PostgreSQL returned an invalid integer.");
  return parsed;
}

async function query<T extends Record<string, unknown>>(
  client: SqlClient | TransactionClient,
  statement: string,
  values: SqlValues = [],
): Promise<T[]> {
  const result = await client.query(statement, values);
  return result.rows as T[];
}

function cleanupSchedule(row: Record<string, unknown>): DeploymentCleanupSchedule | null {
  const id = nullableText(row.cleanup_id);
  if (!id) return null;
  return {
    id,
    deploymentId: text(row.id),
    status: text(row.cleanup_status) as DeploymentCleanupSchedule["status"],
    expiresAt: integer(row.cleanup_expires_at),
    providerScheduleRef: nullableText(row.provider_schedule_ref),
    confirmedAt:
      row.cleanup_confirmed_at === null ? null : integer(row.cleanup_confirmed_at),
  };
}

export class NeonDeploymentExecutionRepository
  implements DeploymentExecutionRepository
{
  private readonly sql: SqlClient;

  constructor(databaseUrl: string) {
    if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
      throw new Error("Deployment worker requires a PostgreSQL DATABASE_URL.");
    }
    this.sql = neon(databaseUrl, { fullResults: true });
  }

  async claimNext(input: {
    workerId: string;
    now: number;
    leaseDurationMs: number;
    jobTypes: ClaimedDeploymentJob["jobType"][];
  }): Promise<ClaimedDeploymentJob | null> {
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH exhausted AS (
        UPDATE deployment_jobs
        SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
            last_error_code = COALESCE(last_error_code, 'LEASE_EXHAUSTED'),
            last_error_message = COALESCE(last_error_message, 'Worker lease expired.'),
            updated_at = $1, completed_at = $1
        WHERE status = 'running' AND lease_expires_at <= $1
          AND attempts >= max_attempts
        RETURNING id
      ), candidate AS (
        SELECT id
        FROM deployment_jobs AS candidate_job
        WHERE (
            (status IN ('pending', 'retry_wait') AND available_at <= $1)
            OR (status = 'running' AND lease_expires_at <= $1)
          )
          AND attempts < max_attempts
          AND job_type = ANY($4::text[])
          AND NOT EXISTS (
            SELECT 1 FROM deployment_jobs AS sibling
            WHERE sibling.deployment_id = candidate_job.deployment_id
              AND sibling.id <> candidate_job.id
              AND sibling.status = 'running'
              AND sibling.lease_expires_at > $1
          )
          AND (SELECT count(*) FROM exhausted) >= 0
        ORDER BY (status = 'running') DESC, available_at, created_at
        FOR UPDATE OF candidate_job SKIP LOCKED
        LIMIT 1
      )
      UPDATE deployment_jobs AS job
      SET status = 'running', lease_owner = $2, lease_expires_at = $3,
          attempts = job.attempts + 1, updated_at = $1,
          last_error_code = NULL, last_error_message = NULL
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id, job.deployment_id, job.job_type, job.payload,
        job.attempts, job.max_attempts, job.lease_expires_at`,
      [input.now, input.workerId, input.now + input.leaseDurationMs, input.jobTypes],
    );
    const row = rows[0];
    return row
      ? {
          id: text(row.id),
          deploymentId: text(row.deployment_id),
          jobType: text(row.job_type) as ClaimedDeploymentJob["jobType"],
          payload: parseObject(row.payload),
          attempt: integer(row.attempts),
          maxAttempts: integer(row.max_attempts),
          leaseExpiresAt: integer(row.lease_expires_at),
        }
      : null;
  }

  async loadContext(job: ClaimedDeploymentJob): Promise<DeploymentExecutionContext> {
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `SELECT d.id, d.app_instance_id, d.environment_id, d.status AS deployment_status,
        d.plan_hash, d.configuration_hash, d.artifact_ref, d.desired_plan, d.created_at,
        e.key AS environment_key, e.name AS environment_name, e.kind AS environment_kind,
        e.driver AS environment_driver, e.expected_account_id, e.region,
        e.cell_key, e.base_domain, e.apply_enabled, e.policy AS environment_policy,
        e.status AS environment_status,
        b.environment_id AS binding_environment_id, b.worker_role_arn,
        b.cloudformation_role_arn, b.tenant_stack_parameters, b.status AS binding_status,
        ai.workspace_id, ai.product_id, ai.subscription_id, ai.status AS instance_status,
        ai.slug, ai.tenant_key, ai.configuration_snapshot,
        w.status AS workspace_status,
        s.status AS subscription_status,
        c.id AS cleanup_id, c.status AS cleanup_status,
        c.expires_at AS cleanup_expires_at, c.provider_schedule_ref,
        c.confirmed_at AS cleanup_confirmed_at
      FROM app_instance_deployments d
      INNER JOIN deployment_environments e ON e.id = d.environment_id
      INNER JOIN app_instances ai ON ai.id = d.app_instance_id
      INNER JOIN workspaces w ON w.id = ai.workspace_id
      LEFT JOIN subscriptions s ON s.id = ai.subscription_id
      LEFT JOIN deployment_environment_bindings b ON b.environment_id = e.id
      LEFT JOIN deployment_cleanup_schedules c ON c.deployment_id = d.id
      WHERE d.id = $1
      LIMIT 1`,
      [job.deploymentId],
    );
    const row = rows[0];
    if (!row) throw new Error("Claimed deployment no longer exists.");
    const policy = parseDeploymentEnvironmentPolicy(
      parseObject(row.environment_policy),
    );
    if (!policy) throw new Error("Deployment environment policy is invalid.");
    const environment: DeploymentEnvironment = {
      id: text(row.environment_id),
      key: text(row.environment_key),
      name: text(row.environment_name),
      kind: text(row.environment_kind) as DeploymentEnvironment["kind"],
      driver: text(row.environment_driver) as DeploymentEnvironment["driver"],
      expectedAccountId: text(row.expected_account_id),
      region: text(row.region),
      cellKey: text(row.cell_key),
      baseDomain: text(row.base_domain),
      applyEnabled: integer(row.apply_enabled) === 1,
      policy,
      status: text(row.environment_status) as DeploymentEnvironment["status"],
    };
    const countRows = await query<Record<string, unknown>>(
      this.sql,
      `SELECT count(DISTINCT app_instance_id)::bigint AS tenant_count
       FROM app_instance_deployments
       WHERE environment_id = $1 AND id <> $2
         AND status IN (
           'queued', 'preflight', 'database_preparing', 'migrating',
           'infrastructure_provisioning', 'waiting_healthy', 'configuring',
           'verifying', 'ready'
         )`,
      [environment.id, job.deploymentId],
    );
    const subscriptionId = nullableText(row.subscription_id);
    return {
      job,
      deployment: {
        id: text(row.id),
        appInstanceId: text(row.app_instance_id),
        environmentId: environment.id,
        status: text(row.deployment_status) as DeploymentStatus,
        planHash: text(row.plan_hash),
        configurationHash: text(row.configuration_hash),
        artifactRef: text(row.artifact_ref),
        desiredPlan: parseObject(row.desired_plan) as unknown as DeploymentExecutionContext["deployment"]["desiredPlan"],
        createdAt: integer(row.created_at),
      },
      environment,
      binding: nullableText(row.binding_environment_id)
        ? {
            environmentId: text(row.binding_environment_id),
            workerRoleArn: text(row.worker_role_arn),
            cloudFormationRoleArn: text(row.cloudformation_role_arn),
            tenantStackParameters: Object.fromEntries(
              Object.entries(parseObject(row.tenant_stack_parameters)).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
            status: text(row.binding_status) as "active" | "inactive",
          }
        : null,
      cleanupSchedule: cleanupSchedule(row),
      workspace: { id: text(row.workspace_id), status: text(row.workspace_status) },
      subscription: subscriptionId
        ? { id: subscriptionId, status: text(row.subscription_status) }
        : null,
      appInstance: {
        id: text(row.app_instance_id),
        workspaceId: text(row.workspace_id),
        productId: text(row.product_id),
        subscriptionId,
        status: text(row.instance_status),
        slug: text(row.slug),
        tenantKey: text(row.tenant_key),
        configurationSnapshot: parseObject(row.configuration_snapshot),
      },
      activeCellCount: nullableText(row.binding_environment_id) ? 1 : 0,
      activeTenantCount: integer(countRows[0]?.tenant_count ?? 0),
    };
  }

  async reserveEnvironmentCapacity(input: {
    deploymentId: string;
    environmentId: string;
    maxTenants: number;
    now: number;
  }): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.maxTenants) ||
      input.maxTenants < 1 ||
      input.maxTenants > 1_000
    ) {
      throw new Error("Deployment environment maxTenants is outside the reservation limit.");
    }
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH locked_environment AS MATERIALIZED (
        SELECT id
        FROM deployment_environments
        WHERE id = $2 AND kind = 'aws_sandbox'
        FOR UPDATE
      ), existing AS MATERIALIZED (
        SELECT reservation.deployment_id
        FROM deployment_environment_capacity_reservations reservation
        INNER JOIN locked_environment environment
          ON environment.id = reservation.environment_id
        WHERE reservation.deployment_id = $1
          AND reservation.slot <= $3
      ), next_slot AS MATERIALIZED (
        SELECT candidate.slot
        FROM locked_environment environment
        CROSS JOIN LATERAL generate_series(1, $3) AS candidate(slot)
        WHERE NOT EXISTS (
          SELECT 1
          FROM deployment_environment_capacity_reservations occupied
          WHERE occupied.environment_id = environment.id
            AND occupied.slot = candidate.slot
        )
        ORDER BY candidate.slot
        LIMIT 1
      ), inserted AS (
        INSERT INTO deployment_environment_capacity_reservations (
          deployment_id, environment_id, slot, reserved_at
        )
        SELECT deployment.id, environment.id, next_slot.slot, $4
        FROM app_instance_deployments deployment
        INNER JOIN locked_environment environment
          ON environment.id = deployment.environment_id
        INNER JOIN next_slot ON true
        WHERE deployment.id = $1
          AND deployment.status IN (
            'planned', 'queued', 'preflight', 'database_preparing', 'migrating',
            'infrastructure_provisioning', 'waiting_healthy', 'configuring',
            'verifying', 'ready', 'retry_wait'
          )
          AND NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING deployment_id
      )
      SELECT deployment_id FROM existing
      UNION ALL
      SELECT deployment_id FROM inserted
      LIMIT 1`,
      [input.deploymentId, input.environmentId, input.maxTenants, input.now],
    );
    return rows.length === 1;
  }

  async confirmCleanupSchedule(input: {
    deploymentId: string;
    environmentId: string;
    stackName: string;
    expiresAt: number;
    providerScheduleRef: string;
    confirmedAt: number;
    now: number;
  }): Promise<DeploymentCleanupSchedule> {
    const id = `clean_${(await sha256Hex(input.deploymentId)).slice(0, 24)}`;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `INSERT INTO deployment_cleanup_schedules (
        id, deployment_id, environment_id, stack_name, status, expires_at,
        provider_schedule_ref, confirmed_at, last_error, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7, NULL, $8, $8)
      ON CONFLICT (deployment_id) DO UPDATE
      SET status = 'confirmed', provider_schedule_ref = EXCLUDED.provider_schedule_ref,
          confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at,
          last_error = NULL
      WHERE deployment_cleanup_schedules.environment_id = EXCLUDED.environment_id
        AND deployment_cleanup_schedules.stack_name = EXCLUDED.stack_name
        AND deployment_cleanup_schedules.expires_at = EXCLUDED.expires_at
        AND deployment_cleanup_schedules.status IN ('pending', 'confirmed', 'failed')
      RETURNING id, deployment_id, status, expires_at, provider_schedule_ref, confirmed_at`,
      [
        id,
        input.deploymentId,
        input.environmentId,
        input.stackName,
        input.expiresAt,
        input.providerScheduleRef,
        input.confirmedAt,
        input.now,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Cleanup schedule conflicts with an existing guardrail.");
    return {
      id: text(row.id),
      deploymentId: text(row.deployment_id),
      status: text(row.status) as DeploymentCleanupSchedule["status"],
      expiresAt: integer(row.expires_at),
      providerScheduleRef: nullableText(row.provider_schedule_ref),
      confirmedAt: row.confirmed_at === null ? null : integer(row.confirmed_at),
    };
  }

  async heartbeat(input: {
    jobId: string;
    workerId: string;
    now: number;
    leaseDurationMs: number;
  }): Promise<boolean> {
    const rows = await query(
      this.sql,
      `UPDATE deployment_jobs SET lease_expires_at = $1, updated_at = $2
       WHERE id = $3 AND status = 'running' AND lease_owner = $4
         AND lease_expires_at > $2 RETURNING id`,
      [input.now + input.leaseDurationMs, input.now, input.jobId, input.workerId],
    );
    return rows.length === 1;
  }

  async transitionDeployment(input: {
    deploymentId: string;
    jobId: string;
    workerId: string;
    from: DeploymentStatus[];
    to: DeploymentStatus;
    currentStep: string;
    outputPatch?: Record<string, unknown>;
    now: number;
  }): Promise<boolean> {
    const patch = input.outputPatch ?? {};
    assertSafeDeploymentOutput(patch);
    const rows = await query(
      this.sql,
      `UPDATE app_instance_deployments AS deployment
       SET status = $1, current_step = $2,
           outputs = (outputs::jsonb || $3::jsonb)::text,
           started_at = COALESCE(started_at, $4), updated_at = $4
       WHERE deployment.id = $5 AND deployment.status = ANY($6::text[])
         AND EXISTS (
           SELECT 1 FROM deployment_jobs job
           WHERE job.id = $7 AND job.deployment_id = deployment.id
             AND job.status = 'running' AND job.lease_owner = $8
             AND job.lease_expires_at > $4
         )
       RETURNING deployment.id`,
      [
        input.to,
        input.currentStep,
        JSON.stringify(patch),
        input.now,
        input.deploymentId,
        input.from,
        input.jobId,
        input.workerId,
      ],
    );
    return rows.length === 1;
  }

  async beginStep(input: {
    deploymentId: string;
    jobId: string;
    workerId: string;
    stepKey: string;
    inputHash: string;
    attempt: number;
    now: number;
  }): Promise<DeploymentStepHandle> {
    const id = `step_${(await sha256Hex(`${input.deploymentId}:${input.stepKey}:${input.inputHash}:${input.attempt}`)).slice(0, 24)}`;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH owned_job AS (
        SELECT id FROM deployment_jobs
        WHERE id = $1 AND deployment_id = $2 AND status = 'running'
          AND lease_owner = $3 AND lease_expires_at > $4 AND attempts = $5
      ), inserted AS (
        INSERT INTO deployment_step_runs (
          id, deployment_id, job_id, step_key, attempt, status, input_hash,
          output, started_at
        )
        SELECT $6, $2, $1, $7, $5, 'running', $8, '{}', $4 FROM owned_job
        ON CONFLICT (deployment_id, step_key, input_hash, attempt) DO NOTHING
        RETURNING id, status, output
      )
      SELECT id, status, output FROM inserted
      UNION ALL
      SELECT step.id, step.status, step.output
      FROM deployment_step_runs step
      INNER JOIN owned_job ON owned_job.id = step.job_id
      WHERE step.deployment_id = $2 AND step.step_key = $7
        AND step.input_hash = $8 AND step.attempt = $5
      LIMIT 1`,
      [
        input.jobId,
        input.deploymentId,
        input.workerId,
        input.now,
        input.attempt,
        id,
        input.stepKey,
        input.inputHash,
      ],
    );
    const row = rows[0];
    if (!row) throw Object.assign(new Error("Deployment lease was lost."), { code: "DEPLOYMENT_LEASE_LOST" });
    return {
      id: text(row.id),
      alreadySucceeded: row.status === "succeeded",
      previousOutput: parseObject(row.output),
    };
  }

  async finishStep(input: {
    stepId: string;
    workerId: string;
    status: "succeeded" | "failed" | "skipped";
    output: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    now: number;
  }): Promise<boolean> {
    assertSafeDeploymentOutput(input.output);
    const rows = await query(
      this.sql,
      `UPDATE deployment_step_runs step
       SET status = $1, output = $2, error_code = $3, error_message = $4,
           finished_at = $5
       WHERE step.id = $6 AND step.status = 'running'
         AND EXISTS (
           SELECT 1 FROM deployment_jobs job
           WHERE job.id = step.job_id AND job.deployment_id = step.deployment_id
             AND job.status = 'running' AND job.lease_owner = $7
             AND job.lease_expires_at > $5
         )
       RETURNING step.id`,
      [
        input.status,
        JSON.stringify(input.output),
        input.errorCode ? normalizeDeploymentError(input.errorCode, "STEP_FAILED") : null,
        input.errorMessage
          ? normalizeDeploymentError(input.errorMessage, "Deployment step failed.")
          : null,
        input.now,
        input.stepId,
        input.workerId,
      ],
    );
    return rows.length === 1;
  }

  async enqueueJob(input: {
    deploymentId: string;
    jobType: ClaimedDeploymentJob["jobType"];
    planHash: string;
    availableAt: number;
    maxAttempts: number;
    now: number;
  }): Promise<void> {
    const dedupeKey = `${input.jobType}:${input.deploymentId}:${input.planHash}`;
    const id = `job_${(await sha256Hex(dedupeKey)).slice(0, 24)}`;
    await query(
      this.sql,
      `INSERT INTO deployment_jobs (
        id, deployment_id, job_type, dedupe_key, status, payload, attempts,
        max_attempts, available_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'pending', $5, 0, $6, $7, $8, $8)
      ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        id,
        input.deploymentId,
        input.jobType,
        dedupeKey,
        JSON.stringify({
          schemaVersion: 1,
          deploymentId: input.deploymentId,
          planHash: input.planHash,
        }),
        input.maxAttempts,
        input.availableAt,
        input.now,
      ],
    );
  }

  async completeJob(input: {
    jobId: string;
    workerId: string;
    now: number;
  }): Promise<boolean> {
    const rows = await query(
      this.sql,
      `UPDATE deployment_jobs
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = $1, updated_at = $1
       WHERE id = $2 AND status = 'running' AND lease_owner = $3
         AND lease_expires_at > $1 RETURNING id`,
      [input.now, input.jobId, input.workerId],
    );
    return rows.length === 1;
  }

  async retryJob(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    retryDelayMs: number;
    now: number;
  }): Promise<"retry_wait" | "dead_letter" | "lease_lost"> {
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `UPDATE deployment_jobs
       SET status = CASE WHEN $1 = false OR attempts >= max_attempts
                         THEN 'dead_letter' ELSE 'retry_wait' END,
           available_at = $2, lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = $3, last_error_message = $4, updated_at = $5,
           completed_at = CASE WHEN $1 = false OR attempts >= max_attempts
                               THEN $5 ELSE NULL END
       WHERE id = $6 AND status = 'running' AND lease_owner = $7
         AND lease_expires_at > $5
       RETURNING status`,
      [
        input.retryable,
        input.now + input.retryDelayMs,
        normalizeDeploymentError(input.errorCode, "DEPLOYMENT_EXECUTION_FAILED"),
        normalizeDeploymentError(input.errorMessage, "Deployment execution failed."),
        input.now,
        input.jobId,
        input.workerId,
      ],
    );
    const status = text(rows[0]?.status);
    return status === "retry_wait" || status === "dead_letter" ? status : "lease_lost";
  }

  async markReady(input: {
    deploymentId: string;
    appInstanceId: string;
    subscriptionId: string;
    jobId: string;
    workerId: string;
    accessUrl: string;
    controlPayloadHash: string;
    outputPatch: Record<string, unknown>;
    now: number;
  }): Promise<boolean> {
    assertSafeDeploymentOutput(input.outputPatch);
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH eligible AS MATERIALIZED (
        SELECT deployment.id AS deployment_id, instance.id AS instance_id
        FROM app_instance_deployments deployment
        INNER JOIN app_instances instance
          ON instance.id = deployment.app_instance_id
        INNER JOIN subscriptions subscription
          ON subscription.id = instance.subscription_id
        INNER JOIN deployment_jobs job
          ON job.id = $1 AND job.deployment_id = deployment.id
        WHERE deployment.id = $2 AND deployment.status = 'verifying'
          AND instance.id = $3 AND instance.status = 'pending'
          AND instance.subscription_id = $4
          AND subscription.id = $4 AND subscription.status = 'active'
          AND job.status = 'running' AND job.lease_owner = $5
          AND job.lease_expires_at > $6
        FOR UPDATE OF deployment, instance, subscription, job
      ), activated_instance AS (
        UPDATE app_instances instance
        SET status = 'active', access_url = $7, provisioned_at = $6,
            suspended_at = NULL, updated_at = $6
        FROM eligible
        WHERE instance.id = eligible.instance_id
        RETURNING instance.id
      ), ready_deployment AS (
        UPDATE app_instance_deployments deployment
        SET status = 'ready', current_step = 'ready', ready_at = $6,
            control_payload_hash = $8,
            outputs = (outputs::jsonb || $9::jsonb)::text, updated_at = $6
        FROM eligible, activated_instance
        WHERE deployment.id = eligible.deployment_id
        RETURNING deployment.id
      ), committed AS (
        SELECT
          (SELECT count(*) FROM activated_instance) AS instance_count,
          (SELECT count(*) FROM ready_deployment) AS deployment_count
        FROM eligible
      )
      SELECT 1 / CASE
        WHEN instance_count = 1 AND deployment_count = 1 THEN 1 ELSE 0
      END AS committed
      FROM committed`,
      [
        input.jobId,
        input.deploymentId,
        input.appInstanceId,
        input.subscriptionId,
        input.workerId,
        input.now,
        input.accessUrl,
        input.controlPayloadHash,
        JSON.stringify(input.outputPatch),
      ],
    );
    return integer(rows[0]?.committed ?? 0) === 1;
  }

  async markInstanceUnavailable(input: {
    deploymentId: string;
    appInstanceId: string;
    reason: "ttl_cleanup" | "rollback";
    now: number;
  }): Promise<void> {
    await query(
      this.sql,
      `WITH eligible AS MATERIALIZED (
        SELECT deployment.id, deployment.app_instance_id
        FROM app_instance_deployments deployment
        WHERE deployment.id = $3 AND deployment.app_instance_id = $2
          AND deployment.status IN ('rolled_back', 'canceled')
        FOR UPDATE OF deployment
      ), suspended AS (
        UPDATE app_instances instance
        SET status = 'suspended', access_url = '', suspended_at = $1, updated_at = $1
        FROM eligible
        WHERE instance.id = eligible.app_instance_id
        RETURNING instance.id
      ), released AS (
        DELETE FROM deployment_environment_capacity_reservations reservation
        USING eligible
        WHERE reservation.deployment_id = eligible.id
        RETURNING reservation.deployment_id
      )
      SELECT
        (SELECT count(*) FROM suspended) AS suspended_count,
        (SELECT count(*) FROM released) AS released_count`,
      [input.now, input.appInstanceId, input.deploymentId],
    );
    void input.reason;
  }

  async markCleanupStatus(input: {
    scheduleId: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    now: number;
  }): Promise<void> {
    await query(
      this.sql,
      `UPDATE deployment_cleanup_schedules
       SET status = $1, last_error = $2, updated_at = $3,
           completed_at = CASE WHEN $1 IN ('succeeded', 'failed') THEN $3 ELSE NULL END
       WHERE id = $4`,
      [
        input.status,
        input.errorMessage
          ? normalizeDeploymentError(input.errorMessage, "Cleanup failed.")
          : null,
        input.now,
        input.scheduleId,
      ],
    );
  }
}
