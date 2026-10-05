import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { ARN_PROBE_OPERATOR_CALLER } from "../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { stackControlCopy } from "../../lib/deployments/execution/arn-probe-stack-scoped-read-control-create.ts";
import { stackControlGeneration6Fence, retireReviewedStackControl, inspectStackControlRetirement } from "../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement.ts";
import { reviewGeneration6Create, generation6ClaimBinding, type Generation6Claim, type Generation6Slot, type Generation6SourceReads } from "../../lib/deployments/execution/arn-probe-stack-control-generation6.ts";
import { generation6StepRequest, type Generation6Step, type Generation6Journal } from "../../lib/deployments/execution/arn-probe-stack-control-generation6-actions.ts";
import { reviewGeneration6Workflow, type Generation6WorkflowReads, type Generation6WorkflowWrites, type Generation6OperatorReads, type Generation6WorkflowApproval } from "../../lib/deployments/execution/arn-probe-stack-control-generation6-workflow.ts";
import type { StackControlManagementObservation } from "../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";
import { generation5RetirementFixture } from "./arn-probe-generation5-retirement.ts";
import { renderB5CellLifecycleManagementTemplate } from "../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";
import { compileArnProbeFixturePlan } from "../../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
export const controlUuid = "55555555-2222-4333-8444-555555555555", controlProof = "f".repeat(64);
export const controlArn = (name: string) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${name}/${controlUuid}`;
let cached: ReturnType<typeof prepare> | undefined;
async function prepare() {
  const retired = await generation5RetirementFixture(); await retireReviewedStackControl(retired); retired.setTime(retired.now() + 60_000);
  const retirementProof = await inspectStackControlRetirement(retired), templateBody = await renderB5CellLifecycleManagementTemplate({ shape: "Locked" });
  const context = { retirementProof, revokeTarget: { templateBody, templateRawSha256: await sha256Hex(templateBody),
    templateCanonicalSha256: await sha256Hex(canonicalJson(JSON.parse(templateBody))) } }, fence = await stackControlGeneration6Fence(retirementProof);
  // Public fixed fixture inputs; test never reads a real archive or AWS.
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "8f1ff840c31f4ad49721de90bbc80271",
    reviewedAt: "2026-10-03T14:59:32.448Z", expiresAt: "2026-10-03T15:59:32.448Z" });
  let at = Date.parse(retirementProof.observedAt) + 1000, claim: Generation6Claim | null = null, exists = false;
  const now = () => at, stamp = () => new Date(at += 10).toISOString(), proof = retirementProof.observation;
  const slot: Generation6Slot = { fence, readClaim: async () => claim, reserve: async (review, preflightEvidenceSha256, reservedAt) => {
    assert.equal(claim, null); const body = { schemaVersion: 1 as const, action: "CLAIM_GENERATION6_STACK_CONTROL_BEFORE_CREATE" as const,
      fence, binding: await generation6ClaimBinding(review), preflightEvidenceSha256, reservedAt };
    claim = { ...body, claimSha256: await sha256Hex(canonicalJson(body)) }; return claim;
  } };
  const creation: Generation6SourceReads = { observe: async plan => {
    const managementBefore = { ...proof.managementBefore, observedAt: stamp() }, fixtureBefore = { ...proof.fixture, observedAt: stamp() },
      fixtureInventoryBefore = { ...proof.fixtureInventory, observedAt: stamp() }, observedAt = stamp();
    return { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory: { complete: true, count: exists ? 1 : 0, stackId: plan.request.StackName,
      target: exists ? { state: "READY_UNEXECUTED", stackId: plan.request.StackName, changeSetArn: controlArn(plan.request.ChangeSetName),
        templateCanonicalSha256: plan.templateCanonicalSha256, providerEvidenceSha256: controlProof, observedAt }
        : { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt }, providerEvidenceSha256: controlProof, observedAt },
      fixtureInventoryAfter: { ...proof.fixtureInventory, observedAt: stamp() }, fixtureAfter: { ...proof.fixture, observedAt: stamp() },
      managementAfter: { ...proof.managementAfter, observedAt: stamp() } };
  } };
  const local = { readClaim: slot.readClaim, readContext: async () => context }, signal = new AbortController().signal;
  const creationReview = await reviewGeneration6Create({ slot, reads: creation, ...local, now, signal });
  await slot.reserve(creationReview, controlProof, stamp()); exists = true;
  const reviewed = await reviewGeneration6Workflow({ creationReview, ...local, now, signal, reads: { creation } as Generation6WorkflowReads });
  return { creationReview, context, manifest: reviewed.manifest, claim: claim!, fixturePlan };
}
// Synthetic fixture, fixed clock, no real AWS clients or real namespace writes.
export async function generation6WorkflowFixture() {
  const prepared = stackControlCopy(await (cached ??= prepare())), { creationReview, context, manifest: m, claim } = prepared;
  let at = Date.parse(m.input.reviewedAt) + 1000, installed = false, revoked = false, revokeExists = false;
  const events: string[] = [], intents = new Map<Generation6Step, Readonly<Record<string, unknown>>>();
  const now = () => at, stamp = () => new Date(at += 10).toISOString(), abort = new AbortController();
  const proof = context.retirementProof.observation, plan = creationReview.plan;
  const management = async (): Promise<StackControlManagementObservation> => {
    const old = stackControlCopy(proof.managementAfter), body = JSON.parse(installed ? plan.request.TemplateBody : plan.revokeTarget.templateBody);
    return { ...old, rendererShape: installed ? "StackScopedReadControlGrant" : "Locked", observedAt: stamp(),
      stack: { ...old.stack, templateRawSha256: installed ? plan.templateRawSha256 : plan.revokeTarget.templateRawSha256,
        templateCanonicalSha256: installed ? plan.templateCanonicalSha256 : plan.revokeTarget.templateCanonicalSha256, safetyState: body.Outputs.SafetyState.Value },
      policies: await Promise.all(old.policies.map(async p => p.logicalId !== "CellOperatorBoundary" ? p : { ...p,
        defaultVersionId: installed ? "v8" : revoked ? "v9" : "v7", versionIds: installed ? ["v6", "v7", "v8"] : revoked ? ["v6", "v7", "v8", "v9"] : ["v6", "v7"],
        defaultDocumentSha256: await sha256Hex(canonicalJson(body.Resources.CellOperatorBoundary.Properties.PolicyDocument)) })) };
  };
  const readFixture = async () => ({ ...proof.fixture, observedAt: stamp() });
  const readFixtureInventory = async () => ({ ...proof.fixtureInventory, observedAt: stamp() });
  const creation: Generation6SourceReads = { observe: async () => {
    const managementBefore = await management(), fixtureBefore = await readFixture(), fixtureInventoryBefore = await readFixtureInventory(), observedAt = stamp();
    return { managementBefore, fixtureBefore, fixtureInventoryBefore, inventory: { ...stackControlCopy(m.input.sourceObservation.inventory), observedAt,
      target: { ...m.input.sourceObservation.inventory.target, observedAt } }, fixtureInventoryAfter: await readFixtureInventory(),
      fixtureAfter: await readFixture(), managementAfter: await management() };
  } };
  const reads: Generation6WorkflowReads = {
    creation, readManagement: management, waitManagement: management,
    waitGrantSettlement: async () => { events.push("settle-grant"); return management(); },
    readFixture,
    readFixtureInventory,
    waitRevoke: async () => { const observedAt = stamp(); return revokeExists ? { state: "READY_UNEXECUTED", stackId: plan.request.StackName,
      changeSetArn: controlArn(m.actions.revoke.createRequest.ChangeSetName), templateCanonicalSha256: plan.revokeTarget.templateCanonicalSha256,
      providerEvidenceSha256: controlProof, observedAt } : { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt }; },
    readWorkflowInventory: async () => ({ complete: true, stackId: plan.request.StackName, providerEvidenceSha256: controlProof, observedAt: stamp(), objects: [
      { kind: "CURRENT_GRANT", arn: m.input.grantChangeSetArn, status: "CREATE_COMPLETE", executionStatus: installed || revoked ? "EXECUTE_COMPLETE" : "AVAILABLE" },
      ...(revokeExists ? [{ kind: "CURRENT_REVOKE", arn: controlArn(m.actions.revoke.createRequest.ChangeSetName), status: "CREATE_COMPLETE", executionStatus: revoked ? "EXECUTE_COMPLETE" : "AVAILABLE" }] : []),
    ] }),
  };
  const journal: Generation6Journal = { load: async step => intents.get(step) ?? null, reserve: async (step, request, reservedAt) => {
    if (intents.has(step)) throw new Error("Consumed"); assert.deepEqual(request, generation6StepRequest(m, step, request));
    intents.set(step, { schemaVersion: 1, stage: "B5-J5g-j23", step, request, reservedAt, claimSha256: claim.claimSha256,
      manifestSha256: m.manifestSha256, operationSha256: m.operationSha256, requestSha256: await sha256Hex(canonicalJson(request)) }); events.push(step);
  } };
  const reply = () => ({ $metadata: { requestId: controlUuid } });
  const writes: Generation6WorkflowWrites = {
    prepareOperator: async () => { events.push("identity"); return { callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", expiresAt: new Date(at + 900_000).toISOString() }; },
    executeGrant: async request => { assert.deepEqual(request, m.actions.grantExecute.request); events.push("submit-grant"); installed = true; return reply(); },
    createRevoke: async request => { assert.deepEqual(request, m.actions.revoke.createRequest); events.push("submit-revoke-create"); revokeExists = true;
      return { ...reply(), StackId: request.StackName, Id: controlArn(request.ChangeSetName) }; },
    executeRevoke: async request => { assert.equal(request.ChangeSetName, controlArn(m.actions.revoke.createRequest.ChangeSetName)); events.push("submit-revoke-execute"); installed = false; revoked = true; return reply(); },
  };
  const operatorReads: Generation6OperatorReads = { readCase: async (manifest, style) => { events.push(`describe-${style}`); const c = manifest.actions.operatorReads.cases.find(c => c.requestStyle === style)!;
    return { manifestSha256: manifest.manifestSha256, requestStyle: style, callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", region: "ca-central-1",
      requestSha256: await sha256Hex(canonicalJson(c.request)), outcome: "READ_SUCCEEDED", providerEvidenceSha256: controlProof,
      requestId: style === "FULL_ARN_REQUEST" ? "11111111-2222-4333-8444-555555555555" : "22222222-2222-4333-8444-555555555555", failure: null,
      observedAt: stamp(), mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false }; } };
  const originalRead = operatorReads.readCase;
  const approval: Generation6WorkflowApproval = { approvedManifestSha256: m.manifestSha256, approvedGrantSha256: m.actionSha256.grantExecute,
    approvedReadsSha256: m.actionSha256.operatorReads, approvedRevokeSha256: m.actionSha256.revoke, executionPhrase: m.requiredPhrase, acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true };
  return { ...prepared, approval, reads, writes, operatorReads, journal, events, intents, now, signal: abort.signal, abort,
    readClaim: async () => claim, readContext: async () => context, setTime: (value: number) => { at = value; },
    setInstalled: (value: boolean) => { installed = value; }, setRevoke: (value: boolean) => { revokeExists = value; },
    deny: async (style: Parameters<Generation6OperatorReads["readCase"]>[1], uncertain = false) => {
      const result = await originalRead(m, style, abort.signal), failure = sanitizeArnProbeFailure({ name: uncertain ? "TimeoutError" : "AccessDenied",
        $metadata: { requestId: uncertain ? undefined : result.requestId, httpStatusCode: uncertain ? undefined : 403 } }, "OPERATOR_READINESS", now);
      return { ...result, outcome: uncertain ? "READ_UNCERTAIN" as const : "READ_DENIED" as const, providerEvidenceSha256: null, requestId: failure.requestId, failure };
    } };
}
