import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compileArnProbeFixturePlan, ARN_PROBE_FIXTURE_STACK } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan, assertArnProbeGrantPlan, type ArnProbeGrantPlan } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { compileArnProbeReadComparisonPlan, assertArnProbeReadComparisonPlan, assertArnProbeReadComparisonPredecessor,
  assertArnProbeReadComparisonObservation, reviewArnProbeReadComparison, ARN_PROBE_READ_COMPARISON_ANCHORS, ARN_PROBE_CONSUMED_SLOT_FILES,
  type ArnProbeReadComparisonPredecessor, type ArnProbeReadComparisonObservation } from "../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { readArnProbeReadComparisonJson, loadArnProbeReadComparisonEvidence, type ArnProbeReadComparisonEvidenceFiles } from "../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";

const reviewedAt = "2026-10-03T22:00:00.000Z", expiresAt = "2026-10-03T22:30:00.000Z";
async function prior() {
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: "2026-10-03T15:00:00.000Z", expiresAt: "2026-10-03T16:00:00.000Z" });
  return compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: `arn:aws:cloudformation:ca-central-1:402010193138:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`,
    fixtureChangeSetArn: `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${fixturePlan.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
    nonce: "b".repeat(32), reviewedAt: "2026-10-03T17:00:00.000Z", expiresAt: "2026-10-03T18:00:00.000Z" });
}
const compile = async () => compileArnProbeReadComparisonPlan({ priorPlan: await prior(), reviewedAt, expiresAt });
function predecessor(): ArnProbeReadComparisonPredecessor {
  return { anchors: ARN_PROBE_READ_COMPARISON_ANCHORS, consumedGeneration: 1,
    consumedSlotRelativePath: `.aws-sandbox/j5gj13-arn-probe/${ARN_PROBE_READ_COMPARISON_ANCHORS.targetFenceKey}/slot-000001`,
    slotFiles: ARN_PROBE_CONSUMED_SLOT_FILES, consumed: true, probeDeleteIntentPresent: false, replayAllowed: false };
}
function observation(plan: ArnProbeGrantPlan): ArnProbeReadComparisonObservation {
  const management: ArnProbeReadComparisonObservation["managementBefore"] = { schemaVersion: 1, accountId: "402010193138", region: "ca-central-1",
    callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", rendererShape: "Locked", cellStackState: "MISSING", authorityState: "ABSENT",
    policies: [], roles: [], observedAt: reviewedAt,
    stack: { id: plan.managementStackId, name: "techlong-s3-b5-cell-lifecycle-management", status: "UPDATE_COMPLETE", roleArn: null, parentId: null,
      rootId: null, terminationProtection: false, templateRawSha256: plan.revokeTarget.templateRawSha256,
      templateCanonicalSha256: plan.revokeTarget.templateCanonicalSha256, safetyState: "LOCKED", resources: [] } };
  const inventory = { stackId: plan.managementStackId, state: "EMPTY" as const, changeSetCount: 0 as const, providerEvidenceSha256: "f".repeat(64), observedAt: reviewedAt };
  const fixture = { state: "READY_UNEXECUTED" as const, stackId: plan.input.fixtureStackId, changeSetArn: plan.input.fixtureChangeSetArn,
    templateCanonicalSha256: plan.input.fixturePlan.templateCanonicalSha256, resourceCount: 0 as const, observedAt: reviewedAt };
  return { managementBefore: management, managementAfter: structuredClone(management), inventoryBefore: inventory, inventoryAfter: structuredClone(inventory),
    fixtureBefore: fixture, fixtureAfter: structuredClone(fixture) };
}

test("read comparison deterministically starts from Locked and introduces no probe write Allow", async () => {
  const plan = await compile(); await assertArnProbeReadComparisonPlan(plan); assert.deepEqual(plan, await compile());
  const base = JSON.parse(plan.revokeTarget.templateBody), original = JSON.parse(plan.input.priorPlan.request.TemplateBody);
  assert.equal(original.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement.at(-1).Action, "cloudformation:DeleteChangeSet");
  for (const candidate of plan.candidates) {
    const proposed = JSON.parse(candidate.proposedTemplateBody);
    for (const key of ["CellOperatorRole", "CellCloudFormationExecutionRole", "CellCloudFormationExecutionBoundary"]) assert.deepEqual(proposed.Resources[key], base.Resources[key]);
    assert.deepEqual(proposed.Parameters, base.Parameters); assert.deepEqual(proposed.Conditions, base.Conditions);
    const statements = proposed.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
    const baseline = base.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement;
    assert.deepEqual(statements.slice(0, baseline.length), baseline); assert.equal(statements.length, baseline.length + 2);
    assert.deepEqual(statements.at(-2).Action, ["cloudformation:DescribeStacks", "cloudformation:ListStackResources", "cloudformation:GetTemplate"]);
    assert.equal(statements.at(-1).Action, "cloudformation:DescribeChangeSet"); assert.equal(statements.at(-1).Resource, plan.input.priorPlan.input.fixtureStackId);
    assert.doesNotMatch(JSON.stringify(statements.filter((item: { Effect: string }) => item.Effect === "Allow")), /cloudformation:(?:Delete|Execute|Create|Update)|iam:(?:Put|Attach|Create|Delete)/);
    assert.equal(proposed.Metadata.SafetyBoundary.ArnProbeDeleteChangeSetAllowed, false);
  }
  await assertArnProbeGrantPlan(plan.input.priorPlan); // existing Delete compiler remains unchanged
});
test("two candidate IAM documents differ only in the single exact ChangeSetName condition value", async () => {
  const plan = await compile(), [full, name] = plan.candidates;
  const policies = plan.candidates.map((candidate) => JSON.parse(candidate.proposedTemplateBody).Resources.CellOperatorBoundary.Properties.PolicyDocument);
  assert.equal(policies[0].Statement.at(-1).Condition.StringEquals["cloudformation:ChangeSetName"], plan.input.priorPlan.input.fixtureChangeSetArn);
  assert.equal(policies[1].Statement.at(-1).Condition.StringEquals["cloudformation:ChangeSetName"], plan.input.priorPlan.input.fixturePlan.request.ChangeSetName);
  policies[0].Statement.at(-1).Condition.StringEquals["cloudformation:ChangeSetName"] = name.conditionValue;
  assert.deepEqual(policies[0], policies[1]); assert.notEqual(full.operatorPolicySha256, name.operatorPolicySha256);
  assert.deepEqual(Object.keys(policies[1].Statement.at(-1).Condition).sort(), ["DateGreaterThanEquals", "DateLessThan", "StringEquals"]);
});
test("four proposed read cases all retain exact Stack and full returned ChangeSet identity; none are executable", async () => {
  const plan = await compile(); assert.equal(plan.proposedReadMatrix.length, 4);
  for (const value of plan.proposedReadMatrix) {
    assert.equal(value.action, "cloudformation:DescribeChangeSet"); assert.equal(value.maxSubmissions, 1);
    assert.equal(value.request.StackName, plan.input.priorPlan.input.fixtureStackId);
    assert.equal(value.requiredResponseIdentity.ChangeSetId, plan.input.priorPlan.input.fixtureChangeSetArn);
    assert.equal(value.request.ChangeSetName, value.requestStyle === "FULL_ARN_REQUEST" ? value.requiredResponseIdentity.ChangeSetId : value.requiredResponseIdentity.ChangeSetName);
  }
  assert.equal(plan.generationProposal, null); assert.equal(plan.fenceImplementationAvailable, false);
  assert.equal(plan.operatorReadExecutionImplemented, false); assert.deepEqual(plan.allowedWriteActions, []);
  assert.equal(plan.mutuallyExclusiveCandidates, true); assert.equal(plan.requiredFutureControls.onlyOneCandidateInstalledAtATime, true);
  await assert.rejects(assertArnProbeGrantPlan(plan as unknown as ArnProbeGrantPlan));
});
test("candidate compile rejects live predecessor, wrong window, invalid target and hidden input fields", async () => {
  const p = await prior();
  for (const input of [
    { priorPlan: p, reviewedAt: "2026-10-03T17:30:00.000Z", expiresAt: "2026-10-03T18:00:00.000Z" },
    { priorPlan: p, reviewedAt, expiresAt: "2026-10-03T22:31:00.000Z" },
    { priorPlan: { ...p, input: { ...p.input, fixtureStackId: p.managementStackId } }, reviewedAt, expiresAt },
    { priorPlan: p, reviewedAt, expiresAt, grantExecutionAuthorized: true },
  ]) await assert.rejects(compileArnProbeReadComparisonPlan(input));
});
test("rehashed candidate tampering still fails strict recompilation", async () => {
  for (const change of ["write", "condition", "matrix", "authority"]) {
    const plan = JSON.parse(canonicalJson(await compile()));
    if (change === "write") { const body = JSON.parse(plan.candidates[0].proposedTemplateBody); body.Resources.CellOperatorBoundary.Properties.PolicyDocument.Statement.at(-1).Action = "cloudformation:DeleteChangeSet"; plan.candidates[0].proposedTemplateBody = JSON.stringify(body); }
    if (change === "condition") plan.candidates[1].conditionValue = "*";
    if (change === "matrix") plan.proposedReadMatrix[0].request.StackName = "other-stack";
    if (change === "authority") plan.operatorReadAuthorized = true;
    delete plan.planSha256; plan.planSha256 = await sha256Hex(canonicalJson(plan));
    await assert.rejects(assertArnProbeReadComparisonPlan(plan));
  }
});
test("candidate inputs are preserved and output recursively frozen", async () => {
  const p = await prior(), snapshot = canonicalJson(p), plan = await compileArnProbeReadComparisonPlan({ priorPlan: p, reviewedAt, expiresAt });
  assert.equal(canonicalJson(p), snapshot); assert.equal(Object.isFrozen(plan.candidates[0]), true); assert.equal(Object.isFrozen(plan.proposedReadMatrix[0].request), true);
  assert.equal(Reflect.set(plan, "operatorReadAuthorized", true), false);
});
test("consumed predecessor cannot be relabeled, missing-delete treated as free, or replaced by generation2", () => {
  assertArnProbeReadComparisonPredecessor(predecessor());
  for (const changes of [{ consumedGeneration: 2 }, { consumed: false }, { replayAllowed: true }, { probeDeleteIntentPresent: true },
    { slotFiles: ["claim.json"] }, { anchors: { ...ARN_PROBE_READ_COMPARISON_ANCHORS, journalSha256: "0".repeat(64) } }, { generationProposal: 2 }]) {
    assert.throws(() => assertArnProbeReadComparisonPredecessor({ ...predecessor(), ...changes } as unknown as ArnProbeReadComparisonPredecessor));
  }
});
test("Source observation validation rejects stale/future/foreign/non-Locked/pending/drift/partial fixture evidence", async () => {
  const p = await prior(), current = observation(p), at = Date.parse(reviewedAt);
  assertArnProbeReadComparisonObservation(p, current, at);
  const cases = [
    { ...current, managementAfter: { ...current.managementAfter, rendererShape: "ArnProbeDeleteChangeSetGrant" } },
    { ...current, managementAfter: { ...current.managementAfter, authorityState: "PRESENT" } },
    { ...current, managementAfter: { ...current.managementAfter, accountId: "123456789012" } },
    { ...current, managementAfter: { ...current.managementAfter, region: "us-east-1" } },
    { ...current, managementAfter: { ...current.managementAfter, observedAt: "2026-10-03T21:58:59.000Z" } },
    { ...current, managementAfter: { ...current.managementAfter, observedAt: "2026-10-03T22:00:01.000Z" } },
    { ...current, inventoryAfter: { ...current.inventoryAfter, changeSetCount: 1 } },
    { ...current, inventoryAfter: { ...current.inventoryAfter, providerEvidenceSha256: "partial" } },
    { ...current, fixtureAfter: { ...current.fixtureAfter, resourceCount: 1 } },
    { ...current, fixtureAfter: { ...current.fixtureAfter, changeSetArn: "arn:foreign" } },
    { ...current, fixtureAfter: { state: "MISSING", observedAt: reviewedAt } },
    { ...current, managementAfter: { ...current.managementAfter, stack: { ...current.managementAfter.stack, templateRawSha256: "0".repeat(64) } } },
    { ...current, managementAfter: { ...current.managementAfter, roles: [{}] } },
  ];
  for (const value of cases) assert.throws(() => assertArnProbeReadComparisonObservation(p, value as unknown as ArnProbeReadComparisonObservation, at));
});
test("non-anchored plan and cancellation fail before Source calls or slot read", async () => {
  let calls = 0;
  const input = { priorPlan: await prior(), readPredecessor: async () => { calls++; return predecessor(); },
    reads: { readManagement: async () => { calls++; throw new Error("unexpected read"); }, readFixture: async () => { calls++; throw new Error("unexpected read"); },
      readEmptyManagementInventory: async () => { calls++; throw new Error("unexpected read"); } }, signal: new AbortController().signal, now: () => Date.parse(reviewedAt) };
  await assert.rejects(reviewArnProbeReadComparison(input), /anchored/); assert.equal(calls, 0);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(reviewArnProbeReadComparison({ ...input, signal: cancelled.signal })); assert.equal(calls, 0);
});
test("evidence reader rejects relative paths, loader rejects unknown path inventory before reading", async () => {
  await assert.rejects(readArnProbeReadComparisonJson("relative.json"));
  await assert.rejects(loadArnProbeReadComparisonEvidence(process.cwd(), {} as ArnProbeReadComparisonEvidenceFiles));
  const pkg = await readArnProbeReadComparisonJson(fileURLToPath(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.name, "restaurant-saas-platform");
});
test("entry exposes Prepare/Review only and filesystem loader has no ledger writes or mutating SDK imports", async () => {
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison.ts", import.meta.url), "utf8");
  const evidence = await readFile(new URL("../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts", import.meta.url), "utf8");
  assert.match(cli, /open\(output, "wx"\)/); assert.match(cli, /maxAttempts: 1/); assert.match(cli, /destination.sync\(\)/);
  assert.doesNotMatch(cli, /\b(?:Create|Execute|Delete|Put|Update|Attach|Detach|AssumeRole)\w*Command|createMutation|createOperator/);
  assert.doesNotMatch(evidence, /\b(?:mkdir|open|writeFile|unlink|rm|rmdir|reserve)\(/);
  for (const args of [["--mode", "RunReviewed"], ["--mode", "Review", "--acknowledge-aws-write"], ["--acknowledge-read-only", "--acknowledge-read-only"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison.ts", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /reviewSha256|receiptSha256/);
  }
});
