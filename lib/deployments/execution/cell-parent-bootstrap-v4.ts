import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_LIFECYCLE_COORDINATOR_V3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { CELL_PARENT_BOUNDARY_V4, CELL_PARENT_TRUST_V4 } from "./cell-birth-parent-v4.ts";
import { CELL_BIRTH_COORDINATOR_ROLE_V3 } from "./cell-birth-registration-v3.ts";

export const CELL_PARENT_BOOTSTRAP_V4 = Object.freeze({
  sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", sourceUserId: "AIDAV3GNMXTZEO7SHLC2X", region: "ca-central-1", account: "402010193138",
  roleName: "TechlongSandboxCellLifecycleCoordinatorRoleV3", roleArn: CELL_BIRTH_COORDINATOR_ROLE_V3,
  boundaryName: "TechlongSandboxCellLifecycleCoordinatorBoundaryV4", boundaryArn: CELL_PARENT_BOUNDARY_V4,
  functionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", functionArn: CELL_LIFECYCLE_COORDINATOR_V3,
  logGroup: "/aws/lambda/techlong-sandbox-cell-lifecycle-coordinator-v3", logRetentionDays: 7,
  bundleSha256: "6ea5a688fbd2b3b9026a4a790c42a48be5a75b2e4c1aa148fc16faae23157bd9",
  zipSha256: "405e6654b9c8ca0c80536f5fcf8caa910e00246ce497c2dedc81c9f63f3be35f",
  zipCodeSha256Base64: "QF5mVLnIygyAU29fz4yqkQ4AJGzkl8Le3IHJ9j87418=",
  code58Sha256: "6675ca6570ed4fcca1521fcd2ea7361f97db94b746627dadbf414be02f26b697",
  bundleReportFileSha256: "db0cd34eded1f75c87f514e03230172c3e27a07f549da46709c2e1d9227e2193",
  localBootstrapSlot: "techlong-f3c9c-control-bootstrap.permanent-slot.json", localRegistrationSlot: "techlong-f3c9c-parent-registration.permanent-slot.json",
});
export const CELL_PARENT_BOOTSTRAP_DENY_V4 = Object.freeze({ Version: "2012-10-17", Statement: [{ Sid: "LockedUntilSeparatelyApproved", Effect: "Deny", Action: "*", Resource: "*" }] });
const scope = Object.freeze({ newBoundary: 1, newLambdaTrustRole: 1, newLogGroup: 1, newFunction: 1, maximumWriteCalls: 6,
  logRetentionDays: 7, reservedConcurrency: 0, runtimeRoleExplicitDenyAll: true, noInlineOrAttachedPolicy: true,
  noFunctionInvocationOrUrlOrTrigger: true, noTablePolicyOrParentWrite: true, noSecretReadOrMutation: true,
  noDatabaseConnectionOrWrite: true, noCellOrEcsOrSchedulerCreation: true, noAutomaticRollbackRetryResetOrDelete: true, monthlyBudgetGoalUsd: 50 });
const risks = Object.freeze({ iamAndLambdaAndLogsNotAtomic: true, roleIdReadNotCas: true, iamPropagationMayFailFunctionCreation: true,
  functionExistsBeforeConcurrencyZeroCall: true, boundaryDenyAllRemainsEvenIfConcurrencyCallFails: true, partialResourcesMayRemain: true,
  providerLogsMayContainIdentifiers: true, permanentLocalSlot: true, nonzeroCost: true, fiftyUsdNotHardCap: true });
export interface CellParentBootstrapInventoryV4 { observedAt: number; boundaryAbsent: boolean; roleAbsent: boolean; functionAbsent: boolean; logGroupAbsent: boolean;
  parentAndAllWorkflowAndRegistrationSlotsAbsent: boolean; cellStackNameAbsent: boolean; sourceIdentityVerified: boolean }
export interface CellParentBootstrapReviewV4 { schemaVersion: 4; protocol: "cell-parent-locked-bootstrap-review-v4"; reviewedAt: number; expiresAt: number;
  targets: typeof CELL_PARENT_BOOTSTRAP_V4; boundary: typeof CELL_PARENT_BOOTSTRAP_DENY_V4; trust: typeof CELL_PARENT_TRUST_V4;
  inventory: CellParentBootstrapInventoryV4; codeBindingSha256: string; scope: typeof scope; risks: typeof risks; manifestSha256: string }
