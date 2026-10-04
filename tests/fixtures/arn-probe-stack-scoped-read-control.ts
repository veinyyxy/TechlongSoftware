import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { comparisonWorkflowFixture } from "./arn-probe-generation4-workflow.ts";
import { runArnProbeComparisonWorkflow, inspectArnProbeComparisonWorkflow, comparisonStepRequest, type ArnProbeComparisonStep } from "../../lib/deployments/execution/arn-probe-read-comparison-generation4-workflow.ts";
import { sanitizeArnProbeFailure } from "../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { stackScopedReadControlJournal, closeGeneration4ForStackScopedReadControl, type StackScopedReadControlEvidence } from "../../lib/deployments/execution/arn-probe-stack-scoped-read-control.ts";
import type { ArnProbeReadComparisonManagementObservation } from "../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";

export async function signed<T extends object>(value: T, key: string): Promise<T> {
  const body = { ...value } as Record<string, unknown>; delete body[key];
  return { ...body, [key]: await sha256Hex(canonicalJson(body)) } as T;
}
function lockedV7(value: ArnProbeReadComparisonManagementObservation) {
  return { ...value, policies: value.policies.map(p => p.logicalId === "CellOperatorBoundary" ? { ...p, defaultVersionId: "v7", versionIds: ["v6", "v7"] } : p) };
}
// Fixed time, in-memory old workflow and synthetic audit; no SDK/live files.
export async function stackScopedReadControlFixture() {
  const f = await comparisonWorkflowFixture();
  f.journal.reserve = async (step: ArnProbeComparisonStep, supplied, reservedAt) => {
    if (f.intents.has(step)) throw new Error("Consumed");
    const request = comparisonStepRequest(f.manifest, step, supplied);
    f.intents.set(step, { schemaVersion: 1, stage: "B5-J5g-j20", step, claimSha256: f.claim.claimSha256,
      manifestSha256: f.manifest.manifestSha256, operationSha256: f.manifest.operationSha256, request,
      requestSha256: await sha256Hex(canonicalJson(request)), reservedAt });
  };
  const result = await runArnProbeComparisonWorkflow({ ...f, operatorReads: { readCase: async (manifest, style) => {
    const value = await f.operatorReads.readCase(manifest, style);
    const requestId = style === "FULL_ARN_REQUEST" ? "11111111-2222-4333-8444-555555555555" : "22222222-2222-4333-8444-555555555555";
    return { ...value, outcome: "READ_DENIED", providerEvidenceSha256: null, requestId,
      failure: sanitizeArnProbeFailure({ name: "AccessDenied", $metadata: { requestId, httpStatusCode: 403 } }, "OPERATOR_READINESS", f.now) };
  } } });
  if (!result.cleanup) throw new Error("Test old closure missing");
  const run = await signed({ ...result, cleanup: { ...result.cleanup, evidence: {
    first: lockedV7(result.cleanup.evidence.first), last: lockedV7(result.cleanup.evidence.last),
  } } }, "receiptSha256");
  const originalInspect = await inspectArnProbeComparisonWorkflow({ ...f, creationReview: f.review });
  const inspect = await signed({ ...originalInspect, management: lockedV7(originalInspect.management) }, "receiptSha256");
  const intents = Object.fromEntries(f.intents) as StackScopedReadControlEvidence["intents"];
  const evidence: StackScopedReadControlEvidence = { creationReview: f.review, manifest: f.manifest, run, inspect, intents, diagnostic: {} };
  const journalSha256 = await stackScopedReadControlJournal(evidence), startedAt = new Date(f.now() + 1000).toISOString(), endedAt = new Date(f.now() + 2000).toISOString();
  const policy = JSON.parse(f.review.plan.request.TemplateBody).Resources.CellOperatorBoundary.Properties.PolicyDocument;
  const operatorPolicy = inspect.management.policies.find(p => p.logicalId === "CellOperatorBoundary")!;
  evidence.diagnostic = await signed({ schemaVersion: 1, stage: "B5-J5g-j21", mode: "SOURCE_ONLY_GENERATION4_DESCRIBE_DIAGNOSTIC", startedAt, observedAt: endedAt,
    sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", region: "ca-central-1", creationReviewSha256: f.review.reviewSha256,
    manifestSha256: f.manifest.manifestSha256, runReceiptSha256: run.receiptSha256, previousInspectReceiptSha256: inspect.receiptSha256,
    retirementProofSha256: f.review.plan.input.retirementProof.receiptSha256,
    policies: { arn: operatorPolicy.arn, retainedGrantVersion: "v6", grantDocumentSha256: await sha256Hex(canonicalJson(policy)), retainedGrantMatchesApprovedPlan: true,
      defaultVersion: "v7", lockedDocumentSha256: operatorPolicy.defaultDocumentSha256, temporaryRead: policy.Statement.find((s: { Sid: string }) => s.Sid === "TemporaryAllowComparisonChangeSetRead") },
    management: { before: { ...inspect.management, observedAt: startedAt }, after: { ...inspect.management, observedAt: endedAt }, matchesPreviousLocked: true },
    journal: { inventory: ["claim.json", ...Array.from(f.intents.keys()).map(step => `${step}-intent.json`)].sort(), beforeSha256: journalSha256, afterSha256: journalSha256, modified: false },
    cloudTrail: { startTime: new Date(f.now() - 1000).toISOString(), endTime: new Date(f.now() + 1000).toISOString(), pages: [{ count: 2, requestSha256: "f".repeat(64) }],
      completeWindowInventory: true, expectedRequestIds: run.results.map(r => r.requestId).sort(), matchedRecords: run.results.map((r, i) => ({
        eventId: i === 0 ? "33333333-2222-4333-8444-555555555555" : "44444444-2222-4333-8444-555555555555", eventTime: new Date(f.now()).toISOString(),
        eventName: "DescribeChangeSet", callerArn: r.callerArn, sessionIssuerArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellOperatorRole", region: "ca-central-1",
        requestId: r.requestId, requestStyle: r.requestStyle, errorCode: "AccessDenied", denialReason: "NO_IDENTITY_BASED_ALLOW_ON_EXACT_STACK",
        errorMessageSha256: "75e988f807c2c64501d8fdc0ac3695699ae79eae9d86497fc6a7f823161fd21c", stackName: { state: "NOT_REPORTED", value: null },
        changeSetName: { state: "NOT_REPORTED", value: null }, mfaAuthenticated: true, authorizationContextObserved: false,
      })), bothMatched: true, bothNoIdentityAllow: true },
    authorizationContextObserved: false, rootCauseProven: false, mutationPerformed: false, iamSimulationPerformed: false,
    operatorSessionCreated: false, probeAttemptedByDiagnostic: false, newWindowOpened: false, retryAuthorized: false, productionCompatibilityVerified: false, runtimeEnabled: false,
    receiptSha256: "",
  }, "receiptSha256");
  const predecessor = await closeGeneration4ForStackScopedReadControl(evidence);
  const at = Date.parse(f.review.plan.input.comparisonPlan.input.expiresAt) + 1000;
  return { evidence, predecessor, reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 1_800_000).toISOString() };
}
