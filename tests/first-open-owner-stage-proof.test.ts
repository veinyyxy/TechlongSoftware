import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenOwnerStageKey, verifyFirstOpenOwnerStageReceipts,
  type FirstOpenOwnerStageExpectation } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";

const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const account = "402010193138", startAt = Date.UTC(2030, 0, 1), now = startAt + 1000;
const writer = { Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X", Account: account };
const reader = { Arn: `arn:aws:sts::${account}:assumed-role/SyntheticOnly/readonly`, UserId: "AROASYNTHETIC:readonly", Account: account };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const version = "Version+Value==";

function fixture(phase: FirstOpenOwnerStageExpectation["phase"]) {
  const scope = { approvalSha256: "a".repeat(64), targetCanonicalSha256: "b".repeat(64), phase };
  const key = firstOpenOwnerStageKey(scope), targetBytes = 59_000;
  const common = { Bucket: bucket, ExpectedBucketOwner: account, Key: key };
  const check = { ChecksumSHA256: Buffer.from(scope.targetCanonicalSha256, "hex").toString("base64"), ServerSideEncryption: "AES256" };
  const type = { ContentType: "application/json", ContentLength: targetBytes };
  const phaseScope = { approvalSha256: scope.approvalSha256, phase, jobId };
  const put = { ...phaseScope, schema: "techlong/fc41597f-owner-stage-put/v1", source: writer, acknowledgedAt: startAt + 100,
    bodyRawSha256: scope.targetCanonicalSha256, request: { ...common, ...check, ...type, IfNoneMatch: "*" },
    response: { ...check, httpStatus: 200, VersionId: version } };
  const get = { ...phaseScope, schema: "techlong/fc41597f-owner-stage-exact-get/v1", source: reader, checkedAt: startAt + 200,
    putReceiptRawSha256: sha(bytes(put)), request: { ...common, VersionId: version, ChecksumMode: "ENABLED" },
    response: { ...check, ...type, httpStatus: 200, VersionId: version, DeleteMarker: false, ContentEncoding: null as string | null,
      bodyRawSha256: scope.targetCanonicalSha256 } };
  const input = () => {
    const putReceipt = bytes(put), exactGetReceipt = bytes(get);
    const expected: FirstOpenOwnerStageExpectation = { ...scope, targetBytes, startAt, factsExpireAt: now + 1000, expectedReader: reader,
      putReceiptRawSha256: sha(putReceipt), getReceiptRawSha256: sha(exactGetReceipt) };
    return { expected, putReceipt, exactGetReceipt };
  };
  return { put, get, input, key };
}

test("trusted raw receipts bind only the exact owner phase, canonical bytes and returned VersionId", () => {
  for (const phase of ["provisioner-grant", "provisioner-relock", "formal-provisioner-grant", "formal-provisioner-relock"] as const) {
    const { input, key } = fixture(phase), evidence = input();
    const matched = verifyFirstOpenOwnerStageReceipts(evidence, now);
    const lane = phase.startsWith("formal-") ? "formal-provisioner" : "install";
    assert.equal(key, `first-open-management/${jobId}/${evidence.expected.approvalSha256}/install-owner/${lane}/${phase}/${evidence.expected.targetCanonicalSha256}.json`);
    assert.equal(matched.key, key);
    assert.equal(matched.versionId, version);
    assert.equal(matched.independentlyVerifiedBytesReceiptSha256, evidence.expected.getReceiptRawSha256);
    assert.equal(new URL(matched.templateURL).search, "?versionId=Version%2BValue%3D%3D");
    assert.equal(Object.hasOwn(matched, "changeSetOriginalReadConsent"), false);
    const changed = Buffer.from(evidence.exactGetReceipt.toString().trim());
    assert.throws(() => verifyFirstOpenOwnerStageReceipts({ ...evidence, exactGetReceipt: changed }, now), /RECEIPT_BYTES/);
  }
});

test("a matching Put and Get pair cannot use the other lane or a foreign key", () => {
  for (const [phase, from, to] of [
    ["formal-provisioner-grant", "/install-owner/formal-provisioner/", "/install-owner/install/"],
    ["provisioner-relock", "/install-owner/install/", "/install-owner/formal-provisioner/"],
    ["formal-provisioner-relock", `/${jobId}/`, "/foreign-job/"],
    ["provisioner-grant", `/${"a".repeat(64)}/`, `/${"f".repeat(64)}/`],
  ] as const) {
    const f = fixture(phase), key = f.key.replace(from, to);
    assert.notEqual(key, f.key);
    f.put.request.Key = f.get.request.Key = key;
    f.get.putReceiptRawSha256 = sha(bytes(f.put));
    assert.throws(() => verifyFirstOpenOwnerStageReceipts(f.input(), now), /VERSION_OR_BODY_CHANGED/);
  }
});

test("matching trusted hashes cannot make the writer its own independent reader", () => {
  for (const sameWriter of [writer, { ...reader, Arn: writer.Arn }, { ...reader, UserId: writer.UserId }]) {
    const f = fixture("provisioner-grant");
    f.get.source = sameWriter;
    const evidence = f.input();
    assert.throws(() => verifyFirstOpenOwnerStageReceipts({ ...evidence,
      expected: { ...evidence.expected, expectedReader: sameWriter } }, now), /READER_NOT_INDEPENDENT/);
  }
});

test("forged or inconsistent metadata fails even when the synthetic raw pins are recomputed", () => {
  const mutate: ((v: ReturnType<typeof fixture>) => void)[] = [
    f => { f.get.request.VersionId = "another"; },
    f => { f.get.request.Key = f.get.request.Key.replace("formal-provisioner-grant", "provisioner-grant"); },
    f => { f.get.response.DeleteMarker = true; },
    f => { f.get.response.ContentEncoding = "gzip"; },
    f => { f.get.response.ContentLength--; },
    f => { f.get.response.ChecksumSHA256 = "other"; },
    f => { f.get.response.bodyRawSha256 = "f".repeat(64); },
    f => { f.get.checkedAt = f.put.acknowledgedAt - 1; },
    f => { f.get.putReceiptRawSha256 = "c".repeat(64); },
    f => { f.get.source = { ...reader, Arn: writer.Arn }; },
    f => { f.put.request.IfNoneMatch = "changed"; f.get.putReceiptRawSha256 = sha(bytes(f.put)); },
  ];
  for (const edit of mutate) {
    const f = fixture("formal-provisioner-grant"); edit(f);
    assert.throws(() => verifyFirstOpenOwnerStageReceipts(f.input(), now), /RECEIPT_BINDING|VERSION_OR_BODY_CHANGED/);
  }
  const input = fixture("provisioner-grant").input();
  assert.throws(() => verifyFirstOpenOwnerStageReceipts(input, input.expected.factsExpireAt), /EXPECTATION/);
  assert.throws(() => verifyFirstOpenOwnerStageReceipts({ ...input, expected: { ...input.expected, targetBytes: 51_200 } }, now), /EXPECTATION/);
});
