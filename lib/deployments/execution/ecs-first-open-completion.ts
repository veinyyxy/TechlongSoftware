import { FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX, type FirstOnboardingReview } from "../first-onboarding.ts";
import type { InstanceBinding, InstanceReleaseObservation, SoftwareRelease } from "../releases/contract.ts";
import type { ClaimedDeploymentJob, DeploymentExecutionContext } from "./contracts.ts";
import type { EcsFirstOpenApproval } from "./ecs-first-open.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export interface EcsFirstOpenCompletionInput {
  approval: Readonly<EcsFirstOpenApproval>;
  job: ClaimedDeploymentJob;
  context: DeploymentExecutionContext;
  review: FirstOnboardingReview;
  release: SoftwareRelease;
  databaseProfile?: InstanceReleaseObservation["databaseProfile"];
  target: { configuration: unknown; desiredPlan: unknown };
  runtime: InstanceReleaseObservation;
}

export type EcsFirstOpenCompletionResult =
  | { outcome: "activated"; revision: 0 }
  | { outcome: "failed" | "unknown" };

const clockMs = "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint";
const request = "input AS MATERIALIZED (SELECT $1::jsonb AS req)";
const executionScope = `FROM input i
  JOIN public.first_open_executions x ON x.id=i.req#>>'{approval,executionId}'
    AND x.job_id=i.req#>>'{approval,jobId}' AND x.instance_id=i.req#>>'{approval,instanceId}'
    AND x.deployment_id=i.req#>>'{jobPayload,scope,deploymentId}'
    AND x.release_id=i.req#>>'{approval,releaseId}' AND x.artifact_ref=i.req#>>'{jobPayload,scope,artifactRef}'
    AND x.review_sha256=i.req#>>'{approval,reviewSha256}' AND x.approved_by=i.req#>>'{approval,approvedBy}'
    AND x.approved_at=(i.req#>>'{approval,approvedAt}')::bigint
    AND x.dispatch_token=x.id AND x.dispatch_outcome='acknowledged' AND x.dispatch_task_arn IS NOT NULL
  JOIN public.deployment_jobs j ON j.id=x.job_id AND j.deployment_id=x.deployment_id
  JOIN public.app_instance_deployments d ON d.id=j.deployment_id AND d.app_instance_id=x.instance_id
    AND d.purchase_order_id=x.purchase_order_id
  JOIN public.app_instances a ON a.id=d.app_instance_id AND a.workspace_id=i.req#>>'{approval,workspaceId}'`;
const ownedLease = `j.status='running' AND j.job_type='apply' AND j.attempts=1 AND j.max_attempts=1
  AND j.dedupe_key='${FIRST_ONBOARDING_PREFIX}' || a.id AND j.available_at=${FIRST_ONBOARDING_HOLD_AT}
  AND j.lease_owner=x.id AND j.lease_token=$2 AND j.completed_at IS NULL`;

// Sequence 10 is a durable, one-time write intent. A second invocation can
// neither claim it nor submit an activation after a lost acknowledgement.
const START_ACTIVATION = `WITH ${request}, eligible AS MATERIALIZED (
  SELECT x.id, j.lease_expires_at, (i.req#>>'{approval,writeBefore}')::bigint AS write_before
  ${executionScope}
  JOIN public.first_open_execution_events checked ON checked.execution_id=x.id AND checked.sequence=9
    AND checked.step='self_check' AND checked.status='completed'
  WHERE ${ownedLease}
  FOR UPDATE OF x,j
), timed AS MATERIALIZED (
  SELECT eligible.*, ${clockMs} AS now_ms FROM eligible
)
INSERT INTO public.first_open_execution_events(execution_id,sequence,step,status,at)
SELECT id,10,'activation','started',now_ms FROM timed
WHERE now_ms<lease_expires_at AND now_ms<write_before
ON CONFLICT DO NOTHING RETURNING execution_id AS "executionId"`;

const runningActivation = `JOIN public.first_open_execution_events started ON started.execution_id=x.id
    AND started.sequence=10 AND started.step='activation' AND started.status='started'
  AND NOT EXISTS (SELECT 1 FROM public.first_open_execution_events terminal
    WHERE terminal.execution_id=x.id AND terminal.sequence>started.sequence)`;

/**
 * Four writes share a PostgreSQL statement and its transaction. A conflicting
 * release binding causes no update; an unexpected partial update aborts all
 * four writes. The page-visible completion event is a separate readback gate.
 */
