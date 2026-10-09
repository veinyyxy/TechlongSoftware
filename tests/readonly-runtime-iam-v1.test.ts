import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets, readonlyRuntimeIamDocumentsV1 as documents,
  compileReadonlyIamManifestV1, validateReadonlyIamManifestV1, runReadonlyIamInstallV1, inspectReadonlyIamInventoryV1,
  type ReadonlyIamInventoryV1, type ReadonlyIamInstallPortsV1 } from "../lib/deployments/execution/readonly-runtime-iam-v1.ts";

const now = Date.parse("2026-10-09T01:00:00Z"), codeSha256 = "a".repeat(64);
async function fixture() {
  const inventory: ReadonlyIamInventoryV1 = { observedAt: now, sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
    prerequisitesSha256: "b".repeat(64), roles: targets.map(t => ({ name: t.role, state: "ABSENT" })),
    policies: targets.map(t => ({ name: t.boundary, state: "ABSENT" })) };
  const manifest = await compileReadonlyIamManifestV1({ inventory, codeSha256, now });
  const writes: string[] = [], markers: { name: string; value: Record<string, unknown> }[] = []; let occupied = false;
  const ports: ReadonlyIamInstallPortsV1 = { now: () => now, inventory: async () => inventory,
    claimSlot: async () => { if (occupied) throw new Error("occupied"); occupied = true; }, saveMarker: async (name, value) => { markers.push({ name, value }); },
    createBoundary: async i => { writes.push(`boundary-${i}`); return { arn: `arn:aws:iam::402010193138:policy/${targets[i].boundary}`, name: targets[i].boundary, version: "v1" }; },
    createRole: async i => { writes.push(`role-${i}`); return { arn: `arn:aws:iam::402010193138:role/${targets[i].role}`, name: targets[i].role,
      roleId: "AROA" + String(i).padStart(17, "0"), boundaryArn: `arn:aws:iam::402010193138:policy/${targets[i].boundary}` }; },
    verifyNewEmptyRole: async () => undefined, putOwnRolePolicy: async i => { writes.push(`inline-${i}`); } };
  return { inventory, manifest, ports, writes, markers, input: { manifest, approvedSha: manifest.manifestSha256, codeSha256, ports } };
}
test("four new named resources bind exact documents, bounded APIs and honest unproved-source allow scope", async () => {
  const f = await fixture(); await validateReadonlyIamManifestV1(f.manifest, codeSha256);
  assert.equal(f.manifest.scope.iamWriteCallsMaximum, 6); assert.equal(f.manifest.scope.runtimeEnabled, false);
  assert.equal(f.manifest.scope.sourceFunctionAllowPathNotProvedBySimulator, true);
  assert.equal(f.manifest.scope.liveReadProofRequiredBeforeAnyMutationGrant, true);
  assert.equal(f.manifest.scope.iamRoleIdChecksAreNotServerSideCompareAndSwap, true);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.markers, []);
});
test("readonly policy retains source/region/secret/table/key/log guards and forbids all other actions, within quota", () => {
  for (let i = 0; i < 2; i++) {
    const d = documents(i), policy = d.boundary, text = canonicalJson(policy);
    assert(text.length <= 6144); assert.equal(canonicalJson(d.identity), text);
    const deny = policy.Statement.find(s => s.Sid === "DenyAllOtherActions")!;
    const permitted = deny.NotAction as string[];
    assert(!permitted.includes("cloudformation:DeleteStack")); assert(!permitted.includes("dynamodb:PutItem"));
    assert(!permitted.some(a => a.startsWith("iam:") || a === "logs:CreateLogGroup" || a === "sts:AssumeRole"));
    assert.equal((d.trust.Statement[0].Principal as { Service: string }).Service, "lambda.amazonaws.com");
    assert(text.includes("DenyOtherOrMissingSourceFunction")); assert(text.includes("DenyOtherSecrets"));
    assert(text.includes("DenyMissingLeadingKeys")); assert(text.includes("DenyOtherKeys")); assert(text.includes("AWSCURRENT"));
    if (i === 0) { assert(text.includes("TransactGetItems")); assert(text.includes("?".repeat(64))); }
    else assert(!permitted.some(a => a.startsWith("cloudformation:")));
  }
  assert.throws(() => { (targets[0] as { secretArn: string }).secretArn = "foreign"; });
  assert.throws(() => documents(2));
});
test("wrong SHA, expiration, unknown fields and code drift stop before any inventory or write", async () => {
  for (const variant of ["sha", "expiry", "fields", "code"] as const) {
    const f = await fixture(); let reads = 0; f.ports.inventory = async () => { reads++; return f.inventory; };
    if (variant === "sha") f.input.approvedSha = "0".repeat(64);
    if (variant === "expiry") f.ports.now = () => f.manifest.expiresAt;
    if (variant === "fields") f.input.manifest = { ...f.manifest, extra: true } as typeof f.manifest;
    if (variant === "code") f.input.codeSha256 = "c".repeat(64);
    await assert.rejects(runReadonlyIamInstallV1(f.input)); assert.equal(reads, 0); assert.deepEqual(f.writes, []);
  }
});
test("present resources, stale evidence, lineage drift and occupied slot never update an existing role", async () => {
  for (const variant of ["present", "stale", "lineage", "slot"] as const) {
    const f = await fixture();
    if (variant === "present") f.inventory.roles[0].state = "PRESENT";
    if (variant === "stale") f.inventory.observedAt -= 30_001;
    if (variant === "lineage") f.inventory.prerequisitesSha256 = "c".repeat(64);
    if (variant === "slot") await f.ports.claimSlot();
    const r = await runReadonlyIamInstallV1(f.input); assert.equal(r.slotConsumed, false); assert.equal(r.iamWriteCalls, 0); assert.deepEqual(f.writes, []);
  }
});
test("six ordered API attempts only; own role IDs verified before inline policy and no second run", async () => {
  const f = await fixture(), verified: string[] = [];
  f.ports.verifyNewEmptyRole = async (i, id) => { assert.equal(id, "AROA" + String(i).padStart(17, "0")); verified.push(`role-${i}`); };
  f.ports.putOwnRolePolicy = async i => { assert(verified.includes(`role-${i}`)); f.writes.push(`inline-${i}`); };
  const r = await runReadonlyIamInstallV1(f.input);
  assert.equal(r.iamWriteCalls, 6); assert.equal(r.slotConsumed, true); assert.equal(r.failureCode, null);
  assert.deepEqual(f.writes, ["boundary-0", "boundary-1", "role-0", "inline-0", "role-1", "inline-1"]);
  const replay = await runReadonlyIamInstallV1(f.input); assert.equal(replay.iamWriteCalls, 0); assert.equal(f.writes.length, 6);
  assert.equal(f.markers.filter(m => m.name.endsWith("-attempt.json")).length, 6);
});
test("response loss and empty-role drift preserve partial resources without compensation or continuation", async () => {
  for (const variant of ["response", "role-drift", "persist"] as const) {
    const f = await fixture();
    if (variant === "response") f.ports.createBoundary = async () => { f.writes.push("boundary-0"); throw new Error("sensitive diagnostic withheld"); };
    if (variant === "role-drift") f.ports.verifyNewEmptyRole = async () => { throw new Error("drift"); };
    if (variant === "persist") f.ports.saveMarker = async () => { throw new Error("persistence failed"); };
    const r = await runReadonlyIamInstallV1(f.input); assert.equal(r.slotConsumed, true); assert.equal(r.retryAuthorized, false);
    assert.equal(r.iamWriteCalls, variant === "response" ? 1 : variant === "role-drift" ? 3 : 0);
    assert(!f.writes.some(w => w.startsWith("inline"))); assert.doesNotMatch(JSON.stringify(r), /sensitive diagnostic|persistence failed/);
  }
});
test("inspector only recognizes four exact owned resources plus unchanged prerequisites; never runtime ready", async () => {
  const f = await fixture();
  assert.equal(inspectReadonlyIamInventoryV1(f.inventory, f.manifest).iamFoundationReady, false);
  for (const v of [...f.inventory.roles, ...f.inventory.policies]) { v.state = "PRESENT"; v.exactOwnMatch = true; }
  const ok = inspectReadonlyIamInventoryV1(f.inventory, f.manifest); assert.equal(ok.iamFoundationReady, true); assert.equal(ok.runtimeEnabled, false);
  f.inventory.roles[0].exactOwnMatch = false; assert.equal(inspectReadonlyIamInventoryV1(f.inventory, f.manifest).iamFoundationReady, false);
});
test("CLI contains only the three scoped IAM write APIs, source pin/maxAttempts1 and no secret value/role assumption/deployment", () => {
  const cli = readFileSync(new URL("../ops/aws-sandbox/scripts/review-f3b3-readonly-runtime-iam.mjs", import.meta.url), "utf8");
  assert.match(cli, /CreatePolicyCommand/); assert.match(cli, /CreateRoleCommand/); assert.match(cli, /PutRolePolicyCommand/);
  assert.match(cli, /ignoreConfiguredEndpointUrls:true,maxAttempts:1/); assert.match(cli, /techlong-sandbox-user/);
  assert.match(cli, /PolicyNotFoundException/); assert.match(cli, /INDEPENDENT_READONLY_INSPECT/);
  assert.match(cli, /runtimePermissionsNotProved:true,sourceFunctionGuardPreserved:true/);
  assert.doesNotMatch(cli, /GetSecretValueCommand|DeletePolicyCommand|CreatePolicyVersionCommand|DeleteRoleCommand|AssumeRoleCommand|CreateFunctionCommand|InvokeCommand|TransactWriteCommand|PutCommand/);
});
