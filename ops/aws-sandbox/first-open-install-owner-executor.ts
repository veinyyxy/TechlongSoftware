import { setTimeout as delay } from "node:timers/promises";
import { CloudFormationClient, CreateChangeSetCommand, DescribeChangeSetCommand, DescribeStacksCommand,
  ExecuteChangeSetCommand, GetTemplateCommand, type CreateChangeSetCommandInput, type CreateChangeSetCommandOutput,
  type DescribeChangeSetCommandOutput, type DescribeStacksCommandOutput, type ExecuteChangeSetCommandInput,
  type ExecuteChangeSetCommandOutput, type GetTemplateCommandOutput } from "@aws-sdk/client-cloudformation";
import { GetCallerIdentityCommand, STSClient, type GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity } from "@smithy/types";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { canonical as ordinal, hash as templateHash } from "../temporary-idle/environment-cfn.mjs";
import { parseCloudFormationTemplateDocument } from "./scripts/cloudformation-template-document.mjs";
import { firstOpenOwnerStageKey, firstOpenSharedPredecessorChangeSetName } from "./first-open-owner-stage-proof.ts";

const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const region = "ca-central-1", account = "402010193138";
const cfnArn = `arn:aws:cloudformation:${region}:${account}:`;
const sourceArn = `arn:aws:iam::${account}:user/techlong-sandbox-dev`;
const sourceId = "AIDAV3GNMXTZEO7SHLC2X";
const sharedOriginal = "5027c73de759e5ca8e753e3bc7735a46b6b77b7f4bf4358752733fee93994360";
const inspectorOriginal = "6a839ad4197b009028fa00ba29c9387d68bd23c3017aeabefe242a1e46b41096";
const installStages = ["inspector-grant", "provisioner-grant", "provisioner-relock", "inspector-relock"] as const;
const formalStages = ["formal-provisioner-grant", "formal-provisioner-relock"] as const;
type StandardInstallPhase = (typeof installStages)[number];
export type FirstOpenInstallOwnerPhase = StandardInstallPhase | "shared-predecessor";
export type FirstOpenFormalProvisionerPhase = (typeof formalStages)[number];
export type FirstOpenOwnerExecutorPhase = FirstOpenInstallOwnerPhase | FirstOpenFormalProvisionerPhase;
type Lane = "install" | "formal-provisioner";
const inspector = {
  stackId: cfnArn + "stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f",
  family: "install-readback", resources: { LockedInspectorRole: "AWS::IAM::Role" },
  physical: { LockedInspectorRole: "TechlongSandboxFirstOpenInspector" },
};
const provisioner = {
  stackId: cfnArn + "stack/techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917",
  resources: { ProvisionerRole: "AWS::IAM::Role", ProvisionerBoundary: "AWS::IAM::ManagedPolicy" },
  physical: { ProvisionerRole: "TechlongSandboxProvisionerRole", ProvisionerBoundary: `arn:aws:iam::${account}:policy/TechlongSandboxProvisionerBoundary` },
};
const lifecycleBoundaryId = "FirstOpenFc41597fLifecycleBoundary";
const lifecycleBoundaryName = "TechlongSandboxFirstOpenFc41597fLifecycleBoundary";
const shared = {
  stackId: provisioner.stackId,
  resources: { ProvisionerRole: "AWS::IAM::Role", TenantLifecycleTaskRole: "AWS::IAM::Role", [lifecycleBoundaryId]: "AWS::IAM::ManagedPolicy" },
  physical: { ProvisionerRole: provisioner.physical.ProvisionerRole, TenantLifecycleTaskRole: "TechlongSandboxTenantLifecycleTaskRole" },
};
const owner = (phase: FirstOpenOwnerExecutorPhase) => phase === "shared-predecessor" ? shared : phase.startsWith("inspector-") ? inspector : provisioner;
const changeFamily = (phase: FirstOpenOwnerExecutorPhase) => phase.startsWith("inspector-") ? inspector.family :
  phase.startsWith("formal-") ? "provisioner" : "install-provisioner";
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = (reason: string): never => { throw Error("FIRST_OPEN_INSTALL_OWNER_" + reason); };
function assert(value: unknown, reason: string): asserts value { if (!value) fail(reason); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const keys = (o: object) => Object.keys(o).sort();
const exactKeys = (o: object | undefined, expected: readonly string[]) => !!o && same(keys(o), [...expected].sort());
const timers = { perCall: 25_000, poll: 5_000, whole: 55 * 60_000 } as const;
const limits = { original: 1, changeSetOriginal: 1, create: 1, describeChange: 4, execute: 1, describeStack: 6 } as const;

type Resource = { Type: string; Properties: Record<string, unknown> } & Record<string, unknown>;
type Template = { Resources: Record<string, Resource>; Parameters?: Record<string, unknown> } & Record<string, unknown>;
type Change = { logicalId: string; action: "Modify"; replacement: false } | { logicalId: string; action: "Add" };
const isBoundaryAdd = (phase: FirstOpenOwnerExecutorPhase, logicalId: string) => phase === "shared-predecessor" && logicalId === lifecycleBoundaryId;
export type FirstOpenInstallOwnerTransition = {
  stackId: string;
  originalCanonicalSha256: string;
  targetCanonicalSha256: string;
  template: Template;
  expectedChanges: readonly Change[];
};
type Phase = {
  startAt: number;
  writeBefore: number;
  sourceStackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  transition: FirstOpenInstallOwnerTransition;
  /** Reference to a separately approved immutable upload. This module never
   * uploads, lists, opens or grants access to any S3 object. */
  stagedVersion?: { versionId: string; independentlyVerifiedBytesReceiptSha256: string; changeSetOriginalReadConsent: true };
  /** Approve only the fixed target and preview now. The actual version and
   * independent staged-bytes receipt must be bound when this phase is called. */
  deferredStagedVersion?: { changeSetOriginalReadConsent: true };
};
export type FirstOpenInstallOwnerDeferredStagedProof = {
  planSha256: string;
  phase: Exclude<FirstOpenOwnerExecutorPhase, "inspector-grant" | "inspector-relock">;
  key: string;
  targetCanonicalSha256: string;
  targetBytes: number;
  versionId: string;
  independentlyVerifiedBytesReceiptSha256: string;
};
interface OwnerPlanFields {
  jobId: typeof jobId;
  approvalSha256: string;
  factsExpireAt: number;
}
export interface FirstOpenInstallOwnerExecutorPlan extends OwnerPlanFields {
  schema: "techlong/fc41597f-install-owner-transitions/v2";
  phases: Record<StandardInstallPhase, Phase> & { "shared-predecessor"?: Phase };
}
export interface FirstOpenFormalProvisionerExecutorPlan extends OwnerPlanFields {
  schema: "techlong/fc41597f-formal-provisioner-transitions/v1";
  installedSharedPredecessorCanonicalSha256: string;
  closedInstallReadbackReceiptSha256: string;
  phases: Record<FirstOpenFormalProvisionerPhase, Phase>;
}
type Plan = FirstOpenInstallOwnerExecutorPlan | FirstOpenFormalProvisionerExecutorPlan;
const formalSchema: FirstOpenFormalProvisionerExecutorPlan["schema"] = "techlong/fc41597f-formal-provisioner-transitions/v1";
const installSchema: FirstOpenInstallOwnerExecutorPlan["schema"] = "techlong/fc41597f-install-owner-transitions/v2";
export interface FirstOpenInstallOwnerPorts {
  identify(signal: AbortSignal): Promise<GetCallerIdentityCommandOutput>;
  describeStack(id: string, signal: AbortSignal): Promise<DescribeStacksCommandOutput>;
  getOriginal(id: string, signal: AbortSignal): Promise<GetTemplateCommandOutput>;
  getChangeSetOriginal?(stack: string, changeSetArn: string, signal: AbortSignal): Promise<GetTemplateCommandOutput>;
  create(input: CreateChangeSetCommandInput, signal: AbortSignal): Promise<CreateChangeSetCommandOutput>;
  describeChange(stack: string, id: string, signal: AbortSignal): Promise<DescribeChangeSetCommandOutput>;
  execute(input: ExecuteChangeSetCommandInput, signal: AbortSignal): Promise<ExecuteChangeSetCommandOutput>;
}
type StagedTemplate = { url: string; bytesSha256: string; receiptSha256: string; changeSetOriginalReadConsent: true;
  deferredProof?: FirstOpenInstallOwnerDeferredStagedProof };
type StagedCoordinates = Pick<FirstOpenInstallOwnerDeferredStagedProof, "key" | "targetCanonicalSha256" | "targetBytes">;
type Staging = { mode: "fixed"; template: StagedTemplate } | { mode: "deferred"; coordinates: StagedCoordinates } | null;
type Binding = {
  planSha256: string; lane: Lane; phase: FirstOpenOwnerExecutorPhase; stackId: string; changeSetName: string;
  originalCanonicalSha256: string; targetCanonicalSha256: string; targetSha256: string;
  stagedTemplate: StagedTemplate | null;
  prerequisite: { kind: "verified-closed-install-readback"; receiptSha256: string } |
    { kind: "verified-shared-predecessor"; targetCanonicalSha256: string } |
    { kind: "verified-formal-lifecycle-relock" } | null;
};
type Event = { kind: "create-intent" | "create-ack" | "staged-template-preview-verified" | "execute-intent" | "execute-ack" | "terminal-observed";
  at: number; requestSha256?: string; changeSetId?: string; targetCanonicalSha256?: string; exactExecuteAck?: FirstOpenInstallOwnerExecuteAck };
export interface FirstOpenInstallOwnerJournal {
  /** Exclusive, durable, non-resettable slot. Must reject an existing slot. */
  consume(slot: string, binding: Binding): Promise<void>;
  record(slot: string, event: Event): Promise<void>;
  /** Outer protected operator must check independently authenticated evidence,
   * never manufacture it here: the exact closed-install receipt before formal
   * Grant; actual independent formal Lifecycle relock before formal Relock;
   * the independently observed exact shared Original before install Grant;
   * staged object bytes/approval, and install observer/withdrawal ordering.
   * Deferred proof needs a separately trusted binding of the exact plan,
   * phase, key, byte count/hash, immutable version and receipt. Merely matching
   * fields supplied by the caller isn't authentication. */
  requirePrerequisite(binding: Binding, signal: AbortSignal): Promise<void>;
}
export type FirstOpenInstallOwnerExecuteAck = { changeSetId: string; executedAt: number; targetSha256: string };

function decoded(value: unknown): Template {
  let parsed: unknown;
  try { parsed = parseCloudFormationTemplateDocument(value); } catch { return fail("TEMPLATE_SHAPE"); }
  const result = parsed as Template;
  assert(result.Resources && typeof result.Resources === "object" && !Array.isArray(result.Resources) &&
    !Object.hasOwn(result, "Transform"), "TEMPLATE_SHAPE");
  return result;
}

function allowedProperties(phase: FirstOpenOwnerExecutorPhase, logicalId: string, type: string) {
  if (phase === "shared-predecessor") return logicalId === "TenantLifecycleTaskRole" ?
    ["AssumeRolePolicyDocument", "Policies", "PermissionsBoundary"] : ["Policies"];
  return type === "AWS::IAM::Role" ? ["AssumeRolePolicyDocument", "Policies"] : ["PolicyDocument"];
}

function changedOnly(before: Template, after: Template, phase: FirstOpenOwnerExecutorPhase) {
  const { Resources: base, ...prior } = before, { Resources: wanted, ...next } = after;
  const expected = owner(phase).resources;
  const addition = phase === "shared-predecessor" ? [lifecycleBoundaryId] : [];
  assert(same(prior, next) && same([...keys(base), ...addition].sort(), keys(wanted)), "TEMPLATE_SCOPE");
  const changed = keys(wanted).filter(id => !same(base[id], wanted[id]));
  assert(same(changed, keys(expected)), "TEMPLATE_SCOPE");
  for (const [id, type] of Object.entries(expected)) {
    if (isBoundaryAdd(phase, id)) {
      const { Properties, ...other } = wanted[id];
      const { Condition } = base.TenantLifecycleTaskRole;
      assert(!Object.hasOwn(base, id) && same(other, { Type: type, ...(Condition !== undefined && { Condition }) }) &&
        exactKeys(Properties, ["ManagedPolicyName", "PolicyDocument"]) && Properties.ManagedPolicyName === lifecycleBoundaryName &&
        !!Properties.PolicyDocument && same(wanted.TenantLifecycleTaskRole.Properties.PermissionsBoundary, { Ref: lifecycleBoundaryId }), "TEMPLATE_SCOPE");
      continue;
    }
    const { Properties: old, ...oldResource } = base[id], { Properties: updated, ...newResource } = wanted[id];
    assert(old && updated && oldResource.Type === type && same(oldResource, newResource), "TEMPLATE_SCOPE");
    const allowed = new Set(allowedProperties(phase, id, type));
    assert([...new Set([...keys(old), ...keys(updated)])].every(k => allowed.has(k) || same(old[k], updated[k])), "TEMPLATE_SCOPE");
  }
}

function checkStack(response: DescribeStacksCommandOutput, id: string) {
  const [stack] = response.Stacks ?? [];
  assert(!response.NextToken && response.Stacks?.length === 1 && stack.StackId === id &&
    !stack.ParentId && !stack.RootId && !stack.DeletionTime && stack.RoleARN === undefined && stack.StackStatus, "STACK_SCOPE");
  const event = (stack.LastUpdatedTime ?? stack.CreationTime)?.getTime();
  assert(Number.isSafeInteger(event) && (event ?? 0) > 0, "STACK_CLOCK");
  const parameters = rows(stack.Parameters, "ParameterKey", "ParameterValue");
  const tags = rows(stack.Tags, "Key", "Value");
  return { status: stack.StackStatus, event: event!, parameters, tags };
}

function rows<T extends object, K extends keyof T, V extends keyof T>(rows: T[] | undefined, key: K, value: V) {
  const result: Record<string, string> = Object.create(null);
  for (const r of rows ?? []) {
    const k = r[key], v = r[value];
    assert(typeof k === "string" && k.length > 0 && typeof v === "string" && !Object.hasOwn(result, k), "STACK_BINDINGS");
    result[k] = v;
  }
  return result;
}

function checkParameters(template: Template, parameters: Record<string, string>) {
  const defs = template.Parameters ?? {};
  assert(same(keys(parameters), keys(defs)) && Object.entries(defs).every(([k, value]) => {
    const def = value as { Type?: unknown; NoEcho?: unknown; AllowedValues?: unknown[] } | null;
    return def?.Type === "String" && def.NoEcho !== true &&
      (!Array.isArray(def.AllowedValues) || def.AllowedValues.includes(parameters[k]));
  }), "PREIMAGE_PARAMETERS");
}

function checkChange(preview: DescribeChangeSetCommandOutput, binding: Binding, changeSetId: string, before: ReturnType<typeof checkStack>) {
  assert(!preview.NextToken && preview.ChangeSetId === changeSetId && preview.StackId === binding.stackId &&
    preview.ChangeSetName === binding.changeSetName && !preview.IncludeNestedStacks && !preview.RootChangeSetId &&
    !preview.ParentChangeSetId && !preview.OnStackFailure && !preview.ImportExistingResources && !preview.DeploymentMode, "CHANGE_SCOPE");
  if (["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(preview.Status ?? "")) {
    assert(preview.ExecutionStatus === "UNAVAILABLE", "CHANGE_STATUS");
    return false;
  }
  assert(preview.Status === "CREATE_COMPLETE" && preview.ExecutionStatus === "AVAILABLE", "CHANGE_STATUS");
  const params = preview.Parameters ?? [];
  assert(same(preview.Capabilities, ["CAPABILITY_NAMED_IAM"]) &&
    (!preview.Tags || same(rows(preview.Tags, "Key", "Value"), before.tags)) && params.length === keys(before.parameters).length &&
    same(params.map(x => x.ParameterKey).sort(), keys(before.parameters)) &&
    params.every(x => x.ParameterKey && !x.ResolvedValue &&
      (x.UsePreviousValue === true && x.ParameterValue === undefined || x.ParameterValue === before.parameters[x.ParameterKey])), "CHANGE_BINDINGS");
  const actual = preview.Changes;
  const expect = owner(binding.phase);
  const allowed = Object.entries(expect.resources);
  assert(actual?.length === allowed.length && allowed.every(([id, type]) => actual.filter(c => {
    const row = c.ResourceChange;
    if (c.Type !== "Resource" || row?.LogicalResourceId !== id || row.ResourceType !== type ||
      row.ChangeSetId || row.ModuleInfo || row.PreviousDeploymentContext ||
      (binding.phase === "shared-predecessor" && row.PolicyAction !== undefined)) return false;
    if (isBoundaryAdd(binding.phase, id)) return row.Action === "Add" && row.Replacement === undefined &&
      row.PhysicalResourceId === undefined && (!row.Scope?.length || same(row.Scope, ["Properties"])) && !row.Details?.length;
    return row.Action === "Modify" && row.Replacement === "False" &&
      row.PhysicalResourceId === (expect.physical as Record<string, string>)[id] && same(row.Scope, ["Properties"]) &&
      (row.Details ?? []).every(d => d.Target?.Attribute === "Properties" && d.Target.RequiresRecreation === "Never" &&
        allowedProperties(binding.phase, id, type).includes(d.Target.Name ?? ""));
  }).length === 1), "CHANGE_DIFF");
  return true;
}

function decodeStage(plan: Plan, phase: FirstOpenOwnerExecutorPhase) {
  const p = (plan.phases as Partial<Record<FirstOpenOwnerExecutorPhase, Phase>>)[phase], t = p?.transition, spec = owner(phase);
  assert(p && t && t.stackId === spec.stackId && (p.sourceStackStatus === "CREATE_COMPLETE" || p.sourceStackStatus === "UPDATE_COMPLETE") &&
    Number.isSafeInteger(p.startAt) && Number.isSafeInteger(p.writeBefore) && p.startAt > 0 && p.startAt < p.writeBefore &&
    p.writeBefore <= plan.factsExpireAt && hex.test(t.originalCanonicalSha256) && hex.test(t.targetCanonicalSha256) &&
    t.originalCanonicalSha256 !== t.targetCanonicalSha256, "PLAN_PHASE");
  const template = decoded(t.template), logical = keys(spec.resources);
  assert(Array.isArray(t.expectedChanges) && same([...t.expectedChanges].sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    logical.map(logicalId => isBoundaryAdd(phase, logicalId) ? { logicalId, action: "Add" } : { logicalId, action: "Modify", replacement: false })) &&
    Object.entries(spec.resources).every(([id, type]) => template.Resources[id]?.Type === type) &&
    templateHash(template) === t.targetCanonicalSha256, "PLAN_TARGET");
  const changeSetName = phase === "shared-predecessor" ? firstOpenSharedPredecessorChangeSetName(plan.approvalSha256) :
    `fc41597f-${changeFamily(phase)}-${plan.approvalSha256.slice(0, 24)}-${phase.endsWith("relock") ? "relock" : "grant"}`;
  const canonicalBody = JSON.stringify(ordinal(template));
  const byteLength = Buffer.byteLength(canonicalBody);
  assert(byteLength <= 1_048_576, "TEMPLATE_SIZE");
  if (phase === "shared-predecessor") assert(p.deferredStagedVersion && p.stagedVersion === undefined, "SHARED_PREDECESSOR_STAGING_REQUIRED");
  let staging: Staging = null;
  if (p.stagedVersion !== undefined || p.deferredStagedVersion !== undefined) {
    assert(phase !== "inspector-grant" && phase !== "inspector-relock" && byteLength > 51_200, "STAGED_TEMPLATE");
    assert(p.stagedVersion === undefined || p.deferredStagedVersion === undefined, "STAGED_TEMPLATE");
    const targetCanonicalSha256 = t.targetCanonicalSha256;
    const key = firstOpenOwnerStageKey({ approvalSha256: plan.approvalSha256, phase, targetCanonicalSha256 });
    const coordinates = { key, targetCanonicalSha256, targetBytes: byteLength };
    if (p.deferredStagedVersion !== undefined) {
      assert(exactKeys(p.deferredStagedVersion, ["changeSetOriginalReadConsent"]) &&
        p.deferredStagedVersion.changeSetOriginalReadConsent === true, "CHANGE_ORIGINAL_READ_CONSENT");
      staging = { mode: "deferred", coordinates };
    } else {
      const v = p.stagedVersion;
      assert(v && exactKeys(v, ["versionId", "independentlyVerifiedBytesReceiptSha256", "changeSetOriginalReadConsent"]) &&
        v.changeSetOriginalReadConsent === true, "CHANGE_ORIGINAL_READ_CONSENT");
      staging = { mode: "fixed", template: stagedTemplateBinding(coordinates, v) };
    }
  } else assert(byteLength <= 51_200, "STAGED_TEMPLATE_REQUIRED");
  return { p, t, template, canonicalBody, changeSetName, staging };
}

function stagedTemplateBinding(coordinates: StagedCoordinates,
  { versionId, independentlyVerifiedBytesReceiptSha256: receiptSha256 }: Pick<FirstOpenInstallOwnerDeferredStagedProof,
    "versionId" | "independentlyVerifiedBytesReceiptSha256">): StagedTemplate {
  assert(validFirstOpenVersionId(versionId) && typeof receiptSha256 === "string" && hex.test(receiptSha256), "STAGED_TEMPLATE");
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${coordinates.key}?versionId=${encodeURIComponent(versionId)}`;
  assert(url.length <= 1024, "STAGED_TEMPLATE");
  return { url, bytesSha256: coordinates.targetCanonicalSha256, receiptSha256, changeSetOriginalReadConsent: true };
}

function bindStageProof(staging: Staging, planSha256: string, phase: FirstOpenOwnerExecutorPhase,
  deferredProof: FirstOpenInstallOwnerDeferredStagedProof | undefined): StagedTemplate | null {
  if (staging?.mode !== "deferred") {
    assert(deferredProof === undefined, "DEFERRED_STAGE_PROOF_UNEXPECTED");
    return staging?.template ?? null;
  }
  assert(deferredProof !== undefined, "DEFERRED_STAGE_PROOF_REQUIRED");
  const proof = structuredClone(deferredProof), { coordinates } = staging;
  assert(proof && exactKeys(proof, ["planSha256", "phase", "key", "targetCanonicalSha256", "targetBytes", "versionId",
    "independentlyVerifiedBytesReceiptSha256"]) && proof.planSha256 === planSha256 && proof.phase === phase &&
    proof.key === coordinates.key && proof.targetCanonicalSha256 === coordinates.targetCanonicalSha256 &&
    proof.targetBytes === coordinates.targetBytes, "DEFERRED_STAGE_PROOF_MISMATCH");
  return { ...stagedTemplateBinding(coordinates, proof), deferredProof: proof };
}

/** Exact owner Change Sets only. The approved plan is the complete input, not
 * just an expected result hash reconstructed after an operation. The shared
 * phase preimage may require an earlier separately approved Lifecycle stage;
 * a mismatch never attempts that stage. There is no active-state inference
 * or implicit relock/update after an unknown write. */
export async function bindFirstOpenInstallOwnerExecutor(input: {
  plan: Plan; approvedPlanSha256: string; ports: FirstOpenInstallOwnerPorts;
  journal: FirstOpenInstallOwnerJournal; now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
}) {
  const { approvedPlanSha256, ports, journal, now = Date.now, wait = (ms, signal) => delay(ms, undefined, { signal }) } = input;
  const plan = structuredClone(input.plan);
  const lane: Lane = plan?.schema === formalSchema ? "formal-provisioner" : "install";
  const withShared = plan?.schema === installSchema && !!plan.phases && Object.hasOwn(plan.phases, "shared-predecessor");
  const stages: readonly FirstOpenOwnerExecutorPhase[] = lane === "formal-provisioner" ? formalStages : withShared ?
    ["inspector-grant", "shared-predecessor", ...installStages.slice(1)] : installStages;
  assert((plan?.schema === installSchema || plan?.schema === formalSchema) && plan.jobId === jobId &&
    hex.test(plan.approvalSha256) && hex.test(approvedPlanSha256) && Number.isSafeInteger(plan.factsExpireAt) &&
    exactKeys(plan.phases, stages) && await sha256Hex(plan) === approvedPlanSha256, "PLAN");
  const compiled = stages.map(phase => decodeStage(plan, phase));
  const prepared = compiled[stages.indexOf("shared-predecessor")];
  const changeSetOriginal = typeof ports.getChangeSetOriginal === "function" ? ports.getChangeSetOriginal.bind(ports) : undefined;
  assert(!compiled.some(v => v.staging) || typeof changeSetOriginal === "function", "CHANGE_ORIGINAL_PORT_REQUIRED");
  assert(compiled.every((v, i) => i === 0 || compiled[i - 1].p.writeBefore <= v.p.startAt) &&
    compiled.at(-1)!.p.writeBefore - compiled[0].p.startAt <= (lane === "install" ? timers.whole : 60 * 60_000), "PHASE_CHAIN");
  if (plan.schema === formalSchema) {
    const [grant, relock] = compiled, installed = plan.installedSharedPredecessorCanonicalSha256;
    assert(hex.test(installed) && installed !== sharedOriginal && hex.test(plan.closedInstallReadbackReceiptSha256) &&
      grant.p.sourceStackStatus === "UPDATE_COMPLETE" && relock.p.sourceStackStatus === "UPDATE_COMPLETE" &&
      grant.t.originalCanonicalSha256 === installed && relock.t.originalCanonicalSha256 === grant.t.targetCanonicalSha256 &&
      relock.t.targetCanonicalSha256 === installed, "FORMAL_PREDECESSOR_CHAIN");
  } else {
    const [ig, pg, pr, ir] = installStages.map(phase => compiled[stages.indexOf(phase)]);
    assert(ig.t.originalCanonicalSha256 === inspectorOriginal && pg.t.originalCanonicalSha256 !== sharedOriginal &&
      pg.p.sourceStackStatus === "UPDATE_COMPLETE" && pr.p.sourceStackStatus === "UPDATE_COMPLETE" &&
      ir.p.sourceStackStatus === "UPDATE_COMPLETE" &&
      pr.t.originalCanonicalSha256 === pg.t.targetCanonicalSha256 && ir.t.originalCanonicalSha256 === ig.t.targetCanonicalSha256, "PHASE_CHAIN");
    if (withShared) assert(prepared && prepared.t.originalCanonicalSha256 === sharedOriginal &&
      prepared.p.sourceStackStatus === "UPDATE_COMPLETE" && pg.t.originalCanonicalSha256 === prepared.t.targetCanonicalSha256 &&
      pr.t.targetCanonicalSha256 === prepared.t.targetCanonicalSha256, "SHARED_PREDECESSOR_CHAIN");
  }
  let busy = false, identity: Promise<void> | undefined;
  const used = new Set<FirstOpenOwnerExecutorPhase>();
  return async (phase: FirstOpenOwnerExecutorPhase, upstream: AbortSignal, deferredProof?: FirstOpenInstallOwnerDeferredStagedProof) => {
    const index = stages.indexOf(phase);
    assert(index >= 0 && !busy && !used.has(phase), "PHASE_ALREADY_USED_OR_UNBOUND");
    const { p, t, template, canonicalBody, changeSetName, staging } = compiled[index];
    const check = () => assert(!upstream.aborted && now() >= p.startAt && now() < p.writeBefore, "PHASE_WINDOW");
    check();
    const stagedTemplate = bindStageProof(staging, approvedPlanSha256, phase, deferredProof);
    used.add(phase); busy = true;
    const slot = `${jobId}:${plan.approvalSha256}:${lane}:${phase}`;
    const count = { original: 0, changeSetOriginal: 0, create: 0, describeChange: 0, execute: 0, describeStack: 0 };
    const signal = () => AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, Math.min(timers.perCall, p.writeBefore - now())))]);
    const call = async <T>(kind: keyof typeof limits, f: (s: AbortSignal) => Promise<T>) => {
      check();
      assert(++count[kind] <= limits[kind], "CALL_BUDGET");
      try { return await f(signal()); }
      catch { return fail(kind === "create" ? "CREATE_STOP_NO_RETRY" : kind === "execute" ? "EXECUTE_STOP_NO_RETRY" : "OWNER_READ_STOP_NO_RETRY"); }
    };
    const pause = async () => { check(); await wait(Math.min(timers.poll, p.writeBefore - now()), signal()); check(); };
    const stack = async () => checkStack(await call("describeStack", s => ports.describeStack(t.stackId, s)), t.stackId);
    const prerequisite: Binding["prerequisite"] = plan.schema === formalSchema ? phase === "formal-provisioner-grant"
      ? { kind: "verified-closed-install-readback", receiptSha256: plan.closedInstallReadbackReceiptSha256 }
      : { kind: "verified-formal-lifecycle-relock" }
      : phase === "provisioner-grant" && withShared ? { kind: "verified-shared-predecessor", targetCanonicalSha256: prepared.t.targetCanonicalSha256 } : null;
    const earlyPrerequisite = staging?.mode === "deferred" || prerequisite?.kind === "verified-shared-predecessor";
    try {
      const binding: Binding = { planSha256: approvedPlanSha256, lane, phase, stackId: t.stackId, changeSetName, stagedTemplate, prerequisite,
        originalCanonicalSha256: t.originalCanonicalSha256, targetCanonicalSha256: t.targetCanonicalSha256, targetSha256: await sha256Hex(template) };
      // This proof may not exist at plan bind time. Authenticate the late
      // fact before spending a durable slot or invoking any provider.
      if (earlyPrerequisite) {
        check();
        await journal.requirePrerequisite(structuredClone(binding), signal());
        check();
      }
      await journal.consume(slot, structuredClone(binding));
      check();
      if (!earlyPrerequisite) {
        await journal.requirePrerequisite(structuredClone(binding), signal());
        check();
      }
      identity ??= (async () => {
        const who = await ports.identify(signal()).catch(() => fail("SOURCE_IDENTITY"));
        assert(who?.Account === account && who.Arn === sourceArn && who.UserId === sourceId, "SOURCE_IDENTITY");
      })();
      await identity;
      const initial = await stack();
      const observed = decoded((await call("original", s => ports.getOriginal(t.stackId, s))).TemplateBody);
      assert(initial.status === p.sourceStackStatus && templateHash(observed) === t.originalCanonicalSha256, "PREIMAGE");
      checkParameters(observed, initial.parameters);
      changedOnly(observed, template, phase);
      const request: CreateChangeSetCommandInput = { StackName: t.stackId, ChangeSetName: changeSetName, ChangeSetType: "UPDATE",
        ClientToken: `${changeSetName}-create`, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false,
        ImportExistingResources: false, Parameters: keys(initial.parameters).map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })),
        ...(stagedTemplate ? { TemplateURL: stagedTemplate.url } : { TemplateBody: canonicalBody }) };
      await journal.record(slot, { kind: "create-intent", at: now(), requestSha256: await sha256Hex(request) });
      const creation = await call("create", s => ports.create(request, s));
      const changeSetId = creation.Id ?? "", prefix = cfnArn + `changeSet/${changeSetName}/`;
      assert(creation.$metadata.httpStatusCode === 200 && creation.StackId === t.stackId && changeSetId.startsWith(prefix) &&
        uuid.test(changeSetId.slice(prefix.length)), "CREATE_ACK_UNPROVED");
      await journal.record(slot, { kind: "create-ack", at: now(), changeSetId });
      let available = false;
      for (let i = 0; i < limits.describeChange; i++) {
        const preview = await call("describeChange", s => ports.describeChange(t.stackId, changeSetId, s));
        available = checkChange(preview, binding, changeSetId, initial);
        if (available) break;
        if (i + 1 < limits.describeChange) await pause();
      }
      assert(available, "CHANGE_UNAVAILABLE_OR_OWNER_DRIFT");
      if (stagedTemplate) {
        assert(changeSetOriginal, "CHANGE_ORIGINAL_PORT_REQUIRED");
        const preview = await call("changeSetOriginal", s => changeSetOriginal(t.stackId, changeSetId, s));
        check();
        assert(preview?.$metadata?.httpStatusCode === 200 && Array.isArray(preview.StagesAvailable) &&
          preview.StagesAvailable.filter(stage => stage === "Original").length === 1 &&
          preview.StagesAvailable.every(stage => stage === "Original" || stage === "Processed"), "CHANGE_ORIGINAL_STAGE");
        const targetCanonicalSha256 = templateHash(decoded(preview.TemplateBody));
        assert(targetCanonicalSha256 === t.targetCanonicalSha256, "CHANGE_ORIGINAL_TARGET");
        await journal.record(slot, { kind: "staged-template-preview-verified", at: now(), changeSetId, targetCanonicalSha256 });
      }
      assert(same(await stack(), initial), "CHANGE_UNAVAILABLE_OR_OWNER_DRIFT");
      const execute: ExecuteChangeSetCommandInput = { StackName: t.stackId, ChangeSetName: changeSetId,
        ClientRequestToken: `${changeSetName}-execute`, DisableRollback: false };
      await journal.record(slot, { kind: "execute-intent", at: now(), changeSetId, requestSha256: await sha256Hex(execute) });
      const executed = await call("execute", s => ports.execute(execute, s));
      assert(executed.$metadata.httpStatusCode === 200, "EXECUTE_ACK_UNPROVED");
      const executeAck = { changeSetId, executedAt: now(), targetSha256: binding.targetSha256 };
      await journal.record(slot, { kind: "execute-ack", at: executeAck.executedAt, changeSetId, exactExecuteAck: executeAck });
      while (count.describeStack < limits.describeStack) {
        const observed = await stack();
        check();
        assert(same(observed.parameters, initial.parameters) && same(observed.tags, initial.tags), "OWNER_DRIFT_AFTER_EXECUTE");
        if (observed.status === "UPDATE_COMPLETE" && observed.event > initial.event) {
          await journal.record(slot, { kind: "terminal-observed", at: now(), changeSetId });
          return { executeAck, status: "OWNER_UPDATE_COMPLETE_NOT_INDEPENDENTLY_VERIFIED" as const, calls: { ...count } };
        }
        assert(observed.status === initial.status || ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"].includes(observed.status),
          "OWNER_STOP_AFTER_EXECUTE");
        if (count.describeStack < limits.describeStack) await pause();
      }
      return fail("TERMINAL_UNPROVED_NO_RETRY");
    } finally { busy = false; }
  };
}

/** Optional fixed-SDK transport. No default/refreshable identity provider,
 * role assumption, CLI, or auto-retry. The executor still verifies exact STS
 * Source and all operation coordinates before any CloudFormation write. */
export async function bindFirstOpenInstallOwnerSdkExecutor(input: Omit<Parameters<typeof bindFirstOpenInstallOwnerExecutor>[0], "ports"> & {
  credentials: AwsCredentialIdentity;
}) {
  const { credentials: snapshot, ...controller } = input;
  const expiry = snapshot?.expiration?.getTime();
  const terminalBefore = controller.plan?.schema === formalSchema ? controller.plan.phases?.["formal-provisioner-relock"]?.writeBefore :
    controller.plan?.phases?.["inspector-relock"]?.writeBefore;
  assert(snapshot?.accessKeyId && snapshot.secretAccessKey && snapshot.sessionToken && Number.isSafeInteger(expiry) &&
    expiry! > Date.now() && expiry! > terminalBefore,
    "FIXED_SOURCE_REQUIRED");
  const credentials = Object.freeze({ ...snapshot, expiration: new Date(expiry!) });
  const config = { region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true, useFipsEndpoint: false, useDualstackEndpoint: false };
  const sts = new STSClient({ ...config, endpoint: `https://sts.${region}.amazonaws.com` });
  const cfn = new CloudFormationClient({ ...config, endpoint: `https://cloudformation.${region}.amazonaws.com` });
  const options = (signal: AbortSignal) => {
    assert(Date.now() < expiry! && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "FIXED_SOURCE_OR_TLS");
    signal.throwIfAborted();
    return { abortSignal: signal };
  };
  const ports: FirstOpenInstallOwnerPorts = {
    identify: signal => sts.send(new GetCallerIdentityCommand({}), options(signal)),
    describeStack: (StackName, signal) => cfn.send(new DescribeStacksCommand({ StackName }), options(signal)),
    getOriginal: (StackName, signal) => cfn.send(new GetTemplateCommand({ StackName, TemplateStage: "Original" }), options(signal)),
    getChangeSetOriginal: (StackName, ChangeSetName, signal) => cfn.send(new GetTemplateCommand({ StackName, ChangeSetName,
      TemplateStage: "Original" }), options(signal)),
    create: (request, signal) => cfn.send(new CreateChangeSetCommand(request), options(signal)),
    describeChange: (StackName, ChangeSetName, signal) => cfn.send(new DescribeChangeSetCommand({ StackName, ChangeSetName }), options(signal)),
    execute: (request, signal) => cfn.send(new ExecuteChangeSetCommand(request), options(signal)),
  };
  const close = () => { sts.destroy(); cfn.destroy(); };
  try { return { execute: await bindFirstOpenInstallOwnerExecutor({ ...controller, ports }), close }; }
  catch (error) { close(); throw error; }
}
