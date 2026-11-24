import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { foundationTemplateV5, workerTrustV5 } from "../ops/cloud-worker/install/plan-v5.mjs";
import capsule from "../ops/cloud-worker/material/public-capsule-v5.json" with { type: "json" };
import { firstOpenInstallBucketStack, firstOpenInstallBucketTargets, type FirstOpenInstallBucketPlan } from "../ops/aws-sandbox/first-open-install-bucket-executor.ts";
import { firstOpenOwnerStageKey } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import { bindFirstOpenInstallIndependentBucket, type FirstOpenInstallIndependentBucketPorts } from "../ops/aws-sandbox/first-open-install-independent-bucket.ts";

const { jobId, bucket } = FIRST_OPEN_BASELINE_BINDING, account = "402010193138";
const identify = { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/ExactExternalAuditor/read-only`, UserId: "AROASYNTHETIC:read-only" };
const source = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
const metadata = { httpStatusCode: 200, attempts: 1 }, startAt = Date.UTC(2030, 0, 1), installIntentSha256 = "c".repeat(64);
const signal = new AbortController().signal;

function planFixture(): FirstOpenInstallBucketPlan {
  const original = foundationTemplateV5(capsule), role = original.Resources.WorkerRole.Properties;
  const trust = workerTrustV5("981c3af53a1a40999db715a10304562a69a0c4a3");
  const claim = trust.Statement[0].Condition.StringEquals;
  claim["token.actions.githubusercontent.com:job_workflow_ref"] =
    claim["token.actions.githubusercontent.com:job_workflow_ref"].replace("cloud-worker-job.yml", "cloud-worker-platform-job-v6.yml");
  Object.assign(claim, { "token.actions.githubusercontent.com:actor_id": "344813947" });
  role.AssumeRolePolicyDocument = trust;
  role.Policies[0].PolicyDocument.Statement.find((x: { Action: unknown }) => x.Action === "ecs:DescribeTaskDefinition")!.Resource = "*";
  return { schema: "techlong/fc41597f-install-bucket-retention/v1", jobId, installIntentSha256, ownerReadReceiptSha256: "d".repeat(64),
    factsExpireAt: startAt + 50 * 60_000, original: JSON.parse(JSON.stringify(original)),
    phases: { protect: { startAt, writeBefore: startAt + 60_000 },
      restore: { startAt: startAt + 30 * 60_000, writeBefore: startAt + 31 * 60_000 } },
    stagingTargets: (["shared-predecessor", "provisioner-grant", "provisioner-relock"] as const).map(phase => {
      const targetCanonicalSha256 = (phase === "provisioner-grant" ? "a" : "b").repeat(64);
      return { phase, targetCanonicalSha256, key: firstOpenOwnerStageKey({ phase, targetCanonicalSha256, approvalSha256: installIntentSha256 }),
        targetBytes: phase === "provisioner-grant" ? 80_000 : 70_000 };
    }) };
}
function fixture(options: Partial<{ wrongIdentity: boolean; pending: boolean; wrongPolicy: boolean; wrongTemplate: boolean }> = {}) {
  const plan = planFixture(), targets = firstOpenInstallBucketTargets(plan), calls: string[] = [];
  let now = startAt + 1000, phase: "protect" | "restore" = "protect";
  const forPhase = () => phase === "protect" ? targets.protected : targets.original;
  const name = () => `fc41597f-install-bucket-${installIntentSha256.slice(0, 24)}-${phase}`;
  const ack = () => ({ changeSetId: `arn:aws:cloudformation:ca-central-1:${account}:changeSet/${name()}/00112233-4455-6677-8899-aabbccddeeff`,
    executedAt: plan.phases[phase].startAt + 1, targetSha256: forPhase().canonicalSha256 });
  const ports: FirstOpenInstallIndependentBucketPorts = {
    async identify() { calls.push("sts"); return { ...(options.wrongIdentity ? source : identify), $metadata: metadata }; },
    async describeStack(id) { calls.push("stack"); assert.equal(id, firstOpenInstallBucketStack); return { $metadata: metadata,
      Stacks: [{ StackId: id, StackName: "techlong-sandbox-cloud-worker-foundation-v5", StackStatus: "UPDATE_COMPLETE", CreationTime: new Date(startAt - 1000) }] }; },
    async describeChange(id, changeSetId) {
      calls.push("change"); assert.equal(id, firstOpenInstallBucketStack); assert.equal(changeSetId, ack().changeSetId);
      return { $metadata: metadata, StackId: id, ChangeSetId: changeSetId, ChangeSetName: name(), Status: "CREATE_COMPLETE",
        ExecutionStatus: options.pending ? "AVAILABLE" : "EXECUTE_COMPLETE", Changes: [{ Type: "Resource", ResourceChange: { Action: "Modify",
          ResourceType: "AWS::S3::BucketPolicy", LogicalResourceId: "EvidencePolicy", PhysicalResourceId: bucket, Replacement: "False" } }] };
    },
    async getOriginal(id) { calls.push("original"); assert.equal(id, firstOpenInstallBucketStack); return { $metadata: metadata,
      StagesAvailable: ["Original"], TemplateBody: JSON.stringify(options.wrongTemplate ? targets.original.template : forPhase().template) }; },
    async getBucketPolicy(req) { calls.push("policy"); assert.deepEqual(req, { Bucket: bucket, ExpectedBucketOwner: account });
      return { $metadata: metadata, Policy: JSON.stringify((options.wrongPolicy ? targets.original : forPhase()).template.Resources.EvidencePolicy.Properties.PolicyDocument) }; },
  };
  return { calls, plan, ports, forPhase, ack, clock: () => now, read: bindFirstOpenInstallIndependentBucket({ plan, expectedIdentity: identify, ports, now: () => now }),
    restore() { phase = "restore"; now = plan.phases.restore.startAt + 1000; } };
}

test("one independently verified identity performs four exact reads for each protect/restore ACK", async () => {
  const f = fixture();
  await assert.rejects(f.read.bucket("protect", f.ack(), signal), /PHASE_OR_IDENTITY/);
  assert.deepEqual(await f.read.identify(signal), identify);
  for (const phase of ["protect", "restore"] as const) {
    if (phase === "restore") f.restore();
    const ack = f.ack(), got = await f.read.bucket(phase, ack, signal);
    assert.deepEqual(got, { identity: identify, changeSetId: ack.changeSetId, observedAt: f.plan.phases[phase].startAt + 1000,
      templateSha256: ack.targetSha256, policySha256: await sha256Hex(f.forPhase().template.Resources.EvidencePolicy.Properties.PolicyDocument), matched: true });
    await assert.rejects(f.read.bucket(phase, ack, signal), /PHASE_OR_IDENTITY/);
  }
  assert.deepEqual(f.calls, ["sts", "stack", "change", "original", "policy", "stack", "change", "original", "policy"]);
});

test("terminal restore keeps the same independent checks without a pre-upload policy observation", async () => {
  const f = fixture();
  const read = bindFirstOpenInstallIndependentBucket({ plan: f.plan, expectedIdentity: identify, ports: f.ports,
    now: f.clock, restoreOnly: true });
  await read.identify(signal);
  await assert.rejects(read.bucket("protect", f.ack(), signal), /PHASE_OR_IDENTITY/);
  assert.deepEqual(f.calls, ["sts"]);
  f.restore();
  assert.equal((await read.bucket("restore", f.ack(), signal)).matched, true);
  assert.deepEqual(f.calls, ["sts", "stack", "change", "original", "policy"]);
});

test("same Source is authorized only in explicit restore-only terminal mode", async () => {
  const f = fixture({ wrongIdentity: true });
  const args = { plan: f.plan, expectedIdentity: source, ports: f.ports, now: f.clock };
  assert.throws(() => bindFirstOpenInstallIndependentBucket({ ...args, terminalSourceOnly: true }), /IDENTITY_SCOPE/);
  assert.throws(() => bindFirstOpenInstallIndependentBucket({ ...args, restoreOnly: true }), /IDENTITY_SCOPE/);
  const terminal = bindFirstOpenInstallIndependentBucket({ ...args, terminalSourceOnly: true, restoreOnly: true });
  assert.deepEqual(await terminal.identify(signal), source);
  await assert.rejects(terminal.bucket("protect", f.ack(), signal), /PHASE_OR_IDENTITY/);
  assert.deepEqual(f.calls, ["sts"]);
  f.restore();
  assert.deepEqual((await terminal.bucket("restore", f.ack(), signal)).identity, source);
  assert.deepEqual(f.calls, ["sts", "stack", "change", "original", "policy"]);
});

test("rejects the writer, wrong ACK, nonterminal change, wrong Original and actual policy drift without retry", async () => {
  const badIdentity = fixture({ wrongIdentity: true });
  assert.throws(() => bindFirstOpenInstallIndependentBucket({ plan: badIdentity.plan, expectedIdentity: source, ports: badIdentity.ports }), /IDENTITY_SCOPE/);
  await assert.rejects(badIdentity.read.identify(signal), /IDENTITY_MISMATCH/);
  assert.deepEqual(badIdentity.calls, ["sts"]);
  const badAck = fixture();
  await badAck.read.identify(signal);
  await assert.rejects(badAck.read.bucket("protect", { ...badAck.ack(), targetSha256: "f".repeat(64) }, signal), /ACK_SCOPE/);
  assert.deepEqual(badAck.calls, ["sts"]);
  for (const [option, expected, observed] of [
    ["pending", /CHANGE_SCOPE/, ["sts", "stack", "change"]],
    ["wrongTemplate", /ORIGINAL_TARGET/, ["sts", "stack", "change", "original"]],
    ["wrongPolicy", /POLICY_TARGET/, ["sts", "stack", "change", "original", "policy"]],
  ] as const) {
    const f = fixture({ [option]: true });
    await f.read.identify(signal);
    await assert.rejects(f.read.bucket("protect", f.ack(), signal), expected);
    await assert.rejects(f.read.bucket("protect", f.ack(), signal), /WINDOW_OR_STOPPED/);
    assert.deepEqual(f.calls, observed);
  }
});