export const COMPLETE_ECS_FIRST_OPEN = `WITH ${request}, locked AS MATERIALIZED (
  SELECT x.id AS execution_id, j.id AS job_id, d.id AS deployment_id, a.id AS instance_id,
    j.lease_expires_at, s.current_period_start, s.current_period_end, i.req
  ${executionScope}
  ${runningActivation}
  JOIN public.subscriptions s ON s.id=a.subscription_id AND s.id=d.subscription_id
    AND s.workspace_id=a.workspace_id AND s.product_id=a.product_id
  JOIN public.workspaces w ON w.id=a.workspace_id
  JOIN public.deployment_environments e ON e.id=d.environment_id
  JOIN public.users actor ON actor.id=x.approved_by AND actor.status='active' AND actor.is_platform_admin=1
  JOIN public.subscription_purchase_orders p ON p.id=x.purchase_order_id
    AND p.subscription_id=s.id AND p.workspace_id=a.workspace_id AND p.product_id=a.product_id
    AND p.plan_id=s.plan_id AND p.template_version_id=a.template_version_id AND p.order_type='new_subscription'
    AND p.status='paid' AND p.completed_at IS NOT NULL AND p.configuration_snapshot::jsonb=a.configuration_snapshot::jsonb
  JOIN public.payment_records pay ON pay.id=p.payment_record_id AND pay.workspace_id=p.workspace_id
    AND pay.subscription_id=p.subscription_id AND pay.status='paid' AND pay.paid_at IS NOT NULL
    AND pay.amount=p.amount AND pay.currency=p.currency AND pay.provider=p.provider AND pay.provider_payment_id=p.provider_payment_id
  JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
  JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation
    AND o.epoch=r.external_operation_epoch
  JOIN public.deployment_step_runs c ON c.job_id=j.id AND c.deployment_id=d.id AND c.attempt=j.attempts
    AND c.step_key='control_verify' AND c.status='succeeded' AND c.finished_at IS NOT NULL
    AND c.input_hash=i.req->>'controlInputHash'
  JOIN deployment_release.releases l ON l.id=x.release_id AND l.status='ecr_verified' AND l.product_id=a.product_id
    AND l.component='tenant_api' AND l.document || jsonb_build_object('status',l.status)=i.req->'catalog'
  WHERE ${ownedLease}
    AND j.payload::jsonb=i.req->'jobPayload' AND j.payload::jsonb->>'kind'='sandbox_first_onboarding_v1'
    AND d.status='verifying' AND d.current_step='control_verify' AND d.ready_at IS NULL
    AND d.plan_hash=i.req#>>'{jobPayload,scope,planHash}' AND d.configuration_hash=i.req#>>'{jobPayload,scope,configurationHash}'
    AND d.desired_plan::jsonb=i.req->'desiredPlan' AND d.environment_id=i.req#>>'{jobPayload,scope,environmentId}'
    AND d.mode='aws_sandbox' AND d.driver='aws_ecs_cell' AND d.workflow_version='v1' AND d.cell_key='cell-sandbox-1'
    AND d.deployment_profile_key='standard-v1' AND d.artifact_ref=x.artifact_ref
    AND d.outputs::jsonb->>'stackId'=i.req#>>'{binding,stackId}' AND d.outputs::jsonb->>'stackOperation'='create'
    AND d.outputs::jsonb->>'workloadTemplateSha256'=i.req#>>'{binding,templateSha256}'
    AND d.outputs::jsonb->>'workloadStableIdentityHash'=r.stable_identity_hash
    AND d.outputs::jsonb->>'workloadGeneration'=r.generation::text AND d.outputs::jsonb->>'workloadProvisionEpoch'=o.epoch::text
    AND d.outputs::jsonb->>'workloadProvisionMarker'=o.marker AND d.outputs::jsonb->>'workloadProvisionHash'=o.operation_hash
    AND c.output::jsonb->'ready'='true'::jsonb AND c.output::jsonb->>'desiredConfigurationHash'=d.configuration_hash
    AND c.output::jsonb->>'imageRevision'=i.req#>>'{catalog,image,manifestDigest}'
    AND NOT EXISTS (SELECT 1 FROM public.app_instance_deployments sibling WHERE sibling.app_instance_id=a.id AND sibling.id<>d.id)
    AND NOT EXISTS (SELECT 1 FROM public.deployment_jobs sibling WHERE sibling.deployment_id=d.id AND sibling.id<>j.id)
    AND a.status='pending' AND a.provisioning_source='payment_success' AND a.provisioned_at IS NULL AND a.access_url=''
    AND a.slug || '.sandbox.techlong.cloud'=i.req#>>'{approval,hostname}'
    AND a.tenant_key=i.req#>>'{jobPayload,scope,tenantKey}' AND a.product_id=i.req#>>'{jobPayload,scope,productId}'
    AND a.template_version_id=i.req#>>'{jobPayload,scope,templateVersionId}' AND a.template_version_id=s.template_version_id
    AND a.configuration_snapshot::jsonb=i.req->'configuration' AND s.instance_configuration::jsonb=a.configuration_snapshot::jsonb
    AND s.status='active' AND s.id=i.req#>>'{jobPayload,scope,subscriptionId}' AND s.plan_id=i.req#>>'{jobPayload,scope,planId}'
    AND s.deployment_profile_key='standard-v1' AND w.status='active'
    AND e.key='aws-sandbox-ca-central-1' AND e.status='active' AND e.kind='aws_sandbox' AND e.apply_enabled=0
    AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1' AND e.expected_account_id=i.req#>>'{jobPayload,scope,accountId}'
    AND r.generation=1 AND r.owner_deployment_id=d.id AND r.created_by_deployment_id=d.id AND r.lifecycle_status='verified'
    AND r.stable_identity_hash=i.req#>>'{fence,stableIdentityHash}' AND r.workspace_id=a.workspace_id AND r.product_id=a.product_id
    AND r.environment_id=e.id AND r.cell_key=e.cell_key AND r.ownership_marker=i.req#>>'{fence,ownershipMarker}'
    AND r.baseline_digest=i.req#>>'{approval,baselineDigest}'
    AND o.state='active' AND o.intent='provision' AND o.owner_deployment_id=d.id AND o.created_by_job_id=j.id AND o.created_by_attempt=1
    AND o.stable_identity_hash=r.stable_identity_hash AND o.epoch=(i.req#>>'{fence,epoch}')::bigint
    AND o.marker=i.req#>>'{fence,marker}' AND o.operation_hash=i.req#>>'{fence,operationHash}'
  FOR UPDATE OF x,j,d,a FOR SHARE OF s,w,e,actor,p,pay,r,o,c,l
), timed AS MATERIALIZED (
  SELECT locked.*, ${clockMs} AS now_ms FROM locked
), eligible AS MATERIALIZED (
  SELECT * FROM timed WHERE now_ms<(req#>>'{approval,writeBefore}')::bigint AND now_ms<lease_expires_at
    AND current_period_start<=now_ms AND current_period_end>(req#>>'{approval,writeBefore}')::bigint
), inserted AS (
  INSERT INTO deployment_release.instance_state(instance_id,component,binding,current_release_id,revision,active_request_id,last_evidence)
  SELECT instance_id,'tenant_api',req->'binding',req#>>'{approval,releaseId}',0,NULL,req->'evidence' FROM eligible
  ON CONFLICT (instance_id) DO NOTHING RETURNING instance_id
), activated AS (
  UPDATE public.app_instances a SET status='active',access_url='https://' || (e.req#>>'{approval,hostname}'),
    provisioned_at=e.now_ms,suspended_at=NULL,updated_at=e.now_ms
  FROM eligible e JOIN inserted i ON i.instance_id=e.instance_id WHERE a.id=e.instance_id RETURNING a.id
), ready AS (
  UPDATE public.app_instance_deployments d SET status='ready',current_step='ready',ready_at=e.now_ms,updated_at=e.now_ms,
    control_payload_hash=d.configuration_hash,
    outputs=(d.outputs::jsonb || jsonb_build_object('firstOnboarding',e.req->'evidence','tenantHostname',e.req#>>'{approval,hostname}'))::text
  FROM eligible e JOIN activated a ON a.id=e.instance_id WHERE d.id=e.deployment_id RETURNING d.id
), completed AS (
  UPDATE public.deployment_jobs j SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
    completed_at=e.now_ms,updated_at=e.now_ms
  FROM eligible e JOIN ready d ON d.id=e.deployment_id WHERE j.id=e.job_id RETURNING j.id
)
SELECT i.instance_id AS "instanceId", 1 / CASE WHEN (SELECT count(*) FROM activated)=1
  AND (SELECT count(*) FROM ready)=1 AND (SELECT count(*) FROM completed)=1 THEN 1 ELSE 0 END AS committed
FROM inserted i`;

