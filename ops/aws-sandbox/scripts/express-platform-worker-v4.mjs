// Exact platform-held job admission and review derivation. No AWS/private or
// database writer is available in this module; DB reads use READ ONLY txs.
import { neon } from '@neondatabase/serverless';
import { INITIALIZED_PLATFORM_SCOPE as S, INITIALIZED_REVIEW_HOLD_AT, projectInitializedDeployment } from '../../../lib/deployments/initialized-platform-request-v1.ts';
import { createExpressInitializedJobNeonV2 } from '../../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import { prepareExpressInitializedJobV2 } from '../../../lib/deployments/execution/express-initialized-job-v2.ts';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedLeaseCheckV4 } from '../../../lib/deployments/execution/express-platform-claim-v4.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { externalFenceFromSnapshotV3, freeze, same } from './express-initialized-workload-v3.mjs';

export const W4_RISK_FILE = 'docs/aws-auto-deployment-aurora-dual-mode-w4b-execution-review.md';
export const W4_ZERO_LEASE_TOKEN = 'lease_' + '0'.repeat(32); // template/readback ONLY, never a real claim token.
export const W4_EFFECTS = Object.freeze({ newJobs: 0, exactHeldJobClaims: 1, sourceCreateStackCalls: 1, childResources: 7, atomicCompletionRows: 2,
  iamWrites: 0, secretWrites: 0, authorityWrites: 0, dnsWrites: 0, auroraConnections: 0, automaticRetries: 0 });
export function requireW4(value, code) { if (!value) throw Error('PLATFORM_W4_' + code); }
const object = value => {
  try { const v = typeof value === 'string' ? JSON.parse(value) : value;
    requireW4(v && typeof v === 'object' && !Array.isArray(v), 'OBJECT'); return v;
  } catch { throw Error('PLATFORM_W4_EXACT_HELD_JOB_REQUIRED'); }
};
export function assertHeldPlatformJobV4(job, now) {
  requireW4(job && /^job_[a-f0-9]{24}$/.test(job.id) && job.deployment_id === S.deploymentId && job.job_type === 'reconcile' &&
    job.status === 'pending' && job.attempts === 0 && job.max_attempts === 1 && job.available_at === INITIALIZED_REVIEW_HOLD_AT &&
    job.lease_owner === null && job.lease_token === null && job.lease_expires_at === null && job.completed_at === null &&
    Number.isSafeInteger(job.created_at) && job.created_at <= now, 'EXACT_HELD_JOB_REQUIRED');
  const p = object(job.payload);
  requireW4(Object.keys(p).sort().join(',') === 'cloudExecutionAuthorized,kind,requestId,requestedAt,requestedByUserId,reviewRequired,scope' &&
    p.kind === 'express_initialized_request_v4' && /^[a-f0-9]{64}$/.test(p.requestId) && same(p.scope, S) && p.reviewRequired === true &&
    p.cloudExecutionAuthorized === false && /^usr_[A-Za-z0-9_-]{3,120}$/.test(p.requestedByUserId) &&
    Number.isSafeInteger(p.requestedAt) && p.requestedAt <= now &&
    job.dedupe_key === 'express-initialized-v2:' + p.requestId, 'EXACT_HELD_JOB_REQUIRED');
  return p;
}

/** Two bounded READ ONLY transactions. Never chooses/claims the next job.
 * Review requires an exact caller-supplied ID; Inspect supplies original actor. */
