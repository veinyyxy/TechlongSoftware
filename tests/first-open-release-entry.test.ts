import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { CloudFormationClient, DescribeChangeSetCommand, DescribeStacksCommand, GetTemplateCommand } from "@aws-sdk/client-cloudformation";
import { GetPolicyCommand, GetPolicyVersionCommand, GetRoleCommand, GetRolePolicyCommand, IAMClient,
  ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from "@aws-sdk/client-iam";
import { GetBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import test from "node:test";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { bindFirstOpenReleaseEntry, firstOpenReleasePairSha256, firstOpenReleaseTransport, renderLockedFirstOpenCaller,
  renderLockedFirstOpenJob, type FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import { firstOpenInspectorAuthorityReadScope, firstOpenInspectorAuthorityReadStatements,
  firstOpenInspectorReadScope, firstOpenInspectorReadStatements } from "../ops/aws-sandbox/first-open-inspector-iam.ts";
import { firstOpenGitHubAuthorityArtifacts } from "../ops/aws-sandbox/first-open-github-handoff.ts";
import { firstOpenVersionAuthorityScope } from "../ops/aws-sandbox/first-open-controlled-cfn.ts";
import { offlineHandoffArtifactName, offlineHandoffTitle } from "../ops/aws-sandbox/first-open-oidc-offline.ts";
import { bindFirstOpenInspectorAuthorityReadback } from "../ops/aws-sandbox/first-open-inspector-authority-readback.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const repo = "veinyyxy/TechlongSoftware";
const { load } = createRequire(import.meta.url)("js-yaml") as { load(source: string): unknown };
const inspectPath = ".github/workflows/sandbox-first-open-inspect-job-v1.yml";
const runOncePath = ".github/workflows/sandbox-first-open-run-once-job-v1.yml";
const managementPath = ".github/workflows/sandbox-first-open-management-job-v1.yml";
const startAt = Date.UTC(2030, 0, 1);
const record = (): FirstOpenFrozenRelease => ({
  schema: "techlong/sandbox-first-open-release/v1", jobId: "job_fc41597f9b5ba8e02b338ecf",
  approvalSha256: "a".repeat(64), runtimeSourceSha256: "b".repeat(64), inspectorSeedSha256: "c".repeat(64),
  callerCommit: "a".repeat(40), runtimeCommit: "b".repeat(40),
  inspectReusableCommit: "c".repeat(40), runOnceReusableCommit: "d".repeat(40),
  managementReusableCommit: "e".repeat(40),
  actorId: "14145707", workflowId: "808", nonce: "d".repeat(32),
  startAt, claimBefore: startAt + 60_000, applicationLoginBefore: startAt + 600_000,
  writeBefore: startAt + 900_000, completionReserveMs: 60_000,
  phaseCutoffs: [30, 70, 200, 700, 800].map(x => startAt + x * 1_000) as FirstOpenFrozenRelease["phaseCutoffs"],
});

async function fixture(p = record()) {
  const trusted = await sha256Hex(p), inspect = `${repo}/${inspectPath}@${p.inspectReusableCommit}`;
  const runOnce = `${repo}/${runOncePath}@${p.runOnceReusableCommit}`;
  const pairSha256 = await sha256Hex({ domain: "techlong/sandbox-first-open-pair/v1", jobId: p.jobId,
    approvalSha256: p.approvalSha256, callerCommitSha: p.callerCommit, runtimeCommitSha: p.runtimeCommit,
    runOnceReusableRef: runOnce, inspectReusableRef: inspect, managementReusableRef: `${repo}/${managementPath}@${p.managementReusableCommit}`,
    pairNonce: p.nonce, approvedWindowSha256: trusted });
  return { p, trusted, actual: { role: "inspect" as const, ownRunId: "101", inspectId: "101", runOnceId: "102", attempt: 1,
    repository: repo, ref: "refs/heads/main", workflowId: p.workflowId, actorId: p.actorId,
    callerCommit: p.callerCommit, runtimeCommit: p.runtimeCommit, runtimeSourceSha256: p.runtimeSourceSha256,
    reusableRef: inspect, pairSha256, inspectorSessionArnSha256: "d".repeat(64) } };
}

test("the frozen five deadlines and independent seed digest drive the actual transport", async () => {
  const { p, trusted, actual } = await fixture();
  let activity = 0;
  const frozen = await firstOpenReleaseTransport(p, trusted, actual, { token: "synthetic_only", now: () => p.phaseCutoffs[0],
    fetch: async () => { activity++; throw Error("no network expected"); },
    uploadOwn: async () => { activity++; throw Error("no upload expected"); } });
  assert.deepEqual(frozen.pair.phaseCutoffs, p.phaseCutoffs);
  assert.equal(frozen.inspectorSeedSha256, p.inspectorSeedSha256);
  await assert.rejects(frozen.wire.emit("01-inspector-ready", {}, new AbortController().signal), /PHASE_SCOPE/);
  assert.equal(activity, 0);
  const changed = structuredClone(p);
  changed.phaseCutoffs[2] += 1;
  await assert.rejects(bindFirstOpenReleaseEntry(changed, trusted, actual), /SEAL_OR_WINDOW/);
  changed.phaseCutoffs = [...p.phaseCutoffs];
  changed.inspectorSeedSha256 = "f".repeat(64);
  await assert.rejects(bindFirstOpenReleaseEntry(changed, trusted, actual), /SEAL_OR_WINDOW/);
});

test("split formal launches with the same install intent cannot mix peers", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted, actual } = await fixture({ ...record(), taskRelease,
    lifecycleAuthoritySchedule: { grantNotBefore: startAt + 650_000, relockNotBefore: startAt + 750_000 } });
  const approvedLaunchSha256 = "c".repeat(64), rotatedLaunchSha = "d".repeat(64);
  const pairSha256 = await firstOpenReleasePairSha256(p, trusted, approvedLaunchSha256);
  assert.notEqual(pairSha256, actual.pairSha256);
  assert.notEqual(pairSha256, await firstOpenReleasePairSha256(p, trusted, rotatedLaunchSha));
  const admitted = { ...actual, approvedLaunchSha256, pairSha256 };
  assert.equal((await bindFirstOpenReleaseEntry(p, trusted, admitted)).pair.pairSha256, pairSha256);
  await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, { ...admitted, approvedLaunchSha256: rotatedLaunchSha }), /RUN_COORDINATES/);
  await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, { ...admitted, approvedLaunchSha256: undefined }), /RUN_COORDINATES/);
});

