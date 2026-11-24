import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING as fixed } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { bindFirstOpenInstallBucketExecutor, firstOpenInstallBucketTargets } from "./first-open-install-bucket-executor.ts";
import { bindFirstOpenInstallStagingWriter } from "./first-open-install-staging-writer.ts";
import { bindFirstOpenInstallOwnerExecutor, type FirstOpenInstallOwnerExecutorPlan, type FirstOpenInstallOwnerPhase,
  type FirstOpenInstallOwnerJournal, type FirstOpenInstallOwnerExecuteAck } from "./first-open-install-owner-executor.ts";
import { buildFirstOpenInstallReadbackPlan, assertFirstOpenInstallReadbackAck, type FirstOpenInstallReadbackPlan } from "./first-open-install-readback.ts";
import { bindFirstOpenInstallReadbackArtifacts } from "./first-open-install-readback-artifacts.ts";
import { firstOpenInstallInspectorScope } from "./first-open-install-inspector-scope.ts";
import { bindFirstOpenInstallIndependentBucket, type FirstOpenInstallIndependentBucketPorts } from "./first-open-install-independent-bucket.ts";
import { bindFirstOpenInstallSourceTerminalPorts } from "./first-open-install-terminal-source.ts";
import { verifyFirstOpenOwnerStageReceipts } from "./first-open-owner-stage-proof.ts";
import { createFirstOpenInstallJournal } from "./first-open-install-journal.ts";
import { parseCloudFormationTemplateDocument } from "./scripts/cloudformation-template-document.mjs";
import type { FirstOpenHostSourcePhase } from "./first-open-install-host-source.ts";

type Bucket = Parameters<typeof bindFirstOpenInstallBucketExecutor>[0];
type Writer = Parameters<typeof bindFirstOpenInstallStagingWriter>[0];
type Owner = Parameters<typeof bindFirstOpenInstallOwnerExecutor>[0];
type Readback = Parameters<typeof buildFirstOpenInstallReadbackPlan>[0];
type StageReadback = NonNullable<Readback["staging"]>["scope"];
type Identity = { Account: string; Arn: string; UserId: string };
type Observation = { identity: Identity; changeSetId: string; observedAt: number; templateSha256: string; policySha256?: string; matched: true };
type SourceSnapshot = Parameters<typeof bindFirstOpenInstallSourceTerminalPorts>[0]["credentials"];
export const firstOpenInstallSourceSessionPolicy = "bounded-same-iam-source/v1" as const;
export type FirstOpenInstallSequencePlan = {
  schema: "techlong/fc41597f-install-sequence/v1";
  bucket: Bucket["plan"];
  owner: FirstOpenInstallOwnerExecutorPlan;
  readback: Omit<Readback, "staging"> & { stagingScope: StageReadback };
} & ({ independentReader: Identity; terminalReadback?: never; sourceSessionPolicy?: never } |
  { terminalReadback: "same-source-readonly-subprocess"; independentReader?: never; sourceSessionPolicy?: typeof firstOpenInstallSourceSessionPolicy });
const phases = [["shared", "shared-predecessor"], ["grant", "provisioner-grant"], ["relock", "provisioner-relock"]] as const;
const check = (v: unknown, code: string) => { if (!v) throw Error("FIRST_OPEN_INSTALL_SEQUENCE_" + code); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hex = /^[a-f0-9]{64}$/, id = /^[1-9][0-9]{0,19}$/;
const account = "402010193138", sourceId = "AIDAV3GNMXTZEO7SHLC2X";
const sourceRecord: Identity = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: sourceId };

/** Source-side write confirmation only. The protected Inspector must still
 * read and authenticate the active policy before CFN can consume a version. */
