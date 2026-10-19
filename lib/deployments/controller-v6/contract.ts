import { canonicalJson, sha256Hex } from '../execution/hash.ts';

export const CONTROL_SCOPE = Object.freeze({ instanceId: 'app_e897a4377bce498b9c5ee9e64509dcad',
  deploymentId: 'dep_7c99bd249470184852f0dc74', repository: 'veinyyxy/TechlongSoftware',
  repositoryId: '1323312747', ownerId: '14145707', appId: '5381160', installationId: '173033406',
  candidateBotId: '344813947', workflowFile: 'cloud-worker-platform-v6.yml',
  databaseRole: 'techlong_deployment_controller_v6',
  completedJob: 'job_ecbf09030d3da7286ea3ef93',
  stackName: 'techlong-sandbox-tenant-9c5ee9e64509dcad', region: 'ca-central-1' });
export const MODES = ['Review', 'RunOnce', 'Inspect'] as const;
export type Mode = typeof MODES[number];
export class ControlError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
export function must(ok: unknown, code: string, status = 409): asserts ok { if (!ok) throw new ControlError(code, status); }
export const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const commit = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
export function obj(v: unknown): Record<string, unknown> {
  must(v && typeof v === 'object' && !Array.isArray(v), 'CONTROL_OBJECT', 400); return v as Record<string, unknown>;
}
export function keys(v: Record<string, unknown>, expected: string[]) {
  must(Object.keys(v).sort().join(',') === [...expected].sort().join(','), 'CONTROL_FIELDS', 400);
}
export interface ReleaseBinding {
  state: 'UNPUBLISHED' | 'PUBLISHED'; workflowId: string | null; actorId: string | null;
  reusableCommit: string | null; closureSha256: string | null; identityProofSha256: string | null;
  installationSha256: string | null; riskSha256: string | null;
}
// This is deliberately not an environment variable. Publishing this binding is
// a separate reviewed change; setting a boolean alone cannot activate routes.
export const PLATFORM_RELEASE: Readonly<ReleaseBinding> = Object.freeze({ state: 'UNPUBLISHED',
  workflowId: null, actorId: null, reusableCommit: null, closureSha256: null,
  identityProofSha256: null, installationSha256: null, riskSha256: null });
export function releaseReady(r: ReleaseBinding): boolean {
  return r.state === 'PUBLISHED' && typeof r.workflowId === 'string' && /^[1-9][0-9]{0,15}$/.test(r.workflowId) &&
    r.actorId === CONTROL_SCOPE.candidateBotId && commit(r.reusableCommit) && digest(r.closureSha256) &&
    digest(r.identityProofSha256) && digest(r.installationSha256) && digest(r.riskSha256);
}
export type Inputs = { mode: Mode; job: string; installation: string; manifest: string; manifestSha: string; execution: string; lineage: string };
export interface ControlPlan {
  schema: 'techlong/platform-controller-plan/v6'; instanceId: string; deploymentId: string;
  jobId: string; mode: Mode; sourceCommit: string; releaseSha256: string; riskSha256: string;
  preparedAt: number; expiresAt: number; inputs: Inputs;
  predecessor: null | { planSha256: string; runId: string; proofSha256: string };
}
export function effects(mode: Mode) { return { createStackCalls: mode === 'RunOnce' ? 1 : 0,
  resourcesMax: mode === 'RunOnce' ? 7 : 0, jobClaims: mode === 'RunOnce' ? 1 : 0,
  authenticatedApplicationGets: mode === 'RunOnce' ? 2 : 0, humanEnvironmentApprovalRequired: true }; }
