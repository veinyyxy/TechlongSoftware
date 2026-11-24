import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CloudFormationClient, DescribeChangeSetCommand, DescribeStacksCommand, GetTemplateCommand } from "@aws-sdk/client-cloudformation";
import { GetPolicyCommand, GetPolicyVersionCommand, GetRoleCommand, GetRolePolicyCommand, IAMClient,
  ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from "@aws-sdk/client-iam";
import { GetBucketPolicyCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenBuyerSignerSecretName } from "../lib/buyer-forward/signer-binding.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenInspectorAuthorityReadScope } from "../ops/aws-sandbox/first-open-inspector-iam.ts";
import { firstOpenProvisionerProjection, renderFirstOpenProvisionerTargets } from "../ops/aws-sandbox/first-open-provisioner-policy.ts";
import { compareFirstOpenProvisionerReadback } from "../ops/aws-sandbox/first-open-provisioner-readback.ts";
import { firstOpenManagementKeys } from "../ops/aws-sandbox/first-open-management-bridge.ts";
import { firstOpenManagementIamDraft } from "../ops/aws-sandbox/first-open-management-install.ts";
import { renderFirstOpenLockedProvisioner } from "../ops/aws-sandbox/scripts/first-open-lifecycle-iam-delta.mjs";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import original from "../ops/aws-sandbox/cloudformation/s3-bootstrap.template.json" with { type: "json" };
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";
import { firstOpenInstallInspectorPolicies, firstOpenInstallInspectorScope, firstOpenInstallProvisionerLane,
  firstOpenInstallProvisionerObservation, type FirstOpenInstallStagingScope } from "../ops/aws-sandbox/first-open-install-inspector-scope.ts";
import { bindFirstOpenInstallProvisionerReadback } from "../ops/aws-sandbox/first-open-inspector-authority-readback.ts";
import { assertFirstOpenInstallReadbackAck, assertFirstOpenInstallSharedPredecessorAck, authorizeFirstOpenInstallReadback, buildFirstOpenInstallReadbackPlan,
  firstOpenInstallInspectorCredentials, firstOpenInstallStagingKeys, observeFirstOpenInstallReadback,
  readFirstOpenInstallStaging } from "../ops/aws-sandbox/first-open-install-readback.ts";
import oidc from "../ops/aws-sandbox/first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };
import identities from "../ops/aws-sandbox/cloudformation/first-open-fc41597f-identities.template.json" with { type: "json" };
import { compileFirstOpenInstallInspectorTargets, matchFirstOpenInstallObserverRelock } from "../ops/aws-sandbox/first-open-owner-targets.ts";
import { canonical as ordinal, hash as ordinalSha256 } from "../ops/temporary-idle/environment-cfn.mjs";
import { verifyFirstOpenOwnerStageReceipts } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";

const t = Date.UTC(2026, 10, 24, 17), sha = "a".repeat(64);
const signer = { arn: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${firstOpenBuyerSignerSecretName}-Ab12Cd`,
  versionId: "54e22cf8-e142-4448-a175-a37eefa88611" };
type Template = Parameters<typeof renderFirstOpenProvisionerTargets>[0];

async function fixture() {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const release = { jobId: s.jobId, taskRelease, approvalSha256: sha, runOnceReusableCommit: "b".repeat(40),
    actorId: "14145707", inspectReusableCommit: "c".repeat(40), managementReusableCommit: "d".repeat(40), startAt: t,
    claimBefore: t + 120_000, applicationLoginBefore: t + 360_000, phaseCutoffs: [t + 60_000, t + 180_000, t + 300_000, t + 600_000, t + 900_000],
    writeBefore: t + 1_200_000 } as FirstOpenFrozenRelease;
  const locked = structuredClone(original) as Template;
  locked.Resources.ProvisionerRole = renderFirstOpenLockedProvisioner(locked.Resources.ProvisionerRole, firstOpenManagementIamDraft(release, signer).writerFederation);
  const targets = await renderFirstOpenProvisionerTargets(locked, await sha256Hex(locked), release, signer);
  return { release, locked, targets };
}

test("only the original writer role and boundary change, with explicit fences against inherited authority", async () => {
  const { locked, release, targets } = await fixture();
  assert.deepEqual(targets.restore, locked);
  assert.deepEqual(Object.keys(targets.grant.Resources).filter(id => canonicalJson(targets.grant.Resources[id]) !== canonicalJson(locked.Resources[id])).sort(),
    ["ProvisionerBoundary", "ProvisionerRole"]);
  const checks = (targets.grant.Resources.ProvisionerRole.Properties.Policies as { PolicyDocument: { Statement: Record<string, unknown>[] } }[])[0].PolicyDocument.Statement;
  const outside = checks.find(p => p.Action === "s3:PutObject" && p.NotResource);
  const { request, reply } = firstOpenManagementKeys(sha, true);
  assert.deepEqual((outside!.NotResource as string[]).map(x => x.replace(/^arn:aws:s3:::[^/]+\//, "")),
    [request[0].replace("request-1.json", "request-*.json"), `first-open-management/${s.jobId}/${sha}/cfn-template.json`]);
  assert.match(checks.find(p => p.Action === "s3:GetObject" && p.NotResource)?.NotResource as string, /\/reply-\*\.json$/);
  assert.ok((checks.find(p => p.Action === "s3:GetObject" && p.NotResource)?.NotResource as string).endsWith(reply[0].replace("reply-0.json", "reply-*.json")));
  const actions = checks.find(x => x.NotAction)!.NotAction as string[];
  for (const forbidden of ["cloudformation:CreateStack", "iam:PassRole", "secretsmanager:PutResourcePolicy", "sts:AssumeRole", "s3:DeleteObject"]) {
    assert.ok(!actions.includes(forbidden));
  }
  assert.match(canonicalJson(checks), /dynamodb:LeadingKeys/);
  assert.ok(checks.some(x => x.Action === "secretsmanager:TagResource" &&
    (x.Condition as { Null?: Record<string, string> }).Null?.["secretsmanager:SecretId"] === "false"));
  assert.ok(checks.some(x => x.Action === "*" &&
    (x.Condition as { DateGreaterThanEquals?: Record<string, string> }).DateGreaterThanEquals?.["aws:CurrentTime"] === new Date(release.writeBefore).toISOString()));
  await assert.rejects(renderFirstOpenProvisionerTargets(locked, sha, release, signer), /TARGET_SCOPE/);
});

test("independent writer readback requires the two exact executed changes, owner Original, IAM and bucket", async () => {
  const { release, targets } = await fixture(), releaseSha256 = await sha256Hex(release);
  const scope = firstOpenInspectorAuthorityReadScope(release, releaseSha256);
  const consent = { reviewedScope: scope, approvedScopeSha256: await sha256Hex(scope) };
  const changeId = (phase: "grant" | "relock") =>
    `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${scope.provisionerChangeSetNames[phase === "grant" ? 0 : 1]}/1696ea4c-f727-4abc-b876-65c438132e9b`;
  type Read = Parameters<typeof compareFirstOpenProvisionerReadback>[0]["read"];
  let dirty = false, clock = t + 1_010;
  const read: Read = async phase => {
    const template = phase === "grant" || dirty ? targets.grant : targets.restore;
    const projection = await firstOpenProvisionerProjection(template);
    return { phase, checkedAt: clock - 1, exactOwnerStackArn: scope.ownerStackArn, exactChangeSetId: changeId(phase),
      changesSha256: sha, roleSnapshotSha256: sha, policyVersionsSha256: sha, evidenceBucketPolicySha256: sha,
      scopeSha256: await sha256Hex(scope), ownerStackOriginalSha256: await sha256Hex(template),
      roles: [projection.role], policies: projection.policies, authorizationProved: false,
      changes: targets.changes.map(x => ({ logicalId: x.logicalId, action: "Modify", replacement: "False",
        type: x.logicalId === "ProvisionerRole" ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy" })),
    };
  };
  const bind = () => compareFirstOpenProvisionerReadback({ release, releaseSha256, consent, targets, expectedBucketSha256: sha, read }, () => clock);
  const verify = await bind(), signal = new AbortController().signal;
  const grantAck = { changeSetId: changeId("grant"), executedAt: t + 1_000, targetSha256: targets.grantSha256 };
  assert.equal((await verify("grant", grantAck, signal)).authorizationProved, false);
  await assert.rejects(verify("grant", grantAck, signal), /READBACK_UNPROVED/);
  clock = release.claimBefore + 20;
  const relockAck = { changeSetId: changeId("relock"), executedAt: release.claimBefore + 10, targetSha256: targets.restoreSha256 };
  dirty = true;
  await assert.rejects(verify("relock", relockAck, signal), /READBACK_UNPROVED/);
  dirty = false;
  assert.equal((await (await bind())("relock", relockAck, signal)).phase, "relock");
});

test("optional install Inspector staging grants only version reads of the two approved oversized install keys before Grant observation", async () => {
  const { release, targets } = await fixture();
  release.schema = "techlong/sandbox-first-open-release/v1";
  const startAt = t - 40_000, window = { startAt, issueBefore: t - 32_000, grantAt: t - 30_000, grantBefore: t - 20_000,
    relockAt: t - 10_000, relockBefore: t, factsCutoff: t + 600_000 };
  const releaseSha256 = await sha256Hex(release);
  const descriptor = (template: Template) => {
    // The synthetic source fixture is smaller than the retained live Original.
    const oversized = { ...template, Metadata: { SyntheticFixture: "x".repeat(52_000) } };
    return { targetCanonicalSha256: ordinalSha256(oversized), targetBytes: Buffer.byteLength(JSON.stringify(ordinal(oversized))) };
  };
  const staging = { readBefore: t - 31_000, targets: { grant: descriptor(targets.grant), relock: descriptor(targets.restore) } };
  const baseScope = await firstOpenInstallInspectorScope(release, releaseSha256, window);
  assert.equal(Object.hasOwn(baseScope, "staging"), false);
  const baseDigest = await sha256Hex(baseScope);
  const base = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, baseDigest);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, staging);
  const approvedScopeSha256 = await sha256Hex(scope);
  const staged = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256, staging);
  const expectedKeys = (["grant", "relock"] as const).map(phase =>
    `first-open-management/${s.jobId}/${release.approvalSha256}/install-owner/install/provisioner-${phase}/${staging.targets[phase].targetCanonicalSha256}.json`);
  assert.deepEqual(Object.values(scope.staging!.targets).map(x => x.key), expectedKeys);
  const expectedObjects = expectedKeys.map(k => `${scope.evidenceBucketArn}/${k}`);
  const active: Record<string, unknown>[] = staged.active;
  const allows = active.filter(p => p.Effect === "Allow");
  assert.deepEqual(allows.slice(0, -1), base.active.filter(p => p.Effect === "Allow"));
  const user = { "aws:userid": `${scope.roleId}:${scope.roleSessionName}` };
  const cutoff = { "aws:CurrentTime": new Date(staging.readBefore).toISOString() };
  assert.deepEqual(allows.at(-1), { Effect: "Allow", Action: ["s3:GetObjectVersion"], Resource: expectedObjects, Condition: {
    StringEquals: { ...user, "aws:FederatedProvider": scope.provider, "s3:ResourceAccount": s.account, "aws:RequestedRegion": s.region },
    DateGreaterThanEquals: { "aws:CurrentTime": new Date(startAt).toISOString() }, DateLessThan: cutoff,
    Null: { "s3:VersionId": "false" }, StringNotEquals: { "s3:VersionId": "null" },
  } });
  const denies = active.filter(p => p.Effect === "Deny");
  assert.deepEqual(denies.find(p => Array.isArray(p.Action) && p.Action.includes("s3:GetObjectVersion"))?.NotResource, expectedObjects);
  assert.ok(denies.some(p => p.Action === "s3:GetObjectVersion" &&
    canonicalJson(p.Condition) === canonicalJson({ StringEquals: user, DateGreaterThanEquals: cutoff })));
  assert.ok(denies.some(p => p.Action === "s3:GetObjectVersion" &&
    canonicalJson(p.Condition) === canonicalJson({ StringEquals: user, Null: { "s3:VersionId": "true" } })));
  assert.ok(denies.some(p => p.Action === "s3:GetObjectVersion" &&
    canonicalJson(p.Condition) === canonicalJson({ StringEquals: { ...user, "s3:VersionId": "null" } })));
  const deniedExcept = denies.find(p => Array.isArray(p.NotAction))?.NotAction as string[];
  assert.deepEqual(deniedExcept.filter(a => a.startsWith("s3:")), ["s3:GetBucketPolicy", "s3:GetObjectVersion"]);
  assert.deepEqual(staged.relock, base.relock);
  assert.deepEqual(staged.trust, base.trust);
  await assert.rejects(firstOpenInstallInspectorPolicies(release, releaseSha256, window, baseDigest, staging), /SCOPE/);
  await assert.rejects(firstOpenInstallInspectorPolicies(release, releaseSha256, window, approvedScopeSha256,
    { ...staging, readBefore: staging.readBefore - 1 }), /SCOPE/);
  const invalid: FirstOpenInstallStagingScope[] = [
    { ...staging, readBefore: startAt }, { ...staging, readBefore: window.grantAt }, { ...staging, targets: {} },
    { ...staging, targets: { grant: { ...staging.targets.grant, targetBytes: 51_200 } } },
    { ...staging, targets: { grant: { ...staging.targets.grant, targetCanonicalSha256: "*" } } },
    { ...staging, targets: { grant: staging.targets.grant, "formal-provisioner-grant": staging.targets.grant } as FirstOpenInstallStagingScope["targets"] },
  ];
  for (const bad of invalid) await assert.rejects(firstOpenInstallInspectorScope(release, releaseSha256, window, bad), /SCOPE/);
  const single = { ...staging, targets: { grant: staging.targets.grant } };
  assert.deepEqual(Object.keys((await firstOpenInstallInspectorScope(release, releaseSha256, window, single)).staging!.targets), ["grant"]);

  const original = { stackId: `arn:aws:cloudformation:${s.region}:${s.account}:stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f`, template: identities };
  const rendered = await compileFirstOpenInstallInspectorTargets({ original, release, releaseSha256, window, approvedScopeSha256, staging }, startAt - 1);
  const renderedBase = await compileFirstOpenInstallInspectorTargets({ original, release, releaseSha256, window, approvedScopeSha256: baseDigest }, startAt - 1);
  assert.equal(rendered.executionAuthorized, false);
  assert.ok(Buffer.byteLength(JSON.stringify(ordinal(rendered.grant.template))) <= 51_200);
  assert.deepEqual(rendered.relock.template, renderedBase.relock.template);
  assert.notEqual(rendered.grant.targetCanonicalSha256, renderedBase.grant.targetCanonicalSha256);
  const restored = { original: { ...original, template: rendered.relock.template }, release, releaseSha256, window,
    approvedScopeSha256, observedOriginalSha256: rendered.relock.targetCanonicalSha256 };
  await matchFirstOpenInstallObserverRelock({ ...restored, staging });
  await assert.rejects(matchFirstOpenInstallObserverRelock(restored), /SCOPE/);
});

test("install Inspector uses one separately pinned session and still observes relock if grant is unproved", async ctx => {
  const { release, targets } = await fixture();
  release.schema = "techlong/sandbox-first-open-release/v1";
  release.callerCommit = "e".repeat(40);
  release.runtimeCommit = "f".repeat(40);
  release.workflowId = "426525508";
  const startAt = t - 40_000, window = { startAt, issueBefore: t - 31_000, grantAt: t - 30_000, grantBefore: t - 20_000,
    relockAt: t - 10_000, relockBefore: t, factsCutoff: t + 600_000 };
  const releaseSha256 = await sha256Hex(release);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window);
  const authorityScopeSha256 = await sha256Hex(scope);
  const formalScope = firstOpenInspectorAuthorityReadScope(release, releaseSha256), formalRelock = formalScope.provisionerChangeSetNames[1];
  assert.deepEqual(scope.changeSetNames, ["grant", "relock"].map(phase => `fc41597f-install-provisioner-${sha.slice(0, 24)}-${phase}`));
  assert.equal(formalRelock, `fc41597f-provisioner-${sha.slice(0, 24)}-relock`);
  const policies = await firstOpenInstallInspectorPolicies(release, releaseSha256, window, authorityScopeSha256);
  const allows = policies.active.filter(p => p.Effect === "Allow");
  assert.ok(allows.every(p => p.Resource !== "*" && p.Action.every(a => /^(iam:Get|iam:List|s3:GetBucketPolicy|cloudformation:Describe|cloudformation:GetTemplate)/.test(a))));
  assert.doesNotMatch(JSON.stringify(policies.active), new RegExp(formalRelock));
  assert.match(JSON.stringify(policies.relock), /first-open-fc41597f-install-readback/);
  const owner = { stackId: `arn:aws:cloudformation:${s.region}:${s.account}:stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f`,
    template: identities };
  const inspectorTargets = await compileFirstOpenInstallInspectorTargets({ original: owner, release, releaseSha256, window, approvedScopeSha256: authorityScopeSha256 }, startAt - 1);
  assert.deepEqual(inspectorTargets.grant.expectedChanges, [{ logicalId: "LockedInspectorRole", action: "Modify", replacement: false }]);
  const off = inspectorTargets.relock.template.Resources.LockedInspectorRole.Properties;
  assert.deepEqual(off.AssumeRolePolicyDocument, identities.Resources.LockedInspectorRole.Properties.AssumeRolePolicyDocument);
  assert.doesNotMatch(canonicalJson(off.Policies), /"Effect":"Allow"/);
  const relocked = { stackId: owner.stackId, template: inspectorTargets.relock.template };
  const relockInput = { original: relocked, release, releaseSha256, window, approvedScopeSha256: authorityScopeSha256,
    observedOriginalSha256: inspectorTargets.relock.targetCanonicalSha256 };
  const lockedPolicy = await matchFirstOpenInstallObserverRelock(relockInput);
  assert.deepEqual(off.Policies, [lockedPolicy]);
  await assert.rejects(matchFirstOpenInstallObserverRelock({ ...relockInput, original: owner }), /RELOCK_PREIMAGE/);
  const stillGranted = inspectorTargets.grant;
  await assert.rejects(matchFirstOpenInstallObserverRelock({ ...relockInput,
    original: { stackId: owner.stackId, template: stillGranted.template }, observedOriginalSha256: stillGranted.targetCanonicalSha256 }), /RELOCK_PREIMAGE/);
  const plan = await buildFirstOpenInstallReadbackPlan({ release, releaseSha256, window, authorityScopeSha256,
    factsReceiptSha256: sha, expectedBucketSha256: sha, targets });
  const planSha256 = await sha256Hex(plan);
  const repo = "veinyyxy/TechlongSoftware", caller = repo + "/.github/workflows/sandbox-first-open-v1.yml@refs/heads/main", runId = "100794";
  const env = { GITHUB_REPOSITORY: repo, GITHUB_REPOSITORY_ID: "1323312747", GITHUB_REPOSITORY_OWNER_ID: "14145707",
    GITHUB_ACTOR_ID: "14145707", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: caller, GITHUB_SHA: release.callerCommit, GITHUB_RUN_ID: runId, FIRST_OPEN_INSTALL_APPROVED_RUN_ID: runId,
    FIRST_OPEN_INSTALL_APPROVED_PLAN_SHA256: planSha256, FIRST_OPEN_INSTALL_REQUESTED_PLAN_SHA256: planSha256,
    FIRST_OPEN_INSTALL_PROTECTED_PLAN: JSON.stringify(plan), FIRST_OPEN_INSTALL_RUNTIME_COMMIT: release.runtimeCommit,
    FIRST_OPEN_INSTALL_REQUESTED_RELEASE_SHA256: releaseSha256 };
  const host = { env, actualCheckout: release.runtimeCommit };
  const a = await authorizeFirstOpenInstallReadback(host, startAt);
  await assert.rejects(authorizeFirstOpenInstallReadback({ ...host, env: { ...env, GITHUB_RUN_ID: "9876" } }, startAt), /CONTEXT/);
  await assert.rejects(authorizeFirstOpenInstallReadback(host, window.issueBefore), /ISSUE_WINDOW/);
  await assert.rejects(firstOpenInstallInspectorScope(release, releaseSha256, { ...window, relockBefore: t + 1 }), /SCOPE/);
  const common = Object.fromEntries(Object.entries(oidc.federatedTrust.commonClaims).map(([k, v]) => [k.split(":")[1], v]));
  const jwt = (extra: object = {}) => "header." + Buffer.from(JSON.stringify({ ...common, iss: oidc.federatedTrust.issuer,
    actor_id: release.actorId, job_workflow_ref: scope.reusableRef, run_id: runId, run_attempt: "1", event_name: "workflow_dispatch",
    sha: release.callerCommit, workflow_ref: caller, ...extra })).toString("base64url") + ".signature";
  type OpenSts = NonNullable<Parameters<typeof firstOpenInstallInspectorCredentials>[4]>;
  let issueCalls = 0;
  const sts = (() => ({ send(cmd: { input: { RoleArn: string; RoleSessionName: string } }) {
    issueCalls++;
    assert.equal(cmd.input.RoleArn, scope.roleArn);
    assert.equal(cmd.input.RoleSessionName, "first-open-fc41597f-install-readback");
    return { Credentials: { AccessKeyId: "synthetic", SecretAccessKey: "synthetic", SessionToken: "synthetic", Expiration: new Date(t + 900_000) } };
  }, destroy() {} })) as unknown as OpenSts;
  const badIssuer = firstOpenInstallInspectorCredentials(a, env, () => startAt, async () => jwt({ run_id: "999" }), sts);
  await assert.rejects(badIssuer(), /OIDC/);
  assert.equal(issueCalls, 0);
  const issuer = firstOpenInstallInspectorCredentials(a, env, () => startAt, async () => jwt(), sts);
  await Promise.all([issuer(), issuer()]);
  assert.equal(issueCalls, 1);

  type Read = Parameters<typeof observeFirstOpenInstallReadback>[1];
  const seen: string[] = [];
  let clock = startAt;
  const changeId = (name: string) => `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${name}/1696ea4c-f727-4abc-b876-65c438132e9b`;
  const read: Read = async phase => {
    seen.push(phase);
    clock += 2;
    if (phase === "grant") throw Error("unproved grant");
    const pin = plan.targets.relock;
    return { schema: firstOpenInstallProvisionerObservation, lane: firstOpenInstallProvisionerLane, changeSetName: scope.changeSetNames[1],
      phase, checkedAt: clock - 1, exactOwnerStackArn: scope.ownerStackArn, exactChangeSetId: changeId(scope.changeSetNames[1]),
      changesSha256: sha, roleSnapshotSha256: sha, policyVersionsSha256: sha, evidenceBucketPolicySha256: sha,
      scopeSha256: authorityScopeSha256, ownerStackOriginalSha256: pin.templateSha256, roles: [pin.projection.role], policies: pin.projection.policies,
      authorizationProved: false,
      changes: targets.changes.map(x => ({ logicalId: x.logicalId, action: "Modify", replacement: "False",
        type: x.logicalId === "ProvisionerRole" ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy" })),
    };
  };
  const report = await observeFirstOpenInstallReadback(a, read, new AbortController().signal, () => clock, async ms => { clock += ms; });
  assert.deepEqual(seen, ["grant", "relock"]);
  assert.deepEqual(report.phases.grant, { status: "UNPROVED" });
  const gone = report.phases.relock;
  assert.equal(gone?.status, "MATCHED_INSTALLED_POLICY_DOCUMENTS");
  if (gone?.status !== "MATCHED_INSTALLED_POLICY_DOCUMENTS") throw Error("fixture");
  assert.equal(report.lane, firstOpenInstallProvisionerLane);
  const ack = { lane: firstOpenInstallProvisionerLane, approvalSha256: release.approvalSha256,
    planSha256, runId, changeSetId: gone.changeSetId, targetSha256: gone.targetSha256, executedAt: window.relockAt - 10 };
  assert.equal(assertFirstOpenInstallReadbackAck(report, "relock", ack), gone);
  assert.throws(() => assertFirstOpenInstallReadbackAck(report, "relock", { ...ack, executedAt: clock + 1 }), /EXECUTE_ACK/);
  const retagged = { ...report, phases: { ...report.phases, relock: { ...gone, changeSetName: formalRelock, changeSetId: changeId(formalRelock) } } };
  assert.throws(() => assertFirstOpenInstallReadbackAck(retagged, "relock", { ...ack, changeSetId: changeId(formalRelock) }), /EXECUTE_ACK/);
  assert.throws(() => assertFirstOpenInstallReadbackAck(report, "relock", { ...ack, lane: "formal" } as unknown as typeof ack), /EXECUTE_ACK/);
  assert.throws(() => assertFirstOpenInstallReadbackAck({ ...report, schema: "techlong/fc41597f-independent-install-observed/v1" } as unknown as typeof report,
    "relock", ack), /EXECUTE_ACK/);

  const calls: string[] = [];
  let phase: "grant" | "relock" = "grant", replyWithFormalArn = false;
  const inline = () => phase === "grant" ? "FirstOpenFc41597fWriterFence" : "FirstOpenFc41597fWriterLock";
  ctx.mock.method(IAMClient.prototype, "send", async (cmd: unknown) => {
    calls.push("iam");
    if (cmd instanceof GetRoleCommand) return { Role: { Arn: scope.roleToRead, RoleId: formalScope.roleIds[0],
      PermissionsBoundary: { PermissionsBoundaryArn: scope.boundaryToRead }, AssumeRolePolicyDocument: "{}" } };
    if (cmd instanceof ListRolePoliciesCommand) return { IsTruncated: false, PolicyNames: [inline()] };
    if (cmd instanceof ListAttachedRolePoliciesCommand) return { IsTruncated: false, AttachedPolicies: [{ PolicyArn: scope.boundaryToRead }] };
    if (cmd instanceof GetRolePolicyCommand) return { ...cmd.input, PolicyDocument: "{}" };
    if (cmd instanceof GetPolicyCommand) return { Policy: { Arn: scope.boundaryToRead, PolicyId: "fixture", DefaultVersionId: "v1" } };
    if (cmd instanceof GetPolicyVersionCommand) return { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: "{}" } };
    return assert.fail("unexpected IAM metadata");
  });
  ctx.mock.method(S3Client.prototype, "send", async (cmd: unknown) => {
    assert.ok(cmd instanceof GetBucketPolicyCommand); calls.push("bucket"); return { Policy: "{}" };
  });
  ctx.mock.method(CloudFormationClient.prototype, "send", async (cmd: unknown) => {
    assert.ok(cmd instanceof DescribeStacksCommand || cmd instanceof DescribeChangeSetCommand || cmd instanceof GetTemplateCommand);
    assert.equal(cmd.input.StackName, scope.ownerStackArn);
    if (cmd instanceof DescribeStacksCommand) { calls.push("stack"); return { Stacks: [{ StackId: scope.ownerStackArn, StackStatus: "UPDATE_COMPLETE" }] }; }
    if (cmd instanceof GetTemplateCommand) { calls.push("template"); return { TemplateBody: "{}" }; }
    const name = scope.changeSetNames[phase === "grant" ? 0 : 1];
    assert.equal(cmd.input.ChangeSetName, name);
    calls.push(name);
    return { StackId: scope.ownerStackArn, ChangeSetName: name, ChangeSetId: changeId(replyWithFormalArn ? formalRelock : name),
      CreationTime: new Date(window.startAt + 1), Status: "CREATE_COMPLETE", ExecutionStatus: "EXECUTE_COMPLETE", Changes: [] };
  });
  const bindRead = () => bindFirstOpenInstallProvisionerReadback({ release, releaseSha256, window, approvedScopeSha256: authorityScopeSha256,
    async credentials() { return { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture" }; } }, () => clock);
  const sdkRead = await bindRead(), signal = new AbortController().signal;
  for (const p of ["grant", "relock"] as const) {
    phase = p; clock = (p === "grant" ? window.grantAt : window.relockAt) + 1;
    const observation = await sdkRead(phase, [[inline()]], signal);
    assert.equal(observation.changeSetName, scope.changeSetNames[phase === "grant" ? 0 : 1]);
    assert.equal(observation.lane, firstOpenInstallProvisionerLane);
    assert.equal(observation.scopeSha256, authorityScopeSha256);
    assert.deepEqual(calls.splice(0), [...Array(6).fill("iam"), "bucket", "stack", observation.changeSetName, "template"]);
  }
  replyWithFormalArn = true;
  await assert.rejects((await bindRead())("relock", [[inline()]], signal), /READBACK_UNPROVED/);
  assert.equal(calls.length, 10);
});

test("the install observer first binds the exact bucket policy, then reads the frozen upload VersionId once", async () => {
  const { release, targets } = await fixture();
  Object.assign(release, { schema: "techlong/sandbox-first-open-release/v1", callerCommit: "e".repeat(40), runtimeCommit: "f".repeat(40), workflowId: "426525508" });
  Object.assign(targets.grant, { Metadata: { padding: "x".repeat(60_000) } });
  targets.grantSha256 = await sha256Hex(targets.grant);
  const startAt = t - 40_000, now = startAt + 1000;
  const window = { startAt, issueBefore: startAt + 2000, grantAt: startAt + 8000, grantBefore: t - 20_000,
    relockAt: t - 10_000, relockBefore: t, factsCutoff: t + 60_000 };
  const coordinates = firstOpenInstallStagingKeys(release, targets, startAt + 6000), pin = coordinates.targets.grant!;
  assert.ok(pin.key.endsWith(`/install/provisioner-grant/${pin.targetCanonicalSha256}.json`));
  const { key, ...inputPin } = pin, stagingScope = { readBefore: coordinates.readBefore, targets: { grant: inputPin } };
  const versionId = "fixture-version-abc123", phase = "provisioner-grant" as const;
  const body = Buffer.from(JSON.stringify(ordinal(targets.grant))), checksum = Buffer.from(pin.targetCanonicalSha256, "hex").toString("base64");
  const req = { Bucket: FIRST_OPEN_BASELINE_BINDING.bucket, Key: key, ExpectedBucketOwner: s.account };
  const wire = { ContentLength: body.length, ContentType: "application/json", ChecksumSHA256: checksum, ServerSideEncryption: "AES256" as const };
  const putReceipt = Buffer.from(canonicalJson({ schema: "techlong/fc41597f-owner-stage-put/v1", jobId: s.jobId,
    approvalSha256: release.approvalSha256, phase, acknowledgedAt: startAt + 500, bodyRawSha256: pin.targetCanonicalSha256,
    source: { Account: s.account, Arn: `arn:aws:iam::${s.account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" },
    request: { ...req, ...wire, IfNoneMatch: "*" }, response: { httpStatus: 200, VersionId: versionId, ChecksumSHA256: checksum, ServerSideEncryption: "AES256" } }));
  const putReceiptRawSha256 = await sha256Hex(putReceipt.toString("utf8")), releaseSha256 = await sha256Hex(release);
  const scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, stagingScope);
  const policy = { Version: "2012-10-17", Statement: [] }, expectedBucketSha256 = await sha256Hex(policy);
  const authorityScopeSha256 = await sha256Hex(scope);
  const plan = await buildFirstOpenInstallReadbackPlan({ release, releaseSha256, window, authorityScopeSha256, targets,
    factsReceiptSha256: sha, expectedBucketSha256, staging: { scope: stagingScope, uploads: { grant: {
      versionId, putReceiptRawSha256, acknowledgedAt: startAt + 500,
    } } } });
  const a = { plan, scope, planSha256: await sha256Hex(plan), runId: "100794" };
  const identity = { accountId: s.account, arn: `arn:aws:sts::${s.account}:assumed-role/TechlongSandboxFirstOpenInspector/${scope.roleSessionName}`,
    roleId: scope.roleId, credentialExpiresAt: t + 300_000 };
  const signal = new AbortController().signal;
  const commands: unknown[] = [];
  const read = (returnedVersion: string, document = JSON.stringify({ Statement: policy.Statement, Version: policy.Version })) => ({
    readBucketPolicy: async (cmd: GetBucketPolicyCommand, mark: AbortSignal) => {
      assert.equal(mark.aborted, false);
      commands.push(cmd.input);
      return { $metadata: { httpStatusCode: 200 }, Policy: document };
    },
    readObject: async (cmd: { input: object }): Promise<GetObjectCommandOutput> => {
      commands.push(cmd.input);
      return { ...wire, $metadata: { httpStatusCode: 200 }, VersionId: returnedVersion,
        Body: Readable.from([body]) as GetObjectCommandOutput["Body"] };
    },
  });
  const observed = await readFirstOpenInstallStaging(a, identity, read(versionId), signal, () => now);
  assert.equal(observed.evidenceBucketPolicySha256, expectedBucketSha256);
  const get = observed.receipts.grant!;
  const accepted = verifyFirstOpenOwnerStageReceipts({ expected: { ...inputPin, approvalSha256: release.approvalSha256, phase,
    startAt, factsExpireAt: window.factsCutoff, expectedReader: { Account: s.account, Arn: identity.arn, UserId: `${scope.roleId}:${scope.roleSessionName}` },
    putReceiptRawSha256, getReceiptRawSha256: get.rawSha256 }, putReceipt, exactGetReceipt: Buffer.from(get.receiptB64, "base64") }, now);
  assert.equal(accepted.versionId, versionId);
  const bucketReq = { Bucket: req.Bucket, ExpectedBucketOwner: req.ExpectedBucketOwner };
  const objectReq = { ...req, VersionId: versionId, ChecksumMode: "ENABLED" };
  assert.deepEqual(commands, [bucketReq, objectReq]);
  await assert.rejects(readFirstOpenInstallStaging(a, identity, read(versionId, "{}"), signal, () => now), /STAGE_BUCKET_POLICY/);
  assert.deepEqual(commands.splice(0), [bucketReq, objectReq, bucketReq]);
  await assert.rejects(readFirstOpenInstallStaging(a, identity, read(versionId, "invalid"), signal, () => now), /STAGE_BUCKET_POLICY/);
  assert.deepEqual(commands.splice(0), [bucketReq]);
  await assert.rejects(readFirstOpenInstallStaging(a, identity, read("different-version"), signal, () => now), /STAGE_BODY/);
  await assert.rejects(readFirstOpenInstallStaging(a, identity, read(versionId), signal, () => stagingScope.readBefore), /STAGE_WINDOW/);
  assert.deepEqual(commands, [bucketReq, objectReq]);
});