export async function readFirstOpenSourceProtection(read: FirstOpenInstallIndependentBucketPorts["getBucketPolicy"],
  expectedSha256: string, signal: AbortSignal) {
  check(hex.test(expectedSha256), "SOURCE_PROTECTION_PIN");
  signal.throwIfAborted();
  const got = await read({ Bucket: fixed.bucket, ExpectedBucketOwner: "402010193138" }, signal);
  signal.throwIfAborted();
  check(got?.$metadata?.httpStatusCode === 200 && (got.$metadata.attempts === undefined || got.$metadata.attempts === 1) &&
    typeof got.Policy === "string" && Buffer.byteLength(got.Policy) <= 32_768, "SOURCE_PROTECTION_RESPONSE");
  let policy: unknown;
  try { policy = JSON.parse(got.Policy!); } catch { throw Error("FIRST_OPEN_INSTALL_SEQUENCE_SOURCE_PROTECTION_RESPONSE"); }
  const policySha256 = await sha256Hex(policy);
  signal.throwIfAborted();
  check(policySha256 === expectedSha256, "SOURCE_PROTECTION_CHANGED");
  return policySha256;
}

/** Exact no-claim installation. Terminal and GitHub inputs must be
 * authenticated provider adapters, not local JSON assertions.
 * This module does not discover an identity, publish source, or approve GitHub.
 * Failure never resubmits, guesses a VersionId, or automatically restores. */