export function createPlatformWorkerReaderV4(databaseUrl) {
  const base = createExpressInitializedJobNeonV2(databaseUrl), sql = neon(databaseUrl, { fullResults: true });
  let completedReadOnlyTransactions = 0;
  return Object.freeze({
    async read(jobId, signal, originalRequesterId) {
      requireW4(/^job_[a-f0-9]{24}$/.test(jobId), 'EXACT_JOB_ID');
      const observed = await base.readSnapshot({ deploymentId: S.deploymentId, predecessorJobId: 'job_202c8dc12a8bf379f3a7c693', newJobId: jobId }, signal);
      completedReadOnlyTransactions++;
      const actor = originalRequesterId ?? assertHeldPlatformJobV4(observed.job, Date.now()).requestedByUserId;
      requireW4(/^usr_[A-Za-z0-9_-]{3,120}$/.test(actor), 'REQUESTER_ID');
      const [facts] = await sql.transaction(tx => [tx.query(`SELECT
        COALESCE((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.created_at,j.id) FROM public.deployment_jobs j WHERE j.deployment_id=$1),'[]'::jsonb) AS jobs,
        (SELECT jsonb_build_object('id',u.id,'status',u.status,'is_platform_admin',u.is_platform_admin) FROM public.users u WHERE u.id=$2) AS requester`,
      [S.deploymentId, actor])], { isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: { signal } });
      completedReadOnlyTransactions++;
      requireW4(facts.rowCount === 1 && Array.isArray(facts.rows[0].jobs), 'READ_FACTS');
      return { ...observed, ...facts.rows[0] };
    },
    counts: () => ({ completedReadOnlyTransactions }),
  });
}

export async function admitPlatformJobV4({ root, observed, predecessor, now }) {
  observed = structuredClone(observed); predecessor = structuredClone(predecessor);
  requireW4(Number.isSafeInteger(now) && Number.isSafeInteger(observed.checkedAt) && now >= observed.checkedAt &&
    now - observed.checkedAt < 30000, 'STALE_QUEUE_READ');
  const payload = assertHeldPlatformJobV4(observed.job, now), d = observed.snapshot.deployment;
  const requester = observed.requester;
  requireW4(requester?.id === payload.requestedByUserId && requester.status === 'active' && requester.is_platform_admin === 1, 'ACTIVE_REQUESTER_REQUIRED');
  requireW4(Array.isArray(observed.jobs) && observed.jobs.filter(j => ['pending', 'running', 'retry_wait'].includes(j.status)).length === 1 &&
    observed.jobs.some(j => same(j, observed.job)), 'ACTIVE_SIBLING_OR_QUEUE_DRIFT');
  const projection = projectInitializedDeployment({ deployment: { id: d.id, appInstanceId: d.app_instance_id,
    environmentId: d.environment_id, mode: d.mode, status: d.status, planHash: d.plan_hash,
    configurationHash: d.configuration_hash, artifactRef: d.artifact_ref, outputs: object(d.outputs) },
  jobs: observed.jobs, gateEnabled: false, now });
  requireW4(projection.view.state === 'expired' && projection.view.latest?.jobId === predecessor.jobId &&
    projection.view.latest.stackId === predecessor.stackId && await sha256Hex(projection.rawReceipt) === predecessor.receiptSha256 &&
    root.materialSha256 === S.materialSha256, 'LATEST_PREDECESSOR_NOT_EXPIRED_OR_NOT_BOUND');
  const proofJob = observed.jobs.find(j => j.id === predecessor.jobId);
  requireW4(proofJob?.lease_owner === null && proofJob.lease_token === null && proofJob.lease_expires_at === null, 'PROOF_JOB_LEASE');
  const jobPlan = await prepareExpressInitializedJobV2({ material: root.material, materialSha256: root.materialSha256,
    snapshot: observed.snapshot, externalFence: externalFenceFromSnapshotV3(observed.snapshot), requestId: payload.requestId, now, deadline: now + 3600000 });
  requireW4(jobPlan.jobId === observed.job.id, 'DETERMINISTIC_JOB_ID');
  const queuedJob = structuredClone(observed.job), claim = await compilePlatformInitializedClaimV4({ plan: jobPlan,
    queuedJob, approvedPlanSha256: jobPlan.planSha256, leaseToken: W4_ZERO_LEASE_TOKEN });
  const guard = await compilePlatformInitializedLeaseCheckV4(jobPlan, queuedJob, claim.lease);
  return freeze({ jobPlan, queue: { row: queuedJob, rowSha256: await sha256Hex(queuedJob), requester: structuredClone(requester),
    proofJob: structuredClone(proofJob), proofJobSha256: await sha256Hex(proofJob), observedAt: observed.checkedAt },
  programs: { claimTemplateSha256: claim.programSha256, leaseTemplateSha256: guard.programSha256,
    templateLeaseToken: W4_ZERO_LEASE_TOKEN,
    completionContractSha256: await sha256Hex({ schema: 'techlong/platform-completion-contract/v4', jobId: jobPlan.jobId,
      planSha256: jobPlan.planSha256, queuedRowSha256: await sha256Hex(queuedJob), retainedSuccessfulProofJobSha256: await sha256Hex(proofJob), columns: {
        app_instance_deployments: ['outputs', 'updated_at'], deployment_jobs: ['status', 'lease_owner', 'lease_token', 'lease_expires_at', 'completed_at', 'updated_at'] },
      freshProviderAuthorityAndTwoAuthenticatedGetsRequired: true, preserveExactPlatformProvenance: true, atomicUpdatedRows: 2,
      automaticRetries: 0, codeAndImportClosureBoundByManifest: true }) } });
}

