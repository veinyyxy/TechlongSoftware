import { stableId } from "../domain/ids.ts";
import { canonicalJson, sha256Hex } from "./execution/hash.ts";
import type { SoftwareRelease } from "./releases/contract.ts";
import type { DeploymentEnvironment } from "./environment.ts";

export const FIRST_ONBOARDING_PREFIX = "first-onboarding:v1:";
export const FIRST_ONBOARDING_HOLD_AT = Number.MAX_SAFE_INTEGER;
export const ordinaryDeploymentJobsOnly = (dedupeKeyColumn: string) =>
  `left(${dedupeKeyColumn}, ${FIRST_ONBOARDING_PREFIX.length}) <> '${FIRST_ONBOARDING_PREFIX}'`;
const productId = "prd_restaurant_order_system";
const environmentKey = "aws-sandbox-ca-central-1";
const kind = "sandbox_first_onboarding_v1";
const digest = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const releaseIdPattern = /^release_[a-f0-9]{32}$/;

/** Express V3 uses these names, only for newly registered held first opens. */
export async function firstOnboardingExpressNames(scope: {
  appInstanceId: string; workspaceId: string; productId: string; environmentId: string; cellKey: string;
}) {
  const { appInstanceId, workspaceId, productId, environmentId, cellKey } = scope;
  const stableIdentity = await sha256Hex({ appInstanceId, workspaceId, productId, environmentId, cellKey });
  const prefix = `tenant_${stableIdentity.slice(0, 16)}`;
  return { stableIdentity, databaseName: `${prefix}_db`, roleName: `${prefix}_role` };
}

export function isFirstOnboardingScope(environment: Pick<DeploymentEnvironment, "key" | "kind" | "region" | "cellKey">, product: string, profile: string) {
  return environment.key === environmentKey && environment.kind === "aws_sandbox" && environment.region === "ca-central-1" &&
    environment.cellKey === "cell-sandbox-1" && product === productId && profile === "standard-v1";
}

/** A held outbox row is tied to the first generation of one instance, not to
 * a delivery, changed plan/configuration, or subsequent subscription. */
export async function buildFirstOnboardingJob(input: {
  appInstanceId: string; workspaceId: string; subscriptionId: string; environmentId: string;
  planId: string; templateVersionId: string; tenantKey: string; planHash: string; configurationHash: string;
  releaseId: string; artifactRef: string | null; accountId: string;
}) {
  const { accountId, ...scope } = input;
  const image = typeof input.artifactRef === "string" && /^\d{12}$/.test(accountId) &&
    new RegExp(`^${accountId}\\.dkr\\.ecr\\.ca-central-1\\.amazonaws\\.com/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$`).test(input.artifactRef);
  if (!image || ![scope.appInstanceId, scope.workspaceId, scope.subscriptionId, scope.environmentId, scope.planId,
    scope.templateVersionId, scope.tenantKey].every(value => id.test(value)) || !digest.test(scope.planHash) ||
    !digest.test(scope.configurationHash) || !releaseIdPattern.test(scope.releaseId)) return null;
  const dedupeKey = FIRST_ONBOARDING_PREFIX + scope.appInstanceId;
  const idempotencyKey = await sha256Hex(dedupeKey);
  const [deploymentId, jobId] = await Promise.all([stableId("dep", idempotencyKey), stableId("job", dedupeKey)]);
  const payload = { kind, scope: { ...scope, generation: 1, deploymentId, productId, accountId }, reviewRequired: true, cloudExecutionAuthorized: false } as const;
  return { deploymentId, jobId, dedupeKey, idempotencyKey, payload, availableAt: FIRST_ONBOARDING_HOLD_AT };
}

type HeldJob = NonNullable<Awaited<ReturnType<typeof buildFirstOnboardingJob>>>;

/** One statement: no new deployment unless the original payment-created
 * instance/subscription still match; a conflict does not insert a sibling job. */
