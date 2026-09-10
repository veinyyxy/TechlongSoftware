import type { AwsSandboxSharedCellStackInput } from "../cloudformation/shared-cell-stack.ts";
import { renderAwsSandboxSharedCellStack } from "../cloudformation/shared-cell-stack.ts";
import type { DeploymentEnvironment } from "../environment.ts";
import type { DeploymentExecutionBinding } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const tenantCloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole";
const cellCloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const maximumEvidenceAgeMs = 5 * 60_000;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;
const callerArnPattern =
  /^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/[A-Za-z0-9+=,.@_-]{2,64}$/;
const databaseEndpointPattern =
  /^techlong-sandbox-cell-sandbox-1\.cluster-[a-z0-9-]{6,63}\.ca-central-1\.rds\.amazonaws\.com$/;
const databaseSecretArnPattern =
  /^arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-[A-Za-z0-9/_+=.@!-]{7,512}$/;
const digestPattern = /^[a-f0-9]{64}$/;

const verifiedProvisionEvidence = new WeakSet<object>();

interface AwsReadOnlySdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsReadOnlyCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkSharedCellProvisionEvidenceDependencies {
  clients: {
    sts: AwsReadOnlySdkClient;
    cloudFormation: AwsReadOnlySdkClient;
  };
  commands: {
    getCallerIdentity: AwsReadOnlyCommandConstructor;
    describeStacks: AwsReadOnlyCommandConstructor;
    getTemplate: AwsReadOnlyCommandConstructor;
    listStackResources: AwsReadOnlyCommandConstructor;
  };
  now?: () => number;
}

export interface ReadSharedCellProvisionEvidenceInput {
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  stackInput: AwsSandboxSharedCellStackInput;
  signal: AbortSignal;
}

/**
 * Immutable proof that the exact reviewed Shared Cell template and its complete
 * CloudFormation inventory were read from the fixed Sandbox Stack. Structural
 * lookalikes are rejected by assertVerifiedSharedCellProvisionEvidence().
 */
export interface VerifiedSharedCellProvisionEvidence {
  readonly schemaVersion: 2;
  readonly verified: true;
  readonly observedAt: number;
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly stackName: typeof stackName;
  readonly stackId: string;
  readonly stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  readonly cellExpiresAt: string;
  readonly cloudFormationRoleArn: typeof cellCloudFormationRoleArn;
  readonly templateCanonicalSha256: string;
  readonly resourceInventorySha256: string;
}

export class SharedCellProvisionEvidenceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellProvisionEvidenceError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function clockValue(clock: () => number, label: string): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_PROVISION_EVIDENCE_CLOCK_INVALID",
      `${label} could not be read.`,
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_CLOCK_INVALID",
      `${label} is not a positive safe integer.`,
    );
  }
  return value;
}

function canonicalUtc(value: unknown, label: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      `${label} is not a real canonical UTC instant.`,
    );
  }
  return parsed;
}

function instant(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      `${label} is missing or invalid.`,
    );
  }
  return date.toISOString();
}

function uniqueStringMap(
  value: unknown,
  keyName: string,
  valueName: string,
  label: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const items = records(value);
  if (items.length !== (Array.isArray(value) ? value.length : -1)) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      `${label} are malformed.`,
    );
  }
  for (const item of items) {
    const key = text(item[keyName]);
    const itemValue = text(item[valueName]);
    if (!key || itemValue === null || Object.hasOwn(result, key)) {
      fail(
        "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
        `${label} are missing, duplicated or malformed.`,
      );
    }
    result[key] = itemValue;
  }
  return result;
}

interface StableStackSnapshot {
  stackId: string;
  stackName: string;
  stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  roleArn: typeof cellCloudFormationRoleArn;
  terminationProtection: false;
  creationTime: string;
  lastUpdatedTime: string | null;
  tags: Record<string, string>;
  parameters: Record<string, string>;
  outputs: Record<string, string>;
}

function oneStack(response: Record<string, unknown>): Record<string, unknown> {
  const stacks = records(response.Stacks);
  if (stacks.length !== 1) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      `Expected exactly one Shared Cell Stack; observed ${stacks.length}.`,
    );
  }
  return stacks[0];
}

