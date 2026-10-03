import { canonicalJson, sha256Hex } from "./hash.ts";
import type { CollectedManagementObservation } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import { renderB5CellLifecycleManagementTemplate } from "../../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";

export const ARN_PROBE_FIXTURE_STACK = "techlong-sandbox-arn-compatibility-probe";
export const ARN_PROBE_ACCOUNT = "402010193138";
export const ARN_PROBE_REGION = "ca-central-1";
export const ARN_PROBE_SOURCE = `arn:aws:iam::${ARN_PROBE_ACCOUNT}:user/techlong-sandbox-dev`;
export const ARN_PROBE_EXECUTION_ROLE = `arn:aws:iam::${ARN_PROBE_ACCOUNT}:role/TechlongSandboxCellCloudFormationExecutionRole`;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const stackPattern = new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:stack/${ARN_PROBE_FIXTURE_STACK}/${uuid}$`);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function instant(value: string): number {
  const time = Date.parse(value);
  if (!instantPattern.test(value) || !Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error("Probe timestamps must be canonical UTC instants.");
  return time;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Probe evidence must be a JSON object.");
  return value as Record<string, unknown>;
}
function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} drifted.`);
}
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function visit(item: unknown): void { if (item && typeof item === "object") { Object.values(item).forEach(visit); Object.freeze(item); } }
  visit(copy); return copy;
}
function empty(value: unknown): boolean { return value === undefined || value === null || value === ""; }
function entries(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("Probe inventory is incomplete."); return value; }

