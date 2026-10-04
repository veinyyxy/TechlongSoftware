import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject, ARN_PROBE_OPERATOR_CALLER, ARN_PROBE_OPERATOR_ROLE, ARN_PROBE_MFA } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";
import { comparisonGrantArn } from "./arn-probe-read-comparison-generation4-create.ts";
import { assertStackControlCreateReview, assertStackControlClaim, stackControlClaimBinding, stackControlCopy,
  type StackControlCreateReview, type StackControlClaim } from "./arn-probe-stack-scoped-read-control-create.ts";

export const STACK_CONTROL_STEPS = ["run", "grant-execute", "read-full-arn", "read-exact-name", "revoke-create", "revoke-execute"] as const;
export type StackControlStep = typeof STACK_CONTROL_STEPS[number];
/** Exact future action/journal binding only. No installer, MFA login or runner.
 * A compiler output is not user approval and does not reserve any real intent. */
export async function compileStackControlActions(input: { creationReview: StackControlCreateReview; claim: StackControlClaim;
  grantChangeSetArn: string; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["claim", "creationReview", "expiresAt", "grantChangeSetArn", "reviewedAt"], "J22 future action inputs");
  const review = input.creationReview, plan = review.plan;
  await assertStackControlCreateReview(review); await assertStackControlClaim(input.claim, review.fence);
  probeSame(input.claim.binding, await stackControlClaimBinding(review), "J22 future actions exact creation claim");
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (!comparisonGrantArn(plan, input.grantChangeSetArn) || start < probeInstant(input.claim.reservedAt) || end <= start || end - start > 300_000 ||
    probeInstant(plan.input.candidate.input.expiresAt) - end < 600_000) throw new Error("J22 future actions need exact ARN, <=5-minute approval and >=10-minute revoke margin.");
  const operationSha256 = await sha256Hex(canonicalJson({ reviewSha256: review.reviewSha256, claimSha256: input.claim.claimSha256,
    grantChangeSetArn: input.grantChangeSetArn, reviewedAt: input.reviewedAt, expiresAt: input.expiresAt, generation: 5 }));
  const revokeRequest = { ...plan.request, ChangeSetName: `techlong-j5gj22-stack-read-revoke-${operationSha256.slice(0, 16)}`,
    ClientToken: `j5gj22-stack-revoke-create-${operationSha256}`, Description: `J5g-j22 exact Locked revoke ${operationSha256}`, TemplateBody: plan.revokeTarget.templateBody };
  const actions = { grantExecute: { callerArn: ARN_PROBE_SOURCE, request: { StackName: plan.request.StackName, ChangeSetName: input.grantChangeSetArn,
    ClientRequestToken: `j5gj22-stack-grant-execute-${operationSha256}`, DisableRollback: false } },
    operatorReads: { callerArn: ARN_PROBE_OPERATOR_CALLER, roleArn: ARN_PROBE_OPERATOR_ROLE, mfaDeviceArn: ARN_PROBE_MFA,
      cases: plan.input.candidate.proposedReadMatrix, maxTotalSubmissions: 2, noAuthorizationPropagationRetry: true },
    revoke: { callerArn: ARN_PROBE_SOURCE, createRequest: revokeRequest, executeClientToken: `j5gj22-stack-revoke-execute-${operationSha256}`,
      executeDiscoveredFullArnOnly: true, recoveryAfterExpiryAllowed: true } };
  const actionSha256 = { grantExecute: await sha256Hex(canonicalJson(actions.grantExecute)), operatorReads: await sha256Hex(canonicalJson(actions.operatorReads)),
    revoke: await sha256Hex(canonicalJson(actions.revoke)) };
  const body = { schemaVersion: 1, stage: "B5-J5g-j22", action: "PREPARE_FUTURE_STACK_CONTROL_ACTION_BINDING", input, operationSha256, actions, actionSha256,
    requiredPhrase: "I_CONFIRM_J5GJ22_STACK_READ_GRANT_TWO_READS_AND_IMMEDIATE_REVOKE", installationToolsImplemented: false,
    grantInstallationApproved: false, childExecutionAllowed: false, probeDeletionAllowed: false, deleteStackAllowed: false,
    productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type StackControlActions = Awaited<ReturnType<typeof compileStackControlActions>>;
export async function assertStackControlActions(manifest: StackControlActions) { probeSame(manifest, await compileStackControlActions(manifest.input), "J22 future action bindings"); }
export function stackControlStepRequest(m: StackControlActions, step: StackControlStep, supplied?: unknown) {
  if (step === "run") return m.actions;
  if (step === "grant-execute") return m.actions.grantExecute.request;
  if (step === "revoke-create") return m.actions.revoke.createRequest;
  if (step === "read-full-arn" || step === "read-exact-name") return m.actions.operatorReads.cases.find(c => c.requestStyle === (step === "read-full-arn" ? "FULL_ARN_REQUEST" : "EXACT_NAME_REQUEST"))!.request;
  if (step !== "revoke-execute") throw new Error("Unknown J22 journal step.");
  const request = probeObject(supplied);
  if (typeof request.ChangeSetName !== "string" || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, request.ChangeSetName)) throw new Error("J22 Revoke intent requires exact discovered ARN.");
  return { StackName: m.input.creationReview.plan.request.StackName, ChangeSetName: request.ChangeSetName,
    ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false };
}
export interface StackControlJournal {
  load(step: StackControlStep): Promise<Readonly<Record<string, unknown>> | null>;
  reserve(step: StackControlStep, request: unknown, reservedAt: string): Promise<void>;
}