test("the approved shared predecessor has a separate key and only the exact terminal receipt unlocks the following Grant", async () => {
  const { release, targets } = await fixture();
  Object.assign(release, { schema: "techlong/sandbox-first-open-release/v1", callerCommit: "e".repeat(40), runtimeCommit: "f".repeat(40), workflowId: "426525508" });
  Object.assign(targets.restore, { Metadata: { padding: "x".repeat(60_000) } });
  targets.restoreSha256 = await sha256Hex(targets.restore);
  const startAt = t - 60_000;
  const window = { startAt, issueBefore: startAt + 4000, grantAt: startAt + 30_000, grantBefore: t - 20_000,
    relockAt: t - 10_000, relockBefore: t, factsCutoff: t + 60_000 };
  const coords = firstOpenInstallStagingKeys(release, targets, startAt + 5000, true);
  assert.equal(coords.targets.shared?.targetCanonicalSha256, coords.targets.relock?.targetCanonicalSha256);
  assert.notEqual(coords.targets.shared?.key, coords.targets.relock?.key);
  const pins = Object.fromEntries(Object.entries(coords.targets).map(([phase, target]) => [phase,
    { targetBytes: target.targetBytes, targetCanonicalSha256: target.targetCanonicalSha256 }]));
  const staging = { targets: pins, readBefore: coords.readBefore, sharedObservation: { at: startAt + 12_000, before: startAt + 18_000 } };
  const releaseSha256 = await sha256Hex(release), scope = await firstOpenInstallInspectorScope(release, releaseSha256, window, staging);
  const authorityScopeSha256 = await sha256Hex(scope), plan = await buildFirstOpenInstallReadbackPlan({
    release, releaseSha256, window, authorityScopeSha256, targets, factsReceiptSha256: sha, expectedBucketSha256: sha,
    staging: { scope: staging, uploads: Object.fromEntries(Object.keys(coords.targets).map(phase => [phase, {
      versionId: `fixture-version-${phase}`, putReceiptRawSha256: sha, acknowledgedAt: startAt + 500,
    }])) },
  });
  const a = { plan, scope, planSha256: await sha256Hex(plan), runId: "100794" };
  const changeSetName = scope.staging!.sharedObservation!.changeSetName;
  const changeSetId = `arn:aws:cloudformation:${s.region}:${s.account}:changeSet/${changeSetName}/18da6411-332e-450e-a32a-848bfe852083`;
  const ack = { changeSetId, executedAt: startAt + 10_000, targetSha256: targets.restoreSha256 };
  const schema = "techlong/fc41597f-install-shared-predecessor-observed/v1" as const;
  const report = { schema, jobId: s.jobId, planSha256: a.planSha256, authorityScopeSha256, runId: a.runId, attempt: 1,
    approvalSha256: release.approvalSha256, result: { schema, lane: "install" as const, jobId: s.jobId, releaseSha256,
      approvalSha256: release.approvalSha256, authorityScopeSha256, checkedAt: staging.sharedObservation.at,
      exactOwnerStackArn: scope.ownerStackArn, changeSetId, changeSetName, ...coords.targets.shared!, changesSha256: sha,
      executionAuthorized: false as const } };
  assert.equal(assertFirstOpenInstallSharedPredecessorAck(report, a, ack).targetCanonicalSha256, coords.targets.shared?.targetCanonicalSha256);
  for (const bad of [{ ...report, runId: "100795" }, { ...report, result: { ...report.result, key: coords.targets.relock!.key } },
    { ...report, result: { ...report.result, checkedAt: staging.sharedObservation.before } }]) {
    assert.throws(() => assertFirstOpenInstallSharedPredecessorAck(bad, a, ack), /SHARED_EXECUTE_ACK/);
  }
});
