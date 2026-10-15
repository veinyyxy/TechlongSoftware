import { neon } from '@neondatabase/serverless';
import { compileExpressFirstClaimProgramV1, type ExpressClaimStatementV1 } from './express-first-claim-program-v1.ts';
import type { prepareExpressLiveDeliveryPlanV2 } from './express-live-delivery-plan-v1.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import type { DeploymentJobLeaseFence, TenantExternalOperationFence } from './contracts.ts';

export type ExpressLivePlanV2 = Awaited<ReturnType<typeof prepareExpressLiveDeliveryPlanV2>>;
export type ExpressFirstClaimProgramV1 = Awaited<ReturnType<typeof compileExpressFirstClaimProgramV1>>;
export interface ExpressReadyProofV1 {
  planSha256: string; stackId: string; observationSha256: string;
  configurationHash: string; imageRevision: string; checkedAt: number;
  resourceEvidenceSha256: string;
  bootstrapVerified: true; initializedVerified: true; effectiveConfigurationVerified: true;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }

/** Separate statements inside ONE SERIALIZABLE transaction. Relationship
 * triggers see earlier writes. Each update asserts its own row count in SQL,
 * so a lost lease or changed state aborts, rather than committing partial ready. */
export async function compileExpressAtomicReadyProgramV1(input: {
  plan: ExpressLivePlanV2; lease: DeploymentJobLeaseFence; externalFence: TenantExternalOperationFence;
  proof: ExpressReadyProofV1; configuration: Record<string, unknown>; now: number;
}) {
  const p = input.plan, { planSha256, ...body } = p, s = p.scope, f = input.externalFence, r = f.resourceFence;
  const proof = input.proof, l = input.lease;
  if (await sha256Hex(body) !== planSha256 || p.schema !== 'techlong/express-live-delivery-plan/v2' ||
      canonicalJson(f) !== canonicalJson({ ...p.pendingExternalFence, state: 'active' }) ||
      l.deploymentId !== s.deploymentId || l.attempt !== 1 || l.workerId !== 'express-reviewed-first-delivery-v1' ||
      !/^lease_[a-f0-9]{32}$/.test(l.leaseToken) || !/^job_[a-f0-9]{24}$/.test(l.jobId) ||
      l.jobId !== 'job_' + (await sha256Hex({ deploymentId: s.deploymentId, planSha256: s.planHash,
        purpose: 'express-supervised-first-apply/v1' })).slice(0, 24) || await sha256Hex(input.configuration) !== s.configurationHash ||
      proof.planSha256 !== planSha256 || !/^[a-f0-9]{64}$/.test(proof.observationSha256) ||
      !/^[a-f0-9]{64}$/.test(proof.resourceEvidenceSha256) ||
      proof.configurationHash !== s.configurationHash || proof.imageRevision !== s.artifactRef.split('@')[1] ||
      proof.bootstrapVerified !== true || proof.initializedVerified !== true || proof.effectiveConfigurationVerified !== true ||
      !new RegExp('^arn:aws:cloudformation:ca-central-1:402010193138:stack/' + p.futureTemplate.stackName +
        '/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(proof.stackId) ||
      !Number.isSafeInteger(input.now) || !Number.isSafeInteger(proof.checkedAt) || proof.checkedAt > input.now ||
      input.now - proof.checkedAt > 30000 || input.now >= Date.parse(p.deadlineTag)) fail('EXPRESS_READY_PROOF_REJECTED');
  const statements: ExpressClaimStatementV1[] = [];
  const add = (key: string, text: string, values: unknown[]) => statements.push({ key, text, values });
  add('lock_exact_ready_coordinate', `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
    SELECT d.id FROM public.app_instance_deployments d
    JOIN public.app_instances a ON a.id=d.app_instance_id
    JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id
    JOIN public.workspaces w ON w.id=a.workspace_id
    JOIN public.deployment_environments e ON e.id=d.environment_id
    JOIN public.deployment_jobs j ON j.deployment_id=d.id AND j.id=$2
    JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
    JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id
      AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
    WHERE d.id=$1 AND d.app_instance_id=$3 AND d.environment_id=$4 AND d.status='verifying'
      AND d.plan_hash=$5 AND d.configuration_hash=$6 AND d.artifact_ref=$7 AND d.subscription_id=$8
      AND d.desired_plan::jsonb=$21::jsonb
      AND a.workspace_id=$9 AND a.product_id=$10 AND a.template_version_id=$11 AND a.status='pending'
      AND a.configuration_snapshot::jsonb=$20::jsonb
      AND w.status='active' AND sub.status='active' AND sub.workspace_id=$9 AND sub.product_id=$10
      AND sub.template_version_id=$11 AND sub.current_period_end>(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND e.status='active' AND e.apply_enabled=0 AND e.admission_state='open' AND e.admission_epoch=0
      AND e.kind='aws_sandbox' AND e.expected_account_id='402010193138' AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1'
      AND e.admission_stack_id IS NULL AND e.policy::jsonb=$12::jsonb
      AND j.status='running' AND j.job_type='apply' AND j.lease_owner=$13 AND j.lease_token=$14
      AND j.attempts=1 AND j.max_attempts=1 AND j.lease_expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint
      AND r.owner_deployment_id=$1 AND r.created_by_deployment_id=$1 AND r.generation=1
      AND r.lifecycle_status='verified' AND r.destroyed_at IS NULL AND r.stable_identity_hash=$15
      AND r.ownership_marker=$16 AND r.runtime_secret_ref=$17 AND r.evidence_hash IS NOT NULL
      AND r.environment_id=$4 AND r.workspace_id=$9 AND r.product_id=$10 AND r.cell_key='cell-sandbox-1'
      AND r.database_name=$22 AND r.role_name=$23 AND r.secret_name=$24
      AND r.migration_contract='speedfeast-saas-control-v1' AND r.baseline_digest=$25 AND r.evidence_hash=$26
      AND o.epoch=1 AND o.intent='provision' AND o.state='active' AND o.owner_deployment_id=$1
      AND o.stable_identity_hash=$15 AND o.operation_hash=$18 AND o.marker=$19
    FOR UPDATE OF d,a,sub,w,e,j,r,o) locked`,
  [s.deploymentId, l.jobId, s.appInstanceId, s.environmentId, s.planHash, s.configurationHash, s.artifactRef,
    p.subscriptionId, r.identity.workspaceId, r.identity.productId, p.templateVersionId, canonicalJson(p.environmentPolicy),
    l.workerId, l.leaseToken, r.identity.stableIdentityHash, r.ownershipMarker,
    p.futureTemplate.parameters.TenantRuntimeSecretArn, f.operationHash, f.marker, canonicalJson(input.configuration),
    canonicalJson(p.desiredPlan), r.identity.databaseName, r.identity.roleName, r.identity.secretName,
    '1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a', proof.resourceEvidenceSha256]);
  const assertUpdate = (key: string, sql: string, values: unknown[]) => add(key,
    `WITH changed AS (${sql} RETURNING id) SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM changed`, values);
  const accessUrl = 'https://' + p.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet.Name.slice(0, -1);
  assertUpdate('activate_instance', `UPDATE public.app_instances SET status='active',access_url=$2,
    provisioned_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,suspended_at=NULL,
    updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint WHERE id=$1 AND status='pending'`, [s.appInstanceId, accessUrl]);
  // No password-bearing payload, nor its hash, is persisted. This hashes only
  // validated, non-secret observations and the exact scope.
  assertUpdate('ready_deployment', `UPDATE public.app_instance_deployments SET status='ready',current_step='ready',
    ready_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
    outputs=(outputs::jsonb || $2::jsonb)::text,updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint
    WHERE id=$1 AND status='verifying'`, [s.deploymentId, canonicalJson({ expressDeliveryPlanSha256: planSha256,
    stackId: proof.stackId, observationSha256: proof.observationSha256, initializedVerified: true })]);
  assertUpdate('complete_same_job', `UPDATE public.deployment_jobs SET status='succeeded',lease_owner=NULL,
    lease_token=NULL,lease_expires_at=NULL,completed_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
    updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint
    WHERE id=$1 AND deployment_id=$2 AND status='running' AND lease_owner=$3 AND lease_token=$4
      AND attempts=1 AND lease_expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint`,
  [l.jobId, s.deploymentId, l.workerId, l.leaseToken]);
  return { schema: 'techlong/express-atomic-ready-program/v1' as const, isolationLevel: 'Serializable' as const,
    statements, programSha256: await sha256Hex({ statements, isolationLevel: 'Serializable' }), automaticRetries: 0 };
}

/** Concrete Neon HTTP transaction adapter, not a pretend SQL executor.
 * No queries on construction. Transport/commit ambiguity is NOT retried. */
export function createExpressLivePersistenceV1(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) fail('EXPRESS_LIVE_NEON_REQUIRED');
  const sql = neon(databaseUrl, { fullResults: true });
  const transaction = async (statements: ExpressClaimStatementV1[], signal: AbortSignal) => {
    signal.throwIfAborted();
    try {
      const results = await sql.transaction(tx => statements.map(q => tx.query(q.text, q.values)), {
        isolationLevel: 'Serializable', readOnly: false, fetchOptions: { signal },
      });
      if (results.length !== statements.length || results.some(r => r.rowCount !== 1))
        fail('EXPRESS_SQL_COMMIT_REQUIRES_INSPECT');
    } catch { fail('EXPRESS_SQL_RESULT_REQUIRES_INSPECT_NO_RETRY'); }
  };
  return Object.freeze({
    async firstClaim(input: Parameters<typeof compileExpressFirstClaimProgramV1>[0], signal: AbortSignal) {
      const program = await compileExpressFirstClaimProgramV1(input);
      await transaction(program.queries, signal); return program;
    },
    async finishReady(input: Parameters<typeof compileExpressAtomicReadyProgramV1>[0], signal: AbortSignal) {
      const program = await compileExpressAtomicReadyProgramV1(input);
      await transaction(program.statements, signal); return { committed: true as const, programSha256: program.programSha256 };
    },
  });
}
