import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID as accountId,
  SHARED_CELL_AUTHOR_COMPENSATION_REGION as region,
  SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME as cellStackName,
  readSharedCellAuthorCompensationCellSafety,
  type SharedCellAuthorCompensationCellSafetyBinding,
  type SharedCellAuthorCompensationCellSafetyObservation,
} from "./shared-cell-author-compensation.ts";
import { AwsSdkSharedCellAuthorCompensationEvidenceAdapter } from "./aws-sdk-shared-cell-author-compensation.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID as stackId,
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME as stackName,
  SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN as sourceArn,
  compileSharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContractInput,
  type SharedCellAuthorCompensationLifecycleRendererShape,
  type SharedCellAuthorCompensationManagementObservation,
  type SharedCellAuthorCompensationManagementReadPort,
} from "./shared-cell-author-compensation-grant-lifecycle.ts";
import {
  assertSharedCellAuthorCompensationLifecycleActionRequest,
  SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS,
  sharedCellAuthorCompensationLifecycleActionRequestSha256,
  type SharedCellAuthorCompensationLifecycleActionRequest,
} from "./shared-cell-author-compensation-operation-store.ts";
import type {
  SharedCellAuthorCompensationPhaseGrantMutationPort,
  SharedCellAuthorCompensationPhaseRevokeMutationPort,
} from "./shared-cell-author-compensation-grant-controller.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_DEFAULT_ENABLED = false;
export const SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_PROFILE = "techlong-sandbox-user";
const authorityTable = "techlong-sandbox-tenant-external-epoch-authority";
const authorityKey = "cell:cell-sandbox-1";
const maximumObservationMs = 30_000;
const resources = [
  ["CellOperatorBoundary", "AWS::IAM::ManagedPolicy", "TechlongSandboxCellOperatorBoundary"],
  ["CellOperatorRole", "AWS::IAM::Role", "TechlongSandboxCellOperatorRole"],
  ["CellCloudFormationExecutionBoundary", "AWS::IAM::ManagedPolicy", "TechlongSandboxCellCloudFormationExecutionBoundary"],
  ["CellCloudFormationExecutionRole", "AWS::IAM::Role", "TechlongSandboxCellCloudFormationExecutionRole"],
] as const;
const policyArn = (name: string) => `arn:aws:iam::${accountId}:policy/${name}`;
const roleArn = (name: string) => `arn:aws:iam::${accountId}:role/${name}`;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const changeSetArnPattern = new RegExp(`^arn:aws:cloudformation:${region}:${accountId}:changeSet/(techlong-j5gj3-(?:grant|revoke)-[a-f0-9]{16})/${uuid}$`);

export class SharedCellAuthorCompensationManagementAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
function invalid(message: string): never {
  throw new SharedCellAuthorCompensationManagementAdapterError(
    "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_INVALID", message,
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid("Expected a complete provider list.");
  return value;
}
function exact(value: unknown, keys: string[]): void {
  if (canonicalJson(Object.keys(record(value)).sort()) !== canonicalJson(keys.sort())) invalid("Unexpected or missing input fields.");
}
function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) invalid(`${label} drifted.`);
}
function signal(value: AbortSignal): void {
  if (!value || typeof value.throwIfAborted !== "function") invalid("A caller abort signal is required.");
  value.throwIfAborted();
}
function immutable<T>(value: T): Readonly<T> {
  const clone = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown): void {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(clone);
  return clone;
}
function document(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value.startsWith("{") ? value : decodeURIComponent(value))); }
    catch { invalid("IAM policy document is not valid JSON."); }
  }
  return record(value);
}
function resolveTrust(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveTrust);
  if (value && typeof value === "object") {
    const source = record(value);
    if (Object.keys(source).length === 1 && source.Ref === "ManagementPrincipalArn") return sourceArn;
    if ("Ref" in source || Object.keys(source).some((key) => key.startsWith("Fn::"))) invalid("Unreviewed IAM trust intrinsic.");
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, resolveTrust(item)]));
  }
  return value;
}
function template(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 51_200) invalid("Original template must preserve its reviewed JSON bytes.");
  let body: Record<string, unknown>;
  try { body = record(JSON.parse(raw)); } catch { invalid("Original template is not JSON."); }
  if (body.Transform !== undefined) invalid("Management templates cannot contain transforms.");
  const inventory = record(body.Resources);
  same(Object.keys(inventory).sort(), resources.map(([id]) => id).sort(), "Template resource inventory");
  for (const [id, type, name] of resources) {
    const resource = record(inventory[id]);
    const properties = record(resource.Properties);
    if (resource.Type !== type || properties[type === "AWS::IAM::Role" ? "RoleName" : "ManagedPolicyName"] !== name) invalid("Template IAM identities drifted.");
    if (type === "AWS::IAM::Role" && properties.Policies !== undefined) invalid("Temporary inline role policies are forbidden.");
  }
  const boundary = record(record(body.Metadata).SafetyBoundary);
  if (boundary.CreatesIamOnly !== true || boundary.CreatesSharedCell !== false || boundary.CreatesPaidCellResources !== false || boundary.PaidCellExecutionApproved !== false) invalid("Template safety metadata drifted.");
  return body;
}
function shape(body: Record<string, unknown>): SharedCellAuthorCompensationLifecycleRendererShape {
  const value = record(record(body.Metadata).SafetyBoundary).OperatorGrantState;
  if (value === "LOCKED") return "Locked";
  if (value === "AUTHORCOMPENSATIONDELETECHANGESETGRANT") return "AuthorCompensationDeleteChangeSetGrant";
  if (value === "AUTHORCOMPENSATIONDELETESTACKGRANT") return "AuthorCompensationDeleteStackGrant";
  return invalid("Only Locked and split compensation management shapes are supported.");
}
function properties(body: Record<string, unknown>, id: string): Record<string, unknown> {
  return record(record(record(body.Resources)[id]).Properties);
}
function unpaginated(response: Record<string, unknown>, iam = false): void {
  if (response.NextToken || response.Marker || (iam && response.IsTruncated !== false)) invalid("Provider inventory is truncated or lacks a complete-page proof.");
}
function optionalEmpty(value: unknown): boolean { return value === undefined || value === null || value === ""; }

