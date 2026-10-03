import { canonicalJson, sha256Hex } from "./hash.ts";
import { renderB5CellLifecycleManagementTemplate } from "../../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";

const account = "402010193138";
const region = "ca-central-1";
const sourceArn = `arn:aws:iam::${account}:user/techlong-sandbox-dev`;
const shape = "AuthorCompensationDeleteChangeSetGrant";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("IAM review requires a JSON object.");
  return value as Record<string, unknown>;
}
function freeze<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function visit(item: unknown): void {
    if (item && typeof item === "object") { Object.values(item).forEach(visit); Object.freeze(item); }
  }
  visit(copy);
  return copy;
}
type Decision = "allowed" | "implicitDeny" | "explicitDeny";
type Context = { ContextKeyName: string; ContextKeyValues: string[]; ContextKeyType: "string" | "date" };
export interface CompensationIamSimulationRequest {
  PolicyInputList: string[];
  PermissionsBoundaryPolicyInputList: string[];
  ActionNames: string[];
  ResourceArns: string[];
  ContextEntries: Context[];
}

/** Draft-only, using synthetic context. Never certifies CloudFormation context semantics. */
export async function compileSharedCellAuthorCompensationIamReview(templateBody: string) {
  if (typeof templateBody !== "string" || Buffer.byteLength(templateBody, "utf8") > 51_200) throw new Error("IAM review template exceeds the bounded direct-body size.");
  const template = object(JSON.parse(templateBody));
  const metadata = object(object(template.Metadata).SafetyBoundary);
  if (metadata.OperatorGrantState !== shape.toUpperCase() || metadata.CloudApplyEnabled !== false ||
      metadata.CompensationChangeSetArnRequestIamConditionCompatibilityVerified !== false) throw new Error("Only the default-off split DeleteChangeSet candidate is reviewable.");
  function text(key: string): string {
    if (typeof metadata[key] !== "string") throw new Error(`Missing renderer metadata ${key}.`);
    return metadata[key] as string;
  }
  const reproduced = await renderB5CellLifecycleManagementTemplate({
    shape, approvedChangeSetName: text("ApprovedChangeSetName"),
    approvedTemplateSha256: text("ApprovedTemplateSha256"),
    approvedTemplateCanonicalSha256: text("ApprovedTemplateCanonicalSha256"),
    approvedCellExpiresAt: text("ApprovedCellExpiresAt"),
    grantReviewedAt: text("GrantReviewedAt"), grantExpiresAt: text("GrantExpiresAt"),
    approvedStackId: text("ApprovedStackId"), approvedChangeSetArn: text("ApprovedChangeSetArn"),
    approvedCompensationPlanSha256: text("ApprovedCompensationPlanSha256"),
    compensationReviewedAt: text("CompensationReviewedAt"), compensationExpiresAt: text("CompensationExpiresAt"),
  });
  if (canonicalJson(template) !== canonicalJson(JSON.parse(reproduced))) throw new Error("IAM review candidate must exactly reproduce the deterministic renderer.");
  const resources = object(template.Resources);
  const policy = object(object(object(resources.CellOperatorBoundary).Properties).PolicyDocument);
  const policyJson = canonicalJson(policy);
  const arn = text("ApprovedChangeSetArn");
  const stack = text("ApprovedStackId");
  const reviewedMs = Date.parse(text("CompensationReviewedAt"));
  const expiryMs = Date.parse(text("CompensationExpiresAt"));
  const cutoffMs = expiryMs - 600_000;
  const otherArn = (value: string) => value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
  const contexts = (name: string | null, time: number, selectedRegion = region): Context[] => [
    { ContextKeyName: "aws:RequestedRegion", ContextKeyValues: [selectedRegion], ContextKeyType: "string" },
    { ContextKeyName: "aws:CurrentTime", ContextKeyValues: [new Date(time).toISOString()], ContextKeyType: "date" },
    ...(name === null ? [] : [{ ContextKeyName: "cloudformation:ChangeSetName", ContextKeyValues: [name], ContextKeyType: "string" as const }]),
  ];
  function test(id: string, action: string, decision: Decision, name = arn as string | null,
    time = reviewedMs, selectedStack = stack, selectedRegion = region) {
    return { id, expectedDecision: decision, expectedMissingContext: name === null ? ["cloudformation:ChangeSetName"] : [],
      request: { PolicyInputList: [policyJson], PermissionsBoundaryPolicyInputList: [policyJson],
        ActionNames: [`cloudformation:${action}`], ResourceArns: [selectedStack],
        ContextEntries: contexts(name, time, selectedRegion) } satisfies CompensationIamSimulationRequest };
  }
  const cases = [
    test("exact-arn-delete", "DeleteChangeSet", "allowed"),
    test("short-name-delete", "DeleteChangeSet", "implicitDeny", text("ApprovedChangeSetName")),
    test("same-name-other-uuid", "DeleteChangeSet", "implicitDeny", otherArn(arn)),
    test("other-stack-uuid", "DeleteChangeSet", "implicitDeny", arn, reviewedMs, otherArn(stack)),
    test("wrong-region", "DeleteChangeSet", "explicitDeny", arn, reviewedMs, stack, "us-east-1"),
    test("before-review", "DeleteChangeSet", "implicitDeny", arn, reviewedMs - 1),
    test("before-cutoff", "DeleteChangeSet", "allowed", arn, cutoffMs - 1),
    test("at-cutoff", "DeleteChangeSet", "implicitDeny", arn, cutoffMs),
    test("missing-change-set-context", "DeleteChangeSet", "implicitDeny", null),
    test("opposite-phase-forbidden", "DeleteStack", "implicitDeny"),
    test("execute-forbidden", "ExecuteChangeSet", "implicitDeny"),
    test("exact-arn-read", "DescribeChangeSet", "allowed"),
    test("read-at-expiry", "DescribeChangeSet", "implicitDeny", arn, expiryMs),
  ];
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j8" as const,
    mode: "CUSTOM_POLICY_REVIEW" as const, templateBody,
    templateRawSha256: await sha256Hex(templateBody), templateCanonicalSha256: await sha256Hex(canonicalJson(template)),
    operatorPolicySha256: await sha256Hex(policyJson), account, region, sourceArn,
    targetExistenceVerified: false as const, providerContextCompatibilityVerified: false as const,
    cloudApplyEnabled: false as const, runtimeEnabled: false as const, cases };
  return freeze({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type SharedCellAuthorCompensationIamReview = Awaited<ReturnType<typeof compileSharedCellAuthorCompensationIamReview>>;

/** Only two read operations are exposed; no IAM installation or CFN mutation port. */
export interface CompensationIamSimulationPort {
  getCallerIdentity(signal: AbortSignal): Promise<unknown>;
  simulateCustomPolicy(request: CompensationIamSimulationRequest, signal: AbortSignal): Promise<unknown>;
}
export async function inspectSharedCellAuthorCompensationIamReview(
  plan: SharedCellAuthorCompensationIamReview, port: CompensationIamSimulationPort, signal: AbortSignal,
) {
  const reproduced = await compileSharedCellAuthorCompensationIamReview(plan.templateBody);
  if (canonicalJson(reproduced) !== canonicalJson(plan)) throw new Error("IAM review digest or matrix drifted.");
  async function identity() {
    signal.throwIfAborted();
    const value = object(await port.getCallerIdentity(signal));
    if (value.Account !== account || value.Arn !== sourceArn || typeof value.UserId !== "string" || !value.UserId) throw new Error("IAM simulation requires the exact Source caller.");
    return { Account: account, Arn: sourceArn, UserId: value.UserId };
  }
  const before = await identity();
  const observations = [];
  for (const item of plan.cases) {
    signal.throwIfAborted();
    const response = object(await port.simulateCustomPolicy(item.request, signal));
    signal.throwIfAborted();
    if (response.IsTruncated === true || response.Marker || !Array.isArray(response.EvaluationResults) || response.EvaluationResults.length !== 1) throw new Error(`Incomplete simulation for ${item.id}.`);
    const result = object(response.EvaluationResults[0]);
    const boundary = object(result.PermissionsBoundaryDecisionDetail);
    const missing = result.MissingContextValues ?? [];
    if (result.EvalActionName !== item.request.ActionNames[0] || result.EvalResourceName !== item.request.ResourceArns[0] ||
        result.EvalDecision !== item.expectedDecision || !Array.isArray(missing) || canonicalJson([...missing].sort()) !== canonicalJson(item.expectedMissingContext) ||
        boundary.AllowedByPermissionsBoundary !== (item.expectedDecision === "allowed")) throw new Error(`IAM matrix mismatch for ${item.id}; no compatibility gate was enabled.`);
    const requestId = object(response.$metadata).requestId;
    if (typeof requestId !== "string" || !requestId) throw new Error("AWS simulation evidence requires a request ID.");
    observations.push({ id: item.id, requestId, decision: result.EvalDecision as Decision,
      missingContext: missing, allowedByPermissionsBoundary: boundary.AllowedByPermissionsBoundary });
  }
  if (canonicalJson(before) !== canonicalJson(await identity())) throw new Error("Source caller changed during simulation.");
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j8" as const,
    basis: "AWS_IAM_CUSTOM_POLICY_SIMULATION_WITH_SYNTHETIC_CONTEXT" as const,
    observedAt: new Date().toISOString(), reviewSha256: plan.reviewSha256,
    operatorPolicySha256: plan.operatorPolicySha256, caller: before, observations,
    providerContextCompatibilityVerified: false as const, targetExistenceVerified: false as const,
    mutationPerformed: false as const, cloudApplyEnabled: false as const, runtimeEnabled: false as const };
  return freeze({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
