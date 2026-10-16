import type { prepareExpressInitializedWorkerV2 } from './express-initialized-worker-v2.ts';
import type { DeploymentJobLeaseFence, TenantExternalOperationFence } from './contracts.ts';
import { assertTenantResourceFence } from './tenant-database.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import { EXPRESS_DELIVERY_IMAGES_V2 } from './express-delivery-images-v2.ts';
import { awsSandboxTenantStackName } from '../cloudformation/tenant-stack.ts';

type Material = Awaited<ReturnType<typeof prepareExpressInitializedWorkerV2>>['material'];
type Row = Record<string, unknown>;
export interface ExpressInitializedSnapshotV2 {
  deployment: Row; app: Row; workspace: Row; subscription: Row; environment: Row;
  predecessorJob: Row; resource: Row; operation: Row; templateVersion: Row;
}
export interface ExpressInitializedJobPlanV2 {
  schema: 'techlong/express-initialized-job/v2';
  material: Material; materialSha256: string; snapshot: ExpressInitializedSnapshotV2;
  externalFence: TenantExternalOperationFence; requestId: string;
  jobId: string; dedupeKey: string; workerId: 'express-initialized-single-job-v2';
  preparedAt: number; claimBy: number; deadline: number; leaseDurationMs: number;
  planSha256: string;
}
export interface InitializedJobStatementV2 { key: string; text: string; values: unknown[] }
export interface ExpressInitializedCompletionProofV2 {
  materialSha256: string; jobId: string; leaseToken: string;
  stackId: string; workloadExpiresAt: number; imageUri: string; configurationHash: string;
  existingDefaultStoreId: string; epoch: number; operationHash: string;
  providerObservationSha256: string; providerCheckedAt: number;
  authorityObservationSha256: string; authorityCheckedAt: number;
  controlObservationSha256: string; controlCheckedAt: number;
  initializedVerified: true; effectiveConfigurationVerified: true;
}
const workerId = 'express-initialized-single-job-v2' as const;
const clock = '(extract(epoch FROM clock_timestamp())*1000)::bigint';
function fail(): never { throw Object.assign(Error('EXPRESS_INITIALIZED_JOB_REJECTED'), { retryable: false }); }
function object(value: unknown): Row {
  const v = typeof value === 'string' ? JSON.parse(value) : value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
  return v as Row;
}
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function digest(v: unknown): v is string { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v); }
function time(v: number) { if (!Number.isSafeInteger(v) || v <= 0) fail(); }
function same(a: unknown, b: unknown) { if (canonicalJson(a) !== canonicalJson(b)) fail(); }

/** Pure preparation only. The snapshot must come from a separate live read;
 * it is NOT authority to deploy. Full-row CAS preserves old ready attribution,
 * old successful job and initialized resources, including unknown fields. */
