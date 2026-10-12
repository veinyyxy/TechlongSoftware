import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, decodeCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE, CELL_LIFECYCLE_COORDINATOR_V3, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { decodeCellBirthDelegationV3, type CellBirthDelegationV3 } from "./cell-birth-lifecycle-v3.ts";
import { CELL_BIRTH_COORDINATOR_ROLE_V3 } from "./cell-birth-registration-v3.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 } from "./failed-cell-birth-ddb-v1.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { assertCellParentInstallationV4, type CellParentInstallationV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";

export const CELL_PARENT_KEY_V4 = "cell-birth-v4:parent:cell:cell-sandbox-1";
export const CELL_PARENT_BOUNDARY_V4 = "arn:aws:iam::402010193138:policy/TechlongSandboxCellLifecycleCoordinatorBoundaryV4";
export const CELL_PARENT_INLINE_V4 = "CellBirthParentV4";
export const CELL_PARENT_TABLE_ID_V4 = "58c851f4-5b8e-45ce-8933-05c33b17fb21";
export const CELL_PARENT_SCOPE_V4 = Object.freeze({ publishProvisionOnce: true, beginAdmissionDrainOnce: true, issueTtlAuthorityOnce: true,
  invokeTtlExecutorOnce: true, fenceFailedBirthOnce: true, deleteFailedBirthOnce: true,
  publishActivation: false, enableTenantRuntime: false, createOrUpdateCellStack: false, resetReplaceOrRetry: false });
export interface CellParentRuntimeBindingV4 {
  functionArn: typeof CELL_LIFECYCLE_COORDINATOR_V3; functionVersion: "$LATEST"; revisionId: string;
  zipCodeSha256Base64: string; bundleSha256: string; roleId: string; boundaryVersionId: string;
  tablePolicyRevisionId: string; tablePolicySha256: string; sourceWindowClosesAt: number;
}
const digest = /^[a-f0-9]{64}$/, reviews = new WeakSet<object>();
export const CELL_PARENT_TRUST_V4 = Object.freeze({ Version: "2012-10-17", Statement: [
  { Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" },
] });

/** Conservative pre-tenant write freeze. No LeadingKeys deny whose batch/
 * transaction interpretation could silently leave an escape. Existing reads
 * remain unchanged. This affects ALL old table writers, not only the Cell key.
 * Source registers the parent during an explicitly approved short Source-only
 * window; coordinator publication stays blocked until that window closes.
 * Later tenant writers require another explicit policy/role approval. */
export function cellParentTableFreezePolicyV4(sourceWindowClosesAt: number) {
  cellV3Clock(sourceWindowClosesAt);
  const source = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
  return cellV3Freeze({ Version: "2012-10-17", Statement: [
    { Sid: "FreezeLegacyAuthorityDataMutation", Effect: "Deny", Principal: "*", Action: [
      "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem",
      "dynamodb:PartiQLInsert", "dynamodb:PartiQLUpdate", "dynamodb:PartiQLDelete",
    ], Resource: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
    Condition: { ArnNotEquals: { "aws:PrincipalArn": [CELL_BIRTH_COORDINATOR_ROLE_V3, source] } } },
    { Sid: "FreezeSourceAfterRegistrationWindow", Effect: "Deny", Principal: "*", Action: [
      "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem",
      "dynamodb:PartiQLInsert", "dynamodb:PartiQLUpdate", "dynamodb:PartiQLDelete",
    ], Resource: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
    Condition: { ArnEquals: { "aws:PrincipalArn": source }, DateGreaterThanEquals: { "aws:CurrentTime": new Date(sourceWindowClosesAt).toISOString() } } },
  ] });
}
/** Complete-parent permission DATA. Neither this compiler nor the table freeze
 * installs IAM. Code/role/parent scope remain independently checked at runtime.
 * No authority-table UpdateItem/DeleteItem or activation/parent Put capability. */
export function cellParentIamDocumentsV4(stackId: string) {
  if (!/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(stackId)) cellV3Fail("CELL_PARENT_EXACT_STACK_ARN_REQUIRED");
  const table = SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN, fn = CELL_LIFECYCLE_COORDINATOR_V3;
  const read = [CELL_PARENT_KEY_V4, ...Object.values(FAILED_BIRTH_DDB_KEYS_V1), "sealed-cell-ttl-v3:cell:cell-sandbox-1"];
  const writes = [FAILED_BIRTH_DDB_KEYS_V1.provision, FAILED_BIRTH_DDB_KEYS_V1.marker, FAILED_BIRTH_DDB_KEYS_V1.intent, FAILED_BIRTH_DDB_KEYS_V1.receipt,
    "cell-birth-v4:drain-intent:cell:cell-sandbox-1", "cell-birth-v4:drain-receipt:cell:cell-sandbox-1", "sealed-cell-ttl-v3:cell:cell-sandbox-1"];
  const cf = ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents", "cloudformation:GetTemplate", "cloudformation:ListStackResources", "cloudformation:DeleteStack"];
  const iamRead = ["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:GetRolePolicy", "iam:GetPolicy", "iam:GetPolicyVersion"];
  const actions = ["sts:GetCallerIdentity", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:ConditionCheckItem", "dynamodb:DescribeTable", "dynamodb:GetResourcePolicy",
    "lambda:GetFunctionConfiguration", ...iamRead,
    "cloudformation:ListStacks", ...cf, "iam:PassRole", "logs:CreateLogStream", "logs:PutLogEvents"];
  const statement = [
    { Sid: "DenyOtherActions", Effect: "Deny", NotAction: actions, Resource: "*" },
    { Sid: "DenyOtherOrMissingSource", Effect: "Deny", Action: "*", Resource: "*", Condition: { ArnNotEquals: { "lambda:SourceFunctionArn": fn } } },
    // IAM is global; its exact self-read actions are not subject to the regional
    // service deny. They still require the exact Lambda source and own resource.
    { Sid: "DenyOtherRegions", Effect: "Deny", NotAction: iamRead, Resource: "*", Condition: { StringNotEquals: { "aws:RequestedRegion": "ca-central-1" } } },
    // Source and regional restrictions are explicit global Denies above, not
    // optional Allow conditions repeated on every statement.
    { Sid: "Identity", Effect: "Allow", Action: "sts:GetCallerIdentity", Resource: "*" },
    { Sid: "ReadAuthorityMetadata", Effect: "Allow", Action: ["dynamodb:DescribeTable", "dynamodb:GetResourcePolicy"], Resource: table },
    { Sid: "ReadExactOwnFunction", Effect: "Allow", Action: "lambda:GetFunctionConfiguration", Resource: fn },
    { Sid: "ReadExactOwnRole", Effect: "Allow", Action: ["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:GetRolePolicy"], Resource: CELL_BIRTH_COORDINATOR_ROLE_V3 },
    { Sid: "ReadExactOwnBoundary", Effect: "Allow", Action: ["iam:GetPolicy", "iam:GetPolicyVersion"], Resource: CELL_PARENT_BOUNDARY_V4 },
    { Sid: "ReadAllStackNames", Effect: "Allow", Action: "cloudformation:ListStacks", Resource: "*" },
    { Sid: "ExactCellStack", Effect: "Allow", Action: cf, Resource: stackId },
    { Sid: "PassExactCfnRole", Effect: "Allow", Action: "iam:PassRole", Resource: CELL_V3_CFN_ROLE, Condition: { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } } },
    { Sid: "ReadExactAuthorityKeys", Effect: "Allow", Action: "dynamodb:GetItem", Resource: table,
      Condition: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": read }, Null: { "dynamodb:LeadingKeys": "false" } } },
    { Sid: "CheckExactTransactionKeys", Effect: "Allow", Action: "dynamodb:ConditionCheckItem", Resource: table,
      Condition: { StringEquals: { "dynamodb:EnclosingOperation": "TransactWriteItems" },
        "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [...read, ...writes] }, Null: { "dynamodb:LeadingKeys": "false" } } },
    { Sid: "PutExactTransactionKeys", Effect: "Allow", Action: "dynamodb:PutItem", Resource: table,
      Condition: { StringEquals: { "dynamodb:EnclosingOperation": "TransactWriteItems" },
        "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": writes }, Null: { "dynamodb:LeadingKeys": "false" } } },
    { Sid: "ExistingFunctionLogStreams", Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
      Resource: `arn:aws:logs:ca-central-1:402010193138:log-group:/aws/lambda/techlong-sandbox-cell-lifecycle-coordinator-v3:log-stream:*` },
  ];
  const policy = { Version: "2012-10-17", Statement: statement };
  if (Buffer.byteLength(canonicalJson(policy)) > 6144) cellV3Fail("CELL_PARENT_IAM_POLICY_SIZE_INVALID");
  return cellV3Freeze({ trust: CELL_PARENT_TRUST_V4, boundary: policy, inline: structuredClone(policy),
    downstreamSecretAndInvokePermissionsNotIncluded: true, installationAuthorized: false, runtimeEnabled: false });
}
export function validateCellParentBindingV4(v: CellParentRuntimeBindingV4) {
  if (!cellV3Exact(v, ["functionArn", "functionVersion", "revisionId", "zipCodeSha256Base64", "bundleSha256", "roleId", "boundaryVersionId", "tablePolicyRevisionId", "tablePolicySha256", "sourceWindowClosesAt"]) ||
    v.functionArn !== CELL_LIFECYCLE_COORDINATOR_V3 || v.functionVersion !== "$LATEST" || !/^[A-Za-z0-9_-]{16,128}$/.test(v.revisionId) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(v.zipCodeSha256Base64) || !digest.test(v.bundleSha256) || !/^AROA[A-Z0-9]{16,24}$/.test(v.roleId) ||
    !/^v[1-9][0-9]*$/.test(v.boundaryVersionId) || typeof v.tablePolicyRevisionId !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(v.tablePolicyRevisionId) || !digest.test(v.tablePolicySha256)) cellV3Fail("CELL_PARENT_RUNTIME_BINDING_INVALID");
  cellV3Clock(v.sourceWindowClosesAt);
  return cellV3Freeze(structuredClone(v));
}

export async function prepareCellBirthParentReviewV4(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; reserved: CellStackSnapshotV3;
  installation: CellParentInstallationV4; failedProtectionSha256: string; now: number }) {
  if (!cellV3Exact(input, ["plan", "delegation", "reserved", "installation", "failedProtectionSha256", "now"])) cellV3Fail("CELL_PARENT_REVIEW_INPUT_INVALID");
  assertCellStackPlanV3(input.plan); assertCellStackSnapshotV3(input.reserved); cellV3Clock(input.now);
  const d = await decodeCellBirthDelegationV3(input.delegation, input.plan), s = input.reserved;
  assertCellParentInstallationV4(input.installation, input.now);
  if (input.installation.profile !== "source_inspection" || input.installation.stackId !== d.stackId || input.installation.binding.roleId !== d.coordinatorRoleId ||
    input.installation.binding.bundleSha256 !== d.coordinatorCodeSha256 || s.profile !== "source_inspection" || s.phase !== "RESERVED" || s.resources.length ||
    s.failedCreationOrPhase || s.stackId !== d.stackId || s.birthIntentSha256 !== input.plan.birthIntentSha256 || s.templateCanonicalSha256 !== input.plan.templateCanonicalSha256 ||
    s.observedAt > input.now || input.now - s.observedAt > 30000 || input.now < d.notBefore || input.now >= Date.parse(d.cellExpiresAt) || !digest.test(input.failedProtectionSha256) ||
    input.installation.binding.sourceWindowClosesAt <= input.now || input.installation.binding.sourceWindowClosesAt > input.now + 900000) cellV3Fail("CELL_PARENT_REVIEW_LIVE_RESERVED_BINDING_REQUIRED");
  const manifest = cellV3Freeze({ schemaVersion: 4 as const, protocol: "cell-birth-full-parent-review-v4" as const, authorityKey: CELL_PARENT_KEY_V4,
    plan: input.plan, delegation: d, runtimeBinding: input.installation.binding, failedProtectionSha256: input.failedProtectionSha256,
    reservedEvidenceSha256: await sha256Hex(s), installationEvidenceSha256: await sha256Hex(input.installation), reviewedAt: input.now,
    expiresAt: Math.min(input.now + 900000, Date.parse(d.cellExpiresAt), input.installation.binding.sourceWindowClosesAt), scope: CELL_PARENT_SCOPE_V4,
    risks: { permanentSlot: true, fullCleanupRootMustBeCompletedBeforeRegistration: true, legacyTableWritesFrozen: true, policyReadIsEventuallyConsistent: true,
      codeAndIamChecksNotCrossServiceCas: true, parentRegisteredDuringSourceWindow: true, sourceWindowBroadDataWrites: true, noAutomaticWriteRetryOrReset: true, nonzeroCost: true } });
  const review = cellV3Freeze({ manifest, manifestSha256: await sha256Hex(manifest), registrationAuthorized: false, runtimeEnabled: false }); reviews.add(review); return review;
}
export type CellBirthParentReviewV4 = Awaited<ReturnType<typeof prepareCellBirthParentReviewV4>>;
/** Data record only: no registrar is shipped until all cleanup branches and
 * separately approved downstream permissions are actually composed. */
export async function approveCellBirthParentRecordV4(input: { review: CellBirthParentReviewV4; approvedManifestSha256: string; now: number }) {
  if (!cellV3Exact(input, ["review", "approvedManifestSha256", "now"]) || !reviews.has(input.review) || input.approvedManifestSha256 !== input.review.manifestSha256) cellV3Fail("CELL_PARENT_EXACT_REVIEW_APPROVAL_REQUIRED");
  cellV3Clock(input.now); const manifest = input.review.manifest;
  if (input.now < manifest.reviewedAt || input.now >= manifest.expiresAt) cellV3Fail("CELL_PARENT_REVIEW_EXPIRED");
  const body = { schemaVersion: 4 as const, protocol: "approved-cell-birth-full-parent-v4" as const, manifest, approvedManifestSha256: input.approvedManifestSha256, approvedAt: input.now };
  return cellV3Freeze({ ...body, parentSha256: await sha256Hex(body) });
}
export type CellBirthParentRecordV4 = Awaited<ReturnType<typeof approveCellBirthParentRecordV4>>;
export async function decodeCellBirthParentRecordV4(raw: unknown): Promise<Readonly<CellBirthParentRecordV4>> {
  const r = raw as CellBirthParentRecordV4;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "manifest", "approvedManifestSha256", "approvedAt", "parentSha256"]) || r.schemaVersion !== 4 || r.protocol !== "approved-cell-birth-full-parent-v4") cellV3Fail("CELL_PARENT_RECORD_INVALID");
  const m = r.manifest;
  if (!cellV3Exact(m, ["schemaVersion", "protocol", "authorityKey", "plan", "delegation", "runtimeBinding", "failedProtectionSha256", "reservedEvidenceSha256", "installationEvidenceSha256", "reviewedAt", "expiresAt", "scope", "risks"]) ||
    m.schemaVersion !== 4 || m.protocol !== "cell-birth-full-parent-review-v4" || m.authorityKey !== CELL_PARENT_KEY_V4 || canonicalJson(m.scope) !== canonicalJson(CELL_PARENT_SCOPE_V4) ||
    canonicalJson(m.risks) !== canonicalJson({ permanentSlot: true, fullCleanupRootMustBeCompletedBeforeRegistration: true, legacyTableWritesFrozen: true, policyReadIsEventuallyConsistent: true,
      codeAndIamChecksNotCrossServiceCas: true, parentRegisteredDuringSourceWindow: true, sourceWindowBroadDataWrites: true, noAutomaticWriteRetryOrReset: true, nonzeroCost: true }) ||
    [m.failedProtectionSha256, m.reservedEvidenceSha256, m.installationEvidenceSha256, r.approvedManifestSha256, r.parentSha256].some(h => typeof h !== "string" || !digest.test(h))) cellV3Fail("CELL_PARENT_SCOPE_OR_HASH_INVALID");
  const plan = await decodeCellStackPlanV3(m.plan), delegation = await decodeCellBirthDelegationV3(m.delegation, plan), binding = validateCellParentBindingV4(m.runtimeBinding);
  [m.reviewedAt, m.expiresAt, r.approvedAt].forEach(cellV3Clock);
  if (m.reviewedAt < delegation.notBefore || m.reviewedAt >= Date.parse(delegation.cellExpiresAt) || binding.sourceWindowClosesAt <= m.reviewedAt || binding.sourceWindowClosesAt > m.reviewedAt + 900000 ||
    m.expiresAt !== Math.min(m.reviewedAt + 900000, Date.parse(delegation.cellExpiresAt), binding.sourceWindowClosesAt) ||
    r.approvedAt < m.reviewedAt || r.approvedAt >= m.expiresAt || binding.bundleSha256 !== delegation.coordinatorCodeSha256 || binding.roleId !== delegation.coordinatorRoleId ||
    await sha256Hex(cellParentTableFreezePolicyV4(binding.sourceWindowClosesAt)) !== binding.tablePolicySha256 || await sha256Hex(m) !== r.approvedManifestSha256) cellV3Fail("CELL_PARENT_BINDING_OR_TIME_INVALID");
  const { parentSha256, ...body } = r; if (await sha256Hex(body) !== parentSha256) cellV3Fail("CELL_PARENT_RECORD_HASH_INVALID");
  return cellV3Freeze({ ...r, manifest: { ...m, plan, delegation, runtimeBinding: binding } });
}