test("Inspector authority-only permission adds no writes and scopes CFN Change Sets to two exact names", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted } = await fixture({ ...record(), taskRelease });
  const scoped = firstOpenInspectorAuthorityReadScope(p, trusted), sha = await sha256Hex(scoped);
  const statements = await firstOpenInspectorAuthorityReadStatements(p, trusted, { reviewedScope: scoped, approvedScopeSha256: sha });
  assert.deepEqual(statements.map(s => s.Action), [
    ["iam:GetRole", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:GetRolePolicy"],
    ["iam:GetPolicy", "iam:GetPolicyVersion"], ["s3:GetBucketPolicy"],
    ["cloudformation:DescribeStacks", "cloudformation:GetTemplate"], ["cloudformation:DescribeChangeSet"],
  ]);
  assert.ok(statements.flatMap(s => s.Resource).every(s => !s.includes("*")));
  assert.equal(scoped.roles.length, 3);
  assert.deepEqual(scoped.changeSetNames, ["fc41597f-cfn-version-" + "a".repeat(24) + "-grant", "fc41597f-cfn-version-" + "a".repeat(24) + "-relock"]);
  assert.deepEqual(statements[4].Condition.StringEquals["cloudformation:ChangeSetName"], [...scoped.changeSetNames, ...scoped.provisionerChangeSetNames]);
  await assert.rejects(firstOpenInspectorAuthorityReadStatements(p, trusted,
    { reviewedScope: { ...scoped, roles: ["*"] } as unknown as typeof scoped, approvedScopeSha256: sha }), /AUTHORITY_CONSENT_SCOPE/);
});