export const INSERT_FIRST_ONBOARDING = `WITH input AS MATERIALIZED (
  SELECT $1::text AS instance_id, $2::text AS workspace_id, $3::text AS subscription_id,
    $4::text AS environment_id, $5::text AS plan_id, $6::text AS template_version_id,
    $7::text AS tenant_key, $8::text AS configuration, $9::text AS purchase_order_id,
    $10::text AS deployment_id, $11::text AS desired_plan, $12::text AS plan_hash,
    $13::text AS configuration_hash, $14::text AS artifact_ref, $15::text AS idempotency_key,
    $16::text AS job_id, $17::text AS dedupe_key, $18::text AS payload, $19::bigint AS hold_at,
    $20::text AS account_id, (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
), eligible AS MATERIALIZED (
  SELECT i.* FROM input i
  JOIN app_instances a ON a.id=i.instance_id AND a.workspace_id=i.workspace_id AND a.subscription_id=i.subscription_id
  JOIN subscriptions s ON s.id=a.subscription_id AND s.workspace_id=a.workspace_id AND s.product_id=a.product_id
  JOIN workspaces w ON w.id=a.workspace_id AND w.status='active'
  JOIN deployment_environments e ON e.id=i.environment_id
  WHERE a.product_id='${productId}' AND a.status='pending' AND a.provisioned_at IS NULL
    AND a.provisioning_source='payment_success' AND a.access_url='' AND a.tenant_key=i.tenant_key
    AND a.template_version_id=i.template_version_id AND a.configuration_snapshot::jsonb=i.configuration::jsonb
    AND s.status='active' AND s.current_period_start<=i.now_ms AND s.current_period_end>i.now_ms
    AND s.plan_id=i.plan_id AND s.template_version_id=i.template_version_id
    AND s.deployment_profile_key='standard-v1' AND s.instance_configuration::jsonb=i.configuration::jsonb
    AND e.key='${environmentKey}' AND e.kind='aws_sandbox' AND e.status='active' AND e.apply_enabled=0
    AND e.expected_account_id=i.account_id AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1'
    AND NOT EXISTS (SELECT 1 FROM app_instance_deployments d WHERE d.app_instance_id=a.id)
    AND NOT EXISTS (SELECT 1 FROM deployment_tenant_resources r WHERE r.app_instance_id=a.id)
  FOR UPDATE OF a,s
), registered AS (
  INSERT INTO app_instance_deployments (
    id,app_instance_id,subscription_id,purchase_order_id,environment_id,driver,workflow_version,cell_key,
    deployment_profile_key,mode,status,desired_plan,plan_hash,configuration_hash,idempotency_key,artifact_ref,created_at,updated_at
  ) SELECT deployment_id,instance_id,subscription_id,purchase_order_id,environment_id,'aws_ecs_cell','v1','cell-sandbox-1',
    'standard-v1','aws_sandbox','planned',desired_plan,plan_hash,configuration_hash,idempotency_key,artifact_ref,now_ms,now_ms
    FROM eligible ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
)
INSERT INTO deployment_jobs (id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,available_at,created_at,updated_at)
SELECT i.job_id,r.id,'apply',i.dedupe_key,'pending',i.payload,0,1,i.hold_at,i.now_ms,i.now_ms
FROM registered r JOIN input i ON i.deployment_id=r.id RETURNING id`;

export function firstOnboardingInsertBindings(job: HeldJob, input: { configuration: string; desiredPlan: string; purchaseOrderId: string | null }) {
  const s = job.payload.scope;
  return [s.appInstanceId, s.workspaceId, s.subscriptionId, s.environmentId, s.planId, s.templateVersionId, s.tenantKey,
    input.configuration, input.purchaseOrderId, s.deploymentId, input.desiredPlan, s.planHash, s.configurationHash,
    s.artifactRef, job.idempotencyKey, job.jobId, job.dedupeKey, canonicalJson(job.payload), job.availableAt, s.accountId];
}

export interface FirstOnboardingReviewFacts {
  /** Trusted current database projection, never taken from the payment request. */
  scope: Parameters<typeof buildFirstOnboardingJob>[0];
  instancePendingFirstOpen: boolean;
  subscriptionActiveAndCurrent: boolean;
  scopeStillEligible: boolean;
  noOtherDeploymentOrTenantGeneration: boolean;
  deployment: { id: string; status: string; planHash: string; configurationHash: string; artifactRef: string | null };
  job: { id: string; deploymentId: string; dedupeKey: string; jobType: string; status: string; payload: unknown;
    attempts: number; maxAttempts: number; availableAt: number; leaseOwner: string | null; leaseToken: string | null;
    leaseExpiresAt: number | null; completedAt: number | null };
  /** D2's trusted catalog entry, read separately with an approved reader. */
  release: SoftwareRelease | null;
}