export async function preparePlatformReviewV4({ admission, workload, binding, endpointSha256, preflight, predecessor, privateSource }) {
  requireW4(workload.jobPlanSha256 === admission.jobPlan.planSha256 && workload.materialSha256 === S.materialSha256 &&
    preflight.namespacesAbsent === true && preflight.retiredPredecessor === predecessor.stackId && preflight.cloudWrites === 0, 'PROVIDER_PREFLIGHT_REQUIRED');
  const body = { schema: 'techlong/platform-worker-review/v4', ...admission, workload, predecessor, binding, endpointSha256,
    preflightSha256: await sha256Hex(preflight), riskFile: W4_RISK_FILE, privateSource,
    effects: W4_EFFECTS,
    preparationIsNotExecutionApproval: true };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}

export async function assertPlatformManifestShapeV4(manifest) {
  const { manifestSha256, ...body } = manifest;
  requireW4(manifest.schema === 'techlong/platform-worker-review/v4' && /^[a-f0-9]{64}$/.test(manifestSha256) &&
    Object.keys(body).sort().join(',') === 'binding,effects,endpointSha256,jobPlan,predecessor,preflightSha256,preparationIsNotExecutionApproval,privateSource,programs,queue,riskFile,schema,workload' &&
    manifest.riskFile === W4_RISK_FILE && same(manifest.effects, W4_EFFECTS) && manifest.preparationIsNotExecutionApproval === true &&
    /^[a-f0-9]{64}$/.test(manifest.preflightSha256) && /^[a-f0-9]{64}$/.test(manifest.endpointSha256), 'MANIFEST_SHAPE');
  requireW4(await sha256Hex(body) === manifestSha256, 'MANIFEST_HASH');
}

export function assertCurrentPlatformRowsV4(manifest, observed, now) {
  requireW4(Number.isSafeInteger(now) && now >= observed.checkedAt && now - observed.checkedAt < 30000 &&
    same(observed.snapshot, manifest.jobPlan.snapshot) && same(observed.job, manifest.queue.row) &&
    same(observed.requester, manifest.queue.requester) && observed.jobs.some(j => same(j, manifest.queue.proofJob)) &&
    observed.jobs.filter(j => ['pending', 'running', 'retry_wait'].includes(j.status)).length === 1 &&
    observed.jobs.some(j => same(j, manifest.queue.row)), 'BEFORE_CLAIM_ROWS_OR_QUEUE_DRIFT');
  assertHeldPlatformJobV4(observed.job, now);
}

// Binds the exact generated claim, allowing only the unpredictable lease token
// to differ from the reviewed zero-token template. No SQL/provenance drift.
export async function assertClaimMatchesReviewV4(manifest, request) {
  requireW4(same(request.plan, manifest.jobPlan) && request.approvedPlanSha256 === manifest.jobPlan.planSha256 &&
    request.leaseToken !== W4_ZERO_LEASE_TOKEN, 'CLAIM_REVIEW_BINDING');
  const actual = await compilePlatformInitializedClaimV4({ ...request, queuedJob: manifest.queue.row });
  const template = await compilePlatformInitializedClaimV4({ ...request, queuedJob: manifest.queue.row, leaseToken: W4_ZERO_LEASE_TOKEN });
  requireW4(template.programSha256 === manifest.programs.claimTemplateSha256, 'CLAIM_PROGRAM_DRIFT');
  return actual;
}