function normalizeStack(value: Record<string, unknown>): StableStackSnapshot {
  const stackId = text(value.StackId) ?? "";
  const observedStackName = text(value.StackName) ?? "";
  const status = text(value.StackStatus);
  const roleArn = text(value.RoleARN) ?? "";
  if (
    observedStackName !== stackName ||
    !stackIdPattern.test(stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(status ?? "") ||
    text(value.ParentId) !== null ||
    text(value.RootId) !== null ||
    roleArn !== cellCloudFormationRoleArn ||
    value.EnableTerminationProtection !== false
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_INVALID",
      "The Shared Cell is not the exact completed root Stack with the reviewed execution role.",
    );
  }
  return {
    stackId,
    stackName: observedStackName,
    stackStatus: status as StableStackSnapshot["stackStatus"],
    roleArn: cellCloudFormationRoleArn,
    terminationProtection: false,
    creationTime: instant(value.CreationTime, "Stack CreationTime"),
    lastUpdatedTime:
      value.LastUpdatedTime === undefined || value.LastUpdatedTime === null
        ? null
        : instant(value.LastUpdatedTime, "Stack LastUpdatedTime"),
    tags: uniqueStringMap(value.Tags, "Key", "Value", "Stack tags"),
    parameters: uniqueStringMap(
      value.Parameters,
      "ParameterKey",
      "ParameterValue",
      "Stack parameters",
    ),
    outputs: uniqueStringMap(
      value.Outputs,
      "OutputKey",
      "OutputValue",
      "Stack outputs",
    ),
  };
}

function assertBinding(input: ReadSharedCellProvisionEvidenceInput): void {
  const bindingKeys = [
    "ClusterName",
    "ControlListenerArn",
    "HttpsListenerArn",
    "OneShotTaskSecurityGroupId",
    "SubnetIds",
    "TaskSecurityGroupId",
    "VpcId",
  ];
  if (
    input.environment.expectedAccountId !== accountId ||
    input.environment.region !== region ||
    input.environment.cellKey !== cellId ||
    input.binding.environmentId !== input.environment.id ||
    input.binding.status !== "active" ||
    input.binding.workerRoleArn !==
      "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    input.binding.cloudFormationRoleArn !== tenantCloudFormationRoleArn ||
    !exactKeys(input.binding.tenantStackParameters, bindingKeys)
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_BINDING_INVALID",
      "The Shared Cell environment or execution binding is outside the reviewed Sandbox target.",
    );
  }
}

function assertStackContract(
  snapshot: StableStackSnapshot,
  plan: ReturnType<typeof renderAwsSandboxSharedCellStack>,
  binding: DeploymentExecutionBinding,
): void {
  const expectedOutputs = {
    ClusterName: cellId,
    VpcId: binding.tenantStackParameters.VpcId,
    SubnetIds: binding.tenantStackParameters.SubnetIds,
    TaskSecurityGroupId: binding.tenantStackParameters.TaskSecurityGroupId,
    OneShotTaskSecurityGroupId:
      binding.tenantStackParameters.OneShotTaskSecurityGroupId,
    HttpsListenerArn: binding.tenantStackParameters.HttpsListenerArn,
    ControlListenerArn: binding.tenantStackParameters.ControlListenerArn,
    DatabaseClusterIdentifier: stackName,
    DatabaseEndpoint: snapshot.outputs.DatabaseEndpoint,
    DatabaseMasterSecretArn: snapshot.outputs.DatabaseMasterSecretArn,
    CellExpiresAt: plan.tags.ExpiresAt,
  };
  if (
    canonicalJson(snapshot.tags) !== canonicalJson(plan.tags) ||
    canonicalJson(snapshot.parameters) !== canonicalJson(plan.parameters) ||
    !exactKeys(snapshot.outputs, Object.keys(expectedOutputs)) ||
    canonicalJson(snapshot.outputs) !== canonicalJson(expectedOutputs) ||
    snapshot.outputs.ClusterName !==
      binding.tenantStackParameters.ClusterName ||
    !databaseEndpointPattern.test(snapshot.outputs.DatabaseEndpoint ?? "") ||
    !databaseSecretArnPattern.test(
      snapshot.outputs.DatabaseMasterSecretArn ?? "",
    )
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_STACK_DRIFT",
      "Shared Cell tags, parameters or outputs differ from the reviewed plan and binding.",
    );
  }
}

interface InventoryEntry {
  logicalResourceId: string;
  physicalResourceId: string;
  resourceStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  resourceType: string;
}

