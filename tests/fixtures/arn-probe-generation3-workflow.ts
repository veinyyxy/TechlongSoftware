import { retirementProofFixture, retirementObservation } from "./arn-probe-retirement.ts";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { compileArnProbeFixturePlan } from "../../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan } from "../../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { ARN_PROBE_READ_COMPARISON_ANCHORS as anchors, ARN_PROBE_CONSUMED_SLOT_FILES, reviewArnProbeReadComparison, type ArnProbeReadComparisonPredecessor } from "../../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { arnProbeComparisonFence, reviewArnProbeComparisonCreate, arnProbeComparisonClaimBinding, type ArnProbeComparisonCreatePlan } from "../../lib/deployments/execution/arn-probe-read-comparison-generation3-create.ts";
import { compileArnProbeComparisonWorkflow, type ArnProbeComparisonWorkflowReads, type ArnProbeComparisonJournal, type ArnProbeComparisonStep,
  type ArnProbeComparisonCaseResult, type ArnProbeComparisonApproval } from "../../lib/deployments/execution/arn-probe-read-comparison-generation3-workflow.ts";
import type { ArnProbeReadComparisonManagementObservation } from "../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";
import { sanitizeArnProbeFailure } from "../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { ARN_PROBE_OPERATOR_CALLER } from "../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";

