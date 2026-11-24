import { setTimeout as delay } from "node:timers/promises";
import type { DescribeChangeSetCommandOutput, DescribeStacksCommandOutput, GetTemplateCommandOutput,
  ListChangeSetsCommandOutput, CreateChangeSetCommandInput, ExecuteChangeSetCommandInput } from "@aws-sdk/client-cloudformation";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { canonical as ordinal, hash as templateHash } from "../temporary-idle/environment-cfn.mjs";
import { parseCloudFormationTemplateDocument } from "./scripts/cloudformation-template-document.mjs";
import { firstOpenOwnerStageKey } from "./first-open-owner-stage-proof.ts";
import type { FirstOpenInstallOwnerPorts } from "./first-open-install-owner-executor.ts";

const account = "402010193138", region = "ca-central-1", { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const source = `arn:aws:iam::${account}:user/techlong-sandbox-dev`, sourceId = "AIDAV3GNMXTZEO7SHLC2X";
const cfn = `arn:aws:cloudformation:${region}:${account}:`;
export const firstOpenInstallBucketStack = cfn + "stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5";
const originalSha = "a2133a1b68792fe124bc0c816ca920baa28751f2f278057f495524d08593bcf6";
const policyOriginalSha = "818a51232d0ecb8fa6d8f6f548b1465e72101be305225b0829e3555bf7dbaf1a";
const sid = "ProtectFc41597InstallStageVersions", schema = "techlong/fc41597f-install-bucket-retention/v1";
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stages = ["shared-predecessor", "provisioner-grant", "provisioner-relock"] as const;
export const firstOpenInstallBucketLimits = Object.freeze({ describeStack: 6, original: 2, listChangeSets: 1,
  changeSetOriginal: 1, create: 1, describeChange: 5, execute: 1 });
const same = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y);
const keys = (x: object) => Object.keys(x).sort();
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_BUCKET_" + code); };
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
const exact = (x: object | undefined, wanted: string[]) => !!x && same(keys(x), [...wanted].sort());
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const clock = (x: unknown): x is number => Number.isSafeInteger(x) && typeof x === "number" && x > 0;

type Phase = "protect" | "restore";
type Window = { startAt: number; writeBefore: number };
type StageTarget = { phase: (typeof stages)[number]; key: string; targetCanonicalSha256: string; targetBytes: number };
type Policy = Record<string, unknown> & { Statement: Record<string, unknown>[] };
type Resource = Record<string, unknown> & { Type: string; Properties: Record<string, unknown> };
type Template = Record<string, unknown> & { Resources: Record<string, Resource> };
export interface FirstOpenInstallBucketPlan {
  schema: typeof schema;
  jobId: typeof jobId;
  installIntentSha256: string;
  ownerReadReceiptSha256: string;
  factsExpireAt: number;
  original: object;
  stagingTargets: StageTarget[];
  phases: Record<Phase, Window>;
}
export type FirstOpenInstallBucketPorts = FirstOpenInstallOwnerPorts & {
  listChangeSets(stackId: string, signal: AbortSignal): Promise<ListChangeSetsCommandOutput>;
};
type Binding = { phase: Phase; planSha256: string; installIntentSha256: string; ownerReadReceiptSha256: string; stackId: string;
  changeSetName: string; originalCanonicalSha256: string; targetCanonicalSha256: string; targetPolicyOrdinalSha256: string;
  prerequisite: "verified-original-owner-and-bucket" | "verified-active-bucket-retention-and-dependent-stage-closure" };
type ExecuteAck = { changeSetId: string; executedAt: number; targetCanonicalSha256: string };
type Event = { kind: "create-intent" | "create-ack" | "preview-verified" | "execute-intent" | "execute-ack" | "terminal-observed";
  at: number; requestSha256?: string; changeSetId?: string; executeAck?: ExecuteAck };
