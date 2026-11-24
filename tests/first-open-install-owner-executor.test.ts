import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { CreateChangeSetCommandInput, ExecuteChangeSetCommandInput, GetTemplateCommandOutput, ResourceChange } from "@aws-sdk/client-cloudformation";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { canonical as ordinal, hash as templateHash } from "../ops/temporary-idle/environment-cfn.mjs";
import { firstOpenOwnerStageKey } from "../ops/aws-sandbox/first-open-owner-stage-proof.ts";
import { bindFirstOpenInstallOwnerExecutor, bindFirstOpenInstallOwnerSdkExecutor, type FirstOpenFormalProvisionerExecutorPlan,
  type FirstOpenFormalProvisionerPhase, type FirstOpenInstallOwnerExecutorPlan, type FirstOpenInstallOwnerJournal,
  type FirstOpenInstallOwnerPhase, type FirstOpenInstallOwnerPorts, type FirstOpenOwnerExecutorPhase,
  type FirstOpenInstallOwnerTransition, type FirstOpenInstallOwnerDeferredStagedProof } from "../ops/aws-sandbox/first-open-install-owner-executor.ts";
import originalInspector from "../ops/aws-sandbox/cloudformation/first-open-fc41597f-identities.template.json" with { type: "json" };

const anchor = Date.UTC(2026, 10, 24, 5), approvalSha256 = "a".repeat(64), metadata = { httpStatusCode: 200 };
const namespace = `arn:aws:cloudformation:${s.region}:${s.account}:`;
const inspectorId = namespace + "stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f";
const sharedId = namespace + "stack/techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917";
const changeUuid = "00112233-4455-6677-8899-aabbccddeeff";
const sharedOriginalPin = "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360";
const lifecycleBoundary = "FirstOpenFc41597fLifecycleBoundary";
const change = (logicalId: string) => ({ logicalId, action: "Modify" as const, replacement: false as const });
const phaseNames = ["inspector-grant", "provisioner-grant", "provisioner-relock", "inspector-relock"] as const;
type Template = FirstOpenInstallOwnerTransition["template"];
type Options = { liveOriginal?: Template; replacement?: ResourceChange["Replacement"]; pending?: boolean;
  failAcceptedExecute?: boolean; neverTerminal?: boolean; expireAtExecuteAck?: boolean; journal?: FirstOpenInstallOwnerJournal; large?: boolean;
  editChange?: (change: ResourceChange) => ResourceChange;
  changeOriginal?: () => Partial<GetTemplateCommandOutput> };

function fixtures(large = false) {
  const before: Template = structuredClone(originalInspector), active = structuredClone(before), closed = structuredClone(before);
  active.Resources.LockedInspectorRole.Properties.Policies = [{ testOnlyAllow: true }];
  closed.Resources.LockedInspectorRole.Properties.Policies = [{ testOnlyDeny: true }];
  const shared: Template = { ...(large && { Metadata: { Data: "x".repeat(60_000) } }), Parameters: { ExpectedRegion: { Type: "String" } },
    Resources: {
      ProvisionerRole: { Type: "AWS::IAM::Role", Properties: { RoleName: "TechlongSandboxProvisionerRole", Policies: [] } },
      ProvisionerBoundary: { Type: "AWS::IAM::ManagedPolicy", Properties: { ManagedPolicyName: "TechlongSandboxProvisionerBoundary", PolicyDocument: { Statement: [] } } },
      TenantLifecycleTaskRole: { Type: "AWS::IAM::Role", Properties: { RoleName: "TechlongSandboxTenantLifecycleTaskRole" } },
    } };
  const writerGrant = structuredClone(shared), writerClosed = structuredClone(shared);
  writerGrant.Resources.ProvisionerRole.Properties.Policies = [{ testOnlyAllow: true }];
  writerGrant.Resources.ProvisionerBoundary.Properties.PolicyDocument = { Statement: [{ testOnlyAllow: true }] };
  writerClosed.Resources.ProvisionerRole.Properties.Policies = [{ testOnlyDeny: true }];
  const pack = (i: number, current: Template, target: Template, ids: string[], stackId: string): NonNullable<FirstOpenInstallOwnerExecutorPlan["phases"][FirstOpenInstallOwnerPhase]> => ({
    startAt: anchor + i * 120_000, writeBefore: anchor + (i + 1) * 120_000,
    sourceStackStatus: i === 0 ? "CREATE_COMPLETE" : "UPDATE_COMPLETE",
    transition: { stackId, originalCanonicalSha256: templateHash(current), targetCanonicalSha256: templateHash(target),
      template: target, expectedChanges: ids.map(change) },
    ...(large && stackId === sharedId && { stagedVersion: { versionId: "S3+Version==", independentlyVerifiedBytesReceiptSha256: "b".repeat(64),
      changeSetOriginalReadConsent: true as const } }),
  });
  const plan: FirstOpenInstallOwnerExecutorPlan = { schema: "techlong/fc41597f-install-owner-transitions/v2", jobId: s.jobId,
    approvalSha256, factsExpireAt: anchor + 60 * 60_000, phases: {
      "inspector-grant": pack(0, before, active, ["LockedInspectorRole"], inspectorId),
      "provisioner-grant": pack(1, shared, writerGrant, ["ProvisionerRole", "ProvisionerBoundary"], sharedId),
      "provisioner-relock": pack(2, writerGrant, writerClosed, ["ProvisionerBoundary", "ProvisionerRole"], sharedId),
      "inspector-relock": pack(3, active, closed, ["LockedInspectorRole"], inspectorId),
    } };
  return { plan, originals: { "inspector-grant": before, "provisioner-grant": shared,
    "provisioner-relock": writerGrant, "inspector-relock": active } };
}