type Command = new (input: Record<string, unknown>) => unknown;
interface Client { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
export type CollectedManagementObservation = Omit<SharedCellAuthorCompensationManagementObservation, "stack"> & {
  stack: Omit<SharedCellAuthorCompensationManagementObservation["stack"], "status"> & { status: "CREATE_COMPLETE" | "UPDATE_COMPLETE" };
};
export interface SharedCellAuthorCompensationManagementReadDependencies {
  clients: { sts: Client; cloudFormation: Client; iam: Client; dynamoDb: Client };
  commands: Record<
    "getCallerIdentity" | "describeStacks" | "getTemplate" | "listStackResources" |
    "getPolicy" | "getPolicyVersion" | "listPolicyVersions" | "listEntitiesForPolicy" |
    "getRole" | "listAttachedRolePolicies" | "listRolePolicies" | "getItem" | "describeChangeSet", Command>;
  now?: () => number;
}
const readCommandNames = ["getCallerIdentity", "describeStacks", "getTemplate", "listStackResources", "getPolicy", "getPolicyVersion", "listPolicyVersions", "listEntitiesForPolicy", "getRole", "listAttachedRolePolicies", "listRolePolicies", "getItem", "describeChangeSet"] as const;

/** Read capability only. Every observation is collected from the provider. */
export class AwsSdkSharedCellAuthorCompensationManagementReadAdapter implements SharedCellAuthorCompensationManagementReadPort {
  private readonly now: () => number;
  private readonly sdk: SharedCellAuthorCompensationManagementReadDependencies;
  constructor(sdk: SharedCellAuthorCompensationManagementReadDependencies) {
    if (!sdk || Object.values(sdk.clients ?? {}).length !== 4 || Object.values(sdk.clients).some((client) => typeof client?.send !== "function") || readCommandNames.some((name) => typeof sdk.commands?.[name] !== "function")) invalid("Management read SDK dependencies are incomplete.");
    this.now = sdk.now ?? Date.now;
    this.sdk = sdk;
    if (typeof this.now !== "function") invalid("Management clock is invalid.");
  }
  private async send(client: Client, command: Command, input: Record<string, unknown>, abort: AbortSignal): Promise<Record<string, unknown>> {
    signal(abort);
    try {
      const result = record(await client.send(new command(input), { abortSignal: abort }));
      signal(abort);
      return result;
    } catch (error) {
      signal(abort);
      if (error instanceof SharedCellAuthorCompensationManagementAdapterError) throw error;
      throw new SharedCellAuthorCompensationManagementAdapterError("SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_READ_FAILED", "The exact management provider read failed.", true);
    }
  }
  private async identity(abort: AbortSignal): Promise<void> {
    const value = await this.send(this.sdk.clients.sts, this.sdk.commands.getCallerIdentity, {}, abort);
    if (value.Account !== accountId || value.Arn !== sourceArn || typeof value.UserId !== "string" || !value.UserId.startsWith("AIDA")) invalid("Expected the exact Source IAM User identity.");
  }
  private async authorityAbsent(abort: AbortSignal): Promise<void> {
    const authority = await this.send(this.sdk.clients.dynamoDb, this.sdk.commands.getItem, { TableName: authorityTable, Key: { authority_key: { S: authorityKey } }, ConsistentRead: true }, abort);
    if (authority.Item !== undefined) invalid("The exact Cell authority item is not ABSENT.");
  }
  private async absent(abort: AbortSignal): Promise<void> {
    signal(abort);
    try {
      await this.sdk.clients.cloudFormation.send(new this.sdk.commands.describeStacks({ StackName: cellStackName }), { abortSignal: abort });
      invalid("The Cell must be MISSING for a legacy lifecycle receipt without explicit safety binding.");
    } catch (error) {
      signal(abort);
      const source = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: number } };
      if (source.name !== "ValidationError" || source.message !== `Stack with id ${cellStackName} does not exist` || source.$metadata?.httpStatusCode !== 400) {
        if (error instanceof SharedCellAuthorCompensationManagementAdapterError) throw error;
        throw new SharedCellAuthorCompensationManagementAdapterError("SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_CELL_NOT_PROVEN_MISSING", "Cell absence was not proved by an exact name-bound provider error.", true);
      }
    }
    await this.authorityAbsent(abort);
  }
  private async cellSafety(binding: SharedCellAuthorCompensationCellSafetyBinding | undefined, abort: AbortSignal): Promise<Readonly<SharedCellAuthorCompensationCellSafetyObservation> | undefined> {
    if (!binding) { await this.absent(abort); return undefined; }
    // Keep the Source adapter's stricter HTTP-bound absence rule when reusing
    // the existing normalized read adapter; do not weaken the legacy fence.
    const cellReads: Client = { send: async (command, options) => {
      try {
        const response = await this.sdk.clients.cloudFormation.send(command, options);
        if (command instanceof this.sdk.commands.describeStacks) unpaginated(response);
        return response;
      } catch (error) {
        signal(options.abortSignal);
        const provider = error as { name?: unknown; $metadata?: { httpStatusCode?: number } };
        if (provider.name === "ValidationError" && provider.$metadata?.httpStatusCode !== 400) invalid("Cell absence lacks the exact HTTP-bound provider proof.");
        throw error;
      }
    } };
    const evidence = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(region, {
      clients: { sts: this.sdk.clients.sts, cloudFormation: cellReads },
      commands: this.sdk.commands,
    });
    return readSharedCellAuthorCompensationCellSafety({ binding, evidence,
      authority: { readStrong: async ({ signal: abort }) => {
        await this.authorityAbsent(abort);
        return { authorityKey, item: null, revision: 0 };
      } }, signal: abort });
  }
  private async stack(abort: AbortSignal, allowCreatedLocked = false): Promise<Record<string, unknown>> {
    const response = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.describeStacks, { StackName: stackId }, abort);
    unpaginated(response);
    const entries = array(response.Stacks);
    if (entries.length !== 1) invalid("Management Stack read is not singular.");
    const stack = record(entries[0]);
    if (stack.StackName !== stackName || stack.StackId !== stackId || (stack.StackStatus !== "UPDATE_COMPLETE" && !(allowCreatedLocked && stack.StackStatus === "CREATE_COMPLETE")) || !optionalEmpty(stack.RoleARN) || !optionalEmpty(stack.ParentId) || !optionalEmpty(stack.RootId) || stack.EnableTerminationProtection !== false) invalid("Management Stack identity or completed state drifted.");
    same(array(stack.Parameters).map((entry) => { const item = record(entry); return [item.ParameterKey, item.ParameterValue]; }).sort(), [["ExpectedAccountId", accountId], ["ExpectedRegion", region], ["ManagementPrincipalArn", sourceArn]].sort(), "Management parameters");
    return stack;
  }
  private async policy(body: Record<string, unknown>, index: 0 | 2, abort: AbortSignal): Promise<SharedCellAuthorCompensationManagementObservation["policies"][number]> {
    const [logicalId, , name] = resources[index];
    const arn = policyArn(name);
    const expected = properties(body, logicalId);
    const metadata = record((await this.send(this.sdk.clients.iam, this.sdk.commands.getPolicy, { PolicyArn: arn }, abort)).Policy);
    if (metadata.Arn !== arn || metadata.PolicyName !== name || metadata.Path !== "/" || metadata.IsAttachable !== true || metadata.Description !== expected.Description || metadata.AttachmentCount !== (index === 0 ? 1 : 0) || metadata.PermissionsBoundaryUsageCount !== 1 || !/^v[1-9][0-9]*$/.test(String(metadata.DefaultVersionId))) invalid("Managed policy metadata drifted.");
    const response = await this.send(this.sdk.clients.iam, this.sdk.commands.listPolicyVersions, { PolicyArn: arn }, abort);
    unpaginated(response, true);
    const versions = array(response.Versions).map(record);
    if (versions.length < 1 || versions.length > 5 || (index === 2 && versions.length !== 1) || new Set(versions.map((version) => version.VersionId)).size !== versions.length || versions.filter((version) => version.IsDefaultVersion === true).length !== 1) invalid("Managed policy version inventory drifted.");
    let defaultDocumentSha256 = "";
    for (const version of versions) {
      if (!/^v[1-9][0-9]*$/.test(String(version.VersionId)) || typeof version.IsDefaultVersion !== "boolean" || (version.IsDefaultVersion && version.VersionId !== metadata.DefaultVersionId)) invalid("Managed policy default version drifted.");
      const observed = record((await this.send(this.sdk.clients.iam, this.sdk.commands.getPolicyVersion, { PolicyArn: arn, VersionId: version.VersionId }, abort)).PolicyVersion);
      if (observed.VersionId !== version.VersionId || observed.IsDefaultVersion !== version.IsDefaultVersion) invalid("Managed policy version changed during readback.");
      const parsed = document(observed.Document);
      if (version.IsDefaultVersion) {
        same(parsed, expected.PolicyDocument, "Default policy document");
        defaultDocumentSha256 = await sha256Hex(canonicalJson(parsed));
      }
    }
    const roleName = resources[index + 1][2];
    const entities: string[][] = [];
    for (const usage of ["PermissionsPolicy", "PermissionsBoundary"]) {
      const entitiesResponse = await this.send(this.sdk.clients.iam, this.sdk.commands.listEntitiesForPolicy, { PolicyArn: arn, PolicyUsageFilter: usage }, abort);
      unpaginated(entitiesResponse, true);
      if (array(entitiesResponse.PolicyUsers).length || array(entitiesResponse.PolicyGroups).length) invalid("Managed policy is associated with a user or group.");
      const roles = array(entitiesResponse.PolicyRoles).map(record);
      const expectedNames = usage === "PermissionsBoundary" || index === 0 ? [roleName] : [];
      same(roles.map((role) => role.RoleName).sort(), expectedNames, "Policy role associations");
      if (roles.some((role) => typeof role.RoleId !== "string" || !role.RoleId)) invalid("Policy association lacks a role identity.");
      entities.push(roles.map((role) => roleArn(String(role.RoleName))).sort());
    }
    return { logicalId: logicalId as "CellOperatorBoundary" | "CellCloudFormationExecutionBoundary", arn, name, defaultVersionId: String(metadata.DefaultVersionId), versionIds: versions.map((version) => String(version.VersionId)).sort(), defaultDocumentSha256, attachmentCount: index === 0 ? 1 : 0, permissionsBoundaryUsageCount: 1, identityRoleArns: entities[0], boundaryRoleArns: entities[1] };
  }
  private async role(body: Record<string, unknown>, index: 1 | 3, abort: AbortSignal): Promise<SharedCellAuthorCompensationManagementObservation["roles"][number]> {
    const [logicalId, , name] = resources[index];
    const arn = roleArn(name);
    const boundaryArn = policyArn(resources[index - 1][2]);
    const expected = properties(body, logicalId);
    const role = record((await this.send(this.sdk.clients.iam, this.sdk.commands.getRole, { RoleName: name }, abort)).Role);
    const boundary = record(role.PermissionsBoundary);
    if (role.Arn !== arn || role.RoleName !== name || role.Path !== "/" || role.Description !== expected.Description || role.MaxSessionDuration !== expected.MaxSessionDuration || boundary.PermissionsBoundaryArn !== boundaryArn || boundary.PermissionsBoundaryType !== "Policy") invalid("Role identity, boundary, or session duration drifted.");
    const trust = document(role.AssumeRolePolicyDocument);
    same(trust, resolveTrust(expected.AssumeRolePolicyDocument), "Role trust policy");
    const tags = array(role.Tags).map(record);
    const allowedSystemTags = new Map([["aws:cloudformation:logical-id", logicalId], ["aws:cloudformation:stack-id", stackId], ["aws:cloudformation:stack-name", stackName]]);
    if (new Set(tags.map((tag) => tag.Key)).size !== tags.length) invalid("Role tags contain duplicates.");
    const businessTags = tags.filter((tag) => !String(tag.Key).startsWith("aws:"));
    same(businessTags.sort((a, b) => String(a.Key).localeCompare(String(b.Key))), [...array(expected.Tags)].sort((a, b) => String(record(a).Key).localeCompare(String(record(b).Key))), "Role business tags");
    if (tags.some((tag) => String(tag.Key).startsWith("aws:") && allowedSystemTags.get(String(tag.Key)) !== tag.Value)) invalid("Role system tags drifted.");
    const attached = await this.send(this.sdk.clients.iam, this.sdk.commands.listAttachedRolePolicies, { RoleName: name }, abort);
    const inline = await this.send(this.sdk.clients.iam, this.sdk.commands.listRolePolicies, { RoleName: name }, abort);
    unpaginated(attached, true); unpaginated(inline, true);
    const attachments = array(attached.AttachedPolicies).map(record);
    same(attachments.map((entry) => [entry.PolicyArn, entry.PolicyName]), index === 1 ? [[boundaryArn, resources[0][2]]] : [], "Role attached policies");
    same(array(inline.PolicyNames), [], "Role inline policies");
    return { logicalId: logicalId as "CellOperatorRole" | "CellCloudFormationExecutionRole", arn, name, permissionsBoundaryArn: boundaryArn, attachedPolicyArns: attachments.map((entry) => String(entry.PolicyArn)), inlinePolicyNames: [], trustPolicySha256: await sha256Hex(canonicalJson(trust)) };
  }
  private async collectObservation(input: { signal: AbortSignal; cellSafety?: SharedCellAuthorCompensationCellSafetyBinding }, allowCreatedLocked = false): Promise<Readonly<CollectedManagementObservation>> {
    exact(input, ["signal", ...(Object.hasOwn(input, "cellSafety") ? ["cellSafety"] : [])]); signal(input.signal);
    if (Object.hasOwn(input, "cellSafety") && !input.cellSafety) invalid("An explicit Cell safety binding cannot be empty.");
    const binding = input.cellSafety ? immutable(input.cellSafety) : undefined;
    const startedAt = this.now();
    await this.identity(input.signal);
    const firstCell = await this.cellSafety(binding, input.signal);
    const firstStack = await this.stack(input.signal, allowCreatedLocked);
    const original = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.getTemplate, { StackName: stackId, TemplateStage: "Original" }, input.signal);
    const body = template(original.TemplateBody);
    if (firstStack.StackStatus === "CREATE_COMPLETE" && shape(body) !== "Locked") invalid("Only a Locked predecessor may be CREATE_COMPLETE.");
    const inventory = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.listStackResources, { StackName: stackId }, input.signal);
    unpaginated(inventory);
    const observedResources = array(inventory.StackResourceSummaries).map(record);
    if (observedResources.length !== 4 || new Set(observedResources.map((entry) => entry.LogicalResourceId)).size !== 4) invalid("Management inventory must have exactly four unique IAM resources.");
    const normalizedResources = resources.map(([logicalId, resourceType, name]) => {
      const found = observedResources.find((entry) => entry.LogicalResourceId === logicalId);
      const physicalResourceId = resourceType === "AWS::IAM::ManagedPolicy" ? policyArn(name) : name;
      if (!found || found.ResourceType !== resourceType || found.PhysicalResourceId !== physicalResourceId || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(String(found.ResourceStatus))) invalid("Management resource readback drifted.");
      return { logicalId, resourceType, physicalResourceId, resourceStatus: found.ResourceStatus as "CREATE_COMPLETE" | "UPDATE_COMPLETE" };
    });
    const policies = [await this.policy(body, 0, input.signal), await this.policy(body, 2, input.signal)];
    const roles = [await this.role(body, 1, input.signal), await this.role(body, 3, input.signal)];
    const lastCell = await this.cellSafety(binding, input.signal);
    same(lastCell ?? null, firstCell ?? null, "Cell safety while collecting management evidence");
    const lastStack = await this.stack(input.signal, allowCreatedLocked);
    same(lastStack, firstStack, "Management Stack while collecting IAM evidence");
    const observedAt = this.now();
    if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(observedAt) || observedAt < startedAt || observedAt - startedAt > maximumObservationMs) invalid("Management evidence exceeded its collection bound.");
    const safetyState = record(record(body.Outputs).SafetyState).Value;
    const outputs = array(lastStack.Outputs).map(record);
    if (outputs.filter((output) => output.OutputKey === "SafetyState").length !== 1 || outputs.find((output) => output.OutputKey === "SafetyState")?.OutputValue !== safetyState || typeof safetyState !== "string") invalid("Management SafetyState output drifted.");
    signal(input.signal);
    return immutable({ schemaVersion: 1, accountId, region, callerArn: sourceArn, rendererShape: shape(body), stack: { name: stackName, id: stackId, status: lastStack.StackStatus as "CREATE_COMPLETE" | "UPDATE_COMPLETE", roleArn: null, parentId: null, rootId: null, terminationProtection: false, templateRawSha256: await sha256Hex(String(original.TemplateBody)), templateCanonicalSha256: await sha256Hex(canonicalJson(body)), safetyState, resources: normalizedResources }, policies, roles, cellStackState: lastCell && lastCell.state !== "MISSING" ? "REVIEW_IN_PROGRESS" : "MISSING", ...(lastCell ? { cellSafety: lastCell } : {}), authorityState: "ABSENT", observedAt: new Date(observedAt).toISOString() });
  }
  async readManagementObservation(input: { signal: AbortSignal; cellSafety?: SharedCellAuthorCompensationCellSafetyBinding }): Promise<Readonly<SharedCellAuthorCompensationManagementObservation>> {
    const observed = await this.collectObservation(input);
    if (observed.stack.status !== "UPDATE_COMPLETE") invalid("Lifecycle receipts require an UPDATE_COMPLETE management Stack.");
    return immutable({ ...observed, stack: { ...observed.stack, status: "UPDATE_COMPLETE" as const } });
  }
  /** Initial Locked preflight only; this is NOT a lifecycle Grant/Locked receipt. */
  async readLockedPreflightObservation(input: { signal: AbortSignal }): Promise<Readonly<CollectedManagementObservation>> {
    exact(input, ["signal"]);
    const observed = await this.collectObservation(input, true);
    const { renderB5CellLifecycleManagementTemplate } = await import("../../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs");
    const expected = await renderB5CellLifecycleManagementTemplate({ shape: "Locked" });
    if (observed.rendererShape !== "Locked" || observed.cellStackState !== "MISSING" || observed.authorityState !== "ABSENT" ||
        observed.stack.templateRawSha256 !== await sha256Hex(expected) ||
        observed.stack.templateCanonicalSha256 !== await sha256Hex(canonicalJson(JSON.parse(expected)))) invalid("Preflight requires the exact deployed Locked template, Cell MISSING and authority ABSENT.");
    return observed;
  }
  /** No write capability is exposed by this preflight. */
  async inspectPreparedChangeSet(prepared: PreparedSharedCellAuthorCompensationManagementAction, abort: AbortSignal): Promise<void> {
    await assertPrepared(prepared);
    const observation = await this.collectObservation({ signal: abort,
      ...(prepared.contract.cellSafety ? { cellSafety: prepared.contract.cellSafety } : {}) }, true);
    if (observation.stack.templateRawSha256 !== prepared.predecessorTemplateRawSha256 || observation.stack.templateCanonicalSha256 !== prepared.predecessorTemplateCanonicalSha256 || observation.rendererShape !== prepared.predecessorRendererShape) invalid("Prepared Change Set predecessor drifted.");
    const observed = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.describeChangeSet, { StackName: stackId, ChangeSetName: prepared.changeSetArn, IncludePropertyValues: true }, abort);
    unpaginated(observed);
    if (observed.ChangeSetId !== prepared.changeSetArn || observed.ChangeSetName !== prepared.request.managementChangeSetName || observed.StackId !== stackId || observed.StackName !== stackName || observed.Status !== "CREATE_COMPLETE" || observed.ExecutionStatus !== "AVAILABLE" || observed.IncludeNestedStacks !== false || observed.ImportExistingResources !== false || !optionalEmpty(observed.ParentChangeSetId) || !optionalEmpty(observed.RootChangeSetId) || !optionalEmpty(observed.DeploymentMode)) invalid("Prepared management Change Set identity or status drifted.");
    same(array(observed.Capabilities), ["CAPABILITY_NAMED_IAM"], "Change Set IAM capabilities");
    const changes = array(observed.Changes);
    if (changes.length !== 1) invalid("Only the operator boundary may change.");
    const change = record(changes[0]);
    const resource = record(change.ResourceChange);
    if (change.Type !== "Resource" || resource.LogicalResourceId !== resources[0][0] || resource.ResourceType !== resources[0][1] || resource.PhysicalResourceId !== policyArn(resources[0][2]) || resource.Action !== "Modify" || resource.Replacement !== "False") invalid("Change Set contains an unapproved IAM mutation.");
    same(array(resource.Scope), ["Properties"], "Change Set scope");
    const original = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.getTemplate, { StackName: stackId, ChangeSetName: prepared.changeSetArn, TemplateStage: "Original" }, abort);
    const body = template(original.TemplateBody);
    if (await sha256Hex(String(original.TemplateBody)) !== prepared.request.targetTemplateRawSha256 || await sha256Hex(canonicalJson(body)) !== prepared.request.targetTemplateCanonicalSha256) invalid("Prepared Change Set Original template does not match both reviewed hashes.");
    // Re-check the exact binding after GetTemplate; an obsolete Change Set is never submitted.
    const final = await this.send(this.sdk.clients.cloudFormation, this.sdk.commands.describeChangeSet, { StackName: stackId, ChangeSetName: prepared.changeSetArn, IncludePropertyValues: true }, abort);
    const comparable = (response: Record<string, unknown>) => Object.fromEntries(Object.entries(response).filter(([key]) => key !== "$metadata"));
    same(comparable(final), comparable(observed), "Prepared Change Set during preflight");
    if (prepared.request.kind === "GRANT") {
      const currentTime = this.now();
      if (!Number.isSafeInteger(currentTime) || currentTime < Date.parse(prepared.contract.reviewedAt) || Date.parse(prepared.contract.expiresAt) - currentTime <= SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[prepared.request.phase]) invalid("The phase Grant execution window is closed.");
    }
    signal(abort);
  }
}

