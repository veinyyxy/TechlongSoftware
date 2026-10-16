import { EXPRESS_DELIVERY_IMAGES_V2 } from './execution/express-delivery-images-v2.ts';
import { canonicalJson, sha256Hex } from './execution/hash.ts';

/** Approval hold, not a scheduler timestamp. Generic queue workers cannot pick
 * up this pending job. Only a separately reviewed exact-job claim may release it. */
export const INITIALIZED_REVIEW_HOLD_AT = Number.MAX_SAFE_INTEGER;
export const INITIALIZED_PLATFORM_SCOPE = Object.freeze({
  appInstanceId: 'app_e897a4377bce498b9c5ee9e64509dcad', deploymentId: 'dep_7c99bd249470184852f0dc74',
  workspaceId: 'ws_ac46ffc6778f44f5a4b5332c41bb9f33', productId: 'prd_restaurant_order_system',
  environmentId: 'env_aws_sandbox_ca_central_1', cellKey: 'cell-sandbox-1',
  materialSha256: '8fa2b5c1cfe441ca6c95771046209e03c8ced91b8cdf0e7948c1c44c55da0313',
  planHash: '8690c22f5b4dbf80d49bcee3cdff717dd8ae14957eedb7606b9829b533e49dc8',
  configurationHash: '06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9',
  artifactRef: EXPRESS_DELIVERY_IMAGES_V2.app,
  existingDefaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87', epoch: 1,
  operationHash: '3545b14293b00e381a54148b2adcff9340253d9a95ea02a27f4582256df81a90',
});
type Row = Record<string, unknown>;
export class InitializedRequestError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
const object = (value: unknown): Row | null => {
  try { const v = typeof value === 'string' ? JSON.parse(value) : value;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
  } catch { return null; }
};
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
export function initializedRequestsEnabled(value: unknown): boolean { return value === 'true'; }
export function parseInitializedRequestBody(body: unknown) {
  const v = body && typeof body === 'object' && !Array.isArray(body) ? body as Row : null;
  if (!v || Object.keys(v).sort().join(',') !== 'clientRequestId,deploymentId,intent' ||
      !uuid(v.clientRequestId) || v.deploymentId !== INITIALIZED_PLATFORM_SCOPE.deploymentId || v.intent !== 'restore_initialized_workload')
    throw new InitializedRequestError('INVALID_INITIALIZED_REQUEST', '请求范围不正确；不能指定镜像、配置、凭据或云操作。', 400);
  return { clientRequestId: v.clientRequestId, deploymentId: v.deploymentId, intent: v.intent };
}
export interface InitializedDeploymentProjection {
  id: string; appInstanceId: string; environmentId: string; mode: string; status: string;
  planHash: string; configurationHash: string | null; artifactRef: string | null; outputs: Row;
}
export interface InitializedJobSummary {
  id: string; status: string; phase: 'awaiting_review' | 'running' | 'succeeded' | 'stopped';
  requestedAt: number; completedAt: number | null;
}
/** Allowlisted UI model. It never exposes raw outputs, payloads, leases or
 * secrets. A saved proof is explicitly NOT a live AWS health check. */