const prefix = `worker-v5/${CONTROL_SCOPE.instanceId}/`;
function reference(text: unknown) {
  must(typeof text === 'string' && text.length > 0 && text.length <= 1800, 'CONTROL_REFERENCE');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new ControlError('CONTROL_REFERENCE'); }
  const r = obj(value); keys(r, ['key','sha256','versionId']);
  must(typeof r.key === 'string' && r.key.startsWith(prefix) && /^[A-Za-z0-9/_.-]+$/.test(r.key) && !r.key.includes('..') &&
    digest(r.sha256) && typeof r.versionId === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId), 'CONTROL_REFERENCE');
  return r;
}
export async function validatePlan(value: unknown, r: ReleaseBinding, now: number): Promise<{ plan: ControlPlan; planSha256: string; actionSha256: string }> {
  must(releaseReady(r), 'CONTROL_RELEASE_UNPUBLISHED');
  const p = obj(value); keys(p, ['schema','instanceId','deploymentId','jobId','mode','sourceCommit','releaseSha256','riskSha256','preparedAt','expiresAt','inputs','predecessor']);
  must(p.schema === 'techlong/platform-controller-plan/v6' && p.instanceId === CONTROL_SCOPE.instanceId && p.deploymentId === CONTROL_SCOPE.deploymentId &&
    typeof p.jobId === 'string' && /^job_[a-f0-9]{24}$/.test(p.jobId) && p.jobId !== CONTROL_SCOPE.completedJob &&
    MODES.includes(p.mode as Mode) && commit(p.sourceCommit) && p.releaseSha256 === await sha256Hex(r) && p.riskSha256 === r.riskSha256,
  'CONTROL_PLAN_SCOPE');
  must(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(p.preparedAt) && Number(p.preparedAt) > 0 && Number.isSafeInteger(p.expiresAt) &&
    Number(p.preparedAt) <= now && now < Number(p.expiresAt) && Number(p.expiresAt) - Number(p.preparedAt) <= 7200000,
  'CONTROL_PLAN_EXPIRED');
  const i = obj(p.inputs); keys(i, ['mode','job','installation','manifest','manifestSha','execution','lineage']);
  must(i.mode === p.mode && i.job === p.jobId, 'CONTROL_INPUT_SCOPE');
  must(reference(i.installation).key === prefix + `installation/${r.installationSha256}.json`, 'CONTROL_INSTALLATION');
  if (i.lineage !== '') reference(i.lineage);
  if (p.mode === 'Review') must(i.manifest === '' && i.manifestSha === '' && i.execution === '' && p.predecessor === null, 'CONTROL_REVIEW_SCOPE');
  else {
    must(digest(i.manifestSha) && reference(i.manifest).key === prefix + `${p.jobId}/${i.manifestSha}/manifest.json`, 'CONTROL_MANIFEST');
    const previous = obj(p.predecessor); keys(previous, ['planSha256','runId','proofSha256']);
    must(digest(previous.planSha256) && digest(previous.proofSha256) && typeof previous.runId === 'string' && /^[1-9][0-9]{0,15}$/.test(previous.runId), 'CONTROL_PREDECESSOR');
    if (p.mode === 'RunOnce') must(i.execution === '', 'CONTROL_RUN_SCOPE');
    else must(reference(i.execution).key === prefix + `${p.jobId}/${i.manifestSha}/execution-reference-${previous.runId}-v1.json`, 'CONTROL_EXECUTION_REFERENCE');
  }
  const plan = structuredClone(p) as unknown as ControlPlan;
  return { plan, planSha256: await sha256Hex(plan), actionSha256: await sha256Hex({ action: 'single_workflow_dispatch', plan, effects: effects(plan.mode) }) };
}
export type Action = { operation: 'approve_and_dispatch'; planSha256: string; actionSha256: string; riskSha256: string } |
  { operation: 'observe'; planSha256: string };
export function parseAction(value: unknown): Action {
  const v = obj(value); must(v.operation === 'approve_and_dispatch' || v.operation === 'observe', 'CONTROL_OPERATION', 400);
  keys(v, v.operation === 'observe' ? ['operation','planSha256'] : ['operation','planSha256','actionSha256','riskSha256']);
  must(digest(v.planSha256) && (v.operation === 'observe' || (digest(v.actionSha256) && digest(v.riskSha256))), 'CONTROL_APPROVAL_SHA', 400);
  return v as unknown as Action;
}
export function assertExact(value: unknown, expected: unknown, code: string) { must(canonicalJson(value) === canonicalJson(expected), code); }
