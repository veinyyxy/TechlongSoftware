import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { CELL_PARENT_KEY_V4 as key, CELL_PARENT_BOUNDARY_V4, CELL_PARENT_INLINE_V4, CELL_PARENT_TABLE_ID_V4,
  cellParentIamDocumentsV4, cellParentTableFreezePolicyV4, prepareCellBirthParentReviewV4, approveCellBirthParentRecordV4,
  decodeCellBirthParentRecordV4, type CellParentRuntimeBindingV4 } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { AwsSdkCellParentInstallationReaderV4, assertCellParentInstallationV4, type CellParentInstallationSdkV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { AwsSdkCellParentRegistryReaderV4, AwsSdkCellParentProvisionPublisherV4, assertInstalledCellParentV4, CellParentFunctionConfigCommandV4,
  type CellParentRegistrySdkV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { createPreparedCellBirthParentRootV4 } from "../lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts";
import { compileCellBirthDelegationV3 } from "../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys } from "../lib/deployments/execution/failed-cell-birth-ddb-v1.ts";
import { v3Fixture, v3Now, v3StackId } from "./fixtures/cell-stack-v3.ts";

type Json = Record<string, unknown>;
const at = v3Now + 2000, roleId = "AROAV3GNMXTZTESTPAREN1", bundleSha = "b".repeat(64), signal = () => new AbortController().signal,
  functionArn = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3" as const;
// Metadata/atomic SDK fixtures are NOT live IAM/table-policy acceptance proofs.
async function fixture() {
  let time = at, runtime = false, loseWrite = false;
  const items = new Map<string, Json>(), writes: Json[] = [], committed = new Map<string, string>(), readFaults: Record<string, unknown> = {};
  const binding: CellParentRuntimeBindingV4 = { functionArn, functionVersion: "$LATEST", revisionId: "fixture-revision-123456", zipCodeSha256Base64: Buffer.alloc(32, 1).toString("base64"),
    bundleSha256: bundleSha, roleId, boundaryVersionId: "v1", tablePolicyRevisionId: "12345", sourceWindowClosesAt: at + 60000,
    tablePolicySha256: await sha256Hex(cellParentTableFreezePolicyV4(at + 60000)) };
  const docs = cellParentIamDocumentsV4(v3StackId), commands = Object.fromEntries(["identity", "table", "tablePolicy", "role", "inlineNames", "attached", "inline", "boundary", "boundaryVersion", "functionConfig", "transactGet", "transactWrite"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as CellParentInstallationSdkV4["commands"] & CellParentRegistrySdkV4["commands"];
  const data: Record<string, Json> = {
    table: { Table: { TableArn: "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority", TableId: CELL_PARENT_TABLE_ID_V4, TableStatus: "ACTIVE", KeySchema: [{ AttributeName: "authority_key", KeyType: "HASH" }] } },
    tablePolicy: { Policy: canonicalJson(cellParentTableFreezePolicyV4(binding.sourceWindowClosesAt)), RevisionId: binding.tablePolicyRevisionId },
    role: { Role: { Arn: "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3", RoleId: roleId, AssumeRolePolicyDocument: encodeURIComponent(canonicalJson(docs.trust)), PermissionsBoundary: { PermissionsBoundaryArn: CELL_PARENT_BOUNDARY_V4 } } },
    inlineNames: { PolicyNames: [CELL_PARENT_INLINE_V4], IsTruncated: false }, attached: { AttachedPolicies: [], IsTruncated: false },
    inline: { RoleName: "TechlongSandboxCellLifecycleCoordinatorRoleV3", PolicyName: CELL_PARENT_INLINE_V4, PolicyDocument: encodeURIComponent(canonicalJson(docs.inline)) },
    boundary: { Policy: { Arn: CELL_PARENT_BOUNDARY_V4, DefaultVersionId: "v1" } },
    boundaryVersion: { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: encodeURIComponent(canonicalJson(docs.boundary)) } },
    functionConfig: { FunctionArn: functionArn, FunctionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", Version: "$LATEST", Role: "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3",
      CodeSha256: binding.zipCodeSha256Base64, RevisionId: binding.revisionId, Runtime: "nodejs22.x", Handler: "cell-birth-coordinator-v4.handler", State: "Active", LastUpdateStatus: "Successful", PackageType: "Zip", Timeout: 120, MemorySize: 256, Architectures: ["x86_64"] },
  };
  const send = async (raw: unknown) => {
    const c = raw as { kind: string; input: Json };
    if (c.kind === "identity") return runtime ? { Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellLifecycleCoordinatorRoleV3/fixture-session", UserId: `${readFaults.roleId ?? roleId}:fixture-session` } :
      { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" };
    if (c.kind === "transactGet") return { Responses: (c.input.TransactItems as Json[]).map(a => { const k = String(((a.Get as Json).Key as Json).authority_key), v = items.get(k); return v ? { Item: structuredClone(v) } : {}; }) };
    if (c.kind === "transactWrite") {
      writes.push(structuredClone(c.input)); const token = String(c.input.ClientRequestToken), text = canonicalJson(c.input);
      if (committed.has(token)) { assert.equal(committed.get(token), text); return {}; }
      const touched = new Set<string>(), actions = c.input.TransactItems as Json[];
      for (const a of actions) { const p = a.Put as Json | undefined, x = (p ?? a.ConditionCheck) as Json, k = String(p ? (p.Item as Json).authority_key : (x.Key as Json).authority_key);
        assert.equal(touched.has(k), false); touched.add(k); const old = items.get(k);
        if (x.ConditionExpression === "attribute_not_exists(#key)") { if (old) throw Error("occupied"); }
        else { const vals = x.ExpressionAttributeValues as Json; if (!old || old.schema_version !== vals[":schema"] || old.record_json !== vals[":json"]) throw Error("changed"); }
      }
      for (const a of actions) if (a.Put) { const v = (a.Put as Json).Item as Json; items.set(String(v.authority_key), structuredClone(v)); }
      committed.set(token, text); if (loseWrite) throw Error("private diagnostics"); return {};
    }
    if (!data[c.kind]) throw Error("unexpected fixture command"); return structuredClone(data[c.kind]);
  };
  const client = { send }, installationSdk: CellParentInstallationSdkV4 = { sts: client, iam: client, ddb: client, lambda: client, commands }, registrySdk: CellParentRegistrySdkV4 = { sts: client, ddb: client, commands };
  const source = await v3Fixture("RESERVED", "CREATE_COMPLETE", "source_inspection"), reserved = await source.read(); assert.ok("protocol" in reserved);
  const delegation = await compileCellBirthDelegationV3({ plan: source.plan, reserved, coordinatorCodeSha256: bundleSha, coordinatorRoleId: roleId, now: at });
  const sourceMeta = new AwsSdkCellParentInstallationReaderV4(installationSdk, "source_inspection", () => time), installedMeta = await sourceMeta.read(binding, v3StackId, signal());
  const review = await prepareCellBirthParentReviewV4({ plan: source.plan, reserved, delegation, installation: installedMeta, failedProtectionSha256: "e".repeat(64), now: at });
  const record = await approveCellBirthParentRecordV4({ review, approvedManifestSha256: review.manifestSha256, now: at });
  items.set(key, { authority_key: key, schema_version: 4, record_json: canonicalJson(record) });
  runtime = true; time = binding.sourceWindowClosesAt;
  const local = { bundleSha256: bundleSha, functionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", functionVersion: "$LATEST", invokedFunctionArn: functionArn },
    runtimeMeta = new AwsSdkCellParentInstallationReaderV4(installationSdk, "lifecycle_coordinator", () => time),
    registry = new AwsSdkCellParentRegistryReaderV4(registrySdk, runtimeMeta, "lifecycle_coordinator", local, () => time), paid = await v3Fixture("PAID", "UPDATE_COMPLETE", "lifecycle_coordinator"); paid.setTime(time);
  const publisher = new AwsSdkCellParentProvisionPublisherV4(registrySdk, registry, paid.reader, () => time), root = createPreparedCellBirthParentRootV4({ registry, publisher, stack: paid.reader, now: () => time }),
    event = { schemaVersion: 3, action: "reconcile_approved_cell_birth_v3", birthIntentSha256: source.plan.birthIntentSha256, stackId: v3StackId };
  return { binding, data, items, writes, registrySdk, runtimeMeta, local, source, reserved, delegation, installedMeta, review, record, registry, paid, publisher, root, event, readFaults,
    setTime: (n: number) => { time = n; paid.setTime(n); }, loseWrite: () => { loseWrite = true; }, useSource: () => { runtime = false; } };
}
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
  assert.doesNotMatch(canonicalJson(allowed), /UpdateItem|DeleteItem|PutRolePolicy|UpdateFunctionCode|GetSecretValue|InvokeFunction/);
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
