import { canonicalJson, sha256Hex } from "./hash.ts";

export const READONLY_RUNTIME_IAM_TARGETS_V1 = Object.freeze([
  Object.freeze({ role: "TechlongSandboxCellTtlExecutorRole", boundary: "TechlongSandboxCellTtlExecutorBoundaryV3", inline: "RuntimeReadOnlyV3",
    functionName: "techlong-sandbox-cell-ttl-executor-v3", secretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-cleanup-readonly-v3-AWZoLG",
    secretVersionId: "3f8047d4-e357-4d32-ae87-861fda5f8253" }),
  Object.freeze({ role: "TechlongSandboxCellDrainCoordinatorRole", boundary: "TechlongSandboxCellDrainCoordinatorBoundaryV1", inline: "RuntimeReadOnlyV1",
    functionName: "techlong-sandbox-cell-drain-coordinator", secretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-drain-control-QDFwQ9",
    secretVersionId: "72eb93b3-1da0-40a2-a5a1-176e6869ae98" }),
]);
export const READONLY_RUNTIME_IAM_TABLE_V1 = "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority";
const stack = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*";
const source = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
const sha = /^[a-f0-9]{64}$/;
export const READONLY_RUNTIME_IAM_SCOPE_V1 = Object.freeze({
  createsManagedBoundaries: 2, createsNewRoles: 2, putsInlinePoliciesOnlyOnOwnNewRoleIds: 2, iamWriteCallsMaximum: 6,
  mode: "READ_ONLY_AWS_PLUS_EXACT_EXISTING_LOG_STREAM_WRITES", lambdaTrustOnly: true,
  exactSourceFunctionArnAndRegionRequired: true, secretGetOnlyExactArnAndExplicitAwscurrent: true,
  getItemOnlyExactTableAndKeys: true, noDdbPutUpdateDeleteConditionCheckQueryScanOrAuthorityInstall: true,
  noDeleteStackPassRoleAssumeRoleOrIamMutationInRuntimeRole: true,
  noLegacyIamFunctionsSchedulesSecretsOrDatabaseModified: true,
  noLambdaLogGroupCellEcsOrScheduleCreationOrInvocation: true,
  secretReadWouldExposeExistingDrainColumnWriteCapabilityToFutureApprovedFunction: true,
  directIamApiNoCloudFormationAutomaticRollback: true, noAutomaticDeleteRevokeResetOrApplicationSdkWriteRetry: true,
  partialFailureMayLeaveIamResources: true, permanentSlot: "techlong-f3b3-readonly-runtime-iam-v1-consumed",
  sourceFunctionAllowPathNotProvedBySimulator: true, liveReadProofRequiredBeforeAnyMutationGrant: true,
  iamRoleIdChecksAreNotServerSideCompareAndSwap: true,
  monthlyBudgetTargetUsd: 50, runtimeEnabled: false,
});
export class ReadonlyRuntimeIamErrorV1 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new ReadonlyRuntimeIamErrorV1(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function fresh(at: number, now: number) { if (!Number.isSafeInteger(at) || at <= 0 || at > now || now - at > 30_000) fail("READONLY_IAM_EVIDENCE_STALE"); }
function exact(v: unknown, keys: string[]) { return v && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson(keys.sort()); }
export function readonlyRuntimeIamTagsV1(approval: string) {
  if (!sha.test(approval)) fail("READONLY_IAM_APPROVAL_TAG_INVALID");
  return [{ Key: "ApprovalSha256", Value: approval }, { Key: "Environment", Value: "sandbox" },
    { Key: "Project", Value: "Techlong" }, { Key: "Purpose", Value: "readonly-runtime-iam-v1" }];
}
export function readonlyRuntimeIamDocumentsV1(index: number) {
  const t = READONLY_RUNTIME_IAM_TARGETS_V1[index]; if (!t) fail("READONLY_IAM_TARGET_INVALID");
  const functionArn = `arn:aws:lambda:ca-central-1:402010193138:function:${t.functionName}`;
  const logArn = `arn:aws:logs:ca-central-1:402010193138:log-group:/aws/lambda/${t.functionName}:log-stream:*`;
  const leading = index === 0 ? ["cell:cell-sandbox-1", "sealed-cell-ttl-v3:cell:cell-sandbox-1",
    `sealed-cell-ttl-v3:intent:${"?".repeat(64)}`, `sealed-cell-ttl-v3:receipt:${"?".repeat(64)}`] : ["cell:cell-sandbox-1"];
  const cf = ["cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources"];
  const actions = ["sts:GetCallerIdentity", "secretsmanager:GetSecretValue", "dynamodb:GetItem", "logs:CreateLogStream", "logs:PutLogEvents",
    ...(index === 0 ? ["cloudformation:ListStacks", ...cf] : [])];
  const condition = { ArnEquals: { "lambda:SourceFunctionArn": functionArn }, StringEquals: { "aws:RequestedRegion": "ca-central-1" } };
  const statement: Record<string, unknown>[] = [
    { Sid: "DenyAllOtherActions", Effect: "Deny", NotAction: actions, Resource: "*" },
    { Sid: "DenyOtherOrMissingSourceFunction", Effect: "Deny", Action: "*", Resource: "*", Condition: { ArnNotEquals: { "lambda:SourceFunctionArn": functionArn } } },
    { Sid: "DenyOtherRegions", Effect: "Deny", Action: "*", Resource: "*", Condition: { StringNotEquals: { "aws:RequestedRegion": "ca-central-1" } } },
    { Sid: "DenyOtherSecrets", Effect: "Deny", Action: "secretsmanager:GetSecretValue", NotResource: t.secretArn },
    { Sid: "DenyOtherOrMissingSecretStage", Effect: "Deny", Action: "secretsmanager:GetSecretValue", Resource: "*", Condition: { StringNotEquals: { "secretsmanager:VersionStage": "AWSCURRENT" } } },
    { Sid: "DenyOtherTables", Effect: "Deny", Action: "dynamodb:GetItem", NotResource: READONLY_RUNTIME_IAM_TABLE_V1 },
    { Sid: "DenyMissingLeadingKeys", Effect: "Deny", Action: "dynamodb:GetItem", Resource: "*", Condition: { Null: { "dynamodb:LeadingKeys": "true" } } },
    { Sid: "DenyOtherKeys", Effect: "Deny", Action: "dynamodb:GetItem", Resource: "*", Condition: { "ForAnyValue:StringNotLike": { "dynamodb:LeadingKeys": leading } } },
    { Sid: "DenyOtherLogs", Effect: "Deny", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], NotResource: logArn },
    { Sid: "Identity", Effect: "Allow", Action: "sts:GetCallerIdentity", Resource: "*", Condition: condition },
    { Sid: "ReadExactSecret", Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: t.secretArn,
      Condition: { ...condition, StringEquals: { ...condition.StringEquals, "secretsmanager:VersionStage": "AWSCURRENT" } } },
    { Sid: "BoundExistingLogs", Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: logArn, Condition: condition },
  ];
  if (index === 0) statement.push(
    { Sid: "DenyOtherCellStacks", Effect: "Deny", Action: cf, NotResource: stack },
    { Sid: "ReadAllStackNamesForDependencyChecks", Effect: "Allow", Action: "cloudformation:ListStacks", Resource: "*", Condition: condition },
    { Sid: "ReadOnlyNamedCellStack", Effect: "Allow", Action: cf, Resource: stack, Condition: condition },
    { Sid: "AtomicAuthorityRead", Effect: "Allow", Action: "dynamodb:GetItem", Resource: READONLY_RUNTIME_IAM_TABLE_V1,
      Condition: { ...condition, StringEquals: { ...condition.StringEquals, "dynamodb:EnclosingOperation": "TransactGetItems" },
        "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": leading.slice(0, 2) }, Null: { "dynamodb:LeadingKeys": "false" } } },
    { Sid: "DirectJournalRead", Effect: "Allow", Action: "dynamodb:GetItem", Resource: READONLY_RUNTIME_IAM_TABLE_V1,
      Condition: { ...condition, "ForAllValues:StringLike": { "dynamodb:LeadingKeys": leading.slice(2) },
        Null: { "dynamodb:LeadingKeys": "false", "dynamodb:EnclosingOperation": "true" } } },
  );
  else statement.push({ Sid: "DirectProvisionRead", Effect: "Allow", Action: "dynamodb:GetItem", Resource: READONLY_RUNTIME_IAM_TABLE_V1,
    Condition: { ...condition, "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": leading },
      Null: { "dynamodb:LeadingKeys": "false", "dynamodb:EnclosingOperation": "true" } } });
  const policy = { Version: "2012-10-17", Statement: statement };
  if (canonicalJson(policy).length > 6144) fail("READONLY_IAM_POLICY_QUOTA_EXCEEDED");
  return freeze({ trust: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] },
    boundary: policy, identity: structuredClone(policy) });
}
export interface ReadonlyIamInventoryV1 {
  observedAt: number; sourceArn: typeof source;
  policies: { name: string; state: "ABSENT" | "PRESENT"; exactOwnMatch?: boolean }[];
  roles: { name: string; state: "ABSENT" | "PRESENT"; exactOwnMatch?: boolean; roleId?: string }[];
  prerequisitesSha256: string;
}
export interface ReadonlyIamManifestV1 {
  schemaVersion: 1; protocol: "readonly-runtime-iam-install-v1"; codeSha256: string; prerequisitesSha256: string;
  credentialInspectFileSha256: "9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f";
  reviewedAt: number; expiresAt: number; documents: ReturnType<typeof readonlyRuntimeIamDocumentsV1>[];
  targets: typeof READONLY_RUNTIME_IAM_TARGETS_V1; scope: typeof READONLY_RUNTIME_IAM_SCOPE_V1; manifestSha256: string;
}
function inventoryShape(r: ReadonlyIamInventoryV1) {
  if (!exact(r, ["observedAt", "sourceArn", "policies", "roles", "prerequisitesSha256"]) || r.sourceArn !== source || !sha.test(r.prerequisitesSha256) ||
    r.roles.length !== 2 || r.policies.length !== 2 || r.roles.some((x, i) => x.name !== READONLY_RUNTIME_IAM_TARGETS_V1[i].role || !["ABSENT", "PRESENT"].includes(x.state)) ||
    r.policies.some((x, i) => x.name !== READONLY_RUNTIME_IAM_TARGETS_V1[i].boundary || !["ABSENT", "PRESENT"].includes(x.state))) fail("READONLY_IAM_INVENTORY_INVALID");
}
function absent(r: ReadonlyIamInventoryV1) { inventoryShape(r); if ([...r.roles, ...r.policies].some(x => x.state !== "ABSENT")) fail("READONLY_IAM_RESOURCES_ALREADY_PRESENT_INSPECT_ONLY"); }
export async function compileReadonlyIamManifestV1(input: { inventory: ReadonlyIamInventoryV1; codeSha256: string; now: number }) {
  absent(input.inventory); fresh(input.inventory.observedAt, input.now);
  const body = { schemaVersion: 1 as const, protocol: "readonly-runtime-iam-install-v1" as const, codeSha256: input.codeSha256,
    prerequisitesSha256: input.inventory.prerequisitesSha256, credentialInspectFileSha256: "9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f" as const,
    reviewedAt: input.now, expiresAt: input.now + 3_600_000, documents: [readonlyRuntimeIamDocumentsV1(0), readonlyRuntimeIamDocumentsV1(1)],
    targets: READONLY_RUNTIME_IAM_TARGETS_V1, scope: READONLY_RUNTIME_IAM_SCOPE_V1 };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateReadonlyIamManifestV1(m, input.codeSha256); return m;
}
export async function validateReadonlyIamManifestV1(m: ReadonlyIamManifestV1, codeSha256: string) {
  if (!exact(m, ["schemaVersion", "protocol", "codeSha256", "prerequisitesSha256", "credentialInspectFileSha256", "reviewedAt", "expiresAt", "documents", "targets", "scope", "manifestSha256"]) ||
    m.schemaVersion !== 1 || m.protocol !== "readonly-runtime-iam-install-v1" || !sha.test(codeSha256) || m.codeSha256 !== codeSha256 || !sha.test(m.prerequisitesSha256) ||
    m.credentialInspectFileSha256 !== "9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3_600_000 ||
    canonicalJson(m.documents) !== canonicalJson([readonlyRuntimeIamDocumentsV1(0), readonlyRuntimeIamDocumentsV1(1)]) ||
    canonicalJson(m.targets) !== canonicalJson(READONLY_RUNTIME_IAM_TARGETS_V1) || canonicalJson(m.scope) !== canonicalJson(READONLY_RUNTIME_IAM_SCOPE_V1)) fail("READONLY_IAM_MANIFEST_INVALID");
  const { manifestSha256, ...body } = m; if (!sha.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("READONLY_IAM_MANIFEST_HASH_INVALID");
}
function approved(m: ReadonlyIamManifestV1, approval: string, now: number) {
  if (approval !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now >= m.expiresAt) fail("READONLY_IAM_FRESH_APPROVAL_REQUIRED");
}
export interface ReadonlyIamInstallPortsV1 {
  now(): number; inventory(approval: string): Promise<ReadonlyIamInventoryV1>;
  claimSlot(): Promise<void>; saveMarker(name: string, value: Record<string, unknown>): Promise<void>;
  createBoundary(index: number, approval: string): Promise<{ arn: string; name: string; version: string }>;
  createRole(index: number, approval: string): Promise<{ arn: string; name: string; roleId: string; boundaryArn: string }>;
  verifyNewEmptyRole(index: number, roleId: string, approval: string): Promise<void>;
  putOwnRolePolicy(index: number, roleId: string): Promise<void>;
}
export async function runReadonlyIamInstallV1(input: { manifest: ReadonlyIamManifestV1; approvedSha: string; codeSha256: string; ports: ReadonlyIamInstallPortsV1 }) {
  const m = freeze(structuredClone(input.manifest)), p = input.ports; await validateReadonlyIamManifestV1(m, input.codeSha256); approved(m, input.approvedSha, p.now());
  let slotConsumed = false, calls = 0, stage = "READONLY_PREFLIGHT"; const created: Record<string, unknown>[] = [];
  try {
    const r = await p.inventory(m.manifestSha256); absent(r); fresh(r.observedAt, p.now());
    if (r.prerequisitesSha256 !== m.prerequisitesSha256) fail("READONLY_IAM_PREREQUISITES_DRIFT");
    approved(m, input.approvedSha, p.now()); await p.claimSlot(); slotConsumed = true; await p.saveMarker("approved-manifest.json", m as unknown as Record<string, unknown>);
    const attempt = async (name: string, details: Record<string, unknown>) => {
      stage = name; approved(m, input.approvedSha, p.now()); await p.saveMarker(`${name}-attempt.json`, { manifestSha256: m.manifestSha256, ...details });
      approved(m, input.approvedSha, p.now()); if (++calls > 6) fail("READONLY_IAM_CALL_LIMIT");
    };
    for (let i = 0; i < 2; i++) {
      const t = m.targets[i]; await attempt(`boundary-${i + 1}`, { name: t.boundary }); const r = await p.createBoundary(i, m.manifestSha256);
      if (r.arn !== `arn:aws:iam::402010193138:policy/${t.boundary}` || r.name !== t.boundary || r.version !== "v1") fail("READONLY_IAM_BOUNDARY_RESPONSE_UNKNOWN");
      created.push({ kind: "boundary", ...r }); await p.saveMarker(`boundary-${i + 1}-confirmed.json`, r);
    }
    for (let i = 0; i < 2; i++) {
      const t = m.targets[i]; await attempt(`role-${i + 1}`, { name: t.role }); const r = await p.createRole(i, m.manifestSha256);
      if (r.arn !== `arn:aws:iam::402010193138:role/${t.role}` || r.name !== t.role || !/^AROA[A-Z0-9]{17}$/.test(r.roleId) ||
        r.boundaryArn !== `arn:aws:iam::402010193138:policy/${t.boundary}`) fail("READONLY_IAM_ROLE_RESPONSE_UNKNOWN");
      created.push({ kind: "role", ...r }); await p.saveMarker(`role-${i + 1}-confirmed.json`, r);
      stage = `verify-role-${i + 1}`; await p.verifyNewEmptyRole(i, r.roleId, m.manifestSha256);
      await attempt(`inline-${i + 1}`, { role: t.role, roleId: r.roleId, policy: t.inline }); await p.putOwnRolePolicy(i, r.roleId);
      created.push({ kind: "inline", role: t.role, roleId: r.roleId, policy: t.inline });
    }
    return freeze({ outcome: "READONLY_IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, iamWriteCalls: calls, created,
      failureStage: null, failureCode: null, retryAuthorized: false, runtimeEnabled: false });
  } catch (error) {
    return freeze({ outcome: "READONLY_IAM_STOPPED_INSPECT_ONLY", slotConsumed, iamWriteCalls: calls, created, failureStage: stage,
      failureCode: error instanceof ReadonlyRuntimeIamErrorV1 ? error.code : "IAM_RESULT_NOT_VERIFIED", retryAuthorized: false, runtimeEnabled: false });
  }
}
export function inspectReadonlyIamInventoryV1(r: ReadonlyIamInventoryV1, m: ReadonlyIamManifestV1) {
  inventoryShape(r); const ready = r.prerequisitesSha256 === m.prerequisitesSha256 && [...r.roles, ...r.policies].every(x => x.state === "PRESENT" && x.exactOwnMatch === true);
  return { outcome: ready ? "FOUR_READONLY_IAM_RESOURCES_AND_INLINE_POLICIES_VERIFIED" : "READONLY_IAM_ABSENT_PARTIAL_OR_DRIFT_INSPECT_ONLY",
    observedAt: r.observedAt, inventory: r, iamFoundationReady: ready, runtimeEnabled: false, retryAuthorized: false };
}