export function projectInitializedDeployment(input: {
  deployment: InitializedDeploymentProjection | null; jobs: Row[]; gateEnabled: boolean; now: number;
}) {
  const d = input.deployment, s = INITIALIZED_PLATFORM_SCOPE;
  const supported = Boolean(d && d.id === s.deploymentId && d.appInstanceId === s.appInstanceId && d.environmentId === s.environmentId &&
    d.mode === 'aws_sandbox' && d.status === 'ready' && d.planHash === s.planHash && d.configurationHash === s.configurationHash && d.artifactRef === s.artifactRef);
  const jobs: InitializedJobSummary[] = input.jobs.flatMap(row => {
    const p = object(row.payload);
    if (row.deployment_id !== s.deploymentId || !/^job_[a-f0-9]{24}$/.test(String(row.id)) ||
      !['express_initialized_request_v4', 'express_initialized_workload_v2'].includes(String(p?.kind))) return [];
    return [{ id: String(row.id), status: String(row.status), phase: row.status === 'pending' ? 'awaiting_review' as const :
      row.status === 'running' ? 'running' as const : row.status === 'succeeded' ? 'succeeded' as const : 'stopped' as const,
    requestedAt: Number(row.created_at), completedAt: row.completed_at === null ? null : Number(row.completed_at) }];
  });
  let state: 'unsupported' | 'unverified' | 'verified_window_open' | 'expired' = supported ? 'unverified' : 'unsupported';
  let latest: { jobId: string; checkedAt: number; expiresAt: number; stackId: string; imageRevision: string } | null = null;
  let rawReceipt: Row | null = null;
  const history = object(d?.outputs.expressInitializedWorkerRunsV2);
  if (supported && history && Object.keys(history).length) {
    const entries = Object.entries(history);
    const valid = entries.every(([id, value]) => {
      const r = object(value); return r && /^job_[a-f0-9]{24}$/.test(id) && r.jobId === id &&
        r.materialSha256 === s.materialSha256 && r.configurationHash === s.configurationHash && r.imageUri === s.artifactRef &&
        r.existingDefaultStoreId === s.existingDefaultStoreId && r.epoch === s.epoch && r.operationHash === s.operationHash &&
        r.completedBy === 'express-initialized-single-job-v2' &&
        r.initializedVerified === true && r.effectiveConfigurationVerified === true && digest(r.jobPlanSha256) &&
        digest(r.controlObservationSha256) && digest(r.providerObservationSha256) && digest(r.authorityObservationSha256) &&
        Number.isSafeInteger(r.controlCheckedAt) && Number.isSafeInteger(r.workloadExpiresAt) &&
        Number(r.workloadExpiresAt) > Number(r.controlCheckedAt) && Number(r.controlCheckedAt) <= input.now &&
        /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-tenant-9c5ee9e64509dcad\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(r.stackId));
    });
    if (valid) {
      const [id, value] = entries.sort((a, b) => Number(object(b[1])!.controlCheckedAt) - Number(object(a[1])!.controlCheckedAt) || b[0].localeCompare(a[0]))[0];
      const r = object(value)!, row = input.jobs.find(j => j.id === id), p = object(row?.payload);
      if (row?.status === 'succeeded' && row.deployment_id === s.deploymentId && p?.kind === 'express_initialized_workload_v2' &&
          p.planSha256 === r.jobPlanSha256 && p.materialSha256 === s.materialSha256) {
        rawReceipt = r; latest = { jobId: id, checkedAt: Number(r.controlCheckedAt), expiresAt: Number(r.workloadExpiresAt),
          stackId: String(r.stackId), imageRevision: s.artifactRef.split('@')[1] };
        state = input.now >= latest.expiresAt ? 'expired' : 'verified_window_open';
      }
    }
  }
  const activeRequest = jobs.some(j => j.phase === 'awaiting_review' || j.phase === 'running');
  const canRequest = supported && state === 'expired' && !activeRequest && input.gateEnabled;
  const reason = !supported ? '当前入口只支持已验收的独立 sandbox 已初始化租户。' : !input.gateEnabled ? '平台请求写入口尚未批准开启。' :
    activeRequest ? '已有待审或运行中的请求，不能重复提交。' : state === 'verified_window_open' ? '现有承载窗口尚未到期，不创建重复恢复请求。' :
      state !== 'expired' ? '没有与成功 job 匹配的有效初始化回执，不能创建恢复请求。' : '可创建待审请求；这不会创建 AWS 资源。';
  return { view: { supported, state, latest, jobs, canRequest, requestGateEnabled: input.gateEnabled,
    liveCloudChecked: false, globalQueueEnabled: false, reason }, rawReceipt };
}

