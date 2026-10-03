import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileArnProbeFixturePlan, reviewArnProbeFixtureCreate, createReviewedArnProbeFixture,
  recoverArnProbeFixture, validateArnProbeFixtureEvidence, ARN_PROBE_FIXTURE_STACK, ARN_PROBE_EXECUTION_ROLE,
  type ArnProbeFixturePlan, type ArnProbeFixtureCreateApproval, type ArnProbeFixtureState } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { AwsSdkArnProbeFixtureCreateAdapter, AwsSdkArnProbeFixtureReadAdapter } from "../lib/deployments/execution/aws-sdk-arn-compatibility-probe-fixture.ts";
import type { CollectedManagementObservation } from "../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";

const timestamp = "2026-10-03T16:00:00.000Z", time = Date.parse(timestamp);
const stackId = `arn:aws:cloudformation:ca-central-1:402010193138:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`;
const now = () => time, signal = () => new AbortController().signal;
async function plan() { return compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: timestamp, expiresAt: "2026-10-03T17:00:00.000Z" }); }
const arn = (value: ArnProbeFixturePlan) => `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${value.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
function locked(value: ArnProbeFixturePlan, observedAt = timestamp): CollectedManagementObservation {
  return { schemaVersion: 1, accountId: "402010193138", region: "ca-central-1", callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
    rendererShape: "Locked", cellStackState: "MISSING", authorityState: "ABSENT", observedAt, policies: [], roles: [],
    stack: { name: "techlong-s3-b5-cell-lifecycle-management", id: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d", status: "CREATE_COMPLETE", roleArn: null, parentId: null, rootId: null, terminationProtection: false,
      templateRawSha256: value.lockedTemplateRawSha256, templateCanonicalSha256: value.lockedTemplateCanonicalSha256, safetyState: "LOCKED", resources: [] } };
}
function reads(value: ArnProbeFixturePlan) {
  return { readLockedPreflight: async () => locked(value), readFixture: async (): Promise<ArnProbeFixtureState> => ({ state: "MISSING", proof: "EXACT_NAME_BOUND_STACK_MISSING", observedAt: timestamp }) };
}
function evidence(value: ArnProbeFixturePlan) {
  const stack = { StackName: ARN_PROBE_FIXTURE_STACK, StackId: stackId, StackStatus: "REVIEW_IN_PROGRESS", RoleARN: ARN_PROBE_EXECUTION_ROLE,
    EnableTerminationProtection: false, Tags: value.request.Tags };
  const changeSet = { StackName: ARN_PROBE_FIXTURE_STACK, StackId: stackId, ChangeSetName: value.request.ChangeSetName, ChangeSetId: arn(value), Description: value.request.Description,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false, ImportExistingResources: false, OnStackFailure: "DELETE", Tags: value.request.Tags,
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ProbeHandle", ResourceType: "AWS::CloudFormation::WaitConditionHandle" } }] };
  return { stackBefore: { Stacks: [stack], $metadata: { requestId: "stack-1" } }, stackAfter: { Stacks: [structuredClone(stack)], $metadata: { requestId: "stack-2" } },
    resources: { StackResourceSummaries: [] }, originalTemplateAbsence: { name: "ValidationError", httpStatusCode: 400, message: `Stack with id ${stackId} does not exist` },
    changeSetBefore: { ...changeSet, $metadata: { requestId: "cs-1" } }, changeSetAfter: { ...structuredClone(changeSet), $metadata: { requestId: "cs-2" } },
    changeSetTemplate: { TemplateBody: value.request.TemplateBody }, observedAt: timestamp };
}
const approval = (sha: string): ArnProbeFixtureCreateApproval => ({ approvedReviewSha256: sha, acknowledgeAwsWrite: true, acknowledgeUnexecutedOnly: true,
  acknowledgeLowCostNotFree: true, executionPhrase: "I_CONFIRM_J5GJ9_CREATE_UNEXECUTED_ARN_PROBE_ONLY" });

test("fixture plan is deterministic, isolated, immutable and contains no paid resource or Execute authority", async () => {
  const value = await plan(); assert.deepEqual(value, await plan());
  assert.deepEqual(value.allowedWriteActions, ["cloudformation:CreateChangeSet"]);
  assert.notEqual(value.request.StackName, "techlong-sandbox-cell-sandbox-1");
  assert.deepEqual(JSON.parse(value.request.TemplateBody).Resources, { ProbeHandle: { Type: "AWS::CloudFormation::WaitConditionHandle" } });
  assert.equal(value.childExecutionAllowed, false); assert.equal(Object.isFrozen(value.request.Tags[0]), true);
  await assert.rejects(compileArnProbeFixturePlan({ nonce: "bad", reviewedAt: timestamp, expiresAt: timestamp }));
  await assert.rejects(compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: timestamp, expiresAt: "2026-10-03T18:00:00.000Z" }));
});
test("fresh create review requires exact Locked and fixture absence without touching mutations", async () => {
  const value = await plan(), port = reads(value), review = await reviewArnProbeFixtureCreate(value, port, signal(), now);
  assert.equal(review.mutationPerformed, false); assert.equal(review.providerContextCompatibilityVerified, false);
  await assert.rejects(reviewArnProbeFixtureCreate(value, { ...port, readLockedPreflight: async () => ({ ...locked(value), authorityState: "PRESENT" } as unknown as CollectedManagementObservation) }, signal(), now));
  await assert.rejects(reviewArnProbeFixtureCreate(value, port, signal(), () => time + 3_600_000));
});
test("create has one local intent and one exact SDK submission; second intent cannot submit", async () => {
  const value = await plan(), port = reads(value), review = await reviewArnProbeFixtureCreate(value, port, signal(), now);
  let reserved = false, submissions = 0;
  const journal = { reserve: async () => { if (reserved) throw new Error("intent exists"); reserved = true; } };
  const creates = { createChangeSet: async (request: ArnProbeFixturePlan["request"]) => {
    assert.equal(reserved, true); assert.deepEqual(request, value.request); submissions++;
    return { StackId: stackId, Id: arn(value), $metadata: { requestId: "create" } };
  } };
  const input = { review, approval: approval(review.reviewSha256), reads: port, creates, journal, signal: signal(), now };
  const result = await createReviewedArnProbeFixture(input);
  assert.equal(result.outcome, "CREATE_SUBMITTED"); assert.equal(result.childExecuted, false); assert.equal(result.grantInstalled, false);
  await assert.rejects(createReviewedArnProbeFixture(input), /intent exists/); assert.equal(submissions, 1);
});
test("bad approval, digest, cancelled preflight and stale review submit zero writes", async () => {
  const value = await plan(), port = reads(value), review = await reviewArnProbeFixtureCreate(value, port, signal(), now); let count = 0;
  const input = { review, approval: approval(review.reviewSha256), reads: port,
    creates: { createChangeSet: async () => { count++; return {}; } }, journal: { reserve: async () => { count++; } }, signal: signal(), now };
  for (const item of [{ ...input, approval: { ...input.approval, acknowledgeUnexecutedOnly: false } }, { ...input, approval: approval("0".repeat(64)) },
    { ...input, review: { ...review, reviewSha256: "0".repeat(64) } }, { ...input, now: () => time + 3_600_000 }]) await assert.rejects(createReviewedArnProbeFixture(item));
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(createReviewedArnProbeFixture({ ...input, signal: cancelled.signal })); assert.equal(count, 0);
});
test("lost create reply is uncertain; expired-plan Recover never authorizes replay", async () => {
  const value = await plan(), port = reads(value), review = await reviewArnProbeFixtureCreate(value, port, signal(), now); let calls = 0;
  const result = await createReviewedArnProbeFixture({ review, approval: approval(review.reviewSha256), reads: port,
    creates: { createChangeSet: async () => { calls++; throw new Error("lost reply https://secret.example"); } }, journal: { reserve: async () => {} }, signal: signal(), now });
  assert.equal(result.outcome, "CREATE_UNCERTAIN"); assert.equal(result.mutationPerformed, null); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), /secret.example/);
  const later = () => time + 7_200_000;
  const recovered = await recoverArnProbeFixture(value, { ...port, readLockedPreflight: async () => locked(value, new Date(later()).toISOString()),
    readFixture: async () => ({ state: "MISSING", proof: "EXACT_NAME_BOUND_STACK_MISSING", observedAt: new Date(later()).toISOString() }) }, signal(), later);
  assert.equal(recovered.retryAuthorized, false); assert.equal(recovered.mutationPerformed, false);
});
test("caller cancellation after intent reservation cannot suppress the one authorized delegate", async () => {
  const value = await plan(), port = reads(value), review = await reviewArnProbeFixtureCreate(value, port, signal(), now), caller = new AbortController(); let calls = 0;
  const result = await createReviewedArnProbeFixture({ review, approval: approval(review.reviewSha256), reads: port, journal: { reserve: async () => { caller.abort(); } },
    creates: { createChangeSet: async (_request, delegated) => { assert.notEqual(delegated, caller.signal); assert.equal(delegated.aborted, false); calls++; return { StackId: stackId, Id: arn(value), $metadata: { requestId: "one" } }; } }, signal: caller.signal, now });
  assert.equal(calls, 1); assert.equal(result.outcome, "CREATE_SUBMITTED");
});
test("fixture proof binds exact ARN/template/tags, zero resources, no nesting and stable unexecuted state", async () => {
  const value = await plan(), valid = evidence(value); assert.equal(validateArnProbeFixtureEvidence(value, valid).state, "READY_UNEXECUTED");
  const mutations: Array<(input: ReturnType<typeof evidence>) => void> = [
    (input) => { input.stackBefore.Stacks[0].RoleARN = "other"; }, (input) => { input.stackBefore.Stacks[0].StackStatus = "CREATE_COMPLETE"; },
    (input) => { input.changeSetBefore.IncludeNestedStacks = true; }, (input) => { input.changeSetBefore.ChangeSetId = "arn:foreign"; },
    (input) => { input.changeSetBefore.Changes[0].ResourceChange.ResourceType = "AWS::EC2::VPC"; }, (input) => { input.changeSetTemplate.TemplateBody = "{}"; },
    (input) => { input.originalTemplateAbsence.message = "Stack with id other does not exist"; },
  ];
  for (const mutate of mutations) { const input = structuredClone(valid); mutate(input); assert.throws(() => validateArnProbeFixtureEvidence(value, input)); }
  assert.throws(() => validateArnProbeFixtureEvidence(value, { ...valid, resources: { StackResourceSummaries: [{ ResourceType: "AWS::EC2::VPC" }] } }));
  assert.throws(() => validateArnProbeFixtureEvidence(value, { ...valid, resources: { StackResourceSummaries: [], NextToken: "truncated" } }));
});
test("SDK Recover discovers only the planned name, then binds exact ARN; foreign absence is rejected", async () => {
  const value = await plan(), valid = evidence(value), calls: Record<string, unknown>[] = [];
  class Describe { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class Resources { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class Template { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  class ChangeSet { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const client = { send: async (command: unknown): Promise<Record<string, unknown>> => {
    const item = command as Describe; calls.push(item.input);
    if (command instanceof Describe) return valid.stackBefore;
    if (command instanceof Resources) return valid.resources;
    if (command instanceof ChangeSet) return valid.changeSetBefore;
    if (item.input.ChangeSetName) return valid.changeSetTemplate;
    throw Object.assign(new Error(`Stack with id ${stackId} does not exist`), { name: "ValidationError", $metadata: { httpStatusCode: 400 } });
  } };
  const management = { readLockedPreflightObservation: async () => locked(value) };
  const adapter = new AwsSdkArnProbeFixtureReadAdapter({ client, management, commands: { describeStacks: Describe, listStackResources: Resources, getTemplate: Template, describeChangeSet: ChangeSet }, now });
  assert.equal((await adapter.readFixture(value, signal())).state, "READY_UNEXECUTED");
  assert.equal(calls.filter((request) => request.ChangeSetName === value.request.ChangeSetName).length, 1);
  assert.equal(calls.filter((request) => request.ChangeSetName === arn(value)).length, 2);
  client.send = async () => { throw Object.assign(new Error("Stack with id other does not exist"), { name: "ValidationError", $metadata: { httpStatusCode: 400 } }); };
  await assert.rejects(adapter.readFixture(value, signal()), /absence was not proved/);
});
test("SDK create capability is request-bound and single-submit even on response loss", async () => {
  const value = await plan(); let writes = 0;
  class Create { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const adapter = new AwsSdkArnProbeFixtureCreateAdapter(value, { client: { send: async () => { writes++; throw new Error("lost"); } }, createChangeSet: Create });
  await assert.rejects(adapter.createChangeSet({ ...value.request, StackName: "foreign" }, signal())); assert.equal(writes, 0);
  await assert.rejects(adapter.createChangeSet(value.request, signal()));
  await assert.rejects(adapter.createChangeSet(value.request, signal()), /single-submit/); assert.equal(writes, 1);
});
test("CLI has no Execute/Delete/IAM mutation, fixed create-only journal and no automatic cleanup", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-compatibility-fixture.ts", import.meta.url), "utf8");
  assert.match(cli, /create-intent.json/); assert.match(cli, /maxAttempts: 1/); assert.match(cli, /await handle.sync\(\)/);
  assert.match(cli, /open\(output, "wx"\)/); assert.match(cli, /--acknowledge-unexecuted-only/);
  assert.doesNotMatch(cli, /(?:Execute|Delete|Put|Attach|Detach|Update|AssumeRole)\w*Command/); assert.doesNotMatch(cli, /\b(?:unlink|rm|rmdir)\(/);
});
