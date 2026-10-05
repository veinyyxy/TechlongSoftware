import { canonicalJson, sha256Hex } from "./hash.ts";
import { probeSame, probeInstant, probeObject, ARN_PROBE_OPERATOR_CALLER, ARN_PROBE_OPERATOR_ROLE, ARN_PROBE_MFA } from "./arn-compatibility-probe-workflow.ts";
import { ARN_PROBE_SOURCE } from "./arn-compatibility-probe-fixture.ts";
import { comparisonGrantArn } from "./arn-probe-read-comparison-generation4-create.ts";
import { stackControlCopy } from "./arn-probe-stack-scoped-read-control-create.ts";
import { assertGeneration6CreateReview, assertGeneration6Claim, generation6ClaimBinding,
  type Generation6CreateReview, type Generation6Claim } from "./arn-probe-stack-control-generation6.ts";

export const GENERATION6_STEPS = ["run", "grant-execute", "read-full-arn", "read-exact-name", "revoke-create", "revoke-execute"] as const;
export type Generation6Step = typeof GENERATION6_STEPS[number];
/** Exact future action/journal binding only. No installer, MFA login or runner.
 * A compiler output is not user approval and does not reserve any real intent. */
export async function compileGeneration6Actions(input: { creationReview: Generation6CreateReview; claim: Generation6Claim;
  grantChangeSetArn: string; reviewedAt: string; expiresAt: string }) {
  probeSame(Object.keys(input).sort(), ["claim", "creationReview", "expiresAt", "grantChangeSetArn", "reviewedAt"], "J23 generation6 future action inputs");
  const review = input.creationReview, plan = review.plan;
  await assertGeneration6CreateReview(review); await assertGeneration6Claim(input.claim, review.fence);
  probeSame(input.claim.binding, await generation6ClaimBinding(review), "J23 generation6 future actions exact creation claim");
  const start = probeInstant(input.reviewedAt), end = probeInstant(input.expiresAt);
  if (!comparisonGrantArn(plan, input.grantChangeSetArn) || start < probeInstant(input.claim.reservedAt) || end <= start || end - start > 300_000 ||
    probeInstant(plan.input.candidate.input.expiresAt) - end < 600_000) throw new Error("J23 generation6 future actions need exact ARN, <=5-minute approval and >=10-minute revoke margin.");
  const operationSha256 = await sha256Hex(canonicalJson({ reviewSha256: review.reviewSha256, claimSha256: input.claim.claimSha256,
    grantChangeSetArn: input.grantChangeSetArn, reviewedAt: input.reviewedAt, expiresAt: input.expiresAt, generation: 6 }));
  const revokeRequest = { ...plan.request, ChangeSetName: `techlong-j5gj23-stack-read-revoke-${operationSha256.slice(0, 16)}`,
    ClientToken: `j5gj23-stack-revoke-create-${operationSha256}`, Description: `J5g-j23 generation6 exact Locked revoke ${operationSha256}`, TemplateBody: plan.revokeTarget.templateBody };
  const actions = { grantExecute: { callerArn: ARN_PROBE_SOURCE, request: { StackName: plan.request.StackName, ChangeSetName: input.grantChangeSetArn,
    ClientRequestToken: `j5gj23-stack-grant-execute-${operationSha256}`, DisableRollback: false } },
    operatorReads: { callerArn: ARN_PROBE_OPERATOR_CALLER, roleArn: ARN_PROBE_OPERATOR_ROLE, mfaDeviceArn: ARN_PROBE_MFA,
      cases: plan.input.candidate.proposedReadMatrix, maxTotalSubmissions: 2, noAuthorizationPropagationRetry: true },
    revoke: { callerArn: ARN_PROBE_SOURCE, createRequest: revokeRequest, executeClientToken: `j5gj23-stack-revoke-execute-${operationSha256}`,
      executeDiscoveredFullArnOnly: true, recoveryAfterExpiryAllowed: true } };
  const actionSha256 = { grantExecute: await sha256Hex(canonicalJson(actions.grantExecute)), operatorReads: await sha256Hex(canonicalJson(actions.operatorReads)),
    revoke: await sha256Hex(canonicalJson(actions.revoke)) };
  const body = { schemaVersion: 1, stage: "B5-J5g-j23", action: "PREPARE_FUTURE_GENERATION6_ACTION_BINDING", input, operationSha256, actions, actionSha256,
    requiredPhrase: "I_CONFIRM_J5GJ23_GENERATION6_STACK_READ_GRANT_TWO_READS_AND_IMMEDIATE_REVOKE", installationToolsImplemented: false,
    grantInstallationApproved: false, childExecutionAllowed: false, probeDeletionAllowed: false, deleteStackAllowed: false,
    productionCompatibilityVerified: false, runtimeEnabled: false };
  return stackControlCopy({ ...body, manifestSha256: await sha256Hex(canonicalJson(body)) });
}
export type Generation6Actions = Awaited<ReturnType<typeof compileGeneration6Actions>>;
export async function assertGeneration6Actions(manifest: Generation6Actions) { probeSame(manifest, await compileGeneration6Actions(manifest.input), "J23 generation6 future action bindings"); }
export function generation6StepRequest(m: Pick<Generation6Actions, "actions" | "input">, step: Generation6Step, supplied?: unknown) {
  if (step === "run") return m.actions;
  if (step === "grant-execute") return m.actions.grantExecute.request;
  if (step === "revoke-create") return m.actions.revoke.createRequest;
  if (step === "read-full-arn" || step === "read-exact-name") return m.actions.operatorReads.cases.find(c => c.requestStyle === (step === "read-full-arn" ? "FULL_ARN_REQUEST" : "EXACT_NAME_REQUEST"))!.request;
  if (step !== "revoke-execute") throw new Error("Unknown J23 generation6 journal step.");
  const request = probeObject(supplied);
  if (typeof request.ChangeSetName !== "string" || !comparisonGrantArn({ request: m.actions.revoke.createRequest }, request.ChangeSetName)) throw new Error("J23 generation6 Revoke intent requires exact discovered ARN.");
  return { StackName: m.input.creationReview.plan.request.StackName, ChangeSetName: request.ChangeSetName,
    ClientRequestToken: m.actions.revoke.executeClientToken, DisableRollback: false };
}
export interface Generation6Journal {
  load(step: Generation6Step): Promise<Readonly<Record<string, unknown>> | null>;
  reserve(step: Generation6Step, request: unknown, reservedAt: string): Promise<void>;
}
