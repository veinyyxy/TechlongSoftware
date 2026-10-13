import { assertSingleTenantCellRender, type renderSingleTenantAcceptanceCell } from "../cloudformation/single-tenant-acceptance-cell.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export const ACCEPTANCE_CELL_SERVICE_ROLE = "arn:aws:iam::402010193138:role/TechlongSandboxFirstAcceptanceCellExecutionRole";
const account = "402010193138", region = "ca-central-1", name = "techlong-sandbox-cell-sandbox-1";
const source = "arn:aws:iam::402010193138:user/techlong-sandbox-dev", userId = "AIDAV3GNMXTZEO7SHLC2X";
type CellDraft = Awaited<ReturnType<typeof renderSingleTenantAcceptanceCell>>;
export interface AcceptanceCellSnapshot {
  stackId: string; status: string; roleArn: string; tags: Record<string, string>;
  templateSha256: string;
  resources: { logicalId: string; type: string; physicalId: string; status: string }[];
}
export interface AcceptanceCellSdkPort {
  identity(signal: AbortSignal): Promise<{ Account?: string; Arn?: string; UserId?: string }>;
  describe(stackIdOrName: string, signal: AbortSignal): Promise<{ stackId: string; status: string; roleArn: string; tags: Record<string, string> } | null>;
  template(stackId: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  resources(stackId: string, signal: AbortSignal): Promise<AcceptanceCellSnapshot["resources"]>;
  create(input: Record<string, unknown>, signal: AbortSignal): Promise<string>;
  delete(input: Record<string, unknown>, signal: AbortSignal): Promise<void>;
}
export interface AcceptanceCellCreateReceipt {
  schemaVersion: 1; stackId: string; clientRequestToken: string; reviewSha256: string;
  templateSha256: string; tags: Record<string, string>; serviceRoleArn: typeof ACCEPTANCE_CELL_SERVICE_ROLE;
  inventory: CellDraft["resourceInventory"];
}
/** Future M2 root supplies fresh, independently reviewed permission/ownership
 * guards and durable one-shot journal. Construction never calls them or AWS.
 * A caller cannot replace either requirement with an enablement boolean.
 */
export interface AcceptanceCellOperationControl {
  beforeCreate(input: { draft: CellDraft; reviewSha256: string; signal: AbortSignal }): Promise<void>;
  beforeDelete(input: { receipt: AcceptanceCellCreateReceipt; snapshot: AcceptanceCellSnapshot; reviewSha256: string; signal: AbortSignal }): Promise<void>;
  consume(input: { action: "create" | "delete"; reviewSha256: string; target: string; clientRequestToken: string }): Promise<void>;
  captureCreated(receipt: AcceptanceCellCreateReceipt): Promise<void>;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function exactId(id: string): void {
  if (!/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) fail("ACCEPTANCE_CELL_EXACT_STACK_ID_REQUIRED");
}
function sha(value: string): void { if (!/^[a-f0-9]{64}$/.test(value)) fail("ACCEPTANCE_CELL_REVIEW_SHA_REQUIRED"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Single Cell create/delete, not a general birth/death factory. No update,
 * ForceDelete, RetainResources, automatic write retry, scheduling or F3c9 call.
 * Submitted is not complete: later read-only snapshot/absence is still needed.
 */
export class SingleTenantAcceptanceCellOperations {
  private readonly sdk: AcceptanceCellSdkPort;
  private readonly control: AcceptanceCellOperationControl;
  constructor(sdk: AcceptanceCellSdkPort, control: AcceptanceCellOperationControl) {
    for (const method of ["beforeCreate", "beforeDelete", "consume", "captureCreated"] as const) {
      if (typeof control?.[method] !== "function") fail("ACCEPTANCE_CELL_REVIEWED_CONTROL_MISSING");
    }
    this.sdk = sdk; this.control = control;
  }
  private async caller(signal: AbortSignal) {
    signal.throwIfAborted(); const identity = await this.sdk.identity(signal); signal.throwIfAborted();
    if (identity.Account !== account || identity.Arn !== source || identity.UserId !== userId) fail("ACCEPTANCE_CELL_SOURCE_IDENTITY_MISMATCH");
  }
  async create(input: { draft: CellDraft; approvedReviewSha256: string; signal: AbortSignal }): Promise<AcceptanceCellCreateReceipt> {
    assertSingleTenantCellRender(input.draft);
    const draft = freeze(structuredClone(input.draft)), reviewSha256 = input.approvedReviewSha256;
    sha(reviewSha256); input.signal.throwIfAborted();
    if (draft.accountId !== account || draft.region !== region || draft.stackName !== name ||
      draft.protocol !== "single-tenant-supervised-acceptance" || draft.resourceInventory.length !== 25 ||
      draft.templateBody !== canonicalJson(draft.template) || draft.templateSha256 !== await sha256Hex(draft.template) ||
      draft.resourceInventory.some(r => /^(AWS::(?:IAM|Lambda|Scheduler)::|Custom::)/.test(r.type))) fail("ACCEPTANCE_CELL_DRAFT_INVALID");
    await this.control.beforeCreate({ draft, reviewSha256, signal: input.signal });
    await this.caller(input.signal);
    if (await this.sdk.describe(name, input.signal)) fail("ACCEPTANCE_CELL_NAME_OCCUPIED_NO_REPLAY");
    const clientRequestToken = `accept-cell-${reviewSha256}`;
    await this.control.consume({ action: "create", reviewSha256, target: name, clientRequestToken });
    await this.control.beforeCreate({ draft, reviewSha256, signal: input.signal });
    await this.caller(input.signal); input.signal.throwIfAborted();
    const stackId = await this.sdk.create({ StackName: name, TemplateBody: draft.templateBody,
      Parameters: Object.entries(draft.parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
      Tags: Object.entries(draft.tags).map(([Key, Value]) => ({ Key, Value })),
      RoleARN: ACCEPTANCE_CELL_SERVICE_ROLE, ClientRequestToken: clientRequestToken,
      OnFailure: "ROLLBACK", TimeoutInMinutes: 45, EnableTerminationProtection: false }, input.signal);
    exactId(stackId);
    // Capture even if cancellation raced with the response: losing this exact
    // identity would make later supervised cleanup ambiguous. Capture is not
    // a cloud write; failure still leaves the consumed journal for inspection.
    const receipt: AcceptanceCellCreateReceipt = { schemaVersion: 1, stackId, clientRequestToken, reviewSha256,
      templateSha256: draft.templateSha256, tags: draft.tags, serviceRoleArn: ACCEPTANCE_CELL_SERVICE_ROLE, inventory: draft.resourceInventory };
    await this.control.captureCreated(structuredClone(receipt));
    return receipt;
  }
  async inspect(receipt: AcceptanceCellCreateReceipt, signal: AbortSignal): Promise<AcceptanceCellSnapshot | null> {
    exactId(receipt.stackId); sha(receipt.templateSha256); sha(receipt.reviewSha256);
    if (receipt.schemaVersion !== 1 || receipt.serviceRoleArn !== ACCEPTANCE_CELL_SERVICE_ROLE || receipt.inventory.length !== 25) fail("ACCEPTANCE_CELL_RECEIPT_INVALID");
    await this.caller(signal);
    const stack = await this.sdk.describe(receipt.stackId, signal);
    if (!stack || stack.status === "DELETE_COMPLETE") return null;
    if (stack.stackId !== receipt.stackId || stack.roleArn !== receipt.serviceRoleArn || canonicalJson(stack.tags) !== canonicalJson(receipt.tags)) fail("ACCEPTANCE_CELL_IDENTITY_DRIFT");
    const template = await this.sdk.template(receipt.stackId, signal), resources = await this.sdk.resources(receipt.stackId, signal);
    signal.throwIfAborted();
    if (await sha256Hex(template) !== receipt.templateSha256 || new Set(resources.map(r => r.logicalId)).size !== resources.length ||
      resources.some(r => !r.physicalId || !receipt.inventory.some(expected => expected.logicalId === r.logicalId && expected.type === r.type))) {
      fail("ACCEPTANCE_CELL_TEMPLATE_OR_INVENTORY_DRIFT");
    }
    return { ...stack, resources, templateSha256: receipt.templateSha256 };
  }
  async delete(input: { receipt: AcceptanceCellCreateReceipt; approvedReviewSha256: string; signal: AbortSignal }) {
    sha(input.approvedReviewSha256);
    const receipt = freeze(structuredClone(input.receipt)), snapshot = await this.inspect(receipt, input.signal);
    if (!snapshot) return { outcome: "ALREADY_DELETED_EXACT_UUID" as const, stackId: receipt.stackId };
    if (snapshot.status === "DELETE_IN_PROGRESS") return { outcome: "DELETE_IN_PROGRESS" as const, stackId: receipt.stackId };
    if (!/^(CREATE_COMPLETE|CREATE_FAILED|ROLLBACK_COMPLETE|ROLLBACK_FAILED|DELETE_FAILED)$/.test(snapshot.status)) fail("ACCEPTANCE_CELL_STATE_REQUIRES_INSPECT");
    freeze(snapshot);
    await this.control.beforeDelete({ receipt, snapshot, reviewSha256: input.approvedReviewSha256, signal: input.signal });
    const clientRequestToken = `accept-cleanup-${input.approvedReviewSha256}`;
    await this.control.consume({ action: "delete", reviewSha256: input.approvedReviewSha256, target: receipt.stackId, clientRequestToken });
    // Consumption must not silently broaden the previously observed UUID. No
    // name lookup/rebind on any path; drift/unknown state requires inspection.
    const current = await this.inspect(receipt, input.signal);
    if (!current || canonicalJson(current) !== canonicalJson(snapshot)) fail("ACCEPTANCE_CELL_CHANGED_BEFORE_DELETE");
    freeze(current);
    await this.control.beforeDelete({ receipt, snapshot: current, reviewSha256: input.approvedReviewSha256, signal: input.signal });
    await this.caller(input.signal); input.signal.throwIfAborted();
    await this.sdk.delete({ StackName: receipt.stackId, RoleARN: receipt.serviceRoleArn, ClientRequestToken: clientRequestToken,
      DeletionMode: "STANDARD" }, input.signal);
    return { outcome: "DELETE_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT" as const, stackId: receipt.stackId };
  }
}

/** Lazy SDK construction shares a refreshing credential provider. It does not
 * create IAM or prove the dedicated role exists. Every actual write rechecks
 * exact Source identity and delegates fresh approval to the control boundary.
 */
export async function createAcceptanceCellSdkPort(): Promise<AcceptanceCellSdkPort> {
  const cfnPackage = "@aws-sdk/client-cloudformation", stsPackage = "@aws-sdk/client-sts", credentialsPackage = "@aws-sdk/credential-provider-node";
  const [cfn, sts, provider] = await Promise.all([import(cfnPackage), import(stsPackage), import(credentialsPackage)]);
  const credentials = provider.defaultProvider({ profile: "techlong-sandbox-user" });
  const config = { region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const client = new cfn.CloudFormationClient(config), identity = new sts.STSClient(config);
  const send = (command: unknown, signal: AbortSignal) => client.send(command, { abortSignal: signal });
  return {
    identity: signal => identity.send(new sts.GetCallerIdentityCommand({}), { abortSignal: signal }),
    async describe(id, signal) {
      try {
        const r = await send(new cfn.DescribeStacksCommand({ StackName: id }), signal);
        if (r.Stacks?.length !== 1 || !r.Stacks[0].StackId || !r.Stacks[0].StackStatus || !r.Stacks[0].RoleARN) fail("ACCEPTANCE_CELL_DESCRIBE_INVALID");
        const s = r.Stacks[0], tags = (s.Tags ?? []) as { Key: string; Value: string }[];
        if (new Set(tags.map(t => t.Key)).size !== tags.length) fail("ACCEPTANCE_CELL_DUPLICATE_TAGS");
        return { stackId: s.StackId, status: s.StackStatus, roleArn: s.RoleARN, tags: Object.fromEntries(tags.map(t => [t.Key, t.Value])) };
      } catch (error) {
        signal.throwIfAborted();
        if (error && typeof error === "object" && "name" in error && error.name === "ValidationError" &&
          "message" in error && error.message === `Stack with id ${id} does not exist`) return null;
        throw error;
      }
    },
    async template(id, signal) {
      const r = await send(new cfn.GetTemplateCommand({ StackName: id, TemplateStage: "Original" }), signal);
      if (typeof r.TemplateBody !== "string") fail("ACCEPTANCE_CELL_TEMPLATE_MISSING");
      const body = JSON.parse(r.TemplateBody); if (!body || typeof body !== "object" || Array.isArray(body)) fail("ACCEPTANCE_CELL_TEMPLATE_INVALID");
      return body;
    },
    async resources(id, signal) {
      const rows: AcceptanceCellSnapshot["resources"] = []; let token: string | undefined;
      const seen = new Set<string>();
      do {
        if (token && seen.has(token)) fail("ACCEPTANCE_CELL_PAGINATION_CYCLE"); if (token) seen.add(token);
        const r = await send(new cfn.ListStackResourcesCommand({ StackName: id, NextToken: token }), signal);
        for (const s of r.StackResourceSummaries ?? []) {
          // Failed creation may have no physical object. Preserve the logical
          // failure in events; don't invent it as a deletable resource identity.
          if (!s.PhysicalResourceId && s.ResourceStatus === "CREATE_FAILED") continue;
          if (!s.LogicalResourceId || !s.ResourceType || !s.PhysicalResourceId || !s.ResourceStatus) fail("ACCEPTANCE_CELL_RESOURCE_ROW_INVALID");
          rows.push({ logicalId: s.LogicalResourceId, type: s.ResourceType, physicalId: s.PhysicalResourceId, status: s.ResourceStatus });
        }
        token = r.NextToken; if (rows.length > 25 || seen.size > 25) fail("ACCEPTANCE_CELL_INVENTORY_TOO_LARGE");
      } while (token);
      return rows.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
    },
    async create(request, signal) { const r = await send(new cfn.CreateStackCommand(request), signal); return r.StackId ?? ""; },
    async delete(request, signal) { await send(new cfn.DeleteStackCommand(request), signal); },
  };
}