const committedScope = `${executionScope}
  ${runningActivation}
  JOIN deployment_release.instance_state s ON s.instance_id=a.id AND s.current_release_id=x.release_id
  JOIN deployment_release.releases l ON l.id=s.current_release_id AND l.status='ecr_verified' AND l.product_id=a.product_id
    AND l.component='tenant_api' AND l.document || jsonb_build_object('status',l.status)=i.req->'catalog'
  WHERE j.status='succeeded' AND j.attempts=1 AND j.max_attempts=1
    AND j.lease_owner IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.completed_at>=started.at
    AND j.payload::jsonb=i.req->'jobPayload'
    AND d.status='ready' AND d.current_step='ready' AND d.artifact_ref=x.artifact_ref
    AND d.plan_hash=i.req#>>'{jobPayload,scope,planHash}' AND d.configuration_hash=i.req#>>'{jobPayload,scope,configurationHash}'
    AND d.control_payload_hash=d.configuration_hash
    AND d.outputs::jsonb->>'stackId'=i.req#>>'{binding,stackId}'
    AND d.outputs::jsonb->>'tenantHostname'=i.req#>>'{approval,hostname}'
    AND d.outputs::jsonb->'firstOnboarding'=i.req->'evidence'
    AND a.status='active' AND a.provisioned_at=d.ready_at AND d.ready_at=j.completed_at
    AND a.access_url='https://' || (i.req#>>'{approval,hostname}')
    AND s.revision=0 AND s.component='tenant_api' AND s.active_request_id IS NULL
    AND s.binding=i.req->'binding' AND s.last_evidence=i.req->'evidence'`;