function inventory(v: CellParentBootstrapInventoryV4, now: number) {
  if (!cellV3Exact(v, ["observedAt", "boundaryAbsent", "roleAbsent", "functionAbsent", "logGroupAbsent", "parentAndAllWorkflowAndRegistrationSlotsAbsent", "cellStackNameAbsent", "sourceIdentityVerified"]) ||
    Object.entries(v).some(([k, b]) => k !== "observedAt" && b !== true) || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("CELL_PARENT_BOOTSTRAP_ABSENT_LIVE_INVENTORY_REQUIRED"); cellV3Clock(v.observedAt);
}
export async function prepareCellParentBootstrapReviewV4(v: CellParentBootstrapInventoryV4, codeBindingSha256: string, now: number): Promise<Readonly<CellParentBootstrapReviewV4>> {
  cellV3Clock(now); inventory(v, now); if (!/^[a-f0-9]{64}$/.test(codeBindingSha256)) cellV3Fail("CELL_PARENT_BOOTSTRAP_CODE_BINDING_REQUIRED");
  const body = { schemaVersion: 4 as const, protocol: "cell-parent-locked-bootstrap-review-v4" as const, reviewedAt: now, expiresAt: now + 3600000,
    targets: CELL_PARENT_BOOTSTRAP_V4, boundary: CELL_PARENT_BOOTSTRAP_DENY_V4, trust: CELL_PARENT_TRUST_V4, inventory: v, codeBindingSha256, scope, risks };
  return cellV3Freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeCellParentBootstrapReviewV4(raw: unknown): Promise<Readonly<CellParentBootstrapReviewV4>> {
  const r = raw as CellParentBootstrapReviewV4;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "targets", "boundary", "trust", "inventory", "codeBindingSha256", "scope", "risks", "manifestSha256"]) ||
    r.schemaVersion !== 4 || r.protocol !== "cell-parent-locked-bootstrap-review-v4") cellV3Fail("CELL_PARENT_BOOTSTRAP_REVIEW_INVALID");
  const expected = await prepareCellParentBootstrapReviewV4(r.inventory, r.codeBindingSha256, r.reviewedAt);
  if (canonicalJson(expected) !== canonicalJson(r)) cellV3Fail("CELL_PARENT_BOOTSTRAP_REVIEW_HASH_OR_SCOPE_INVALID"); return expected;
}
export function cellParentBootstrapTagsV4(approvalSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(approvalSha256)) cellV3Fail("CELL_PARENT_BOOTSTRAP_TAG_INVALID");
  return { ApprovalSha256: approvalSha256, Environment: "sandbox", Project: "Techlong", Purpose: "cell-parent-locked-bootstrap-v4" };
}
export function cellParentBootstrapRequestsV4(approvalSha256: string) {
  const tags = cellParentBootstrapTagsV4(approvalSha256), Tags = Object.entries(tags).map(([Key, Value]) => ({ Key, Value })), t = CELL_PARENT_BOOTSTRAP_V4;
  return cellV3Freeze([
    { service: "iam", action: "create-policy", input: { PolicyName: t.boundaryName, Path: "/", PolicyDocument: canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4), Tags } },
    { service: "iam", action: "create-role", input: { RoleName: t.roleName, Path: "/", AssumeRolePolicyDocument: canonicalJson(CELL_PARENT_TRUST_V4), PermissionsBoundary: t.boundaryArn, Tags } },
    { service: "logs", action: "create-log-group", input: { logGroupName: t.logGroup, tags } },
    { service: "logs", action: "put-retention-policy", input: { logGroupName: t.logGroup, retentionInDays: 7 } },
    { service: "lambda", action: "create-function", input: { FunctionName: t.functionName, Runtime: "nodejs22.x", Role: t.roleArn, Handler: "cell-birth-coordinator-v4.handler",
      Timeout: 120, MemorySize: 256, PackageType: "Zip", Architectures: ["x86_64"], Publish: false, Tags: tags } },
    { service: "lambda", action: "put-function-concurrency", input: { FunctionName: t.functionName, ReservedConcurrentExecutions: 0 } },
  ]);
}
export type CellParentBootstrapRequestV4 = ReturnType<typeof cellParentBootstrapRequestsV4>[number];
export interface CellParentBootstrapPortV4 {
  readFreshInventory(): Promise<CellParentBootstrapInventoryV4>;
  verifySourceAndBytes(): Promise<void>;
  claimPermanentLocal(): Promise<boolean>;
  beforeWrite(index: number, request: CellParentBootstrapRequestV4): Promise<void>;
  write(index: number, request: CellParentBootstrapRequestV4): Promise<void>;
  inspectLocked(): Promise<boolean>;
}
/** The sole six-action order used by the actual CLI. Trusted provider adapters
 * enforce role/ZIP/absence fences; this runner never retries or compensates. */