function projectInventory(
  summaries: Record<string, unknown>[],
  expectedResources: Record<string, unknown>,
): InventoryEntry[] {
  if (summaries.length === 0) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
      "Shared Cell resource inventory is empty.",
    );
  }
  const seen = new Set<string>();
  const projected = summaries.map((summary) => {
    const logicalResourceId = text(summary.LogicalResourceId) ?? "";
    const physicalResourceId = text(summary.PhysicalResourceId) ?? "";
    const resourceStatus = text(summary.ResourceStatus);
    const resourceType = text(summary.ResourceType) ?? "";
    const expectedType = text(record(expectedResources[logicalResourceId]).Type);
    if (
      !logicalResourceId ||
      !physicalResourceId ||
      !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(
        resourceStatus ?? "",
      ) ||
      !resourceType ||
      expectedType !== resourceType ||
      seen.has(logicalResourceId)
    ) {
      fail(
        "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
        "Shared Cell resource inventory contains a missing, duplicate, drifting or non-terminal resource.",
      );
    }
    seen.add(logicalResourceId);
    return {
      logicalResourceId,
      physicalResourceId,
      resourceStatus: resourceStatus as InventoryEntry["resourceStatus"],
      resourceType,
    };
  });
  if (
    canonicalJson([...seen].sort()) !==
    canonicalJson(Object.keys(expectedResources).sort())
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
      "Shared Cell inventory does not exactly cover the reviewed template resources.",
    );
  }
  return projected.sort((left, right) =>
    left.logicalResourceId.localeCompare(right.logicalResourceId),
  );
}

function normalizeProviderError(error: unknown): SharedCellProvisionEvidenceError {
  if (error instanceof SharedCellProvisionEvidenceError) return error;
  const value = record(error);
  const metadata = record(value.$metadata);
  const status =
    typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : 0;
  const name = text(value.name) ?? "SHARED_CELL_PROVISION_EVIDENCE_READ_FAILED";
  return new SharedCellProvisionEvidenceError(
    name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    "A Shared Cell provision evidence read failed.",
    status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  );
}

export function assertVerifiedSharedCellProvisionEvidence(
  value: unknown,
): asserts value is VerifiedSharedCellProvisionEvidence {
  if (
    !value ||
    typeof value !== "object" ||
    !verifiedProvisionEvidence.has(value)
  ) {
    fail(
      "SHARED_CELL_PROVISION_EVIDENCE_UNVERIFIED",
      "Provision evidence was not produced by a complete live Shared Cell Stack readback.",
    );
  }
}

export class AwsSdkSharedCellProvisionEvidenceAdapter {
  readonly region: string;
  private readonly sdk: AwsSdkSharedCellProvisionEvidenceDependencies;
  private readonly now: () => number;

  constructor(
    region: string,
    dependencies: AwsSdkSharedCellProvisionEvidenceDependencies,
  ) {
    if (region !== "ca-central-1") {
      fail(
        "SHARED_CELL_PROVISION_EVIDENCE_REGION_INVALID",
        "The provision evidence adapter must use ca-central-1.",
      );
    }
    this.region = region;
    this.sdk = dependencies;
    this.now = dependencies.now ?? (() => Date.now());
  }

  async readVerifiedProvisionEvidence(
    input: ReadSharedCellProvisionEvidenceInput,
  ): Promise<VerifiedSharedCellProvisionEvidence> {
    try {
      requireNotAborted(input.signal);
      assertBinding(input);
      if (
        canonicalJson(input.stackInput.environment) !==
        canonicalJson(input.environment)
      ) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_PLAN_INVALID",
          "The Shared Cell renderer environment differs from the evidence target.",
        );
      }
      const startedAt = clockValue(this.now, "Evidence start clock");
      const plan = renderAwsSandboxSharedCellStack(input.stackInput);
      const expectedTemplateHash = await sha256Hex(plan.template);
      requireNotAborted(input.signal);