export async function prepareExpressInitializedJobV2(raw: {
  material: Material; materialSha256: string; snapshot: ExpressInitializedSnapshotV2;
  externalFence: TenantExternalOperationFence; requestId: string; now: number; deadline: number;
}): Promise<ExpressInitializedJobPlanV2> {
  const x = structuredClone(raw), m = x.material, s = m.scope, b = m.binding, n = x.snapshot;
  const d = n.deployment, a = n.app, sub = n.subscription, e = n.environment, r = n.resource, o = n.operation, j = n.predecessorJob;
  time(x.now); time(x.deadline); assertTenantResourceFence(x.externalFence.resourceFence);
  const f = x.externalFence, rf = f.resourceFence, i = rf.identity;
  same(m.images, EXPRESS_DELIVERY_IMAGES_V2);
  if (m.schema !== 'techlong/express-initialized-worker/v2' || await sha256Hex(m) !== x.materialSha256 ||
      !digest(x.requestId) || x.deadline - x.now < 30 * 60000 || x.deadline - x.now > 2 * 3600000 ||
      d.id !== s.ownerDeploymentId || d.app_instance_id !== s.appInstanceId || d.environment_id !== s.environmentId ||
      d.status !== 'ready' || d.current_step !== 'ready' || !Number.isSafeInteger(d.ready_at) ||
      d.mode !== 'aws_sandbox' || d.cell_key !== s.cellKey || d.plan_hash !== m.planSha256 ||
      d.configuration_hash !== m.configurationSha256 || d.artifact_ref !== m.images.app ||
      await sha256Hex(object(d.desired_plan)) !== m.planSha256 ||
      a.id !== s.appInstanceId || a.workspace_id !== s.workspaceId || a.product_id !== s.productId ||
      a.template_version_id !== s.templateVersionId || a.status !== 'active' ||
      a.access_url !== 'https://' + m.tenantHostname || await sha256Hex(object(a.configuration_snapshot)) !== m.configurationSha256 ||
      n.workspace.id !== s.workspaceId || n.workspace.status !== 'active' ||
      sub.id !== d.subscription_id || sub.id !== a.subscription_id || sub.workspace_id !== s.workspaceId ||
      sub.product_id !== s.productId || sub.template_version_id !== s.templateVersionId || sub.status !== 'active' ||
      typeof sub.current_period_end !== 'number' || sub.current_period_end <= x.now ||
      n.templateVersion.id !== s.templateVersionId || n.templateVersion.status !== 'published' ||
      await sha256Hex(object(n.templateVersion.configuration_schema)) !== m.configurationSchemaSha256 ||
      e.id !== s.environmentId || e.status !== 'active' || e.apply_enabled !== 0 || e.admission_state !== 'open' ||
      e.admission_epoch !== 0 || e.admission_stack_id !== null || e.kind !== 'aws_sandbox' ||
      e.expected_account_id !== '402010193138' || e.region !== 'ca-central-1' || e.cell_key !== s.cellKey ||
      j.deployment_id !== d.id || j.job_type !== 'apply' || j.status !== 'succeeded' ||
      j.lease_owner !== null || j.lease_token !== null || j.lease_expires_at !== null ||
      typeof j.id !== 'string' || !/^job_[a-f0-9]{24}$/.test(j.id) ||
      f.schemaVersion !== 1 || f.state !== 'active' || f.intent !== 'provision' ||
      f.ownerDeploymentId !== d.id || rf.ownerDeploymentId !== d.id || rf.generation !== b.resourceGeneration ||
      i.stableIdentityHash !== b.stableIdentity || i.appInstanceId !== a.id || i.workspaceId !== s.workspaceId ||
      i.productId !== s.productId || i.environmentId !== e.id || i.cellKey !== s.cellKey ||
      i.databaseName !== b.tenantDatabase || i.roleName !== b.tenantUsername ||
      !Number.isSafeInteger(f.epoch) || f.epoch < 1 || !digest(f.operationHash) ||
      f.marker !== `tl_epoch_${b.stableIdentity.slice(0, 24)}_g${rf.generation}_e${f.epoch}` ||
      r.app_instance_id !== a.id || r.owner_deployment_id !== d.id || r.created_by_deployment_id !== d.id ||
      r.generation !== rf.generation || r.lifecycle_status !== 'verified' || r.destroyed_at !== null ||
      r.stable_identity_hash !== i.stableIdentityHash || r.environment_id !== e.id || r.workspace_id !== s.workspaceId ||
      r.product_id !== s.productId || r.cell_key !== s.cellKey || r.database_name !== i.databaseName ||
      r.role_name !== i.roleName || r.secret_name !== i.secretName || r.runtime_secret_ref !== b.runtimeSecret.arn ||
      r.ownership_marker !== rf.ownershipMarker || !digest(r.evidence_hash) || r.external_operation_epoch !== f.epoch ||
      o.app_instance_id !== a.id || o.generation !== r.generation || o.epoch !== f.epoch ||
      o.owner_deployment_id !== d.id || o.stable_identity_hash !== b.stableIdentity || o.state !== 'active' ||
      o.intent !== 'provision' || o.operation_hash !== f.operationHash || o.marker !== f.marker || o.created_by_job_id !== j.id) fail();
  same(object(e.policy), m.environment.policy); same(object(d.desired_plan), m.plan);
  const jobId = 'job_' + (await sha256Hex({ purpose: 'express-initialized-job/v2',
    deploymentId: d.id, materialSha256: x.materialSha256, requestId: x.requestId })).slice(0, 24);
  const outputs = object(d.outputs), history = object(outputs.expressInitializedWorkerRunsV2 ?? {});
  if (jobId === j.id || Object.hasOwn(history, jobId)) fail();
  const body = { schema: 'techlong/express-initialized-job/v2' as const, material: m, materialSha256: x.materialSha256,
    snapshot: n, externalFence: f, requestId: x.requestId, jobId,
    dedupeKey: 'express-initialized-v2:' + x.requestId, workerId,
    preparedAt: x.now, claimBy: x.now + 15 * 60000, deadline: x.deadline, leaseDurationMs: 20 * 60000 };
  return freeze({ ...body, planSha256: await sha256Hex(body) });
}

