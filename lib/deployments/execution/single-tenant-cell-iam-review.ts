import { ACCEPTANCE_CELL_IAM as targets, compileAcceptanceCellIam } from "./single-tenant-cell-iam.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export const CELL_IAM_INSTALL_RISKS = Object.freeze([
  "The new CloudFormation-only role has active paid Cell capabilities if installed; installation is not Cell deployment approval.",
  "Boundary Resource star is a maximum explicit-action cap, not an identity grant; the exact resource-scoped inline policy supplies permissions.",
  "EC2 generated IDs are unknown before creation: five owned tag keys and regional/account ARN namespaces are used, not immutable UUID permission fencing.",
  "RDS-managed master Secret creation/tagging permits the rds!cluster namespace before its UUID exists; no Secret value read/delete is granted.",
  "IAM does not enforce every template parameter, ACU limit or monthly budget; role trust permits CloudFormation, not only one Source-forwarded path.",
  "Three writes are non-atomic/non-CAS and propagation is not guaranteed; concurrency or expired/refreshed credentials can leave partial IAM resources.",
  "No automatic delete, rollback, completion, permanent-slot reset or write retry; partial installation requires independent read-only inspection.",
  "IAM simulation and policy validation do not prove future provider operations; later exact Cell/DB/DNS/Secret/activation scopes require fresh approval.",
]);
export interface CellIamInventory {
  observedAt: number;
  identity: { Account: string; Arn: string; UserId: string };
  roleAbsent: boolean; boundaryAbsent: boolean;
  serviceLinkedRoles: { rds: string; ecs: string; elb: string };
  keys: { rds: { arn: string; keyManager: string; enabled: boolean }; secrets: { arn: string; keyManager: string; enabled: boolean } };
  sourceInstallSimulationAllowed: boolean;
}
export interface CellIamValidation {
  identityErrors: string[]; boundaryErrors: string[];
  identityWarnings: string[]; boundaryWarnings: string[];
}
export interface CellIamReview {
  schemaVersion: 1; protocol: "single-tenant-cell-iam-install";
  reviewedAt: number; expiresAt: number; codeBindingSha256: string;
  inventory: CellIamInventory; validation: CellIamValidation;
  material: Awaited<ReturnType<typeof compileAcceptanceCellIam>>;
  scope: { maximumIamWrites: 3; createsCell: false; changesExistingIam: false; changesDatabase: false; readsSecretValues: false; enablesRuntime: false };
  risks: typeof CELL_IAM_INSTALL_RISKS; manifestSha256: string;
}
const scope = Object.freeze({ maximumIamWrites: 3 as const, createsCell: false as const, changesExistingIam: false as const,
  changesDatabase: false as const, readsSecretValues: false as const, enablesRuntime: false as const });
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function checkInventory(v: CellIamInventory, now: number) {
  if (!v || !Number.isSafeInteger(v.observedAt) || v.observedAt > now || now - v.observedAt > 30000 ||
    canonicalJson(v.identity) !== canonicalJson({ Account: targets.account, Arn: targets.sourceArn, UserId: targets.sourceUserId }) ||
    v.roleAbsent !== true || v.boundaryAbsent !== true || v.sourceInstallSimulationAllowed !== true ||
    [v.serviceLinkedRoles.rds, v.serviceLinkedRoles.ecs, v.serviceLinkedRoles.elb].some(id => !/^AROA[A-Z0-9]{16,32}$/.test(id)) ||
    [v.keys.rds, v.keys.secrets].some(k => k.keyManager !== "AWS" || k.enabled !== true)) fail("CELL_IAM_FRESH_ABSENT_INVENTORY_REQUIRED");
}
/** IAM returns one aggregate row per action; wrong-resource-type pairs may be
 * implicitDeny. Only the three actual installation pairs are required. */
