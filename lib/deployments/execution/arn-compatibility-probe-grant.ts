import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertArnProbeFixturePlan, ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_FIXTURE_STACK,
  type ArnProbeFixturePlan, type ArnProbeFixtureState, type ArnProbeFixtureReadPort } from "./arn-compatibility-probe-fixture.ts";
import { SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID as managementStackId } from "./shared-cell-author-compensation-grant-lifecycle.ts";
import { renderB5CellLifecycleManagementTemplate } from "../../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Probe grant evidence must be a JSON object.");
  return value as Record<string, unknown>;
}
function same(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} drifted.`);
}
function instant(value: string) {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("Probe grant time must be canonical UTC.");
  return time;
}
function immutable<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown) { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } }
  freeze(copy); return copy;
}
function empty(value: unknown) { return value === undefined || value === null || value === ""; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("Probe grant inventory is incomplete."); return value; }

/** Dedicated fixture candidate, NOT a production compensation shape or execution approval. */
export async function compileArnProbeGrantPlan(input: {
  fixturePlan: ArnProbeFixturePlan; fixtureStackId: string; fixtureChangeSetArn: string;
  nonce: string; reviewedAt: string; expiresAt: string;
}) {
  same(Object.keys(input).sort(), ["expiresAt", "fixtureChangeSetArn", "fixturePlan", "fixtureStackId", "nonce", "reviewedAt"], "Probe grant input");
  await assertArnProbeFixturePlan(input.fixturePlan);
  if (!/^[a-f0-9]{32}$/.test(input.nonce) ||
      !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:stack/${ARN_PROBE_FIXTURE_STACK}/${uuid}$`).test(input.fixtureStackId) ||
      !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${input.fixturePlan.request.ChangeSetName}/${uuid}$`).test(input.fixtureChangeSetArn)) throw new Error("Probe grant requires exact dedicated fixture identities.");
  const start = instant(input.reviewedAt), end = instant(input.expiresAt);
  if (end - start < 1_800_000 || end - start > 3_600_000) throw new Error("Probe grant window must be 30–60 minutes.");
  const deleteCutoff = new Date(end - 600_000).toISOString();
  const createApprovalExpiresAt = new Date(end - 900_000).toISOString();
  const operationSha256 = await sha256Hex(canonicalJson({ ...input, fixturePlan: input.fixturePlan.planSha256, managementStackId }));
  const lockedTemplateBody = await renderB5CellLifecycleManagementTemplate({ shape: "Locked" });
  const candidate = JSON.parse(lockedTemplateBody);
  const condition = { StringEquals: { "aws:RequestedRegion": ARN_PROBE_REGION },
    DateGreaterThanEquals: { "aws:CurrentTime": input.reviewedAt }, DateLessThan: { "aws:CurrentTime": input.expiresAt } };
  const exactArnCondition = { ...condition, StringEquals: { ...condition.StringEquals, "cloudformation:ChangeSetName": input.fixtureChangeSetArn } };
  candidate.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement.push(
    { Sid: "TemporaryAllowArnProbeStackRead", Effect: "Allow", Action: ["cloudformation:DescribeStacks", "cloudformation:ListStackResources", "cloudformation:GetTemplate"], Resource: input.fixtureStackId, Condition: condition },
    { Sid: "TemporaryAllowArnProbeExactChangeSetRead", Effect: "Allow", Action: "cloudformation:DescribeChangeSet", Resource: [input.fixtureStackId, input.fixtureChangeSetArn], Condition: exactArnCondition },
    { Sid: "TemporaryAllowArnProbeExactChangeSetDelete", Effect: "Allow", Action: "cloudformation:DeleteChangeSet", Resource: input.fixtureStackId,
      Condition: { ...exactArnCondition, DateLessThan: { "aws:CurrentTime": deleteCutoff } } },
  );
  Object.assign(candidate.Metadata.SafetyBoundary, {
    CloudApplyEnabled: false, LocalValidateOnly: true, ManagementRootApplyEnabled: false, TemporaryGrantApplyEnabled: false,
    OperatorGrantState: "ARNPROBEDELETECHANGESETGRANT", ArnProbeOnly: true,
    ArnProbeOperationSha256: operationSha256, ArnProbeFixturePlanSha256: input.fixturePlan.planSha256,
    ArnProbeStackId: input.fixtureStackId, ArnProbeChangeSetArn: input.fixtureChangeSetArn,
    ArnProbeReviewedAt: input.reviewedAt, ArnProbeExpiresAt: input.expiresAt, ArnProbeDeleteCutoff: deleteCutoff,
    ArnProbeApprovedWriteActions: ["cloudformation:DeleteChangeSet"],
    ArnProbeExecutionApproved: false, ArnProbeChildExecutionAllowed: false, ArnProbeDeleteStackAllowed: false,
    CompensationChangeSetArnRequestIamConditionCompatibilityVerified: false,
  });
  candidate.Description = "J5g-j10 isolated ARN probe-only single-action DeleteChangeSet candidate; grant execution, deletion and cleanup require separate approval. No paid Cell.";
  candidate.Outputs.SafetyState.Value = "ARN_PROBE_ONLY_DELETE_CHANGE_SET_CANDIDATE_EXECUTION_NOT_APPROVED_NO_PAID_CELL";
  const grantTemplateBody = `${JSON.stringify(candidate)}\n`;
  if (Buffer.byteLength(grantTemplateBody, "utf8") > 51_200 || JSON.stringify(candidate.Resources.CellOperatorBoundary.Properties.PolicyDocument).replace(/\s/g, "").length > 6_144) throw new Error("Probe grant template/policy exceeds AWS size bounds.");
  const grantTemplateRawSha256 = await sha256Hex(grantTemplateBody), grantTemplateCanonicalSha256 = await sha256Hex(canonicalJson(candidate));
  const request = { StackName: managementStackId, ChangeSetName: `techlong-j5gj10-probe-grant-${operationSha256.slice(0, 16)}`,
    ChangeSetType: "UPDATE" as const, ClientToken: `j5gj10-create-${operationSha256}`,
    Description: `J5g-j10 probe grant review only ${operationSha256}`, TemplateBody: grantTemplateBody,
    Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ImportExistingResources: false,
    Parameters: ["ExpectedAccountId", "ExpectedRegion", "ManagementPrincipalArn"].map((ParameterKey) => ({ ParameterKey, UsePreviousValue: true })),
  };
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j10" as const, input, operationSha256, managementStackId, deleteCutoff, createApprovalExpiresAt,
    grantTemplateRawSha256, grantTemplateCanonicalSha256, request,
    revokeTarget: { templateBody: lockedTemplateBody, templateRawSha256: await sha256Hex(lockedTemplateBody), templateCanonicalSha256: await sha256Hex(canonicalJson(JSON.parse(lockedTemplateBody))) },
    futureProbeRequest: { StackName: input.fixtureStackId, ChangeSetName: input.fixtureChangeSetArn },
    allowedWriteActions: ["cloudformation:CreateChangeSet"], childExecutionAllowed: false as const,
    grantExecutionAllowed: false as const, probeDeletionAllowed: false as const, cleanupAllowed: false as const,
    providerContextCompatibilityVerified: false as const, runtimeEnabled: false as const };
  return immutable({ ...body, planSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeGrantPlan = Awaited<ReturnType<typeof compileArnProbeGrantPlan>>;
export async function assertArnProbeGrantPlan(plan: ArnProbeGrantPlan) { same(plan, await compileArnProbeGrantPlan(plan.input), "Probe grant plan"); }
export type ArnProbeGrantChangeSetState = Readonly<
  { state: "MISSING"; proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY"; observedAt: string } |
  { state: "READY_UNEXECUTED"; stackId: string; changeSetArn: string; templateCanonicalSha256: string; providerEvidenceSha256: string; observedAt: string }
>;
export interface ArnProbeGrantReadPort extends ArnProbeFixtureReadPort {
  readGrantChangeSet(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ArnProbeGrantChangeSetState>;
}
function fresh(plan: ArnProbeGrantPlan, now: number) {
  if (!Number.isSafeInteger(now) || now < instant(plan.input.reviewedAt) || now >= instant(plan.createApprovalExpiresAt)) throw new Error("Probe grant creation needs a live window and more than five minutes before its deletion cutoff.");
}
function observedAt(value: { observedAt: string }, now: number) {
  const elapsed = now - instant(value.observedAt);
  if (elapsed < 0 || elapsed > 60_000) throw new Error("Probe grant observation is stale.");
}
function assertFixture(plan: ArnProbeGrantPlan, fixture: ArnProbeFixtureState, now: number) {
  observedAt(fixture, now);
  if (fixture.state !== "READY_UNEXECUTED" || fixture.stackId !== plan.input.fixtureStackId || fixture.changeSetArn !== plan.input.fixtureChangeSetArn ||
      fixture.resourceCount !== 0 || fixture.templateCanonicalSha256 !== plan.input.fixturePlan.templateCanonicalSha256) throw new Error("Probe grant requires the exact zero-resource unexecuted fixture.");
}
async function preflight(plan: ArnProbeGrantPlan, reads: ArnProbeGrantReadPort, signal: AbortSignal, now: () => number) {
  signal.throwIfAborted();
  const locked = await reads.readLockedPreflight(signal);
  if (locked.callerArn !== plan.input.fixturePlan.sourceArn || locked.accountId !== ARN_PROBE_ACCOUNT || locked.region !== ARN_PROBE_REGION ||
      locked.stack.id !== managementStackId || locked.rendererShape !== "Locked" || locked.cellStackState !== "MISSING" || locked.authorityState !== "ABSENT" ||
      locked.stack.templateRawSha256 !== plan.revokeTarget.templateRawSha256 || locked.stack.templateCanonicalSha256 !== plan.revokeTarget.templateCanonicalSha256) throw new Error("Probe grant requires exact Locked / Cell MISSING / authority ABSENT.");
  const fixtureBefore = await reads.readFixture(plan.input.fixturePlan, signal); assertFixture(plan, fixtureBefore, now());
  const grant = await reads.readGrantChangeSet(plan, signal); observedAt(grant, now());
  if (grant.state === "MISSING") {
    if (grant.proof !== "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY") throw new Error("Grant absence needs complete management inventory proof.");
  } else if (grant.state !== "READY_UNEXECUTED" || grant.stackId !== managementStackId ||
      !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(grant.changeSetArn) ||
      grant.templateCanonicalSha256 !== plan.grantTemplateCanonicalSha256 || !/^[a-f0-9]{64}$/.test(grant.providerEvidenceSha256)) throw new Error("Grant observation identity or digest drifted.");
  const fixtureAfter = await reads.readFixture(plan.input.fixturePlan, signal); assertFixture(plan, fixtureAfter, now());
  const stable = (value: ArnProbeFixtureState) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "observedAt"));
  same(stable(fixtureBefore), stable(fixtureAfter), "Probe fixture across grant reads");
  observedAt(locked, now()); signal.throwIfAborted();
  return { locked, fixture: fixtureAfter, grant };
}
export async function reviewArnProbeGrantCreate(plan: ArnProbeGrantPlan, reads: ArnProbeGrantReadPort, signal: AbortSignal, now = Date.now) {
  await assertArnProbeGrantPlan(plan); fresh(plan, now());
  const observation = await preflight(plan, reads, signal, now);
  if (observation.grant.state !== "MISSING") throw new Error("Probe Grant Change Set already exists; use read-only Recover.");
  fresh(plan, now());
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j10" as const, action: "REVIEW_GRANT_CHANGE_SET_CREATE" as const,
    plan, observation, issuedAt: new Date(now()).toISOString(), expiresAt: plan.createApprovalExpiresAt,
    mutationPerformed: false as const, grantInstalled: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, reviewSha256: await sha256Hex(canonicalJson(body)) });
}
export type ArnProbeGrantCreateReview = Awaited<ReturnType<typeof reviewArnProbeGrantCreate>>;
export async function createReviewedArnProbeGrant(input: {
  review: ArnProbeGrantCreateReview; approvedReviewSha256: string; acknowledgeAwsWrite: boolean;
  acknowledgeCreatesNamedIamChangeSetOnly: boolean; executionPhrase: string;
  reads: ArnProbeGrantReadPort; create: (request: ArnProbeGrantPlan["request"], signal: AbortSignal) => Promise<unknown>;
  reserve: (intent: Readonly<Record<string, unknown>>) => Promise<void>; signal: AbortSignal; now?: () => number;
}) {
  const now = input.now ?? Date.now, { reviewSha256, ...reviewBody } = input.review, plan = input.review.plan;
  await assertArnProbeGrantPlan(plan);
  if (reviewSha256 !== await sha256Hex(canonicalJson(reviewBody)) || input.approvedReviewSha256 !== reviewSha256 ||
      input.review.action !== "REVIEW_GRANT_CHANGE_SET_CREATE" || input.review.mutationPerformed !== false || input.review.grantInstalled !== false ||
      input.review.providerContextCompatibilityVerified !== false || input.review.expiresAt !== plan.createApprovalExpiresAt ||
      input.acknowledgeAwsWrite !== true || input.acknowledgeCreatesNamedIamChangeSetOnly !== true ||
      input.executionPhrase !== "I_CONFIRM_J5GJ10_CREATE_PROBE_GRANT_CHANGE_SET_ONLY") throw new Error("Exact probe Grant Change Set creation-only approval is required.");
  fresh(plan, instant(input.review.issuedAt)); fresh(plan, now());
  const observation = await preflight(plan, input.reads, input.signal, now);
  if (observation.grant.state !== "MISSING") throw new Error("Probe Grant Change Set is not absent.");
  fresh(plan, now()); input.signal.throwIfAborted();
  const intent = { stage: "B5-J5g-j10", action: "CREATE_PROBE_GRANT_CHANGE_SET", operationSha256: plan.operationSha256,
    approvedReviewSha256: reviewSha256, requestSha256: await sha256Hex(canonicalJson(plan.request)), reservedAt: new Date(now()).toISOString() };
  await input.reserve(immutable(intent));
  let target: { stackId: string; changeSetArn: string; requestId: string } | null = null;
  try {
    fresh(plan, now());
    const response = object(await input.create(plan.request, AbortSignal.timeout(30_000))), metadata = object(response.$metadata);
    if (response.StackId !== managementStackId || typeof response.Id !== "string" ||
        !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(response.Id) ||
        typeof metadata.requestId !== "string" || !metadata.requestId) throw new Error("Probe grant create response identity drifted.");
    target = { stackId: managementStackId, changeSetArn: response.Id, requestId: metadata.requestId };
  } catch { /* one possible AWS commit, never replay */ }
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j10" as const, outcome: target ? "CREATE_SUBMITTED" : "CREATE_UNCERTAIN",
    intent, target, observedAt: new Date(now()).toISOString(), mutationPerformed: target ? true : null,
    grantInstalled: false as const, childExecuted: false as const, probeDeleted: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function recoverArnProbeGrantCreate(plan: ArnProbeGrantPlan, reads: ArnProbeGrantReadPort, signal: AbortSignal, now = Date.now) {
  await assertArnProbeGrantPlan(plan);
  const observation = await preflight(plan, reads, signal, now);
  const body = { schemaVersion: 1 as const, stage: "B5-J5g-j10" as const, mode: "READ_ONLY_RECOVER" as const,
    planSha256: plan.planSha256, observation, observedAt: new Date(now()).toISOString(), mutationPerformed: false as const,
    retryAuthorized: false as const, grantInstalled: false as const, providerContextCompatibilityVerified: false as const };
  return immutable({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) });
}
export async function validateArnProbeGrantChangeSet(plan: ArnProbeGrantPlan, before: unknown, after: unknown, original: unknown, observed: string): Promise<ArnProbeGrantChangeSetState> {
  const first = object(before), last = object(after);
  const stable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$metadata"));
  same(stable(first), stable(last), "Probe Grant Change Set stability");
  if (first.StackId !== managementStackId || first.StackName !== "techlong-s3-b5-cell-lifecycle-management" || first.ChangeSetName !== plan.request.ChangeSetName ||
      typeof first.ChangeSetId !== "string" || !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${plan.request.ChangeSetName}/${uuid}$`).test(first.ChangeSetId) ||
      first.Status !== "CREATE_COMPLETE" || first.ExecutionStatus !== "AVAILABLE" || first.Description !== plan.request.Description ||
      !empty(first.NextToken) || !empty(first.RoleARN) || !empty(first.OnStackFailure) || first.IncludeNestedStacks === true || first.ImportExistingResources === true || !empty(first.ParentChangeSetId) || !empty(first.RootChangeSetId) || !empty(first.DeploymentMode)) throw new Error("Probe Grant Change Set identity or state drifted.");
  same(list(first.Capabilities), ["CAPABILITY_NAMED_IAM"], "Probe grant capabilities");
  same(list(first.NotificationARNs ?? []), [], "Probe grant notifications");
  same(list(first.Parameters).map((value) => { const item = object(value); return [item.ParameterKey, item.ParameterValue]; }).sort(),
    [["ExpectedAccountId", ARN_PROBE_ACCOUNT], ["ExpectedRegion", ARN_PROBE_REGION], ["ManagementPrincipalArn", plan.input.fixturePlan.sourceArn]].sort(), "Probe grant parameters");
  const changes = list(first.Changes);
  if (changes.length !== 1) throw new Error("Only the operator boundary may change.");
  const change = object(changes[0]), resource = object(change.ResourceChange);
  if (change.Type !== "Resource" || resource.Action !== "Modify" || resource.LogicalResourceId !== "CellOperatorBoundary" || resource.ResourceType !== "AWS::IAM::ManagedPolicy" ||
      resource.PhysicalResourceId !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/TechlongSandboxCellOperatorBoundary` || resource.Replacement !== "False") throw new Error("Probe grant changes an unapproved IAM resource.");
  const template = object(original).TemplateBody;
  same(typeof template === "string" ? JSON.parse(template) : object(template), JSON.parse(plan.request.TemplateBody), "Probe grant Original template");
  instant(observed);
  return immutable({ state: "READY_UNEXECUTED" as const, stackId: managementStackId, changeSetArn: first.ChangeSetId,
    templateCanonicalSha256: plan.grantTemplateCanonicalSha256,
    providerEvidenceSha256: await sha256Hex(canonicalJson({ before, after, original })), observedAt: observed });
}