async function validate(p: ExpressInitializedJobPlanV2) {
  const rebuilt = await prepareExpressInitializedJobV2({ material: p.material, materialSha256: p.materialSha256,
    snapshot: p.snapshot, externalFence: p.externalFence, requestId: p.requestId, now: p.preparedAt, deadline: p.deadline });
  same(p, rebuilt);
}
function payload(p: ExpressInitializedJobPlanV2) {
  return canonicalJson({ kind: 'express_initialized_workload_v2', planSha256: p.planSha256,
    materialSha256: p.materialSha256, requestId: p.requestId, initializationPostAllowed: false });
}
function lease(p: ExpressInitializedJobPlanV2, l: DeploymentJobLeaseFence) {
  if (l.jobId !== p.jobId || l.deploymentId !== p.material.scope.ownerDeploymentId || l.workerId !== workerId ||
      l.attempt !== 1 || !/^lease_[a-f0-9]{32}$/.test(l.leaseToken)) fail();
}
function lockedSnapshot(p: ExpressInitializedJobPlanV2, lockRows = true): InitializedJobStatementV2 {
  // Fixed table/alias list, never table names supplied by a caller. Exact rows
  // are parameter values. All locks survive to commit of the enclosing tx.
  const rows = [
    ['deployment_environments', 'e', 'id', p.snapshot.environment],
    ['workspaces', 'w', 'id', p.snapshot.workspace],
    ['subscriptions', 'sub', 'id', p.snapshot.subscription],
    ['app_instances', 'a', 'id', p.snapshot.app],
    ['app_instance_template_versions', 't', 'id', p.snapshot.templateVersion],
    ['app_instance_deployments', 'd', 'id', p.snapshot.deployment],
    ['deployment_jobs', 'oldj', 'id', p.snapshot.predecessorJob],
    ['deployment_tenant_resources', 'r', 'app_instance_id', p.snapshot.resource],
    ['deployment_tenant_external_operations', 'o', 'app_instance_id', p.snapshot.operation],
  ] as const;
  const values: unknown[] = rows.map(([, , , row]) => canonicalJson(row));
  values.push(p.deadline);
  return { key: 'lock_unchanged_initialized_coordinate', values, text: `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
    SELECT d.id FROM ${rows.map(([table, alias]) => `public.${table} ${alias}`).join(', ')}
    WHERE ${rows.map(([, alias, key], k) => `${alias}.${key}=($${k + 1}::jsonb->>'${key}') AND to_jsonb(${alias})=$${k + 1}::jsonb` +
      (alias === 'o' ? ` AND o.generation=($${k + 1}::jsonb->>'generation')::bigint AND o.epoch=($${k + 1}::jsonb->>'epoch')::bigint` : '')).join(' AND ')}
      AND sub.current_period_end>${clock} AND ${clock}<$10
    ${lockRows ? 'FOR UPDATE OF ' + rows.map(([, alias]) => alias).join(',') : ''}) locked` };
}
function liveJob(p: ExpressInitializedJobPlanV2, l: DeploymentJobLeaseFence, lockRows = true): InitializedJobStatementV2 {
  return { key: 'require_live_new_lease', text: `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
    SELECT id FROM public.deployment_jobs WHERE id=$1 AND deployment_id=$2 AND job_type='reconcile'
      AND status='running' AND lease_owner=$3 AND lease_token=$4 AND attempts=1 AND max_attempts=1
      AND payload::jsonb=$5::jsonb AND dedupe_key=$6 AND lease_expires_at>${clock}
      AND lease_expires_at<=$7 AND ${clock}<$7 ${lockRows ? 'FOR UPDATE' : ''}) locked`,
  values: [l.jobId, l.deploymentId, l.workerId, l.leaseToken, payload(p), p.dedupeKey, p.deadline] };
}
async function program(statements: InitializedJobStatementV2[]) {
  return { isolationLevel: 'Serializable' as const, statements, automaticRetries: 0,
    programSha256: await sha256Hex({ statements, isolationLevel: 'Serializable' }) };
}

