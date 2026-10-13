import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectDeletedIdentityFrameV8 } from "../lib/deployments/execution/cell-deleted-identity-inspection-v8.ts";
import { deletedIdentityFixtureV8 } from "./fixtures/deleted-reserved-identity-v8.ts";

test("exact DELETE_COMPLETE can omit optional protection only with full pre-false/birth/delete/zero proof", async () => {
  const f = await deletedIdentityFixtureV8(), result = await inspectDeletedIdentityFrameV8(f.plan, f.before, f.after, f.plan.template, [], f.events, f.token, f.attemptedAt, f.now);
  assert.equal(result.stackStatus, "DELETE_COMPLETE"); assert.equal(result.resourceCount, 0); assert.equal(result.terminationProtectionBeforeDelete, false);
  assert.equal(result.terminationProtectionPostDeleteObserved, null); assert.equal(result.terminationProtectionPostDeleteOmitted, true);
  assert.equal(result.noMissingFieldConvertedToLiveFalse, true);
});
test("explicit post-delete false remains observed false, not omitted", async () => {
  const f = await deletedIdentityFixtureV8(), result = await inspectDeletedIdentityFrameV8(f.plan, f.before, { ...f.after, EnableTerminationProtection: false }, f.plan.template, [], f.events, f.token, f.attemptedAt, f.now);
  assert.equal(result.terminationProtectionPostDeleteObserved, false); assert.equal(result.terminationProtectionPostDeleteOmitted, false);
});
test("pre-missing/true, post-true/null, force and all non-deleted states reject", async () => {
  const f = await deletedIdentityFixtureV8();
  for (const before of [{ ...f.before, EnableTerminationProtection: undefined }, { ...f.before, EnableTerminationProtection: true }])
    await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, before, f.after, f.plan.template, [], f.events, f.token, f.attemptedAt, f.now));
  for (const patch of [{ EnableTerminationProtection: true }, { EnableTerminationProtection: null }, { DeletionMode: "FORCE_DELETE_STACK" }, { StackStatus: "CREATE_COMPLETE" }, { StackStatus: "DELETE_FAILED" }])
    await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, f.before, { ...f.after, ...patch }, f.plan.template, [], f.events, f.token, f.attemptedAt, f.now));
});
test("missing/mismatched deletion or creation events and non-stack events reject", async () => {
  const f = await deletedIdentityFixtureV8();
  for (const events of [f.events.slice(0, -1), f.events.map((e, n) => n === 2 ? { ...e, ClientRequestToken: "other" } : e),
    f.events.map((e, n) => n === 0 ? { ...e, ClientRequestToken: "other" } : e), [...f.events, { ...f.events[0], EventId: "paid", ResourceType: "AWS::RDS::DBCluster" }]])
    await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, f.before, f.after, f.plan.template, [], events, f.token, f.attemptedAt, f.now));
});
test("other UUID, role, creation time, tags, template, nonzero inventory and deletion clock reject", async () => {
  const f = await deletedIdentityFixtureV8();
  for (const patch of [{ StackId: "wrong" }, { RoleARN: "other" }, { CreationTime: "2026-10-13T04:31:49.430Z" }, { Tags: [] }, { DeletionTime: "2026-10-13T13:29:49.000Z" }])
    await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, f.before, { ...f.after, ...patch }, f.plan.template, [], f.events, f.token, f.attemptedAt, f.now));
  await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, f.before, f.after, {}, [], f.events, f.token, f.attemptedAt, f.now));
  await assert.rejects(inspectDeletedIdentityFrameV8(f.plan, f.before, f.after, f.plan.template, [{}], f.events, f.token, f.attemptedAt, f.now));
});
test("new inspector never constructs deletion/write or claims a slot and requires full independent locks", async () => {
  const text = await readFile(new URL("../ops/aws-sandbox/scripts/inspect-cell-deleted-identity-v8.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(text, /(?:DeleteStack|CreateStack|UpdateStack|Invoke|PutRolePolicy|CreatePolicyVersion)Command/); assert.doesNotMatch(text, /claimOnce/);
  assert.match(text, /EXACT_DELETED_HISTORY_DOUBLE_READ/); assert.match(text, /reservation\.readBefore\(\)/); assert.match(text, /reservationParentCommonHashV5\(locks\.parent, true/);
});