export interface FirstOpenInstallBucketJournal {
  /** Exclusive and durable. No resetting after unknown provider outcomes. */
  consume(slot: string, binding: Binding): Promise<void>;
  record(slot: string, event: Event): Promise<void>;
  /** Authenticate the independent evidence, not just the fields in binding.
   * Restore requires the active retained policy and all dependent staged
   * reads/updates closed, not a timer or a Source Execute ACK alone. */
  requirePrerequisite(binding: Binding, signal: AbortSignal): Promise<void>;
}

function decoded(value: unknown) {
  let t: unknown;
  try { t = parseCloudFormationTemplateDocument(value); } catch { return fail("TEMPLATE_SHAPE"); }
  need(record(t) && record(t.Resources), "TEMPLATE_SHAPE");
  return t as Template;
}
function document(t: Template) {
  const p = t.Resources.EvidencePolicy;
  need(p?.Type === "AWS::S3::BucketPolicy" && p.DependsOn === "EvidenceBucket" &&
    same(p.Properties?.Bucket, { Ref: "EvidenceBucket" }) && t.Resources.EvidenceBucket?.Type === "AWS::S3::Bucket" &&
    t.Resources.EvidenceBucket.Properties?.BucketName === bucket && record(p.Properties.PolicyDocument), "POLICY_OWNER");
  const d = p.Properties.PolicyDocument;
  need(d.Version === "2012-10-17" && Array.isArray(d.Statement) && d.Statement.every(record), "POLICY_SHAPE");
  return d as Policy;
}

/** Only a byte-bound original is accepted; callers cannot supply target bytes or a policy statement. */
export function firstOpenInstallBucketTargets(input: Pick<FirstOpenInstallBucketPlan, "original" | "installIntentSha256" | "stagingTargets">) {
  const { installIntentSha256, stagingTargets, original } = structuredClone(input);
  need(typeof installIntentSha256 === "string" && hex.test(installIntentSha256) && Array.isArray(stagingTargets) &&
    stagingTargets.length === stages.length && same(stagingTargets.map(x => x?.phase).sort(), [...stages].sort()), "STAGE_KEYS");
  const ordered = stages.map(phase => stagingTargets.find(x => x.phase === phase)!);
  for (const x of ordered) need(exact(x, ["phase", "key", "targetCanonicalSha256", "targetBytes"]) &&
    typeof x.targetCanonicalSha256 === "string" && hex.test(x.targetCanonicalSha256) && Number.isSafeInteger(x.targetBytes) &&
    x.targetBytes > 51_200 && x.targetBytes <= 1_048_576 && x.key === firstOpenOwnerStageKey({ approvalSha256: installIntentSha256,
      phase: x.phase, targetCanonicalSha256: x.targetCanonicalSha256 }), "STAGE_KEYS");
  need(ordered[0].targetCanonicalSha256 === ordered[2].targetCanonicalSha256 && ordered[0].targetBytes === ordered[2].targetBytes &&
    ordered[1].targetCanonicalSha256 !== ordered[0].targetCanonicalSha256, "STAGE_CHAIN");
  const base = decoded(original), policy = document(base);
  need(templateHash(base) === originalSha && templateHash(policy) === policyOriginalSha && policy.Statement.length === 3 &&
    policy.Statement.every(s => s.Sid !== sid) && keys(base.Parameters as object ?? {}).length === 0, "ORIGINAL_PIN");
  const protectedTemplate = structuredClone(base), protectedPolicy = document(protectedTemplate);
  protectedPolicy.Statement.push({ Sid: sid, Effect: "Deny", Principal: "*", Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
    Resource: ordered.map(x => `arn:aws:s3:::${bucket}/${x.key}`).sort() });
  need(Buffer.byteLength(JSON.stringify(ordinal(protectedTemplate))) <= 51_200 &&
    Buffer.byteLength(JSON.stringify(ordinal(protectedPolicy))) <= 20_480, "INLINE_SIZE");
  const project = (template: Template) => ({ template, canonicalSha256: templateHash(template), policyOrdinalSha256: templateHash(document(template)) });
  return { original: project(base), protected: project(protectedTemplate) };
}