/** One INSERT, no queue scanning, takeover, upsert, heartbeat or old-job edit.
 * Both time admission and lease expiry use the database clock. */
export async function compileExpressInitializedClaimV2(input: {
  plan: ExpressInitializedJobPlanV2; approvedPlanSha256: string; leaseToken: string;
}) {
  const p = structuredClone(input.plan); await validate(p);
  if (input.approvedPlanSha256 !== p.planSha256 || !/^lease_[a-f0-9]{32}$/.test(input.leaseToken)) fail();
  const l = { jobId: p.jobId, deploymentId: p.material.scope.ownerDeploymentId, workerId, attempt: 1, leaseToken: input.leaseToken };
  return { ...await program([lockedSnapshot(p), {
    key: 'require_unused_slot_and_no_active_sibling', text: `SELECT 1 / CASE WHEN
      ${clock}>=$4 AND ${clock}<$5 AND $6-${clock}>=300000
      AND NOT EXISTS(SELECT 1 FROM public.deployment_jobs WHERE id=$1 OR dedupe_key=$2 OR
        (deployment_id=$3 AND status IN ('pending','running','retry_wait')))
      THEN 1 ELSE 0 END AS accepted`, values: [p.jobId, p.dedupeKey, l.deploymentId, p.preparedAt, p.claimBy, p.deadline],
  }, {
    key: 'insert_one_new_running_job', text: `WITH db_clock AS MATERIALIZED (SELECT ${clock} AS now_ms), inserted AS (
      INSERT INTO public.deployment_jobs(id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,
        available_at,lease_owner,lease_token,lease_expires_at,created_at,updated_at)
      SELECT $1,$2,'reconcile',$3,'running',$4,1,1,now_ms,$5,$6,LEAST(now_ms+$7,$8),now_ms,now_ms FROM db_clock
      WHERE now_ms>=$9 AND now_ms<$10 AND $8-now_ms>=300000 RETURNING id,lease_expires_at)
      SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted, max(lease_expires_at) AS lease_expires_at FROM inserted`,
    values: [p.jobId, l.deploymentId, p.dedupeKey, payload(p), workerId, l.leaseToken, p.leaseDurationMs, p.deadline, p.preparedAt, p.claimBy],
  }]), lease: l };
}
export async function compileExpressInitializedLeaseCheckV2(p: ExpressInitializedJobPlanV2, l: DeploymentJobLeaseFence) {
  const plan = structuredClone(p), incarnation = structuredClone(l);
  await validate(plan); lease(plan, incarnation); return program([lockedSnapshot(plan, false), liveJob(plan, incarnation, false)]);
}
export function assertExpressInitializedStackIdV2(p: ExpressInitializedJobPlanV2, stackId: string) {
  const prefix = 'arn:aws:cloudformation:ca-central-1:402010193138:stack/' + awsSandboxTenantStackName(p.material.scope.appInstanceId) + '/';
  if (typeof stackId !== 'string' || !stackId.startsWith(prefix) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(stackId.slice(prefix.length))) fail();
}

/** ONE atomic tx updates only this deployment's outputs/updated_at and the
 * new job. Ready status/time, app, resource/epoch, old job and receipts stay put.
 * Evidence is data from the future trusted provider/control root, not an
 * authorization or a claim that this compiler performed live verification. */