/** Prepares material for review only, never claims a row or admits cloud execution. */
export async function reviewFirstOnboarding(facts: FirstOnboardingReviewFacts) {
  const expected = await buildFirstOnboardingJob(facts.scope);
  const { deployment: d, job: j, release: r } = facts;
  if (!expected || !facts.instancePendingFirstOpen || !facts.subscriptionActiveAndCurrent || !facts.scopeStillEligible || !facts.noOtherDeploymentOrTenantGeneration ||
    d.id !== expected.deploymentId || d.status !== "planned" || d.planHash !== facts.scope.planHash ||
    d.configurationHash !== facts.scope.configurationHash || d.artifactRef !== facts.scope.artifactRef ||
    j.id !== expected.jobId || j.deploymentId !== expected.deploymentId || j.dedupeKey !== expected.dedupeKey || j.jobType !== "apply" ||
    j.status !== "pending" || j.attempts !== 0 || j.maxAttempts !== 1 || j.availableAt !== FIRST_ONBOARDING_HOLD_AT ||
    j.leaseOwner !== null || j.leaseToken !== null || j.leaseExpiresAt !== null || j.completedAt !== null ||
    canonicalJson(j.payload) !== canonicalJson(expected.payload)) return null;
  if (!r || r.id !== facts.scope.releaseId || r.productId !== productId || r.component !== "tenant_api" || r.status !== "ecr_verified" ||
    `${r.image.repository}@${r.image.manifestDigest}` !== facts.scope.artifactRef || r.image.runtimePlatform !== "linux/amd64" ||
    !/^sha256:[a-f0-9]{64}$/.test(r.image.platformDigest) || !digest.test(r.image.verificationSha256) ||
    !r.compatibility.databaseProfiles.includes("express_iam") || r.compatibility.requiresMigration || r.compatibility.startupWrites) return null;
  const material = { payload: expected.payload, jobId: j.id, catalogSha256: await sha256Hex(r), platformDigest: r.image.platformDigest };
  return { ...material, reviewSha256: await sha256Hex(material), cloudExecutionAuthorized: false as const };
}

export const SELECT_FIRST_ONBOARDING = `SELECT
  a.id AS "appInstanceId", a.workspace_id AS "workspaceId", a.tenant_key AS "tenantKey", a.configuration_snapshot::jsonb AS configuration,
  a.slug AS slug, s.current_period_end AS "subscriptionEnd",
  s.id AS "subscriptionId", s.plan_id AS "planId", s.template_version_id AS "templateVersionId", e.id AS "environmentId", e.expected_account_id AS "accountId",
  (a.status='pending' AND a.provisioned_at IS NULL AND a.provisioning_source='payment_success' AND a.access_url='') AS "instancePendingFirstOpen",
  (d.subscription_id IS NOT DISTINCT FROM s.id AND a.template_version_id IS NOT DISTINCT FROM s.template_version_id AND s.status='active'
    AND s.current_period_start<=clock.now_ms AND s.current_period_end>clock.now_ms AND s.instance_configuration::jsonb=a.configuration_snapshot::jsonb) AS "subscriptionActiveAndCurrent",
  (a.product_id='${productId}' AND w.status='active' AND s.deployment_profile_key='standard-v1' AND d.deployment_profile_key='standard-v1'
    AND d.mode='aws_sandbox' AND d.driver='aws_ecs_cell' AND d.workflow_version='v1' AND d.cell_key='cell-sandbox-1'
    AND e.key='${environmentKey}' AND e.kind='aws_sandbox' AND e.status='active' AND e.apply_enabled=0
    AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1') AS "scopeStillEligible",
  (NOT EXISTS(SELECT 1 FROM app_instance_deployments other WHERE other.app_instance_id=a.id AND other.id<>d.id)
    AND NOT EXISTS(SELECT 1 FROM deployment_jobs sibling WHERE sibling.deployment_id=d.id AND sibling.id<>j.id)
    AND NOT EXISTS(SELECT 1 FROM deployment_tenant_resources resource WHERE resource.app_instance_id=a.id)) AS "noOtherDeploymentOrTenantGeneration",
  d.desired_plan::jsonb AS "desiredPlan",
  jsonb_build_object('id',d.id,'status',d.status,'planHash',d.plan_hash,'configurationHash',d.configuration_hash,'artifactRef',d.artifact_ref) AS deployment,
  jsonb_build_object('id',j.id,'deploymentId',j.deployment_id,'dedupeKey',j.dedupe_key,'jobType',j.job_type,'status',j.status,'payload',j.payload::jsonb,
    'attempts',j.attempts,'maxAttempts',j.max_attempts,'availableAt',j.available_at,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,
    'leaseExpiresAt',j.lease_expires_at,'completedAt',j.completed_at) AS job
FROM deployment_jobs j JOIN app_instance_deployments d ON d.id=j.deployment_id
JOIN app_instances a ON a.id=d.app_instance_id JOIN workspaces w ON w.id=a.workspace_id
JOIN subscriptions s ON s.id=a.subscription_id AND s.workspace_id=a.workspace_id AND s.product_id=a.product_id
JOIN deployment_environments e ON e.id=d.environment_id
CROSS JOIN LATERAL (SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms) clock
WHERE j.id=$1 AND NOT (${ordinaryDeploymentJobsOnly("j.dedupe_key")})`;