const ackOk = (x: { $metadata?: { httpStatusCode?: number } }) => x.$metadata?.httpStatusCode === 200;
function rowTags(rows: { Key?: string; Value?: string }[] | undefined) {
  const tags: Record<string, string> = Object.create(null);
  for (const { Key, Value } of rows ?? []) {
    need(Key && typeof Value === "string" && !Object.hasOwn(tags, Key), "STACK_TAGS");
    tags[Key] = Value;
  }
  return tags;
}
function stack(r: DescribeStacksCommandOutput) {
  const x = r.Stacks?.[0], event = (x?.LastUpdatedTime ?? x?.CreationTime)?.getTime();
  need(ackOk(r) && !r.NextToken && r.Stacks?.length === 1 && x?.StackId === firstOpenInstallBucketStack &&
    !x.ParentId && !x.RootId && !x.RoleARN && !x.DeletionTime && !x.Parameters?.length && clock(event), "STACK_SCOPE");
  return { event, status: x.StackStatus, tags: rowTags(x.Tags) };
}
function checkOriginal(r: GetTemplateCommandOutput, expected: string) {
  const stages = r.StagesAvailable;
  need(ackOk(r) && stages?.filter(s => s === "Original").length === 1 && new Set(stages).size === stages.length &&
    stages.every(s => s === "Original" || s === "Processed") && templateHash(decoded(r.TemplateBody)) === expected, "ORIGINAL_MISMATCH");
}
function checkChange(r: DescribeChangeSetCommandOutput, binding: Binding, id: string, tags: Record<string, string>, terminal = false) {
  need(ackOk(r) && r.StackId === firstOpenInstallBucketStack && r.ChangeSetId === id && r.ChangeSetName === binding.changeSetName &&
    !r.NextToken && !r.RootChangeSetId && !r.ParentChangeSetId && !r.IncludeNestedStacks && !r.ImportExistingResources &&
    !r.OnStackFailure && !r.DeploymentMode, "CHANGE_SCOPE");
  if (!terminal && ["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(r.Status ?? "")) {
    need(r.ExecutionStatus === "UNAVAILABLE", "CHANGE_STATUS");
    return false;
  }
  need(r.Status === "CREATE_COMPLETE" && r.ExecutionStatus === (terminal ? "EXECUTE_COMPLETE" : "AVAILABLE") &&
    same(r.Capabilities, ["CAPABILITY_NAMED_IAM"]) && !r.Parameters?.length && (!r.Tags || same(rowTags(r.Tags), tags)), "CHANGE_STATUS_OR_BINDINGS");
  const change = r.Changes?.[0], c = change?.ResourceChange;
  need(r.Changes?.length === 1 && change?.Type === "Resource" && c?.Action === "Modify" && c.LogicalResourceId === "EvidencePolicy" &&
    c.ResourceType === "AWS::S3::BucketPolicy" && c.PhysicalResourceId === bucket && c.Replacement === "False" &&
    same(c.Scope, ["Properties"]) && !c.ChangeSetId && !c.ModuleInfo && !c.PreviousDeploymentContext && !c.PolicyAction &&
    (c.Details ?? []).every(d => d.Target?.Attribute === "Properties" && d.Target.Name === "PolicyDocument" &&
      d.Target.RequiresRecreation === "Never"), "CHANGE_DIFF");
  return true;
}

/** Source-only executor. A separate approved reader must authenticate each terminal bucket state. */
export async function bindFirstOpenInstallBucketExecutor(input: { plan: FirstOpenInstallBucketPlan; approvedPlanSha256: string;
  ports: FirstOpenInstallBucketPorts; journal: FirstOpenInstallBucketJournal; now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<unknown> }) {
  const { approvedPlanSha256, ports, journal, now = Date.now, wait = (ms, signal) => delay(ms, undefined, { signal }) } = input;
  const plan = structuredClone(input.plan), { protect, restore } = plan.phases ?? {};
  const window = (p: Window | undefined) => exact(p, ["startAt", "writeBefore"]) && p && clock(p.startAt) && clock(p.writeBefore) &&
    p.startAt < p.writeBefore && p.writeBefore - p.startAt <= 10 * 60_000 && p.writeBefore <= plan.factsExpireAt;
  need(exact(plan, ["schema", "jobId", "installIntentSha256", "ownerReadReceiptSha256", "factsExpireAt", "original", "stagingTargets", "phases"]) &&
    plan.schema === schema && plan.jobId === jobId && clock(plan.factsExpireAt) && typeof plan.ownerReadReceiptSha256 === "string" &&
    hex.test(plan.ownerReadReceiptSha256) && hex.test(approvedPlanSha256) && await sha256Hex(plan) === approvedPlanSha256 &&
    exact(plan.phases, ["protect", "restore"]) && window(protect) && window(restore) && protect.writeBefore <= restore.startAt &&
    restore.writeBefore - protect.startAt <= 120 * 60_000 && typeof ports.getChangeSetOriginal === "function" &&
    typeof ports.listChangeSets === "function", "PLAN");
  const getChangeSetOriginal = ports.getChangeSetOriginal.bind(ports), targets = firstOpenInstallBucketTargets(plan);
  const used = new Set<Phase>();
  let busy = false, identity: Promise<void> | undefined;
  return async (phase: Phase, upstream: AbortSignal) => {
    need((phase === "protect" || phase === "restore") && !busy && !used.has(phase), "PHASE_NOT_BOUND_OR_USED");
    const w = plan.phases[phase];
    const inWindow = () => { const at = now(); need(!upstream.aborted && clock(at) && at >= w.startAt && at < w.writeBefore, "PHASE_WINDOW"); };
    inWindow();
    const pre = phase === "protect" ? targets.original : targets.protected, target = phase === "protect" ? targets.protected : targets.original;
    const changeSetName = `fc41597f-install-bucket-${plan.installIntentSha256.slice(0, 24)}-${phase}`;
    const slot = `${jobId}:${plan.installIntentSha256}:bucket-retention:${phase}`;
    const binding: Binding = { phase, planSha256: approvedPlanSha256, installIntentSha256: plan.installIntentSha256,
      ownerReadReceiptSha256: plan.ownerReadReceiptSha256, stackId: firstOpenInstallBucketStack, changeSetName,
      originalCanonicalSha256: pre.canonicalSha256, targetCanonicalSha256: target.canonicalSha256, targetPolicyOrdinalSha256: target.policyOrdinalSha256,
      prerequisite: phase === "protect" ? "verified-original-owner-and-bucket" : "verified-active-bucket-retention-and-dependent-stage-closure" };
    used.add(phase); busy = true;
    const calls = { describeStack: 0, original: 0, listChangeSets: 0, changeSetOriginal: 0, create: 0, describeChange: 0, execute: 0 };
    const signal = () => AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, Math.min(20_000, w.writeBefore - now())))]);
    const invoke = async <T>(kind: keyof typeof calls, f: (sig: AbortSignal) => Promise<T>) => {
      inWindow(); need(++calls[kind] <= firstOpenInstallBucketLimits[kind], "CALL_BUDGET");
      try { return await f(signal()); }
      catch { return fail(kind === "create" ? "CREATE_UNKNOWN_NO_RETRY" : kind === "execute" ? "EXECUTE_UNKNOWN_NO_RETRY" : "READ_STOP_NO_RETRY"); }
    };
    const pause = async () => { inWindow(); await wait(Math.min(5000, w.writeBefore - now()), signal()); inWindow(); };
    const readStack = async () => stack(await invoke("describeStack", sig => ports.describeStack(firstOpenInstallBucketStack, sig)));
    const readTemplate = async (sha: string) => checkOriginal(await invoke("original", sig => ports.getOriginal(firstOpenInstallBucketStack, sig)), sha);
    const log = (e: Omit<Event, "at">) => journal.record(slot, { ...e, at: now() });
    try {
      await journal.requirePrerequisite(structuredClone(binding), signal()); inWindow();
      await journal.consume(slot, structuredClone(binding)); inWindow();
      identity ??= (async () => {
        const who = await ports.identify(signal());
        need(ackOk(who) && who.Account === account && who.Arn === source && who.UserId === sourceId, "SOURCE_IDENTITY");
      })();
      await identity; inWindow();
      const before = await readStack();
      need(before.status === "UPDATE_COMPLETE", "STACK_NOT_STABLE");
      await readTemplate(pre.canonicalSha256);
      const list = await invoke("listChangeSets", sig => ports.listChangeSets(firstOpenInstallBucketStack, sig));
      need(ackOk(list) && !list.NextToken && Array.isArray(list.Summaries) && list.Summaries.every(x =>
        x.ExecutionStatus === "EXECUTE_COMPLETE" || ["FAILED", "DELETE_COMPLETE"].includes(x.Status ?? "")), "PENDING_OR_UNKNOWN_CHANGE");
      const create: CreateChangeSetCommandInput = { StackName: firstOpenInstallBucketStack, ChangeSetName: changeSetName, ChangeSetType: "UPDATE",
        ClientToken: `${changeSetName}-create`, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ImportExistingResources: false,
        Tags: Object.entries(before.tags).map(([Key, Value]) => ({ Key, Value })), TemplateBody: JSON.stringify(ordinal(target.template)) };
      await log({ kind: "create-intent", requestSha256: await sha256Hex(create) });
      const submitted = await invoke("create", sig => ports.create(create, sig)), id = submitted.Id ?? "";
      const prefix = cfn + `changeSet/${changeSetName}/`;
      need(ackOk(submitted) && submitted.StackId === firstOpenInstallBucketStack && id.startsWith(prefix) && uuid.test(id.slice(prefix.length)), "CREATE_ACK");
      await log({ kind: "create-ack", changeSetId: id });
      const readChange = () => invoke("describeChange", sig => ports.describeChange(firstOpenInstallBucketStack, id, sig));
      let available = false;
      for (let i = 0; i < 4; i++) {
        if (checkChange(await readChange(), binding, id, before.tags)) { available = true; break; }
        if (i < 3) await pause();
      }
      need(available, "CHANGE_UNPROVED_NO_RETRY");
      checkOriginal(await invoke("changeSetOriginal", sig => getChangeSetOriginal(firstOpenInstallBucketStack, id, sig)), target.canonicalSha256);
      await log({ kind: "preview-verified", changeSetId: id });
      need(same(await readStack(), before), "STACK_DRIFT_BEFORE_EXECUTE");
      const execute: ExecuteChangeSetCommandInput = { StackName: firstOpenInstallBucketStack, ChangeSetName: id,
        ClientRequestToken: `${changeSetName}-execute`, DisableRollback: false };
      await log({ kind: "execute-intent", requestSha256: await sha256Hex(execute), changeSetId: id });
      const applied = await invoke("execute", sig => ports.execute(execute, sig));
      need(ackOk(applied), "EXECUTE_ACK");
      const executeAck = { changeSetId: id, executedAt: now(), targetCanonicalSha256: target.canonicalSha256 };
      await log({ kind: "execute-ack", changeSetId: id, executeAck });
      while (calls.describeStack < firstOpenInstallBucketLimits.describeStack) {
        const observed = await readStack(); inWindow();
        need(same(observed.tags, before.tags), "STACK_DRIFT_AFTER_EXECUTE");
        if (observed.status === "UPDATE_COMPLETE" && observed.event > before.event) {
          checkChange(await readChange(), binding, id, before.tags, true);
          await readTemplate(target.canonicalSha256); inWindow();
          await log({ kind: "terminal-observed", changeSetId: id });
          return { status: "BUCKET_OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED" as const, executeAck, calls };
        }
        need(observed.status === before.status || ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"].includes(observed.status ?? ""), "TERMINAL_STOP_NO_RETRY");
        if (calls.describeStack < firstOpenInstallBucketLimits.describeStack) await pause();
      }
      return fail("TERMINAL_UNPROVED_NO_RETRY");
    } finally { busy = false; }
  };
}