/** Use a fresh read on the supplied post-commit read connection. */
export const READ_ECS_FIRST_OPEN_COMPLETION = `WITH ${request}
SELECT a.id AS "instanceId", s.revision ${committedScope}`;

const CONFIRM_ACTIVATION = `WITH ${request}, verified AS MATERIALIZED (
  SELECT x.id, (i.req#>>'{approval,writeBefore}')::bigint AS write_before
  ${committedScope}
  FOR UPDATE OF x FOR SHARE OF j,d,a,s,l
), timed AS MATERIALIZED (
  SELECT verified.*, ${clockMs} AS now_ms FROM verified
)
INSERT INTO public.first_open_execution_events(execution_id,sequence,step,status,at)
SELECT id,11,'activation','completed',now_ms FROM timed WHERE now_ms<write_before
ON CONFLICT DO NOTHING RETURNING execution_id AS "executionId"`;

const MARK_ACTIVATION_FAILURE = `INSERT INTO public.first_open_execution_events(execution_id,sequence,step,status,at,error_code)
SELECT x.id,11,'activation',$2,${clockMs},$3 FROM public.first_open_executions x
${runningActivation}
WHERE x.id=$1 ON CONFLICT DO NOTHING RETURNING execution_id AS "executionId"`;

async function completionRequest(input: EcsFirstOpenCompletionInput) {
  const { approval, context, job, review, release, runtime, target } = input;
  const databaseProfile = input.databaseProfile ?? "express_iam";
  const scope = review.payload.scope;
  const resource = context.tenantResources;
  const fence = context.tenantExternalOperation;
  // The opening task currently has an unambiguous client contract only when
  // the reviewed release names a single version.
  const [clientApiVersion] = release.compatibility.clientApiVersions;
  if (!clientApiVersion || release.compatibility.clientApiVersions.length !== 1 ||
    job.id !== approval.jobId || job.id !== review.jobId || job.id !== context.job.id ||
    job.deploymentId !== scope.deploymentId || job.leaseToken !== context.job.leaseToken ||
    context.deployment.id !== scope.deploymentId || context.appInstance.id !== scope.appInstanceId ||
    approval.instanceId !== scope.appInstanceId || approval.workspaceId !== scope.workspaceId ||
    approval.reviewSha256 !== review.reviewSha256 || approval.releaseId !== scope.releaseId ||
    release.id !== scope.releaseId || release.productId !== scope.productId || release.status !== "ecr_verified" ||
    await sha256Hex(release) !== review.catalogSha256 ||
    release.compatibility.applicationPort !== 3000 || !release.compatibility.databaseProfiles.includes(databaseProfile) ||
    !release.compatibility.schemaVersions.includes(approval.databaseSchemaVersion) ||
    !resource || resource.generation !== 1 || resource.lifecycleStatus !== "verified" ||
    resource.ownerDeploymentId !== scope.deploymentId || resource.baselineDigest !== approval.baselineDigest ||
    fence?.state !== "active" || fence.intent !== "provision" || fence.ownerDeploymentId !== scope.deploymentId ||
    fence.resourceFence.generation !== resource.generation || fence.resourceFence.ownershipMarker !== resource.ownershipMarker ||
    canonicalJson(fence.resourceFence.identity) !== canonicalJson(resource.identity) ||
    runtime.instanceId !== scope.appInstanceId || runtime.imageUri !== scope.artifactRef ||
    runtime.imageUri !== `${release.image.repository}@${release.image.manifestDigest}` ||
    runtime.platformDigest !== review.platformDigest || runtime.platformDigest !== release.image.platformDigest ||
    runtime.databaseSchemaVersion !== approval.databaseSchemaVersion || runtime.databaseProfile !== databaseProfile ||
    runtime.state !== "RUNNING" || !runtime.servicePresent || !runtime.albPresent || !runtime.databaseAvailable ||
    runtime.operationInProgress || runtime.desiredCount !== 1 || runtime.runningCount !== 1 || runtime.pendingCount !== 0 ||
    !Number.isSafeInteger(runtime.observedAt) || runtime.observedAt < approval.approvedAt || runtime.observedAt >= approval.writeBefore) {
    return null;
  }

  const binding: InstanceBinding = {
    instanceId: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId, environmentId: scope.environmentId,
    accountId: scope.accountId, region: "ca-central-1", stackId: runtime.stackId, initialized: true, status: "active",
    sourceRepository: release.source.repository, imageRepository: release.image.repository, runtimePlatform: release.image.runtimePlatform,
    applicationPort: release.compatibility.applicationPort, clientApiVersion, desiredCount: runtime.desiredCount,
    templateSha256: runtime.templateSha256, configurationSha256: runtime.configurationSha256, stateRevision: 0,
    currentRelease: { id: release.id, manifestDigest: release.image.manifestDigest, platformDigest: release.image.platformDigest },
  };
  const [bindingSha256, selfCheckSha256, controlInputHash] = await Promise.all([
    sha256Hex(binding), sha256Hex(runtime),
    sha256Hex({ configurationHash: scope.configurationHash, imageRevision: release.image.manifestDigest }),
  ]);
  const evidence = { kind: "ecs_first_open_v1", executionId: approval.executionId, jobId: job.id,
    releaseId: release.id, reviewSha256: review.reviewSha256, bindingSha256, selfCheckSha256, observedAt: runtime.observedAt };
  return canonicalJson({ approval, jobPayload: review.payload, ...target, catalog: release, binding, evidence, controlInputHash,
    fence: { stableIdentityHash: resource.identity.stableIdentityHash, ownershipMarker: resource.ownershipMarker,
      epoch: fence.epoch, marker: fence.marker, operationHash: fence.operationHash } });
}