export async function compileExpressInitializedCompleteV2(input: {
  plan: ExpressInitializedJobPlanV2; lease: DeploymentJobLeaseFence;
  proof: ExpressInitializedCompletionProofV2; now: number;
}) {
  const { plan: p, lease: l, proof: proof } = structuredClone(input); await validate(p); lease(p, l); time(input.now);
  assertExpressInitializedStackIdV2(p, proof.stackId);
  const proofKeys = ['materialSha256', 'jobId', 'leaseToken', 'stackId', 'workloadExpiresAt', 'imageUri', 'configurationHash',
    'existingDefaultStoreId', 'epoch', 'operationHash', 'providerObservationSha256', 'providerCheckedAt',
    'authorityObservationSha256', 'authorityCheckedAt', 'controlObservationSha256', 'controlCheckedAt',
    'initializedVerified', 'effectiveConfigurationVerified'];
  same(Object.keys(proof).sort(), proofKeys.sort());
  const m = p.material, f = p.externalFence;
  if (proof.materialSha256 !== p.materialSha256 || proof.jobId !== p.jobId || proof.leaseToken !== l.leaseToken ||
      proof.imageUri !== m.images.app || proof.configurationHash !== m.configurationSha256 ||
      proof.existingDefaultStoreId !== m.existingDefaultStoreId || proof.epoch !== f.epoch || proof.operationHash !== f.operationHash ||
      proof.initializedVerified !== true || proof.effectiveConfigurationVerified !== true ||
      !Number.isSafeInteger(proof.workloadExpiresAt) || proof.workloadExpiresAt <= input.now || input.now >= p.deadline) fail();
  for (const [checked, hash] of [[proof.providerCheckedAt, proof.providerObservationSha256],
    [proof.authorityCheckedAt, proof.authorityObservationSha256], [proof.controlCheckedAt, proof.controlObservationSha256]] as const) {
    if (!Number.isSafeInteger(checked) || checked < p.preparedAt || checked > input.now || input.now - checked > 30000 || !digest(hash)) fail();
  }
  const { leaseToken: _token, ...publicProof } = proof; void _token; // Never persist the lease capability in outputs.
  const receipt = { ...publicProof, jobPlanSha256: p.planSha256, completedBy: workerId };
  const before = object(p.snapshot.deployment.outputs), history = object(before.expressInitializedWorkerRunsV2 ?? {});
  const outputs = canonicalJson({ ...before, expressInitializedWorkerRunsV2: { ...history,
    [p.jobId]: receipt } });
  if (new TextEncoder().encode(outputs).byteLength > 32768) fail();
  const freshness = Math.min(proof.providerCheckedAt, proof.authorityCheckedAt, proof.controlCheckedAt);
  const lastChecked = Math.max(proof.providerCheckedAt, proof.authorityCheckedAt, proof.controlCheckedAt);
  return { ...await program([lockedSnapshot(p), liveJob(p, l), {
    key: 'append_initialized_worker_receipt', text: `WITH changed AS (
      UPDATE public.app_instance_deployments SET outputs=$2,updated_at=${clock} WHERE id=$1
        AND ${clock}>=$5 AND ${clock}-$3<=30000 AND ${clock}<$4 RETURNING id)
      SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM changed`,
    values: [l.deploymentId, outputs, freshness, proof.workloadExpiresAt, lastChecked],
  }, {
    key: 'complete_only_new_job', text: `WITH changed AS (
      UPDATE public.deployment_jobs SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
        completed_at=${clock},updated_at=${clock} WHERE id=$1 AND deployment_id=$2 AND status='running'
        AND lease_owner=$3 AND lease_token=$4 AND attempts=1 AND max_attempts=1 AND lease_expires_at>${clock}
        AND ${clock}<$5 AND ${clock}<$6 RETURNING id)
      SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM changed`,
    values: [p.jobId, l.deploymentId, l.workerId, l.leaseToken, p.deadline, proof.workloadExpiresAt],
  }]), outputs, receiptSha256: await sha256Hex(receipt) };
}

export function verifyExpressInitializedCompletionReadbackV2(input: {
  plan: ExpressInitializedJobPlanV2; snapshot: ExpressInitializedSnapshotV2; job: Row | null; expectedOutputs: string;
}) {
  const { plan: p, snapshot: actual, job } = input;
  for (const key of Object.keys(p.snapshot) as (keyof ExpressInitializedSnapshotV2)[]) {
    if (key !== 'deployment') same(actual[key], p.snapshot[key]);
  }
  const { outputs: _oldOutputs, updated_at: _oldUpdated, ...oldD } = p.snapshot.deployment; void _oldOutputs; void _oldUpdated;
  const { outputs: actualOutputs, updated_at: actualUpdated, ...newD } = actual.deployment;
  same(newD, oldD); same(object(actualOutputs), object(input.expectedOutputs));
  if (!Number.isSafeInteger(actualUpdated) || !job || job.id !== p.jobId || job.deployment_id !== p.material.scope.ownerDeploymentId ||
      job.job_type !== 'reconcile' || job.status !== 'succeeded' || job.dedupe_key !== p.dedupeKey ||
      job.payload !== payload(p) || job.attempts !== 1 || job.max_attempts !== 1 || job.lease_owner !== null ||
      job.lease_token !== null || job.lease_expires_at !== null || !Number.isSafeInteger(job.completed_at)) fail();
  return { outcome: 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED' as const, retryAllowed: false, initializationPostAllowed: false };
}
