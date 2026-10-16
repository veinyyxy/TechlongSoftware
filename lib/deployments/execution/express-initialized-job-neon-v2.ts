import { neon } from '@neondatabase/serverless';
import type { DeploymentJobLeaseFence } from './contracts.ts';
import { compileExpressInitializedClaimV2, compileExpressInitializedLeaseCheckV2,
  compileExpressInitializedCompleteV2, verifyExpressInitializedCompletionReadbackV2,
  type ExpressInitializedJobPlanV2, type ExpressInitializedSnapshotV2,
  type InitializedJobStatementV2 } from './express-initialized-job-v2.ts';

function fail(code: string): never { throw Object.assign(Error('EXPRESS_INITIALIZED_NEON_' + code), { retryable: false }); }

/** Concrete Neon HTTP adapter. Construction performs no queries and reads no
 * env, Secret, credential file or private package. One request per transaction,
 * no automatic retry, lease extension, takeover or compensation. */
export function createExpressInitializedJobNeonV2(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') ||
      !['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) fail('TLS_NEON_REQUIRED');
  const sql = neon(databaseUrl, { fullResults: true });
  async function transaction(statements: InitializedJobStatementV2[], signal: AbortSignal, readOnly: boolean) {
    signal.throwIfAborted();
    try {
      const results = await sql.transaction(tx => statements.map(q => tx.query(q.text, q.values)), {
        isolationLevel: 'Serializable', readOnly, fetchOptions: { signal },
      });
      if (results.length !== statements.length || results.some(r => r.rowCount !== 1 || r.rows[0]?.accepted !== 1))
        fail('RESULT_REQUIRES_INSPECT_NO_RETRY');
      return results;
    } catch { fail('RESULT_REQUIRES_INSPECT_NO_RETRY'); }
  }
  async function readSnapshot(input: { deploymentId: string; predecessorJobId: string; newJobId?: string }, signal: AbortSignal) {
    if (!/^dep_[A-Za-z0-9_]{3,100}$/.test(input.deploymentId) || !/^job_[a-f0-9]{24}$/.test(input.predecessorJobId) ||
        input.newJobId !== undefined && !/^job_[a-f0-9]{24}$/.test(input.newJobId)) fail('READ_SCOPE');
    signal.throwIfAborted();
    try {
      const [result] = await sql.transaction(tx => [tx.query(`SELECT
        to_jsonb(d) AS deployment,to_jsonb(a) AS app,to_jsonb(w) AS workspace,to_jsonb(sub) AS subscription,
        to_jsonb(e) AS environment,to_jsonb(oldj) AS "predecessorJob",to_jsonb(r) AS resource,
        to_jsonb(o) AS operation,to_jsonb(t) AS "templateVersion",to_jsonb(j) AS job,
        (extract(epoch FROM clock_timestamp())*1000)::bigint AS "checkedAt"
        FROM public.app_instance_deployments d
        JOIN public.app_instances a ON a.id=d.app_instance_id
        JOIN public.workspaces w ON w.id=a.workspace_id
        JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id
        JOIN public.deployment_environments e ON e.id=d.environment_id
        JOIN public.deployment_jobs oldj ON oldj.id=$2 AND oldj.deployment_id=d.id
        JOIN public.app_instance_template_versions t ON t.id=a.template_version_id
        JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
        JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id
          AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
        LEFT JOIN public.deployment_jobs j ON j.id=$3 AND j.deployment_id=d.id
        WHERE d.id=$1`, [input.deploymentId, input.predecessorJobId, input.newJobId ?? null])], {
        isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: { signal },
      });
      if (result.rowCount !== 1) fail('READ_COORDINATE_MISSING');
      const row = result.rows[0];
      const { job, checkedAt, ...snapshot } = row;
      return { snapshot: snapshot as unknown as ExpressInitializedSnapshotV2,
        job: job as Record<string, unknown> | null, checkedAt: Number(checkedAt) };
    } catch { fail('READ_REQUIRES_INSPECT_NO_RETRY'); }
  }
  return Object.freeze({ readSnapshot,
    async claim(input: Parameters<typeof compileExpressInitializedClaimV2>[0], signal: AbortSignal) {
      const request = structuredClone(input), program = await compileExpressInitializedClaimV2(request);
      const results = await transaction(program.statements, signal, false);
      const leaseExpiresAt = Number(results.at(-1)!.rows[0].lease_expires_at);
      if (!Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt > request.plan.deadline) fail('CLAIM_REQUIRES_INSPECT_NO_RETRY');
      return { lease: program.lease, leaseExpiresAt, programSha256: program.programSha256 };
    },
    /** A point-in-time DB-only guard, not a cross-service lock or proof of
     * cloud authority. The eventual provider must also check external epoch. */
    async assertLease(plan: ExpressInitializedJobPlanV2, lease: DeploymentJobLeaseFence, signal: AbortSignal) {
      const program = await compileExpressInitializedLeaseCheckV2(plan, lease);
      await transaction(program.statements, signal, true);
      return { accepted: true as const, programSha256: program.programSha256 };
    },
    async complete(input: Parameters<typeof compileExpressInitializedCompleteV2>[0], signal: AbortSignal) {
      const request = structuredClone(input), program = await compileExpressInitializedCompleteV2(request);
      await transaction(program.statements, signal, false);
      // A new READ ONLY transaction, not reuse of the write transaction's rows.
      // Failure here must never rerun the preceding commit.
      const observed = await readSnapshot({ deploymentId: request.lease.deploymentId,
        predecessorJobId: String(request.plan.snapshot.predecessorJob.id), newJobId: request.plan.jobId }, signal);
      const result = verifyExpressInitializedCompletionReadbackV2({ plan: request.plan,
        snapshot: observed.snapshot, job: observed.job, expectedOutputs: program.outputs });
      return { ...result, programSha256: program.programSha256, receiptSha256: program.receiptSha256, checkedAt: observed.checkedAt };
    },
  });
}