/** Each write is autocommitted. If the activation write or fresh readback is
 * uncertain, retain the exact execution and record an unconfirmed result. */
export function createEcsFirstOpenCompletion({ db, readDb }: { db: ApplicationDatabase; readDb: ApplicationDatabase }) {
  if (db === readDb) throw Error("ECS_FIRST_OPEN_FRESH_READ_CONNECTION_REQUIRED");
  return async function complete(input: EcsFirstOpenCompletionInput): Promise<EcsFirstOpenCompletionResult> {
    const { approval, job, review } = input;
    const executionId = approval.executionId;
    const mark = async (status: "failed" | "unknown") => {
      const error = status === "failed" ? "ACTIVATION_FAILED" : "RESULT_UNCONFIRMED";
      try {
        const marked = await db.prepare(MARK_ACTIVATION_FAILURE).bind(executionId, status, error).first<{ executionId: string }>();
        return marked?.executionId === executionId ? status : "unknown";
      } catch {
        return "unknown";
      }
    };

    try {
      const scoped = canonicalJson({ approval, jobPayload: review.payload });
      const started = await db.prepare(START_ACTIVATION).bind(scoped, job.leaseToken).first<{ executionId: string }>();
      if (started?.executionId !== executionId) return { outcome: "unknown" };
    } catch {
      return { outcome: await mark("unknown") };
    }

    try {
      const payload = await completionRequest(input);
      if (!payload) return { outcome: await mark("failed") };
      const committed = await db.prepare(COMPLETE_ECS_FIRST_OPEN).bind(payload, job.leaseToken)
        .first<{ instanceId: string; committed: number }>();
      if (!committed) return { outcome: await mark("failed") };
      if (committed.instanceId !== approval.instanceId || committed.committed !== 1) return { outcome: await mark("unknown") };

      const readback = await readDb.prepare(READ_ECS_FIRST_OPEN_COMPLETION).bind(payload)
        .first<{ instanceId: string; revision: number | string }>();
      if (readback?.instanceId !== approval.instanceId || (readback.revision !== 0 && readback.revision !== "0")) {
        return { outcome: await mark("unknown") };
      }
      const confirmed = await db.prepare(CONFIRM_ACTIVATION).bind(payload).first<{ executionId: string }>();
      if (confirmed?.executionId !== executionId) return { outcome: await mark("unknown") };
      return { outcome: "activated", revision: 0 };
    } catch {
      return { outcome: await mark("unknown") };
    }
  };
}
