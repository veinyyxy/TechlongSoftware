import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileArnProbeFixturePlan, ARN_PROBE_FIXTURE_STACK } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan, assertArnProbeGrantPlan, reviewArnProbeGrantCreate, createReviewedArnProbeGrant,
  recoverArnProbeGrantCreate, validateArnProbeGrantChangeSet, type ArnProbeGrantPlan, type ArnProbeGrantReadPort } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { AwsSdkArnProbeGrantReadAdapter, AwsSdkArnProbeGrantCreateAdapter } from "../lib/deployments/execution/aws-sdk-arn-compatibility-probe-grant.ts";

const timestamp = "2026-10-03T17:00:00.000Z", time = Date.parse(timestamp), now = () => time;
const signal = () => new AbortController().signal;
async function plan() {
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: "2026-10-03T15:00:00.000Z", expiresAt: "2026-10-03T16:00:00.000Z" });
  return compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`,
    fixtureChangeSetArn: `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${fixturePlan.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
    nonce: "b".repeat(32), reviewedAt: timestamp, expiresAt: "2026-10-03T18:00:00.000Z" });
}
function reads(value: ArnProbeGrantPlan, observed = timestamp): ArnProbeGrantReadPort {
  return {
    readLockedPreflight: async () => ({ schemaVersion: 1, accountId: "402010193138", region: "ca-central-1", callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
      rendererShape: "Locked", cellStackState: "MISSING", authorityState: "ABSENT", observedAt: observed, policies: [], roles: [],
      stack: { name: "techlong-s3-b5-cell-lifecycle-management", id: value.managementStackId, status: "CREATE_COMPLETE", roleArn: null, parentId: null, rootId: null, terminationProtection: false,
        templateRawSha256: value.revokeTarget.templateRawSha256, templateCanonicalSha256: value.revokeTarget.templateCanonicalSha256, safetyState: "LOCKED", resources: [] } }),
    readFixture: async () => ({ state: "READY_UNEXECUTED", stackId: value.input.fixtureStackId, changeSetArn: value.input.fixtureChangeSetArn,
      templateCanonicalSha256: value.input.fixturePlan.templateCanonicalSha256, resourceCount: 0, observedAt: observed }),
    readGrantChangeSet: async () => ({ state: "MISSING", proof: "COMPLETE_MANAGEMENT_CHANGE_SET_INVENTORY", observedAt: observed }),
  };
}
const arn = (p: ArnProbeGrantPlan) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${p.request.ChangeSetName}/aaaaaaaa-2222-4333-8444-bbbbbbbbbbbb`;
function provider(p: ArnProbeGrantPlan) {
  return { StackId: p.managementStackId, StackName: "techlong-s3-b5-cell-lifecycle-management", ChangeSetName: p.request.ChangeSetName, ChangeSetId: arn(p),
    Description: p.request.Description, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Capabilities: ["CAPABILITY_NAMED_IAM"],
    Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: "402010193138" }, { ParameterKey: "ExpectedRegion", ParameterValue: "ca-central-1" }, { ParameterKey: "ManagementPrincipalArn", ParameterValue: p.input.fixturePlan.sourceArn }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "CellOperatorBoundary", ResourceType: "AWS::IAM::ManagedPolicy",
      PhysicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", Replacement: "False" } }] };
}
test("probe grant candidate is deterministic and changes only the existing operator boundary, not execution role/trust or production shapes", async () => {
  const p = await plan(); assert.deepEqual(p, await plan()); await assertArnProbeGrantPlan(p);
  const target = JSON.parse(p.request.TemplateBody), locked = JSON.parse(p.revokeTarget.templateBody);
  for (const key of ["CellOperatorRole", "CellCloudFormationExecutionBoundary", "CellCloudFormationExecutionRole"]) assert.deepEqual(target.Resources[key], locked.Resources[key]);
  assert.deepEqual(target.Parameters, locked.Parameters); assert.deepEqual(target.Conditions, locked.Conditions);
  const baseline = locked.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
  const statements = target.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
  assert.deepEqual(statements.slice(0, baseline.length), baseline); assert.equal(statements.length, baseline.length + 3);
  const mutation = statements.at(-1);
  assert.equal(mutation.Action, "cloudformation:DeleteChangeSet"); assert.equal(mutation.Resource, p.input.fixtureStackId);
  assert.equal(mutation.Condition.StringEquals["cloudformation:ChangeSetName"], p.input.fixtureChangeSetArn);
  assert.equal(mutation.Condition.DateLessThan["aws:CurrentTime"], "2026-10-03T17:50:00.000Z");
  assert.deepEqual(p.allowedWriteActions, ["cloudformation:CreateChangeSet"]); assert.equal(p.createApprovalExpiresAt, "2026-10-03T17:45:00.000Z");
  for (const key of ["grantExecutionAllowed", "probeDeletionAllowed", "cleanupAllowed", "runtimeEnabled", "providerContextCompatibilityVerified"]) assert.equal(p[key as keyof typeof p], false);
  assert.equal(target.Metadata.SafetyBoundary.CloudApplyEnabled, false);
  await assert.rejects(compileArnProbeGrantPlan({ ...p.input, fixtureStackId: p.managementStackId }));
  await assert.rejects(assertArnProbeGrantPlan({ ...p, deleteCutoff: "2026-10-03T18:00:00.000Z" }));
});
test("grant create review proves real target/Locked/authority and brackets the same unexecuted fixture", async () => {
  const p = await plan(), port = reads(p), review = await reviewArnProbeGrantCreate(p, port, signal(), now);
  assert.equal(review.mutationPerformed, false); assert.equal(review.grantInstalled, false);
  await assert.rejects(reviewArnProbeGrantCreate(p, { ...port, readFixture: async () => ({ state: "MISSING", proof: "EXACT_NAME_BOUND_STACK_MISSING", observedAt: timestamp }) }, signal(), now));
  await assert.rejects(reviewArnProbeGrantCreate(p, { ...port, readLockedPreflight: async (abort) => ({ ...await port.readLockedPreflight(abort), rendererShape: "AuthorCompensationDeleteChangeSetGrant" }) }, signal(), now));
  await assert.rejects(reviewArnProbeGrantCreate(p, { ...port, readGrantChangeSet: async () => ({ state: "MISSING", proof: "unknown", observedAt: timestamp }) } as unknown as ArnProbeGrantReadPort, signal(), now));
  await assert.rejects(reviewArnProbeGrantCreate(p, port, signal(), () => time + 2_700_000));
});
test("grant creation requires exact acknowledgement, one persisted intent, one request; loss never authorizes replay", async () => {
  const p = await plan(), port = reads(p), review = await reviewArnProbeGrantCreate(p, port, signal(), now); let reserved = false, calls = 0;
  const input = { review, approvedReviewSha256: review.reviewSha256, acknowledgeAwsWrite: true, acknowledgeCreatesNamedIamChangeSetOnly: true,
    executionPhrase: "I_CONFIRM_J5GJ10_CREATE_PROBE_GRANT_CHANGE_SET_ONLY", reads: port, signal: signal(), now,
    reserve: async () => { if (reserved) throw new Error("intent exists"); reserved = true; },
    create: async (request: ArnProbeGrantPlan["request"]) => { assert.equal(reserved, true); assert.deepEqual(request, p.request); calls++; throw new Error("lost secret provider reply"); } };
  await assert.rejects(createReviewedArnProbeGrant({ ...input, approvedReviewSha256: "0".repeat(64) }));
  await assert.rejects(createReviewedArnProbeGrant({ ...input, acknowledgeCreatesNamedIamChangeSetOnly: false }));
  assert.equal(calls, 0); assert.equal(reserved, false);
  const result = await createReviewedArnProbeGrant(input);
  assert.equal(result.outcome, "CREATE_UNCERTAIN"); assert.equal(result.mutationPerformed, null); assert.doesNotMatch(JSON.stringify(result), /secret provider/);
  await assert.rejects(createReviewedArnProbeGrant(input), /intent exists/); assert.equal(calls, 1);
  const later = time + 7_200_000;
  const recovered = await recoverArnProbeGrantCreate(p, reads(p, new Date(later).toISOString()), signal(), () => later);
  assert.equal(recovered.retryAuthorized, false); assert.equal(recovered.mutationPerformed, false);
});
test("caller cancellation after intent uses an independent single create delegate and never runs Execute", async () => {
  const p = await plan(), port = reads(p), review = await reviewArnProbeGrantCreate(p, port, signal(), now), controller = new AbortController(); let calls = 0;
  const result = await createReviewedArnProbeGrant({ review, approvedReviewSha256: review.reviewSha256, acknowledgeAwsWrite: true, acknowledgeCreatesNamedIamChangeSetOnly: true,
    executionPhrase: "I_CONFIRM_J5GJ10_CREATE_PROBE_GRANT_CHANGE_SET_ONLY", reads: port, signal: controller.signal, now, reserve: async () => { controller.abort(); },
    create: async (_request, delegate) => { assert.notEqual(delegate, controller.signal); assert.equal(delegate.aborted, false); calls++; return { StackId: p.managementStackId, Id: arn(p), $metadata: { requestId: "single" } }; } });
  assert.equal(result.outcome, "CREATE_SUBMITTED"); assert.equal(calls, 1); assert.equal(result.grantInstalled, false); assert.equal(result.probeDeleted, false);
});
test("grant provider validation requires exact template, one non-replaced operator boundary Modify, identity and stable complete evidence", async () => {
  const p = await plan(), before = provider(p), original = { TemplateBody: p.request.TemplateBody };
  assert.equal((await validateArnProbeGrantChangeSet(p, before, structuredClone(before), original, timestamp)).state, "READY_UNEXECUTED");
  for (const mutate of [
    (v: typeof before) => { v.Changes[0].ResourceChange.Replacement = "True"; },
    (v: typeof before) => { v.Changes[0].ResourceChange.LogicalResourceId = "CellCloudFormationExecutionRole"; },
    (v: typeof before) => { v.Status = "CREATE_PENDING"; },
    (v: typeof before) => { v.ChangeSetId = "arn:foreign"; },
  ]) { const changed = structuredClone(before); mutate(changed); await assert.rejects(validateArnProbeGrantChangeSet(p, changed, changed, original, timestamp)); }
  await assert.rejects(validateArnProbeGrantChangeSet(p, before, before, { TemplateBody: "{}" }, timestamp));
  await assert.rejects(validateArnProbeGrantChangeSet(p, { ...before, RoleARN: "arn:foreign" }, { ...before, RoleARN: "arn:foreign" }, original, timestamp));
  await assert.rejects(validateArnProbeGrantChangeSet(p, { ...before, NextToken: "truncated" }, { ...before, NextToken: "truncated" }, original, timestamp));
});
test("SDK discovers from complete exact management inventory then uses full ARN only; pending competing changes fail closed", async () => {
  const p = await plan(), port = reads(p), calls: Record<string, unknown>[] = [];
  class List { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class Describe { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class Template { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  let inventory: Record<string, unknown> = { Summaries: [] };
  const adapter = new AwsSdkArnProbeGrantReadAdapter(port, { send: async (command) => {
    const item = command as List; calls.push(item.input);
    if (command instanceof List) return inventory;
    assert.equal(item.input.ChangeSetName, arn(p));
    return command instanceof Template ? { TemplateBody: p.request.TemplateBody } : provider(p);
  } }, { listChangeSets: List, describeChangeSet: Describe, getTemplate: Template }, now);
  assert.equal((await adapter.readGrantChangeSet(p, signal())).state, "MISSING");
  inventory = { Summaries: [provider(p)] };
  assert.equal((await adapter.readGrantChangeSet(p, signal())).state, "READY_UNEXECUTED");
  assert.equal(calls.filter((v) => v.ChangeSetName === arn(p)).length, 3);
  inventory = { Summaries: [], NextToken: "incomplete" }; await assert.rejects(adapter.readGrantChangeSet(p, signal()));
  inventory = { Summaries: [{ ...provider(p), ChangeSetName: "other", ChangeSetId: "other" }] }; await assert.rejects(adapter.readGrantChangeSet(p, signal()), /pending management/);
});
test("SDK create rejects drift and is single-submit even after response loss; CLI has no execute/delete/role/IAM mutation modes", async () => {
  const p = await plan(); let calls = 0;
  class Create { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const adapter = new AwsSdkArnProbeGrantCreateAdapter(p, { send: async () => { calls++; throw new Error("lost reply"); } }, Create);
  await assert.rejects(adapter.create({ ...p.request, StackName: p.input.fixtureStackId } as unknown as ArnProbeGrantPlan["request"], signal())); assert.equal(calls, 0);
  await assert.rejects(adapter.create(p.request, signal())); await assert.rejects(adapter.create(p.request, signal()), /single-submit/); assert.equal(calls, 1);
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-grant.ts", import.meta.url), "utf8");
  assert.match(cli, /grant-create-intent.json/); assert.match(cli, /maxAttempts: 1/); assert.match(cli, /open\(output, "wx"\)/); assert.match(cli, /await handle.sync\(\)/);
  assert.doesNotMatch(cli, /(?:Execute|Delete|Put|Attach|Detach|Update|AssumeRole)\w*Command/); assert.doesNotMatch(cli, /\b(?:unlink|rm|rmdir)\(/);
});
