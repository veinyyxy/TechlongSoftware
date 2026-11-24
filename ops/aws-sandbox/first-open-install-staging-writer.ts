import { createHash } from "node:crypto";
import type { PutObjectCommandInput, PutObjectCommandOutput } from "@aws-sdk/client-s3";
import type { GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { canonical as ordinal } from "../temporary-idle/environment-cfn.mjs";
import { firstOpenOwnerStageKey } from "./first-open-owner-stage-proof.ts";

const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const account = "402010193138";
const source = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
const phases = ["shared-predecessor", "provisioner-grant", "provisioner-relock"] as const;
export type FirstOpenInstallStagingPhase = (typeof phases)[number];
type Target = { targetCanonicalSha256: string; targetBytes: number };
export type FirstOpenInstallStagingPlan = Readonly<{
  jobId: typeof jobId; approvalSha256: string; startAt: number; writeBefore: number;
  targets: Readonly<Record<FirstOpenInstallStagingPhase, Target>>;
}>;
type Binding = Readonly<Target & { jobId: typeof jobId; phase: FirstOpenInstallStagingPhase; approvalSha256: string;
  bucket: typeof bucket; key: string; startAt: number; writeBefore: number }>;
type ProjectedPut = Readonly<{
  Bucket: typeof bucket; Key: string; ExpectedBucketOwner: typeof account; ContentType: "application/json";
  ContentLength: number; ChecksumSHA256: string; ServerSideEncryption: "AES256"; IfNoneMatch: "*";
}>;
type PutEvent = { kind: "put-intent"; at: number; request: ProjectedPut; bodyRawSha256: string } |
  { kind: "put-ack"; at: number; versionId: string; putReceiptRawSha256: string; putReceiptBytes: Uint8Array };
export type FirstOpenInstallStagingWriterJournal = {
  /** Reject unless the outer approved exact-key protection is independently verified. */
  requireProtection(binding: Binding, signal: AbortSignal): Promise<void>;
  /** Exclusive, durable, non-resettable. Must reject a pre-existing slot. */
  consume(slot: string, binding: Binding): Promise<void>;
  record(slot: string, event: PutEvent): Promise<void>;
};
export type FirstOpenInstallStagingWriterPorts = {
  identify(signal: AbortSignal): Promise<GetCallerIdentityCommandOutput>;
  /** Trusted Source transport: one submission, no SDK retries or fallback credentials. */
  put(request: PutObjectCommandInput, signal: AbortSignal): Promise<PutObjectCommandOutput>;
};

const hex = /^[a-f0-9]{64}$/;
const sha = (input: Uint8Array) => createHash("sha256").update(input).digest("hex");
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_STAGING_" + code); };
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
const exactKeys = (o: unknown, names: readonly string[]) => !!o && typeof o === "object" && !Array.isArray(o) &&
  Object.keys(o).sort().join(",") === [...names].sort().join(",");
const recordObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Bind only the exact three installation uploads. This module never calls
 * a GET, updates policy, assumes a role, fetches credentials or submits CFN.
 * A returned PUT receipt is not independent proof of fixed-version access. */
export function bindFirstOpenInstallStagingWriter(input: { plan: FirstOpenInstallStagingPlan;
  ports: FirstOpenInstallStagingWriterPorts; journal: FirstOpenInstallStagingWriterJournal; now?: () => number }) {
  const { ports, journal, now = Date.now } = input, p = structuredClone(input.plan);
  need(exactKeys(p, ["jobId", "approvalSha256", "startAt", "writeBefore", "targets"]) && p.jobId === jobId && hex.test(p.approvalSha256) &&
    Number.isSafeInteger(p.startAt) && Number.isSafeInteger(p.writeBefore) && p.startAt > 0 && p.startAt < p.writeBefore &&
    exactKeys(p.targets, phases) && phases.every(phase => {
      const t = p.targets[phase];
      return exactKeys(t, ["targetCanonicalSha256", "targetBytes"]) && hex.test(t.targetCanonicalSha256) &&
        Number.isSafeInteger(t.targetBytes) && t.targetBytes > 51_200 && t.targetBytes <= 1_048_576;
    }), "PLAN");
  const bindings = new Map(phases.map(phase => {
    const target = p.targets[phase];
    const key = firstOpenOwnerStageKey({ phase, approvalSha256: p.approvalSha256, targetCanonicalSha256: target.targetCanonicalSha256 });
    const binding: Binding = { ...target, jobId, phase, approvalSha256: p.approvalSha256, bucket, key,
      startAt: p.startAt, writeBefore: p.writeBefore };
    return [phase, Object.freeze(binding)] as const;
  }));
  const attempted = new Set<FirstOpenInstallStagingPhase>();
  let busy = false, stopped = false, sourceVerified = false;

  return async ({ phase, template, signal }: { phase: FirstOpenInstallStagingPhase; template: unknown; signal: AbortSignal }) => {
    const b = bindings.get(phase);
    need(b && !busy && !stopped && !attempted.has(phase), "PHASE_STOPPED_OR_UNBOUND");
    const checkTime = () => {
      const at = now();
      need(!signal.aborted && Number.isSafeInteger(at) && at >= b.startAt && at < b.writeBefore, "WINDOW");
      return at;
    };
    checkTime();
    need(recordObject(template) && recordObject(template.Resources) && !Object.hasOwn(template, "Transform"), "TEMPLATE_SHAPE");
    let body: Buffer;
    try { body = Buffer.from(JSON.stringify(ordinal(structuredClone(template))), "utf8"); }
    catch { return fail("TEMPLATE_ENCODING"); }
    need(body.byteLength === b.targetBytes && sha(body) === b.targetCanonicalSha256, "TEMPLATE_BYTES");
    const checksum = Buffer.from(b.targetCanonicalSha256, "hex").toString("base64");
    const request = Object.freeze({ Bucket: bucket, Key: b.key, ExpectedBucketOwner: account, ContentType: "application/json",
      ContentLength: b.targetBytes, ChecksumSHA256: checksum, ServerSideEncryption: "AES256", IfNoneMatch: "*" } as const);
    const slot = `${jobId}:${p.approvalSha256}:install-owner-put:${phase}`;
    const bounded = () => AbortSignal.any([signal, AbortSignal.timeout(Math.min(25_000, b.writeBefore - checkTime()))]);
    busy = true;
    attempted.add(phase);
    try {
      try { await journal.requireProtection(b, bounded()); } catch { return fail("PROTECTION_UNPROVED"); }
      checkTime();
      if (!sourceVerified) {
        const who = await ports.identify(bounded()).catch(() => fail("SOURCE_IDENTITY"));
        need(who?.Account === source.Account && who.Arn === source.Arn && who.UserId === source.UserId &&
          (who.$metadata.attempts === undefined || who.$metadata.attempts === 1), "SOURCE_IDENTITY");
        sourceVerified = true;
      }
      checkTime();
      try { await journal.consume(slot, b); } catch { return fail("SLOT_UNAVAILABLE"); }
      try { await journal.record(slot, { kind: "put-intent", at: checkTime(), request, bodyRawSha256: b.targetCanonicalSha256 }); }
      catch { return fail("INTENT_NOT_DURABLE"); }
      const operation = bounded();
      let out: PutObjectCommandOutput;
      try { out = await ports.put({ ...request, Body: body }, operation); }
      catch { return fail("PUT_STOP_NO_RETRY"); }
      need(out?.$metadata?.httpStatusCode === 200 && (out.$metadata.attempts === undefined || out.$metadata.attempts === 1) &&
        validFirstOpenVersionId(out.VersionId) && out.ChecksumSHA256 === checksum && out.ServerSideEncryption === "AES256" &&
        !operation.aborted, "ACK_UNPROVED");
      const acknowledgedAt = checkTime(), versionId = out.VersionId;
      const putReceiptBytes = Buffer.from(canonicalJson({ schema: "techlong/fc41597f-owner-stage-put/v1", jobId,
        approvalSha256: b.approvalSha256, phase, acknowledgedAt, source, bodyRawSha256: b.targetCanonicalSha256,
        request, response: { httpStatus: 200, VersionId: versionId, ChecksumSHA256: checksum, ServerSideEncryption: "AES256" } }), "utf8");
      const putReceiptRawSha256 = sha(putReceiptBytes);
      try { await journal.record(slot, { kind: "put-ack", at: acknowledgedAt, versionId, putReceiptRawSha256,
        putReceiptBytes: Uint8Array.from(putReceiptBytes) }); }
      catch { return fail("ACK_NOT_DURABLE"); }
      checkTime();
      return { key: b.key, versionId, acknowledgedAt, putReceiptRawSha256, putReceiptBytes };
    } catch (error) {
      stopped = true;
      throw error;
    } finally { busy = false; }
  };
}