export interface PreparedSharedCellAuthorCompensationManagementAction {
  readonly schemaVersion: 1;
  readonly request: SharedCellAuthorCompensationLifecycleActionRequest;
  readonly contract: SharedCellAuthorCompensationLifecycleContract;
  readonly changeSetArn: string;
  readonly predecessorRendererShape: SharedCellAuthorCompensationLifecycleRendererShape;
  readonly predecessorTemplateRawSha256: string;
  readonly predecessorTemplateCanonicalSha256: string;
  readonly preparedActionSha256: string;
}
export async function compilePreparedSharedCellAuthorCompensationManagementAction(input: {
  request: SharedCellAuthorCompensationLifecycleActionRequest;
  contract: SharedCellAuthorCompensationLifecycleContract;
  changeSetArn: string;
  predecessorTemplateBody: string;
  targetTemplateBody: string;
}): Promise<Readonly<PreparedSharedCellAuthorCompensationManagementAction>> {
  exact(input, ["request", "contract", "changeSetArn", "predecessorTemplateBody", "targetTemplateBody"]);
  assertSharedCellAuthorCompensationLifecycleActionRequest(input.request);
  const contractBody = Object.fromEntries(Object.entries(input.contract).filter(([key]) => key !== "lifecycleContractSha256"));
  const contract = await compileSharedCellAuthorCompensationLifecycleContract(contractBody as SharedCellAuthorCompensationLifecycleContractInput);
  same(input.contract, contract, "Lifecycle contract");
  const request = input.request;
  const match = changeSetArnPattern.exec(input.changeSetArn);
  if (!match || match[1] !== request.managementChangeSetName || request.managementStackId !== stackId || request.managementStackName !== stackName || request.lifecycleContractSha256 !== contract.lifecycleContractSha256 || request.operationSha256 !== contract.operationSha256 || request.phase !== contract.phase || request.windowNumber !== contract.windowNumber || request.targetRendererShape !== contract.rendererShape || request.targetTemplateRawSha256 !== contract.templateRawSha256 || request.targetTemplateCanonicalSha256 !== contract.templateCanonicalSha256) invalid("Management action is not bound to its exact lifecycle contract and ARN.");
  if (request.kind === "GRANT" && (request.compensationPlanSha256 !== contract.compensationPlanSha256 || request.phasePlanSha256 !== contract.phasePlanSha256 || request.controllerContractSha256 !== contract.controllerContractSha256)) invalid("Grant plan digests drifted from the lifecycle contract.");
  const predecessor = template(input.predecessorTemplateBody);
  const target = template(input.targetTemplateBody);
  const predecessorRendererShape = shape(predecessor);
  const phaseShape = request.phase === "DELETE_CHANGE_SET" ? "AuthorCompensationDeleteChangeSetGrant" : "AuthorCompensationDeleteStackGrant";
  if (shape(target) !== contract.rendererShape || predecessorRendererShape !== (request.kind === "GRANT" ? "Locked" : phaseShape)) invalid("Only the reviewed Locked/split-grant transition is supported.");
  if (await sha256Hex(input.targetTemplateBody) !== request.targetTemplateRawSha256 || await sha256Hex(canonicalJson(target)) !== request.targetTemplateCanonicalSha256) invalid("Target template hashes drifted.");
  // Templates may alter only the operator policy document and descriptive metadata/outputs.
  const before = JSON.parse(canonicalJson(predecessor)) as Record<string, unknown>;
  const after = JSON.parse(canonicalJson(target)) as Record<string, unknown>;
  for (const body of [before, after]) {
    delete body.Description; delete body.Metadata;
    delete record(body.Outputs).SafetyState;
    delete properties(body, "CellOperatorBoundary").PolicyDocument;
  }
  same(after, before, "Management transition outside the operator policy");
  // Reproduce both templates with the existing renderer: approval hashes cannot
  // turn an arbitrary operator policy into a supported split grant.
  const { renderB5CellLifecycleManagementTemplate } = await import("../../../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs");
  for (const candidate of [predecessor, target]) {
    const rendererShape = shape(candidate);
    const metadata = record(record(candidate.Metadata).SafetyBoundary);
    const option = (key: string): string => {
      if (typeof metadata[key] !== "string") invalid(`Renderer metadata ${key} is missing.`);
      return metadata[key] as string;
    };
    const rendered = await renderB5CellLifecycleManagementTemplate(rendererShape === "Locked" ? {} : {
      shape: rendererShape,
      approvedChangeSetName: option("ApprovedChangeSetName"),
      approvedTemplateSha256: option("ApprovedTemplateSha256"),
      approvedTemplateCanonicalSha256: option("ApprovedTemplateCanonicalSha256"),
      approvedCellExpiresAt: option("ApprovedCellExpiresAt"),
      grantReviewedAt: option("GrantReviewedAt"),
      grantExpiresAt: option("GrantExpiresAt"),
      approvedStackId: option("ApprovedStackId"),
      approvedChangeSetArn: option("ApprovedChangeSetArn"),
      approvedCompensationPlanSha256: option("ApprovedCompensationPlanSha256"),
      compensationReviewedAt: option("CompensationReviewedAt"),
      compensationExpiresAt: option("CompensationExpiresAt"),
    });
    same(candidate, JSON.parse(rendered), "Deterministic management renderer output");
    if (rendererShape !== "Locked" && (metadata.ApprovedCompensationPlanSha256 !== contract.compensationPlanSha256 || metadata.CompensationReviewedAt !== contract.reviewedAt || metadata.CompensationExpiresAt !== contract.expiresAt)) invalid("Renderer grant window or plan binding drifted from the lifecycle contract.");
    if (rendererShape !== "Locked" && contract.cellSafety) {
      const candidate = contract.cellSafety.candidate;
      const expiresAt = candidate.changeSet.tags.find((tag) => tag.Key === "ExpiresAt")?.Value;
      if (metadata.ApprovedStackId !== candidate.stackId || metadata.ApprovedChangeSetArn !== candidate.changeSet.arn ||
          metadata.ApprovedChangeSetName !== candidate.changeSet.name || metadata.ApprovedTemplateSha256 !== candidate.immutableTemplate.rawSha256 ||
          metadata.ApprovedTemplateCanonicalSha256 !== candidate.immutableTemplate.canonicalSha256 || metadata.ApprovedCellExpiresAt !== expiresAt) invalid("Renderer exact Cell identities and immutable template are not bound to the compensation candidate.");
    }
  }
  for (const [observed, expected] of [
    [properties(target, resources[0][0]).PolicyDocument, contract.operatorBoundaryDocumentSha256],
    [properties(target, resources[2][0]).PolicyDocument, contract.executionBoundaryDocumentSha256],
    [resolveTrust(properties(target, resources[1][0]).AssumeRolePolicyDocument), contract.operatorTrustPolicySha256],
    [resolveTrust(properties(target, resources[3][0]).AssumeRolePolicyDocument), contract.executionTrustPolicySha256],
  ]) if (await sha256Hex(canonicalJson(observed)) !== expected) invalid("Target IAM document hash does not match the lifecycle contract.");
  const body = { schemaVersion: 1 as const, request, contract, changeSetArn: input.changeSetArn, predecessorRendererShape, predecessorTemplateRawSha256: await sha256Hex(input.predecessorTemplateBody), predecessorTemplateCanonicalSha256: await sha256Hex(canonicalJson(predecessor)) };
  return immutable({ ...body, preparedActionSha256: await sha256Hex(canonicalJson(body)) });
}
async function assertPrepared(prepared: PreparedSharedCellAuthorCompensationManagementAction): Promise<void> {
  exact(prepared, ["schemaVersion", "request", "contract", "changeSetArn", "predecessorRendererShape", "predecessorTemplateRawSha256", "predecessorTemplateCanonicalSha256", "preparedActionSha256"]);
  const { preparedActionSha256, ...body } = prepared;
  if (prepared.schemaVersion !== 1 || await sha256Hex(canonicalJson(body)) !== preparedActionSha256) invalid("Prepared management action digest drifted.");
}