function formalFixtures(large = false) {
  const { plan: rehearsal } = fixtures(large);
  const before = structuredClone(rehearsal.phases["provisioner-relock"].transition.template);
  const grant = structuredClone(rehearsal.phases["provisioner-grant"]);
  const relock = structuredClone(rehearsal.phases["provisioner-relock"]);
  const installedSharedPredecessorCanonicalSha256 = templateHash(before);
  grant.transition.originalCanonicalSha256 = installedSharedPredecessorCanonicalSha256;
  const plan: FirstOpenFormalProvisionerExecutorPlan = { schema: "techlong/fc41597f-formal-provisioner-transitions/v1", jobId: s.jobId,
    approvalSha256, factsExpireAt: rehearsal.factsExpireAt, installedSharedPredecessorCanonicalSha256,
    closedInstallReadbackReceiptSha256: "c".repeat(64), phases: { "formal-provisioner-grant": grant, "formal-provisioner-relock": relock } };
  return { plan, originals: { "formal-provisioner-grant": before, "formal-provisioner-relock": grant.transition.template } };
}

const broker = (phase: FirstOpenInstallOwnerPhase, opt: Options = {}) => mockLane(phase, fixtures(opt.large), opt);
const formalBroker = (phase: FirstOpenFormalProvisionerPhase, opt: Options = {}) => mockLane(phase, formalFixtures(opt.large), opt);

