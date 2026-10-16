import { neon } from '@neondatabase/serverless';
import { INITIALIZED_PLATFORM_SCOPE, INITIALIZED_REVIEW_HOLD_AT } from '../initialized-platform-request-v1.ts';
import { compileExpressInitializedClaimV2, compileExpressInitializedLeaseCheckV2, compileExpressInitializedCompleteV2,
  verifyExpressInitializedCompletionReadbackV2, type ExpressInitializedJobPlanV2 } from './express-initialized-job-v2.ts';
import { createExpressInitializedJobNeonV2 } from './express-initialized-job-neon-v2.ts';
import type { DeploymentJobLeaseFence } from './contracts.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

type Row = Record<string, unknown>;
function fail(): never { throw Object.assign(Error('PLATFORM_INITIALIZED_CLAIM_REQUIRES_INSPECT_NO_RETRY'), { retryable: false }); }
async function context(plan: ExpressInitializedJobPlanV2, queued: Row, token: string) {
  const original = typeof queued.payload === 'string' ? JSON.parse(queued.payload) : queued.payload;
  if (!original || typeof original !== 'object' || Array.isArray(original)) fail();
  const p = original as Row;
  if (Object.keys(p).sort().join(',') !== 'cloudExecutionAuthorized,kind,requestId,requestedAt,requestedByUserId,reviewRequired,scope') fail();
  if (queued.id !== plan.jobId || queued.deployment_id !== plan.material.scope.ownerDeploymentId || queued.job_type !== 'reconcile' ||
      queued.status !== 'pending' || queued.attempts !== 0 || queued.max_attempts !== 1 || queued.available_at !== INITIALIZED_REVIEW_HOLD_AT ||
      queued.lease_owner !== null || queued.lease_token !== null || queued.lease_expires_at !== null || queued.completed_at !== null ||
      p.kind !== 'express_initialized_request_v4' || p.requestId !== plan.requestId || p.reviewRequired !== true ||
      p.cloudExecutionAuthorized !== false || canonicalJson(p.scope) !== canonicalJson(INITIALIZED_PLATFORM_SCOPE) ||
      !/^usr_[A-Za-z0-9_-]{3,120}$/.test(String(p.requestedByUserId)) || !Number.isSafeInteger(p.requestedAt) ||
      Number(p.requestedAt) > plan.preparedAt || !Number.isSafeInteger(queued.created_at) || Number(queued.created_at) > plan.preparedAt ||
      queued.dedupe_key !== plan.dedupeKey || plan.materialSha256 !== INITIALIZED_PLATFORM_SCOPE.materialSha256) fail();
  const base = await compileExpressInitializedClaimV2({ plan, approvedPlanSha256: plan.planSha256, leaseToken: token });
  const basePayload = String(base.statements[2].values[3]);
  const runningPayload = canonicalJson({ ...JSON.parse(basePayload), platformRequest: p });
  return { base, basePayload, runningPayload, requestedByUserId: String(p.requestedByUserId) };
}

/** Successor claim, not a patch to the proven W2 first-insert path. Claims the
 * exact queued job in place, keeping its complete request provenance in payload.
 * No queue scan, INSERT, new job, retry, takeover, TTL/owner/epoch change. */
export async function compilePlatformInitializedClaimV4(input: {
  plan: ExpressInitializedJobPlanV2; queuedJob: Row; approvedPlanSha256: string; leaseToken: string;
}) {
  const x = structuredClone(input), p = x.plan;
  if (x.approvedPlanSha256 !== p.planSha256) fail();
  const c = await context(p, x.queuedJob, x.leaseToken), l = c.base.lease;
  const clock = '(extract(epoch FROM clock_timestamp())*1000)::bigint';
  const statements = [c.base.statements[0], {
    key: 'lock_exact_held_request_and_active_admin', text: `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
      SELECT j.id FROM public.deployment_jobs j JOIN public.users u ON u.id=$3
      WHERE j.id=$1 AND to_jsonb(j)=$2::jsonb AND u.status='active' AND u.is_platform_admin=1 FOR UPDATE OF j,u) locked`,
    values: [p.jobId, canonicalJson(x.queuedJob), c.requestedByUserId],
  }, {
    key: 'require_no_active_sibling_and_fresh_review', text: `SELECT 1 / CASE WHEN ${clock}>=$3 AND ${clock}<$4 AND $5-${clock}>=300000
      AND NOT EXISTS(SELECT 1 FROM public.deployment_jobs WHERE deployment_id=$1 AND id<>$2 AND status IN ('pending','running','retry_wait'))
      THEN 1 ELSE 0 END AS accepted`, values: [l.deploymentId, p.jobId, p.preparedAt, p.claimBy, p.deadline],
  }, {
    key: 'claim_same_held_job_once', text: `WITH db_clock AS MATERIALIZED (SELECT ${clock} AS now_ms), changed AS (
      UPDATE public.deployment_jobs SET status='running',payload=$3,attempts=1,available_at=db_clock.now_ms,
        lease_owner=$4,lease_token=$5,lease_expires_at=LEAST(db_clock.now_ms+$6,$7),updated_at=db_clock.now_ms
      FROM db_clock WHERE id=$1 AND deployment_id=$2 AND status='pending' AND attempts=0 AND max_attempts=1 AND available_at=$8
        AND db_clock.now_ms>=$9 AND db_clock.now_ms<$10 AND $7-db_clock.now_ms>=300000
      RETURNING id,lease_expires_at)
      SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted,max(lease_expires_at) AS lease_expires_at FROM changed`,
    values: [p.jobId, l.deploymentId, c.runningPayload, l.workerId, l.leaseToken, p.leaseDurationMs, p.deadline,
      INITIALIZED_REVIEW_HOLD_AT, p.preparedAt, p.claimBy],
  }];
  return { statements, lease: l, isolationLevel: 'Serializable' as const, automaticRetries: 0,
    programSha256: await sha256Hex({ statements, isolationLevel: 'Serializable' }) };
}