      const identity = await this.sdk.clients.sts.send(
        new this.sdk.commands.getCallerIdentity({}),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      if (
        text(identity.Account) !== accountId ||
        !callerArnPattern.test(text(identity.Arn) ?? "")
      ) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_CALLER_INVALID",
          "STS caller identity is outside the reviewed Sandbox provisioner role.",
        );
      }

      const firstResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({ StackName: stackName }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      const first = normalizeStack(oneStack(firstResponse));
      assertStackContract(first, plan, input.binding);

      const templateResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.getTemplate({
          StackName: first.stackId,
          TemplateStage: "Original",
        }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      let liveTemplate: unknown = templateResponse.TemplateBody;
      if (typeof liveTemplate === "string") {
        try {
          liveTemplate = JSON.parse(liveTemplate);
        } catch {
          fail(
            "SHARED_CELL_PROVISION_EVIDENCE_TEMPLATE_INVALID",
            "The original Shared Cell template is not canonical JSON input.",
          );
        }
      }
      if (!liveTemplate || typeof liveTemplate !== "object" || Array.isArray(liveTemplate)) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_TEMPLATE_INVALID",
          "The original Shared Cell template is missing or malformed.",
        );
      }
      const liveTemplateHash = await sha256Hex(liveTemplate);
      requireNotAborted(input.signal);
      if (liveTemplateHash !== expectedTemplateHash) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_TEMPLATE_MISMATCH",
          "The live original template differs from the locally rendered reviewed template.",
        );
      }

      const summaries: Record<string, unknown>[] = [];
      const seenTokens = new Set<string>();
      let nextToken: string | undefined;
      do {
        const request: Record<string, unknown> = { StackName: first.stackId };
        if (nextToken !== undefined) request.NextToken = nextToken;
        const page = await this.sdk.clients.cloudFormation.send(
          new this.sdk.commands.listStackResources(request),
          { abortSignal: input.signal },
        );
        requireNotAborted(input.signal);
        const pageSummaries = records(page.StackResourceSummaries);
        if (
          !Array.isArray(page.StackResourceSummaries) ||
          pageSummaries.length !== page.StackResourceSummaries.length
        ) {
          fail(
            "SHARED_CELL_PROVISION_EVIDENCE_INVENTORY_INVALID",
            "A Shared Cell inventory page is malformed.",
          );
        }
        summaries.push(...pageSummaries);
        const rawNextToken = page.NextToken;
        if (rawNextToken === undefined) {
          nextToken = undefined;
        } else {
          const token = text(rawNextToken);
          if (!token || seenTokens.has(token) || seenTokens.size >= 99) {
            fail(
              "SHARED_CELL_PROVISION_EVIDENCE_PAGINATION_INVALID",
              "Shared Cell resource pagination is empty, repeated or excessive.",
            );
          }
          seenTokens.add(token);
          nextToken = token;
        }
      } while (nextToken !== undefined);

      const resources = record(plan.template.Resources);
      const inventory = projectInventory(summaries, resources);
      const inventoryHash = await sha256Hex(inventory);
      requireNotAborted(input.signal);

      const finalResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({ StackName: first.stackId }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      const final = normalizeStack(oneStack(finalResponse));
      assertStackContract(final, plan, input.binding);
      if (canonicalJson(first) !== canonicalJson(final)) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_STACK_CHANGED",
          "The Shared Cell Stack changed while provision evidence was collected.",
          true,
        );
      }

      const observedAt = clockValue(this.now, "Evidence completion clock");
      if (
        observedAt < startedAt ||
        observedAt - startedAt > maximumEvidenceAgeMs
      ) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_STALE",
          "Shared Cell provision evidence took too long or the clock regressed.",
        );
      }
      if (canonicalUtc(plan.tags.ExpiresAt, "Cell ExpiresAt") <= observedAt) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_CELL_EXPIRED",
          "An expired Shared Cell cannot become a provision predecessor.",
        );
      }
      if (!digestPattern.test(expectedTemplateHash) || !digestPattern.test(inventoryHash)) {
        fail(
          "SHARED_CELL_PROVISION_EVIDENCE_HASH_INVALID",
          "Shared Cell provision evidence hashes are invalid.",
        );
      }
      const evidence: VerifiedSharedCellProvisionEvidence = Object.freeze({
        schemaVersion: 2 as const,
        verified: true as const,
        observedAt,
        accountId,
        region,
        cellId,
        stackName,
        stackId: final.stackId,
        stackStatus: final.stackStatus,
        cellExpiresAt: plan.tags.ExpiresAt,
        cloudFormationRoleArn: final.roleArn,
        templateCanonicalSha256: expectedTemplateHash,
        resourceInventorySha256: inventoryHash,
      });
      verifiedProvisionEvidence.add(evidence);
      return evidence;
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : Object.assign(new Error("Shared Cell provision evidence read was aborted."), {
              name: "AbortError",
              code: "ABORT_ERR",
            });
      }
      throw normalizeProviderError(error);
    }
  }
}
