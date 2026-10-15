import type { prepareExpressLiveDeliveryPlanV1 } from './express-live-delivery-plan-v1.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
type Plan = Awaited<ReturnType<typeof prepareExpressLiveDeliveryPlanV1>>;
export interface ExpressClaimStatementV1 { key: string; text: string; values: unknown[] }
function fail(): never { throw Error('EXPRESS_FIRST_CLAIM_PROGRAM_INPUT_REJECTED'); }

/** Bound SERIALIZABLE program, never executes on construction. Separate SQL
 * statements ensure existing FK/relationship triggers see prior inserts;
 * no single-command sibling data-modifying CTE visibility is assumed. No
 * upsert, DDL, ownership transfer or "verified" lifecycle fiction. */
export async function compileExpressFirstClaimProgramV1(input: {
  plan: Plan; configuration: Record<string, unknown>; environmentPolicy: Record<string, unknown>;
  now: number; leaseToken: string;
}) {
  const p = structuredClone(input.plan), { planSha256, ...body } = p, s = p.scope, f = p.pendingExternalFence, r = f.resourceFence, i = r.identity;
  if (await sha256Hex(body) !== planSha256 || await sha256Hex(input.configuration) !== s.configurationHash ||
      f.state !== 'pending_external' || f.epoch !== 1 || r.generation !== 1 || r.ownerDeploymentId !== s.deploymentId ||
      !Number.isSafeInteger(input.now) || Date.parse(p.deadlineTag) - input.now < 30 * 60000 ||
      !/^lease_[a-f0-9]{32}$/.test(input.leaseToken) || input.environmentPolicy.budgetLimitCents !== 5000 ||
      canonicalJson(input.environmentPolicy) !== canonicalJson(p.environmentPolicy)) fail();
  const now = input.now, leaseExpiresAt = Math.min(now + 3600000, Date.parse(p.deadlineTag) - 5 * 60000);
  const jobId = 'job_' + (await sha256Hex({ deploymentId: s.deploymentId, planSha256: s.planHash, purpose: 'express-supervised-first-apply/v1' })).slice(0, 24);
  const workerId = 'express-reviewed-first-delivery-v1', queries: ExpressClaimStatementV1[] = [];
  const add = (key: string, text: string, values: unknown[]) => queries.push({ key, text, values });
  add('lock_environment', `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
    SELECT id FROM public.deployment_environments WHERE id=$1 AND kind='aws_sandbox' AND expected_account_id='402010193138'
      AND region='ca-central-1' AND cell_key='cell-sandbox-1' AND status='active' AND apply_enabled=0
      AND admission_state='open' AND admission_epoch=0 AND admission_stack_id IS NULL AND policy::jsonb=$2::jsonb FOR UPDATE) locked`,
  [s.environmentId, canonicalJson(input.environmentPolicy)]);
  add('lock_business_scope', `SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS accepted FROM (
    SELECT a.id FROM public.app_instances a JOIN public.workspaces w ON w.id=a.workspace_id
    JOIN public.subscriptions sub ON sub.id=a.subscription_id
    WHERE a.id=$1 AND a.workspace_id=$2 AND a.product_id=$3 AND a.template_version_id=$4
      AND a.status='pending' AND a.slug='first-acceptance' AND a.configuration_snapshot::jsonb=$5::jsonb
      AND w.status='active' AND sub.id=$6 AND sub.workspace_id=$2 AND sub.product_id=$3 AND sub.template_version_id=$4
      AND sub.status='active' AND sub.current_period_end > (extract(epoch FROM clock_timestamp())*1000)::bigint
    FOR UPDATE OF a,w,sub) locked`, [s.appInstanceId, i.workspaceId, i.productId, p.templateVersionId,
    canonicalJson(input.configuration), p.subscriptionId]);
  const subscriptionId = p.subscriptionId;
  if (typeof subscriptionId !== 'string' || !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) fail();
  add('require_first_absence', `SELECT 1 / CASE WHEN
    NOT EXISTS(SELECT 1 FROM public.app_instance_deployments WHERE app_instance_id=$1 OR id=$2 OR idempotency_key=$3)
    AND NOT EXISTS(SELECT 1 FROM public.deployment_jobs WHERE id=$4 OR deployment_id=$2)
    AND NOT EXISTS(SELECT 1 FROM public.deployment_tenant_resources WHERE app_instance_id=$1 OR stable_identity_hash=$5
      OR (environment_id=$6 AND (database_name=$7 OR role_name=$8)) OR secret_name=$9 OR runtime_secret_ref=$10)
    AND NOT EXISTS(SELECT 1 FROM public.deployment_tenant_external_operations WHERE app_instance_id=$1 OR stable_identity_hash=$5)
    THEN 1 ELSE 0 END AS accepted`, [s.appInstanceId, s.deploymentId, p.idempotencyKey, jobId, i.stableIdentityHash, s.environmentId,
    i.databaseName, i.roleName, i.secretName, p.futureTemplate.parameters.TenantRuntimeSecretArn]);
  add('insert_deployment', `INSERT INTO public.app_instance_deployments
    (id,app_instance_id,subscription_id,environment_id,driver,workflow_version,cell_key,deployment_profile_key,mode,status,
     desired_plan,plan_hash,configuration_hash,idempotency_key,artifact_ref,current_step,outputs,attempts,started_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,'aws_ecs_cell','v1','cell-sandbox-1','standard-v1','aws_sandbox','preflight',$5,$6,$7,$8,$9,
      'express_initial_epoch','{}',1,$10,$10,$10) RETURNING id`,
  [s.deploymentId, s.appInstanceId, subscriptionId, s.environmentId, canonicalJson(p.desiredPlan), s.planHash, s.configurationHash, p.idempotencyKey, s.artifactRef, now]);
  add('insert_direct_running_job', `INSERT INTO public.deployment_jobs
    (id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,available_at,lease_owner,lease_expires_at,lease_token,created_at,updated_at)
    VALUES($1,$2,'apply',$3,'running',$4,1,1,$5,$6,$7,$8,$5,$5) RETURNING id`,
  [jobId, s.deploymentId, 'express-first-apply:' + p.idempotencyKey, canonicalJson({ deploymentId: s.deploymentId, planHash: s.planHash,
    workflowVersion: 'v1', supervisedExpress: true }), now, workerId, leaseExpiresAt, input.leaseToken]);
  add('insert_planned_resource', `INSERT INTO public.deployment_tenant_resources
    (app_instance_id,created_by_deployment_id,owner_deployment_id,generation,stable_identity_hash,environment_id,workspace_id,product_id,
     cell_key,database_name,role_name,secret_name,runtime_secret_ref,ownership_marker,lifecycle_status,evidence,created_at,updated_at)
    VALUES($1,$2,$2,1,$3,$4,$5,$6,'cell-sandbox-1',$7,$8,$9,$10,$11,'planned','{}',$12,$12) RETURNING app_instance_id`,
  [s.appInstanceId, s.deploymentId, i.stableIdentityHash, s.environmentId, i.workspaceId, i.productId, i.databaseName, i.roleName, i.secretName,
    p.futureTemplate.parameters.TenantRuntimeSecretArn, r.ownershipMarker, now]);
  add('insert_claim_event', `INSERT INTO public.deployment_tenant_resource_events
    (id,app_instance_id,generation,deployment_id,event_type,from_status,to_status,evidence,created_at)
    VALUES($1,$2,1,$3,'claimed',NULL,'planned',$4,$5) RETURNING id`,
  ['trevt:' + s.deploymentId + ':express-first-claimed', s.appInstanceId, s.deploymentId, canonicalJson({ protocol: 'express-installed-database-adoption-candidate/v1',
    verified: false, existingDatabaseNotRestored: true, deliveryPlanSha256: planSha256 }), now]);
  add('insert_pending_operation', `INSERT INTO public.deployment_tenant_external_operations
    (app_instance_id,generation,epoch,stable_identity_hash,owner_deployment_id,created_by_job_id,created_by_attempt,intent,operation_hash,
     marker,state,evidence,created_at,updated_at) VALUES($1,1,1,$2,$3,$4,1,'provision',$5,$6,'pending_external','{}',$7,$7) RETURNING epoch`,
  [s.appInstanceId, i.stableIdentityHash, s.deploymentId, jobId, f.operationHash, f.marker, now]);
  add('insert_prepared_event', `INSERT INTO public.deployment_tenant_external_operation_events
    (id,app_instance_id,generation,epoch,deployment_id,event_type,from_state,to_state,evidence,created_at)
    VALUES($1,$2,1,1,$3,'prepared',NULL,'pending_external','{}',$4) RETURNING id`,
  ['tevt:' + s.deploymentId + ':express-first-prepared', s.appInstanceId, s.deploymentId, now]);
  if (queries.some(q => q.values.some(v => v === undefined))) fail();
  return { schema: 'techlong/express-first-claim-program/v1' as const, isolationLevel: 'Serializable' as const,
    readOnly: false, queries, insertedRows: 6, jobId, workerId, leaseExpiresAt, automaticRetries: 0,
    resourceVerified: false, epochActivated: false, databaseSqlConnections: 0, executionAuthorized: false,
    programSha256: await sha256Hex({ queries, isolationLevel: 'Serializable' }) };
}
