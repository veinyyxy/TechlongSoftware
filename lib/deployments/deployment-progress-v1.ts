import type { projectInitializedDeployment } from './initialized-platform-request-v1.ts';
import { sha256Hex } from './execution/hash.ts';

type InitializedView = ReturnType<typeof projectInitializedDeployment>['view'];
type Row = Record<string, unknown>;
export type DeploymentStage = 'Review' | 'RunOnce' | 'Inspect';
export interface ArchivedDeploymentEvidence {
  jobId: string; appId: string; deploymentId: string; stackId: string; sourceCommit: string;
  cloudManifestSha256: string; receiptSha256: string; providerObservationSha256: string;
  inspectBodySha256: string; archivedDate: string;
  stages: { mode: DeploymentStage; runId: string; url: string; approvalSha256: string }[];
}
export interface DeploymentProgressView {
  state: 'awaiting_review' | 'running' | 'needs_attention' | 'awaiting_evidence' | 'verified';
  asOf: number; currentJobId: string | null; title: string; description: string;
  steps: { mode: DeploymentStage; status: 'verified' | 'waiting' | 'unknown'; detail: string; runId: string | null; url: string | null }[];
  archive: (ArchivedDeploymentEvidence & { checkedAt: number; expiresAt: number; isCurrentJob: boolean }) | null;
  liveCloudChecked: false; githubLiveChecked: false; canDispatch: false; canApprove: false; canRetry: false;
}
const object = (v: unknown): Row | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 8640000000000000;
const modes: DeploymentStage[] = ['Review', 'RunOnce', 'Inspect'];

/** Only allowlisted public fields leave this parser. Repository evidence is an
 * archive, not live GitHub status, deployment approval, or an AWS capability. */
export function normalizeArchivedDeploymentEvidence(value: unknown): ArchivedDeploymentEvidence | null {
  const r = object(value);
  if (!r || r.schema !== 'techlong/cloud-worker-controlled-deployment-executed/v5' ||
      r.state !== 'CONTROLLED_AWS_DEPLOYMENT_INDEPENDENTLY_VERIFIED' ||
      !/^job_[a-f0-9]{24}$/.test(String(r.jobId)) || !/^app_[a-f0-9]{32}$/.test(String(r.appId)) ||
      !/^dep_[a-f0-9]{24}$/.test(String(r.deploymentId)) || !/^[a-f0-9]{40}$/.test(String(r.sourceCommitAtExecution)) ||
      !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-tenant-9c5ee9e64509dcad\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(r.stackId)) ||
      !digest(r.cloudManifestSha256) || !digest(r.completionReceiptSha256) || !digest(r.providerObservationSha256) || !digest(r.inspectBodySha256) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(r.localDate)) || r.distinctExecutionAndInspectRunsVerified !== true ||
      !Array.isArray(r.stages) || r.stages.length !== 3) return null;
  const stages: ArchivedDeploymentEvidence['stages'] = [];
  for (const [index, raw] of r.stages.entries()) {
    const s = object(raw);
    if (!s || s.mode !== modes[index] || s.attempt !== 1 || s.conclusion !== 'success' ||
        !/^[1-9][0-9]{0,19}$/.test(String(s.runId)) || !digest(s.approvedManifestSha256)) return null;
    stages.push({ mode: modes[index], runId: String(s.runId),
      url: 'https://github.com/veinyyxy/TechlongSoftware/actions/runs/' + s.runId, approvalSha256: s.approvedManifestSha256 });
  }
  if (new Set(stages.map(s => s.runId)).size !== 3) return null;
  return { jobId: String(r.jobId), appId: String(r.appId), deploymentId: String(r.deploymentId), stackId: String(r.stackId),
    sourceCommit: String(r.sourceCommitAtExecution), cloudManifestSha256: r.cloudManifestSha256,
    receiptSha256: r.completionReceiptSha256, providerObservationSha256: r.providerObservationSha256,
    inspectBodySha256: r.inspectBodySha256, archivedDate: String(r.localDate), stages };
}

