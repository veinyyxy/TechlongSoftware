import { FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX, type FirstOnboardingReview } from "../first-onboarding.ts";
import type { InstanceBinding, InstanceReleaseObservation, SoftwareRelease } from "../releases/contract.ts";
import { samplingBinding, type ReleaseSamplingBinding } from "../releases/sampling.ts";
import type { ReleaseRuntimeFacts } from "../releases/inspection.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export interface FirstOnboardingCompletionApproval {
  clientApiVersion: string;
  samplingSha256: string;
}

export async function buildFirstOnboardingBinding(input: {
  runtime: InstanceReleaseObservation; facts: ReleaseRuntimeFacts; sampling?: ReleaseSamplingBinding; hostname: string;
  approved: FirstOnboardingCompletionApproval; review: FirstOnboardingReview; release: SoftwareRelease;
}) {
  const { runtime, facts, sampling, hostname, approved, release, review } = input;
  const scope = review.payload.scope;
  if (!sampling || !runtime.persistentUploadsReady || sampling.apiHostname !== hostname ||
    sampling.database.kind !== "cluster" || sampling.database.profile !== "express_iam" ||
    sampling.database.schemaVersion !== runtime.databaseSchemaVersion ||
    !release.compatibility.clientApiVersions.includes(approved.clientApiVersion) ||
    await sha256Hex(sampling) !== approved.samplingSha256) throw Error("FIRST_ONBOARDING_D2_BINDING_UNPROVED");
  const binding: InstanceBinding & { sampling: ReleaseSamplingBinding } = {
    instanceId: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId, environmentId: scope.environmentId,
    accountId: scope.accountId, region: "ca-central-1", stackId: runtime.stackId, initialized: true, status: "active",
    sourceRepository: release.source.repository, imageRepository: release.image.repository, runtimePlatform: release.image.runtimePlatform,
    applicationPort: release.compatibility.applicationPort, clientApiVersion: approved.clientApiVersion, desiredCount: runtime.desiredCount,
    templateSha256: runtime.templateSha256, configurationSha256: runtime.configurationSha256, stateRevision: 0,
    currentRelease: { id: release.id, manifestDigest: release.image.manifestDigest, platformDigest: release.image.platformDigest }, sampling,
  };
  samplingBinding(binding);
  const related = facts.relatedBindings;
  const refs = facts.taskDefinition.containerDefinitions?.flatMap(c => c.secrets ?? []).map(s => s.valueFrom) ?? [];
  const env = facts.taskDefinition.containerDefinitions?.find(c => c.name === facts.service.loadBalancers?.[0]?.containerName)?.environment ?? [];
  const matchesEnv = (name: string, value: string) => env.filter(e => e.name === name).length === 1 && env.some(e => e.name === name && e.value === value);
  if (related.database !== sampling.database.identifier || related.schemaVersion !== sampling.database.schemaVersion ||
    related.persistenceEvidence !== sampling.persistence.verificationSha256 ||
    ![related.cell, related.platform, related.dns].every(hash => /^[a-f0-9]{64}$/.test(hash)) ||
    !matchesEnv(sampling.persistence.providerVariable, "s3") || !matchesEnv(sampling.persistence.bucketVariable, sampling.persistence.bucket) ||
    !sampling.secrets.some(s => s.arn === facts.parameters.TenantRuntimeSecretArn) ||
    !refs.length || refs.some(ref => !sampling.secrets.some(s => ref?.startsWith(s.arn + ":") && ref.endsWith(":" + s.versionId))) ||
    sampling.secrets.some(s => related[s.arn] !== s.versionId || !refs.some(ref => ref?.startsWith(s.arn + ":") && ref.endsWith(":" + s.versionId)))) {
    throw Error("FIRST_ONBOARDING_D2_SAMPLING_CHANGED");
  }
  return canonicalJson(binding);
}

/**
 * Reviewed, server-autocommit statement for the original held job only.
 * No retries, role setup, DDL, or production connection is provided here.
 * No state change follows a conflicting insert; a partial row count aborts
 * the whole statement, including the D2 INSERT.
 */
