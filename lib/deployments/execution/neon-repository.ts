import {
  neon,
  type NeonQueryFunction,
  type NeonQueryFunctionInTransaction,
} from "@neondatabase/serverless";
import {
  parseDeploymentEnvironmentPolicy,
  type DeploymentEnvironment,
} from "../environment.ts";
import type {
  DeploymentJobStatus,
  DeploymentStatus,
} from "../state-machine.ts";
import { assertSafeDeploymentOutput, normalizeDeploymentError } from "../safety.ts";
import { createDeploymentLeaseToken } from "../lease.ts";
import type {
  ClaimedDeploymentJob,
  DeploymentCleanupSchedule,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentJobEnqueueResult,
  DeploymentStepHandle,
  DeploymentTenantResourceLifecycleWrite,
  DeploymentTenantResourceRecord,
  TenantResourceCleanupReceipt,
  TenantResourceFence,
  TenantResourceGenerationClaim,
  TenantResourceIdentity,
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

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

function assertSafeTenantResourceEvidence(
  evidence: Record<string, unknown>,
): void {
  assertSafeDeploymentOutput(evidence);
  const serialized = JSON.stringify(evidence);
  if (new TextEncoder().encode(serialized).byteLength > 16 * 1024) {
    throw new Error("Tenant resource evidence exceeds 16 KiB.");
  }
  if (/(?:https?|postgres(?:ql)?|s3):\/\//i.test(serialized)) {
    throw new Error("Tenant resource evidence must not contain URLs or URIs.");
  }
}

function tenantStableStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-28) || "pending";
}

async function assertStableTenantResourceIdentity(
  identity: TenantResourceIdentity,
): Promise<void> {
  const stableIdentityHash = await sha256Hex({
    appInstanceId: identity.appInstanceId,
    workspaceId: identity.workspaceId,
    productId: identity.productId,
    environmentId: identity.environmentId,
    cellKey: identity.cellKey,
  });
  const token = `${tenantStableStem(identity.appInstanceId)}_${stableIdentityHash.slice(0, 10)}`;
  const postgresIdentifier = /^[a-z][a-z0-9_]{2,62}$/;
  if (
    identity.schemaVersion !== 1 ||
    identity.stableIdentityHash !== stableIdentityHash ||
    !postgresIdentifier.test(identity.databaseName) ||
    !postgresIdentifier.test(identity.roleName) ||
    identity.secretName !== `techlong/sandbox/tenant/${token}/runtime`
  ) {
    throw Object.assign(
      new Error("Tenant resource stable identity is invalid."),
      { code: "TENANT_RESOURCE_IDENTITY_MISMATCH" },
    );
  }
}

function expectedTenantOwnershipMarker(
  identity: TenantResourceIdentity,
  generation: number,
): string {
  return `tl_owner_${identity.stableIdentityHash.slice(0, 32)}_g${generation}`;
}

async function assertTenantResourceFenceInput(
  fence: TenantResourceFence,
): Promise<void> {
  await assertStableTenantResourceIdentity(fence.identity);
  if (
    fence.schemaVersion !== 1 ||
    !Number.isSafeInteger(fence.generation) ||
    fence.generation < 1 ||
    !fence.ownerDeploymentId ||
    fence.ownershipMarker !==
      expectedTenantOwnershipMarker(fence.identity, fence.generation)
  ) {
    throw Object.assign(new Error("Tenant resource generation fence is invalid."), {
      code: "TENANT_RESOURCE_FENCE_INVALID",
    });
  }
}

