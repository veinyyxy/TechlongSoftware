import { createHash } from "node:crypto";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";

const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const account = "402010193138", region = "ca-central-1";
const source = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
const phases = ["provisioner-grant", "provisioner-relock", "formal-provisioner-grant", "formal-provisioner-relock"] as const;
type Phase = (typeof phases)[number];
type Identity = Readonly<{ Account: string; Arn: string; UserId: string }>;
const hex = /^[a-f0-9]{64}$/;
const validSha = (v: unknown): v is string => typeof v === "string" && hex.test(v);
const fail = (reason: string): never => { throw Error("FIRST_OPEN_OWNER_STAGE_" + reason); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : fail("RECEIPT_SHAPE");
const exact = (v: Record<string, unknown>, keys: string) => Object.keys(v).sort().join(",") === keys;

export type FirstOpenOwnerStageExpectation = Readonly<{
  approvalSha256: string;
  phase: Phase;
  targetCanonicalSha256: string;
  targetBytes: number;
  startAt: number;
  factsExpireAt: number;
  expectedReader: Identity;
  putReceiptRawSha256: string;
  getReceiptRawSha256: string;
}>;

export function firstOpenOwnerStageKey(scope: Pick<FirstOpenOwnerStageExpectation, "approvalSha256" | "phase" | "targetCanonicalSha256">) {
  const { approvalSha256, phase, targetCanonicalSha256 } = scope;
  if (!validSha(approvalSha256) || !validSha(targetCanonicalSha256) || !phases.includes(phase)) return fail("KEY_SCOPE");
  const lane = phase.startsWith("formal-provisioner-") ? "formal-provisioner" : "install";
  return `first-open-management/${jobId}/${approvalSha256}/install-owner/${lane}/${phase}/${targetCanonicalSha256}.json`;
}

function receipt(bytes: Uint8Array, sha256: string) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 8_192 ||
    createHash("sha256").update(bytes).digest("hex") !== sha256) return fail("RECEIPT_BYTES");
  try { return fields(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { return fail("RECEIPT_SHAPE"); }
}

/** Receipts are sanitized projections from separately authenticated writer and
 * reader evidence. `expected` (including BOTH raw digests) must come from the
 * approved caller, never from the receipts being tested. This is a match of
 * previously observed bytes, not proof of current IAM, version retention,
 * CloudFormation selection, or consent to perform the staged Original check. */
export function verifyFirstOpenOwnerStageReceipts(input: {
  expected: FirstOpenOwnerStageExpectation;
  putReceipt: Uint8Array;
  exactGetReceipt: Uint8Array;
}, now = Date.now()) {
  const { expected: e, putReceipt, exactGetReceipt } = input;
  const key = firstOpenOwnerStageKey(e), { targetCanonicalSha256: sha, targetBytes: size, expectedReader: reader } = e;
  if (![e.startAt, e.factsExpireAt, now, size].every(Number.isSafeInteger) || e.startAt <= 0 || e.startAt > now ||
    now >= e.factsExpireAt || size <= 51_200 || size > 1_048_576 || !validSha(e.putReceiptRawSha256) || !validSha(e.getReceiptRawSha256) ||
    reader?.Account !== account || typeof reader.Arn !== "string" ||
    !new RegExp(`^arn:aws:(iam::${account}:(?:user|role)|sts::${account}:assumed-role)/[\\w+=,.@/-]{1,160}$`).test(reader.Arn) ||
    typeof reader.UserId !== "string" || !/^[A-Z0-9]+(?::[\w+=,.@-]{2,64})?$/.test(reader.UserId)) return fail("EXPECTATION");
  if (reader.Arn === source.Arn || reader.UserId.split(":", 1)[0] === source.UserId) return fail("READER_NOT_INDEPENDENT");

  const put = receipt(putReceipt, e.putReceiptRawSha256), get = receipt(exactGetReceipt, e.getReceiptRawSha256);
  const checksum = Buffer.from(sha, "hex").toString("base64");
  const coordinates = { Bucket: bucket, Key: key, ExpectedBucketOwner: account };
  const exactBody = { ContentType: "application/json", ContentLength: size, ChecksumSHA256: checksum,
    ServerSideEncryption: "AES256", bodyRawSha256: sha };
  const putAt = put.acknowledgedAt, getAt = get.checkedAt, version = fields(put.response).VersionId;
  if (!exact(put, "acknowledgedAt,approvalSha256,bodyRawSha256,jobId,phase,request,response,schema,source") ||
    !exact(get, "approvalSha256,checkedAt,jobId,phase,putReceiptRawSha256,request,response,schema,source") ||
    put.schema !== "techlong/fc41597f-owner-stage-put/v1" || get.schema !== "techlong/fc41597f-owner-stage-exact-get/v1" ||
    [put, get].some(r => r.approvalSha256 !== e.approvalSha256 || r.jobId !== jobId || r.phase !== e.phase) ||
    !same(put.source, source) || !same(get.source, reader) || get.putReceiptRawSha256 !== e.putReceiptRawSha256 ||
    !Number.isSafeInteger(putAt) || !Number.isSafeInteger(getAt) || Number(putAt) < e.startAt || Number(getAt) < Number(putAt) || Number(getAt) > now ||
    !validFirstOpenVersionId(version)) return fail("RECEIPT_BINDING");
  const { bodyRawSha256, ...wireBody } = exactBody;
  if (put.bodyRawSha256 !== bodyRawSha256 || !same(put.request, { ...coordinates, ...wireBody, IfNoneMatch: "*" }) ||
    !same(put.response, { httpStatus: 200, VersionId: version, ChecksumSHA256: checksum, ServerSideEncryption: "AES256" }) ||
    !same(get.request, { ...coordinates, VersionId: version, ChecksumMode: "ENABLED" }) ||
    !same(get.response, { ...exactBody, httpStatus: 200, VersionId: version, DeleteMarker: false, ContentEncoding: null })) {
    return fail("VERSION_OR_BODY_CHANGED");
  }
  const templateURL = `https://${bucket}.s3.${region}.amazonaws.com/${key}?versionId=${encodeURIComponent(version)}`;
  if (templateURL.length > 1024) return fail("VERSION_URL");
  return { key, versionId: version, templateURL, targetCanonicalSha256: sha,
    independentlyVerifiedBytesReceiptSha256: e.getReceiptRawSha256 };
}
