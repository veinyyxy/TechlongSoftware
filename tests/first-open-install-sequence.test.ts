import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { createFirstOpenInstallJournal } from "../ops/aws-sandbox/first-open-install-journal.ts";
import { firstOpenInstallSourceSessionPolicy, readFirstOpenSourceProtection, runFirstOpenInstallSequence,
  type FirstOpenInstallSequencePlan } from "../ops/aws-sandbox/first-open-install-sequence.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";

const intent = "a".repeat(64), approval = "b".repeat(64);
const job = "job_fc41597f9b5ba8e02b338ecf";

test("install journal accepts one attempt per exact intent, even under a different outer SHA", async t => {
  const dir = await mkdtemp(join(tmpdir(), "first-open-install-journal-"));
  t.after(() => rm(dir, { recursive: true }));
  const journal = await createFirstOpenInstallJournal(dir, intent, approval);
  const slot = `${job}:${intent}:install:shared-predecessor`;
  await journal.consume(slot, { phase: "shared-predecessor" });
  await journal.record(slot, { kind: "create-intent", at: 1 });
  const receipt = Buffer.from("{\"proof\":true}");
  await journal.receipt("independent", receipt);
  await assert.rejects(journal.consume(slot, {}), /INSTALL_JOURNAL/);
  await assert.rejects(journal.receipt("independent", receipt));
  await assert.rejects(journal.record(`${job}:${intent}:unconsumed`, {}), /INSTALL_JOURNAL/);
  await assert.rejects(createFirstOpenInstallJournal(dir, intent, "c".repeat(64)), /INSTALL_JOURNAL/);
  const path = join(dir, `first-open-install-${intent}`);
  assert.equal((await readdir(path)).length, 4);
  assert.deepEqual(await readFile(join(path, "receipt-independent.json")), receipt);
});

test("wrong outer approval, mismatched component intent, and non-independent identity stop before any I/O", async () => {
  const invalid = { schema: "techlong/fc41597f-install-sequence/v1", bucket: { jobId: job, installIntentSha256: intent },
    owner: { jobId: job, approvalSha256: intent }, readback: { release: { jobId: job, approvalSha256: intent } },
    independentReader: { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" },
  } as FirstOpenInstallSequencePlan;
  let touches = 0;
  const noIo = new Proxy({}, { get() { ++touches; throw new Error("unexpected I/O"); } });
  const run = (plan: FirstOpenInstallSequencePlan, sha: string) => runFirstOpenInstallSequence({
    plan, approvedPlanSha256: sha, privateDir: "", signal: new AbortController().signal,
    source: noIo, independent: noIo, github: { ...noIo, artifactReadToken: "test_token" },
  } as Parameters<typeof runFirstOpenInstallSequence>[0]);
  await assert.rejects(run(invalid, "f".repeat(64)), /APPROVED_PLAN/);
  await assert.rejects(run(invalid, await sha256Hex(invalid)), /APPROVED_PLAN/);
  const drift: FirstOpenInstallSequencePlan = { ...invalid, terminalReadback: undefined, sourceSessionPolicy: undefined, independentReader: { ...invalid.independentReader,
    Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/inspect", UserId: "AIDAOTHERINDEPENDENT" },
    owner: { ...invalid.owner, approvalSha256: "c".repeat(64) } };
  await assert.rejects(run(drift, await sha256Hex(drift)), /APPROVED_PLAN/);
  const mixed = { ...invalid, terminalReadback: "same-source-readonly-subprocess" } as unknown as FirstOpenInstallSequencePlan;
  await assert.rejects(run(mixed, await sha256Hex(mixed)), /APPROVED_PLAN/);
  assert.equal(touches, 0);
});

test("Source confirms only the exact active bucket policy before staging", async () => {
  const policy = { Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"] }] };
  const pin = await sha256Hex(policy), signal = new AbortController().signal;
  let calls = 0;
  const read = async (request: { Bucket?: string; ExpectedBucketOwner?: string }, mark: AbortSignal) => {
    assert.deepEqual(request, { Bucket: FIRST_OPEN_BASELINE_BINDING.bucket, ExpectedBucketOwner: "402010193138" });
    assert.equal(mark, signal);
    calls++;
    return { $metadata: { httpStatusCode: 200, attempts: 1 }, Policy: JSON.stringify(policy) };
  };
  assert.equal(await readFirstOpenSourceProtection(read, pin, signal), pin);
  await assert.rejects(readFirstOpenSourceProtection(read, "d".repeat(64), signal), /SOURCE_PROTECTION_CHANGED/);
  assert.equal(calls, 2);
});

test("a new phase-Source policy cannot reuse a fixed-session approval or terminal credentials", async () => {
  const fixedPlan = { schema: "techlong/fc41597f-install-sequence/v1", terminalReadback: "same-source-readonly-subprocess",
    bucket: { jobId: job, installIntentSha256: intent }, owner: { jobId: job, approvalSha256: intent },
    readback: { release: { jobId: job, approvalSha256: intent } } } as FirstOpenInstallSequencePlan;
  const phasedPlan = { ...fixedPlan, sourceSessionPolicy: firstOpenInstallSourceSessionPolicy } as FirstOpenInstallSequencePlan;
  let touches = 0;
  const noIo = new Proxy({}, { get() { ++touches; throw Error("UNEXPECTED_IO"); } });
  const base = { privateDir: "", signal: new AbortController().signal, source: noIo,
    github: { artifactReadToken: "test_token" } } as Omit<Parameters<typeof runFirstOpenInstallSequence>[0], "plan" | "approvedPlanSha256">;
  const sourceSessions = { async openPhase() { ++touches; throw Error("UNEXPECTED_SOURCE_IO"); } };
  const terminalSourceCredentials = { accessKeyId: "synthetic", secretAccessKey: "synthetic" };
  const run = runFirstOpenInstallSequence;
  await assert.rejects(run({ ...base, plan: phasedPlan, approvedPlanSha256: await sha256Hex(fixedPlan), sourceSessions }), /APPROVED_PLAN/);
  await assert.rejects(run({ ...base, plan: fixedPlan, approvedPlanSha256: await sha256Hex(fixedPlan), sourceSessions,
    terminalSourceCredentials }), /APPROVED_PLAN/);
  await assert.rejects(run({ ...base, plan: phasedPlan, approvedPlanSha256: await sha256Hex(phasedPlan), sourceSessions,
    terminalSourceCredentials }), /APPROVED_PLAN/);
  assert.equal(touches, 0);
});
