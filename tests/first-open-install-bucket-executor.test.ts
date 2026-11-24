import assert from "node:assert/strict";
import test from "node:test";
import type { DescribeChangeSetCommandOutput } from "@aws-sdk/client-cloudformation";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { foundationTemplateV5, workerTrustV5 } from "../ops/cloud-worker/install/plan-v5.mjs";
import capsule from "../ops/cloud-worker/material/public-capsule-v5.json" with { type: "json" };
import { firstOpenOwnerStageKey } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import { bindFirstOpenInstallBucketExecutor, firstOpenInstallBucketTargets, firstOpenInstallBucketStack, firstOpenInstallBucketLimits,
  type FirstOpenInstallBucketPlan, type FirstOpenInstallBucketPorts, type FirstOpenInstallBucketJournal } from "../ops/aws-sandbox/first-open-install-bucket-executor.ts";

const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const oldTemplate = "a2133a1b68792fe124bc0c816ca920baa28751f2f278057f495524d08593bcf6";
const oldPolicy = "818a51232d0ecb8fa6d8f6f548b1465e72101be305225b0829e3555bf7dbaf1a";
const baseTime = Date.parse("2026-11-24T14:19:00Z"), installIntentSha256 = "a".repeat(64);

// Reproduce the pinned Original from the checked-in foundation generator,
// then apply the two previously published WorkerRole-only revisions. No
// private template at test time, no alternate baseline hook in production.
function original() {
  const t = foundationTemplateV5(capsule), role = t.Resources.WorkerRole.Properties;
  const trust = workerTrustV5("981c3af53a1a40999db715a10304562a69a0c4a3");
  const claim = trust.Statement[0].Condition.StringEquals;
  claim["token.actions.githubusercontent.com:job_workflow_ref"] =
    claim["token.actions.githubusercontent.com:job_workflow_ref"].replace("cloud-worker-job.yml", "cloud-worker-platform-job-v6.yml");
  Object.assign(claim, { "token.actions.githubusercontent.com:actor_id": "344813947" });
  role.AssumeRolePolicyDocument = trust;
  const descriptor = role.Policies[0].PolicyDocument.Statement.find((x: { Action: unknown }) => x.Action === "ecs:DescribeTaskDefinition")!;
  descriptor.Resource = "*";
  return JSON.parse(JSON.stringify(t)) as object;
}
function planFixture(): FirstOpenInstallBucketPlan {
  return { schema: "techlong/fc41597f-install-bucket-retention/v1", jobId, installIntentSha256,
    ownerReadReceiptSha256: "e".repeat(64), factsExpireAt: baseTime + 50 * 60_000, original: original(),
    phases: { protect: { startAt: baseTime, writeBefore: baseTime + 60_000 },
      restore: { startAt: baseTime + 30 * 60_000, writeBefore: baseTime + 31 * 60_000 } },
    stagingTargets: (["shared-predecessor", "provisioner-grant", "provisioner-relock"] as const).map(phase => {
      const targetCanonicalSha256 = (phase === "provisioner-grant" ? "b" : "c").repeat(64);
      return { phase, targetCanonicalSha256, key: firstOpenOwnerStageKey({ approvalSha256: installIntentSha256, phase, targetCanonicalSha256 }),
        targetBytes: phase === "provisioner-grant" ? 84_705 : 71_937 };
    }) };
}
const meta = { httpStatusCode: 200 }, prefix = "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/";
function setup(opt: { pending?: boolean; replacement?: boolean; previewWrong?: boolean; unknown?: boolean;
  finalWrong?: boolean; denyPrerequisite?: boolean } = {}) {
  const plan = planFixture(), t = firstOpenInstallBucketTargets(plan);
  let at = baseTime + 1, lastUpdate = baseTime - 1000, current = t.original.template, pending = t.original.template;
  let name = "", id = "", executed = false, observerClosed = false;
  const calls: string[] = [], events: string[] = [], slots = new Set<string>();
  const key = () => { assert.equal(id, `${prefix}${name}/00112233-4455-6677-8899-aabbccddeeff`); };
  const ports: FirstOpenInstallBucketPorts = {
    async identify() { calls.push("sts"); return { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
      UserId: "AIDAV3GNMXTZEO7SHLC2X", $metadata: meta }; },
    async describeStack(stack) { calls.push("stack"); assert.equal(stack, firstOpenInstallBucketStack); return { $metadata: meta, Stacks: [{
      StackName: "techlong-sandbox-cloud-worker-foundation-v5", StackId: stack, CreationTime: new Date(baseTime - 2000),
      LastUpdatedTime: new Date(lastUpdate), StackStatus: "UPDATE_COMPLETE", Tags: [{ Key: "Name", Value: "proof" }],
    }] }; },
    async getOriginal(stack) { calls.push("original"); assert.equal(stack, firstOpenInstallBucketStack);
      return { $metadata: meta, StagesAvailable: ["Original"], TemplateBody: JSON.stringify(opt.finalWrong && executed ? t.original.template : current) }; },
    async listChangeSets(stack) { calls.push("list"); assert.equal(stack, firstOpenInstallBucketStack);
      return { $metadata: meta, Summaries: opt.pending ? [{ Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE" }] : [] }; },
    async create(args) { calls.push("create"); assert.equal(args.StackName, firstOpenInstallBucketStack);
      assert.equal(args.ChangeSetType, "UPDATE"); assert.equal(args.TemplateURL, undefined); assert.equal(args.RoleARN, undefined);
      assert.deepEqual(args.Tags, [{ Key: "Name", Value: "proof" }]); assert.deepEqual(args.Capabilities, ["CAPABILITY_NAMED_IAM"]);
      name = args.ChangeSetName!; id = `${prefix}${name}/00112233-4455-6677-8899-aabbccddeeff`;
      pending = JSON.parse(args.TemplateBody!); executed = false;
      return { $metadata: meta, Id: id, StackId: args.StackName }; },
    async describeChange(stack, change): Promise<DescribeChangeSetCommandOutput> { calls.push("change"); assert.equal(stack, firstOpenInstallBucketStack);
      key(); assert.equal(change, id); return { $metadata: meta, StackId: stack, ChangeSetId: id, ChangeSetName: name, Status: "CREATE_COMPLETE",
        ExecutionStatus: executed ? "EXECUTE_COMPLETE" : "AVAILABLE", Capabilities: ["CAPABILITY_NAMED_IAM"],
        Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify", LogicalResourceId: "EvidencePolicy", ResourceType: "AWS::S3::BucketPolicy",
          PhysicalResourceId: bucket, Scope: ["Properties"], Replacement: opt.replacement ? "Conditional" : "False",
          Details: [{ Target: { Attribute: "Properties", Name: "PolicyDocument", RequiresRecreation: "Never" } }] } }],
      }; },
    async getChangeSetOriginal(stack, change) { calls.push("preview"); assert.equal(stack, firstOpenInstallBucketStack); assert.equal(change, id);
      return { $metadata: meta, StagesAvailable: ["Original"], TemplateBody: JSON.stringify(opt.previewWrong ? current : pending) }; },
    async execute(args) { calls.push("execute"); key(); assert.equal(args.ChangeSetName, id); assert.equal(args.DisableRollback, false);
      if (opt.unknown) throw new Error("lost ACK");
      executed = true; current = pending; lastUpdate = ++at; return { $metadata: meta }; },
  };
  const journal: FirstOpenInstallBucketJournal = {
    async consume(slot) { assert.ok(!slots.has(slot)); slots.add(slot); events.push("slot"); },
    async record(slot, e) { assert.ok(slots.has(slot)); events.push(e.kind); },
    async requirePrerequisite(b) { events.push(b.prerequisite); assert.equal(b.ownerReadReceiptSha256, plan.ownerReadReceiptSha256);
      assert.equal(b.targetPolicyOrdinalSha256, b.phase === "protect" ? t.protected.policyOrdinalSha256 : oldPolicy);
      assert.ok(!opt.denyPrerequisite && (b.phase !== "restore" || observerClosed), "independent evidence required"); },
  };
  return { plan, ports, journal, now: () => at, wait: async () => { at += 5000; }, calls, events, t,
    atRestore: (proved: boolean) => { at = plan.phases.restore.startAt + 1; observerClosed = proved; } };
}
const signal = () => new AbortController().signal;
const bind = async (f: ReturnType<typeof setup>) => bindFirstOpenInstallBucketExecutor({ ...f, approvedPlanSha256: await sha256Hex(f.plan) });

test("the known original yields exactly one unconditional deny for three exact canonical stage objects", () => {
  const plan = planFixture(), t = firstOpenInstallBucketTargets(plan);
  assert.equal(t.original.canonicalSha256, oldTemplate);
  assert.equal(t.original.policyOrdinalSha256, oldPolicy);
  assert.notEqual(t.protected.policyOrdinalSha256, oldPolicy);
  const r = structuredClone(t.protected.template);
  const policy = r.Resources.EvidencePolicy.Properties.PolicyDocument as { Statement: unknown[] };
  assert.deepEqual(policy.Statement.pop(), { Sid: "ProtectFc41597InstallStageVersions", Effect: "Deny", Principal: "*",
    Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"], Resource: plan.stagingTargets.map(x => `arn:aws:s3:::${bucket}/${x.key}`).sort() });
  assert.deepEqual(r, t.original.template);
  assert.throws(() => firstOpenInstallBucketTargets({ ...plan, original: { ...plan.original, Description: "wrong" } }), /ORIGINAL_PIN/);
  const bad = structuredClone(plan); bad.stagingTargets[0].key += "?versionId=attacker";
  assert.throws(() => firstOpenInstallBucketTargets(bad), /STAGE_KEYS/);
});

test("Source can protect and restore once with a separate trusted prerequisite, then returns only Source terminal ACKs", async () => {
  const f = setup(), run = await bind(f), p = await run("protect", signal());
  assert.equal(p.status, "BUCKET_OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
  assert.equal(p.executeAck.targetCanonicalSha256, f.t.protected.canonicalSha256);
  assert.deepEqual(f.events.slice(0, 2), ["verified-original-owner-and-bucket", "slot"]);
  assert.ok(f.calls.indexOf("preview") < f.calls.indexOf("execute"));
  assert.ok(Object.entries(p.calls).every(([name, count]) => count <= firstOpenInstallBucketLimits[name as keyof typeof p.calls]));
  f.atRestore(true);
  const r = await run("restore", signal());
  assert.equal(r.executeAck.targetCanonicalSha256, oldTemplate);
  assert.equal(f.calls.filter(x => x === "sts").length, 1);
  assert.equal(f.calls.filter(x => x === "execute").length, 2);
  assert.ok(f.events.includes("verified-active-bucket-retention-and-dependent-stage-closure"));
  await assert.rejects(run("restore", signal()), /PHASE_NOT_BOUND_OR_USED/);
});

test("pending, replacement, forged/missing preview and missing independent prerequisites stop before Execute", async () => {
  for (const [flags, expected] of [[{ pending: true }, /PENDING_OR_UNKNOWN_CHANGE/], [{ replacement: true }, /CHANGE_DIFF/],
    [{ previewWrong: true }, /ORIGINAL_MISMATCH/], [{ denyPrerequisite: true }, /independent evidence required/]] as const) {
    const f = setup(flags), run = await bind(f);
    await assert.rejects(run("protect", signal()), expected);
    assert.ok(!f.calls.includes("execute"));
    if ("denyPrerequisite" in flags) assert.equal(f.calls.length, 0);
  }
  const f = setup(), run = await bind(f);
  await run("protect", signal());
  f.atRestore(false);
  const n = f.calls.length;
  await assert.rejects(run("restore", signal()), /independent evidence required/);
  assert.equal(f.calls.length, n);
});

test("ambiguous Execute or wrong terminal Original is never retried or reported verified", async () => {
  for (const [flags, expected] of [[{ unknown: true }, /EXECUTE_UNKNOWN_NO_RETRY/], [{ finalWrong: true }, /ORIGINAL_MISMATCH/]] as const) {
    const f = setup(flags), run = await bind(f);
    await assert.rejects(run("protect", signal()), expected);
    await assert.rejects(run("protect", signal()), /PHASE_NOT_BOUND_OR_USED/);
    assert.equal(f.calls.filter(x => x === "execute").length, 1);
    assert.ok(f.events.includes("execute-intent"));
    assert.ok(!f.events.includes("terminal-observed"));
  }
});

test("a wrong review SHA, stale facts or unopened phase cannot consume a slot", async () => {
  const f = setup();
  await assert.rejects(bindFirstOpenInstallBucketExecutor({ ...f, approvedPlanSha256: "f".repeat(64) }), /INSTALL_BUCKET_PLAN/);
  const stale = { ...f.plan, factsExpireAt: f.plan.phases.restore.writeBefore - 1 };
  await assert.rejects(bindFirstOpenInstallBucketExecutor({ ...f, plan: stale, approvedPlanSha256: await sha256Hex(stale) }), /INSTALL_BUCKET_PLAN/);
  const run = await bind(f);
  await assert.rejects(run("restore", signal()), /PHASE_WINDOW/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.calls, []);
});