async function mockLane<P extends FirstOpenInstallOwnerExecutorPlan | FirstOpenFormalProvisionerExecutorPlan>(phase: FirstOpenOwnerExecutorPhase,
  { plan, originals }: { plan: P; originals: Partial<Record<FirstOpenOwnerExecutorPhase, Template>> }, opt: Options) {
  const phasePlan = (plan.phases as Partial<Record<FirstOpenOwnerExecutorPhase,
    FirstOpenInstallOwnerExecutorPlan["phases"][FirstOpenInstallOwnerPhase]>>)[phase]!, target = phasePlan.transition;
  const stackId = target.stackId, names = phase.includes("inspector") ? "install-readback" :
    phase.startsWith("formal-") ? "provisioner" : "install-provisioner";
  const changeSetName = phase === "shared-predecessor" ? `fc41597f-install-shared-${approvalSha256.slice(0, 24)}-prepare` :
    `fc41597f-${names}-${approvalSha256.slice(0, 24)}-${phase.endsWith("relock") ? "relock" : "grant"}`;
  const changeSetId = namespace + `changeSet/${changeSetName}/${changeUuid}`;
  const old = opt.liveOriginal ?? originals[phase]!, calls: string[] = [], events: Parameters<FirstOpenInstallOwnerJournal["record"]>[1][] = [];
  const slots = new Set<string>(), requests: (CreateChangeSetCommandInput | ExecuteChangeSetCommandInput)[] = [];
  const prerequisites: Parameters<FirstOpenInstallOwnerJournal["requirePrerequisite"]>[0][] = [];
  let executed = false, now = phasePlan.startAt;
  const journal: FirstOpenInstallOwnerJournal = opt.journal ?? {
    async consume(slot) { assert.ok(!slots.has(slot), "test durable slot used"); slots.add(slot); },
    async record(_slot, event) { events.push(event); },
    async requirePrerequisite(binding) { calls.push("prerequisite"); prerequisites.push(binding); },
  };
  const share = { ProvisionerRole: "TechlongSandboxProvisionerRole",
    ProvisionerBoundary: `arn:aws:iam::${s.account}:policy/TechlongSandboxProvisionerBoundary`, LockedInspectorRole: "TechlongSandboxFirstOpenInspector",
    TenantLifecycleTaskRole: "TechlongSandboxTenantLifecycleTaskRole" };
  const ports: FirstOpenInstallOwnerPorts = {
    async identify() { calls.push("identify"); return { $metadata: metadata, Account: s.account,
      Arn: `arn:aws:iam::${s.account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" }; },
    async describeStack(id) { calls.push("stack"); assert.equal(id, stackId); return { $metadata: metadata, Stacks: [{ StackId: stackId,
      StackName: "stub", CreationTime: new Date(anchor - 100),
      StackStatus: executed ? opt.neverTerminal ? "UPDATE_IN_PROGRESS" : "UPDATE_COMPLETE" : phasePlan.sourceStackStatus,
      ...(executed && { LastUpdatedTime: new Date(now) }),
      Parameters: Object.entries(old.Parameters ?? {}).map(([ParameterKey, def]) => ({ ParameterKey,
        ParameterValue: (def as { Default?: string }).Default ?? s.region })) }] }; },
    async getOriginal(id) { calls.push("original"); assert.equal(id, stackId); return { $metadata: metadata, TemplateBody: JSON.stringify(old) }; },
    async getChangeSetOriginal(id, changeId) {
      calls.push("change-original");
      assert.equal(id, stackId);
      assert.equal(changeId, changeSetId);
      return { $metadata: metadata, StagesAvailable: ["Original", "Processed"], TemplateBody: JSON.stringify(target.template, null, 2),
        ...opt.changeOriginal?.() };
    },
    async create(input) { calls.push("create"); requests.push(input); return { $metadata: metadata, Id: changeSetId, StackId: stackId }; },
    async describeChange(id, changeId) { calls.push("change"); assert.equal(id, stackId); assert.equal(changeId, changeSetId);
      return { $metadata: metadata, ChangeSetId: changeSetId, ChangeSetName: changeSetName, StackId: stackId,
        Status: opt.pending ? "CREATE_IN_PROGRESS" : "CREATE_COMPLETE", ExecutionStatus: opt.pending ? "UNAVAILABLE" : "AVAILABLE",
        Capabilities: ["CAPABILITY_NAMED_IAM"], Parameters: Object.keys(old.Parameters ?? {}).map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })),
        Changes: target.expectedChanges.map(({ logicalId, action }) => {
          const row: ResourceChange = { LogicalResourceId: logicalId, ResourceType: target.template.Resources[logicalId].Type, Action: action,
            ...(action === "Modify" && { Scope: ["Properties"], Replacement: opt.replacement ?? "False", PhysicalResourceId: share[logicalId as keyof typeof share] }) };
          return { Type: "Resource", ResourceChange: opt.editChange?.(row) ?? row };
        }) }; },
    async execute(input) { calls.push("execute"); requests.push(input); if (opt.failAcceptedExecute) throw Error("unknown write");
      executed = true; if (opt.expireAtExecuteAck) now = phasePlan.writeBefore; return { $metadata: metadata }; },
  };
  const args = { plan, approvedPlanSha256: await sha256Hex(plan), ports, journal, now: () => now, wait: async (ms: number) => { now += ms; } };
  const run = await bindFirstOpenInstallOwnerExecutor(args), sgn = new AbortController().signal;
  return { run: () => run(phase, sgn), args, calls, requests, events, changeSetName, changeSetId, target, prerequisites, slots };
}

test("exact Inspector grant emits one bound update and one execute ACK, not independent proof", async () => {
  const b = await broker("inspector-grant"), a = await b.run();
  assert.equal(a.status, "OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
  assert.equal(a.calls.changeSetOriginal, 0);
  assert.equal(a.calls.original, 1);
  assert.deepEqual(a.executeAck, { changeSetId: b.changeSetId, executedAt: anchor, targetSha256: await sha256Hex(b.target.template) });
  assert.deepEqual(b.calls, ["prerequisite", "identify", "stack", "original", "create", "change", "stack", "execute", "stack"]);
  assert.deepEqual(b.requests[0], { StackName: inspectorId, ChangeSetName: b.changeSetName, ChangeSetType: "UPDATE",
    ClientToken: `${b.changeSetName}-create`, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false,
    ImportExistingResources: false, Parameters: [], TemplateBody: (b.requests[0] as CreateChangeSetCommandInput).TemplateBody });
  assert.equal(templateHash(JSON.parse((b.requests[0] as CreateChangeSetCommandInput).TemplateBody!)), b.target.targetCanonicalSha256);
  assert.deepEqual(b.requests[1], { StackName: inspectorId, ChangeSetName: b.changeSetId, ClientRequestToken: `${b.changeSetName}-execute`, DisableRollback: false });
  assert.deepEqual(b.events.map(e => e.kind), ["create-intent", "create-ack", "execute-intent", "execute-ack", "terminal-observed"]);
  await assert.rejects(b.run(), /PHASE_ALREADY_USED_OR_UNBOUND/);
  const reopened = await bindFirstOpenInstallOwnerExecutor(b.args);
  await assert.rejects(reopened("inspector-grant", new AbortController().signal), /durable slot used/);
});

test("Provisioner grant must see its separately installed preimage; wrong preview and stale plan stop before execute", async () => {
  const drift = await broker("provisioner-grant", { liveOriginal: originalsWrong() });
  await assert.rejects(drift.run(), /PREIMAGE/);
  assert.deepEqual(drift.requests, []);
  const changed = await broker("provisioner-grant", { replacement: "Conditional" });
  await assert.rejects(changed.run(), /CHANGE_DIFF/);
  assert.equal(changed.requests.length, 1);
  const order = structuredClone(changed.args.plan);
  order.phases["inspector-relock"].startAt = order.phases["provisioner-relock"].startAt;
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...changed.args, plan: order, approvedPlanSha256: await sha256Hex(order) }), /PHASE_CHAIN/);
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...changed.args, approvedPlanSha256: "0".repeat(64) }), /PLAN/);
});

function originalsWrong() {
  const x = fixtures().originals["provisioner-grant"];
  delete x.Resources.TenantLifecycleTaskRole;
  return x;
}

test("only preapproved version-qualified URL for the oversized shared body; prerequisites precede all AWS calls", async () => {
  const b = await broker("provisioner-grant", { large: true });
  const bad = structuredClone(b.args.plan);
  delete bad.phases["provisioner-grant"].stagedVersion;
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan: bad, approvedPlanSha256: await sha256Hex(bad) }), /STAGED_TEMPLATE_REQUIRED/);
  assert.deepEqual(b.calls, []);
  const readback = await b.run();
  assert.equal(readback.calls.changeSetOriginal, 1);
  assert.equal(readback.calls.original, 1);
  assert.deepEqual(b.calls, ["prerequisite", "identify", "stack", "original", "create", "change", "change-original", "stack", "execute", "stack"]);
  assert.deepEqual(b.events[2], { kind: "staged-template-preview-verified", at: b.args.plan.phases["provisioner-grant"].startAt,
    changeSetId: b.changeSetId, targetCanonicalSha256: b.target.targetCanonicalSha256 });
  const first = b.requests[0] as CreateChangeSetCommandInput;
  assert.equal(first.TemplateBody, undefined);
  assert.match(first.TemplateURL ?? "", new RegExp(`/install-owner/install/provisioner-grant/${b.target.targetCanonicalSha256}\\.json\\?versionId=S3%2BVersion%3D%3D$`));
  assert.deepEqual(first.Parameters, [{ ParameterKey: "ExpectedRegion", UsePreviousValue: true }]);
  const refused = await broker("provisioner-relock", { journal: { async requirePrerequisite() { throw Error("unverified Lifecycle withdrawal"); },
    async consume() {}, async record() {} } });
  await assert.rejects(refused.run(), /unverified Lifecycle withdrawal/);
  assert.deepEqual(refused.calls, []);
});

async function deferProvisioner(plan: FirstOpenInstallOwnerExecutorPlan) {
  const earlier = structuredClone(plan);
  for (const name of ["provisioner-grant", "provisioner-relock"] as const) {
    delete earlier.phases[name].stagedVersion;
    earlier.phases[name].deferredStagedVersion = { changeSetOriginalReadConsent: true };
  }
  const approvedPlanSha256 = await sha256Hex(earlier);
  const phase = "provisioner-grant", { targetCanonicalSha256, template } = earlier.phases[phase].transition;
  const proof: FirstOpenInstallOwnerDeferredStagedProof = { planSha256: approvedPlanSha256, phase, targetCanonicalSha256,
    key: firstOpenOwnerStageKey({ approvalSha256, phase, targetCanonicalSha256 }), targetBytes: Buffer.byteLength(JSON.stringify(ordinal(template))),
    versionId: "Late+Version==", independentlyVerifiedBytesReceiptSha256: "e".repeat(64) };
  return { plan: earlier, approvedPlanSha256, proof };
}

test("a frozen deferred plan executes inline Inspector first and accepts only its exact late approved staged proof", async () => {
  const inspect = await broker("inspector-grant", { large: true }), grant = await broker("provisioner-grant", { large: true });
  const { proof, ...frozen } = await deferProvisioner(inspect.args.plan);
  let active = inspect;
  const ports: FirstOpenInstallOwnerPorts = {
    identify: (...args) => active.args.ports.identify(...args),
    describeStack: (...args) => active.args.ports.describeStack(...args),
    getOriginal: (...args) => active.args.ports.getOriginal(...args),
    getChangeSetOriginal: (...args) => active.args.ports.getChangeSetOriginal!(...args),
    create: (...args) => active.args.ports.create(...args),
    describeChange: (...args) => active.args.ports.describeChange(...args),
    execute: (...args) => active.args.ports.execute(...args),
  };
  const durableSlots = new Set<string>();
  let permitProof = false;
  const journal: FirstOpenInstallOwnerJournal = {
    async consume(slot, binding) {
      assert.ok(!durableSlots.has(slot));
      assert.equal(binding.planSha256, frozen.approvedPlanSha256);
      if (binding.phase === "provisioner-grant") assert.equal(active.calls.at(-1), "prerequisite");
      durableSlots.add(slot);
    },
    async requirePrerequisite(binding) {
      active.calls.push("prerequisite");
      assert.equal(binding.planSha256, frozen.approvedPlanSha256);
      if (binding.phase === "inspector-grant") assert.equal(binding.stagedTemplate, null);
      else {
        assert.ok(permitProof);
        assert.deepEqual(binding.stagedTemplate?.deferredProof, proof);
        assert.ok(!durableSlots.has(`${s.jobId}:${approvalSha256}:install:provisioner-grant`));
      }
    },
    async record(_slot, event) { active.events.push(event); },
  };
  const run = await bindFirstOpenInstallOwnerExecutor({ ...frozen, ports, journal, now: () => active.args.now() });
  const signal = new AbortController().signal;
  await assert.rejects(run("inspector-grant", signal, proof), /DEFERRED_STAGE_PROOF_UNEXPECTED/);
  assert.deepEqual(inspect.calls, []);
  const inline = await run("inspector-grant", signal);
  assert.equal(inline.calls.changeSetOriginal, 0);
  assert.equal((inspect.requests[0] as CreateChangeSetCommandInput).TemplateURL, undefined);
  active = grant;
  await assert.rejects(run("provisioner-grant", signal), /DEFERRED_STAGE_PROOF_REQUIRED/);
  for (const wrong of [
    { ...proof, planSha256: "f".repeat(64) }, { ...proof, phase: "provisioner-relock" as const },
    { ...proof, key: `${proof.key}.other` }, { ...proof, targetCanonicalSha256: "f".repeat(64) },
    { ...proof, targetBytes: proof.targetBytes + 1 }, { ...proof, templateURL: "unexpected" },
  ]) await assert.rejects(run("provisioner-grant", signal, wrong), /DEFERRED_STAGE_PROOF_MISMATCH/);
  assert.deepEqual(grant.calls, []);
  assert.equal(durableSlots.size, 1);
  permitProof = true;
  const result = await run("provisioner-grant", signal, structuredClone(proof));
  assert.equal(result.calls.changeSetOriginal, 1);
  assert.equal(result.calls.original, 1);
  assert.deepEqual(grant.calls, ["prerequisite", "stack", "original", "create", "change", "change-original", "stack", "execute", "stack"]);
  const submitted = grant.requests[0] as CreateChangeSetCommandInput;
  assert.equal(submitted.TemplateBody, undefined);
  assert.match(submitted.TemplateURL ?? "", new RegExp(`/${proof.key.replace(/\.json$/, "\\.json")}\\?versionId=Late%2BVersion%3D%3D$`));
  assert.equal(await sha256Hex(frozen.plan), frozen.approvedPlanSha256);
  assert.equal(durableSlots.size, 2);
  await assert.rejects(run("provisioner-grant", signal, { ...proof, versionId: "Other" }), /PHASE_ALREADY_USED_OR_UNBOUND/);
});

test("late staged evidence requires the protected journal before any slot or AWS call", async () => {
  const grant = await broker("provisioner-grant", { large: true }), { proof, ...frozen } = await deferProvisioner(grant.args.plan);
  const signal = new AbortController().signal;
  let checked = 0;
  const run = await bindFirstOpenInstallOwnerExecutor({ ...grant.args, ...frozen, journal: {
    async requirePrerequisite(binding) {
      checked++;
      assert.deepEqual(binding.stagedTemplate?.deferredProof, proof);
      throw Error("separately trusted receipt unproved");
    },
    async consume() { assert.fail("unverified proof cannot consume a slot"); },
    async record() { assert.fail("unverified proof cannot journal a write"); },
  } });
  await assert.rejects(run("provisioner-grant", signal, proof), /receipt unproved/);
  await assert.rejects(run("provisioner-grant", signal, { ...proof, versionId: "Alternative" }), /PHASE_ALREADY_USED_OR_UNBOUND/);
  assert.equal(checked, 1);
  assert.deepEqual(grant.calls, []);

  const unsigned = structuredClone(frozen.plan);
  Reflect.deleteProperty(unsigned.phases["provisioner-grant"].deferredStagedVersion!, "changeSetOriginalReadConsent");
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...grant.args, plan: unsigned, approvedPlanSha256: await sha256Hex(unsigned) }),
    /CHANGE_ORIGINAL_READ_CONSENT/);
  const conflicting = structuredClone(frozen.plan);
  conflicting.phases["provisioner-grant"].stagedVersion = grant.args.plan.phases["provisioner-grant"].stagedVersion;
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...grant.args, plan: conflicting, approvedPlanSha256: await sha256Hex(conflicting) }),
    /STAGED_TEMPLATE/);
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...grant.args, ...frozen, ports: { ...grant.args.ports, getChangeSetOriginal: undefined } }),
    /CHANGE_ORIGINAL_PORT_REQUIRED/);
});

function sharedFixture(original?: Template) {
  const input = fixtures(true);
  const before = original ?? input.originals["provisioner-grant"], prepared = structuredClone(before);
  const provisioner = prepared.Resources.ProvisionerRole.Properties;
  provisioner.Policies = [{ testOnlyDeny: true }];
  const lifecycle = prepared.Resources.TenantLifecycleTaskRole;
  lifecycle.Properties.PermissionsBoundary = { Ref: lifecycleBoundary };
  lifecycle.Properties.Policies = [{ testOnlyLifecyclePolicy: true }];
  prepared.Resources[lifecycleBoundary] = { Type: "AWS::IAM::ManagedPolicy", ...(lifecycle.Condition !== undefined && { Condition: lifecycle.Condition }),
    Properties: { ManagedPolicyName: "TechlongSandboxFirstOpenFc41597fLifecycleBoundary", PolicyDocument: { Version: "2012-10-17", Statement: [] } } };
  const preparedHash = templateHash(prepared);
  input.plan.phases["shared-predecessor"] = { startAt: anchor + 120_000, writeBefore: anchor + 240_000, sourceStackStatus: "UPDATE_COMPLETE",
    deferredStagedVersion: { changeSetOriginalReadConsent: true }, transition: { stackId: sharedId, originalCanonicalSha256: sharedOriginalPin,
      template: prepared, targetCanonicalSha256: preparedHash,
      expectedChanges: [change("ProvisionerRole"), change("TenantLifecycleTaskRole"), { logicalId: lifecycleBoundary, action: "Add" }] } };
  const { "provisioner-grant": pg, "provisioner-relock": pr, "inspector-relock": ir } = input.plan.phases;
  for (const phase of [pg, pr, ir]) { phase.startAt += 120_000; phase.writeBefore += 120_000; }
  const granted = structuredClone(prepared);
  granted.Resources.ProvisionerRole.Properties.Policies = [{ testOnlyAllow: true }];
  (granted.Resources.ProvisionerBoundary.Properties.PolicyDocument as { Statement: unknown[] }).Statement.push({ testOnlyAllow: true });
  Object.assign(pg.transition, { originalCanonicalSha256: preparedHash, template: granted, targetCanonicalSha256: templateHash(granted) });
  Object.assign(pr.transition, { originalCanonicalSha256: pg.transition.targetCanonicalSha256, template: prepared, targetCanonicalSha256: preparedHash });
  return { plan: input.plan, originals: { ...input.originals, "shared-predecessor": before, "provisioner-grant": prepared, "provisioner-relock": granted } };
}

function sharedProof(planSha256: string, target: FirstOpenInstallOwnerTransition): FirstOpenInstallOwnerDeferredStagedProof {
  const phase = "shared-predecessor", targetCanonicalSha256 = target.targetCanonicalSha256;
  return { planSha256, phase, targetCanonicalSha256, key: firstOpenOwnerStageKey({ approvalSha256, phase, targetCanonicalSha256 }),
    targetBytes: Buffer.byteLength(JSON.stringify(ordinal(target.template))), versionId: "Shared+Version==",
    independentlyVerifiedBytesReceiptSha256: "e".repeat(64) };
}

test("the optional shared phase requires a chained exact preimage/deferred proof; install Grant authenticates its independent Original evidence first", async () => {
  const input = sharedFixture(), b = await mockLane("shared-predecessor", input, {}), signal = new AbortController().signal;
  const run = await bindFirstOpenInstallOwnerExecutor(b.args), proof = sharedProof(b.args.approvedPlanSha256, b.target);
  await assert.rejects(run("shared-predecessor", signal), /DEFERRED_STAGE_PROOF_REQUIRED/);
  await assert.rejects(run("shared-predecessor", signal, { ...proof, key: `${proof.key}.wrong` }), /DEFERRED_STAGE_PROOF_MISMATCH/);
  assert.deepEqual(b.calls, []);
  assert.deepEqual([...b.slots], []);
  await assert.rejects(run("shared-predecessor", signal, proof), /PREIMAGE/);
  assert.deepEqual(b.requests, []);

  for (const [edit, code] of [
    [(p: FirstOpenInstallOwnerExecutorPlan) => { delete p.phases["shared-predecessor"]!.deferredStagedVersion; }, /SHARED_PREDECESSOR_STAGING_REQUIRED/],
    [(p: FirstOpenInstallOwnerExecutorPlan) => { p.phases["shared-predecessor"]!.transition.originalCanonicalSha256 = "e".repeat(64); }, /SHARED_PREDECESSOR_CHAIN/],
    [(p: FirstOpenInstallOwnerExecutorPlan) => { p.phases["provisioner-grant"].transition.originalCanonicalSha256 = "e".repeat(64); }, /SHARED_PREDECESSOR_CHAIN/],
    [(p: FirstOpenInstallOwnerExecutorPlan) => { p.phases["shared-predecessor"]!.startAt -= 1; }, /PHASE_CHAIN/],
    [(p: FirstOpenInstallOwnerExecutorPlan) => { p.phases["shared-predecessor"]!.transition.expectedChanges = [change("ProvisionerRole")]; }, /PLAN_TARGET/],
  ] as const) {
    const plan = structuredClone(input.plan); edit(plan);
    await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan, approvedPlanSha256: await sha256Hex(plan) }), code);
  }

  const pg = await mockLane("provisioner-grant", input, {});
  const denied = await bindFirstOpenInstallOwnerExecutor({ ...pg.args, journal: {
    async consume() { assert.fail("unverified shared predecessor cannot consume a slot"); },
    async requirePrerequisite(binding) {
      assert.deepEqual(binding.prerequisite, { kind: "verified-shared-predecessor", targetCanonicalSha256: b.target.targetCanonicalSha256 });
      throw Error("independent shared Original absent");
    },
    async record() { assert.fail("no writes allowed"); },
  } });
  await assert.rejects(denied("provisioner-grant", signal), /independent shared Original absent/);
  assert.deepEqual(pg.calls, []);
  assert.equal((await pg.run()).status, "OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
  assert.deepEqual(pg.prerequisites[0].prerequisite,
    { kind: "verified-shared-predecessor", targetCanonicalSha256: b.target.targetCanonicalSha256 });
});

test("shared predecessor accepts only two native Modify and one Add, verifies exact ChangeSet Original, and observes the native terminal", async t => {
  const sealedPath = ".local-secrets/first-open-fc41597f-iam-originals-woNyuO/shared-original.template";
  if (!existsSync(sealedPath)) return t.skip("sealed exact shared Original unavailable");
  const actual = JSON.parse(readFileSync(sealedPath, "utf8")) as Template;
  assert.equal(templateHash(actual), sharedOriginalPin);
  const input = sharedFixture(actual), b = await mockLane("shared-predecessor", input, { editChange: row =>
    row.LogicalResourceId === "TenantLifecycleTaskRole" ? { ...row, Details: [
      { Target: { Attribute: "Properties", Name: "PermissionsBoundary", RequiresRecreation: "Never" } },
    ] } : row }), signal = new AbortController().signal;
  const once = (fixture: typeof b) => async () => (await bindFirstOpenInstallOwnerExecutor(fixture.args))("shared-predecessor", signal,
    sharedProof(fixture.args.approvedPlanSha256, fixture.target));
  const completed = await once(b)();
  assert.equal(completed.status, "OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
  assert.match(completed.executeAck.changeSetId, /changeSet\/fc41597f-install-shared-a{24}-prepare\//);
  assert.deepEqual(b.calls, ["prerequisite", "identify", "stack", "original", "create", "change", "change-original", "stack", "execute", "stack"]);
  assert.deepEqual([...b.slots], [`${s.jobId}:${approvalSha256}:install:shared-predecessor`]);
  assert.equal(b.events.at(-1)?.kind, "terminal-observed");
  assert.equal(completed.calls.changeSetOriginal, 1);
  assert.equal((b.requests[1] as ExecuteChangeSetCommandInput).DisableRollback, false);
  for (const [opt, code] of [
    [{ editChange: (row: ResourceChange) => row.LogicalResourceId === lifecycleBoundary ? { ...row, Action: "Modify" as const } : row }, /CHANGE_DIFF/],
    [{ editChange: (row: ResourceChange) => row.LogicalResourceId === lifecycleBoundary ? { ...row, PolicyAction: "Delete" as const } : row }, /CHANGE_DIFF/],
    [{ replacement: "True" as const }, /CHANGE_DIFF/],
    [{ changeOriginal: () => ({ TemplateBody: JSON.stringify(actual) }) }, /CHANGE_ORIGINAL_TARGET/],
  ] as const) {
    const attempted = await mockLane("shared-predecessor", input, opt);
    await assert.rejects(once(attempted)(), code);
    assert.equal(attempted.calls.includes("execute"), false);
    assert.equal(attempted.requests.length, 1);
  }
});

test("staged proof needs exact read consent and evidence of the actual Original stage", async () => {
  const b = await broker("provisioner-grant", { large: true });
  const denied = structuredClone(b.args.plan);
  const version = denied.phases["provisioner-grant"].stagedVersion!;
  Reflect.deleteProperty(version, "changeSetOriginalReadConsent");
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan: denied, approvedPlanSha256: await sha256Hex(denied) }), /CHANGE_ORIGINAL_READ_CONSENT/);
  Object.assign(version, { changeSetOriginalReadConsent: true, extraRead: true });
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan: denied, approvedPlanSha256: await sha256Hex(denied) }), /CHANGE_ORIGINAL_READ_CONSENT/);
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, ports: { ...b.args.ports, getChangeSetOriginal: undefined } }), /CHANGE_ORIGINAL_PORT_REQUIRED/);
  assert.deepEqual(b.calls, []);
  for (const [changeOriginal, code] of [
    [() => ({ StagesAvailable: undefined }), /CHANGE_ORIGINAL_STAGE/],
    [() => ({ StagesAvailable: ["Processed"] as const }), /CHANGE_ORIGINAL_STAGE/],
    [() => ({ TemplateBody: JSON.stringify(originalsWrong()) }), /CHANGE_ORIGINAL_TARGET/],
    [() => { throw Error("unverified staged read"); }, /OWNER_READ_STOP_NO_RETRY/],
  ] as const) {
    const caseCheck = await broker("provisioner-grant", { large: true, changeOriginal: changeOriginal as Options["changeOriginal"] });
    await assert.rejects(caseCheck.run(), code);
    await assert.rejects(caseCheck.run(), /PHASE_ALREADY_USED_OR_UNBOUND/);
    assert.equal(caseCheck.calls.filter(x => x === "change-original").length, 1);
    assert.ok(!caseCheck.calls.includes("execute"));
    assert.equal(caseCheck.events.at(-1)?.kind, "create-ack");
  }
});

test("poll budget, late ACK, unknown execution and independently unavailable terminal produce no replay", async () => {
  const pending = await broker("inspector-grant", { pending: true });
  await assert.rejects(pending.run(), /CHANGE_UNAVAILABLE/);
  assert.equal(pending.calls.filter(x => x === "change").length, 4);
  assert.equal(pending.calls.includes("execute"), false);
  const bad = await broker("inspector-grant", { failAcceptedExecute: true });
  await assert.rejects(bad.run(), /EXECUTE_STOP_NO_RETRY/);
  await assert.rejects(bad.run(), /PHASE_ALREADY_USED_OR_UNBOUND/);
  assert.equal(bad.calls.filter(x => x === "execute").length, 1);
  assert.equal(bad.events.at(-1)?.kind, "execute-intent");
  const late = await broker("inspector-grant", { expireAtExecuteAck: true });
  await assert.rejects(late.run(), /PHASE_WINDOW/);
  assert.equal(late.events.at(-1)?.kind, "execute-ack");
  const terminal = await broker("inspector-grant", { neverTerminal: true });
  await assert.rejects(terminal.run(), /TERMINAL_UNPROVED_NO_RETRY/);
  assert.equal(terminal.calls.filter(x => x === "stack").length, 6);
});

test("transport rejects an ambient or long-term key and the plan rejects unknown phases", async () => {
  const b = await broker("inspector-grant"), p = structuredClone(b.args.plan);
  await assert.rejects(bindFirstOpenInstallOwnerSdkExecutor({ ...b.args, credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } }),
    /FIXED_SOURCE_REQUIRED/);
  const prior = { ...p, schema: "techlong/fc41597f-install-owner-transitions/v1" };
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan: prior as unknown as FirstOpenInstallOwnerExecutorPlan,
    approvedPlanSha256: await sha256Hex(prior) }), /PLAN/);
  Object.assign(p.phases, { phases: phaseNames });
  await assert.rejects(bindFirstOpenInstallOwnerExecutor({ ...b.args, plan: p, approvedPlanSha256: await sha256Hex(p) }), /PLAN/);
});

test("formal and installation use disjoint CFN names, durable slots and staged paths even with the same approval and grant bytes", async () => {
  const install = await broker("provisioner-grant", { large: true }), formal = await formalBroker("formal-provisioner-grant", { large: true });
  assert.equal(install.target.targetCanonicalSha256, formal.target.targetCanonicalSha256);
  const [installation, active] = await Promise.all([install.run(), formal.run()]);
  assert.equal(installation.calls.changeSetOriginal, 1);
  assert.equal(active.calls.changeSetOriginal, 1);
  assert.match(installation.executeAck.changeSetId, /changeSet\/fc41597f-install-provisioner-a{24}-grant\//);
  assert.match(active.executeAck.changeSetId, /changeSet\/fc41597f-provisioner-a{24}-grant\//);
  assert.deepEqual([...install.slots], [`${s.jobId}:${approvalSha256}:install:provisioner-grant`]);
  assert.deepEqual([...formal.slots], [`${s.jobId}:${approvalSha256}:formal-provisioner:formal-provisioner-grant`]);
  assert.match((formal.requests[0] as CreateChangeSetCommandInput).TemplateURL ?? "", /\/install-owner\/formal-provisioner\/formal-provisioner-grant\//);
  assert.deepEqual(formal.prerequisites[0].prerequisite, { kind: "verified-closed-install-readback", receiptSha256: "c".repeat(64) });
  const misuse = await bindFirstOpenInstallOwnerExecutor(install.args);
  await assert.rejects(misuse("formal-provisioner-grant", new AbortController().signal), /PHASE_ALREADY_USED_OR_UNBOUND/);
});

test("formal writer requires established entire predecessor, exact restoration and independent Lifecycle relock prerequisite", async () => {
  const relock = await formalBroker("formal-provisioner-relock");
  assert.match((await relock.run()).executeAck.changeSetId, /changeSet\/fc41597f-provisioner-a{24}-relock\//);
  assert.deepEqual(relock.prerequisites[0].prerequisite, { kind: "verified-formal-lifecycle-relock" });
  const reject = async (p: FirstOpenFormalProvisionerExecutorPlan) => assert.rejects(bindFirstOpenInstallOwnerExecutor({
    ...relock.args, plan: p, approvedPlanSha256: await sha256Hex(p),
  }), /FORMAL_PREDECESSOR_CHAIN/);
  const historical = structuredClone(relock.args.plan);
  historical.installedSharedPredecessorCanonicalSha256 = "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360";
  historical.phases["formal-provisioner-grant"].transition.originalCanonicalSha256 = historical.installedSharedPredecessorCanonicalSha256;
  await reject(historical);
  const unrelated = structuredClone(relock.args.plan);
  unrelated.phases["formal-provisioner-relock"].transition.template.Resources.TenantLifecycleTaskRole.Properties.RoleName = "Different";
  unrelated.phases["formal-provisioner-relock"].transition.targetCanonicalSha256 = templateHash(unrelated.phases["formal-provisioner-relock"].transition.template);
  await reject(unrelated);
  const denied = await formalBroker("formal-provisioner-relock", { journal: { async requirePrerequisite(binding) {
    assert.equal(binding.lane, "formal-provisioner");
    assert.deepEqual(binding.prerequisite, { kind: "verified-formal-lifecycle-relock" });
    throw Error("no real Lifecycle readback");
  }, async consume() {}, async record() {} } });
  await assert.rejects(denied.run(), /no real Lifecycle readback/);
  assert.deepEqual(denied.calls, []);
});
