import { CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand, GetTemplateCommand, ListStackResourcesCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, CELL_V3_CFN_ROLE, CELL_V3_PHASES, cellV3Clock, cellV3Fail, cellV3Freeze, type CellStackPlanV3, type CellV3Phase } from "../cloudformation/shared-cell-stack-v3.ts";
import { sharedCellAuthorityMarker, sharedCellProvisionOperationIntent, validateSharedCellAuthorityItem, SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "./shared-cell-cleanup-authority.ts";
import { SharedCellCleanupStackEvidencePort, type ReadSharedCellCleanupEvidenceInput } from "./shared-cell-cleanup-authority-operator.ts";

type Json = Record<string, unknown>;
interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Json> }
type Command = new (input: Json) => unknown;
export type CellV3EvidenceProfile = "source_inspection" | "provisioner" | "lifecycle_coordinator";
export interface CellV3ReadSdk {
  sts: Client; cfn: Client; commands: { identity: Command; describe: Command; template: Command; resources: Command; events: Command; list: Command };
}
const stackIdPattern = /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const complete = ["CREATE_COMPLETE", "UPDATE_COMPLETE"], failed = ["CREATE_FAILED", "UPDATE_FAILED", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "UPDATE_ROLLBACK_FAILED", "DELETE_FAILED"];
const terminalResource = [...complete, "CREATE_FAILED", "UPDATE_FAILED", "DELETE_FAILED", "DELETE_COMPLETE"];
const snapshots = new WeakSet<object>();
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function obj(v: unknown): Json { if (!v || typeof v !== "object" || Array.isArray(v)) cellV3Fail("CELL_V3_READ_OBJECT_INVALID"); return v as Json; }
function rows(v: unknown): Json[] { if (!Array.isArray(v)) cellV3Fail("CELL_V3_READ_ROWS_INVALID"); return v.map(obj); }
function strings(v: unknown, key: string, value: string) {
  const result: Record<string, string> = {};
  for (const r of rows(v)) { if (typeof r[key] !== "string" || typeof r[value] !== "string" || Object.hasOwn(result, r[key] as string)) cellV3Fail("CELL_V3_STACK_MAP_INVALID"); result[r[key] as string] = r[value] as string; }
  return result;
}
function assertCaller(profile: CellV3EvidenceProfile, id: Json) {
  if (id.Account !== "402010193138") cellV3Fail("CELL_V3_READ_CALLER_INVALID");
  if (profile === "source_inspection") { if (id.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || id.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("CELL_V3_READ_CALLER_INVALID"); return; }
  const role = profile === "provisioner" ? "TechlongSandboxProvisionerRole" : "TechlongSandboxCellLifecycleCoordinatorRoleV3";
  if (!new RegExp(`^arn:aws:sts::402010193138:assumed-role/${role}/[A-Za-z0-9+=,.@_-]{2,64}$`).test(String(id.Arn))) cellV3Fail("CELL_V3_READ_CALLER_INVALID");
}
export interface CellStackSnapshotV3 {
  schemaVersion: 3; protocol: "live-cell-stack-evidence-v3"; profile: CellV3EvidenceProfile; observedAt: number;
  birthIntentSha256: string; stackId: string; stackName: string; stackStatus: string; phase: CellV3Phase;
  templateCanonicalSha256: string; resourceInventorySha256: string; cellExpiresAt: string; cloudFormationRoleArn: typeof CELL_V3_CFN_ROLE;
  resources: { logicalResourceId: string; physicalResourceId: string | null; resourceStatus: string; resourceType: string }[];
  outputs: Record<string, string>; stableStackSha256: string; completePaidStack: boolean; failedCreationOrPhase: boolean;
}
export function assertCellStackSnapshotV3(v: CellStackSnapshotV3) { if (!snapshots.has(v)) cellV3Fail("CELL_V3_LIVE_EVIDENCE_PROVENANCE_INVALID"); }

/** Fixed read-only clients. No Create/Execute/Update/Delete command constructor. */
export class AwsSdkCellStackEvidenceV3 {
  private readonly sdk: CellV3ReadSdk; private readonly profile: CellV3EvidenceProfile; private readonly now: () => number;
  constructor(sdk: CellV3ReadSdk, profile: CellV3EvidenceProfile, now: () => number = Date.now) {
    if (!["source_inspection", "provisioner", "lifecycle_coordinator"].includes(profile)) cellV3Fail("CELL_V3_READ_PROFILE_INVALID");
    this.sdk = Object.freeze({ sts: Object.freeze({ send: sdk.sts.send.bind(sdk.sts) }), cfn: Object.freeze({ send: sdk.cfn.send.bind(sdk.cfn) }), commands: Object.freeze({ ...sdk.commands }) });
    this.profile = profile; this.now = now;
  }
  async read(plan: CellStackPlanV3, expectedStackId: string | null, signal: AbortSignal): Promise<CellStackSnapshotV3 | { state: "ABSENT"; name: string; observedAt: number; writes: 0 }> {
    assertCellStackPlanV3(plan); signal.throwIfAborted(); const started = cellV3Clock(this.now());
    if (expectedStackId !== null && !stackIdPattern.test(expectedStackId)) cellV3Fail("CELL_V3_EXACT_STACK_ID_REQUIRED");
    const send = async (command: unknown) => { signal.throwIfAborted(); const r = await this.sdk.cfn.send(command, { abortSignal: signal }); signal.throwIfAborted(); return r; };
    const identity = async () => { const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted(); assertCaller(this.profile, r); };
    await identity();
    const names = async () => {
      const n = new Set<string>(), seen = new Set<string>(); let token: string | undefined;
      do { const r = await send(new this.sdk.commands.list(token ? { NextToken: token } : {}));
        for (const x of rows(r.StackSummaries)) { if (typeof x.StackName !== "string" || typeof x.StackStatus !== "string") cellV3Fail("CELL_V3_STACK_LIST_INVALID"); if (x.StackStatus !== "DELETE_COMPLETE") n.add(x.StackName); }
        if (r.NextToken === undefined) token = undefined; else if (typeof r.NextToken !== "string" || !r.NextToken || seen.has(r.NextToken) || seen.size >= 99) cellV3Fail("CELL_V3_PAGINATION_INVALID"); else { token = r.NextToken; seen.add(token); }
      } while (token);
      if ([...n].some(x => x.startsWith("techlong-sandbox-cell-") && x !== plan.stackName)) cellV3Fail("CELL_V3_OTHER_CELL_PRESENT");
      return [...n].sort();
    };
    const firstNames = await names();
    const stack = async (id: string) => {
      const r = await send(new this.sdk.commands.describe({ StackName: id })), all = rows(r.Stacks); if (all.length !== 1) cellV3Fail("CELL_V3_STACK_RESPONSE_INVALID"); const x = all[0];
      const params = strings(x.Parameters, "ParameterKey", "ParameterValue"), tags = strings(x.Tags, "Key", "Value"), phase = params.LifecyclePhase as CellV3Phase;
      if (x.StackName !== plan.stackName || !stackIdPattern.test(String(x.StackId)) || (expectedStackId && x.StackId !== expectedStackId) || x.RoleARN !== CELL_V3_CFN_ROLE ||
        x.ParentId || x.RootId || x.EnableTerminationProtection !== false || !CELL_V3_PHASES.includes(phase) || !equal(params, plan.phaseParameters[phase]) || !equal(tags, plan.tags)) cellV3Fail("CELL_V3_STACK_BINDING_DRIFT");
      if (![...complete, ...failed].includes(String(x.StackStatus))) cellV3Fail("CELL_V3_STACK_NOT_TERMINAL");
      const createdAt = new Date(x.CreationTime as string).toISOString();
      if (Date.parse(createdAt) > cellV3Clock(this.now()) || Date.parse(createdAt) < plan.intent.input.base.requestedAt) cellV3Fail("CELL_V3_BIRTH_CLOCK_DRIFT");
      return { id: x.StackId as string, name: x.StackName as string, status: x.StackStatus as string, phase, parameters: params, tags,
        outputs: strings(x.Outputs ?? [], "OutputKey", "OutputValue"), role: x.RoleARN, createdAt,
        updatedAt: x.LastUpdatedTime ? new Date(x.LastUpdatedTime as string).toISOString() : null, disableRollback: x.DisableRollback === true };
    };
    let first: Awaited<ReturnType<typeof stack>>;
    try { first = await stack(expectedStackId ?? plan.stackName); }
    catch (e) {
      if ((e as Error).name !== "ValidationError" || !/does not exist/i.test((e as Error).message)) throw e;
      if (expectedStackId !== null || firstNames.includes(plan.stackName)) cellV3Fail("CELL_V3_STACK_ID_MISSING_REVIEW_REQUIRED");
      const lastNames = await names(); await identity(); const done = cellV3Clock(this.now());
      if (!equal(firstNames, lastNames) || done < started || done - started > 30000) cellV3Fail("CELL_V3_ABSENCE_READ_DRIFT");
      return cellV3Freeze({ state: "ABSENT" as const, name: plan.stackName, observedAt: done, writes: 0 as const });
    }
    const targetResources = obj(plan.template.Resources);
    const inspect = async (s: typeof first) => {
      const t = await send(new this.sdk.commands.template({ StackName: s.id, TemplateStage: "Original" }));
      const body = typeof t.TemplateBody === "string" ? JSON.parse(t.TemplateBody) : t.TemplateBody;
      if (!equal(body, plan.template)) cellV3Fail("CELL_V3_ORIGINAL_TEMPLATE_DRIFT");
      const inventory: CellStackSnapshotV3["resources"] = [], ids = new Set<string>(), tokens = new Set<string>(); let token: string | undefined;
      do { const r = await send(new this.sdk.commands.resources({ StackName: s.id, ...(token ? { NextToken: token } : {}) }));
        for (const x of rows(r.StackResourceSummaries)) {
          const logical = String(x.LogicalResourceId), expected = targetResources[logical] as Json | undefined;
          const eligible = expected && (logical === "CellLifecycleScheduleV3" ? s.phase !== "RESERVED" : s.phase === "PAID");
          const physical = typeof x.PhysicalResourceId === "string" && x.PhysicalResourceId ? x.PhysicalResourceId : null;
          if (!eligible || ids.has(logical) || x.ResourceType !== expected.Type || !terminalResource.includes(String(x.ResourceStatus)) ||
            (!physical && !["CREATE_FAILED", "DELETE_COMPLETE"].includes(String(x.ResourceStatus)))) cellV3Fail("CELL_V3_RESOURCE_INVENTORY_DRIFT");
          ids.add(logical); inventory.push({ logicalResourceId: logical, physicalResourceId: physical, resourceStatus: String(x.ResourceStatus), resourceType: String(x.ResourceType) });
        }
        if (r.NextToken === undefined) token = undefined; else if (typeof r.NextToken !== "string" || !r.NextToken || tokens.has(r.NextToken) || tokens.size >= 99) cellV3Fail("CELL_V3_PAGINATION_INVALID"); else { token = r.NextToken; tokens.add(token); }
      } while (token);
      inventory.sort((a, b) => a.logicalResourceId.localeCompare(b.logicalResourceId));
      const expectedIds = s.phase === "RESERVED" ? [] : s.phase === "ARMED" ? ["CellLifecycleScheduleV3"] : plan.resourceLogicalIds;
      if (complete.includes(s.status) && (!equal([...ids].sort(), expectedIds) || inventory.some(x => !complete.includes(x.resourceStatus) || !x.physicalResourceId))) cellV3Fail("CELL_V3_COMPLETE_INVENTORY_REQUIRED");
      if (failed.includes(s.status) && !s.disableRollback) cellV3Fail("CELL_V3_FAILED_STACK_ROLLBACK_STATE_UNVERIFIED");
      const expectedOutputs = s.phase === "PAID" ? Object.keys(obj(plan.template.Outputs)).sort() : ["BirthIntentSha256", "CellExpiresAt"];
      if (complete.includes(s.status)) {
        if (!equal(Object.keys(s.outputs).sort(), expectedOutputs) || s.outputs.CellExpiresAt !== plan.tags.ExpiresAt || s.outputs.BirthIntentSha256 !== plan.birthIntentSha256) cellV3Fail("CELL_V3_OUTPUTS_DRIFT");
        if (s.phase === "PAID" && (s.outputs.ClusterName !== "cell-sandbox-1" || s.outputs.DatabaseClusterIdentifier !== plan.stackName ||
          !/^techlong-sandbox-cell-sandbox-1\.cluster-[a-z0-9-]{6,63}\.ca-central-1\.rds\.amazonaws\.com$/.test(s.outputs.DatabaseEndpoint) ||
          !/^arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-[A-Za-z0-9/_+=.@!-]{7,512}$/.test(s.outputs.DatabaseMasterSecretArn))) cellV3Fail("CELL_V3_DATABASE_OUTPUTS_INVALID");
        if (s.phase === "PAID") {
          const physical = Object.fromEntries(inventory.map(x => [x.logicalResourceId, x.physicalResourceId]));
          for (const [output, logical] of [["VpcId", "CellVpc"], ["TaskSecurityGroupId", "TaskSecurityGroup"], ["OneShotTaskSecurityGroupId", "OneShotTaskSecurityGroup"],
            ["HttpsListenerArn", "BusinessHttpsListener"], ["ControlListenerArn", "ControlMtlsListener"]]) if (s.outputs[output] !== physical[logical]) cellV3Fail("CELL_V3_PHYSICAL_OUTPUT_BINDING_DRIFT");
          if (s.outputs.SubnetIds !== `${physical.PublicSubnetA},${physical.PublicSubnetB}` || physical.PublicSubnetA === physical.PublicSubnetB ||
            physical.TaskSecurityGroup === physical.OneShotTaskSecurityGroup || !/^vpc-[a-f0-9]{8,17}$/.test(s.outputs.VpcId) ||
            !/^sg-[a-f0-9]{8,17}$/.test(s.outputs.TaskSecurityGroupId) || !/^sg-[a-f0-9]{8,17}$/.test(s.outputs.OneShotTaskSecurityGroupId) ||
            s.outputs.SubnetIds.split(",").some(x => !/^subnet-[a-f0-9]{8,17}$/.test(x)) ||
            !["cell-sandbox-1", "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1"].includes(String(physical.CellCluster)) ||
            physical.CellDatabaseCluster !== plan.stackName) cellV3Fail("CELL_V3_PHYSICAL_OUTPUT_BINDING_DRIFT");
        }
      }
      let token2: string | undefined; const seen = new Set<string>(); let birthEvent = false;
      do { const r = await send(new this.sdk.commands.events({ StackName: s.id, ...(token2 ? { NextToken: token2 } : {}) }));
        birthEvent ||= rows(r.StackEvents).some(e => e.PhysicalResourceId === s.id && e.LogicalResourceId === plan.stackName && e.ResourceType === "AWS::CloudFormation::Stack" &&
          e.ResourceStatus === "CREATE_IN_PROGRESS" && e.ClientRequestToken === plan.reservationClientToken);
        if (r.NextToken === undefined || birthEvent) token2 = undefined; else if (typeof r.NextToken !== "string" || !r.NextToken || seen.has(r.NextToken) || seen.size >= 99) cellV3Fail("CELL_V3_PAGINATION_INVALID"); else { token2 = r.NextToken; seen.add(token2); }
      } while (token2);
      if (!birthEvent) cellV3Fail("CELL_V3_BIRTH_CREATE_TOKEN_UNVERIFIED");
      return { templateHash: await sha256Hex(body), inventory, inventoryHash: await sha256Hex(inventory) };
    };
    const a = await inspect(first), second = await stack(first.id), b = await inspect(second), lastNames = await names(); await identity(); const observedAt = cellV3Clock(this.now());
    if (observedAt < started || observedAt - started > 30000 || !equal(first, second) || !equal(a, b) || !equal(firstNames, lastNames)) cellV3Fail("CELL_V3_STACK_READ_DRIFT");
    const result: CellStackSnapshotV3 = cellV3Freeze({ schemaVersion: 3 as const, protocol: "live-cell-stack-evidence-v3" as const, profile: this.profile, observedAt, birthIntentSha256: plan.birthIntentSha256,
      stackId: first.id, stackName: first.name, stackStatus: first.status, phase: first.phase, templateCanonicalSha256: a.templateHash,
      resourceInventorySha256: a.inventoryHash, resources: a.inventory, outputs: first.outputs, cellExpiresAt: plan.tags.ExpiresAt, cloudFormationRoleArn: CELL_V3_CFN_ROLE,
      stableStackSha256: await sha256Hex(first), completePaidStack: first.phase === "PAID" && complete.includes(first.status), failedCreationOrPhase: failed.includes(first.status) });
    snapshots.add(result); return result;
  }
}

/** Existing durable schema2 predecessor is retained; only the evidence producer
 * changes. Never brands this object as the old renderer's provision evidence. */
export async function compileV3ProvisionPredecessor(plan: CellStackPlanV3, evidence: CellStackSnapshotV3, now: number) {
  assertCellStackPlanV3(plan); assertCellStackSnapshotV3(evidence); cellV3Clock(now);
  if (evidence.profile === "source_inspection" || !evidence.completePaidStack || evidence.birthIntentSha256 !== plan.birthIntentSha256 ||
    evidence.templateCanonicalSha256 !== plan.templateCanonicalSha256 || evidence.observedAt > now || now - evidence.observedAt > 30000 || Date.parse(evidence.cellExpiresAt) <= now) cellV3Fail("CELL_V3_PROVISION_EVIDENCE_INELIGIBLE");
  const source = { schemaVersion: 2 as const, accountId: "402010193138" as const, region: "ca-central-1" as const, cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const, stackId: evidence.stackId, stackStatus: evidence.stackStatus as "CREATE_COMPLETE" | "UPDATE_COMPLETE",
    cellExpiresAt: evidence.cellExpiresAt, cloudFormationRoleArn: CELL_V3_CFN_ROLE as typeof CELL_V3_CFN_ROLE, templateCanonicalSha256: evidence.templateCanonicalSha256, resourceInventorySha256: evidence.resourceInventorySha256,
    ownerDeploymentId: plan.intent.input.ownerDeploymentId, generation: plan.intent.input.generation, provisionEpoch: plan.intent.input.provisionEpoch,
    provisionMarker: sharedCellAuthorityMarker({ generation: plan.intent.input.generation, epoch: plan.intent.input.provisionEpoch }) };
  const unsigned = { ...source, provisionOperationHash: await sha256Hex(sharedCellProvisionOperationIntent(source)), revision: 1, state: "provision_verified" as const };
  const record = { ...unsigned, recordHash: await sha256Hex(unsigned) }, item = { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY, schema_version: 2 as const, revision: 1, record_json: canonicalJson(record) };
  await validateSharedCellAuthorityItem(item); return cellV3Freeze({ item, itemSha256: await sha256Hex(item), birthIntentSha256: plan.birthIntentSha256, authorityInstallationAuthorized: false, runtimeEnabled: false });
}

/** Bridge only the cleanup proof, after the independent complete v3 read. */
export class V3CellCleanupStackEvidenceBridge extends SharedCellCleanupStackEvidencePort {
  private readonly plan: CellStackPlanV3; private readonly reader: AwsSdkCellStackEvidenceV3;
  constructor(plan: CellStackPlanV3, reader: AwsSdkCellStackEvidenceV3) { super(); assertCellStackPlanV3(plan); this.plan = plan; this.reader = reader; }
  async readVerifiedCleanupStackEvidence(input: ReadSharedCellCleanupEvidenceInput) {
    const v = await this.reader.read(this.plan, input.predecessor.stackId, input.signal);
    if (!("protocol" in v) || !v.completePaidStack || v.profile === "source_inspection" || v.templateCanonicalSha256 !== input.predecessor.templateCanonicalSha256 || v.resourceInventorySha256 !== input.predecessor.resourceInventorySha256) cellV3Fail("CELL_V3_CLEANUP_BRIDGE_LINEAGE_DRIFT");
    return this.markVerified({ schemaVersion: 1, verified: true, observedAt: v.observedAt, accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", stackName: "techlong-sandbox-cell-sandbox-1",
      stackId: v.stackId, stackStatus: v.stackStatus as "CREATE_COMPLETE" | "UPDATE_COMPLETE", cellExpiresAt: v.cellExpiresAt, cloudFormationRoleArn: CELL_V3_CFN_ROLE,
      templateCanonicalSha256: v.templateCanonicalSha256, resourceInventorySha256: v.resourceInventorySha256 });
  }
}

export function createCellV3EvidenceFromCredentials(credentials: unknown, profile: CellV3EvidenceProfile) {
  const config = { region: "ca-central-1", credentials: credentials as never, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, sts = new STSClient(config), cfn = new CloudFormationClient(config);
  const reader = new AwsSdkCellStackEvidenceV3({ sts: sts as unknown as Client, cfn: cfn as unknown as Client,
    commands: { identity: GetCallerIdentityCommand as unknown as Command, describe: DescribeStacksCommand as unknown as Command, template: GetTemplateCommand as unknown as Command,
      resources: ListStackResourcesCommand as unknown as Command, events: DescribeStackEventsCommand as unknown as Command, list: ListStacksCommand as unknown as Command } }, profile);
  return Object.freeze({ reader, dispose: () => { sts.destroy(); cfn.destroy(); } });
}