test("Management accepts only the same fixed version from the exact still-running Inspector artifact", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted, actual } = await fixture({ ...record(), taskRelease,
    lifecycleAuthoritySchedule: { grantNotBefore: startAt + 650_000, relockNotBefore: startAt + 750_000 } });
  const { pair } = await bindFirstOpenReleaseEntry(p, trusted, actual);
  const sourceSha256 = "e".repeat(64), at = startAt + 350_000, submitBefore = p.phaseCutoffs[3], kind = "cfn-version-observed";
  const scope = firstOpenVersionAuthorityScope({ approvalSha256: p.approvalSha256, sourceSha256, runId: pair.runOnceId,
    operationSha256: "b".repeat(64), requestSha256: "c".repeat(64), putAcknowledgedAt: at - 10,
    versionId: "fixed+existing/=", templateSha256: "d".repeat(64), submitBefore });
  const receipt = { schema: "techlong/fc41597f-exact-cfn-version-authority/v2", scopeSha256: await sha256Hex(scope),
    policySha256: "f".repeat(64), checkedAt: at, expiresAt: submitBefore,
    evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS" };
  const run = { id: pair.inspectId, workflow_id: pair.workflowId, run_attempt: 1, event: "workflow_dispatch",
    path: ".github/workflows/sandbox-first-open-v1.yml", head_branch: "main", head_sha: pair.callerCommit,
    repository: { full_name: repo, id: "1323312747", owner: { id: pair.actorId } }, head_repository: { id: "1323312747" },
    actor: { id: pair.actorId }, triggering_actor: { id: pair.actorId }, display_title: offlineHandoffTitle(pair, false),
    status: "in_progress", conclusion: null, referenced_workflows: [{ path: actual.reusableRef, sha: p.inspectReusableCommit }] };
  function make(variant = "") {
    const body = { schema: "techlong/fc41597f-authority-artifact/v1", kind, jobId: p.jobId, pairSha256: pair.pairSha256,
      approvalSha256: pair.approvalSha256, runOnceId: pair.runOnceId, inspectId: pair.inspectId, sourceSha256,
      producerAttempt: 1, producerSourceSha256: pair.runtimeSourceSha256, producedAt: at, payload: receipt };
    const zip = zipSync({ "handoff.json": Buffer.from(canonicalJson(body)) });
    const artifact = { id: "301", name: offlineHandoffArtifactName(pair.pairSha256, kind), expired: false,
      created_at: new Date(at).toISOString(), expires_at: new Date(at + 10_000).toISOString(), size_in_bytes: zip.length,
      digest: "sha256:" + createHash("sha256").update(variant === "badZip" ? Buffer.alloc(1) : zip).digest("hex"),
      archive_download_url: `https://api.github.com/repos/${repo}/actions/artifacts/301/zip`,
      workflow_run: { id: variant === "wrongArtifactRun" ? pair.runOnceId : pair.inspectId, repository_id: "1323312747",
        head_repository_id: "1323312747", head_sha: pair.callerCommit, head_branch: "main" } };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "test.blob.core.windows.net") {
        assert.equal(new Headers(init?.headers).has("Authorization"), false);
        return new Response(Buffer.from(zip));
      }
      assert.equal(url.hostname, "api.github.com");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic_only");
      if (url.pathname.endsWith("/zip")) return new Response(null, { status: 302, headers: { location: "https://test.blob.core.windows.net/artifact" } });
      if (url.pathname.endsWith("/artifacts")) return Response.json({ total_count: 1, artifacts: [artifact] });
      return Response.json({ ...run, ...(variant === "complete" && { status: "completed" }),
        ...(variant === "wrongReusable" && { referenced_workflows: [] }) });
    };
    return firstOpenGitHubAuthorityArtifacts({ pair, role: "management", ownRunId: pair.runOnceId, sourceSha256, submitBefore,
      inspectReusableCommit: p.inspectReusableCommit, runOnceReusableCommit: p.runOnceReusableCommit,
      token: "synthetic_only", fetch: fetcher, now: () => at });
  }
  const ctrl = new AbortController().signal, handoff = make();
  assert.deepEqual(await handoff.readVerified(scope, ctrl), receipt);
  await assert.rejects(handoff.readVerified(scope, ctrl), /SEQUENCE/);
  await assert.rejects(make().publishVerified(receipt, ctrl), /SEQUENCE/);
  await assert.rejects(make().readVerified({ ...scope, versionId: "another-version" }, ctrl), /BINDING/);
  await assert.rejects(make("wrongArtifactRun").readVerified(scope, ctrl), /ARTIFACT_PROVENANCE/);
  await assert.rejects(make("wrongReusable").readVerified(scope, ctrl), /AUTHORITY_REUSABLE/);
  await assert.rejects(make("complete").readVerified(scope, ctrl), /PRODUCER_RUN/);
  await assert.rejects(make("badZip").readVerified(scope, ctrl), /ZIP_DIGEST/);
});

