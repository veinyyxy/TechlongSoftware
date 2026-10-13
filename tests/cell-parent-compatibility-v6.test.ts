import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { cellParentIamDocumentsV4 } from "../lib/deployments/execution/cell-birth-parent-v4.ts";
import { cellParentIamDocumentsV6, cellParentIamCompatibilityViewV6 } from "../lib/deployments/execution/cell-parent-iam-compatibility-v6.ts";
import { AwsSdkCellParentInstallationReaderV6 } from "../lib/deployments/execution/cell-parent-compatibility-v6.ts";
import { assertCellParentInstallationV4, type CellParentInstallationSdkV4 } from "../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { cellParentFixtureV4 } from "./fixtures/cell-parent-v4.ts";
import { v3StackId } from "./fixtures/cell-stack-v3.ts";

test("only the source deny's KMS exception changes; all actual resources, versions and other guards remain", () => {
  const old = cellParentIamDocumentsV4(v3StackId), next = cellParentIamDocumentsV6(v3StackId);
  const oldSource = old.boundary.Statement.find(s => s.Sid === "DenyOtherOrMissingSource")!;
  const source = next.boundary.Statement.find(s => s.Sid === oldSource.Sid)!;
  assert.equal(Object.hasOwn(source, "Action"), false); assert.equal(source.NotAction, "kms:Decrypt");
  const projected = structuredClone(next.boundary); projected.Statement[projected.Statement.findIndex(s => s.Sid === oldSource.Sid)] = structuredClone(oldSource);
  assert.equal(canonicalJson(projected), canonicalJson(old.boundary)); assert.deepEqual(next.boundary, next.inline);
  assert.ok(Buffer.byteLength(canonicalJson(next.boundary)) <= 6144); assert.equal(next.installationAuthorized, false);
  const kms = next.boundary.Statement.find(s => s.Sid === "ControlKms")!;
  assert.match(canonicalJson(kms), /secretsmanager.ca-central-1.amazonaws.com/); assert.match(canonicalJson(kms), /EncryptionContext:SecretARN/);
  assert.equal(next.actualForwardedKmsAllowPathVerified, false); assert.throws(() => cellParentIamDocumentsV6("techlong-sandbox-cell-sandbox-1"));
});
test("compatibility projection accepts only a full exact V6 actual document, never the old conflicting body", () => {
  const v6 = cellParentIamDocumentsV6(v3StackId), old = cellParentIamDocumentsV4(v3StackId);
  assert.throws(() => cellParentIamCompatibilityViewV6(undefined, v3StackId, "other" as never));
  for (const kind of ["boundary", "inline"] as const) {
    for (const raw of [v6[kind], canonicalJson(v6[kind]), encodeURIComponent(canonicalJson(v6[kind]))])
      assert.equal(cellParentIamCompatibilityViewV6(raw, v3StackId, kind), canonicalJson(old[kind]));
    assert.throws(() => cellParentIamCompatibilityViewV6(old[kind], v3StackId, kind));
    assert.throws(() => cellParentIamCompatibilityViewV6(v6[kind], v3StackId.replace("123456789012", "123456789013"), kind));
    const bad = structuredClone(v6[kind]); bad.Statement.push({ Effect: "Allow", Action: "*", Resource: "*" } as never);
    assert.throws(() => cellParentIamCompatibilityViewV6(bad, v3StackId, kind));
    assert.throws(() => cellParentIamCompatibilityViewV6("invalid", v3StackId, kind));
  }
});
async function fixture() {
  const f = await cellParentFixtureV4(), doc = cellParentIamDocumentsV6(v3StackId);
  f.data.inline.PolicyDocument = encodeURIComponent(canonicalJson(doc.inline));
  (f.data.boundaryVersion.PolicyVersion as Record<string, unknown>).Document = canonicalJson(doc.boundary);
  f.data.functionConfig.FunctionArn = `${f.binding.functionArn}:$LATEST`; f.data.functionConfig.Layers = null;
  // This test adapter only supplies metadata, not a live AWS permission proof.
  const installationSdk: CellParentInstallationSdkV4 = { sts: f.registrySdk.sts, ddb: f.registrySdk.ddb, iam: f.registrySdk.ddb, lambda: f.registrySdk.ddb,
    commands: f.registrySdk.commands as unknown as CellParentInstallationSdkV4["commands"] };
  const reader = new AwsSdkCellParentInstallationReaderV6(installationSdk, "lifecycle_coordinator", f.now);
  return { f, reader };
}
test("V6 full validation preserves genuine V4 proof and V5 exact latest metadata handling", async () => {
  const { f, reader } = await fixture(), proof = await reader.read(f.binding, v3StackId, new AbortController().signal, f.local);
  assert.doesNotThrow(() => assertCellParentInstallationV4(proof, f.now(), true));
  assert.throws(() => assertCellParentInstallationV4(structuredClone(proof), f.now(), true));
  assert.equal(proof.stableDoubleRead, true); assert.equal(proof.effectiveDataPlaneDenyProved, false);
});
test("wrong actual boundary/inline, code, role, caller, local bytes and table freeze still reject", async () => {
  for (const kind of ["inline", "boundary", "code", "role", "local", "caller", "freeze", "source-window"]) {
    const { f, reader } = await fixture();
    if (kind === "inline") f.data.inline.PolicyDocument = canonicalJson(cellParentIamDocumentsV4(v3StackId).inline);
    if (kind === "boundary") (f.data.boundaryVersion.PolicyVersion as Record<string, unknown>).Document = "{}";
    if (kind === "code") f.data.functionConfig.CodeSha256 = "wrong";
    if (kind === "role") (f.data.role.Role as Record<string, unknown>).RoleId = "other";
    if (kind === "caller") f.readFaults.roleId = "other";
    if (kind === "freeze") f.data.tablePolicy.Policy = "{}";
    if (kind === "source-window") f.setTime(f.binding.sourceWindowClosesAt - 1);
    await assert.rejects(reader.read(f.binding, v3StackId, new AbortController().signal, kind === "local" ? { ...f.local, bundleSha256: "a".repeat(64) } : f.local));
  }
});
test("candidate handler retains the entire V5 root and gate with only its metadata-reader substitution", async () => {
  const old = await readFile(new URL("../ops/aws-sandbox/lambda/cell-birth-coordinator-v5.ts", import.meta.url), "utf8"),
    next = await readFile(new URL("../ops/aws-sandbox/lambda/cell-birth-coordinator-v6.ts", import.meta.url), "utf8");
  // Whitespace/comments/import location may change; the executable body below
  // the self-hash declaration must be otherwise identical.
  const body = (s: string) => s.slice(s.indexOf("const localBundleSha256")).replaceAll("AwsSdkCellParentInstallationReaderV6", "AwsSdkCellParentInstallationReaderV5").replace(/\s+/g, "");
  assert.equal(body(next), body(old));
  assert.doesNotMatch(next, /PutRolePolicy|UpdateFunction|CreateStackCommand|fromLoginCredentials/);
});