export const COMPLETE_FIRST_ONBOARDING = `WITH input AS MATERIALIZED (
  SELECT $1::jsonb AS request, $2::text AS binding_text, $3::text AS lease_token
), locked AS MATERIALIZED (
  SELECT j.id AS job_id, d.id AS deployment_id, a.id AS instance_id, j.lease_expires_at,
    s.current_period_start, s.current_period_end, p.finished_at, a.slug,
    i.request AS req, i.binding_text::jsonb AS binding
  FROM input i
  JOIN public.deployment_jobs j ON j.id=i.request->>'jobId'
  JOIN public.app_instance_deployments d ON d.id=j.deployment_id
  JOIN public.app_instances a ON a.id=d.app_instance_id
  JOIN public.subscriptions s ON s.id=a.subscription_id AND s.id=d.subscription_id AND s.workspace_id=a.workspace_id AND s.product_id=a.product_id
  JOIN public.workspaces w ON w.id=a.workspace_id
  JOIN public.deployment_environments e ON e.id=d.environment_id
  JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
  JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation
    AND o.epoch=r.external_operation_epoch
  JOIN public.deployment_step_runs p ON p.job_id=j.id AND p.deployment_id=d.id AND p.attempt=j.attempts
  JOIN deployment_release.releases l ON l.id=i.request#>>'{jobPayload,scope,releaseId}'
  WHERE j.status='running' AND j.job_type='apply' AND j.attempts=1 AND j.max_attempts=1
    AND j.dedupe_key='${FIRST_ONBOARDING_PREFIX}' || a.id AND j.available_at=${FIRST_ONBOARDING_HOLD_AT}
    AND j.lease_owner='first-onboarding:' || j.id AND j.lease_token=i.lease_token AND j.completed_at IS NULL
    AND j.payload::jsonb=i.request->'jobPayload' AND i.request#>>'{jobPayload,kind}'='sandbox_first_onboarding_v1'
    AND d.status='verifying' AND d.current_step='control_verify' AND d.ready_at IS NULL
    AND d.id=i.request#>>'{jobPayload,scope,deploymentId}' AND d.plan_hash=i.request#>>'{jobPayload,scope,planHash}'
    AND d.configuration_hash=i.request#>>'{jobPayload,scope,configurationHash}'
    AND d.desired_plan::jsonb=i.request->'desiredPlan' AND d.environment_id=i.request#>>'{jobPayload,scope,environmentId}'
    AND d.mode='aws_sandbox' AND d.driver='aws_ecs_cell' AND d.workflow_version='v1' AND d.cell_key='cell-sandbox-1'
    AND d.deployment_profile_key='standard-v1' AND d.artifact_ref=i.request#>>'{jobPayload,scope,artifactRef}'
    AND d.outputs::jsonb->>'stackId'=i.request#>>'{receipt,runtime,stackId}' AND d.outputs::jsonb->>'stackOperation'='create'
    AND NOT EXISTS (SELECT 1 FROM public.app_instance_deployments other WHERE other.app_instance_id=a.id AND other.id<>d.id)
    AND NOT EXISTS (SELECT 1 FROM public.deployment_jobs other WHERE other.deployment_id=d.id AND other.id<>j.id)
    AND a.status='pending' AND a.provisioning_source='payment_success' AND a.provisioned_at IS NULL AND a.access_url=''
    AND a.id=i.request#>>'{jobPayload,scope,appInstanceId}' AND a.tenant_key=i.request#>>'{jobPayload,scope,tenantKey}'
    AND a.workspace_id=i.request#>>'{jobPayload,scope,workspaceId}' AND a.product_id=i.request#>>'{jobPayload,scope,productId}'
    AND a.template_version_id=i.request#>>'{jobPayload,scope,templateVersionId}' AND a.template_version_id=s.template_version_id
    AND a.configuration_snapshot::jsonb=i.request->'configuration' AND s.instance_configuration::jsonb=a.configuration_snapshot::jsonb
    AND s.status='active' AND s.id=i.request#>>'{jobPayload,scope,subscriptionId}' AND s.plan_id=i.request#>>'{jobPayload,scope,planId}'
    AND s.deployment_profile_key='standard-v1' AND w.status='active'
    AND e.key='aws-sandbox-ca-central-1' AND e.status='active' AND e.kind='aws_sandbox' AND e.apply_enabled=0
    AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1' AND e.expected_account_id=i.request#>>'{jobPayload,scope,accountId}'
    AND r.generation=1 AND r.owner_deployment_id=d.id AND r.lifecycle_status='verified'
    AND r.ownership_marker=i.request#>>'{fence,ownershipMarker}' AND r.baseline_digest=i.request->>'baselineDigest'
    AND o.state='active' AND o.intent='provision' AND o.owner_deployment_id=d.id AND o.created_by_job_id=j.id AND o.created_by_attempt=1
    AND o.marker=i.request#>>'{fence,marker}' AND o.operation_hash=i.request#>>'{fence,operationHash}'
    AND p.step_key='first_onboarding_independent_inspection' AND p.status='succeeded' AND p.input_hash=i.request->>'inspectionInputHash'
    AND p.output::jsonb=i.request->'receipt' AND p.output::jsonb#>>'{runtime,persistentUploadsReady}'='true'
    AND p.output::jsonb->>'outcome'='TECHNICALLY_VERIFIED' AND p.output::jsonb->>'jobId'=j.id
    AND encode(sha256(convert_to(i.binding_text,'UTF8')),'hex')=p.output::jsonb->>'initialBindingSha256'
    AND p.output::jsonb->>'hostname'=a.slug || '.sandbox.techlong.cloud'
    AND l.status='ecr_verified' AND l.product_id=a.product_id AND l.component='tenant_api'
    AND l.document || jsonb_build_object('status',l.status)=i.request->'catalog'
  FOR UPDATE OF j,d,a,s,w,e,r,o,p FOR SHARE OF l
), timed AS MATERIALIZED (
  SELECT locked.*, floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms FROM locked
), eligible AS MATERIALIZED (
  SELECT *, jsonb_build_object('kind','first_onboarding_v1','jobId',job_id,
    'bindingSha256',req#>>'{receipt,initialBindingSha256}','approvalSha256',req#>>'{receipt,approvalSha256}',
    'inspectionInputHash',req->>'inspectionInputHash') AS evidence
  FROM timed WHERE now_ms<(req->>'writeBefore')::bigint AND now_ms<lease_expires_at
    AND current_period_start<=now_ms AND current_period_end>now_ms AND finished_at<=now_ms
), inserted AS (
  INSERT INTO deployment_release.instance_state(instance_id,component,binding,current_release_id,revision,active_request_id,last_evidence)
  SELECT instance_id,'tenant_api',binding,req#>>'{jobPayload,scope,releaseId}',0,NULL,evidence FROM eligible
  ON CONFLICT (instance_id) DO NOTHING RETURNING instance_id
), activated AS (
  UPDATE public.app_instances a SET status='active',access_url='https://' || (e.req#>>'{receipt,hostname}'),
    provisioned_at=e.now_ms,suspended_at=NULL,updated_at=e.now_ms
  FROM eligible e JOIN inserted i ON i.instance_id=e.instance_id WHERE a.id=e.instance_id RETURNING a.id
), ready AS (
  UPDATE public.app_instance_deployments d SET status='ready',current_step='ready',ready_at=e.now_ms,updated_at=e.now_ms,
    control_payload_hash=d.configuration_hash,
    outputs=(d.outputs::jsonb || jsonb_build_object('firstOnboarding',e.evidence,'tenantHostname',e.req#>>'{receipt,hostname}'))::text
  FROM eligible e JOIN activated a ON a.id=e.instance_id WHERE d.id=e.deployment_id RETURNING d.id
), completed AS (
  UPDATE public.deployment_jobs j SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
    completed_at=e.now_ms,updated_at=e.now_ms
  FROM eligible e JOIN ready d ON d.id=e.deployment_id WHERE j.id=e.job_id RETURNING j.id
)
SELECT i.instance_id AS "instanceId", 1 / CASE WHEN (SELECT count(*) FROM activated)=1
  AND (SELECT count(*) FROM ready)=1 AND (SELECT count(*) FROM completed)=1 THEN 1 ELSE 0 END AS committed
FROM inserted i`;

/** Only proves a known commit of this exact seed. No row is not permission to replay. */
export const READ_FIRST_ONBOARDING_COMPLETION = `SELECT a.id AS "instanceId",s.revision
  FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id
  JOIN public.app_instances a ON a.id=d.app_instance_id JOIN deployment_release.instance_state s ON s.instance_id=a.id
  WHERE j.id=$1 AND d.id=$2 AND a.id=$3 AND j.status='succeeded' AND j.completed_at IS NOT NULL AND j.lease_token IS NULL
    AND d.status='ready' AND a.status='active' AND a.provisioned_at=d.ready_at AND d.ready_at=j.completed_at
    AND a.access_url='https://' || (d.outputs::jsonb->>'tenantHostname')
    AND s.revision=0 AND s.active_request_id IS NULL AND s.last_evidence=d.outputs::jsonb->'firstOnboarding'
    AND s.last_evidence->>'bindingSha256'=$4 AND s.last_evidence->>'jobId'=j.id`;

/** Must return only after autocommit is acknowledged; never retry an unknown submission. */
export type FirstOnboardingCompletionWriter = (sql: typeof COMPLETE_FIRST_ONBOARDING, bindings: [string, string, string]) =>
  Promise<{ instanceId: string; committed: number } | null>;