export async function runCellParentBootstrapV4(raw: unknown, approvedSha256: string, currentCodeBindingSha256: string, port: CellParentBootstrapPortV4, now: () => number = Date.now) {
  const r = await decodeCellParentBootstrapReviewV4(raw);
  if (r.manifestSha256 !== approvedSha256 || r.codeBindingSha256 !== currentCodeBindingSha256) cellV3Fail("CELL_PARENT_BOOTSTRAP_EXACT_APPROVAL_REQUIRED");
  const active = () => { const n = cellV3Clock(now()); if (n < r.reviewedAt || n >= r.expiresAt) cellV3Fail("CELL_PARENT_BOOTSTRAP_APPROVAL_EXPIRED"); };
  active(); await port.verifySourceAndBytes(); inventory(await port.readFreshInventory(), now()); active();
  if (!await port.claimPermanentLocal()) return { outcome: "BOOTSTRAP_LOCAL_SLOT_OCCUPIED_NO_RETRY", writesAttempted: 0, runtimeEnabled: false, retryAuthorized: false };
  let writesAttempted = 0;
  for (const [index, request] of cellParentBootstrapRequestsV4(r.manifestSha256).entries()) {
    active(); await port.verifySourceAndBytes(); await port.beforeWrite(index, request); active(); writesAttempted++;
    try { await port.write(index, request); } catch { return { outcome: "BOOTSTRAP_WRITE_UNCERTAIN_INDEPENDENT_INSPECT_ONLY", writesAttempted, runtimeEnabled: false, retryAuthorized: false }; }
  }
  const locked = await port.inspectLocked(); return { outcome: locked ? "LOCKED_BOOTSTRAP_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT" : "BOOTSTRAP_WRITE_UNCERTAIN_INDEPENDENT_INSPECT_ONLY",
    writesAttempted, runtimeEnabled: false, retryAuthorized: false };
}
/** Scope is locked bootstrap ONLY. Full policies, table freeze/window, DB
 * installation, RESERVED, final parent registration and ARMED/PAID have their
 * own subsequent live facts/approval hashes. No fabricated ARN/RoleId/Revision. */
export const CELL_PARENT_INSTALLATION_ORDER_V4 = Object.freeze([
  { phase: "LOCKED_CONTROL_BOOTSTRAP", before: [], writes: "one deny-all boundary, Lambda-only role, 7-day log group, fixed candidate function/concurrency0", approval: "fresh bootstrap SHA", runtimeEnabled: false },
  { phase: "NEON_PROTECTION_AND_CONTROL_GRANTS", before: ["LOCKED_CONTROL_BOOTSTRAP"], writes: "reviewed protection schema + exact existing-role grants; no business row changes", approval: "separate fresh DB SHA", runtimeEnabled: false },
  { phase: "GATE_CAPABLE_PACKAGE_AND_ASYNC_PREPARATION", before: ["NEON_PROTECTION_AND_CONTROL_GRANTS"], writes: "any necessary fixed gate-capable package and asynchronous age/retry settings while locked; no parent or Cell", approval: "separate fresh code/config SHA; final package frozen before registration", runtimeEnabled: false },
  { phase: "RESERVED_IDENTITY", before: ["GATE_CAPABLE_PACKAGE_AND_ASYNC_PREPARATION"], writes: "exact no-resource RESERVED Stack to obtain UUID ARN", approval: "separate fresh CFN SHA", runtimeEnabled: false },
  { phase: "EXACT_ROLE_AND_TABLE_WINDOW", before: ["RESERVED_IDENTITY"], writes: "exact-ARN final role permissions + revision-conditional table freeze/window", approval: "separate fresh IAM/table SHA", runtimeEnabled: false },
  { phase: "FULL_PARENT_REGISTRATION", before: ["EXACT_ROLE_AND_TABLE_WINDOW"], writes: "Source permanent registration-attempt + exact full parent absent-key transaction", approval: "fresh source registration SHA; live metadata/DB/RESERVED proofs", runtimeEnabled: false },
  { phase: "INDEPENDENT_ALLOW_DENY_AND_ASYNC_GATES", before: ["FULL_PARENT_REGISTRATION"], writes: "only separately approved non-mutating/condition-failing probes and concurrency/async/scheduler gates", approval: "fresh exact gate SHA", runtimeEnabled: false },
  { phase: "ARMED_THEN_PAID", before: ["INDEPENDENT_ALLOW_DENY_AND_ASYNC_GATES"], writes: "reviewed scheduler arm then paid Cell", approval: "fresh explicit CFN/resource/cost scope", runtimeEnabled: false },
]);