/** No network, credentials, paid resource definitions, or execution command. */
export async function compileArnProbeFixturePlan(input: { nonce: string; reviewedAt: string; expiresAt: string }) {
  same(Object.keys(input).sort(), ["expiresAt", "nonce", "reviewedAt"], "Plan input fields");
  if (!/^[a-f0-9]{32}$/.test(input.nonce)) throw new Error("Probe nonce must be 32 lowercase hex characters.");
  const reviewed = instant(input.reviewedAt), expiry = instant(input.expiresAt);
  if (expiry - reviewed < 900_000 || expiry - reviewed > 3_600_000) throw new Error("Probe creation approval window must be 15–60 minutes.");
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "J5g-j9 ARN/IAM context probe fixture. CREATE Change Set only; never execute.",
    Metadata: { SafetyBoundary: { Stage: "B5-J5g-j9", ProbeNonce: input.nonce,
      ChildExecutionAllowed: false, CreatesPaidCell: false, ProviderContextCompatibilityVerified: false } },
    Resources: { ProbeHandle: { Type: "AWS::CloudFormation::WaitConditionHandle" } },
  };
  const templateBody = `${JSON.stringify(template, null, 2)}\n`;
  const templateRawSha256 = await sha256Hex(templateBody);
  const templateCanonicalSha256 = await sha256Hex(canonicalJson(template));
  const operationSha256 = await sha256Hex(canonicalJson({ ...input, stackName: ARN_PROBE_FIXTURE_STACK, templateRawSha256 }));
  const request = {
    StackName: ARN_PROBE_FIXTURE_STACK, ChangeSetName: `${ARN_PROBE_FIXTURE_STACK}-${operationSha256.slice(0, 16)}`,
    ChangeSetType: "CREATE" as const, ClientToken: `j5gj9-create-${operationSha256}`,
    Description: `J5g-j9 unexecuted-only probe ${operationSha256}`,
    TemplateBody: templateBody, RoleARN: ARN_PROBE_EXECUTION_ROLE,
    ResourceTypes: ["AWS::CloudFormation::WaitConditionHandle"],
    IncludeNestedStacks: false, ImportExistingResources: false, OnStackFailure: "DELETE" as const,
    Tags: [{ Key: "Environment", Value: "aws-sandbox" }, { Key: "ManagedBy", Value: "techlong-arn-compatibility-probe" },
      { Key: "Component", Value: "b5-arn-compatibility" }, { Key: "ExpiresAt", Value: input.expiresAt }],
  };
  const locked = await renderB5CellLifecycleManagementTemplate({ shape: "Locked" });
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j9" as const, input, operationSha256,
    account: ARN_PROBE_ACCOUNT, region: ARN_PROBE_REGION, sourceArn: ARN_PROBE_SOURCE,
    templateRawSha256, templateCanonicalSha256, request,
    lockedTemplateRawSha256: await sha256Hex(locked), lockedTemplateCanonicalSha256: await sha256Hex(canonicalJson(JSON.parse(locked))),
    allowedWriteActions: ["cloudformation:CreateChangeSet"], childExecutionAllowed: false as const,
    grantInstallationAllowed: false as const, providerContextCompatibilityVerified: false as const,
    runtimeEnabled: false as const };
  return immutable({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeFixturePlan = Awaited<ReturnType<typeof compileArnProbeFixturePlan>>;
export async function assertArnProbeFixturePlan(plan: ArnProbeFixturePlan): Promise<void> {
  same(plan, await compileArnProbeFixturePlan(plan.input), "Probe plan");
}
export type ArnProbeFixtureState = Readonly<
  { state: "MISSING"; proof: "EXACT_NAME_BOUND_STACK_MISSING"; observedAt: string } |
  { state: "READY_UNEXECUTED"; stackId: string; changeSetArn: string; resourceCount: 0; templateCanonicalSha256: string; observedAt: string }
>;
export interface ArnProbeFixtureReadPort {
  readLockedPreflight(signal: AbortSignal): Promise<Readonly<CollectedManagementObservation>>;
  readFixture(plan: ArnProbeFixturePlan, signal: AbortSignal): Promise<ArnProbeFixtureState>;
}
export interface ArnProbeFixtureCreatePort { createChangeSet(request: ArnProbeFixturePlan["request"], signal: AbortSignal): Promise<unknown>; }
export interface ArnProbeFixtureJournalPort { reserve(intent: Readonly<Record<string, unknown>>): Promise<void>; }
function fresh(plan: ArnProbeFixturePlan, now: number): void {
  if (!Number.isSafeInteger(now) || now < instant(plan.input.reviewedAt) || now >= instant(plan.input.expiresAt)) throw new Error("Probe creation review expired or clock regressed.");
}
function assertLocked(plan: ArnProbeFixturePlan, value: Readonly<CollectedManagementObservation>, now: number): void {
  if (value.accountId !== ARN_PROBE_ACCOUNT || value.region !== ARN_PROBE_REGION || value.callerArn !== ARN_PROBE_SOURCE ||
      value.rendererShape !== "Locked" || value.cellStackState !== "MISSING" || value.authorityState !== "ABSENT" ||
      value.stack.templateRawSha256 !== plan.lockedTemplateRawSha256 || value.stack.templateCanonicalSha256 !== plan.lockedTemplateCanonicalSha256 ||
      now - instant(value.observedAt) < 0 || now - instant(value.observedAt) > 60_000) throw new Error("Probe requires fresh exact Locked / Cell MISSING / authority ABSENT evidence.");
}
async function preflight(plan: ArnProbeFixturePlan, reads: ArnProbeFixtureReadPort, signal: AbortSignal, now: () => number) {
  signal.throwIfAborted();
  const locked = await reads.readLockedPreflight(signal);
  assertLocked(plan, locked, now());
  const fixture = await reads.readFixture(plan, signal);
  signal.throwIfAborted();
  assertLocked(plan, locked, now());
  if (fixture.state !== "MISSING" || fixture.proof !== "EXACT_NAME_BOUND_STACK_MISSING") throw new Error("Probe fixture must be absent before CreateChangeSet.");
  if (now() - instant(fixture.observedAt) < 0 || now() - instant(fixture.observedAt) > 60_000) throw new Error("Fixture absence is stale.");
  return { locked, fixture };
}
export async function reviewArnProbeFixtureCreate(plan: ArnProbeFixturePlan, reads: ArnProbeFixtureReadPort, signal: AbortSignal, now = Date.now) {
  await assertArnProbeFixturePlan(plan); fresh(plan, now());
  const observation = await preflight(plan, reads, signal, now);
  fresh(plan, now());
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j9" as const, action: "REVIEW_FIXTURE_CREATE" as const,
    plan, observation, issuedAt: new Date(now()).toISOString(), expiresAt: plan.input.expiresAt,
    mutationPerformed: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeFixtureCreateReview = Awaited<ReturnType<typeof reviewArnProbeFixtureCreate>>;
export async function assertArnProbeFixtureCreateReview(review: ArnProbeFixtureCreateReview): Promise<void> {
  const { reviewSha256, ...body } = review;
  await assertArnProbeFixturePlan(review.plan);
  if (review.schemaVersion !== 1 || review.stage !== "B5-J5g-j9" || review.action !== "REVIEW_FIXTURE_CREATE" ||
      review.mutationPerformed !== false || review.providerContextCompatibilityVerified !== false || review.expiresAt !== review.plan.input.expiresAt ||
      reviewSha256 !== await sha256Hex(canonicalJson(body))) throw new Error("Probe create review digest or scope drifted.");
  assertLocked(review.plan, review.observation.locked, instant(review.issuedAt));
  if (review.observation.fixture.state !== "MISSING" || review.observation.fixture.proof !== "EXACT_NAME_BOUND_STACK_MISSING") throw new Error("Review does not prove fixture absence.");
  fresh(review.plan, instant(review.issuedAt));
}
export interface ArnProbeFixtureCreateApproval {
  approvedReviewSha256: string; acknowledgeAwsWrite: boolean; acknowledgeUnexecutedOnly: boolean;
  acknowledgeLowCostNotFree: boolean; executionPhrase: string;
}
export async function createReviewedArnProbeFixture(input: {
  review: ArnProbeFixtureCreateReview; approval: ArnProbeFixtureCreateApproval;
  reads: ArnProbeFixtureReadPort; creates: ArnProbeFixtureCreatePort; journal: ArnProbeFixtureJournalPort;
  signal: AbortSignal; now?: () => number;
}) {
  const now = input.now ?? Date.now;
  await assertArnProbeFixtureCreateReview(input.review);
  const approval = input.approval;
  same(Object.keys(approval).sort(), ["acknowledgeAwsWrite", "acknowledgeLowCostNotFree", "acknowledgeUnexecutedOnly", "approvedReviewSha256", "executionPhrase"], "Approval fields");
  if (approval.approvedReviewSha256 !== input.review.reviewSha256 || approval.acknowledgeAwsWrite !== true ||
      approval.acknowledgeUnexecutedOnly !== true || approval.acknowledgeLowCostNotFree !== true ||
      approval.executionPhrase !== "I_CONFIRM_J5GJ9_CREATE_UNEXECUTED_ARN_PROBE_ONLY") throw new Error("Exact fixture-only write approval is required.");
  const plan = input.review.plan;
  fresh(plan, now());
  await preflight(plan, input.reads, input.signal, now);
  fresh(plan, now()); input.signal.throwIfAborted();
  // Reserve a create-only, fsynced local intent before the sole SDK submission.
  // It is never cleared automatically. A lost reply permits only read-only Recover.
  const intent = { stage: "B5-J5g-j9", action: "CREATE_FIXTURE_CHANGE_SET", stackName: ARN_PROBE_FIXTURE_STACK,
    operationSha256: plan.operationSha256, approvedReviewSha256: input.review.reviewSha256,
    requestSha256: await sha256Hex(canonicalJson(plan.request)), reservedAt: new Date(now()).toISOString() };
  await input.journal.reserve(immutable(intent));
  let outcome: "CREATE_SUBMITTED" | "CREATE_UNCERTAIN" = "CREATE_UNCERTAIN";
  let target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  try {
    // Once intent is reserved, caller cancellation cannot suppress the one approved
    // submission. This is not an atomic transaction with AWS or a retry mechanism.
    const submittedSignal = AbortSignal.timeout(30_000);
    fresh(plan, now());
    const response = object(await input.creates.createChangeSet(plan.request, submittedSignal));
    submittedSignal.throwIfAborted();
    if (typeof response.StackId !== "string" || !stackPattern.test(response.StackId) ||
        typeof response.Id !== "string" || !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(response.Id)) throw new Error("Create response identity drifted.");
    const requestId = object(response.$metadata).requestId;
    if (typeof requestId !== "string" || !requestId) throw new Error("Create response lacks a request ID.");
    target = { stackId: response.StackId, changeSetArn: response.Id, requestId }; outcome = "CREATE_SUBMITTED";
  } catch { /* redact provider detail; never replay a possibly committed request */ }
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j9" as const, outcome, intent, target,
    observedAt: new Date(now()).toISOString(), mutationPerformed: outcome === "CREATE_SUBMITTED" ? true : null,
    childExecuted: false as const, grantInstalled: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}

/** Provider evidence validator; requires full zero-resource, unexecuted CREATE state. */
export function validateArnProbeFixtureEvidence(plan: ArnProbeFixturePlan, evidence: {
  stackBefore: unknown; stackAfter: unknown; resources: unknown; originalTemplateProof: unknown;
  changeSetBefore: unknown; changeSetAfter: unknown; changeSetTemplate: unknown; observedAt: string;
}): ArnProbeFixtureState {
  const first = object(evidence.stackBefore), last = object(evidence.stackAfter);
  same(first.Stacks, last.Stacks, "Fixture Stack while reading");
  const stack = object(entries(first.Stacks)[0]);
  if (entries(first.Stacks).length !== 1 || stack.StackName !== ARN_PROBE_FIXTURE_STACK || typeof stack.StackId !== "string" || !stackPattern.test(stack.StackId) ||
      stack.StackStatus !== "REVIEW_IN_PROGRESS" || stack.RoleARN !== ARN_PROBE_EXECUTION_ROLE || stack.EnableTerminationProtection !== false ||
      !empty(stack.ParentId) || !empty(stack.RootId)) throw new Error("Fixture must be the exact top-level unexecuted REVIEW_IN_PROGRESS Stack.");
  const tagOrder = (value: unknown) => entries(value).map(object).sort((a, b) => String(a.Key).localeCompare(String(b.Key)));
  // CREATE review Stacks are unmaterialized: AWS retains proposed tags on the
  // Change Set, but returns an explicit empty tag list on the placeholder Stack.
  same(tagOrder(stack.Tags), [], "Unexecuted fixture Stack tags");
  const inventory = object(evidence.resources);
  if (!empty(inventory.NextToken) || entries(inventory.StackResourceSummaries).length !== 0) throw new Error("Fixture resource inventory must be complete and empty.");
  const originalProof = object(evidence.originalTemplateProof);
  if (originalProof.kind === "EMPTY_ORIGINAL_TEMPLATE") {
    same(Object.keys(originalProof).sort(), ["httpStatusCode", "kind", "requestId", "stackId", "templateBody"], "Empty Original template proof fields");
    if (originalProof.stackId !== stack.StackId || originalProof.httpStatusCode !== 200 || originalProof.templateBody !== "" ||
        typeof originalProof.requestId !== "string" || !originalProof.requestId) throw new Error("Fixture empty Original template is not exact-ID-bound.");
  } else if (originalProof.name !== "ValidationError" || originalProof.httpStatusCode !== 400 ||
      originalProof.message !== `Stack with id ${stack.StackId} does not exist`) throw new Error("Fixture Original template absence is not exact-ID-bound.");
  const before = object(evidence.changeSetBefore), after = object(evidence.changeSetAfter);
  const stable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$metadata"));
  same(stable(before), stable(after), "Fixture Change Set while reading");
  if (!empty(before.NextToken) || before.StackName !== ARN_PROBE_FIXTURE_STACK || before.StackId !== stack.StackId ||
      before.ChangeSetName !== plan.request.ChangeSetName || typeof before.ChangeSetId !== "string" ||
      !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(before.ChangeSetId) ||
      before.Status !== "CREATE_COMPLETE" || before.ExecutionStatus !== "AVAILABLE" || before.Description !== plan.request.Description ||
      before.IncludeNestedStacks === true || before.ImportExistingResources === true || !empty(before.ParentChangeSetId) || !empty(before.RootChangeSetId) ||
      !empty(before.DeploymentMode) || before.OnStackFailure !== "DELETE") throw new Error("Fixture Change Set identity, nesting, or status drifted.");
  for (const key of ["Capabilities", "Parameters", "NotificationARNs"]) if (entries(before[key] ?? []).length !== 0) throw new Error(`Unexpected fixture ${key}.`);
  same(tagOrder(before.Tags), tagOrder(plan.request.Tags), "Change Set tags");
  const changes = entries(before.Changes);
  const change = object(changes[0]), resource = object(change.ResourceChange);
  if (changes.length !== 1 || change.Type !== "Resource" || resource.Action !== "Add" || resource.LogicalResourceId !== "ProbeHandle" ||
      resource.ResourceType !== "AWS::CloudFormation::WaitConditionHandle" || !empty(resource.PhysicalResourceId)) throw new Error("Only the unexecuted ProbeHandle Add is allowed.");
  const original = object(evidence.changeSetTemplate).TemplateBody;
  same(typeof original === "string" ? JSON.parse(original) : object(original), JSON.parse(plan.request.TemplateBody), "Fixture Change Set Original template");
  instant(evidence.observedAt);
  return immutable({ state: "READY_UNEXECUTED" as const, stackId: stack.StackId, changeSetArn: before.ChangeSetId,
    resourceCount: 0 as const, templateCanonicalSha256: plan.templateCanonicalSha256, observedAt: evidence.observedAt });
}
export async function recoverArnProbeFixture(plan: ArnProbeFixturePlan, reads: ArnProbeFixtureReadPort, signal: AbortSignal, now = Date.now) {
  await assertArnProbeFixturePlan(plan);
  const locked = await reads.readLockedPreflight(signal); assertLocked(plan, locked, now());
  const fixture = await reads.readFixture(plan, signal); signal.throwIfAborted();
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j9" as const, mode: "READ_ONLY_RECOVER" as const,
    operationSha256: plan.operationSha256, planSha256: plan.planSha256, locked, fixture,
    observedAt: new Date(now()).toISOString(), mutationPerformed: false as const,
    retryAuthorized: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
