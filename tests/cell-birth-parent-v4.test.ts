import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { CELL_PARENT_KEY_V4 as key, cellParentIamDocumentsV4, cellParentTableFreezePolicyV4,
  approveCellBirthParentRecordV4, decodeCellBirthParentRecordV4 } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { assertCellParentInstallationV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { AwsSdkCellParentProvisionPublisherV4, assertInstalledCellParentV4, CellParentFunctionConfigCommandV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys } from "../lib/deployments/execution/failed-cell-birth-ddb-v1.ts";
import { v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";
import { cellParentFixtureV4 as fixture } from "./fixtures/cell-parent-v4.ts";
type Json = Record<string, unknown>;
const at = v3Now + 2000, signal = () => new AbortController().signal,
  functionArn = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3" as const;

test("full parent is a new strict protocol; old drain/marker or cloned review/installation cannot expand scope", async () => {
  const c = await fixture(); assert.equal(c.record.manifest.scope.publishActivation, false); assert.equal(c.record.manifest.scope.deleteFailedBirthOnce, true);
  assert.equal((await decodeCellBirthParentRecordV4(structuredClone(c.record))).parentSha256, c.record.parentSha256);
  await assert.rejects(() => decodeCellBirthParentRecordV4({ ...c.record, protocol: "approved-cell-birth-drain-registration-v3" }));
  await assert.rejects(() => approveCellBirthParentRecordV4({ review: structuredClone(c.review), approvedManifestSha256: c.review.manifestSha256, now: at }));
  await assert.rejects(() => approveCellBirthParentRecordV4({ review: c.review, approvedManifestSha256: "a".repeat(64), now: at }));
  await assert.rejects(() => approveCellBirthParentRecordV4({ review: c.review, approvedManifestSha256: c.review.manifestSha256, now: c.review.manifest.expiresAt }));
  assert.throws(() => assertCellParentInstallationV4(structuredClone(c.installedMeta), at));
  const clone = structuredClone(c.record); (clone.manifest.scope as unknown as { publishActivation: boolean }).publishActivation = true;
  await assert.rejects(() => decodeCellBirthParentRecordV4(clone));
});
test("freeze covers all legacy data writes, has an explicit Source window and leaves reads/control policy management unchanged", async () => {
  const c = await fixture(), policy = cellParentTableFreezePolicyV4(c.binding.sourceWindowClosesAt);
  assert.equal(policy.Statement.length, 2); assert.match(canonicalJson(policy), /PartiQLDelete/); assert.doesNotMatch(canonicalJson(policy), /LeadingKeys|GetItem|PutResourcePolicy/);
  assert.equal(policy.Statement[1].Condition?.DateGreaterThanEquals?.["aws:CurrentTime"], new Date(c.binding.sourceWindowClosesAt).toISOString());
  const docs = cellParentIamDocumentsV4(v3StackId); assert.ok(Buffer.byteLength(canonicalJson(docs.boundary)) <= 6144);
  const allowed = docs.boundary.Statement.filter(s => s.Effect === "Allow"), puts = allowed.find(s => s.Sid === "PutExactTransactionKeys")!;
  assert.doesNotMatch(canonicalJson(puts), /runtime:cell-sandbox-1:lifecycle-v2|cell-birth-v4:parent:cell:cell-sandbox-1/);
  assert.doesNotMatch(canonicalJson(allowed), /UpdateItem|DeleteItem|PutRolePolicy|UpdateFunctionCode|InvokeFunction/);
  assert.match(canonicalJson(allowed), /GetSecretValue/); assert.match(canonicalJson(allowed), /kms:Decrypt/);
  assert.throws(() => cellParentIamDocumentsV4("techlong-sandbox-cell-sandbox-1"));
});
test("runtime metadata blocks open Source window, wrong local bytes/context and any role/table/policy/code drift", async () => {
  const c = await fixture(); c.setTime(c.binding.sourceWindowClosesAt - 1);
  await assert.rejects(() => c.runtimeMeta.read(c.binding, v3StackId, signal(), c.local), /WINDOW_NOT_CLOSED/); c.setTime(c.binding.sourceWindowClosesAt);
  await assert.rejects(() => c.runtimeMeta.read(c.binding, v3StackId, signal(), { ...c.local, bundleSha256: "a".repeat(64) }));
  for (const kind of ["role", "table", "tablePolicy", "functionConfig", "attached", "inlineNames", "boundaryVersion"]) {
    const f = await fixture();
    if (kind === "role") (f.data.role.Role as Json).RoleId = "wrong";
    if (kind === "table") (f.data.table.Table as Json).TableId = "recreated-table";
    if (kind === "tablePolicy") f.data.tablePolicy.Policy = "{}";
    if (kind === "functionConfig") f.data.functionConfig.Environment = { Variables: { injected: "must not be logged" } };
    if (kind === "attached") f.data.attached.AttachedPolicies = [{ PolicyArn: "extra" }];
    if (kind === "inlineNames") f.data.inlineNames.IsTruncated = true;
    if (kind === "boundaryVersion") (f.data.boundaryVersion.PolicyVersion as Json).IsDefaultVersion = false;
    await assert.rejects(() => f.registry.readStrong(signal())); assert.equal(f.writes.length, 0);
  }
});
test("only installed strong runtime parent brand permits guarded provision; copies, absent parent and wrong RoleId fail", async () => {
  const c = await fixture(), p = await c.registry.readStrong(signal()); assert.ok(p); assertInstalledCellParentV4(p, c.binding.sourceWindowClosesAt, true);
  assert.throws(() => assertInstalledCellParentV4(structuredClone(p), c.binding.sourceWindowClosesAt, true));
  c.items.delete(key); await assert.rejects(() => c.publisher.publishOnce(c.event, signal()), /APPROVAL_ABSENT/); assert.equal((await c.root.run(c.event, signal())).outcome, "LOCKED_NO_FULL_PARENT");
  const bad = await fixture(); bad.readFaults.roleId = "WRONG"; await assert.rejects(() => bad.publisher.publishOnce(bad.event, signal())); assert.equal(bad.writes.length, 0);
});
test("actual guarded provision re-compiles current complete PAID schema2 item and atomically binds parent/exclusions", async () => {
  const c = await fixture(), r = await c.publisher.publishOnce(c.event, signal()); assert.equal(r.outcome, "PROVISION_SUBMITTED_REQUIRES_INDEPENDENT_READ");
  assert.equal(r.tenantRuntimeEnabled, false); const proof = await c.registry.readStrong(signal()); assert.equal(JSON.parse(proof!.provision!.record_json).state, "provision_verified");
  assert.equal(JSON.parse(proof!.provision!.record_json).templateCanonicalSha256, c.source.plan.templateCanonicalSha256); assert.equal(c.writes.length, 1);
  assert.equal((await c.publisher.publishOnce(c.event, signal())).outcome, "PROVISION_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(c.writes.length, 1);
});
test("concurrent publishers get distinct UUIDs; lost response is inspect-only and never retries an occupied provision slot", async () => {
  const c = await fixture(), r = await Promise.allSettled([c.publisher.publishOnce(c.event, signal()), c.publisher.publishOnce(c.event, signal())]);
  assert.equal(r.filter(x => x.status === "fulfilled" && x.value.outcome === "PROVISION_SUBMITTED_REQUIRES_INDEPENDENT_READ").length, 1);
  // Another publisher may commit between the two registry snapshots: rejecting
  // that drift before submission is also a safe losing outcome, not a retry.
  assert.equal(new Set(c.writes.map(w => w.ClientRequestToken)).size, c.writes.length);
  const lost = await fixture(); lost.loseWrite(); assert.equal((await lost.publisher.publishOnce(lost.event, signal())).outcome, "PROVISION_SUBMISSION_UNCERTAIN_INSPECT_ONLY");
  assert.ok((await lost.registry.readStrong(signal()))?.provision); assert.equal((await lost.publisher.publishOnce(lost.event, signal())).outcome, "PROVISION_SLOT_OCCUPIED_INSPECT_ONLY"); assert.equal(lost.writes.length, 1);
});
test("activation/failure/compensation or successful Stack drift blocks publication before mutation", async () => {
  for (const k of [keys.activation, keys.marker, keys.intent, keys.receipt]) { const c = await fixture(); c.items.set(k, { authority_key: k }); await assert.rejects(() => c.publisher.publishOnce(c.event, signal())); assert.equal(c.writes.length, 0); }
  const f = await fixture(); f.paid.stack.StackStatus = "UPDATE_FAILED"; await assert.rejects(() => f.publisher.publishOnce(f.event, signal())); assert.equal(f.writes.length, 0);
  const expired = await fixture(); expired.setTime(Date.parse(expired.delegation.cellExpiresAt)); await assert.rejects(() => expired.publisher.publishOnce(expired.event, signal())); assert.equal(expired.writes.length, 0);
});
test("an authority inserted at submission boundary loses the atomic transaction, without partial provision writes", async () => {
  const c = await fixture(), send = c.registrySdk.ddb.send;
  c.registrySdk.ddb.send = async (raw, options) => { if ((raw as { kind: string }).kind === "transactWrite") c.items.set(keys.marker, { authority_key: keys.marker }); return send(raw, options); };
  const pub = new AwsSdkCellParentProvisionPublisherV4(c.registrySdk, c.registry, c.paid.reader, () => c.binding.sourceWindowClosesAt);
  assert.equal((await pub.publishOnce(c.event, signal())).outcome, "PROVISION_SUBMISSION_UNCERTAIN_INSPECT_ONLY"); assert.equal(c.items.has(keys.provision), false);
});
test("Lambda composition does not silently expand parent scope into incomplete TTL/failure/activation work", async () => {
  const c = await fixture(); assert.equal(c.root.fullCleanupRootCompleted, false); const result = await c.root.run(c.event, signal()); assert.equal(result.outcome, "PROVISION_SUBMITTED_REQUIRES_INDEPENDENT_READ"); assert.equal(result.deleteInvocationAttempted, false);
  const due = await fixture(); due.setTime(Date.parse(due.delegation.cellExpiresAt)); assert.equal((await due.root.run(due.event, signal())).outcome, "DUE_FULL_TTL_ROOT_NOT_CONNECTED"); assert.equal(due.writes.length, 0);
  const failed = await fixture(); failed.paid.stack.StackStatus = "UPDATE_FAILED"; assert.equal((await failed.root.run(failed.event, signal())).outcome, "FAILED_BIRTH_FULL_COMPENSATION_ROOT_NOT_CONNECTED"); assert.equal(failed.writes.length, 0);
});
test("fixed Lambda read rejects caller URLs/qualifiers; handler validates before SDK credentials or providers", async () => {
  assert.throws(() => new CellParentFunctionConfigCommandV4({ FunctionName: "other", Qualifier: "$LATEST" }));
  assert.throws(() => new CellParentFunctionConfigCommandV4({ FunctionName: functionArn, Qualifier: "mutable-alias" }));
  const source = await readFile(new URL("../ops/aws-sandbox/lambda/cell-birth-coordinator-v4.ts", import.meta.url), "utf8");
  assert.match(source, /readFile\(fileURLToPath\(import.meta.url\)\)/); assert.doesNotMatch(source, /process\.env.*(?:SHA|ARN)|defaultProvider|SecretValue/);
  assert.ok(source.indexOf("validateCellBirthTickV3(rawEvent)") < source.indexOf("credentials = fromEnv()"));
  assert.ok(randomUUID().length === 36);
});
