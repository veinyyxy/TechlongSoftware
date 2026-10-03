import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderB5CellLifecycleManagementTemplate } from "../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";
import { compileSharedCellAuthorCompensationIamReview, inspectSharedCellAuthorCompensationIamReview,
  type SharedCellAuthorCompensationIamReview } from "../lib/deployments/execution/shared-cell-author-compensation-iam-review.ts";

const raw = "a".repeat(64);
const name = `techlong-sandbox-cell-sandbox-1-${raw.slice(0, 16)}`;
const stack = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-4333-8444-555555555555";
const arn = `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${name}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
async function fixture() {
  return renderB5CellLifecycleManagementTemplate({ shape: "AuthorCompensationDeleteChangeSetGrant",
    approvedChangeSetName: name, approvedTemplateSha256: raw, approvedTemplateCanonicalSha256: "b".repeat(64),
    approvedCellExpiresAt: "2026-10-03T16:00:00.000Z", grantReviewedAt: "2026-10-03T13:00:00.000Z", grantExpiresAt: "2026-10-03T14:00:00.000Z",
    approvedStackId: stack, approvedChangeSetArn: arn, approvedCompensationPlanSha256: "c".repeat(64),
    compensationReviewedAt: "2026-10-03T13:00:00.000Z", compensationExpiresAt: "2026-10-03T14:00:00.000Z" });
}
function provider(plan: SharedCellAuthorCompensationIamReview, mutate?: (response: Record<string, unknown>) => void) {
  let calls = 0;
  return { count: () => calls, port: {
    getCallerIdentity: async () => ({ Account: plan.account, Arn: plan.sourceArn, UserId: "source-user" }),
    simulateCustomPolicy: async () => {
      const item = plan.cases[calls++];
      const response = { $metadata: { requestId: `simulation-${calls}` }, IsTruncated: false, EvaluationResults: [{
        EvalActionName: item.request.ActionNames[0], EvalResourceName: item.request.ResourceArns[0],
        EvalDecision: item.expectedDecision, MissingContextValues: item.expectedMissingContext,
        PermissionsBoundaryDecisionDetail: { AllowedByPermissionsBoundary: item.expectedDecision === "allowed" },
      }] };
      mutate?.(response);
      return response;
    },
  } };
}
test("IAM review deterministically reproduces the split renderer and binds exact ARN, stack and boundary", async () => {
  const body = await fixture();
  const plan = await compileSharedCellAuthorCompensationIamReview(body);
  assert.deepEqual(plan, await compileSharedCellAuthorCompensationIamReview(body));
  assert.equal(plan.cases.length, 13);
  assert.equal(plan.providerContextCompatibilityVerified, false);
  assert.equal(plan.targetExistenceVerified, false);
  assert.equal(Object.isFrozen(plan.cases[0].request.ContextEntries[0]), true);
  const policy = JSON.parse(plan.cases[0].request.PolicyInputList[0]);
  assert.deepEqual(plan.cases[0].request.PolicyInputList, plan.cases[0].request.PermissionsBoundaryPolicyInputList);
  const writes = policy.Statement.filter((item: { Sid: string }) => item.Sid === "TemporaryAllowDiscardExactReviewedAuthorChangeSet");
  assert.equal(writes[0].Resource, stack);
  assert.equal(writes[0].Condition.StringEquals["cloudformation:ChangeSetName"], arn);
  assert.equal(writes[0].Condition.DateLessThan["aws:CurrentTime"], "2026-10-03T13:50:00.000Z");
});
test("IAM review refuses arbitrary policy edits, Locked shapes and forged compatibility metadata", async () => {
  const body = JSON.parse(await fixture());
  body.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement.at(-1).Resource = "*";
  await assert.rejects(compileSharedCellAuthorCompensationIamReview(JSON.stringify(body)));
  for (const key of ["CloudApplyEnabled", "CompensationChangeSetArnRequestIamConditionCompatibilityVerified"]) {
    const value = JSON.parse(await fixture()); value.Metadata.SafetyBoundary[key] = true;
    await assert.rejects(compileSharedCellAuthorCompensationIamReview(JSON.stringify(value)));
  }
  await assert.rejects(compileSharedCellAuthorCompensationIamReview(await renderB5CellLifecycleManagementTemplate({ shape: "Locked" })));
  await assert.rejects(compileSharedCellAuthorCompensationIamReview(" ".repeat(51_201)));
});
test("complete AWS-shaped simulation evidence is still not service compatibility or deployment proof", async () => {
  const plan = await compileSharedCellAuthorCompensationIamReview(await fixture());
  const mock = provider(plan);
  const result = await inspectSharedCellAuthorCompensationIamReview(plan, mock.port, new AbortController().signal);
  assert.equal(mock.count(), 13);
  assert.equal(result.providerContextCompatibilityVerified, false);
  assert.equal(result.cloudApplyEnabled, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.basis, "AWS_IAM_CUSTOM_POLICY_SIMULATION_WITH_SYNTHETIC_CONTEXT");
});
test("tampered plan and wrong caller submit zero simulation requests", async () => {
  const plan = await compileSharedCellAuthorCompensationIamReview(await fixture());
  const mock = provider(plan);
  await assert.rejects(inspectSharedCellAuthorCompensationIamReview({ ...plan, reviewSha256: "0".repeat(64) }, mock.port, new AbortController().signal), /drifted/);
  await assert.rejects(inspectSharedCellAuthorCompensationIamReview(plan, { ...mock.port, getCallerIdentity: async () => ({ Account: plan.account, Arn: "wrong", UserId: "wrong" }) }, new AbortController().signal), /Source caller/);
  assert.equal(mock.count(), 0);
});
test("truncated, wrong decision, missing boundary and request ID evidence fail closed", async () => {
  const plan = await compileSharedCellAuthorCompensationIamReview(await fixture());
  for (const mutate of [
    (value: Record<string, unknown>) => { value.IsTruncated = true; },
    (value: Record<string, unknown>) => { (value.EvaluationResults as Record<string, unknown>[])[0].EvalDecision = "implicitDeny"; },
    (value: Record<string, unknown>) => { (value.EvaluationResults as Record<string, unknown>[])[0].EvalResourceName = "*"; },
    (value: Record<string, unknown>) => { (value.EvaluationResults as Record<string, unknown>[])[0].PermissionsBoundaryDecisionDetail = {}; },
    (value: Record<string, unknown>) => { value.$metadata = {}; },
  ]) {
    const mock = provider(plan, mutate);
    await assert.rejects(inspectSharedCellAuthorCompensationIamReview(plan, mock.port, new AbortController().signal));
    assert.equal(mock.count(), 1);
  }
});
test("abort and provider failure are never retried by the review executor", async () => {
  const plan = await compileSharedCellAuthorCompensationIamReview(await fixture());
  const mock = provider(plan);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectSharedCellAuthorCompensationIamReview(plan, mock.port, controller.signal));
  assert.equal(mock.count(), 0);
  let failures = 0;
  await assert.rejects(inspectSharedCellAuthorCompensationIamReview(plan, { ...mock.port, simulateCustomPolicy: async () => { failures++; throw new Error("provider unavailable"); } }, new AbortController().signal));
  assert.equal(failures, 1);
});
test("review CLI has fixed login-only identity and imports no AWS mutation commands", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/review-b5-author-compensation-iam.ts", import.meta.url), "utf8");
  assert.match(cli, /techlong-sandbox-user/);
  assert.match(cli, /fromLoginCredentials/);
  assert.match(cli, /--acknowledge-read-only/);
  assert.match(cli, /flag: "wx"/);
  assert.match(cli, /maxAttempts: 1/);
  assert.doesNotMatch(cli, /(?:Create|Delete|Execute|Put|Update|Attach|Detach|AssumeRole)\w*Command/);
});
