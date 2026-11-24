import { buildFirstOnboardingJob, FIRST_ONBOARDING_HOLD_AT, reviewFirstOnboarding, SELECT_FIRST_ONBOARDING,
  type FirstOnboardingReview, type FirstOnboardingReviewRow } from "../../lib/deployments/first-onboarding.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenSqlJson } from "../../lib/deployments/execution/first-onboarding-sql-value.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { deriveFirstOpenTaskRelease, firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import type { SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const hex = /^[a-f0-9]{64}$/;
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const owner = "neondb_owner";
const catalogOwner = "deployment_release_owner";
const request = prepared.scope;
const catalog = "deployment_release.releases";
const jobs = "public.deployment_jobs";
const deployments = "public.app_instance_deployments";
const deny = (code: string): never => { throw Error("FIRST_OPEN_TASK_REBIND_" + code); };

/** Render only. The caller needs a separate install approval and exact
 * current hold review; an ambiguous COMMIT is read back, never retried. */
export async function firstOpenTaskRebindStatements(input: {
  oldReview: FirstOnboardingReview; originalRelease: SoftwareRelease; taskRelease: FirstOpenTaskRelease;
  approvedTaskReleaseSha256: string; trustedPublication: { reviewSha256: string; proofSha256: string }; writeBefore: number;
}, now = Date.now()) {
  const { oldReview, originalRelease, taskRelease, approvedTaskReleaseSha256, trustedPublication, writeBefore } = structuredClone(input);
  const next = firstOpenVersion(taskRelease), old = firstOpenVersion();
  const { appInstanceId, workspaceId, subscriptionId, environmentId, planId, templateVersionId, tenantKey,
    planHash, configurationHash, releaseId, artifactRef, accountId } = oldReview.payload.scope;
  const held = await buildFirstOnboardingJob({ appInstanceId, workspaceId, subscriptionId, environmentId, planId, templateVersionId, tenantKey,
    planHash, configurationHash, releaseId, artifactRef, accountId });
  const oldReviewExpected = { payload: oldReview.payload, jobId: s.jobId, catalogSha256: oldReview.catalogSha256,
    platformDigest: oldReview.platformDigest };
  if (!held || oldReview.jobId !== s.jobId || held.jobId !== s.jobId || held.deploymentId !== s.deploymentId ||
    canonicalJson(oldReview.payload) !== canonicalJson(held.payload) || oldReview.cloudExecutionAuthorized !== false ||
    ![oldReview.reviewSha256, oldReview.catalogSha256, approvedTaskReleaseSha256].every(v => hex.test(v)) ||
    oldReview.reviewSha256 !== await sha256Hex(oldReviewExpected) || oldReview.catalogSha256 !== await sha256Hex(originalRelease) ||
    oldReview.platformDigest !== old.imageDigest || appInstanceId !== s.instanceId || subscriptionId !== s.subscriptionId ||
    environmentId !== s.environmentId || tenantKey !== `pending_${s.instanceId}` || accountId !== s.account ||
    await sha256Hex(workspaceId) !== s.workspaceSha256 || planHash !== request.planSha256 ||
    configurationHash !== request.configurationSha256 || releaseId !== old.releaseId || artifactRef !== old.artifactRef ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(writeBefore) || writeBefore <= now || writeBefore - now > 3_600_000 ||
    taskRelease.firstOpenScope.publication.publishedAt > now) return deny("HELD_PREIMAGE");
  if (await sha256Hex(taskRelease) !== approvedTaskReleaseSha256 ||
    canonicalJson(await deriveFirstOpenTaskRelease(originalRelease, taskRelease.firstOpenScope.publication, trustedPublication)) !== canonicalJson(taskRelease)) {
    return deny("RELEASE_SEAL");
  }
  const newPayload = { ...held.payload, scope: { ...held.payload.scope, releaseId: next.releaseId, artifactRef: next.artifactRef } };
  const boundTask = `j.id=${quote(s.jobId)} AND j.dedupe_key=${quote(held.dedupeKey)} AND j.deployment_id=d.id
  AND j.job_type='apply' AND j.status='pending' AND j.attempts=0 AND j.max_attempts=1 AND j.available_at=${FIRST_ONBOARDING_HOLD_AT}
  AND j.lease_owner IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.completed_at IS NULL
  AND d.id=${quote(s.deploymentId)} AND d.app_instance_id=${quote(s.instanceId)} AND d.environment_id=${quote(s.environmentId)}
  AND d.subscription_id=${quote(s.subscriptionId)} AND d.status='planned' AND d.plan_hash=${quote(planHash)}
  AND d.configuration_hash=${quote(configurationHash)}`;
  const noHistory = `NOT EXISTS (SELECT 1 FROM public.deployment_tenant_resources x WHERE x.app_instance_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations x WHERE x.app_instance_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM public.deployment_step_runs x WHERE x.deployment_id=d.id OR x.job_id=j.id)
  AND NOT EXISTS (SELECT 1 FROM ${deployments} x WHERE x.app_instance_id=a.id AND x.id<>d.id)
  AND NOT EXISTS (SELECT 1 FROM ${jobs} x WHERE x.deployment_id=d.id AND x.id<>j.id)`;
  const readHeld = `SELECT j.id AS "jobId",d.id AS "deploymentId",j.payload::jsonb#>>'{scope,releaseId}' AS "releaseId",d.artifact_ref AS "artifactRef"
FROM ${jobs} j JOIN ${deployments} d ON d.id=j.deployment_id
WHERE ${boundTask}
  AND d.artifact_ref=${quote(next.artifactRef)} AND j.payload::jsonb=${firstOpenSqlJson(newPayload)}`;
  const readRelease = `SELECT l.id AS "releaseId",l.document AS release FROM ${catalog} l
WHERE l.id=${quote(next.releaseId)} AND l.status='candidate' AND l.product_id=${quote(s.productId)} AND l.component='tenant_api'
  AND l.document=${firstOpenSqlJson(taskRelease)}`;
  const readReview = SELECT_FIRST_ONBOARDING
    .replace(/\b(FROM|JOIN) (deployment_jobs|app_instance_deployments|app_instances|workspaces|subscriptions|deployment_environments|deployment_tenant_resources)\b/g, "$1 public.$2")
    .replace("$1", quote(s.jobId)) + `
  AND ${boundTask}
  AND d.artifact_ref=${quote(next.artifactRef)} AND j.payload::jsonb=${firstOpenSqlJson(newPayload)}`;
  const statements = ["SET LOCAL search_path TO pg_catalog", "SET LOCAL lock_timeout TO '3s'", "SET LOCAL statement_timeout TO '20s'",
    `DO $preimage$
BEGIN
  IF (current_database()='neondb' AND current_user='${owner}' AND session_user=current_user
      AND (SELECT oid FROM pg_catalog.pg_database WHERE datname='neondb')=16396
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND oid=16392 AND rolcreaterole AND NOT rolsuper)
      AND floor(extract(epoch FROM clock_timestamp())*1000)<${writeBefore}) IS NOT TRUE
  THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_IDENTITY_OR_WINDOW'; END IF;
  IF (EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
        WHERE n.nspname='deployment_release' AND n.oid=237571 AND c.relname='releases' AND c.oid=237572
          AND c.relkind='r' AND pg_get_userbyid(c.relowner)='${catalogOwner}' AND NOT c.relrowsecurity)
      AND NOT pg_has_role(current_user,'${catalogOwner}','SET')
      AND NOT pg_has_role(current_user,'${catalogOwner}','USAGE')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=16392 AND m.admin_option AND m.grantor<>16392
        AND m.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${catalogOwner}'))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=16392 AND m.grantor=16392 AND m.admin_option
        AND m.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${catalogOwner}'))) IS NOT TRUE
  THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_CATALOG_OWNER_PREIMAGE'; END IF;
  PERFORM set_config('techlong.first_open_rebind_member',
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=16392 AND m.grantor=16392
      AND m.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${catalogOwner}')) THEN 'existing' ELSE 'new' END,true);
  PERFORM 1 FROM ${jobs} j JOIN ${deployments} d ON d.id=j.deployment_id
  JOIN public.app_instances a ON a.id=d.app_instance_id
  JOIN public.workspaces w ON w.id=a.workspace_id
  JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id AND sub.workspace_id=a.workspace_id AND sub.product_id=a.product_id
  JOIN public.deployment_environments e ON e.id=d.environment_id
  WHERE ${boundTask}
    AND d.artifact_ref=${quote(old.artifactRef)} AND j.payload::jsonb=${firstOpenSqlJson(held.payload)}
    AND d.mode='aws_sandbox' AND d.driver='aws_ecs_cell' AND d.workflow_version='v1'
    AND d.cell_key='cell-sandbox-1' AND d.deployment_profile_key='standard-v1' AND d.started_at IS NULL AND d.ready_at IS NULL
    AND a.status='pending' AND a.provisioning_source='payment_success' AND a.provisioned_at IS NULL AND a.access_url=''
    AND a.tenant_key=${quote(tenantKey)} AND a.template_version_id=${quote(templateVersionId)} AND a.product_id=${quote(s.productId)}
    AND a.workspace_id=${quote(workspaceId)} AND a.slug=${quote(s.hostname.split(".")[0]!)} AND w.status='active'
    AND sub.status='active' AND sub.plan_id=${quote(planId)} AND sub.template_version_id=${quote(templateVersionId)}
    AND sub.current_period_start<=floor(extract(epoch FROM clock_timestamp())*1000) AND sub.current_period_end>${writeBefore}
    AND sub.deployment_profile_key='standard-v1' AND sub.instance_configuration::jsonb=a.configuration_snapshot::jsonb
    AND e.key='aws-sandbox-ca-central-1' AND e.kind='aws_sandbox' AND e.status='active' AND e.apply_enabled=0
    AND e.region=${quote(s.region)} AND e.expected_account_id=${quote(s.account)} AND e.cell_key='cell-sandbox-1'
    AND ${noHistory}
  FOR UPDATE OF j,d,a,w,sub,e;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_HELD_TASK_CHANGED'; END IF;
END $preimage$`,
    `GRANT ${catalogOwner} TO SESSION_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER`,
    `SET LOCAL ROLE ${catalogOwner}`,
    `DO $catalog$
BEGIN
  IF current_user<>'${catalogOwner}' OR session_user<>'${owner}' OR
     EXISTS (SELECT 1 FROM deployment_release.instance_state WHERE instance_id=${quote(s.instanceId)})
  THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_CATALOG_PREIMAGE'; END IF;
  PERFORM 1 FROM ${catalog} l WHERE l.id=${quote(old.releaseId)}
    AND l.status='ecr_verified' AND l.product_id=${quote(s.productId)} AND l.component='tenant_api'
    AND l.document || jsonb_build_object('status',l.status)=${firstOpenSqlJson(originalRelease)}
  FOR SHARE OF l;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_ORIGINAL_RELEASE_CHANGED'; END IF;
  IF floor(extract(epoch FROM clock_timestamp())*1000)>=${writeBefore}
  THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_WINDOW_ELAPSED'; END IF;

  INSERT INTO ${catalog}(id,product_id,component,version,status,document)
    VALUES (${quote(next.releaseId)},${quote(s.productId)},'tenant_api',${quote(taskRelease.version)},'candidate',${firstOpenSqlJson(taskRelease)});
  PERFORM 1 FROM (${readRelease}) matched;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_CATALOG_ACK'; END IF;
END $catalog$`,
    "SET LOCAL ROLE NONE",
    `DO $rebind$
DECLARE changed integer;
BEGIN
  CASE current_setting('techlong.first_open_rebind_member',true)
    WHEN 'existing' THEN GRANT ${catalogOwner} TO SESSION_USER WITH ADMIN FALSE, INHERIT FALSE, SET FALSE GRANTED BY CURRENT_USER;
    WHEN 'new' THEN REVOKE ${catalogOwner} FROM SESSION_USER GRANTED BY CURRENT_USER RESTRICT;
    ELSE RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_CATALOG_OWNER_PREIMAGE';
  END CASE;
  IF pg_has_role(current_user,'${catalogOwner}','SET') OR pg_has_role(current_user,'${catalogOwner}','USAGE') OR
     floor(extract(epoch FROM clock_timestamp())*1000)>=${writeBefore}
  THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_CATALOG_OWNER_OR_WINDOW'; END IF;
  UPDATE ${deployments} SET artifact_ref=${quote(next.artifactRef)}
    WHERE id=${quote(s.deploymentId)} AND artifact_ref=${quote(old.artifactRef)};
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_DEPLOYMENT_ACK'; END IF;
  UPDATE ${jobs} SET payload=${firstOpenSqlJson(newPayload)}::text
    WHERE id=${quote(s.jobId)} AND payload::jsonb=${firstOpenSqlJson(held.payload)};
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_JOB_ACK'; END IF;
  PERFORM 1 FROM (${readHeld}) AS rebound;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_TASK_REBIND_WRITE_READBACK'; END IF;
END $rebind$`];
  return Object.freeze({ jobId: s.jobId, deploymentId: s.deploymentId, releaseId: next.releaseId, artifactRef: next.artifactRef,
    oldReviewSha256: oldReview.reviewSha256, reboundPayloadSha256: await sha256Hex(newPayload), approvedTaskReleaseSha256, writeBefore,
    statements: Object.freeze(statements), independentReadback: Object.freeze({ held: readHeld, catalog: readRelease, review: readReview }),
    executionAuthorized: false as const, standaloneTransactions: 1 as const });
}

/** Verify the separately approved, independently fetched row projections.
 * Does not connect or treat the planned replacement as an observed catalog row. */
export async function verifyFirstOpenTaskRebindReadback(
  rebind: Awaited<ReturnType<typeof firstOpenTaskRebindStatements>>,
  row: FirstOnboardingReviewRow | null,
  observedCatalog: FirstOpenTaskRelease | null,
) {
  if (!row || !observedCatalog || rebind.jobId !== s.jobId || rebind.deploymentId !== s.deploymentId ||
    row.job.id !== s.jobId || row.appInstanceId !== s.instanceId || row.accountId !== s.account ||
    row.environmentId !== s.environmentId || row.subscriptionId !== s.subscriptionId ||
    await sha256Hex(row.workspaceId) !== s.workspaceSha256 || await sha256Hex(row.job.payload) !== rebind.reboundPayloadSha256 ||
    await sha256Hex(observedCatalog) !== rebind.approvedTaskReleaseSha256) return deny("INDEPENDENT_READBACK");
  const v = firstOpenVersion(observedCatalog);
  const configurationHash = await sha256Hex(row.configuration), planHash = await sha256Hex(row.desiredPlan);
  if (rebind.releaseId !== v.releaseId || rebind.artifactRef !== v.artifactRef ||
    configurationHash !== request.configurationSha256 || planHash !== request.planSha256) return deny("INDEPENDENT_READBACK");
  const review = await reviewFirstOnboarding({ ...row, release: observedCatalog, scope: {
    appInstanceId: s.instanceId, workspaceId: row.workspaceId, subscriptionId: s.subscriptionId, environmentId: s.environmentId,
    planId: row.planId, templateVersionId: row.templateVersionId, tenantKey: row.tenantKey, planHash, configurationHash,
    releaseId: v.releaseId, artifactRef: v.artifactRef, accountId: s.account,
  } }, observedCatalog);
  if (!review) return deny("INDEPENDENT_READBACK");
  return { review, configuration: row.configuration, plan: row.desiredPlan };
}