test("Inspector reads only bound metadata, rejects a repeat and cannot turn the snapshot into authorization", async t => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted } = await fixture({ ...record(), taskRelease });
  const scope = firstOpenInspectorAuthorityReadScope(p, trusted), at = startAt + 350_000;
  const allowed = [scope.boundaries[0], scope.boundaries[1], scope.boundaries[3]], counts = { iam: 0, cfn: 0, s3: 0 };
  const template = { Resources: {} };
  const ctrl = new AbortController().signal;
  t.mock.method(IAMClient.prototype, "send", async (command: unknown) => {
    counts.iam++;
    if (command instanceof GetRoleCommand) {
      const index = scope.roles.findIndex(x => x.endsWith("/" + command.input.RoleName));
      assert.ok(index >= 0);
      return { Role: { Arn: scope.roles[index], RoleId: scope.roleIds[index],
        PermissionsBoundary: { PermissionsBoundaryArn: allowed[index] }, AssumeRolePolicyDocument: "{}" } };
    }
    if (command instanceof ListAttachedRolePoliciesCommand || command instanceof ListRolePoliciesCommand) {
      assert.ok(scope.roles.some(x => x.endsWith("/" + command.input.RoleName)));
      return { IsTruncated: false };
    }
    if (command instanceof GetPolicyCommand) {
      assert.ok(allowed.includes(command.input.PolicyArn!));
      return { Policy: { Arn: command.input.PolicyArn, PolicyId: "fixture", DefaultVersionId: "v1" } };
    }
    if (command instanceof GetPolicyVersionCommand) {
      assert.ok(allowed.includes(command.input.PolicyArn!));
      assert.equal(command.input.VersionId, "v1");
      return { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: "%7B%7D" } };
    }
    return assert.fail("out-of-scope IAM call");
  });
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    counts.s3++;
    assert.ok(command instanceof GetBucketPolicyCommand);
    assert.equal(command.input.Bucket, scope.evidenceBucketArn.slice("arn:aws:s3:::".length));
    return { Policy: "{}" };
  });
  t.mock.method(CloudFormationClient.prototype, "send", async (command: unknown) => {
    counts.cfn++;
    assert.ok(command instanceof DescribeStacksCommand || command instanceof DescribeChangeSetCommand || command instanceof GetTemplateCommand);
    assert.equal(command.input.StackName, scope.ownerStackArn);
    if (command instanceof DescribeStacksCommand) return { Stacks: [{ StackId: scope.ownerStackArn, StackStatus: "UPDATE_COMPLETE" }] };
    if (command instanceof GetTemplateCommand) return { TemplateBody: JSON.stringify(template) };
    assert.equal(command.input.ChangeSetName, scope.changeSetNames[0]);
    return { StackId: scope.ownerStackArn, ChangeSetId: "fixture", ChangeSetName: scope.changeSetNames[0], Changes: [],
      Status: "CREATE_COMPLETE", ExecutionStatus: "EXECUTE_COMPLETE" };
  });
  const read = await bindFirstOpenInspectorAuthorityReadback({ release: p, releaseSha256: trusted,
    consent: { reviewedScope: scope, approvedScopeSha256: await sha256Hex(scope) },
    async credentials() { return { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture" }; } }, () => at);
  const ack = await read("grant", [[], [], []], ctrl);
  assert.equal(ack.authorizationProved, false);
  assert.equal(ack.ownerStackOriginalSha256, await sha256Hex(template));
  await assert.rejects(read("grant", [[], [], []], ctrl), /UNPROVED/);
  assert.deepEqual(counts, { iam: 15, cfn: 3, s3: 1 });
});

test("Provisioner Inspector uses exactly ten metadata calls per phase and stops on other policies before reading documents", async t => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted } = await fixture({ ...record(), taskRelease });
  const scope = firstOpenInspectorAuthorityReadScope(p, trusted), boundary = scope.boundaries[0], other = scope.boundaries[1];
  const grantName = "FirstOpenFc41597fWriterFence", lockName = "FirstOpenFc41597fWriterLock";
  const ctrl = new AbortController().signal, calls: string[] = [];
  let boundaryArn = boundary, attached: string[] = [boundary], inline = [grantName], name = grantName, phase = 0, credentials = 0;
  const roleName = scope.roles[0].split("/").at(-1);
  t.mock.method(IAMClient.prototype, "send", async (command: unknown) => {
    if (command instanceof GetRoleCommand) {
      calls.push("role"); assert.equal(command.input.RoleName, roleName);
      return { Role: { Arn: scope.roles[0], RoleId: scope.roleIds[0],
        PermissionsBoundary: { PermissionsBoundaryArn: boundaryArn }, AssumeRolePolicyDocument: "{}" } };
    }
    if (command instanceof ListRolePoliciesCommand) {
      calls.push("inline"); assert.equal(command.input.RoleName, roleName);
      return { IsTruncated: false, PolicyNames: inline };
    }
    if (command instanceof ListAttachedRolePoliciesCommand) {
      calls.push("attached"); assert.equal(command.input.RoleName, roleName);
      return { IsTruncated: false, AttachedPolicies: attached.map(PolicyArn => ({ PolicyArn })) };
    }
    if (command instanceof GetRolePolicyCommand) {
      calls.push("inline-document");
      assert.deepEqual(command.input, { RoleName: roleName, PolicyName: name });
      return { ...command.input, PolicyDocument: "{}" };
    }
    if (command instanceof GetPolicyCommand) {
      calls.push("default-policy"); assert.equal(command.input.PolicyArn, boundary);
      return { Policy: { Arn: boundary, PolicyId: "fixture", DefaultVersionId: "v6" } };
    }
    if (command instanceof GetPolicyVersionCommand) {
      calls.push("default-version"); assert.deepEqual(command.input, { PolicyArn: boundary, VersionId: "v6" });
      return { PolicyVersion: { VersionId: "v6", IsDefaultVersion: true, Document: "{}" } };
    }
    return assert.fail("unexpected IAM request");
  });
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    calls.push("bucket-policy"); assert.ok(command instanceof GetBucketPolicyCommand);
    assert.equal(command.input.Bucket, scope.evidenceBucketArn.slice("arn:aws:s3:::".length));
    return { Policy: "{}" };
  });
  t.mock.method(CloudFormationClient.prototype, "send", async (command: unknown) => {
    assert.ok(command instanceof DescribeStacksCommand || command instanceof DescribeChangeSetCommand || command instanceof GetTemplateCommand);
    assert.equal(command.input.StackName, scope.ownerStackArn);
    if (command instanceof DescribeStacksCommand) {
      calls.push("stack"); return { Stacks: [{ StackId: scope.ownerStackArn, StackStatus: "UPDATE_COMPLETE" }] };
    }
    if (command instanceof GetTemplateCommand) {
      calls.push("original"); assert.equal(command.input.TemplateStage, "Original");
      return { TemplateBody: "{}" };
    }
    calls.push("change-set"); assert.equal(command.input.ChangeSetName, scope.provisionerChangeSetNames[phase]);
    return { StackId: scope.ownerStackArn, ChangeSetId: "fixture", ChangeSetName: scope.provisionerChangeSetNames[phase], Changes: [],
      Status: "CREATE_COMPLETE", ExecutionStatus: "EXECUTE_COMPLETE" };
  });
  const consent = { reviewedScope: scope, approvedScopeSha256: await sha256Hex(scope) };
  const bind = () => bindFirstOpenInspectorAuthorityReadback({ release: p, releaseSha256: trusted, target: "provisioner", consent,
    async credentials() { credentials++; return { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture" }; } },
  () => startAt + 1000);
  const first = await bind();
  for (const expected of [[], [lockName], [grantName, "extra"]]) await assert.rejects(first("grant", [expected], ctrl), /UNPROVED/);
  assert.equal(credentials, 0);
  assert.deepEqual(calls, []);
  for (const drift of [
    { boundary, attached: [boundary, other], inline: [grantName] },
    { boundary: other, attached: [other], inline: [grantName] },
    { boundary, attached: [other], inline: [grantName] },
    { boundary, attached: [], inline: [grantName] },
    { boundary, attached: [boundary], inline: [grantName, "extra"] },
  ]) {
    boundaryArn = drift.boundary; attached = drift.attached; inline = drift.inline;
    const read = await bind();
    await assert.rejects(read("grant", [[grantName]], ctrl), /UNPROVED/);
    assert.deepEqual(calls.splice(0), ["role", "inline", "attached"]);
    await assert.rejects(read("grant", [[grantName]], ctrl), /UNPROVED/);
    assert.deepEqual(calls, []);
  }
  boundaryArn = boundary; attached = [boundary]; inline = [grantName];
  const expected = ["role", "inline", "attached", "inline-document", "default-policy", "default-version",
    "bucket-policy", "stack", "change-set", "original"];
  assert.equal((await first("grant", [[grantName]], ctrl)).authorizationProved, false);
  assert.deepEqual(calls.splice(0), expected);
  phase = 1; name = lockName; inline = [lockName];
  assert.equal((await first("relock", [[lockName]], ctrl)).authorizationProved, false);
  assert.deepEqual(calls, expected);
});

test("replacement approval, paired release and Inspector consent bind only the same task's manifest", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { p, trusted, actual } = await fixture({ ...record(), taskRelease,
    lifecycleAuthoritySchedule: { grantNotBefore: startAt + 650_000, relockNotBefore: startAt + 750_000 } });
  let activity = 0;
  const bound = await firstOpenReleaseTransport(p, trusted, actual, { token: "synthetic_only",
    fetch: async () => { activity++; throw Error("no network expected"); },
    uploadOwn: async () => { activity++; throw Error("no upload expected"); } });
  assert.deepEqual(bound.pair.taskRelease, taskRelease);
  const args = [p.approvalSha256, p.startAt, p.claimBefore, p.writeBefore] as const;
  bound.wire.requireApproval(...args, taskRelease);
  assert.throws(() => bound.wire.requireApproval(...args), /APPROVAL_TASK_RELEASE/);
  assert.throws(() => bound.wire.requireApproval(...args, { ...taskRelease,
    image: { ...taskRelease.image, verificationSha256: "0".repeat(64) } }), /APPROVAL_TASK_RELEASE/);
  const consent = firstOpenInspectorReadScope(p, trusted);
  assert.equal(consent.manifest.requestDigest, taskRelease.image.manifestDigest);
  const old = firstOpenInspectorReadScope(record(), trusted);
  await assert.rejects(firstOpenInspectorReadStatements(p, trusted, { reviewedScope: old, approvedScopeSha256: await sha256Hex(old) }),
    /METADATA_CONSENT_SCOPE/);
  const changed = structuredClone(p);
  changed.taskRelease!.image.verificationSha256 = "1".repeat(64);
  const other = await fixture(changed);
  await assert.rejects(bindFirstOpenReleaseEntry(changed, other.trusted, other.actual), /TASK_PROOF_DIGEST/);
  assert.equal(activity, 0);
});

