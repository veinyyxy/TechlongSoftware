import { neon } from "@neondatabase/serverless";
import { CellDrainCoordinatorError, type CellTtlCleanupJobProducer } from "./prepared-cell-drain-coordinator.ts";
import type { NeonSharedCellAdmissionFenceSqlClient } from "./neon-shared-cell-admission-fence.ts";

// The existing Worker owns leases/epochs, all destructive phases and final
// lifecycle state transitions. This producer INSERTs jobs only; no resets.
export const CELL_TTL_CLEANUP_JOBS_SQL = `WITH db_clock AS MATERIALIZED (
  SELECT (extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS now_ms
), locked_environment AS MATERIALIZED (
  SELECT environment.id FROM deployment_environments AS environment CROSS JOIN db_clock
  WHERE environment.id = $1 AND environment.kind = 'aws_sandbox' AND environment.driver = 'aws_ecs_cell'
    AND environment.expected_account_id = $2 AND environment.region = $3 AND environment.cell_key = $4
    AND environment.status = 'active' AND environment.admission_state = 'draining'
    AND environment.admission_epoch = $5 AND environment.admission_fence_sha256 = $6
    AND environment.admission_stack_id = $7 AND environment.admission_provision_operation_hash = $8
    AND environment.admission_cell_expires_at = $9 AND environment.admission_changed_at = $10
    AND environment.admission_cell_expires_at <= db_clock.now_ms
  FOR UPDATE OF environment
), targets AS MATERIALIZED (
  SELECT deployment.id, deployment.plan_hash,
    CASE WHEN deployment.status = 'ready' THEN 'cleanup' ELSE 'rollback' END AS job_type,
    CASE WHEN deployment.status = 'ready' THEN 'cleanup:' ELSE 'rollback:' END || deployment.id || ':' || deployment.plan_hash AS dedupe_key,
    '{"schemaVersion":1,"deploymentId":' || to_json(deployment.id)::text || ',"planHash":' || to_json(deployment.plan_hash)::text || '}' AS payload
  FROM deployment_tenant_resources AS resource
  INNER JOIN app_instance_deployments AS deployment ON deployment.id = resource.owner_deployment_id
    AND deployment.app_instance_id = resource.app_instance_id AND deployment.environment_id = resource.environment_id
  WHERE resource.environment_id = $1 AND resource.lifecycle_status <> 'destroyed'
    AND deployment.mode = 'aws_sandbox' AND deployment.driver = 'aws_ecs_cell' AND deployment.cell_key = $4
    AND deployment.status IN ('ready','failed','rollback_failed','cancel_requested','rolling_back','rolled_back','canceled')
    AND deployment.plan_hash ~ '^[a-f0-9]{64}$' AND EXISTS (SELECT 1 FROM locked_environment)
  ORDER BY deployment.id LIMIT 10 FOR UPDATE OF resource, deployment
), inserted AS (
  INSERT INTO deployment_jobs (id, deployment_id, job_type, dedupe_key, status, payload,
    attempts, max_attempts, available_at, created_at, updated_at)
  SELECT 'job_cellttl_' || md5(targets.dedupe_key), targets.id, targets.job_type, targets.dedupe_key,
    'pending', targets.payload, 0, 5, db_clock.now_ms, db_clock.now_ms, db_clock.now_ms
  FROM targets CROSS JOIN db_clock ON CONFLICT (dedupe_key) DO NOTHING RETURNING deployment_id
), existing AS MATERIALIZED (
  SELECT targets.id, job.status, job.attempts, job.max_attempts,
    job.deployment_id = targets.id AND job.job_type = targets.job_type AND job.payload = targets.payload AS exact
  FROM targets INNER JOIN deployment_jobs AS job ON job.dedupe_key = targets.dedupe_key
)
SELECT EXISTS (SELECT 1 FROM locked_environment) AS environment_matched,
  (SELECT count(*) FROM targets) AS target_count, (SELECT count(*) FROM inserted) AS inserted_count,
  (SELECT count(*) FROM existing WHERE exact AND status IN ('pending','running','retry_wait') AND attempts < max_attempts) AS active_count,
  (SELECT count(*) FROM targets) - (SELECT count(*) FROM inserted) -
    (SELECT count(*) FROM existing WHERE exact AND status IN ('pending','running','retry_wait') AND attempts < max_attempts) AS blocked_count,
  db_clock.now_ms AS db_observed_at FROM db_clock`;

export class NeonCellTtlCleanupJobProducer implements CellTtlCleanupJobProducer {
  private readonly sql: NeonSharedCellAdmissionFenceSqlClient;
  constructor(sql: NeonSharedCellAdmissionFenceSqlClient) { this.sql = sql; }
  async enqueueOwnedCleanupJobs({ drain, signal }: Parameters<CellTtlCleanupJobProducer["enqueueOwnedCleanupJobs"]>[0]) {
    signal.throwIfAborted();
    if (drain.schemaVersion !== 1 || drain.admissionState !== "draining" || drain.environmentId !== "env_aws_sandbox_ca_central_1" ||
      drain.accountId !== "402010193138" || drain.region !== "ca-central-1" || drain.cellId !== "cell-sandbox-1" ||
      !/^[a-f0-9]{64}$/.test(drain.admissionFenceSha256) || !Number.isSafeInteger(drain.admissionEpoch) || drain.admissionEpoch < 1 ||
      drain.databaseCellExpired !== true) throw new CellDrainCoordinatorError("CELL_TTL_JOBS_INPUT_INVALID");
    let result: unknown;
    try { result = await this.sql.query(CELL_TTL_CLEANUP_JOBS_SQL, [drain.environmentId, drain.accountId, drain.region, drain.cellId,
      drain.admissionEpoch, drain.admissionFenceSha256, drain.admissionStackId, drain.admissionProvisionOperationHash,
      drain.admissionCellExpiresAt, drain.admissionChangedAt], { fullResults: true, fetchOptions: { signal } }); }
    catch { throw new CellDrainCoordinatorError("CELL_TTL_JOBS_WRITE_UNCERTAIN"); }
    signal.throwIfAborted();
    const rows = (result as { rows?: Record<string, unknown>[] } | null)?.rows;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].environment_matched !== true) throw new CellDrainCoordinatorError("CELL_TTL_JOBS_FENCE_REJECTED");
    const row = rows[0];
    const numeric = (value: unknown) => typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? Number(value) : NaN;
    const counts = [row.inserted_count, row.active_count, row.blocked_count, row.target_count].map(numeric);
    const observed = numeric(row.db_observed_at);
    if (counts.some(v => !Number.isSafeInteger(v) || v < 0 || v > 10) || counts[0] + counts[1] + counts[2] !== counts[3] ||
      !Number.isSafeInteger(observed) || observed < drain.admissionChangedAt) throw new CellDrainCoordinatorError("CELL_TTL_JOBS_RECEIPT_INVALID");
    return Object.freeze({ schemaVersion: 1 as const, admissionFenceSha256: drain.admissionFenceSha256,
      insertedCount: counts[0], activeCount: counts[1], blockedCount: counts[2], targetCount: counts[3], dbObservedAt: observed });
  }
}
export function createNeonCellTtlCleanupJobProducer(databaseUrl: string) {
  const sql = neon(databaseUrl, { fullResults: true });
  return new NeonCellTtlCleanupJobProducer(sql as unknown as NeonSharedCellAdmissionFenceSqlClient);
}