export function cellIamSourceSimulationAllowed(raw: {
  IsTruncated?: boolean;
  EvaluationResults?: { EvalActionName?: string; EvalDecision?: string; MissingContextValues?: string[];
    ResourceSpecificResults?: { EvalResourceName?: string; EvalResourceDecision?: string }[] }[];
}): boolean {
  const pairs = [["iam:CreatePolicy", targets.boundaryArn], ["iam:CreateRole", targets.roleArn], ["iam:PutRolePolicy", targets.roleArn]];
  if (raw.IsTruncated || raw.EvaluationResults?.length !== pairs.length) return false;
  return pairs.every(([action, resource]) => {
    const rows = raw.EvaluationResults!.filter(r => r.EvalActionName === action);
    if (rows.length !== 1 || rows[0].EvalDecision !== "allowed" || rows[0].MissingContextValues?.length) return false;
    const exact = rows[0].ResourceSpecificResults?.filter(r => r.EvalResourceName === resource);
    return exact?.length === 1 && exact[0].EvalResourceDecision === "allowed";
  });
}
export async function prepareCellIamReview(input: {
  inventory: CellIamInventory; validation: CellIamValidation; codeBindingSha256: string;
}, now = Date.now()): Promise<CellIamReview> {
  const v = structuredClone(input.inventory), validation = structuredClone(input.validation);
  checkInventory(v, now);
  if (!/^[a-f0-9]{64}$/.test(input.codeBindingSha256) || validation.identityErrors.length || validation.boundaryErrors.length) fail("CELL_IAM_POLICY_VALIDATION_OR_BINDING_REJECTED");
  const material = await compileAcceptanceCellIam({ rdsKmsKeyArn: v.keys.rds.arn, secretsKmsKeyArn: v.keys.secrets.arn });
  const body = { schemaVersion: 1 as const, protocol: "single-tenant-cell-iam-install" as const, reviewedAt: now, expiresAt: now + 3600000,
    codeBindingSha256: input.codeBindingSha256, inventory: v, validation, material, scope, risks: CELL_IAM_INSTALL_RISKS };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export async function decodeCellIamReview(raw: unknown): Promise<CellIamReview> {
  const r = raw as CellIamReview;
  if (!r || r.schemaVersion !== 1 || r.protocol !== "single-tenant-cell-iam-install") fail("CELL_IAM_REVIEW_INVALID");
  const expected = await prepareCellIamReview({ inventory: r.inventory, validation: r.validation, codeBindingSha256: r.codeBindingSha256 }, r.reviewedAt);
  if (canonicalJson(expected) !== canonicalJson(r)) fail("CELL_IAM_REVIEW_HASH_OR_SCOPE_INVALID");
  return expected;
}
export interface CellIamInstallPort {
  inventory(signal: AbortSignal): Promise<CellIamInventory>;
  createBoundary(review: CellIamReview, signal: AbortSignal): Promise<{ arn: string; policyId: string }>;
  createRole(review: CellIamReview, signal: AbortSignal): Promise<{ arn: string; roleId: string }>;
  putInline(review: CellIamReview, signal: AbortSignal): Promise<void>;
}
export interface CellIamInstallJournal {
  consume(input: { manifestSha256: string; codeBindingSha256: string }): Promise<void>;
  record(input: Record<string, unknown>): Promise<void>;
}
/** Only the explicitly approved new role/policy. Never repair an existing
 * same-name object or install a fourth action after a partial failure. */
export async function runCellIamInstall(input: {
  review: CellIamReview; approvedManifestSha256: string; currentCodeBindingSha256: string;
  port: CellIamInstallPort; journal: CellIamInstallJournal; signal: AbortSignal; now?: () => number;
}) {
  const review = await decodeCellIamReview(input.review), now = input.now ?? Date.now;
  const approval = () => {
    input.signal.throwIfAborted();
    if (review.manifestSha256 !== input.approvedManifestSha256 || review.codeBindingSha256 !== input.currentCodeBindingSha256 ||
      now() < review.reviewedAt || now() >= review.expiresAt) fail("CELL_IAM_FRESH_EXACT_APPROVAL_REQUIRED");
  };
  approval(); const before = await input.port.inventory(input.signal); approval(); checkInventory(before, now());
  if (canonicalJson({ ...before, observedAt: 0 }) !== canonicalJson({ ...review.inventory, observedAt: 0 })) fail("CELL_IAM_INVENTORY_DRIFT_NO_WRITE");
  await input.journal.consume({ manifestSha256: review.manifestSha256, codeBindingSha256: review.codeBindingSha256 });
  let stage = "CREATE_BOUNDARY", writeStagesEntered = 0;
  const result: Record<string, unknown> = { manifestSha256: review.manifestSha256, codeBindingSha256: review.codeBindingSha256 };
  try {
    approval(); writeStagesEntered++; const p = await input.port.createBoundary(review, input.signal);
    if (p.arn !== targets.boundaryArn || !/^ANPA[A-Z0-9]{16,32}$/.test(p.policyId)) fail("CELL_IAM_BOUNDARY_RESPONSE_INVALID");
    result.boundaryArn = p.arn; result.policyId = p.policyId; await input.journal.record({ ...result, stage, writeStagesEntered });
    stage = "CREATE_ROLE"; approval(); writeStagesEntered++; const r = await input.port.createRole(review, input.signal);
    if (r.arn !== targets.roleArn || !/^AROA[A-Z0-9]{16,32}$/.test(r.roleId)) fail("CELL_IAM_ROLE_RESPONSE_INVALID");
    result.roleArn = r.arn; result.roleId = r.roleId; await input.journal.record({ ...result, stage, writeStagesEntered });
    stage = "PUT_INLINE"; approval(); writeStagesEntered++; await input.port.putInline(review, input.signal);
    const completed = { ...result, outcome: "IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", writeStagesEntered, runtimeEnabled: false, cellDeploymentAuthorized: false };
    await input.journal.record(completed); return completed;
  } catch (e) {
    const raw = e && typeof e === "object" && "code" in e ? String(e.code) : e instanceof Error ? e.name : "ProviderError";
    const failureCode = raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
    const stopped = { ...result, stage, writeStagesEntered, outcome: "PARTIAL_OR_UNCERTAIN_REQUIRES_INSPECT_NO_RETRY", failureCode,
      runtimeEnabled: false, cellDeploymentAuthorized: false };
    await input.journal.record(stopped); return stopped;
  }
}