test("formal releases cannot bind a missing or out-of-phase Lifecycle observation schedule even with a matching hash", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const formal = { ...record(), taskRelease }, valid = { grantNotBefore: startAt + 650_000, relockNotBefore: startAt + 750_000 };
  for (const lifecycleAuthoritySchedule of [undefined, { ...valid, grantNotBefore: formal.phaseCutoffs[2] },
    { ...valid, grantNotBefore: formal.phaseCutoffs[3] }, { ...valid, relockNotBefore: formal.phaseCutoffs[3] },
    { ...valid, relockNotBefore: formal.phaseCutoffs[4] }]) {
    const { p, trusted, actual } = await fixture({ ...formal, lifecycleAuthoritySchedule });
    await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, actual), /LIFECYCLE_AUTHORITY_WINDOW/);
  }
});

test("invalid intervals, taken reserves and wrong run identity fail even with well-formed commits", async () => {
  for (const edit of [(p: FirstOpenFrozenRelease) => p.phaseCutoffs[0] = p.claimBefore + 1,
    (p: FirstOpenFrozenRelease) => p.phaseCutoffs[2] = p.applicationLoginBefore,
    (p: FirstOpenFrozenRelease) => p.phaseCutoffs[4] = p.writeBefore - p.completionReserveMs + 1,
    (p: FirstOpenFrozenRelease) => p.phaseCutoffs[3] = p.phaseCutoffs[2]]) {
    const p = record(); edit(p);
    const { trusted, actual } = await fixture(p);
    await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, actual), /SEAL_OR_WINDOW/);
  }
  const { p, trusted, actual } = await fixture();
  for (const change of [{ attempt: 2 }, { ownRunId: "102" }, { reusableRef: `${repo}/${runOncePath}@${p.runOnceReusableCommit}` },
    { callerCommit: "e".repeat(40) }, { runtimeSourceSha256: "f".repeat(64) }, { pairSha256: "f".repeat(64) }]) {
    await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, { ...actual, ...change }), /RUN_COORDINATES/);
  }
});

