import { env } from 'cloudflare:workers';
import { neon } from '@neondatabase/serverless';
import { getDatabase } from '@/db';
import { getLatestAppInstanceDeployment } from './management';
import { INITIALIZED_PLATFORM_SCOPE, InitializedRequestError, initializedRequestsEnabled,
  prepareInitializedPlatformRequest, projectInitializedDeployment } from './initialized-platform-request-v1';
import { projectDeploymentProgress } from './deployment-progress-v1';
import { getArchivedDeploymentEvidence } from './deployment-progress-evidence';
import {REQUEST_WINDOW_BINDING_V6,requestWindowShapeV6,verifiedRequestWindowV6,createReviewedRequestFenceV6} from './reviewed-request-window-v6.ts';

function binding(name: string): unknown {
  const value = (env as unknown as Record<string, unknown>)[name];
  return value === undefined && typeof process !== 'undefined' ? process.env[name] : value;
}
const reviewedFence=createReviewedRequestFenceV6();
const reviewedRaw=()=>binding(REQUEST_WINDOW_BINDING_V6);
const reviewedActive=()=>typeof reviewedRaw()==='string'&&reviewedRaw()!=='';
export function initializedPlatformRequestOrigin(){return reviewedActive()?'http://127.0.0.1:3100':null;}
export function initializedPlatformRequestGateEnabled() { return initializedRequestsEnabled(binding('AWS_INITIALIZED_REQUESTS_ENABLED'))&&
  (!reviewedActive()||requestWindowShapeV6(reviewedRaw(),Date.now())!==null); }
async function load(instanceId: string) {
  const deployment = await getLatestAppInstanceDeployment(instanceId);
  const jobs = deployment ? (await getDatabase().prepare(`SELECT id,deployment_id,status,payload,created_at,completed_at
    FROM deployment_jobs WHERE deployment_id=? AND job_type='reconcile'
      AND payload::jsonb->>'kind' IN ('express_initialized_request_v4','express_initialized_workload_v2')
    ORDER BY created_at DESC,id DESC LIMIT 12`).bind(deployment.id).all<Record<string, unknown>>()).results : [];
  return { deployment, jobs, gateEnabled: initializedPlatformRequestGateEnabled(), now: Date.now() };
}
export async function getInitializedPlatformStatus(instanceId: string) {
  if (instanceId !== INITIALIZED_PLATFORM_SCOPE.appInstanceId) return { ...projectInitializedDeployment({ deployment: null,
    jobs: [], gateEnabled: false, now: Date.now() }).view, progress: null };
  const current = await load(instanceId), projected = projectInitializedDeployment(current);
  const progress = await projectDeploymentProgress({ ...projected, instanceId, deploymentId: current.deployment?.id ?? '',
    archive: await getArchivedDeploymentEvidence(), now: current.now });
  const reviewed=reviewedActive()?await verifiedRequestWindowV6(reviewedRaw(),Date.now()):null;
  return { ...projected.view, progress,reviewedRequest:reviewed?{clientRequestId:reviewed.clientRequestId,jobId:reviewed.jobId,expiresAt:reviewed.expiresAt}:null };
}
export async function submitInitializedPlatformRequest(input: { instanceId: string; adminUserId: string; body: unknown }) {
  // Default OFF and check before any query/credential read. Shipping code must
  // not silently enable queue writes; activation needs its own reviewed scope.
  if (!initializedPlatformRequestGateEnabled()) throw new InitializedRequestError('INITIALIZED_REQUESTS_DISABLED', '平台请求写入口尚未批准开启。');
  if (input.instanceId !== INITIALIZED_PLATFORM_SCOPE.appInstanceId) throw new InitializedRequestError('INITIALIZED_REQUEST_SCOPE', '该实例不在已验收的单租户范围。');
  const reviewed=reviewedActive()?await reviewedFence.begin(reviewedRaw(),input.adminUserId,input.body,Date.now()):null;
  const current = await load(input.instanceId);
  if (!current.deployment) throw new InitializedRequestError('DEPLOYMENT_NOT_FOUND', '没有找到部署记录。', 404);
  const prepared = await prepareInitializedPlatformRequest({ ...current, deployment: current.deployment, body: input.body, adminUserId: input.adminUserId });
  if (prepared.existingJobId) return { jobId: prepared.existingJobId, created: false, cloudExecutionAuthorized: false };
  const p = prepared.program!;
  if(reviewed){
    if(p.jobId!==reviewed.jobId)throw new InitializedRequestError('REVIEWED_REQUEST_JOB_MISMATCH','目标任务不符合受审清单。');
    await reviewedFence.assertLive(reviewedRaw(),reviewed,Date.now());
  }
  const configured = binding('DATABASE_URL');
  if (typeof configured !== 'string') throw new InitializedRequestError('REQUEST_DATABASE_UNAVAILABLE', '数据库配置不可用。', 503);
  const url = new URL(configured);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') ||
    !['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''))
    throw new InitializedRequestError('REQUEST_DATABASE_UNAVAILABLE', '数据库 TLS 配置不正确。', 503);
  try {
    const sql = neon(configured, { fullResults: true });
    const [result] = await sql.transaction(tx => [tx.query(p.text, p.values)], {
      isolationLevel: 'Serializable', readOnly: false, fetchOptions: { signal: AbortSignal.timeout(15000) },
    });
    if (result.rowCount !== 1) throw new InitializedRequestError('REQUEST_NOT_INSERTED', '记录已变化或已有待审任务，请刷新列表核对，不要换请求标识重试。');
    return { jobId: p.jobId, created: true, cloudExecutionAuthorized: false };
  } catch (e) {
    if (e instanceof InitializedRequestError) throw e;
    // No auto retry, including serialization/network/ambiguous commit errors.
    throw new InitializedRequestError('REQUEST_REQUIRES_READBACK', '提交结果需要只读核对。请刷新任务列表，不要再次提交。', 503);
  }
}