export async function runFirstOpenInstallSequence(input: {
  plan: FirstOpenInstallSequencePlan; approvedPlanSha256: string; privateDir: string; signal: AbortSignal;
  /** Each phase has a fixed verified snapshot. No provider operation may discover or renew credentials. */
  source: { identify: Owner["ports"]["identify"]; bucket: Omit<Bucket["ports"], "identify">;
    owner: Omit<Owner["ports"], "identify">; staging: Omit<Writer["ports"], "identify">;
    getBucketPolicy: FirstOpenInstallIndependentBucketPorts["getBucketPolicy"] };
  independent?: FirstOpenInstallIndependentBucketPorts;
  terminalSourceCredentials?: SourceSnapshot;
  sourceSessions?: { openPhase(phase: FirstOpenHostSourcePhase, before: number, signal: AbortSignal): Promise<SourceSnapshot> };
  github: { artifactReadToken: string; fetch?: typeof fetch;
    verifyPublication(release: Readback["release"], signal: AbortSignal): Promise<{
      mainSha: string; runtime: string; workflowId: string; environment: string; ownerReviewRequired: boolean; adminBypass: boolean }>;
    /** Exactly one ACK for the protected plan; the human, not this port, must approve the environment. */
    dispatchInstallReadback(plan: FirstOpenInstallReadbackPlan, approvedSha256: string, signal: AbortSignal): Promise<{ runId: string }>;
    /** Readiness notification only; the named artifact is authenticated below. */
    awaitArtifact(input: { runId: string; planSha256: string; phase: "staging" | "shared" | "final" }, signal: AbortSignal): Promise<void>;
    /** After terminal success only, exact owned protected configuration. */
    cleanup(signal: AbortSignal): Promise<{ residue: readonly string[] }> };
  now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
}) {
  const { approvedPlanSha256, source, github, now = Date.now, signal: upstream } = input;
  const wait = input.wait ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const plan = structuredClone(input.plan), { bucket, owner, readback, independentReader } = plan;
  const { stagingScope, ...recipe } = readback;
  const s = fixed.jobId, sameSourceTerminal = plan.terminalReadback === "same-source-readonly-subprocess";
  const phasedSource = plan.sourceSessionPolicy === firstOpenInstallSourceSessionPolicy;
  const validSessionPolicy = plan.sourceSessionPolicy === undefined ? !input.sourceSessions :
    phasedSource && sameSourceTerminal && !!input.sourceSessions && !input.terminalSourceCredentials;
  const validTerminalReader = sameSourceTerminal ? independentReader === undefined && !input.independent &&
    (phasedSource || !!input.terminalSourceCredentials) :
    plan.terminalReadback === undefined && !input.terminalSourceCredentials && !!input.independent && independentReader?.Account === account &&
    !independentReader.UserId.startsWith(sourceId) && independentReader.Arn !== sourceRecord.Arn &&
    new RegExp(`^arn:aws:(iam|sts)::${account}:(?:user|assumed-role)/[\\w@+=,./-]+$`).test(independentReader.Arn) &&
    /^[A-Z0-9]+(?::[\w+=,.@-]{2,64})?$/.test(independentReader.UserId);
  const linked = bucket.installIntentSha256 === owner.approvalSha256 && owner.approvalSha256 === recipe.release.approvalSha256;
  check(plan.schema === "techlong/fc41597f-install-sequence/v1" && hex.test(approvedPlanSha256) && await sha256Hex(plan) === approvedPlanSha256 &&
    linked && bucket.jobId === s && owner.jobId === s && recipe.release.jobId === s && validTerminalReader && validSessionPolicy &&
    /^[A-Za-z0-9_]+$/.test(github.artifactReadToken), "APPROVED_PLAN");
  const end = bucket.factsExpireAt, phasesOwner = owner.phases;
  const checkAt = (before: number) => { upstream.throwIfAborted(); check(now() < before, "WINDOW"); };
  check(owner.factsExpireAt <= end && recipe.window.factsCutoff <= end &&
    bucket.phases.protect.writeBefore <= phasesOwner["inspector-grant"].startAt &&
    phasesOwner["inspector-grant"].writeBefore <= stagingScope.readBefore &&
    stagingScope.readBefore <= (phasesOwner["shared-predecessor"]?.startAt ?? 0) &&
    phasesOwner["inspector-relock"].writeBefore <= bucket.phases.restore.startAt &&
    bucket.phases.restore.writeBefore < end && stagingScope.sharedObservation, "PHASE_CHAIN");
  checkAt(bucket.phases.protect.writeBefore);
  const signal = (before: number) => { checkAt(before); return AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, before - now()))]); };
  const at = async (from: number, before: number) => {
    if (now() < from) await wait(from - now(), signal(before));
    checkAt(before); check(now() >= from, "PHASE_NOT_OPEN");
  };
  const target = firstOpenInstallBucketTargets(bucket);
  const protectedPolicySha256 = await sha256Hex(target.protected.template.Resources.EvidencePolicy.Properties.PolicyDocument);
  const originalPolicySha256 = await sha256Hex(target.original.template.Resources.EvidencePolicy.Properties.PolicyDocument);
  check(recipe.expectedBucketSha256 === protectedPolicySha256 && recipe.factsReceiptSha256 === bucket.ownerReadReceiptSha256,
    "BUCKET_BINDING");
  const scope = await firstOpenInstallInspectorScope(recipe.release, recipe.releaseSha256, recipe.window, stagingScope);
  check(await sha256Hex(scope) === recipe.authorityScopeSha256, "READ_SCOPE");
  const staged = Object.fromEntries(phases.map(([key, phase]) => {
    const pin = scope.staging?.targets[key], p = phasesOwner[phase], t = p?.transition;
    check(pin && t && p?.deferredStagedVersion?.changeSetOriginalReadConsent === true && p.stagedVersion === undefined &&
      t.targetCanonicalSha256 === pin.targetCanonicalSha256 &&
      bucket.stagingTargets.some(x => x.phase === phase && x.key === pin.key && x.targetBytes === pin.targetBytes &&
        x.targetCanonicalSha256 === pin.targetCanonicalSha256), "STAGING_BINDING");
    return [phase, { targetCanonicalSha256: pin!.targetCanonicalSha256, targetBytes: pin!.targetBytes }];
  })) as Writer["plan"]["targets"];

  check(await sha256Hex(recipe.targets.grant) === await sha256Hex(phasesOwner["provisioner-grant"].transition.template) &&
    await sha256Hex(recipe.targets.restore) === await sha256Hex(phasesOwner["provisioner-relock"].transition.template), "READBACK_TARGETS");

  const legacyTerminalPorts = sameSourceTerminal ? (phasedSource ? undefined : bindFirstOpenInstallSourceTerminalPorts({
    installIntentSha256: owner.approvalSha256, factsExpireAt: end, credentials: input.terminalSourceCredentials!, now,
  })) : input.independent!;
  const terminalIdentity = sameSourceTerminal ? sourceRecord : independentReader!;
  const terminalMode = sameSourceTerminal ? "same-source-readonly-subprocess" as const : "independent-principal" as const;
  const publication = await github.verifyPublication(recipe.release, signal(bucket.phases.protect.startAt));
  check(publication?.mainSha === recipe.release.callerCommit && publication.runtime === recipe.release.runtimeCommit &&
    publication.workflowId === recipe.release.workflowId && publication.environment === "techlong-sandbox-deploy" &&
    publication.ownerReviewRequired === true && publication.adminBypass === false, "PUBLICATION");
  const bucketReaderFor = (ports: FirstOpenInstallIndependentBucketPorts) => bindFirstOpenInstallIndependentBucket({
    plan: bucket, expectedIdentity: terminalIdentity, ports, restoreOnly: true,
    ...(sameSourceTerminal && { terminalSourceOnly: true as const }), now });
  const legacyReaderPort = legacyTerminalPorts && bucketReaderFor(legacyTerminalPorts);
  let verifiedReader = sameSourceTerminal ? undefined : await legacyReaderPort!.identify(signal(bucket.phases.protect.startAt));
  const save = await createFirstOpenInstallJournal(input.privateDir, owner.approvalSha256, approvedPlanSha256);
  const store = (label: string, evidence: unknown) => save.receipt(label, Buffer.from(canonicalJson(evidence)));
  const sourcePhase = async (phase: Exclude<FirstOpenHostSourcePhase, "launch">, before: number) => {
    if (!phasedSource) return undefined;
    const snapshot = await input.sourceSessions!.openPhase(phase, before, signal(before));
    const expiry = snapshot?.expiration instanceof Date ? snapshot.expiration.getTime() : NaN;
    check(Number.isSafeInteger(expiry) && expiry > before, "PHASE_SOURCE_COVERAGE");
    checkAt(before);
    await store(`source-${phase}`, { phase, openedAt: now(), before, sameIamSource: true });
    checkAt(before);
    return snapshot;
  };
  const ownerSha = await sha256Hex(owner);
  let protectedNow = false, stagingVerified = false, closed = false, sharedSeen = false, finalSeen = false;
  const late = new Map<string, string>();
  const journal: FirstOpenInstallOwnerJournal = { ...save, async requirePrerequisite(binding) {
    check(protectedNow && !closed && binding.planSha256 === ownerSha && binding.lane === "install", "OWNER_PREREQUISITE");
    if (binding.phase !== "inspector-grant") check(stagingVerified, "INDEPENDENT_STAGING_PREREQUISITE");
    if (binding.stagedTemplate?.deferredProof) check(late.get(binding.phase) ===
      binding.stagedTemplate.deferredProof.independentlyVerifiedBytesReceiptSha256, "OWNER_STAGE_PREREQUISITE");
    if (binding.phase === "provisioner-grant") check(sharedSeen, "SHARED_PREREQUISITE");
    if (binding.phase === "inspector-relock") check(finalSeen, "RELOCK_PREREQUISITE");
  } };
  let sourceIdentity: ReturnType<typeof source.identify> | undefined;
  const identify: typeof source.identify = signal => (sourceIdentity ??= source.identify(signal));
  const runOwner = await bindFirstOpenInstallOwnerExecutor({ plan: owner, approvedPlanSha256: ownerSha, ports: { ...source.owner, identify }, journal, now, wait });
  const runBucket = await bindFirstOpenInstallBucketExecutor({ plan: bucket, approvedPlanSha256: await sha256Hex(bucket), ports: { ...source.bucket, identify },
    journal: { ...save, async requirePrerequisite(binding) {
      check(binding.phase === "protect" ? !protectedNow && !closed : protectedNow && closed, "BUCKET_PREREQUISITE");
    } }, now, wait });
  const put = await bindFirstOpenInstallStagingWriter({ plan: { jobId: s, approvalSha256: owner.approvalSha256,
    startAt: recipe.window.startAt, writeBefore: stagingScope.readBefore, targets: staged }, ports: { ...source.staging, identify },
    journal: { ...save, async requireProtection() { check(protectedNow && !closed, "STAGING_UNPROTECTED"); } }, now });

  function observation(o: Observation, ack: FirstOpenInstallOwnerExecuteAck, policy: string | undefined, before: number) {
    checkAt(before);
    check(o?.matched === true && same(o.identity, terminalIdentity) && o.changeSetId === ack.changeSetId && o.templateSha256 === ack.targetSha256 &&
      o.policySha256 === policy && Number.isSafeInteger(o.observedAt) && o.observedAt >= ack.executedAt && o.observedAt <= now(), "TERMINAL_READBACK");
  }
  await at(bucket.phases.protect.startAt, bucket.phases.protect.writeBefore);
  await sourcePhase("bucket-protect", bucket.phases.protect.writeBefore);
  const protect = (await runBucket("protect", signal(bucket.phases.protect.writeBefore))).executeAck;
  const sourceCheckBefore = phasesOwner["inspector-grant"].startAt;
  await sourcePhase("source-bucket-read", sourceCheckBefore);
  const sourcePolicy = await readFirstOpenSourceProtection(source.getBucketPolicy, protectedPolicySha256, signal(sourceCheckBefore));
  checkAt(sourceCheckBefore);
  await store("source-protection-confirmed", { changeSetId: protect.changeSetId, executedAt: protect.executedAt,
    observedAt: now(), policySha256: sourcePolicy, independent: false });
  protectedNow = true;
  const run = async (phase: FirstOpenInstallOwnerPhase, proof?: Parameters<typeof runOwner>[2]) => {
    const p = phasesOwner[phase]!;
    await at(p.startAt, p.writeBefore);
    await sourcePhase(phase, p.writeBefore);
    return (await runOwner(phase, signal(p.writeBefore), proof)).executeAck;
  };
  await run("inspector-grant");
  await at(recipe.window.startAt, recipe.window.issueBefore);
  await sourcePhase("staging", recipe.window.issueBefore);
  const uploads: NonNullable<Readback["staging"]>["uploads"] = {};
  const puts = new Map<string, Uint8Array>();
  for (const [key, phase] of phases) {
    const w = await put({ phase, template: phasesOwner[phase]!.transition.template, signal: signal(recipe.window.issueBefore) });
    check(await save.receipt(`put-${key}`, w.putReceiptBytes) === w.putReceiptRawSha256, "PUT_RECEIPT");
    uploads[key] = { versionId: w.versionId, acknowledgedAt: w.acknowledgedAt, putReceiptRawSha256: w.putReceiptRawSha256 };
    puts.set(key, w.putReceiptBytes);
  }
  const protectedPlan = await buildFirstOpenInstallReadbackPlan({ ...recipe, staging: { scope: stagingScope, uploads } });
  const observerSha = await sha256Hex(protectedPlan);
  await store("observe-dispatch-intent", { observerSha });
  const { runId } = await github.dispatchInstallReadback(protectedPlan, observerSha, signal(recipe.window.issueBefore));
  check(id.test(runId), "DISPATCH_ACK");
  await store("observe-run", { observerSha, runId });
  const observer = await bindFirstOpenInstallReadbackArtifacts({ plan: protectedPlan, approvedPlanSha256: observerSha, runId,
    token: github.artifactReadToken, fetch: github.fetch, now });
  const readObserved = async <T>(phase: "staging" | "shared" | "final", before: number, read: (s: AbortSignal) => Promise<T>) => {
    const bounded = signal(before);
    await github.awaitArtifact({ runId, planSha256: observerSha, phase }, bounded);
    bounded.throwIfAborted();
    checkAt(before);
    return read(bounded);
  };
  const gets = await readObserved("staging", stagingScope.readBefore, observer.readStaging);
  const reader = { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/${scope.roleArn.split("/").at(-1)}/${scope.roleSessionName}`,
    UserId: `${scope.roleId}:${scope.roleSessionName}` };
  const deferred = new Map<string, NonNullable<Parameters<typeof runOwner>[2]>>();
  for (const [key, phase] of phases) {
    const target = staged[phase], upload = uploads[key]!, got = gets[key];
    const proof = verifyFirstOpenOwnerStageReceipts({ expected: { approvalSha256: owner.approvalSha256, phase, ...target,
      startAt: recipe.window.startAt, factsExpireAt: end, expectedReader: reader,
      putReceiptRawSha256: upload.putReceiptRawSha256, getReceiptRawSha256: got.rawSha256 },
      putReceipt: puts.get(key)!, exactGetReceipt: got.bytes }, now());
    check(await save.receipt(`get-${key}`, got.bytes) === proof.independentlyVerifiedBytesReceiptSha256, "GET_RECEIPT");
    late.set(phase, proof.independentlyVerifiedBytesReceiptSha256);
    deferred.set(phase, { planSha256: ownerSha, phase, ...target, key: proof.key, versionId: proof.versionId,
      independentlyVerifiedBytesReceiptSha256: proof.independentlyVerifiedBytesReceiptSha256 });
  }
  await store("independent-staging-confirmed", { runId, observerSha, policySha256: recipe.expectedBucketSha256,
    stageReceiptSha256: Object.fromEntries(late) });
  stagingVerified = true;
  const shared = await run("shared-predecessor", deferred.get("shared-predecessor"));
  await at(stagingScope.sharedObservation!.at, stagingScope.sharedObservation!.before);
  const observedShared = await readObserved("shared", stagingScope.sharedObservation!.before, s => observer.readSharedPredecessor(shared, s));
  await store("shared-observed", observedShared.report);
  sharedSeen = true;
  const grant = await run("provisioner-grant", deferred.get("provisioner-grant"));
  const relock = await run("provisioner-relock", deferred.get("provisioner-relock"));
  await at(recipe.window.relockAt, recipe.window.relockBefore);
  const final = await readObserved("final", phasesOwner["inspector-relock"].startAt, observer.readFinal);
  for (const [phase, ack] of [["grant", grant], ["relock", relock]] as const) {
    assertFirstOpenInstallReadbackAck(final.report, phase, { lane: protectedPlan.lane, approvalSha256: owner.approvalSha256,
      planSha256: observerSha, runId, ...ack });
  }
  await store("observer-final", final.report);
  finalSeen = true;
  const inspector = await run("inspector-relock");
  const closingBefore = bucket.phases.restore.startAt;
  const inspectorSnapshot = await sourcePhase("terminal-inspector", closingBefore);
  const terminalPorts = inspectorSnapshot ? bindFirstOpenInstallSourceTerminalPorts({
    installIntentSha256: owner.approvalSha256, factsExpireAt: closingBefore, credentials: inspectorSnapshot, phase: "inspector", now,
  }) : legacyTerminalPorts!;
  const closing = signal(closingBefore), inspectorStack = phasesOwner["inspector-relock"].transition.stackId;
  if (!verifiedReader) {
    if (phasedSource) {
      const who = await terminalPorts.identify(closing);
      check(who.$metadata?.httpStatusCode === 200 && who.$metadata.attempts === 1 &&
        who.Account === account && who.Arn === sourceRecord.Arn && who.UserId === sourceId, "TERMINAL_SOURCE_IDENTITY");
      verifiedReader = sourceRecord;
    } else verifiedReader = await legacyReaderPort!.identify(closing);
  }
  const closedStack = await terminalPorts.describeStack(inspectorStack, closing);
  const closedChange = await terminalPorts.describeChange(inspectorStack, inspector.changeSetId, closing);
  const closedOriginal = await terminalPorts.getOriginal(inspectorStack, closing);
  closing.throwIfAborted();
  check([closedStack, closedChange, closedOriginal].every(r => r.$metadata?.httpStatusCode === 200 &&
    (r.$metadata.attempts === undefined || r.$metadata.attempts === 1)) &&
    closedStack.Stacks?.length === 1 && !closedStack.NextToken && closedStack.Stacks[0].StackId === inspectorStack &&
    closedStack.Stacks[0].StackStatus === "UPDATE_COMPLETE" && closedChange.StackId === inspectorStack &&
    closedChange.ChangeSetId === inspector.changeSetId && !closedChange.NextToken && closedChange.Status === "CREATE_COMPLETE" &&
    closedChange.ExecutionStatus === "EXECUTE_COMPLETE" && closedChange.Changes?.length === 1 &&
    closedChange.Changes[0].ResourceChange?.LogicalResourceId === "LockedInspectorRole" &&
    closedChange.Changes[0].ResourceChange.ResourceType === "AWS::IAM::Role" &&
    closedChange.Changes[0].ResourceChange.PhysicalResourceId === "TechlongSandboxFirstOpenInspector" &&
    closedChange.Changes[0].ResourceChange.Action === "Modify" && closedChange.Changes[0].ResourceChange.Replacement === "False" &&
    closedOriginal.StagesAvailable?.includes("Original"), "INSPECTOR_TERMINAL");
  const closedRead = { identity: verifiedReader, changeSetId: closedChange.ChangeSetId!, observedAt: now(),
    templateSha256: await sha256Hex(parseCloudFormationTemplateDocument(closedOriginal.TemplateBody)), matched: true as const };
  observation(closedRead, inspector, undefined, bucket.phases.restore.startAt);
  await store("inspector-closed", { ...closedRead, terminalMode, independentPrincipal: !sameSourceTerminal });
  closed = true;
  await at(bucket.phases.restore.startAt, bucket.phases.restore.writeBefore);
  await sourcePhase("bucket-restore", bucket.phases.restore.writeBefore);
  const restore = (await runBucket("restore", signal(bucket.phases.restore.writeBefore))).executeAck;
  const restoredAck = { changeSetId: restore.changeSetId, executedAt: restore.executedAt, targetSha256: restore.targetCanonicalSha256 };
  const bucketSnapshot = await sourcePhase("terminal-bucket", end);
  const readerPort = bucketSnapshot ? bucketReaderFor(bindFirstOpenInstallSourceTerminalPorts({
    installIntentSha256: owner.approvalSha256, factsExpireAt: end, credentials: bucketSnapshot, phase: "bucket", now,
  })) : legacyReaderPort!;
  if (phasedSource) await readerPort.identify(signal(end));
  const bucketRead = await readerPort.bucket("restore", restoredAck, signal(end));
  observation(bucketRead, restoredAck, originalPolicySha256, end);
  const receiptSha256 = await store("bucket-restored", { ...bucketRead, terminalMode, independentPrincipal: !sameSourceTerminal });
  const configuration = await github.cleanup(signal(end));
  await store("github-configuration-close", configuration);
  checkAt(end);
  check(configuration.residue.length === 0, "GITHUB_CONFIGURATION_RESIDUE");
  return { status: "INSTALL_VERIFIED_NO_CLAIM" as const, terminalMode, independentPrincipal: !sameSourceTerminal, runId, receiptSha256 };
}