test("the dispatcher pins three different paths; management runs only alongside RunOnce and remains locked", () => {
  const read = (file: string) => readFileSync(new URL("../ops/aws-sandbox/first-open-entry/" + file, import.meta.url), "utf8");
  const source = read("sandbox-first-open-job-v1.yml.in"), p = record();
  const caller = renderLockedFirstOpenCaller(read("sandbox-first-open-v1.yml.in"), { inspect: p.inspectReusableCommit, runonce: p.runOnceReusableCommit,
    management: p.managementReusableCommit });
  const workflow = load(caller.text) as { jobs: Record<string, { uses: string; if: string; secrets?: string }>; on: object; permissions: object };
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { actions: "read", contents: "read" });
  assert.equal(workflow.jobs.inspect.uses, `${repo}/${inspectPath}@${p.inspectReusableCommit}`);
  assert.equal(workflow.jobs.runonce.uses, `${repo}/${runOncePath}@${p.runOnceReusableCommit}`);
  assert.equal(workflow.jobs.management.uses, `${repo}/${managementPath}@${p.managementReusableCommit}`);
  assert.equal(workflow.jobs.management.if, workflow.jobs.runonce.if);
  assert.ok(Object.values(workflow.jobs).every(j => !j.secrets));
  for (const [role, path] of [["inspect", inspectPath], ["runonce", runOncePath], ["management", managementPath]] as const) {
    const rendered = renderLockedFirstOpenJob(source, role, p.runtimeCommit);
    assert.equal(rendered.path, path);
    const job = load(rendered.text) as { on: object; permissions: object; jobs: Record<string, { environment: string; steps: { run?: string; with?: { ref: string } }[] }> };
    assert.deepEqual(Object.keys(job.on), ["workflow_call"]);
    assert.deepEqual(job.permissions, { actions: "read", contents: "read" });
    const bound = job.jobs["bound-first-open"];
    assert.equal(bound.environment, "techlong-sandbox-deploy");
    assert.equal(bound.steps[1].with?.ref, p.runtimeCommit);
    assert.match(bound.steps.at(-1)?.run ?? "", /FIRST_OPEN_PROVIDER_NOT_INSTALLED'\s+exit 78/);
    assert.doesNotMatch(rendered.text, /id-token|secrets: inherit|__RUNTIME_COMMIT__/);
  }
});