interface MutationDependencies { client: Client; executeChangeSet: Command; }
class PreparedMutation {
  private submitted = false;
  private readonly prepared: PreparedSharedCellAuthorCompensationManagementAction;
  private readonly approvedSha256: string;
  private readonly reads: AwsSdkSharedCellAuthorCompensationManagementReadAdapter;
  private readonly sdk: MutationDependencies;
  constructor(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedSha256: string, reads: AwsSdkSharedCellAuthorCompensationManagementReadAdapter, sdk: MutationDependencies) {
    if (!(reads instanceof AwsSdkSharedCellAuthorCompensationManagementReadAdapter) || typeof sdk?.client?.send !== "function" || typeof sdk.executeChangeSet !== "function") invalid("Management mutation dependencies are incomplete.");
    this.prepared = immutable(prepared);
    this.approvedSha256 = approvedSha256;
    this.reads = reads;
    this.sdk = sdk;
  }
  async execute(request: SharedCellAuthorCompensationLifecycleActionRequest, abort: AbortSignal): Promise<void> {
    await assertPrepared(this.prepared);
    if (this.approvedSha256 !== this.prepared.preparedActionSha256) invalid("Prepared management execution digest was not approved.");
    same(request, this.prepared.request, "Durable lifecycle mutation request");
    if (this.submitted) invalid("This management mutation capability has already been consumed.");
    // Consume before any awaited preflight so concurrent calls cannot both submit.
    this.submitted = true;
    await this.reads.inspectPreparedChangeSet(this.prepared, abort);
    signal(abort);
    try {
      await this.sdk.client.send(new this.sdk.executeChangeSet({ StackName: stackId, ChangeSetName: this.prepared.changeSetArn, ClientRequestToken: `j5gj4-${await sharedCellAuthorCompensationLifecycleActionRequestSha256(request)}`, DisableRollback: false }), { abortSignal: abort });
      signal(abort);
    } catch {
      throw new SharedCellAuthorCompensationManagementAdapterError("SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_SUBMIT_UNCERTAIN", "Management execution may have been accepted; use read-only recovery and never replay it.", true);
    }
  }
}
export function createPreparedSharedCellAuthorCompensationManagementMutation(input: {
  prepared: PreparedSharedCellAuthorCompensationManagementAction;
  approvedPreparedActionSha256: string;
  reads: AwsSdkSharedCellAuthorCompensationManagementReadAdapter;
  sdk: MutationDependencies;
}): SharedCellAuthorCompensationPhaseGrantMutationPort | SharedCellAuthorCompensationPhaseRevokeMutationPort {
  exact(input, ["prepared", "approvedPreparedActionSha256", "reads", "sdk"]);
  const mutation = new PreparedMutation(input.prepared, input.approvedPreparedActionSha256, input.reads, input.sdk);
  return input.prepared.request.kind === "GRANT"
    ? Object.freeze({ installPhaseGrant: ({ request, signal: abort }) => mutation.execute(request, abort) } as SharedCellAuthorCompensationPhaseGrantMutationPort)
    : Object.freeze({ revokePhaseGrant: ({ request, signal: abort }) => mutation.execute(request, abort) } as SharedCellAuthorCompensationPhaseRevokeMutationPort);
}

