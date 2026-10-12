import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertDirectFreshV1, assertDirectPhaseV1, validateDirectCostManifestV1, type DirectCostManifestV1 } from "./direct-cost-controls-v1.ts";
import type { RecoverySnapshotV1 } from "./cost-stack-recovery-v1.ts";
import { compilePreparedLifecycleDeploymentReview, type PreparedLifecycleDeploymentReviewInput } from "./tenant-lifecycle-prepared-review.ts";
import { validateSharedCellAuthorityItem } from "./shared-cell-cleanup-authority.ts";
import { compileSharedCellAdmissionDrainIntent } from "./shared-cell-admission-fence.ts";
import { validateSealedCellDrainEventV3 } from "./prepared-sealed-cell-drain-coordinator-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "./sealed-cell-cleanup-lambda-context-v3.ts";

type Json = Record<string, unknown>;
const keyArn = /^arn:aws:kms:ca-central-1:402010193138:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort());
function fail(code: string): never { throw Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export const VERIFIED_DIRECT_COST_OVERRIDE_V1 = freeze({
  manifestSha256: "b9193bbd7959159400e659f14179943a236eadd8f1ff68f13d385a5713155026",
  manifestFileSha256: "82c2156674a12caf8f6d813030a65962acba14715aecb9893c55858919146c71",
  codeSha256: "b8672d4a854a12529f34af29114505afd545a7632c38233a4945996b602927cd",
  settingsSha256: "575a194a1f4e2d8c73ace3f2ab36584aa30bdc19fbbe487ff774b95b4842220d",
  receiptFileSha256: "01c8d5ded73ea995b7f0f9c4a355b73a4ee1e67519842b9188ab1d874d3b65bd",
  independentInspectFileSha256: "15016b4fd2106143c4273b1d5788c1954c635605e03949d1dfb9bde82ad3a3e6",
});

/** Fresh diagnostic evidence, never a deployment/authority capability. Historic
 * write approval may expire; no old Run or write approval is renewed here. */
export async function compileLiveDirectCostReadinessV1(raw: DirectCostManifestV1, value: RecoverySnapshotV1, base: Json, now: number) {
  const m = freeze(structuredClone(raw)), v = structuredClone(value), pin = VERIFIED_DIRECT_COST_OVERRIDE_V1;
  if (m.manifestSha256 !== pin.manifestSha256 || m.codeSha256 !== pin.codeSha256) fail("CELL_PREREQUISITE_UNAPPROVED_COST_OVERRIDE");
  await validateDirectCostManifestV1(m, base, pin.codeSha256);
  const r = await describeVerifiedCostSnapshotV1(m, v, now);
  if (r.settingsSha256 !== pin.settingsSha256) fail("CELL_PREREQUISITE_COST_OVERRIDE_DRIFT");
  return r;
}
/** Test seam after manifest validation; not an activation or install API. */
export async function describeVerifiedCostSnapshotV1(m: DirectCostManifestV1, v: RecoverySnapshotV1, now: number) {
  assertDirectFreshV1(v.observedAt, now); assertDirectFreshV1(v.inventory.observedAt, now); assertDirectPhaseV1(m, v, "complete");
  return freeze({ schemaVersion: 1, protocol: "live-direct-cost-readiness-v1", status: "VERIFIED_CONFIGURATION_WITH_APPROVED_CFN_AMOUNT_OVERRIDE",
    observedAt: v.observedAt, validUntil: Math.min(v.observedAt, v.inventory.observedAt) + 30000,
    approvedOverrideManifestSha256: m.manifestSha256, settingsSha256: await sha256Hex(v.inventory.settings),
    budgetUsd: 50, maxReadUnits: 100, maxWriteUnits: 2, cfnParameterUsd: 10, intentionalCfnAmountDrift: true,
    cfnOwnershipRetained: true, cloudDriftDetectionPerformed: false, budgetIsHardCap: false,
    cloudWrites: 0, runtimeEnabled: false, deploymentAuthorized: false, authorityInstallationAuthorized: false });
}

/** Dedicated ceiling for the existing lifecycle TaskRole only. Reuses the
 * prepared-v2 compiler; no placeholder tenant/Secret/Cell coordinate accepted.
 * Shared ECS ExecutionRole is NOT narrowed, since public tasks also use it. */
export async function compileSingleTenantLifecycleIamV1(raw: {
  deployment: PreparedLifecycleDeploymentReviewInput; generationSecretArn: string; managementKmsKeyArn: string; generationKmsKeyArn: string;
}, now: number) {
  if (!exact(raw, ["deployment", "generationSecretArn", "managementKmsKeyArn", "generationKmsKeyArn"])) fail("CELL_PREREQUISITE_IAM_INPUT_INVALID");
  const input = freeze(structuredClone(raw)), review = await compilePreparedLifecycleDeploymentReview(input.deployment, now);
  const prefix = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${input.deployment.tenantFence.identity.secretName}/g${input.deployment.tenantFence.generation}-`;
  if (!input.generationSecretArn.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(input.generationSecretArn.slice(prefix.length)) ||
    !keyArn.test(input.managementKmsKeyArn) || !keyArn.test(input.generationKmsKeyArn)) fail("CELL_PREREQUISITE_EXACT_SECRET_OR_KEY_REQUIRED");
  const policy = structuredClone(review.taskRolePolicyDraft) as { Version: string; Statement: Json[] };
  const secret = policy.Statement.find(s => s.Sid === "ReadCurrentDatabaseSecrets"); if (!secret) fail("CELL_PREREQUISITE_POLICY_SHAPE_INVALID");
  const secrets = [input.deployment.managementTarget.managementSecretArn, input.generationSecretArn]; secret.Resource = secrets;
  const allActions = [...new Set([...policy.Statement.flatMap(s => s.Action as string[]), "kms:Decrypt"])].sort();
  policy.Statement.unshift({ Sid: "DenyAllOtherActions", Effect: "Deny", NotAction: allActions, Resource: "*" });
  policy.Statement.push({ Sid: "DecryptOnlyTwoSecretsViaSecretsManager", Effect: "Allow", Action: ["kms:Decrypt"],
    Resource: [...new Set([input.managementKmsKeyArn, input.generationKmsKeyArn])].sort(),
    Condition: { StringEquals: { "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:CallerAccount": "402010193138", "kms:EncryptionContext:SecretARN": secrets } } });
  if (Buffer.byteLength(canonicalJson(policy), "utf8") > 6144) fail("CELL_PREREQUISITE_BOUNDARY_QUOTA_EXCEEDED");
  const material = { roleName: "TechlongSandboxTenantLifecycleTaskRole", roleArn: "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
    boundaryName: "TechlongSandboxPreparedLifecycleTaskBoundaryV1", inlinePolicyName: "PreparedSingleTenantLifecycleV1",
    boundaryDocument: policy, inlinePolicyDocument: structuredClone(policy), preparedDeploymentReviewSha256: review.reviewSha256 };
  return freeze({ schemaVersion: 1, protocol: "single-tenant-lifecycle-iam-candidate-v1", mode: "DATA_ONLY_NOT_INSTALLABLE",
    ...material, candidateSha256: await sha256Hex(material), existingExecutionRoleUnchanged: true, oldBoundaryNotDeleted: true,
    narrowsExistingLifecycleRolePermissions: true, requiredIndependentProof: ["current_role_id_trust_attachments_and_default_boundary_version", "both_exact_secret_arns_and_actual_kms_keys",
      "fresh_iam_install_manifest_approval", "independent_installed_boundary_inline_readback", "actual_fargate_effective_permission_acceptance"],
    cloudWrites: 0, permissionsInstallationAuthorized: false, registrationAuthorized: false, activationAuthorized: false, runtimeEnabled: false });
}

/** A post-provision, DISABLED drain schedule fragment. It does NOT authorize
 * deletion or solve automated authority issuance / failed-create cleanup. */
export async function compileDisabledSealedDrainScheduleV3(raw: { provisionItem: unknown; now: number }) {
  if (!exact(raw, ["provisionItem", "now"]) || !Number.isSafeInteger(raw.now) || raw.now <= 0) fail("CELL_PREREQUISITE_SCHEDULE_INPUT_INVALID");
  const input = structuredClone(raw), p = await validateSharedCellAuthorityItem(input.provisionItem);
  if (p.record.state !== "provision_verified") fail("CELL_PREREQUISITE_PROVISION_RECORD_REQUIRED");
  const drain = await compileSharedCellAdmissionDrainIntent(p.record), due = drain.cellExpiresAt;
  if (due <= input.now || due - input.now > 10800000) fail("CELL_PREREQUISITE_FUTURE_SHORT_TTL_REQUIRED");
  const event = validateSealedCellDrainEventV3({ schemaVersion: 3, action: "coordinate_reviewed_sealed_cell_ttl_cleanup_v3",
    expectedProvisionItemSha256: await sha256Hex(p.item), approvedDrainIntentSha256: drain.fenceSha256, certificateSha256: REGISTERED_SEALED_CERTIFICATE_SHA256_V3 });
  const when = new Date(Math.ceil(due / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "");
  const properties = { Name: "techlong-sandbox-cell-sandbox-1-drain-v3", GroupName: "techlong-sandbox-cell", State: "DISABLED",
    ActionAfterCompletion: "NONE", FlexibleTimeWindow: { Mode: "OFF" }, ScheduleExpression: `at(${when})`, ScheduleExpressionTimezone: "UTC",
    Target: { Arn: "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-drain-coordinator",
      RoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole", RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 }, Input: canonicalJson(event) } };
  const material = { stackId: p.record.stackId, provisionItemSha256: await sha256Hex(p.item), event, resource: { Type: "AWS::Scheduler::Schedule", Properties: properties } };
  return freeze({ schemaVersion: 1, protocol: "disabled-sealed-drain-schedule-candidate-v3", ...material, candidateSha256: await sha256Hex(material),
    exactStackIdRequired: true, paidCellApplyReady: false, cloudWrites: 0, scheduleInstallationAuthorized: false, scheduleEnableAuthorized: false, runtimeEnabled: false,
    blockers: ["actual_provisioned_stack_and_authority_readback", "scheduler_invoke_role_and_lambda_async_delivery_review", "v3_authority_journal_exact_delete_permissions",
      "post_drain_zero_evidence_and_deletion_authority_issuance", "failed_create_compensation_and_live_cleanup_acceptance"] });
}
