import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { generation4Fixture } from "./arn-probe-generation3-retirement.ts";
import { testComparisonManagement } from "./arn-probe-generation3-workflow.ts";
import { arnProbeComparisonClaimBinding } from "../../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";
import { compileArnProbeComparisonWorkflow, type ArnProbeComparisonWorkflowReads, type ArnProbeComparisonJournal, type ArnProbeComparisonStep,
  type ArnProbeComparisonCaseResult, type ArnProbeComparisonApproval } from "../../lib/deployments/execution/arn-probe-read-comparison-generation4-workflow.ts";
import { sanitizeArnProbeFailure } from "../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { ARN_PROBE_OPERATOR_CALLER } from "../../lib/deployments/execution/arn-compatibility-probe-workflow.ts";
import type { ArnProbeReadComparisonManagementObservation } from "../../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

// Test-only in-memory provider ports and fixed time. Never loads live SDK/ledger.
export const comparisonTestAt = Date.parse("2026-10-04T16:00:02.000Z");
export const comparisonTestId = "11111111-2222-4333-8444-555555555555";
export const testSignal = () => new AbortController().signal;
export { testComparisonManagement };
let cachedPreparation: ReturnType<typeof generation4Fixture> | undefined;
export async function comparisonWorkflowFixture() {
  let at = comparisonTestAt, granted = false, revokeReady = false;
  const events: string[] = [], intents = new Map<ArnProbeComparisonStep, Readonly<Record<string, unknown>>>();
  cachedPreparation ??= generation4Fixture();
  const now = () => at, prepared = await cachedPreparation, { review, fence } = prepared;
  const prior = review.sourceReview.plan.input.priorPlan;
  const readPredecessor = async () => review.sourceReview.predecessor;
  const fixture = review.sourceReview.observation.fixtureAfter;
  const claimBody = { schemaVersion: 1 as const, action: "CLAIM_GENERATION4_BEFORE_CREATE" as const, fence, binding: await arnProbeComparisonClaimBinding(review), preflightEvidenceSha256: "f".repeat(64), reservedAt: new Date(at).toISOString() };
  const claim = { ...claimBody, claimSha256: await sha256Hex(canonicalJson(claimBody)) };
  const grantArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${review.plan.request.ChangeSetName}/${comparisonTestId}`;
  const manifest = await compileArnProbeComparisonWorkflow({ creationReview: review, claim, grantChangeSetArn: grantArn, reviewedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300_000).toISOString() });
  const revokeArn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${manifest.actions.revoke.createRequest.ChangeSetName}/${comparisonTestId}`;
  const management = async () => {
    const value = structuredClone(review.sourceReview.observation.managementAfter) as Mutable<ArnProbeReadComparisonManagementObservation>;
    value.observedAt = new Date(at).toISOString();
    if (granted) {
      const rendered = await testComparisonManagement(review.plan.request.TemplateBody, prior.managementStackId, true, at);
      value.rendererShape = rendered.rendererShape;
      value.stack.templateRawSha256 = rendered.stack.templateRawSha256;
      value.stack.templateCanonicalSha256 = rendered.stack.templateCanonicalSha256;
      value.stack.safetyState = rendered.stack.safetyState;
      const operator = value.policies.find((p) => p.logicalId === "CellOperatorBoundary")!;
      operator.defaultVersionId = "v6"; operator.versionIds = [...operator.versionIds, "v6"];
      operator.defaultDocumentSha256 = rendered.policies.find((p) => p.logicalId === "CellOperatorBoundary")!.defaultDocumentSha256;
    }
    return value;
  };
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