// Test-only provider doubles. No credentials, network, live ledgers or cloud state.
export const comparisonTestAt = Date.parse("2026-10-04T05:00:00.000Z");
export const comparisonTestId = "11111111-2222-4333-8444-555555555555";
export const testSignal = () => new AbortController().signal;
export async function testComparisonManagement(body: string, stackId: ArnProbeComparisonCreatePlan["request"]["StackName"], granted: boolean, at = comparisonTestAt): Promise<ArnProbeReadComparisonManagementObservation> {
  const template = JSON.parse(body), names = ["CellOperatorBoundary", "CellOperatorRole", "CellCloudFormationExecutionBoundary", "CellCloudFormationExecutionRole"];
  const policies: ArnProbeReadComparisonManagementObservation["policies"][number][] = [], roles: ArnProbeReadComparisonManagementObservation["roles"][number][] = [];
  const policyArn = (name: string) => `arn:aws:iam::402010193138:policy/${name}`, roleArn = (name: string) => `arn:aws:iam::402010193138:role/${name}`;
  for (const [i, id] of names.entries()) {
    const p = template.Resources[id].Properties;
    if (i % 2 === 0) { const target = roleArn(template.Resources[names[i + 1]].Properties.RoleName);
      policies.push({ logicalId: id as "CellOperatorBoundary" | "CellCloudFormationExecutionBoundary", arn: policyArn(p.ManagedPolicyName), name: p.ManagedPolicyName,
        defaultVersionId: i === 0 ? granted ? "v6" : "v5" : "v1", versionIds: i === 0 ? ["v4", "v5", ...(granted ? ["v6"] : [])] : ["v1"],
        defaultDocumentSha256: await sha256Hex(canonicalJson(p.PolicyDocument)), attachmentCount: i === 0 ? 1 : 0, permissionsBoundaryUsageCount: 1,
        identityRoleArns: i === 0 ? [target] : [], boundaryRoleArns: [target] });
    } else { const trust = structuredClone(p.AssumeRolePolicyDocument); if (i === 1) trust.Statement[0].Principal.AWS = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
      const boundary = policyArn(template.Resources[names[i - 1]].Properties.ManagedPolicyName);
      roles.push({ logicalId: id as "CellOperatorRole" | "CellCloudFormationExecutionRole", arn: roleArn(p.RoleName), name: p.RoleName, permissionsBoundaryArn: boundary,
        attachedPolicyArns: i === 1 ? [boundary] : [], inlinePolicyNames: [], trustPolicySha256: await sha256Hex(canonicalJson(trust)) }); }
  }
  return { schemaVersion: 1, accountId: "402010193138", region: "ca-central-1", callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", rendererShape: granted ? "ArnProbeReadComparisonGrant" : "Locked",
    cellStackState: "MISSING", authorityState: "ABSENT", policies, roles, observedAt: new Date(at).toISOString(), stack: { id: stackId, name: "techlong-s3-b5-cell-lifecycle-management", status: "UPDATE_COMPLETE", roleArn: null,
      parentId: null, rootId: null, terminationProtection: false, templateRawSha256: await sha256Hex(body), templateCanonicalSha256: await sha256Hex(canonicalJson(template)), safetyState: template.Outputs.SafetyState.Value,
      resources: names.map((id, i) => ({ logicalId: id, resourceType: i % 2 ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy", physicalResourceId: i % 2 ? template.Resources[id].Properties.RoleName : policyArn(template.Resources[id].Properties.ManagedPolicyName), resourceStatus: "UPDATE_COMPLETE" })) } };
}
export async function comparisonWorkflowFixture() {
  let at = comparisonTestAt, granted = false, revokeReady = false;
  const events: string[] = [], intents = new Map<ArnProbeComparisonStep, Readonly<Record<string, unknown>>>();
  const now = () => at;
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "8f1ff840c31f4ad49721de90bbc80271", reviewedAt: "2026-10-03T14:59:32.448Z", expiresAt: "2026-10-03T15:59:32.448Z" });
  const prior = await compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-arn-compatibility-probe/e5fcb450-bf3d-11f1-8f15-02cdaaa60ec7",
    fixtureChangeSetArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a/ffac6957-44d4-4485-9d08-d018a0be3f11",
    nonce: "3ccad1207bf042a5a71a23058cd28ad3", reviewedAt: "2026-10-03T20:54:10.050Z", expiresAt: "2026-10-03T21:54:10.050Z" });
  assert.equal(prior.planSha256, anchors.planSha256);
  const predecessor: ArnProbeReadComparisonPredecessor = { anchors, consumedGeneration: 1, consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${anchors.targetFenceKey}/slot-000001`, slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false };
  const readPredecessor = async () => predecessor;
  const fixture = { state: "READY_UNEXECUTED" as const, stackId: prior.input.fixtureStackId, changeSetArn: prior.input.fixtureChangeSetArn, resourceCount: 0 as const, templateCanonicalSha256: fixturePlan.templateCanonicalSha256, observedAt: new Date(at).toISOString() };
  const sourceReview = await reviewArnProbeReadComparison({ priorPlan: prior, readPredecessor, reads: {
    readManagement: async () => (await retirementObservation("MISSING", at)).recovery.observation.managementAfter,
    readFixture: async () => fixture, readEmptyManagementInventory: async () => ({ state: "EMPTY", changeSetCount: 0, stackId: prior.managementStackId, providerEvidenceSha256: "f".repeat(64), observedAt: new Date(at).toISOString() }) }, signal: testSignal(), now });
  const retirementProof = await retirementProofFixture();
  const fence = await arnProbeComparisonFence(predecessor, retirementProof), review = await reviewArnProbeComparisonCreate({ sourceReview, variant: "EXACT_NAME_CONDITION", retirementProof, slot: { fence, readClaim: async () => null }, signal: testSignal(), now });
  const claimBody = { schemaVersion: 1 as const, action: "CLAIM_GENERATION3_BEFORE_CREATE" as const, fence, binding: await arnProbeComparisonClaimBinding(review), preflightEvidenceSha256: "f".repeat(64), reservedAt: new Date(at).toISOString() };
  const claim = { ...claimBody, claimSha256: await sha256Hex(canonicalJson(claimBody)) };
  const grantArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${review.plan.request.ChangeSetName}/${comparisonTestId}`;
  const manifest = await compileArnProbeComparisonWorkflow({ creationReview: review, claim, grantChangeSetArn: grantArn, reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() });
  const revokeArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${manifest.actions.revoke.createRequest.ChangeSetName}/${comparisonTestId}`;
  const management = () => testComparisonManagement(granted ? review.plan.request.TemplateBody : review.plan.revokeTarget.templateBody, prior.managementStackId, granted, at);
  const reads: ArnProbeComparisonWorkflowReads = { readManagement: management, waitManagement: management,
    waitGrantSettlement: async () => { events.push("settled"); return management(); },
    readFixture: async () => ({ ...fixture, observedAt: new Date(at).toISOString() }),
    readGrant: async () => ({ state: "READY_UNEXECUTED", stackId: prior.managementStackId, changeSetArn: grantArn, templateCanonicalSha256: review.plan.templateCanonicalSha256, providerEvidenceSha256: "f".repeat(64), observedAt: new Date(at).toISOString() }),
    waitRevoke: async () => revokeReady ? { state: "READY_UNEXECUTED", stackId: prior.managementStackId, changeSetArn: revokeArn, templateCanonicalSha256: review.plan.revokeTarget.templateCanonicalSha256, providerEvidenceSha256: "f".repeat(64), observedAt: new Date(at).toISOString() } : { state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: new Date(at).toISOString() } };
  const journal: ArnProbeComparisonJournal = { load: async (step) => intents.get(step) ?? null, reserve: async (step, request, reservedAt) => { if (intents.has(step)) throw new Error("Consumed intent"); events.push(`intent:${step}`); intents.set(step, { request, reservedAt }); } };
  const response = { $metadata: { requestId: comparisonTestId } };
  const writes = { prepareOperator: async () => { events.push("mfa-identity"); return { callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", expiresAt: new Date(at + 900_000).toISOString() }; },
    executeGrant: async () => { events.push("grant"); granted = true; return response; }, createRevoke: async () => { events.push("revoke-create"); revokeReady = true; return { ...response, StackId: prior.managementStackId, Id: revokeArn }; },
    executeRevoke: async () => { events.push("revoke-execute"); granted = false; return response; } };
  const operatorReads = { readCase: async (_m: typeof manifest, style: "FULL_ARN_REQUEST" | "EXACT_NAME_REQUEST"): Promise<ArnProbeComparisonCaseResult> => { events.push(`read:${style}`); const c = manifest.actions.operatorReads.cases.find((c) => c.requestStyle === style)!;
    return { manifestSha256: manifest.manifestSha256, requestStyle: style, callerArn: ARN_PROBE_OPERATOR_CALLER, account: "402010193138", region: "ca-central-1", requestSha256: await sha256Hex(canonicalJson(c.request)),
      outcome: "READ_SUCCEEDED", providerEvidenceSha256: "f".repeat(64), requestId: comparisonTestId, failure: null, observedAt: new Date(at).toISOString(), mutationPerformed: false, authorizationContextObserved: false, productionCompatibilityVerified: false, retryAuthorized: false }; } };
  const approval: ArnProbeComparisonApproval = { approvedManifestSha256: manifest.manifestSha256, approvedGrantSha256: manifest.actionSha256.grantExecute, approvedReadsSha256: manifest.actionSha256.operatorReads,
    approvedRevokeSha256: manifest.actionSha256.revoke, acknowledgeAwsWrite: true, acknowledgeLowCostNotZero: true, executionPhrase: manifest.requiredPhrase };
  return { prior, review, claim, fence, manifest, reads, writes, operatorReads, journal, approval, events, intents, now, grantArn, revokeArn,
    readClaim: async () => claim, readPredecessor, signal: testSignal(), setTime: (v: number) => { at = v; }, setGranted: (v: boolean) => { granted = v; }, setRevokeReady: (v: boolean) => { revokeReady = v; },
    denied: () => sanitizeArnProbeFailure({ name: "AccessDenied", message: "never serialize", $metadata: { requestId: comparisonTestId, httpStatusCode: 403 } }, "OPERATOR_READINESS", now) };
}
