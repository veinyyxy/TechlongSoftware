import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonical } from "../ops/temporary-idle/environment-cfn.mjs";
import { firstOpenOwnerStageKey, verifyFirstOpenOwnerStageReceipts } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import { bindFirstOpenInstallStagingWriter, type FirstOpenInstallStagingPlan,
  type FirstOpenInstallStagingPhase, type FirstOpenInstallStagingWriterJournal,
  type FirstOpenInstallStagingWriterPorts } from "../ops/aws-sandbox/first-open-install-staging-writer.ts";

const { jobId, bucket } = FIRST_OPEN_BASELINE_BINDING;
const phases = ["shared-predecessor", "provisioner-grant", "provisioner-relock"] as const;
const account = "402010193138", approvalSha256 = "a".repeat(64), startAt = Date.UTC(2030, 0, 1), writeBefore = startAt + 60_000;
const source = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
const reader = { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/SyntheticOnly/readonly`, UserId: "AROASYNTHETIC:readonly" };
const sha = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
const template = (label: string) => ({ Resources: { Z: { Type: "Synthetic", Properties: { Z: label, A: "x".repeat(52_000) } } },
  AWSTemplateFormatVersion: "2010-09-09" });
const templates = Object.fromEntries(phases.map(phase => [phase, template(phase === "provisioner-grant" ? "grant" : "closed")])) as
  Record<FirstOpenInstallStagingPhase, ReturnType<typeof template>>;
const body = (value: ReturnType<typeof template>) => Buffer.from(JSON.stringify(canonical(value)), "utf8");
const plan = { jobId, approvalSha256, startAt, writeBefore,
  targets: Object.fromEntries(phases.map(phase => [phase, { targetCanonicalSha256: sha(body(templates[phase])),
    targetBytes: body(templates[phase]).byteLength }])) as FirstOpenInstallStagingPlan["targets"] };

function fixture(overrides: { journal?: Partial<FirstOpenInstallStagingWriterJournal>; ports?: Partial<FirstOpenInstallStagingWriterPorts> } = {}) {
  let time = startAt + 1000;
  const calls: string[] = [], slots = new Set<string>(), acks: Uint8Array[] = [];
  const journal: FirstOpenInstallStagingWriterJournal = {
    async requireProtection() { calls.push("protection"); },
    async consume(slot) { calls.push("consume"); assert(!slots.has(slot)); slots.add(slot); },
    async record(_, event) { calls.push(event.kind); if (event.kind === "put-ack") acks.push(event.putReceiptBytes); },
    ...overrides.journal,
  };
  const ports: FirstOpenInstallStagingWriterPorts = {
    async identify() { calls.push("identity"); return { ...source, $metadata: { httpStatusCode: 200, attempts: 1 } }; },
    async put(req) {
      calls.push("put");
      const phase = phases.find(phase => req.Key?.includes(`/${phase}/`));
      assert(phase);
      const expected = plan.targets[phase], sent = body(templates[phase]);
      assert.deepEqual(req, { Bucket: bucket, ExpectedBucketOwner: account, ContentType: "application/json", ContentLength: sent.byteLength,
        Key: firstOpenOwnerStageKey({ phase, approvalSha256, targetCanonicalSha256: expected.targetCanonicalSha256 }),
        ServerSideEncryption: "AES256", IfNoneMatch: "*", ChecksumSHA256: Buffer.from(expected.targetCanonicalSha256, "hex").toString("base64"),
        Body: sent });
      return { $metadata: { httpStatusCode: 200, attempts: 1 }, VersionId: "Version+Value==", ChecksumSHA256: req.ChecksumSHA256,
        ServerSideEncryption: "AES256" };
    },
    ...overrides.ports,
  };
  const bind = () => bindFirstOpenInstallStagingWriter({ plan, journal, ports, now: () => time });
  return { calls, acks, bind, setTime(value: number) { time = value; }, ports, journal };
}
const write = (writer: ReturnType<typeof bindFirstOpenInstallStagingWriter>, phase: FirstOpenInstallStagingPhase) =>
  writer({ phase, template: templates[phase], signal: new AbortController().signal });

test("conditional exact three one-shot puts produce durable receipts accepted by existing version readback verifier", async () => {
  const f = fixture(), writer = f.bind(), keys = new Set<string>();
  for (const phase of phases) {
    const result = await write(writer, phase), { key, versionId, acknowledgedAt, putReceiptRawSha256, putReceiptBytes } = result;
    const target = plan.targets[phase], ChecksumSHA256 = Buffer.from(target.targetCanonicalSha256, "hex").toString("base64");
    const exactGetReceipt = Buffer.from(JSON.stringify({ schema: "techlong/fc41597f-owner-stage-exact-get/v1", jobId, approvalSha256, phase,
      checkedAt: acknowledgedAt, source: reader, putReceiptRawSha256, request: { Bucket: bucket, Key: key, ExpectedBucketOwner: account,
        VersionId: versionId, ChecksumMode: "ENABLED" }, response: { ContentType: "application/json", ContentLength: target.targetBytes,
        ChecksumSHA256, ServerSideEncryption: "AES256", bodyRawSha256: target.targetCanonicalSha256, httpStatus: 200, VersionId: versionId,
        DeleteMarker: false, ContentEncoding: null } }));
    assert.equal(verifyFirstOpenOwnerStageReceipts({ expected: { ...target, phase, approvalSha256, startAt, factsExpireAt: writeBefore,
      expectedReader: reader, putReceiptRawSha256, getReceiptRawSha256: sha(exactGetReceipt) }, putReceipt: putReceiptBytes, exactGetReceipt },
    acknowledgedAt).versionId, versionId);
    const persisted = f.acks.at(-1);
    assert(persisted);
    assert.deepEqual(Buffer.from(persisted), putReceiptBytes);
    keys.add(key);
  }
  assert.equal(keys.size, 3, "same closed-template bytes still use distinct exact keys");
  assert.deepEqual(f.calls, ["protection", "identity", "consume", "put-intent", "put", "put-ack",
    ...Array(2).fill(["protection", "consume", "put-intent", "put", "put-ack"]).flat()]);
  await assert.rejects(write(writer, phases[0]), /PHASE_STOPPED_OR_UNBOUND/);
  await assert.rejects(write(f.bind(), phases[0]), /SLOT_UNAVAILABLE/, "fresh in-memory wrapper cannot reset durable slots");
  assert.equal(f.calls.filter(x => x === "put").length, 3);
});

test("missing exact protection, wrong bytes, invalid lane or deadline never reaches PUT", async () => {
  const bad = fixture({ journal: { async requireProtection() { throw Error("synthetic unproved protection"); } } }), writer = bad.bind();
  await assert.rejects(write(writer, phases[0]), /PROTECTION_UNPROVED/);
  assert.deepEqual(bad.calls, []);
  const f = fixture(), exact = f.bind();
  await assert.rejects(exact({ phase: phases[0], template: template("unexpected"), signal: new AbortController().signal }), /TEMPLATE_BYTES/);
  await assert.rejects(write(exact, "formal-provisioner-grant" as FirstOpenInstallStagingPhase), /PHASE_STOPPED_OR_UNBOUND/);
  f.setTime(writeBefore);
  await assert.rejects(write(exact, phases[0]), /WINDOW/);
  assert.deepEqual(f.calls, []);
});

test("wrong Source, ambiguous upload and wrong ACK fail closed without any later submission", async () => {
  const wrong = fixture({ ports: { async identify() { return { ...source, UserId: "FORKED", $metadata: {} }; } } });
  await assert.rejects(write(wrong.bind(), phases[0]), /SOURCE_IDENTITY/);
  assert.deepEqual(wrong.calls, ["protection"]);
  for (const outcome of ["loss", "wrong-ack"] as const) {
    let submitted = 0;
    const f = fixture({ ports: { async put() { submitted++;
      if (outcome === "loss") throw Error("synthetic transport body not surfaced");
      return { $metadata: { httpStatusCode: 200 }, VersionId: "null" };
    } } });
    const writer = f.bind();
    await assert.rejects(write(writer, phases[0]), outcome === "loss" ? /PUT_STOP_NO_RETRY/ : /ACK_UNPROVED/);
    await assert.rejects(write(writer, phases[0]), /PHASE_STOPPED_OR_UNBOUND/);
    await assert.rejects(write(writer, phases[1]), /PHASE_STOPPED_OR_UNBOUND/);
    assert.equal(submitted, 1);
    assert.deepEqual(f.calls, ["protection", "identity", "consume", "put-intent"]);
    assert.deepEqual(f.acks, []);
  }
});
