import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { closeGeneration4ForStackScopedReadControl, compileStackScopedReadControl, assertStackScopedReadControlPlan,
  stackScopedReadControlFence, checkStackScopedReadControlPreparation, type StackScopedReadControlEvidence } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control.ts";
import { assertArnProbeComparisonCreatePlan } from "../lib/deployments/execution/arn-probe-read-comparison-generation4-create.ts";
import { loadStackScopedReadControlEvidence, STACK_SCOPED_READ_CONTROL_ANCHORS } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-evidence.ts";
import { stackScopedReadControlFixture, signed } from "./fixtures/arn-probe-stack-scoped-read-control.ts";
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
let cached: ReturnType<typeof stackScopedReadControlFixture> | undefined;
const fixture = () => cached ??= stackScopedReadControlFixture();
const candidateInput = (f: Awaited<ReturnType<typeof fixture>>) => ({ predecessor: f.predecessor, reviewedAt: f.reviewedAt, expiresAt: f.expiresAt });
const clone = (value: StackScopedReadControlEvidence) => structuredClone(value) as Mutable<StackScopedReadControlEvidence>;
const json = async (file: string) => readFile(new URL(file, import.meta.url), "utf8");

test("Stack-scoped control requires a complete denied/revoked generation4 and distinct consumed fence", async () => {
  const f = await fixture(), fence = await stackScopedReadControlFence(f.predecessor);
  assert.equal(fence.generation, 5); assert.equal(fence.priorGeneration, 4); assert.match(fence.slotRelativePath, /j5gj22-stack-scoped-read-control\/.*\/slot-000005$/);
  assert.notEqual(fence.slotRelativePath, fence.priorSlotRelativePath); assert.equal(fence.persistenceImplemented, false); assert.equal(fence.reservationAuthorized, false);
  assert.equal(f.predecessor.oldSlotConsumed, true); assert.equal(f.predecessor.successorReservationAllowed, false);
});
test("candidate adds exactly one Stack-only Describe Allow, preserves all old resources/policies and write restrictions", async () => {
  const f = await fixture(), plan = await compileStackScopedReadControl(candidateInput(f)); await assertStackScopedReadControlPlan(plan);
  const old = JSON.parse(f.evidence.creationReview.plan.revokeTarget.templateBody), next = JSON.parse(plan.proposedTemplateBody);
  const oldPolicy = old.Resources.CellOperatorBoundary.Properties.PolicyDocument, newPolicy = next.Resources.CellOperatorBoundary.Properties.PolicyDocument;
  assert.deepEqual(newPolicy.Statement.slice(0, -1), oldPolicy.Statement); assert.equal(newPolicy.Statement.length, oldPolicy.Statement.length + 1);
  const added = newPolicy.Statement.at(-1); assert.deepEqual(added, plan.proposedStatement); assert.equal(added.Action, "cloudformation:DescribeChangeSet");
  assert.equal(added.Resource, f.evidence.creationReview.plan.input.comparisonPlan.input.priorPlan.input.fixtureStackId); assert.notEqual(added.Resource, "*");
  assert.deepEqual(added.Condition.StringEquals, { "aws:RequestedRegion": "ca-central-1" }); assert.doesNotMatch(JSON.stringify(added), /ChangeSetName|IfExists|Delete|Execute/);
  old.Resources.CellOperatorBoundary.Properties.PolicyDocument = newPolicy; assert.deepEqual(next.Resources, old.Resources);
  assert.deepEqual(plan.revokeTarget, f.evidence.creationReview.plan.revokeTarget); assert.deepEqual(plan.allowedWriteActions, []);
  for (const key of ["deletionAuthorized", "creationAuthorized", "installationAuthorized", "operatorReadAuthorized", "runtimeEnabled", "executionImplemented", "persistenceImplemented"]) assert.equal(plan[key as keyof typeof plan], false);
  assert.equal(plan.proposedReadMatrix.length, 2); assert(plan.proposedReadMatrix.every(c => c.maxSubmissions === 1 && c.request.StackName === added.Resource));
});
test("new plan cannot enter generation4 creation or consume an old approval", async () => {
  const plan = await compileStackScopedReadControl(candidateInput(await fixture()));
  await assert.rejects(assertArnProbeComparisonCreatePlan(plan as unknown as Parameters<typeof assertArnProbeComparisonCreatePlan>[0]));
  await assert.rejects(compileStackScopedReadControl({ ...candidateInput(await fixture()), predecessor: (await fixture()).evidence.creationReview } as unknown as Parameters<typeof compileStackScopedReadControl>[0]));
});
test("candidate needs explicit canonical times, exact 30 minutes and an expired predecessor", async () => {
  const f = await fixture();
  for (const change of [{ reviewedAt: undefined }, { reviewedAt: "2026-10-04T16:30:03Z" }, { reviewedAt: f.evidence.manifest.input.reviewedAt },
    { expiresAt: new Date(Date.parse(f.expiresAt) + 1).toISOString() }, { expiresAt: f.reviewedAt }]) {
    await assert.rejects(compileStackScopedReadControl({ predecessor: f.predecessor, reviewedAt: f.reviewedAt, expiresAt: f.expiresAt, ...change } as Parameters<typeof compileStackScopedReadControl>[0]));
  }
});
test("rehashing a widened action/resource/condition or changed role never makes a candidate valid", async () => {
  const plan = await compileStackScopedReadControl(candidateInput(await fixture()));
  for (const change of [{ proposedStatement: { ...plan.proposedStatement, Resource: "*" } }, { proposedStatement: { ...plan.proposedStatement, Action: "cloudformation:ExecuteChangeSet" } },
    { proposedStatement: { ...plan.proposedStatement, Condition: {} } }, { executionImplemented: true }, { allowedWriteActions: ["cloudformation:CreateChangeSet"] }]) {
    await assert.rejects(assertStackScopedReadControlPlan(await signed({ ...plan, ...change }, "planSha256") as typeof plan));
  }
});
test("missing, duplicate, foreign or retimed consumed intents block closed predecessor", async () => {
  const f = await fixture();
  for (const change of ["missing", "foreign", "retimed", "extra"]) {
    const e = clone(f.evidence);
    if (change === "missing") delete (e.intents as Partial<typeof e.intents>)["read-full-arn"];
    if (change === "foreign") e.intents["grant-execute"].manifestSha256 = "0".repeat(64);
    if (change === "retimed") e.intents["read-exact-name"].reservedAt = e.manifest.input.expiresAt;
    if (change === "extra") (e.intents as Record<string, unknown>).unexpected = {};
    await assert.rejects(closeGeneration4ForStackScopedReadControl(e));
  }
});
test("unsafe execution flags or incomplete cleanup cannot be hidden by rehashing", async () => {
  const f = await fixture();
  for (const change of [{ childExecuted: true }, { probeDeleted: true }, { deleteStackPerformed: true }, { cleanup: null }, { outcome: "REVOKE_REQUIRED" }, { failures: [{}] }]) {
    const e = clone(f.evidence); e.run = await signed({ ...e.run, ...change }, "receiptSha256") as typeof e.run;
    await assert.rejects(closeGeneration4ForStackScopedReadControl(e));
  }
});
test("successful/uncertain/duplicate request outcomes do not substitute for the two actual denials", async () => {
  const f = await fixture();
  for (const change of ["success", "uncertain", "duplicate", "expiry"]) {
    const e = clone(f.evidence);
    if (change === "success") e.run.results[0].outcome = "READ_SUCCEEDED";
    if (change === "uncertain") e.run.results[0].outcome = "READ_UNCERTAIN";
    if (change === "duplicate") e.run.results[1].requestId = e.run.results[0].requestId;
    if (change === "expiry") e.run.results[0].observedAt = e.manifest.input.expiresAt;
    e.run = await signed(e.run, "receiptSha256"); await assert.rejects(closeGeneration4ForStackScopedReadControl(e));
  }
});
test("Locked closure role/default policy/fixture drift is rejected independently of receipt digest", async () => {
  const f = await fixture();
  for (const change of ["role", "policy", "fixture", "early"]) {
    const e = clone(f.evidence);
    if (change === "role") e.inspect.management.roles[0].trustPolicySha256 = "0".repeat(64);
    if (change === "policy") e.inspect.management.policies[0].defaultDocumentSha256 = "0".repeat(64);
    if (change === "fixture") Reflect.set(e.inspect.fixture, "resourceCount", 1);
    if (change === "early") e.inspect.observedAt = new Date(Date.parse(e.run.observedAt) - 1).toISOString();
    e.inspect = await signed(e.inspect, "receiptSha256"); await assert.rejects(closeGeneration4ForStackScopedReadControl(e));
  }
});
test("audit incomplete/missing MFA/foreign context and forged diagnostic flags fail closed", async () => {
  const f = await fixture();
  for (const change of ["incomplete", "mfa", "raw", "root", "journal", "receipt"]) {
    const e = clone(f.evidence), trail = e.diagnostic.cloudTrail as Record<string, unknown>;
    if (change === "incomplete") trail.completeWindowInventory = false;
    if (change === "mfa") (trail.matchedRecords as Record<string, unknown>[])[0].mfaAuthenticated = false;
    if (change === "raw") e.diagnostic.rawCredentials = "never allowed";
    if (change === "root") e.diagnostic.rootCauseProven = true;
    if (change === "journal") (e.diagnostic.journal as Record<string, unknown>).afterSha256 = "0".repeat(64);
    if (change !== "receipt") e.diagnostic = await signed(e.diagnostic, "receiptSha256"); else e.diagnostic.receiptSha256 = "0".repeat(64);
    await assert.rejects(closeGeneration4ForStackScopedReadControl(e));
  }
});
test("timeless preparation compiles no candidate, opens no window and creates no registry", async () => {
  const f = await fixture(), report = await checkStackScopedReadControlPreparation(f.predecessor);
  for (const key of ["candidateCompiled", "approvalWindowOpened", "manifestCreated", "registryCreated", "mutationPerformed", "reservationAuthorized", "executionImplemented", "operatorSessionCreated", "runtimeEnabled"]) assert.equal(report[key as keyof typeof report], false);
  assert.deepEqual(report.allowedWriteActions, []); assert.equal(Object.hasOwn(report, "expiresAt"), false); assert.equal(Object.hasOwn(report, "manifest"), false);
});
test("local entry has no AWS/session/write capabilities and rejects unsafe modes/options before output", async () => {
  const cli = await json("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control.ts"), loader = await json("../lib/deployments/execution/arn-probe-stack-scoped-read-control-evidence.ts");
  assert.doesNotMatch(cli + loader, /@aws-sdk|createArnProbeSourceReadRuntime|\.reserve\(|mkdir\(|AssumeRoleCommand|(?:Create|Execute|Delete)ChangeSetCommand/);
  assert.doesNotMatch(cli, /compileStackScopedReadControl\(|Date\.now\(|--approved|--reviewed-at|--expires-at/);
  for (const args of [[], ["--mode", "CreateReviewed"], ["--mode", "RunReviewed"], ["--mode", "CheckPreparation", "--acknowledge-aws-write"], ["--mode", "CheckPreparation", "--approved-manifest-sha", "0".repeat(64)], ["--acknowledge-local-read-only", "--acknowledge-local-read-only"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control.ts", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /receiptSha256|outcome/);
  }
});
test("real evidence loader rejects unbounded paths and records are pinned to completed immutable hashes", async () => {
  assert.equal(STACK_SCOPED_READ_CONTROL_ANCHORS.diagnosticReceipt, "74e70dd6e0ec0e45ddec6fbfe9df813d763f87d3ba7a44e7e1f7b367397968a1");
  await assert.rejects(loadStackScopedReadControlEvidence(fileURLToPath(new URL("../", import.meta.url)), { creationReview: "relative.json" } as Parameters<typeof loadStackScopedReadControlEvidence>[1]));
  const model = await json("../lib/deployments/execution/arn-probe-stack-scoped-read-control.ts");
  assert.doesNotMatch(model, /Date\.now\(|@aws-sdk|fs\/promises|CreateChangeSetCommand|AssumeRoleCommand/);
  assert.equal(await sha256Hex(canonicalJson((await fixture()).predecessor.input.manifest)), await sha256Hex(canonicalJson((await fixture()).evidence.manifest)));
});