function sameTenantResourceFence(
  actual: TenantResourceFence,
  expected: TenantResourceFence,
): boolean {
  return (
    actual.schemaVersion === expected.schemaVersion &&
    actual.generation === expected.generation &&
    actual.ownerDeploymentId === expected.ownerDeploymentId &&
    actual.ownershipMarker === expected.ownershipMarker &&
    actual.identity.schemaVersion === expected.identity.schemaVersion &&
    actual.identity.appInstanceId === expected.identity.appInstanceId &&
    actual.identity.workspaceId === expected.identity.workspaceId &&
    actual.identity.productId === expected.identity.productId &&
    actual.identity.environmentId === expected.identity.environmentId &&
    actual.identity.cellKey === expected.identity.cellKey &&
    actual.identity.databaseName === expected.identity.databaseName &&
    actual.identity.roleName === expected.identity.roleName &&
    actual.identity.secretName === expected.identity.secretName &&
    actual.identity.stableIdentityHash === expected.identity.stableIdentityHash
  );
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

function tenantResourceRecord(
  row: Record<string, unknown>,
): DeploymentTenantResourceRecord | null {
  const appInstanceId = nullableText(row.tenant_resource_app_instance_id);
  if (!appInstanceId) return null;
  const evidence = parseObject(row.tenant_resource_evidence);
  assertSafeTenantResourceEvidence(evidence);
  const record: DeploymentTenantResourceRecord = {
    identity: {
      schemaVersion: 1,
      appInstanceId,
      workspaceId: text(row.tenant_resource_workspace_id),
      productId: text(row.tenant_resource_product_id),
      environmentId: text(row.tenant_resource_environment_id),
      cellKey: text(row.tenant_resource_cell_key),
      databaseName: text(row.tenant_resource_database_name),
      roleName: text(row.tenant_resource_role_name),
      secretName: text(row.tenant_resource_secret_name),
      stableIdentityHash: text(row.tenant_resource_stable_identity_hash),
    },
    generation: integer(row.tenant_resource_generation),
    ownershipMarker: text(row.tenant_resource_ownership_marker),
    createdByDeploymentId: text(row.tenant_resource_created_by_deployment_id),
    ownerDeploymentId: text(row.tenant_resource_owner_deployment_id),
    runtimeSecretRef: nullableText(row.tenant_resource_runtime_secret_ref),
    lifecycleStatus: text(
      row.tenant_resource_lifecycle_status,
    ) as DeploymentTenantResourceRecord["lifecycleStatus"],
    baselineDigest: nullableText(row.tenant_resource_baseline_digest),
    migrationContract: nullableText(
      row.tenant_resource_migration_contract,
    ) as DeploymentTenantResourceRecord["migrationContract"],
    evidenceHash: nullableText(row.tenant_resource_evidence_hash),
    evidence,
    lastError: nullableText(row.tenant_resource_last_error),
    createdAt: integer(row.tenant_resource_created_at),
    updatedAt: integer(row.tenant_resource_updated_at),
    destroyedAt:
      row.tenant_resource_destroyed_at === null
        ? null
        : integer(row.tenant_resource_destroyed_at),
  };
  if (
    !/^[a-f0-9]{64}$/.test(record.identity.stableIdentityHash) ||
    record.ownershipMarker !==
      expectedTenantOwnershipMarker(record.identity, record.generation)
  ) {
    throw new Error("Persisted tenant resource generation fence is invalid.");
  }
  return record;
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
    if (input.jobTypes.length === 0) {
      throw new Error("At least one deployment job type must be allowed.");
    }
    const leaseToken = createDeploymentLeaseToken();
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), released_disallowed AS (
        UPDATE deployment_jobs AS blocked
        SET status = CASE
              WHEN blocked.attempts >= blocked.max_attempts
                THEN 'dead_letter'
              ELSE 'retry_wait'
            END,
            available_at = db_clock.now_ms,
            lease_owner = NULL, lease_expires_at = NULL, lease_token = NULL,
            last_error_code = CASE
              WHEN blocked.attempts >= blocked.max_attempts
                THEN COALESCE(blocked.last_error_code, 'LEASE_EXHAUSTED')
              ELSE blocked.last_error_code
            END,
            last_error_message = CASE
              WHEN blocked.attempts >= blocked.max_attempts
                THEN COALESCE(blocked.last_error_message, 'Worker lease expired.')
              ELSE blocked.last_error_message
            END,
            updated_at = db_clock.now_ms,
            completed_at = CASE
              WHEN blocked.attempts >= blocked.max_attempts
                THEN db_clock.now_ms
              ELSE NULL
            END
        FROM db_clock
        WHERE blocked.status = 'running'
          AND blocked.lease_expires_at <= db_clock.now_ms
          AND blocked.job_type <> ALL($1::text[])
          AND EXISTS (
            SELECT 1
            FROM deployment_jobs AS allowed_sibling
            WHERE allowed_sibling.deployment_id = blocked.deployment_id
              AND allowed_sibling.id <> blocked.id
              AND allowed_sibling.job_type = ANY($1::text[])
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
          )
        RETURNING blocked.id, blocked.deployment_id, blocked.job_type,
          blocked.status
      ), exhausted AS (
        UPDATE deployment_jobs AS exhausted_job
        SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
            lease_token = NULL,
            last_error_code = COALESCE(last_error_code, 'LEASE_EXHAUSTED'),
            last_error_message = COALESCE(last_error_message, 'Worker lease expired.'),
            updated_at = db_clock.now_ms, completed_at = db_clock.now_ms
        FROM db_clock
        WHERE exhausted_job.status = 'running'
          AND exhausted_job.lease_expires_at <= db_clock.now_ms
          AND exhausted_job.attempts >= exhausted_job.max_attempts
          AND exhausted_job.job_type = ANY($1::text[])
        RETURNING exhausted_job.id, exhausted_job.deployment_id,
          exhausted_job.job_type, exhausted_job.status
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
            (
              candidate_job.status IN ('pending', 'retry_wait')
              AND candidate_job.available_at <= db_clock.now_ms
            ) OR (
              candidate_job.status = 'running'
              AND candidate_job.lease_expires_at <= db_clock.now_ms
            )
          )
          AND candidate_job.attempts < candidate_job.max_attempts
          AND candidate_job.job_type = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM deployment_jobs AS sibling
            WHERE sibling.deployment_id = candidate_job.deployment_id
              AND sibling.id <> candidate_job.id
              AND sibling.status = 'running'
          )
          AND (SELECT count(*) FROM released_disallowed) >= 0
          AND (SELECT count(*) FROM exhausted) >= 0
          AND (SELECT count(*) FROM failed_cleanup) >= 0
        ORDER BY (candidate_job.status = 'running') DESC,
          candidate_job.available_at, candidate_job.created_at
        FOR UPDATE OF candidate_job, candidate_deployment SKIP LOCKED
        LIMIT 1
      )
      UPDATE deployment_jobs AS job
      SET status = 'running', lease_owner = $2,
          lease_expires_at = db_clock.now_ms + $3,
          lease_token = $4,
          attempts = job.attempts + 1, updated_at = db_clock.now_ms,
          last_error_code = NULL, last_error_message = NULL
      FROM candidate, db_clock
      WHERE job.id = candidate.id
      RETURNING job.id, job.deployment_id, job.job_type, job.payload,
        job.attempts, job.max_attempts, job.lease_expires_at,
        job.lease_token`,
      [
        input.jobTypes,
        input.workerId,
        input.leaseDurationMs,
        leaseToken,
      ],
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
          leaseToken: text(row.lease_token),
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
        ai.template_version_id, ai.slug, ai.tenant_key, ai.configuration_snapshot,
        w.status AS workspace_status,
        s.status AS subscription_status,
        c.id AS cleanup_id, c.status AS cleanup_status,
        c.expires_at AS cleanup_expires_at, c.provider_schedule_ref,
        c.confirmed_at AS cleanup_confirmed_at,
        tr.app_instance_id AS tenant_resource_app_instance_id,
        tr.created_by_deployment_id AS tenant_resource_created_by_deployment_id,
        tr.owner_deployment_id AS tenant_resource_owner_deployment_id,
        tr.generation AS tenant_resource_generation,
        tr.stable_identity_hash AS tenant_resource_stable_identity_hash,
        tr.environment_id AS tenant_resource_environment_id,
        tr.workspace_id AS tenant_resource_workspace_id,
        tr.product_id AS tenant_resource_product_id,
        tr.cell_key AS tenant_resource_cell_key,
        tr.database_name AS tenant_resource_database_name,
        tr.role_name AS tenant_resource_role_name,
        tr.secret_name AS tenant_resource_secret_name,
        tr.runtime_secret_ref AS tenant_resource_runtime_secret_ref,
        tr.ownership_marker AS tenant_resource_ownership_marker,
        tr.lifecycle_status AS tenant_resource_lifecycle_status,
        tr.baseline_digest AS tenant_resource_baseline_digest,
        tr.migration_contract AS tenant_resource_migration_contract,
        tr.evidence_hash AS tenant_resource_evidence_hash,
        tr.evidence AS tenant_resource_evidence,
        tr.last_error AS tenant_resource_last_error,
        tr.created_at AS tenant_resource_created_at,
        tr.updated_at AS tenant_resource_updated_at,
        tr.destroyed_at AS tenant_resource_destroyed_at
      FROM app_instance_deployments d
      INNER JOIN deployment_environments e ON e.id = d.environment_id
      INNER JOIN app_instances ai ON ai.id = d.app_instance_id
      INNER JOIN workspaces w ON w.id = ai.workspace_id
      LEFT JOIN subscriptions s ON s.id = ai.subscription_id
      LEFT JOIN deployment_environment_bindings b ON b.environment_id = e.id
      LEFT JOIN deployment_cleanup_schedules c ON c.deployment_id = d.id
      LEFT JOIN deployment_tenant_resources tr
        ON tr.app_instance_id = ai.id
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
    const templateVersionId = nullableText(row.template_version_id);
    if (!templateVersionId) {
      throw new Error(
        "Claimed deployment has no immutable application template version.",
      );
    }
    const tenantResources = tenantResourceRecord(row);
    if (tenantResources) {
      await assertStableTenantResourceIdentity(tenantResources.identity);
    }
    if (
      tenantResources &&
      (tenantResources.identity.appInstanceId !== text(row.app_instance_id) ||
        tenantResources.identity.workspaceId !== text(row.workspace_id) ||
        tenantResources.identity.productId !== text(row.product_id) ||
        tenantResources.identity.environmentId !== environment.id ||
        tenantResources.identity.cellKey !== environment.cellKey ||
        !tenantResources.createdByDeploymentId ||
        !tenantResources.ownerDeploymentId ||
        !Number.isSafeInteger(tenantResources.generation) ||
        tenantResources.generation < 1)
    ) {
      throw new Error("Persisted tenant resource identity does not match deployment.");
    }
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
        templateVersionId,
        status: text(row.instance_status),
        slug: text(row.slug),
        tenantKey: text(row.tenant_key),
        configurationSnapshot: parseObject(row.configuration_snapshot),
      },
      tenantResources,
      activeCellCount: nullableText(row.binding_environment_id) ? 1 : 0,
      activeTenantCount: integer(countRows[0]?.tenant_count ?? 0),
    };
  }

  async reserveEnvironmentCapacity(input: {
    lease: Parameters<DeploymentExecutionRepository["reserveEnvironmentCapacity"]>[0]["lease"];
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
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), owned_job AS MATERIALIZED (
        SELECT job.id
        FROM deployment_jobs AS job
        CROSS JOIN db_clock
        WHERE job.id = $5 AND job.deployment_id = $1
          AND job.status = 'running'
          AND job.lease_owner = $6 AND job.lease_token = $7
          AND job.attempts = $8
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF job
      ), locked_environment AS MATERIALIZED (
        SELECT id
        FROM deployment_environments
        WHERE id = $2 AND kind = 'aws_sandbox'
          AND EXISTS (SELECT 1 FROM owned_job)
        FOR UPDATE
      ), existing AS MATERIALIZED (
        SELECT reservation.deployment_id
        FROM deployment_environment_capacity_reservations reservation
        INNER JOIN locked_environment environment
          ON environment.id = reservation.environment_id
        INNER JOIN owned_job ON true
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
        INNER JOIN owned_job ON true
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
      [
        input.lease.deploymentId,
        input.environmentId,
        input.maxTenants,
        input.now,
        input.lease.jobId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return rows.length === 1;
  }

  async confirmCleanupSchedule(input: {
    lease: Parameters<DeploymentExecutionRepository["confirmCleanupSchedule"]>[0]["lease"];
    environmentId: string;
    stackName: string;
    expiresAt: number;
    providerScheduleRef: string;
    confirmedAt: number;
    now: number;
  }): Promise<DeploymentCleanupSchedule> {
    const id = `clean_${(await sha256Hex(input.lease.deploymentId)).slice(0, 24)}`;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), owned_job AS MATERIALIZED (
        SELECT job.id
        FROM deployment_jobs AS job
        CROSS JOIN db_clock
        WHERE job.id = $9 AND job.deployment_id = $2
          AND job.status = 'running'
          AND job.lease_owner = $10 AND job.lease_token = $11
          AND job.attempts = $12
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF job
      )
      INSERT INTO deployment_cleanup_schedules (
        id, deployment_id, environment_id, stack_name, status, expires_at,
        provider_schedule_ref, confirmed_at, last_error, created_at, updated_at
      ) SELECT $1, $2, $3, $4, 'confirmed', $5, $6, $7, NULL, $8, $8
        FROM owned_job
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
        input.lease.deploymentId,
        input.environmentId,
        input.stackName,
        input.expiresAt,
        input.providerScheduleRef,
        input.confirmedAt,
        input.now,
        input.lease.jobId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
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
    lease: Parameters<DeploymentExecutionRepository["heartbeat"]>[0]["lease"];
    now: number;
    leaseDurationMs: number;
  }): Promise<boolean> {
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = $2 AND job.deployment_id = $3
           AND job.status = 'running' AND job.lease_owner = $4
           AND job.lease_token = $5 AND job.attempts = $6
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_jobs AS job
       SET lease_expires_at = owned_job.now_ms + $1,
           updated_at = owned_job.now_ms
       FROM owned_job
       WHERE job.id = owned_job.id
       RETURNING job.id`,
      [
        input.leaseDurationMs,
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return rows.length === 1;
  }

  async transitionDeployment(input: {
    lease: Parameters<DeploymentExecutionRepository["transitionDeployment"]>[0]["lease"];
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
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, job.deployment_id
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = $7 AND job.deployment_id = $5
           AND job.status = 'running' AND job.lease_owner = $8
           AND job.lease_token = $9 AND job.attempts = $10
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE app_instance_deployments AS deployment
       SET status = $1, current_step = $2,
           outputs = (outputs::jsonb || $3::jsonb)::text,
           started_at = COALESCE(started_at, $4), updated_at = $4
       FROM owned_job
       WHERE deployment.id = $5
         AND deployment.id = owned_job.deployment_id
         AND deployment.status = ANY($6::text[])
       RETURNING deployment.id`,
      [
        input.to,
        input.currentStep,
        JSON.stringify(patch),
        input.now,
        input.lease.deploymentId,
        input.from,
        input.lease.jobId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return rows.length === 1;
  }

  async beginStep(input: {
    lease: Parameters<DeploymentExecutionRepository["beginStep"]>[0]["lease"];
    stepKey: string;
    inputHash: string;
    now: number;
  }): Promise<DeploymentStepHandle> {
    const id = `step_${(await sha256Hex(`${input.lease.deploymentId}:${input.lease.jobId}:${input.stepKey}:${input.inputHash}:${input.lease.attempt}`)).slice(0, 24)}`;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), owned_job AS MATERIALIZED (
        SELECT job.id
        FROM deployment_jobs AS job
        CROSS JOIN db_clock
        WHERE job.id = $1 AND job.deployment_id = $2
          AND job.status = 'running' AND job.lease_owner = $3
          AND job.lease_token = $8 AND job.attempts = $4
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF job
      ), inserted AS (
        INSERT INTO deployment_step_runs (
          id, deployment_id, job_id, step_key, attempt, status, input_hash,
          output, started_at
        )
        SELECT $5, $2, $1, $6, $4, 'running', $7, '{}', db_clock.now_ms
        FROM owned_job
        CROSS JOIN db_clock
        ON CONFLICT (job_id, step_key, input_hash, attempt) DO NOTHING
        RETURNING id, status, output
      )
      SELECT id, status, output FROM inserted
      UNION ALL
      SELECT step.id, step.status, step.output
      FROM deployment_step_runs step
      INNER JOIN owned_job ON owned_job.id = step.job_id
      WHERE step.deployment_id = $2 AND step.step_key = $6
        AND step.input_hash = $7 AND step.attempt = $4
      LIMIT 1`,
      [
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.attempt,
        id,
        input.stepKey,
        input.inputHash,
        input.lease.leaseToken,
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
    lease: Parameters<DeploymentExecutionRepository["finishStep"]>[0]["lease"];
    stepId: string;
    status: "succeeded" | "failed" | "skipped";
    output: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    now: number;
  }): Promise<boolean> {
    assertSafeDeploymentOutput(input.output);
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, job.deployment_id
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = $1 AND job.deployment_id = $2
           AND job.status = 'running' AND job.lease_owner = $3
           AND job.lease_token = $4 AND job.attempts = $5
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_step_runs AS step
       SET status = $6, output = $7, error_code = $8, error_message = $9,
           finished_at = db_clock.now_ms
       FROM owned_job, db_clock
       WHERE step.id = $10 AND step.status = 'running'
         AND step.job_id = owned_job.id
         AND step.deployment_id = owned_job.deployment_id
       RETURNING step.id`,
      [
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
        input.status,
        JSON.stringify(input.output),
        input.errorCode ? normalizeDeploymentError(input.errorCode, "STEP_FAILED") : null,
        input.errorMessage
          ? normalizeDeploymentError(input.errorMessage, "Deployment step failed.")
          : null,
        input.stepId,
      ],
    );
    return rows.length === 1;
  }

  async enqueueJob(input: {
    lease: Parameters<DeploymentExecutionRepository["enqueueJob"]>[0]["lease"];
    deploymentId: string;
    jobType: ClaimedDeploymentJob["jobType"];
    planHash: string;
    availableAt: number;
    maxAttempts: number;
    now: number;
  }): Promise<DeploymentJobEnqueueResult> {
    const dedupeKey = `${input.jobType}:${input.deploymentId}:${input.planHash}`;
    const id = `job_${(await sha256Hex(dedupeKey)).slice(0, 24)}`;
    const payload = JSON.stringify({
      schemaVersion: 1,
      deploymentId: input.deploymentId,
      planHash: input.planHash,
    });
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT owner.id
         FROM deployment_jobs owner
         CROSS JOIN db_clock
         WHERE owner.id = $8 AND owner.deployment_id = $2
           AND owner.status = 'running' AND owner.lease_owner = $9
           AND owner.lease_token = $10 AND owner.attempts = $11
           AND owner.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF owner
       ), inserted_job AS (
         INSERT INTO deployment_jobs (
           id, deployment_id, job_type, dedupe_key, status, payload, attempts,
           max_attempts, available_at, created_at, updated_at
         ) SELECT $1, $2, $3, $4, 'pending', $5, 0, $6, $7,
                  db_clock.now_ms, db_clock.now_ms
           FROM owned_job
           CROSS JOIN db_clock
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id, status, available_at, attempts, max_attempts
       ), existing_job AS MATERIALIZED (
         SELECT existing.id, existing.status, existing.available_at,
                existing.attempts, existing.max_attempts
         FROM deployment_jobs existing
         WHERE EXISTS (SELECT 1 FROM owned_job)
           AND existing.dedupe_key = $4
           AND existing.deployment_id = $2
           AND existing.job_type = $3
           AND existing.payload = $5
         LIMIT 1
       )
       SELECT CASE
         WHEN NOT EXISTS (SELECT 1 FROM owned_job) THEN 'lease_lost'
         WHEN EXISTS (SELECT 1 FROM inserted_job) THEN 'inserted'
         WHEN EXISTS (
           SELECT 1 FROM existing_job
           WHERE status IN ('pending', 'running', 'retry_wait')
         ) THEN 'existing_active'
         WHEN EXISTS (
           SELECT 1 FROM existing_job WHERE status = 'succeeded'
         ) THEN 'existing_succeeded'
         WHEN EXISTS (
           SELECT 1 FROM existing_job WHERE status IN ('dead_letter', 'canceled')
         ) THEN 'existing_unusable'
         ELSE 'rejected'
       END AS outcome,
       COALESCE(
         (SELECT id FROM inserted_job),
         (SELECT id FROM existing_job)
       ) AS job_id,
       COALESCE(
         (SELECT status FROM inserted_job),
         (SELECT status FROM existing_job)
       ) AS job_status,
       COALESCE(
         (SELECT available_at FROM inserted_job),
         (SELECT available_at FROM existing_job)
       ) AS job_available_at,
       COALESCE(
         (SELECT attempts FROM inserted_job),
         (SELECT attempts FROM existing_job)
       ) AS job_attempts,
       COALESCE(
         (SELECT max_attempts FROM inserted_job),
         (SELECT max_attempts FROM existing_job)
       ) AS job_max_attempts`,
      [
        id,
        input.deploymentId,
        input.jobType,
        dedupeKey,
        payload,
        input.maxAttempts,
        input.availableAt,
        input.lease.jobId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    const row = rows[0] ?? {};
    const outcome = text(row.outcome);
    if (
      ![
        "inserted",
        "existing_active",
        "existing_succeeded",
        "existing_unusable",
        "lease_lost",
        "rejected",
      ].includes(outcome)
    ) {
      throw new Error("PostgreSQL returned an invalid deployment enqueue outcome.");
    }
    const status = nullableText(row.job_status) as DeploymentJobStatus | null;
    if (
      status !== null &&
      ![
        "pending",
        "running",
        "retry_wait",
        "succeeded",
        "dead_letter",
        "canceled",
      ].includes(status)
    ) {
      throw new Error("PostgreSQL returned an invalid deployment job status.");
    }
    return {
      outcome: outcome as DeploymentJobEnqueueResult["outcome"],
      jobId: nullableText(row.job_id),
      status,
      availableAt:
        row.job_available_at === null || row.job_available_at === undefined
          ? null
          : integer(row.job_available_at),
      attempts:
        row.job_attempts === null || row.job_attempts === undefined
          ? null
          : integer(row.job_attempts),
      maxAttempts:
        row.job_max_attempts === null || row.job_max_attempts === undefined
          ? null
          : integer(row.job_max_attempts),
    };
  }

  async completeJob(input: {
    lease: Parameters<DeploymentExecutionRepository["completeJob"]>[0]["lease"];
    now: number;
  }): Promise<boolean> {
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = $1 AND job.deployment_id = $2
           AND job.status = 'running' AND job.lease_owner = $3
           AND job.lease_token = $4 AND job.attempts = $5
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_jobs AS job
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
           lease_token = NULL,
           completed_at = owned_job.now_ms, updated_at = owned_job.now_ms
       FROM owned_job
       WHERE job.id = owned_job.id
       RETURNING job.id`,
      [
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return rows.length === 1;
  }

  async retryJob(input: {
    lease: Parameters<DeploymentExecutionRepository["retryJob"]>[0]["lease"];
    cleanupScheduleId?: string | null;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    retryDelayMs: number;
    now: number;
  }): Promise<"retry_wait" | "dead_letter" | "lease_lost"> {
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs AS job
         CROSS JOIN db_clock
         WHERE job.id = $5 AND job.deployment_id = $6
           AND job.status = 'running' AND job.lease_owner = $7
           AND job.lease_token = $8 AND job.attempts = $9
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       ), updated_job AS (
       UPDATE deployment_jobs AS job
       SET status = CASE WHEN $1 = false OR attempts >= max_attempts
                         THEN 'dead_letter' ELSE 'retry_wait' END,
           available_at = owned_job.now_ms + $2,
           lease_owner = NULL, lease_expires_at = NULL,
           lease_token = NULL,
           last_error_code = $3, last_error_message = $4,
           updated_at = owned_job.now_ms,
           completed_at = CASE WHEN $1 = false OR attempts >= max_attempts
                               THEN owned_job.now_ms ELSE NULL END
       FROM owned_job
       WHERE job.id = owned_job.id
       RETURNING job.status, job.deployment_id, job.job_type
      ), failed_cleanup AS (
        UPDATE deployment_cleanup_schedules schedule
        SET status = 'failed', last_error = $4,
          updated_at = db_clock.now_ms, completed_at = db_clock.now_ms
        FROM updated_job, db_clock
        WHERE schedule.id = $10
          AND schedule.deployment_id = updated_job.deployment_id
          AND updated_job.status = 'dead_letter'
          AND updated_job.job_type IN ('cleanup', 'rollback')
          AND schedule.status <> 'succeeded'
        RETURNING schedule.id
      )
      SELECT status, (SELECT count(*) FROM failed_cleanup) AS cleanup_failed
      FROM updated_job`,
      [
        input.retryable,
        input.retryDelayMs,
        normalizeDeploymentError(input.errorCode, "DEPLOYMENT_EXECUTION_FAILED"),
        normalizeDeploymentError(input.errorMessage, "Deployment execution failed."),
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
        input.cleanupScheduleId ?? null,
      ],
    );
    const status = text(rows[0]?.status);
    return status === "retry_wait" || status === "dead_letter" ? status : "lease_lost";
  }

  async markReady(input: {
    lease: Parameters<DeploymentExecutionRepository["markReady"]>[0]["lease"];
    appInstanceId: string;
    subscriptionId: string;
    accessUrl: string;
    controlPayloadHash: string;
    outputPatch: Record<string, unknown>;
    now: number;
  }): Promise<boolean> {
    assertSafeDeploymentOutput(input.outputPatch);
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), eligible AS MATERIALIZED (
        SELECT deployment.id AS deployment_id, instance.id AS instance_id,
          db_clock.now_ms
        FROM app_instance_deployments deployment
        INNER JOIN app_instances instance
          ON instance.id = deployment.app_instance_id
        INNER JOIN subscriptions subscription
          ON subscription.id = instance.subscription_id
        INNER JOIN deployment_jobs job
          ON job.id = $1 AND job.deployment_id = deployment.id
        CROSS JOIN db_clock
        WHERE deployment.id = $2 AND deployment.status = 'verifying'
          AND instance.id = $3 AND instance.status = 'pending'
          AND instance.subscription_id = $4
          AND subscription.id = $4 AND subscription.status = 'active'
          AND job.status = 'running' AND job.lease_owner = $5
          AND job.lease_token = $9 AND job.attempts = $10
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF deployment, instance, subscription, job
      ), activated_instance AS (
        UPDATE app_instances instance
        SET status = 'active', access_url = $6,
            provisioned_at = eligible.now_ms,
            suspended_at = NULL, updated_at = eligible.now_ms
        FROM eligible
        WHERE instance.id = eligible.instance_id
        RETURNING instance.id
      ), ready_deployment AS (
        UPDATE app_instance_deployments deployment
        SET status = 'ready', current_step = 'ready', ready_at = eligible.now_ms,
            control_payload_hash = $7,
            outputs = (outputs::jsonb || $8::jsonb)::text,
            updated_at = eligible.now_ms
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
        input.lease.jobId,
        input.lease.deploymentId,
        input.appInstanceId,
        input.subscriptionId,
        input.lease.workerId,
        input.accessUrl,
        input.controlPayloadHash,
        JSON.stringify(input.outputPatch),
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return integer(rows[0]?.committed ?? 0) === 1;
  }

  async markInstanceUnavailable(input: {
    lease: Parameters<DeploymentExecutionRepository["markInstanceUnavailable"]>[0]["lease"];
    fence: TenantResourceFence;
    appInstanceId: string;
    reason: "ttl_cleanup" | "rollback";
    now: number;
  }): Promise<boolean> {
    await assertTenantResourceFenceInput(input.fence);
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), eligible AS MATERIALIZED (
        SELECT deployment.id, deployment.app_instance_id, db_clock.now_ms
        FROM app_instance_deployments deployment
        CROSS JOIN db_clock
        INNER JOIN deployment_jobs job
          ON job.id = $3 AND job.deployment_id = deployment.id
        INNER JOIN deployment_tenant_resources resource
          ON resource.app_instance_id = deployment.app_instance_id
        WHERE deployment.id = $2 AND deployment.app_instance_id = $1
          AND deployment.status IN ('rolled_back', 'canceled')
          AND job.status = 'running' AND job.lease_owner = $4
          AND job.lease_token = $5 AND job.attempts = $6
          AND job.lease_expires_at > db_clock.now_ms
          AND resource.owner_deployment_id = deployment.id
          AND resource.generation = $7
          AND resource.ownership_marker = $8
          AND resource.stable_identity_hash = $9
          AND resource.lifecycle_status = 'destroyed'
        FOR UPDATE OF deployment, job, resource
      ), suspended AS (
        UPDATE app_instances instance
        SET status = 'suspended', access_url = '',
            suspended_at = eligible.now_ms, updated_at = eligible.now_ms
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
      [
        input.appInstanceId,
        input.lease.deploymentId,
        input.lease.jobId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
        input.fence.generation,
        input.fence.ownershipMarker,
        input.fence.identity.stableIdentityHash,
      ],
    );
    void input.reason;
    return integer(rows[0]?.suspended_count ?? 0) === 1;
  }

  async markCleanupStatus(input: {
    lease: Parameters<DeploymentExecutionRepository["markCleanupStatus"]>[0]["lease"];
    scheduleId: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    now: number;
  }): Promise<boolean> {
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       ), owned_job AS MATERIALIZED (
         SELECT job.id, db_clock.now_ms
         FROM deployment_jobs job
         CROSS JOIN db_clock
         WHERE job.id = $4 AND job.deployment_id = $5
           AND job.status = 'running' AND job.lease_owner = $6
           AND job.lease_token = $7 AND job.attempts = $8
           AND job.lease_expires_at > db_clock.now_ms
         FOR UPDATE OF job
       )
       UPDATE deployment_cleanup_schedules schedule
       SET status = $1, last_error = $2, updated_at = owned_job.now_ms,
           completed_at = CASE
             WHEN $1 IN ('succeeded', 'failed') THEN owned_job.now_ms ELSE NULL
           END
       FROM owned_job
       WHERE schedule.id = $3 AND schedule.deployment_id = $5
       RETURNING schedule.id`,
      [
        input.status,
        input.errorMessage
          ? normalizeDeploymentError(input.errorMessage, "Cleanup failed.")
          : null,
        input.scheduleId,
        input.lease.jobId,
        input.lease.deploymentId,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return rows.length === 1;
  }

  async recordTenantResourceLifecycle(
    input: DeploymentTenantResourceLifecycleWrite,
  ): Promise<boolean> {
    await assertTenantResourceFenceInput(input.fence);
    if (input.lease.deploymentId !== input.fence.ownerDeploymentId) {
      throw Object.assign(new Error("Tenant resource owner is invalid."), {
        code: "TENANT_RESOURCE_FENCE_INVALID",
      });
    }
    if (
      input.lifecycleStatus === "destroying" ||
      input.lifecycleStatus === "destroyed"
    ) {
      throw Object.assign(
        new Error("Cleanup lifecycle states require the cleanup fence API."),
        { code: "TENANT_RESOURCE_CHECKPOINT_REJECTED" },
      );
    }
    assertSafeTenantResourceEvidence(input.evidence);
    const lifecycleEvidenceHash =
      input.evidenceHash ?? (await sha256Hex(input.evidence));
    if (!/^[a-f0-9]{64}$/.test(lifecycleEvidenceHash)) {
      throw Object.assign(new Error("Tenant lifecycle evidence hash is invalid."), {
        code: "TENANT_RESOURCE_EVIDENCE_INVALID",
      });
    }
    const identity = input.fence.identity;
    const eventType =
      input.lifecycleStatus === "failed" ? "failed" : "lifecycle_recorded";
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), leased_deployment AS MATERIALIZED (
        SELECT deployment.id
        FROM app_instance_deployments deployment
        INNER JOIN deployment_jobs job
          ON job.id = $2 AND job.deployment_id = deployment.id
        CROSS JOIN db_clock
        WHERE deployment.id = $1
          AND job.status = 'running' AND job.lease_owner = $3
          AND job.lease_token = $24 AND job.attempts = $25
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF deployment, job
      ), locked_resource AS MATERIALIZED (
        SELECT resource.*
        FROM deployment_tenant_resources resource
        INNER JOIN leased_deployment leased
          ON resource.owner_deployment_id = leased.id
        WHERE resource.app_instance_id = $5
        FOR UPDATE OF resource
      ), updated AS (
        UPDATE deployment_tenant_resources resource
        SET runtime_secret_ref = $16, lifecycle_status = $17,
          baseline_digest = $18, migration_contract = $19,
          evidence_hash = $20, evidence = $21, last_error = $22,
          updated_at = $4
        FROM locked_resource locked
        WHERE resource.app_instance_id = locked.app_instance_id
          AND resource.owner_deployment_id = $1
          AND resource.generation = $6
          AND resource.ownership_marker = $7
          AND resource.environment_id = $8
          AND resource.workspace_id = $9
          AND resource.product_id = $10
          AND resource.cell_key = $11
          AND resource.database_name = $12
          AND resource.role_name = $13
          AND resource.secret_name = $14
          AND resource.stable_identity_hash = $15
        RETURNING resource.app_instance_id, resource.generation,
          resource.owner_deployment_id, resource.lifecycle_status
      ), event_insert AS (
        INSERT INTO deployment_tenant_resource_events (
          id, app_instance_id, generation, deployment_id, event_type,
          from_status, to_status, evidence_hash, evidence, created_at
        )
        SELECT 'trevt:' || updated.app_instance_id || ':'
            || updated.generation::text || ':' || $1 || ':' || $23 || ':'
            || $17 || ':' || COALESCE($20, 'none'),
          updated.app_instance_id, updated.generation, $1, $23,
          locked.lifecycle_status, updated.lifecycle_status, $20, $21, $4
        FROM updated
        INNER JOIN locked_resource locked
          ON locked.app_instance_id = updated.app_instance_id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM leased_deployment) AS lease_owned,
        EXISTS (SELECT 1 FROM updated) AS persisted,
        (SELECT count(*) FROM event_insert) AS event_count`,
      [
        input.lease.deploymentId,
        input.lease.jobId,
        input.lease.workerId,
        input.now,
        identity.appInstanceId,
        input.fence.generation,
        input.fence.ownershipMarker,
        identity.environmentId,
        identity.workspaceId,
        identity.productId,
        identity.cellKey,
        identity.databaseName,
        identity.roleName,
        identity.secretName,
        identity.stableIdentityHash,
        input.runtimeSecretRef,
        input.lifecycleStatus,
        input.baselineDigest,
        input.migrationContract,
        lifecycleEvidenceHash,
        JSON.stringify(input.evidence),
        input.lastError
          ? normalizeDeploymentError(
              input.lastError,
              "Tenant resource lifecycle operation failed.",
            )
          : null,
        eventType,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    const row = rows[0];
    if (!flag(row?.lease_owned)) return false;
    if (!flag(row?.persisted)) {
      return false;
    }
    return true;
  }

  async claimTenantResourceGeneration(input: {
    lease: Parameters<DeploymentExecutionRepository["claimTenantResourceGeneration"]>[0]["lease"];
    identity: TenantResourceIdentity;
    now: number;
  }): Promise<TenantResourceGenerationClaim> {
    await assertStableTenantResourceIdentity(input.identity);
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), candidate AS MATERIALIZED (
        SELECT deployment.id AS deployment_id,
          deployment.app_instance_id, deployment.environment_id,
          deployment.created_at AS candidate_created_at,
          instance.workspace_id, instance.product_id, environment.cell_key
        FROM app_instance_deployments deployment
        INNER JOIN app_instances instance
          ON instance.id = deployment.app_instance_id
        INNER JOIN deployment_environments environment
          ON environment.id = deployment.environment_id
        INNER JOIN deployment_jobs job
          ON job.id = $2 AND job.deployment_id = deployment.id
        CROSS JOIN db_clock
        WHERE deployment.id = $1
          AND job.status = 'running' AND job.lease_owner = $3
          AND job.lease_token = $14 AND job.attempts = $15
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF deployment, instance, environment, job
      ), existing AS MATERIALIZED (
        SELECT resource.*, owner.created_at AS owner_created_at,
          EXISTS (
            SELECT 1 FROM deployment_jobs previous_job
            WHERE previous_job.deployment_id = resource.owner_deployment_id
              AND previous_job.status = 'running'
              AND previous_job.lease_expires_at > db_clock.now_ms
          ) AS owner_has_live_job
        FROM deployment_tenant_resources resource
        INNER JOIN candidate
          ON candidate.app_instance_id = resource.app_instance_id
        INNER JOIN app_instance_deployments owner
          ON owner.id = resource.owner_deployment_id
        CROSS JOIN db_clock
        FOR UPDATE OF resource, owner
      ), decision AS MATERIALIZED (
        SELECT candidate.*,
          existing.app_instance_id AS existing_app_instance_id,
          existing.owner_deployment_id AS previous_owner_deployment_id,
          existing.generation AS previous_generation,
          existing.lifecycle_status AS previous_status,
          existing.owner_has_live_job,
          candidate.app_instance_id = $5
            AND candidate.environment_id = $6
            AND candidate.workspace_id = $7
            AND candidate.product_id = $8
            AND candidate.cell_key = $9
            AND (
              existing.app_instance_id IS NULL OR (
                existing.environment_id = $6
                AND existing.workspace_id = $7
                AND existing.product_id = $8
                AND existing.cell_key = $9
                AND existing.database_name = $10
                AND existing.role_name = $11
                AND existing.secret_name = $12
                AND existing.stable_identity_hash = $13
              )
            ) AS identity_matches,
          existing.owner_deployment_id = candidate.deployment_id AS same_owner,
          existing.app_instance_id IS NULL OR (
            candidate.candidate_created_at > existing.owner_created_at
            OR (
              candidate.candidate_created_at = existing.owner_created_at
              AND candidate.deployment_id > existing.owner_deployment_id
            )
          ) AS candidate_is_newer
        FROM candidate
        LEFT JOIN existing
          ON existing.app_instance_id = candidate.app_instance_id
      ), eligible AS MATERIALIZED (
        SELECT decision.*,
          CASE
            WHEN existing_app_instance_id IS NULL THEN 'created'
            WHEN same_owner THEN 'reused'
            WHEN previous_status = 'destroyed' THEN 'reopened'
            ELSE 'reused'
          END AS claim_outcome,
          CASE
            WHEN existing_app_instance_id IS NULL THEN 'claimed'
            WHEN same_owner THEN NULL
            WHEN previous_status = 'destroyed' THEN 'reopened'
            -- Deliberately unreachable until a two-phase external ownership
            -- epoch protocol can be observed by DB, Role and Secret adapters.
            ELSE 'handed_off'
          END AS claim_event_type,
          CASE
            WHEN previous_status = 'destroyed' AND NOT same_owner
              THEN previous_generation + 1
            ELSE COALESCE(previous_generation, 1)
          END AS claimed_generation,
          CASE
            WHEN previous_status = 'destroyed' AND NOT same_owner
              THEN 'reopening'
            ELSE COALESCE(previous_status, 'planned')
          END AS claimed_status
        FROM decision
        WHERE identity_matches
          AND (
            existing_app_instance_id IS NULL
            OR same_owner
            OR (
              previous_status = 'destroyed'
              AND candidate_is_newer
              AND NOT owner_has_live_job
            )
          )
      ), created AS (
        INSERT INTO deployment_tenant_resources (
          app_instance_id, created_by_deployment_id, owner_deployment_id,
          generation, stable_identity_hash, environment_id, workspace_id,
          product_id, cell_key, database_name, role_name, secret_name,
          runtime_secret_ref, ownership_marker, lifecycle_status,
          baseline_digest, migration_contract, evidence_hash, evidence,
          last_error, created_at, updated_at, destroyed_at
        )
        SELECT app_instance_id, deployment_id, deployment_id, 1, $13,
          environment_id, workspace_id, product_id, cell_key,
          $10, $11, $12, NULL,
          'tl_owner_' || substring($13 FROM 1 FOR 32) || '_g1',
          'planned', NULL, NULL, NULL, '{}', NULL, $4, $4, NULL
        FROM eligible WHERE existing_app_instance_id IS NULL
        ON CONFLICT (app_instance_id) DO NOTHING
        RETURNING *
      ), handed_off AS (
        UPDATE deployment_tenant_resources resource
        SET owner_deployment_id = eligible.deployment_id,
          generation = eligible.claimed_generation,
          ownership_marker = 'tl_owner_'
            || substring(resource.stable_identity_hash FROM 1 FOR 32)
            || '_g' || eligible.claimed_generation::text,
          lifecycle_status = eligible.claimed_status,
          runtime_secret_ref = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN NULL
            ELSE resource.runtime_secret_ref END,
          baseline_digest = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN NULL
            ELSE resource.baseline_digest END,
          migration_contract = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN NULL
            ELSE resource.migration_contract END,
          evidence_hash = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN NULL
            ELSE resource.evidence_hash END,
          evidence = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN '{}'
            ELSE resource.evidence END,
          last_error = NULL, updated_at = $4,
          destroyed_at = CASE
            WHEN eligible.claim_event_type = 'reopened' THEN NULL
            ELSE resource.destroyed_at END
        FROM eligible
        WHERE eligible.existing_app_instance_id = resource.app_instance_id
          AND NOT eligible.same_owner
          AND resource.owner_deployment_id = eligible.previous_owner_deployment_id
          AND resource.generation = eligible.previous_generation
        RETURNING resource.*
      ), reused AS (
        SELECT resource.*
        FROM deployment_tenant_resources resource
        INNER JOIN eligible
          ON eligible.existing_app_instance_id = resource.app_instance_id
        WHERE eligible.same_owner
          AND resource.owner_deployment_id = eligible.deployment_id
          AND resource.generation = eligible.claimed_generation
      ), claimed_resource AS (
        SELECT * FROM created
        UNION ALL SELECT * FROM handed_off
        UNION ALL SELECT * FROM reused
      ), claim_result AS MATERIALIZED (
        SELECT resource.*, eligible.claim_outcome, eligible.claim_event_type,
          eligible.previous_owner_deployment_id
        FROM claimed_resource resource
        INNER JOIN eligible
          ON eligible.app_instance_id = resource.app_instance_id
      ), event_insert AS (
        INSERT INTO deployment_tenant_resource_events (
          id, app_instance_id, generation, deployment_id, event_type,
          from_status, to_status, evidence_hash, evidence, created_at
        )
        SELECT 'trevt:' || result.app_instance_id || ':'
            || result.generation::text || ':' || $1 || ':'
            || result.claim_event_type,
          result.app_instance_id, result.generation, $1,
          result.claim_event_type, eligible.previous_status,
          result.lifecycle_status, NULL,
          jsonb_build_object(
            'previousOwnerDeploymentId', result.previous_owner_deployment_id
          )::text,
          $4
        FROM claim_result result
        INNER JOIN eligible ON eligible.app_instance_id = result.app_instance_id
        WHERE result.claim_event_type IS NOT NULL
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      ), prior_claim AS (
        SELECT event.evidence::jsonb ->> 'previousOwnerDeploymentId'
          AS previous_owner_deployment_id
        FROM deployment_tenant_resource_events event
        INNER JOIN claim_result result
          ON result.app_instance_id = event.app_instance_id
          AND result.generation = event.generation
        WHERE result.claim_event_type IS NULL
          AND event.deployment_id = $1
          AND event.event_type IN ('claimed', 'handed_off', 'reopened')
        ORDER BY event.created_at, event.id
        LIMIT 1
      )
      SELECT
        result.app_instance_id AS tenant_resource_app_instance_id,
        result.created_by_deployment_id
          AS tenant_resource_created_by_deployment_id,
        result.owner_deployment_id AS tenant_resource_owner_deployment_id,
        result.generation AS tenant_resource_generation,
        result.stable_identity_hash AS tenant_resource_stable_identity_hash,
        result.environment_id AS tenant_resource_environment_id,
        result.workspace_id AS tenant_resource_workspace_id,
        result.product_id AS tenant_resource_product_id,
        result.cell_key AS tenant_resource_cell_key,
        result.database_name AS tenant_resource_database_name,
        result.role_name AS tenant_resource_role_name,
        result.secret_name AS tenant_resource_secret_name,
        result.runtime_secret_ref AS tenant_resource_runtime_secret_ref,
        result.ownership_marker AS tenant_resource_ownership_marker,
        result.lifecycle_status AS tenant_resource_lifecycle_status,
        result.baseline_digest AS tenant_resource_baseline_digest,
        result.migration_contract AS tenant_resource_migration_contract,
        result.evidence_hash AS tenant_resource_evidence_hash,
        result.evidence AS tenant_resource_evidence,
        result.last_error AS tenant_resource_last_error,
        result.created_at AS tenant_resource_created_at,
        result.updated_at AS tenant_resource_updated_at,
        result.destroyed_at AS tenant_resource_destroyed_at,
        result.claim_outcome,
        CASE WHEN result.claim_event_type IS NULL
          THEN (SELECT previous_owner_deployment_id FROM prior_claim)
          ELSE result.previous_owner_deployment_id
        END AS previous_owner_deployment_id,
        (SELECT count(*) FROM event_insert) AS inserted_event_count,
        decision.identity_matches, decision.candidate_is_newer,
        decision.owner_has_live_job, decision.previous_status
      FROM decision
      LEFT JOIN claim_result result ON true`,
      [
        input.lease.deploymentId,
        input.lease.jobId,
        input.lease.workerId,
        input.now,
        input.identity.appInstanceId,
        input.identity.environmentId,
        input.identity.workspaceId,
        input.identity.productId,
        input.identity.cellKey,
        input.identity.databaseName,
        input.identity.roleName,
        input.identity.secretName,
        input.identity.stableIdentityHash,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error("Deployment lease was lost."), {
        code: "DEPLOYMENT_LEASE_LOST",
        retryable: true,
      });
    }
    const record = tenantResourceRecord(row);
    if (!record) {
      if (!flag(row.identity_matches)) {
        throw Object.assign(
          new Error("Persisted tenant resource identity cannot be changed."),
          { code: "TENANT_RESOURCE_IDENTITY_MISMATCH", retryable: false },
        );
      }
      if (flag(row.owner_has_live_job)) {
        throw Object.assign(
          new Error("Previous tenant resource owner still has a live lease."),
          { code: "TENANT_RESOURCE_OWNER_LEASE_ACTIVE", retryable: true },
        );
      }
      if (!flag(row.candidate_is_newer)) {
        throw Object.assign(
          new Error("An older deployment cannot reclaim tenant resources."),
          { code: "TENANT_RESOURCE_STALE_DEPLOYMENT", retryable: false },
        );
      }
      if (
        nullableText(row.previous_status) !== null &&
        nullableText(row.previous_status) !== "destroyed"
      ) {
        throw Object.assign(
          new Error(
            "Existing tenant resources cannot hand off until an externally observable ownership-epoch protocol is implemented.",
          ),
          {
            code: "TENANT_RESOURCE_HANDOFF_REQUIRES_OWNERSHIP_EPOCH",
            retryable: false,
          },
        );
      }
      throw Object.assign(
        new Error("Tenant resource generation is currently fenced for cleanup."),
        { code: "TENANT_RESOURCE_GENERATION_CLAIM_REJECTED", retryable: true },
      );
    }
    await assertStableTenantResourceIdentity(record.identity);
    const fence: TenantResourceFence = {
      schemaVersion: 1,
      identity: record.identity,
      generation: record.generation,
      ownerDeploymentId: record.ownerDeploymentId,
      ownershipMarker: record.ownershipMarker,
    };
    await assertTenantResourceFenceInput(fence);
    return {
      outcome: text(row.claim_outcome) as TenantResourceGenerationClaim["outcome"],
      previousOwnerDeploymentId: nullableText(row.previous_owner_deployment_id),
      fence,
      record,
    };
  }

  async beginTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: Parameters<DeploymentExecutionRepository["beginTenantResourceCleanup"]>[0]["lease"];
    now: number;
  }): Promise<TenantResourceFence | null> {
    await assertTenantResourceFenceInput(input.fence);
    const identity = input.fence.identity;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), leased_deployment AS MATERIALIZED (
        SELECT deployment.id
        FROM app_instance_deployments deployment
        INNER JOIN deployment_jobs job
          ON job.id = $2 AND job.deployment_id = deployment.id
        CROSS JOIN db_clock
        WHERE deployment.id = $1
          AND job.status = 'running' AND job.lease_owner = $3
          AND job.lease_token = $16 AND job.attempts = $17
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF deployment, job
      ), locked_resource AS MATERIALIZED (
        SELECT resource.* FROM deployment_tenant_resources resource
        INNER JOIN leased_deployment leased
          ON leased.id = resource.owner_deployment_id
        WHERE resource.app_instance_id = $5
        FOR UPDATE OF resource
      ), updated AS (
        UPDATE deployment_tenant_resources resource
        SET lifecycle_status = 'destroying', last_error = NULL, updated_at = $4
        FROM locked_resource locked
        WHERE resource.app_instance_id = locked.app_instance_id
          AND resource.owner_deployment_id = $1
          AND resource.generation = $6
          AND resource.ownership_marker = $7
          AND resource.stable_identity_hash = $8
          AND resource.environment_id = $9
          AND resource.workspace_id = $10
          AND resource.product_id = $11
          AND resource.cell_key = $12
          AND resource.database_name = $13
          AND resource.role_name = $14
          AND resource.secret_name = $15
          AND resource.lifecycle_status <> 'destroyed'
        RETURNING resource.app_instance_id, resource.generation,
          resource.owner_deployment_id, resource.lifecycle_status
      ), already_completed AS (
        SELECT locked.app_instance_id
        FROM locked_resource locked
        WHERE locked.owner_deployment_id = $1
          AND locked.generation = $6
          AND locked.ownership_marker = $7
          AND locked.stable_identity_hash = $8
          AND locked.environment_id = $9
          AND locked.workspace_id = $10
          AND locked.product_id = $11
          AND locked.cell_key = $12
          AND locked.database_name = $13
          AND locked.role_name = $14
          AND locked.secret_name = $15
          AND locked.lifecycle_status = 'destroyed'
      ), event_insert AS (
        INSERT INTO deployment_tenant_resource_events (
          id, app_instance_id, generation, deployment_id, event_type,
          from_status, to_status, evidence_hash, evidence, created_at
        )
        SELECT 'trevt:' || updated.app_instance_id || ':'
            || updated.generation::text || ':' || $1 || ':cleanup_started',
          updated.app_instance_id, updated.generation, $1, 'cleanup_started',
          locked.lifecycle_status, 'destroying', NULL, '{}', $4
        FROM updated
        INNER JOIN locked_resource locked
          ON locked.app_instance_id = updated.app_instance_id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM leased_deployment) AS lease_owned,
        (
          EXISTS (SELECT 1 FROM updated)
          OR EXISTS (SELECT 1 FROM already_completed)
        ) AS acquired,
        (SELECT count(*) FROM event_insert) AS event_count`,
      [
        input.fence.ownerDeploymentId,
        input.lease.jobId,
        input.lease.workerId,
        input.now,
        identity.appInstanceId,
        input.fence.generation,
        input.fence.ownershipMarker,
        identity.stableIdentityHash,
        identity.environmentId,
        identity.workspaceId,
        identity.productId,
        identity.cellKey,
        identity.databaseName,
        identity.roleName,
        identity.secretName,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return flag(rows[0]?.lease_owned) && flag(rows[0]?.acquired)
      ? input.fence
      : null;
  }

  async assertTenantResourceCleanupFence(input: {
    fence: TenantResourceFence;
    lease: Parameters<DeploymentExecutionRepository["assertTenantResourceCleanupFence"]>[0]["lease"];
    phase: Parameters<
      DeploymentExecutionRepository["assertTenantResourceCleanupFence"]
    >[0]["phase"];
    now: number;
  }): Promise<boolean> {
    await assertTenantResourceFenceInput(input.fence);
    const identity = input.fence.identity;
    const rows = await query(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
         SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
       )
       SELECT resource.app_instance_id
       FROM deployment_tenant_resources resource
       INNER JOIN deployment_jobs job
         ON job.id = $1 AND job.deployment_id = resource.owner_deployment_id
       CROSS JOIN db_clock
       WHERE resource.app_instance_id = $2
         AND resource.owner_deployment_id = $3
         AND resource.generation = $4
         AND resource.ownership_marker = $5
         AND resource.stable_identity_hash = $6
         AND resource.environment_id = $7
         AND resource.workspace_id = $8
         AND resource.product_id = $9
         AND resource.cell_key = $10
         AND resource.database_name = $11
         AND resource.role_name = $12
         AND resource.secret_name = $13
         AND resource.lifecycle_status IN ('destroying', 'destroyed')
         AND job.status = 'running' AND job.lease_owner = $14
         AND job.lease_token = $15 AND job.attempts = $16
         AND job.lease_expires_at > db_clock.now_ms
       LIMIT 1`,
      [
        input.lease.jobId,
        identity.appInstanceId,
        input.fence.ownerDeploymentId,
        input.fence.generation,
        input.fence.ownershipMarker,
        identity.stableIdentityHash,
        identity.environmentId,
        identity.workspaceId,
        identity.productId,
        identity.cellKey,
        identity.databaseName,
        identity.roleName,
        identity.secretName,
        input.lease.workerId,
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    void input.phase;
    return rows.length === 1;
  }

  async completeTenantResourceCleanup(input: {
    fence: TenantResourceFence;
    lease: Parameters<DeploymentExecutionRepository["completeTenantResourceCleanup"]>[0]["lease"];
    receipt: TenantResourceCleanupReceipt;
    now: number;
  }): Promise<boolean> {
    await assertTenantResourceFenceInput(input.fence);
    await assertTenantResourceFenceInput(input.receipt.fence);
    if (
      !sameTenantResourceFence(input.receipt.fence, input.fence) ||
      input.receipt.order.join(",") !== "workload,database,secret" ||
      !["deleted", "already_missing"].includes(input.receipt.workloadOutcome) ||
      !["deleted", "already_missing"].includes(input.receipt.databaseOutcome) ||
      !["deleted", "already_missing"].includes(input.receipt.secretOutcome) ||
      !/^[a-f0-9]{64}$/.test(input.receipt.databaseEvidenceHash)
    ) {
      throw Object.assign(new Error("Tenant cleanup receipt is invalid."), {
        code: "TENANT_RESOURCE_CLEANUP_RECEIPT_INVALID",
      });
    }
    const evidence = {
      order: [...input.receipt.order],
      workloadOutcome: input.receipt.workloadOutcome,
      databaseOutcome: input.receipt.databaseOutcome,
      secretOutcome: input.receipt.secretOutcome,
      databaseEvidenceHash: input.receipt.databaseEvidenceHash,
    };
    assertSafeTenantResourceEvidence(evidence);
    const evidenceHash = await sha256Hex(evidence);
    const identity = input.fence.identity;
    const rows = await query<Record<string, unknown>>(
      this.sql,
      `WITH db_clock AS MATERIALIZED (
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      ), leased_deployment AS MATERIALIZED (
        SELECT deployment.id
        FROM app_instance_deployments deployment
        INNER JOIN deployment_jobs job
          ON job.id = $2 AND job.deployment_id = deployment.id
        CROSS JOIN db_clock
        WHERE deployment.id = $1
          AND job.status = 'running' AND job.lease_owner = $3
          AND job.lease_token = $18 AND job.attempts = $19
          AND job.lease_expires_at > db_clock.now_ms
        FOR UPDATE OF deployment, job
      ), locked_resource AS MATERIALIZED (
        SELECT resource.* FROM deployment_tenant_resources resource
        INNER JOIN leased_deployment leased
          ON leased.id = resource.owner_deployment_id
        WHERE resource.app_instance_id = $5
        FOR UPDATE OF resource
      ), updated AS (
        UPDATE deployment_tenant_resources resource
        SET lifecycle_status = 'destroyed', runtime_secret_ref = NULL,
          evidence_hash = $16, evidence = $17, last_error = NULL,
          updated_at = $4, destroyed_at = COALESCE(resource.destroyed_at, $4)
        FROM locked_resource locked
        WHERE resource.app_instance_id = locked.app_instance_id
          AND resource.owner_deployment_id = $1
          AND resource.generation = $6
          AND resource.ownership_marker = $7
          AND resource.stable_identity_hash = $8
          AND resource.environment_id = $9
          AND resource.workspace_id = $10
          AND resource.product_id = $11
          AND resource.cell_key = $12
          AND resource.database_name = $13
          AND resource.role_name = $14
          AND resource.secret_name = $15
          AND resource.lifecycle_status IN ('destroying', 'destroyed')
        RETURNING resource.app_instance_id, resource.generation,
          resource.lifecycle_status
      ), event_insert AS (
        INSERT INTO deployment_tenant_resource_events (
          id, app_instance_id, generation, deployment_id, event_type,
          from_status, to_status, evidence_hash, evidence, created_at
        )
        SELECT 'trevt:' || updated.app_instance_id || ':'
            || updated.generation::text || ':' || $1 || ':destroyed:' || $16,
          updated.app_instance_id, updated.generation, $1, 'destroyed',
          locked.lifecycle_status, 'destroyed', $16, $17, $4
        FROM updated
        INNER JOIN locked_resource locked
          ON locked.app_instance_id = updated.app_instance_id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM leased_deployment) AS lease_owned,
        EXISTS (SELECT 1 FROM updated) AS completed,
        (SELECT count(*) FROM event_insert) AS event_count`,
      [
        input.fence.ownerDeploymentId,
        input.lease.jobId,
        input.lease.workerId,
        input.now,
        identity.appInstanceId,
        input.fence.generation,
        input.fence.ownershipMarker,
        identity.stableIdentityHash,
        identity.environmentId,
        identity.workspaceId,
        identity.productId,
        identity.cellKey,
        identity.databaseName,
        identity.roleName,
        identity.secretName,
        evidenceHash,
        JSON.stringify(evidence),
        input.lease.leaseToken,
        input.lease.attempt,
      ],
    );
    return flag(rows[0]?.lease_owned) && flag(rows[0]?.completed);
  }
}