export interface SharedCellAuthorCompensationManagementRuntimeModules {
  sts: Record<string, unknown>;
  cloudFormation: Record<string, unknown>;
  iam: Record<string, unknown>;
  dynamoDb: Record<string, unknown>;
  login: Record<string, unknown>;
  config: Record<string, unknown>;
}
type Constructor = new (config: Record<string, unknown>) => Client;
function exported<T>(module: Record<string, unknown>, name: string): T {
  if (typeof module?.[name] !== "function") invalid(`Installed SDK export ${name} is unavailable.`);
  return module[name] as T;
}
/** Shared Source login guard; construction is I/O-free, with no fallback provider. */
export function createSharedCellAuthorCompensationSourceCredentialProvider(modules: Pick<SharedCellAuthorCompensationManagementRuntimeModules, "login" | "config">) {
  const loginFactory = exported<(options: Record<string, unknown>) => () => Promise<unknown>>(modules.login, "fromLoginCredentials");
  const loadConfig = exported<(options: Record<string, unknown>) => Promise<{ configFile: Record<string, Record<string, unknown>>; credentialsFile: Record<string, Record<string, unknown>> }>>(modules.config, "loadSharedConfigFiles");
  const login = loginFactory({ profile: SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_PROFILE, ignoreCache: true, clientConfig: { region, ignoreConfiguredEndpointUrls: true } });
  const credentials = async () => {
    try {
      for (const [key, value] of Object.entries(process.env)) {
        if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) invalid("Source login refuses ambient credential or endpoint overrides.");
      }
      const files = await loadConfig({ ignoreCache: true });
      const profile = files.configFile[SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_PROFILE];
      if (!profile || profile.login_session !== sourceArn || profile.region !== region) invalid("Source profile must declare the exact login_session and region.");
      if (Object.keys(files.credentialsFile[SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_PROFILE] ?? {}).length) invalid("Source login profile must not be overridden by the shared credentials file.");
      for (const entry of [profile, files.credentialsFile[SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_PROFILE] ?? {}, files.configFile.default ?? {}]) {
        if (["aws_access_key_id", "aws_secret_access_key", "aws_session_token", "role_arn", "source_profile", "credential_source", "credential_process", "sso_session", "endpoint_url", "services"].some((key) => entry[key] !== undefined)) invalid("Source login profile contains an unreviewed credential or endpoint source.");
      }
      const value = record(await login());
      if (typeof value.sessionToken !== "string" || !value.sessionToken || !(value.expiration instanceof Date) || value.expiration.getTime() <= Date.now()) invalid("Source login credentials are not a live temporary session.");
      return value;
    } catch {
      throw new SharedCellAuthorCompensationManagementAdapterError("SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_LOGIN_INVALID", "The exact Source login session is unavailable or invalid; refresh it before an approved online operation.");
    }
  };
  return credentials;
}
/** Construction is I/O-free; login/config are inspected only when AWS asks for credentials. */
export function createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules(modules: SharedCellAuthorCompensationManagementRuntimeModules) {
  const credentials = createSharedCellAuthorCompensationSourceCredentialProvider(modules);
  const config = { region, credentials, ignoreConfiguredEndpointUrls: true };
  const client = (module: Record<string, unknown>, name: string, mutation = false) => new (exported<Constructor>(module, name))({ ...config, ...(mutation ? { maxAttempts: 1 } : {}) });
  const clients = { sts: client(modules.sts, "STSClient"), cloudFormation: client(modules.cloudFormation, "CloudFormationClient"), iam: client(modules.iam, "IAMClient"), dynamoDb: client(modules.dynamoDb, "DynamoDBClient") };
  const commandModules = { getCallerIdentity: [modules.sts, "GetCallerIdentityCommand"], describeStacks: [modules.cloudFormation, "DescribeStacksCommand"], getTemplate: [modules.cloudFormation, "GetTemplateCommand"], listStackResources: [modules.cloudFormation, "ListStackResourcesCommand"], describeChangeSet: [modules.cloudFormation, "DescribeChangeSetCommand"], getPolicy: [modules.iam, "GetPolicyCommand"], getPolicyVersion: [modules.iam, "GetPolicyVersionCommand"], listPolicyVersions: [modules.iam, "ListPolicyVersionsCommand"], listEntitiesForPolicy: [modules.iam, "ListEntitiesForPolicyCommand"], getRole: [modules.iam, "GetRoleCommand"], listAttachedRolePolicies: [modules.iam, "ListAttachedRolePoliciesCommand"], listRolePolicies: [modules.iam, "ListRolePoliciesCommand"], getItem: [modules.dynamoDb, "GetItemCommand"] } as const;
  const commands = Object.fromEntries(Object.entries(commandModules).map(([key, [module, name]]) => [key, exported<Command>(module, name)])) as SharedCellAuthorCompensationManagementReadDependencies["commands"];
  const reads = new AwsSdkSharedCellAuthorCompensationManagementReadAdapter({ clients, commands });
  const sdk = { client: client(modules.cloudFormation, "CloudFormationClient", true), executeChangeSet: exported<Command>(modules.cloudFormation, "ExecuteChangeSetCommand") };
  return Object.freeze({ reads, createMutation(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedPreparedActionSha256: string) { return createPreparedSharedCellAuthorCompensationManagementMutation({ prepared, approvedPreparedActionSha256, reads, sdk }); } });
}
export async function createAwsSdkSharedCellAuthorCompensationManagementRuntime() {
  const names = ["@aws-sdk/client-sts", "@aws-sdk/client-cloudformation", "@aws-sdk/client-iam", "@aws-sdk/client-dynamodb", "@aws-sdk/credential-provider-login", "@smithy/core/config"];
  const [sts, cloudFormation, iam, dynamoDb, login, config] = await Promise.all(names.map((name) => import(name))) as Record<string, unknown>[];
  return createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules({ sts, cloudFormation, iam, dynamoDb, login, config });
}