test("the writer's immutable ref cannot mount the manager even in the same GitHub run", async () => {
  const { p, trusted, actual } = await fixture();
  const own = { ...actual, ownRunId: actual.runOnceId, role: "management" as const };
  await assert.rejects(bindFirstOpenReleaseEntry(p, trusted, { ...own,
    reusableRef: `${repo}/${runOncePath}@${p.runOnceReusableCommit}` }), /RUN_COORDINATES/);
  await bindFirstOpenReleaseEntry(p, trusted, { ...own, reusableRef: `${repo}/${managementPath}@${p.managementReusableCommit}` });
});

test("formal dispatcher and reusable files are manual-only, disjoint and use the real pinned launcher", () => {
  const file = (name: string) => readFileSync(new URL("../.github/workflows/" + name, import.meta.url), "utf8");
  const callerText = file("sandbox-first-open-v1.yml");
  const caller = load(callerText) as { on: object; permissions: Record<string, string>; jobs: Record<string, { uses: string; if: string; secrets?: string }> };
  assert.deepEqual(Object.keys(caller.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(caller.jobs).sort(), ["inspect", "management", "runonce"]);
  assert.equal(caller.jobs.management.if, caller.jobs.runonce.if);
  assert.equal(caller.permissions["id-token"], "write");
  assert.notEqual(caller.jobs.inspect.if, caller.jobs.runonce.if);
  assert.match(caller.jobs.inspect.if, /inputs.mode == 'install-readback'/);
  assert.doesNotMatch(caller.jobs.runonce.if, /install-readback/);
  assert.doesNotMatch(caller.jobs.management.if, /install-readback/);
  for (const [role, name] of [["inspect", "inspect"], ["management", "management"], ["runonce", "run-once"]] as const) {
    const path = `sandbox-first-open-${name}-job-v1.yml`, reusable = file(path);
    assert.match(caller.jobs[role].uses, new RegExp(`^${repo}/\\.github/workflows/${path}@[a-f0-9]{40}$`));
    assert.ok(!caller.jobs[role].secrets);
    const job = load(reusable) as { on: object; permissions: Record<string, string>; jobs: Record<string, { environment: string; if: string }> };
    assert.deepEqual(Object.keys(job.on), ["workflow_call"]);
    assert.deepEqual(job.permissions, { actions: "read", contents: "read", "id-token": "write" });
    assert.equal(job.jobs["bound-first-open"].environment, "techlong-sandbox-deploy");
    if (role === "inspect") {
      const install = job.jobs["bound-install-readback"];
      assert.match(install.if, /inputs.inspect_run == 'install-readback'/);
      assert.match(job.jobs["bound-first-open"].if, /inputs.inspect_run == '0'/);
      assert.equal(install.environment, "techlong-sandbox-deploy");
      assert.match(JSON.stringify(install), /"uses":"\.\/\.github\/actions\/first-open-launch","with":\{"role":"install-readback"\}/);
      assert.match(JSON.stringify(install), /INSTALL_READBACK_RUN_ID/);
      assert.doesNotMatch(JSON.stringify(install), /TECHLONG_FIRST_OPEN_BACKEND|TECHLONG_FIRST_OPEN_PROTECTED_RECORD|FIRST_OPEN_INSPECT_HOST_B64|RunOnce/);
    } else assert.equal(job.jobs["bound-install-readback"], undefined);
    if (role === "management") assert.match(reusable, /ops\/aws-sandbox\/first-open-entry\/run\.ts management\s*$/);
    else {
      const launch = (job.jobs["bound-first-open"] as { steps?: Array<{ uses?: string; with?: { role?: string } }> }).steps?.at(-1);
      assert.equal(launch?.uses, "./.github/actions/first-open-launch");
      assert.equal(launch?.with?.role, role);
      const adapter = readFileSync(new URL("../.github/actions/first-open-launch/launch.cjs", import.meta.url), "utf8");
      assert.match(adapter, /"ops\/aws-sandbox\/first-open-entry\/run\.ts", role/);
    }
    assert.match(reusable, new RegExp(`secrets\\.TECHLONG_FIRST_OPEN_${role.toUpperCase()}_HOST_B64`));
    assert.doesNotMatch(reusable, /FIRST_OPEN_PROVIDER_NOT_INSTALLED|secrets: inherit|configure-aws-credentials/);
  }
});