export async function compilePlatformInitializedLeaseCheckV4(plan: ExpressInitializedJobPlanV2, queuedJob: Row, lease: DeploymentJobLeaseFence) {
  const p = structuredClone(plan), l = structuredClone(lease), c = await context(p, structuredClone(queuedJob), l.leaseToken);
  const program = await compileExpressInitializedLeaseCheckV2(p, l);
  program.statements[1].values[4] = c.runningPayload;
  return { ...program, programSha256: await sha256Hex({ statements: program.statements, isolationLevel: 'Serializable' }) };
}

export async function compilePlatformInitializedCompleteV4(input: Parameters<typeof compileExpressInitializedCompleteV2>[0] & { queuedJob: Row }) {
  const x = structuredClone(input), c = await context(x.plan, x.queuedJob, x.lease.leaseToken);
  const program = await compileExpressInitializedCompleteV2(x);
  program.statements[1].values[4] = c.runningPayload;
  return { ...program, programSha256: await sha256Hex({ statements: program.statements, isolationLevel: 'Serializable' }) };
}

export async function verifyPlatformInitializedCompletionReadbackV4(input: Parameters<typeof verifyExpressInitializedCompletionReadbackV2>[0] & {
  queuedJob: Row; lease: DeploymentJobLeaseFence;
}) {
  const x = structuredClone(input), c = await context(x.plan, x.queuedJob, x.lease.leaseToken);
  if (canonicalJson(x.lease) !== canonicalJson(c.base.lease) || !x.job || x.job.payload !== c.runningPayload) fail();
  // First prove provenance exact, then adapt only the payload for W2's original
  // closed-key verifier. No stored provenance is discarded or rewritten.
  return verifyExpressInitializedCompletionReadbackV2({ ...x, job: { ...x.job, payload: c.basePayload } });
}

/** Lazy concrete adapter for the future reviewed queued-job CLI root. The web
 * handler never constructs this adapter or loads AWS/private control material. */
export function createPlatformInitializedPersistenceV4(databaseUrl: string, queuedJob: Row) {
  const queued = structuredClone(queuedJob), base = createExpressInitializedJobNeonV2(databaseUrl);
  const sql = neon(databaseUrl, { fullResults: true });
  async function transaction(statements: { text: string; values: unknown[] }[], signal: AbortSignal, readOnly: boolean) {
    signal.throwIfAborted();
    try {
      const result = await sql.transaction(tx => statements.map(q => tx.query(q.text, q.values)), { isolationLevel: 'Serializable', readOnly,
        fetchOptions: { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) } });
      if (result.length !== statements.length || result.some(r => r.rowCount !== 1 || r.rows[0]?.accepted !== 1)) fail();
      return result;
    } catch { fail(); }
  }
  return Object.freeze({ readSnapshot: base.readSnapshot,
    async claim(input: Parameters<typeof compileExpressInitializedClaimV2>[0], signal: AbortSignal) {
      const program = await compilePlatformInitializedClaimV4({ ...input, queuedJob: queued });
      const rows = await transaction(program.statements, signal, false), expires = Number(rows.at(-1)!.rows[0].lease_expires_at);
      if (!Number.isSafeInteger(expires) || expires > input.plan.deadline) fail();
      return { lease: program.lease, leaseExpiresAt: expires, programSha256: program.programSha256 };
    },
    async assertLease(plan: ExpressInitializedJobPlanV2, lease: DeploymentJobLeaseFence, signal: AbortSignal) {
      const program = await compilePlatformInitializedLeaseCheckV4(plan, queued, lease);
      await transaction(program.statements, signal, true);
      return { accepted: true as const, programSha256: program.programSha256 };
    },
    async complete(input: Parameters<typeof compileExpressInitializedCompleteV2>[0], signal: AbortSignal) {
      const request = structuredClone(input), program = await compilePlatformInitializedCompleteV4({ ...request, queuedJob: queued });
      await transaction(program.statements, signal, false);
      const observed = await base.readSnapshot({ deploymentId: request.lease.deploymentId,
        predecessorJobId: String(request.plan.snapshot.predecessorJob.id), newJobId: request.plan.jobId }, signal);
      const result = await verifyPlatformInitializedCompletionReadbackV4({ plan: request.plan, lease: request.lease, queuedJob: queued,
        snapshot: observed.snapshot, job: observed.job, expectedOutputs: program.outputs });
      return { ...result, programSha256: program.programSha256, receiptSha256: program.receiptSha256, checkedAt: observed.checkedAt };
    },
  });
}