export async function prepareInitializedPlatformRequest(input: {
  deployment: InitializedDeploymentProjection; jobs: Row[]; gateEnabled: boolean;
  body: unknown; adminUserId: string; now: number;
}) {
  input = structuredClone(input);
  if (!input.gateEnabled) throw new InitializedRequestError('INITIALIZED_REQUESTS_DISABLED', '请求写入口尚未批准开启。');
  const body = parseInitializedRequestBody(input.body), s = INITIALIZED_PLATFORM_SCOPE;
  if (!/^usr_[A-Za-z0-9_-]{3,120}$/.test(input.adminUserId) || !Number.isSafeInteger(input.now))
    throw new InitializedRequestError('INITIALIZED_REQUEST_SCOPE', '管理员或时间范围不正确。', 400);
  const requestId = await sha256Hex({ purpose: 'platform-initialized-request/v1', clientRequestId: body.clientRequestId,
    adminUserId: input.adminUserId, scope: s });
  const jobId = 'job_' + (await sha256Hex({ purpose: 'express-initialized-job/v2', deploymentId: s.deploymentId,
    materialSha256: s.materialSha256, requestId })).slice(0, 24);
  const projected = projectInitializedDeployment(input);
  if (!projected.view.supported) throw new InitializedRequestError('INITIALIZED_REQUEST_SCOPE', projected.view.reason);
  // Exact repeated client ID may inspect its existing result, never overwrite it.
  const existing = input.jobs.find(j => j.id === jobId);
  if (existing) return { existingJobId: jobId, requestId, program: null };
  if (!projected.view.canRequest || !projected.rawReceipt || !projected.view.latest)
    throw new InitializedRequestError('INITIALIZED_REQUEST_NOT_ADMITTED', projected.view.reason);
  const payload = { kind: 'express_initialized_request_v4', requestId, requestedByUserId: input.adminUserId,
    requestedAt: input.now, scope: s, reviewRequired: true, cloudExecutionAuthorized: false };
  const values = [jobId, s.deploymentId, 'express-initialized-v2:' + requestId, canonicalJson(payload),
    INITIALIZED_REVIEW_HOLD_AT, input.adminUserId, s.appInstanceId, s.workspaceId, s.productId, s.environmentId,
    s.planHash, s.configurationHash, s.artifactRef, projected.view.latest.jobId, canonicalJson(projected.rawReceipt), canonicalJson(input.deployment.outputs)];
  const text = `WITH locked AS MATERIALIZED (
    SELECT d.id FROM public.app_instance_deployments d
    JOIN public.app_instances a ON a.id=d.app_instance_id
    JOIN public.workspaces w ON w.id=a.workspace_id
    JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id
    JOIN public.deployment_environments e ON e.id=d.environment_id
    JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
    JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
    JOIN public.deployment_jobs proof_job ON proof_job.id=$14 AND proof_job.deployment_id=d.id
    JOIN public.users u ON u.id=$6
    WHERE d.id=$2 AND d.app_instance_id=$7 AND a.workspace_id=$8 AND a.product_id=$9 AND d.environment_id=$10
      AND d.status='ready' AND d.plan_hash=$11 AND d.configuration_hash=$12 AND d.artifact_ref=$13
      AND d.mode='aws_sandbox' AND d.cell_key='cell-sandbox-1'
      AND a.status='active' AND w.status='active' AND sub.status='active' AND sub.current_period_end>(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND u.status='active' AND u.is_platform_admin=1 AND e.status='active' AND e.apply_enabled=0 AND e.admission_state='open'
      AND e.admission_epoch=0 AND e.admission_stack_id IS NULL AND e.kind='aws_sandbox'
      AND e.expected_account_id='402010193138' AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1'
      AND r.owner_deployment_id=d.id AND r.lifecycle_status='verified' AND r.destroyed_at IS NULL AND o.state='active' AND o.intent='provision'
      AND r.created_by_deployment_id=d.id AND r.generation=1 AND r.external_operation_epoch=1 AND o.owner_deployment_id=d.id
      AND o.operation_hash='3545b14293b00e381a54148b2adcff9340253d9a95ea02a27f4582256df81a90'
      AND proof_job.status='succeeded' AND proof_job.lease_token IS NULL AND proof_job.lease_owner IS NULL AND proof_job.lease_expires_at IS NULL
      AND proof_job.payload::jsonb->>'kind'='express_initialized_workload_v2'
      AND proof_job.payload::jsonb->>'planSha256'=$15::jsonb->>'jobPlanSha256'
      AND d.outputs::jsonb=$16::jsonb
      AND (d.outputs::jsonb->'expressInitializedWorkerRunsV2'->$14)=$15::jsonb
      AND ($15::jsonb->>'workloadExpiresAt')::bigint<=(extract(epoch FROM clock_timestamp())*1000)::bigint
    FOR UPDATE OF d,a,w,sub,e,r,o,proof_job,u
  ) INSERT INTO public.deployment_jobs(id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,
    available_at,created_at,updated_at)
    SELECT $1,locked.id,'reconcile',$3,'pending',$4,0,1,$5,
      (extract(epoch FROM clock_timestamp())*1000)::bigint,(extract(epoch FROM clock_timestamp())*1000)::bigint
    FROM locked WHERE NOT EXISTS(SELECT 1 FROM public.deployment_jobs WHERE deployment_id=$2 AND status IN ('pending','running','retry_wait'))
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
  return { existingJobId: null, requestId, program: { text, values, jobId, payload, isolationLevel: 'Serializable' as const } };
}