export async function projectDeploymentProgress(input: {
  view: InitializedView; rawReceipt: unknown; archive: ArchivedDeploymentEvidence | null;
  instanceId: string; deploymentId: string; now: number;
}): Promise<DeploymentProgressView | null> {
  const { view, now } = input;
  if (!view.supported) return null;
  if (!time(now)) throw new Error('PROGRESS_CLOCK_INVALID');
  const invalidJobs = view.jobs.some(j => !/^job_[a-f0-9]{24}$/.test(j.id) || !time(j.requestedAt) || j.requestedAt > now ||
    j.phase !== (j.status === 'pending' ? 'awaiting_review' : j.status === 'running' ? 'running' : j.status === 'succeeded' ? 'succeeded' : 'stopped') ||
    (j.phase === 'succeeded' && j.completedAt === null) ||
    (j.completedAt !== null && (!time(j.completedAt) || j.completedAt > now || j.completedAt < j.requestedAt)));
  const current = invalidJobs ? null : [...view.jobs].sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id))[0] ?? null;
  const a = input.archive, latest = view.latest, receipt = object(input.rawReceipt);
  let archive: DeploymentProgressView['archive'] = null;
  if (!invalidJobs && a && latest && receipt && a.appId === input.instanceId && a.deploymentId === input.deploymentId &&
      a.jobId === latest.jobId && receipt.jobId === a.jobId && a.stackId === latest.stackId &&
      time(latest.checkedAt) && time(latest.expiresAt) && latest.checkedAt <= now && latest.expiresAt > latest.checkedAt &&
      receipt.controlCheckedAt === latest.checkedAt && receipt.workloadExpiresAt === latest.expiresAt &&
      receipt.providerObservationSha256 === a.providerObservationSha256 && await sha256Hex(receipt) === a.receiptSha256 &&
      view.jobs.some(j => j.id === a.jobId && j.phase === 'succeeded' && j.status === 'succeeded')) {
    archive = { ...a, stages: a.stages.map(s => ({ ...s })), checkedAt: latest.checkedAt, expiresAt: latest.expiresAt, isCurrentJob: current?.id === a.jobId };
  }
  const state: DeploymentProgressView['state'] = invalidJobs || !current || current.phase === 'stopped' ? 'needs_attention' :
    current.phase === 'awaiting_review' ? 'awaiting_review' : current.phase === 'running' ? 'running' :
      archive?.isCurrentJob ? 'verified' : 'awaiting_evidence';
  const text = {
    verified: ['独立验收已归档', '三阶段历史证据已与当前数据库回执匹配；不代表实时在线，也不授权再次执行。'],
    awaiting_review: ['新任务待审', '尚未接入新任务的受审云计划；数据库 pending 不代表已经调度 GitHub。'],
    running: ['任务运行中，具体云阶段待核对', '仅有数据库运行状态，不能据此推断 Review 通过、资源就绪或验收完成。'],
    awaiting_evidence: ['任务记录已完成，独立验收证据待匹配', '数据库 succeeded 不能代替匹配当前任务的独立云验收归档。'],
    needs_attention: ['部署状态需要核对', '没有可安全匹配的当前任务状态；不回退旧成功，不自动重试。'],
  }[state];
  const steps: DeploymentProgressView['steps'] = modes.map(mode => {
    const s = state === 'verified' ? archive?.stages.find(x => x.mode === mode) : null;
    return { mode, status: s ? 'verified' : state === 'awaiting_review' && mode === 'Review' ? 'waiting' : 'unknown',
      detail: s ? '历史运行成功 · attempt 1' : state === 'awaiting_review' && mode === 'Review' ? '待准备与批准新清单' : '尚无匹配的阶段证据',
      runId: s?.runId ?? null, url: s?.url ?? null };
  });
  return { state, asOf: now, currentJobId: current?.id ?? null, title: text[0], description: text[1], steps, archive,
    liveCloudChecked: false, githubLiveChecked: false, canDispatch: false, canApprove: false, canRetry: false };
}

export function deploymentWindowLabel(expiresAt: number, now: number): string {
  if (!time(expiresAt) || !time(now)) return '时间不可用';
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (!seconds) return '标签时间已到期';
  return `${Math.floor(seconds / 3600)}小时${Math.floor(seconds / 60) % 60}分${seconds % 60}秒`;
}
