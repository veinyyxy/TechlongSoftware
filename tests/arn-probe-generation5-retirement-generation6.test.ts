import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, mkdir, readdir, readFile, writeFile, link, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { STACK_CONTROL_RETIREMENT as r, STACK_CONTROL_RETIREMENT_PATHS as paths, assertClosedGeneration5, compileStackControlRetirement,
  assertStackControlRetirement, assertStackControlRetirementObservation, makeStackControlRetirementIntent, retireReviewedStackControl,
  inspectStackControlRetirement, stackControlGeneration6Fence, assertStackControlRetirementProof } from "../lib/deployments/execution/arn-probe-stack-control-generation5-retirement.ts";
import { createStackControlRetirementLedger, readStackControlRetirementJson, assertGeneration6RegistryAbsent } from "../lib/deployments/execution/arn-probe-stack-control-generation5-retirement-evidence.ts";
import { AwsSdkGeneration5RetirementDelete } from "../lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation5-retirement.ts";
import { generation5Observation, generation5RetirementFixture } from "./fixtures/arn-probe-generation5-retirement.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
const clone = <T>(v: T) => structuredClone(v) as Mutable<T>;
async function sign<T extends object>(v: T, key: string) { const value = { ...v } as Record<string, unknown>; delete value[key]; return { ...value, [key]: await sha256Hex(canonicalJson(value)) } as T; }
async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j23-test-")));
  try { await run(root); } finally {
    const resolved = await realpath(root), parent = await realpath(os.tmpdir()); assert.equal(path.dirname(resolved), parent); assert.match(path.basename(resolved), /^techlong-j23-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
}

test("J23 compact fixed predecessor and manifest cannot be rehashed into another generation/ARN/scope", async () => {
  const f = await generation5RetirementFixture(); await assertClosedGeneration5(f.predecessor); await assertStackControlRetirement(f.manifest);
  assert.ok(Buffer.byteLength(JSON.stringify(f.manifest, null, 2)) < 40_000); assert.equal(f.manifest.deletionApproved, false);
  assert.deepEqual(f.manifest.allowedWriteActions, ["cloudformation:DeleteChangeSet"]);
  for (const kind of ["anchor", "slot", "arn", "scope", "window"] as const) {
    const bad = clone(f.manifest);
    if (kind === "anchor") Object.assign(bad.input.predecessor.anchors, { claimSha256: "a".repeat(64) });
    if (kind === "slot") Object.assign(bad.input.predecessor, { oldSlot: "slot-000006" });
    if (kind === "arn") Object.assign(bad.request, { ChangeSetName: r.grantArn.replace("efbf0abc", "ffffffff") });
    if (kind === "scope") bad.allowedWriteActions.push("cloudformation:DeleteStack");
    if (kind === "window") bad.input.expiresAt = new Date(f.now() + 300_001).toISOString();
    await assert.rejects(assertStackControlRetirement(await sign(bad, "manifestSha256")));
  }
  await assert.rejects(compileStackControlRetirement({ ...f.manifest.input, reviewedAt: "2026-10-05T04:32:45.000Z" }));
  assert.deepEqual(f.events, []);
});

test("J23 complete Locked/IAM, fixture, singleton/empty inventory and source chronology fail closed", async () => {
  const f = await generation5RetirementFixture(), baseline = generation5Observation(f.now());
  await assertStackControlRetirementObservation(baseline, "PRESENT", f.now());
  for (const kind of ["policy", "trust", "resources", "caller", "fixture", "singleton", "foreign", "executed", "old-terminal", "partial", "stale", "order", "extra"] as const) {
    const o = clone(baseline);
    if (kind === "policy") o.managementAfter.policies[0].defaultVersionId = "v8";
    if (kind === "trust") o.managementBefore.roles[0].trustPolicySha256 = "a".repeat(64);
    if (kind === "resources") o.managementAfter.stack.resources = [];
    if (kind === "caller") Object.assign(o.managementBefore, { callerArn: "arn:aws:iam::402010193138:root" });
    if (kind === "fixture") Object.assign(o.fixture, { resourceCount: 1 });
    if (kind === "singleton") o.fixtureInventory.count = 2 as 1;
    if (kind === "foreign") o.inventory.objects[0].arn = "foreign";
    if (kind === "executed") o.inventory.objects[0].executionStatus = "EXECUTE_COMPLETE";
    if (kind === "old-terminal") o.inventory.objects.push({ ...o.inventory.objects[0], kind: "PRIOR_GRANT" });
    if (kind === "partial") o.inventory.complete = false as true;
    if (kind === "stale") o.managementBefore.observedAt = new Date(f.now() - 60_001).toISOString();
    if (kind === "order") o.fixtureInventory.observedAt = o.managementBefore.observedAt;
    if (kind === "extra") Object.assign(o, { ignored: true });
    await assert.rejects(assertStackControlRetirementObservation(o, "PRESENT", f.now()), kind);
  }
  await assert.rejects(assertStackControlRetirementObservation(baseline, "MISSING", f.now()));
  await assertStackControlRetirementObservation(generation5Observation(f.now(), true), "MISSING", f.now());
});

test("J23 exact separate fresh approval required before observe/intent/Delete", async () => {
  const f = await generation5RetirementFixture();
  for (const approval of [{ ...f.approval, approvedManifestSha256: "a".repeat(64) }, { ...f.approval, executionPhrase: "I_CONFIRM_J5GJ20_RETIRE_EXACT_UNEXECUTED_GENERATION3_GRANT_ONLY" },
    { ...f.approval, acknowledgeDeletionIrreversible: false }, { ...f.approval, acknowledgeLowCostNotZero: false }]) await assert.rejects(retireReviewedStackControl({ ...f, approval }));
  f.setTime(Date.parse(f.manifest.input.expiresAt)); await assert.rejects(retireReviewedStackControl(f)); assert.deepEqual(f.events, []); assert.equal(await f.ledger.read(), null);
});

test("J23 one Delete follows durable intent, and only independent missing/Locked proof admits generation6", async () => {
  const f = await generation5RetirementFixture(), run = await retireReviewedStackControl(f);
  assert.equal(run.outcome, "DELETE_SUBMISSION_REQUIRES_INSPECT"); assert.equal(run.successorReservationAllowed, false);
  assert.equal(run.deleteRequestId, "fa31aa1d-7347-4267-a0d3-cc6089773c58");
  assert.deepEqual(f.events, ["observe", "reserve", "delete"]); assert.equal(run.independentInspectionRequired, true);
  f.setTime(f.now() + 10_000); const proof = await inspectStackControlRetirement(f); await assertStackControlRetirementProof(proof);
  const fence = await stackControlGeneration6Fence(proof);
  assert.equal(fence.generation, 6); assert.equal(fence.priorGeneration, 5); assert.equal(fence.retirementIntentSha256, (await f.ledger.read())?.intentSha256);
  assert.equal(fence.slotRelativePath, paths.successorSlot); assert.equal(fence.physicalSlotCreated, false); assert.equal(fence.reservationAuthorized, false);
  assert.notEqual(fence.slotRelativePath, paths.oldSlot); assert.notEqual(fence.slotRelativePath, paths.retirementSlot);
  const before = [...f.events]; await assert.rejects(retireReviewedStackControl(f)); assert.deepEqual(f.events, before);
  const bad = clone(proof); Object.assign(bad.intent.manifest.request, { ChangeSetName: "short-name" });
  await assert.rejects(stackControlGeneration6Fence(await sign(bad, "receiptSha256")));
  const staleProof = clone(proof); staleProof.observation.managementBefore.observedAt = new Date(Date.parse(proof.intent.reservedAt) - 1).toISOString();
  await assert.rejects(stackControlGeneration6Fence(await sign(staleProof, "receiptSha256")));
});

test("J23 lost Delete response never retries; still-present object is not retirement proof", async () => {
  const f = await generation5RetirementFixture(); f.deleteChangeSet = async () => { f.events.push("delete"); throw new Error("RAW_CREDENTIAL_AND_MFA_MUST_NOT_SERIALIZE"); };
  const run = await retireReviewedStackControl(f); assert.equal(run.deletionAttempted, true); assert.equal(run.failures.length, 1);
  assert.doesNotMatch(JSON.stringify(run), /RAW_CREDENTIAL_AND_MFA/);
  f.setTime(f.now() + 10_000); const proof = await inspectStackControlRetirement(f); assert.equal(proof.outcome, "RETIREMENT_UNPROVED"); await assert.rejects(stackControlGeneration6Fence(proof));
  await assert.rejects(retireReviewedStackControl(f)); assert.equal(f.events.filter(v => v === "delete").length, 1);
  f.setMissing(); assert.equal((await inspectStackControlRetirement(f)).outcome, "RETIRED_LOCKED_VERIFIED");
});

test("J23 readback failure, cancellation or expiry after reservation consumes intent without Delete", async () => {
  for (const kind of ["expiry", "cancel", "readback"] as const) {
    const f = await generation5RetirementFixture(), reserve = f.ledger.reserve;
    f.ledger.reserve = async i => { await reserve(i); if (kind === "expiry") f.setTime(Date.parse(f.manifest.input.expiresAt)); if (kind === "cancel") f.abort.abort();
      if (kind === "readback") f.ledger.read = async () => null; };
    if (kind === "readback") await assert.rejects(retireReviewedStackControl(f));
    else { const run = await retireReviewedStackControl(f); assert.equal(run.outcome, "NO_DELETE_SUBMITTED_SLOT_CONSUMED"); }
    assert.equal(f.events.includes("delete"), false); assert.equal(f.events.includes("reserve"), true);
  }
});

test("J23 external absence without permanent intent is never adopted", async () => {
  const f = await generation5RetirementFixture(); f.setMissing(); await assert.rejects(inspectStackControlRetirement(f));
  assert.deepEqual(f.events, []); await assert.rejects(retireReviewedStackControl(f)); assert.equal(await f.ledger.read(), null);
});

test("J23 one-shot SDK adapter rejects expired/short/extra requests and cannot submit a second Delete", async () => {
  const f = await generation5RetirementFixture(); class Delete { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const calls: unknown[] = [], adapter = new AwsSdkGeneration5RetirementDelete(f.manifest, { send: async c => { calls.push(c); return {}; } }, Delete, f.now);
  await assert.rejects(adapter.submit(Object.assign(clone(f.manifest.request), { ChangeSetName: "short" }), f.signal));
  await assert.rejects(adapter.submit({ ...f.manifest.request, IncludeNestedStacks: true } as typeof f.manifest.request, f.signal));
  assert.equal(calls.length, 0); await adapter.submit(f.manifest.request, f.signal); await assert.rejects(adapter.submit(f.manifest.request, f.signal));
  assert.equal(calls.length, 1); assert.deepEqual((calls[0] as Delete).input, f.manifest.request);
  f.setTime(Date.parse(f.manifest.input.expiresAt)); await assert.rejects(new AwsSdkGeneration5RetirementDelete(f.manifest, { send: async () => { throw new Error("Must not send"); } }, Delete, f.now).submit(f.manifest.request, f.signal));
});

test("J23 FS reads never create state; concurrent reservation has only one permanent winner", async () => {
  const f = await generation5RetirementFixture(), intent = await makeStackControlRetirementIntent(f.manifest, generation5Observation(f.now()), new Date(f.now()).toISOString());
  await temporary(async root => {
    const first = await createStackControlRetirementLedger(root), second = await createStackControlRetirementLedger(root);
    assert.equal(await first.read(), null); await assertGeneration6RegistryAbsent(root); assert.deepEqual(await readdir(root), []);
    const attempts = await Promise.allSettled([first.reserve(intent), second.reserve(intent)]); assert.equal(attempts.filter(v => v.status === "fulfilled").length, 1);
    assert.deepEqual(await second.read(), intent); await assert.rejects(first.reserve(intent));
    assert.deepEqual(await readdir(path.join(root, paths.retirementSlot)), ["delete-intent.json"]);
    await assertGeneration6RegistryAbsent(root);
  });
});

test("J23 FS partial/unknown/linked records remain blocked; no repairs or successor reset", async () => {
  await temporary(async root => {
    await mkdir(path.join(root, paths.retirementSlot), { recursive: true });
    const ledger = await createStackControlRetirementLedger(root); await assert.rejects(ledger.read()); assert.deepEqual(await readdir(path.join(root, paths.retirementSlot)), []);
    await writeFile(path.join(root, paths.retirementSlot, "foreign.json"), "{}"); await assert.rejects(ledger.read());
    await mkdir(path.join(root, paths.successorRegistry)); await assert.rejects(assertGeneration6RegistryAbsent(root));
  });
  await temporary(async root => {
    const file = path.join(root, "record.json"); await writeFile(file, "{}"); await link(file, path.join(root, "linked.json"));
    await assert.rejects(readStackControlRetirementJson(file));
    await writeFile(path.join(root, "large.json"), " ".repeat(600_001)); await assert.rejects(readStackControlRetirementJson(path.join(root, "large.json")));
  });
  await temporary(async root => {
    const other = path.join(root, "other"); await mkdir(other); await mkdir(path.join(root, ".aws-sandbox"));
    await symlink(other, path.join(root, paths.retirementRegistry), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects((await createStackControlRetirementLedger(root)).read());
  });
});

test("J23 strict CLI refuses cross-mode options and missing SHA before any output/SDK", async () => {
  const entry = fileURLToPath(new URL("../ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-control-generation5-retirement.ts", import.meta.url));
  await temporary(async root => {
    for (const extra of [[], ["--approved-manifest-sha", "a".repeat(63)], ["--approved-manifest-sha", "a".repeat(64), "--acknowledge-read-only"]]) {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", entry, "--mode", "RetireReviewed", "--evidence", path.join(root, "missing.json"),
        "--output", path.join(root, "out.json"), "--manifest", path.join(root, "manifest.json"), "--execution-phrase", "old", "--acknowledge-irreversible-deletion", "--acknowledge-low-cost-not-zero", ...extra], { encoding: "utf8", timeout: 15_000 });
      assert.notEqual(result.status, 0); assert.deepEqual(await readdir(root), []);
    }
  });
});

test("J23 PowerShell requires explicit fresh SHA and separate Inspect even on failed entry, no next-generation chaining", async () => {
  const wrapper = fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedGeneration5Retirement.ps1", import.meta.url)), source = await readFile(wrapper, "utf8");
  assert.match(source, /Parameter\(Mandatory\).*ApprovedManifestSha/); assert.match(source, /Assert-ReadComparisonApprovalWindow/);
  assert.match(source, /finally\s*\{[\s\S]*--mode Inspect/); assert.doesNotMatch(source, /--mode (CreateReviewed|RunReviewed|CheckGeneration6Admission)/);
  const shell = process.platform === "win32" ? "C:/Program Files/PowerShell/7/pwsh.exe" : "pwsh";
  const escaped = wrapper.replaceAll("'", "''");
  const parsed = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", `$j23Tokens=$null; $j23Errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$j23Tokens,[ref]$j23Errors); if ($j23Errors.Count) { exit 1 }`], { encoding: "utf8", timeout: 15_000 });
  assert.equal(parsed.status, 0, parsed.stderr);
});