export type FirstOnboardingReviewRow = Omit<FirstOnboardingReviewFacts, "scope" | "release"> &
  Omit<FirstOnboardingReviewFacts["scope"], "configurationHash" | "planHash" | "artifactRef" | "releaseId"> &
  { configuration: unknown; desiredPlan: unknown; slug: string; subscriptionEnd: number | string };

/** A future scoped operator supplies an approved read-only projection and the
 * trusted release catalog reader; this module creates neither connection. */
export async function loadFirstOnboardingReview(jobId: string, ports: {
  readOne: (sql: string, parameters: [string]) => Promise<FirstOnboardingReviewRow | null>;
  readRelease: (id: string) => Promise<SoftwareRelease | null>;
}) {
  if (!/^job_[a-f0-9]{24}$/.test(jobId)) return null;
  const row = await ports.readOne(SELECT_FIRST_ONBOARDING, [jobId]);
  if (!row || row.job.id !== jobId) return null;
  const { appInstanceId, workspaceId, tenantKey, subscriptionId, planId, templateVersionId, environmentId, accountId, job } = row;
  const releaseId = (job.payload as { scope?: { releaseId?: unknown } } | null)?.scope?.releaseId;
  if (typeof releaseId !== "string" || !releaseIdPattern.test(releaseId)) return null;
  const scope = { appInstanceId, workspaceId, tenantKey, subscriptionId, planId, templateVersionId, environmentId, accountId,
    releaseId, artifactRef: row.deployment.artifactRef, configurationHash: await sha256Hex(row.configuration), planHash: await sha256Hex(row.desiredPlan) };
  // Do not load catalog evidence for unrelated, stale or already consumed jobs.
  const expected = await buildFirstOnboardingJob(scope);
  if (!expected || job.status !== "pending" || job.attempts !== 0 || canonicalJson(job.payload) !== canonicalJson(expected.payload) ||
    !row.instancePendingFirstOpen || !row.subscriptionActiveAndCurrent || !row.scopeStillEligible || !row.noOtherDeploymentOrTenantGeneration) return null;
  return reviewFirstOnboarding({ ...row, scope, release: await ports.readRelease(releaseId) });
}

export type FirstOnboardingReview = NonNullable<Awaited<ReturnType<typeof loadFirstOnboardingReview>>>;

/** Exact one-shot claim. Leave the held payload and namespace unchanged. The
 * row selected for review is locked and compared again before consumption. */
export const CLAIM_FIRST_ONBOARDING = `WITH eligible AS MATERIALIZED (
  ${SELECT_FIRST_ONBOARDING} FOR UPDATE OF j,d,a,s,w,e
), db_clock AS MATERIALIZED (
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
  FROM eligible
)
UPDATE deployment_jobs j SET status='running',attempts=1,lease_owner=$2,lease_token=$3,
  lease_expires_at=$4::bigint,updated_at=t.now_ms
FROM eligible c CROSS JOIN db_clock t
WHERE j.id=$1 AND j.deployment_id=$5 AND j.status='pending' AND j.attempts=0 AND j.max_attempts=1
  AND j.available_at=${FIRST_ONBOARDING_HOLD_AT} AND j.lease_owner IS NULL AND j.lease_token IS NULL
  AND j.lease_expires_at IS NULL AND j.completed_at IS NULL
  AND t.now_ms<$4::bigint AND c."instancePendingFirstOpen" AND c."subscriptionActiveAndCurrent"
  AND c."scopeStillEligible" AND c."noOtherDeploymentOrTenantGeneration"
  AND c.configuration=$6::jsonb AND c."desiredPlan"=$7::jsonb AND c.deployment=$8::jsonb AND c.job=$9::jsonb
  AND c."appInstanceId"=$10 AND c."workspaceId"=$11 AND c."subscriptionId"=$12 AND c."tenantKey"=$13
  AND c."environmentId"=$14 AND c."accountId"=$15 AND c."planId"=$16 AND c."templateVersionId"=$17
  AND c.slug=$18 AND c."subscriptionEnd">$4::bigint
RETURNING j.id AS "jobId"`;

export function firstOnboardingClaimBindings(review: FirstOnboardingReview, row: FirstOnboardingReviewRow,
  workerId: string, leaseToken: string, writeBefore: number) {
  const s = review.payload.scope;
  return [review.jobId, workerId, leaseToken, writeBefore, s.deploymentId, canonicalJson(row.configuration),
    canonicalJson(row.desiredPlan), canonicalJson(row.deployment), canonicalJson(row.job), s.appInstanceId, s.workspaceId,
    s.subscriptionId, s.tenantKey, s.environmentId, s.accountId, s.planId, s.templateVersionId, row.slug];
}
