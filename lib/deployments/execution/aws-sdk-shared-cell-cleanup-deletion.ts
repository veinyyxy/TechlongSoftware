import {
  SHARED_CELL_CLEANUP_DELETION_REGION,
  SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
  SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
  type SharedCellCleanupDeleteStackPort,
  type SharedCellCleanupDeletionEvidenceReadPort,
} from "./shared-cell-cleanup-deletion.ts";

const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const stableDeleteTokenPattern = /^cell-delete-[a-f0-9]{64}$/;
const cloudFormationTokenPattern = /^[A-Za-z0-9][-A-Za-z0-9]{0,127}$/;

/**
 * ListStacks retains DELETE_COMPLETE history for 90 days when it is not
 * filtered. Keep the complete current SDK status set here, except that one
 * historical state, so the core receives only live Stack names.
 */
export const SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES = Object.freeze([
  "CREATE_COMPLETE",
  "CREATE_FAILED",
  "CREATE_IN_PROGRESS",
  "DELETE_FAILED",
  "DELETE_IN_PROGRESS",
  "IMPORT_COMPLETE",
  "IMPORT_IN_PROGRESS",
  "IMPORT_ROLLBACK_COMPLETE",
  "IMPORT_ROLLBACK_FAILED",
  "IMPORT_ROLLBACK_IN_PROGRESS",
  "REVIEW_IN_PROGRESS",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "ROLLBACK_IN_PROGRESS",
  "UPDATE_COMPLETE",
  "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_FAILED",
  "UPDATE_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_ROLLBACK_FAILED",
  "UPDATE_ROLLBACK_IN_PROGRESS",
] as const);

const activeStackStatuses = new Set<string>(
  SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES,
);

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;
type AwsCredentialProvider = () => Promise<Record<string, unknown>>;

export type SharedCellCleanupZeroTenantOwnershipReadPort = Pick<
  SharedCellCleanupDeletionEvidenceReadPort,
  "readStrongZeroTenantOwnershipSnapshot"
>;

export interface AwsSdkSharedCellCleanupEvidenceDependencies {
  clients: {
    sts: AwsSdkClient;
    cloudFormation: AwsSdkClient;
  };
  commands: {
    getCallerIdentity: AwsSdkCommandConstructor;
    listStacks: AwsSdkCommandConstructor;
    describeStacks: AwsSdkCommandConstructor;
    getTemplate: AwsSdkCommandConstructor;
    listStackResources: AwsSdkCommandConstructor;
  };
  zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort;
}

export interface AwsSdkSharedCellCleanupDeleteDependencies {
  client: AwsSdkClient;
  deleteStack: AwsSdkCommandConstructor;
}

export class AwsSdkSharedCellCleanupAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new AwsSdkSharedCellCleanupAdapterError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireSignal(value: unknown): asserts value is AbortSignal {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as AbortSignal).throwIfAborted !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
      "An AbortSignal is required for every Shared Cell cleanup provider call.",
    );
  }
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("Shared Cell cleanup provider call was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
}

function providerError(
  error: unknown,
  fallbackCode: string,
): AwsSdkSharedCellCleanupAdapterError {
  if (error instanceof AwsSdkSharedCellCleanupAdapterError) return error;
  const value = record(error);
  const metadata = record(value.$metadata);
  const status =
    typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : 0;
  const name = text(value.name) ?? fallbackCode;
  const code = name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  return new AwsSdkSharedCellCleanupAdapterError(
    code || fallbackCode,
    "An AWS Shared Cell cleanup provider request failed.",
    Boolean(value.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  );
}

function nextToken(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    fail(
      "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
      `${label} returned an invalid pagination token.`,
    );
  }
  return value;
}

function requestToken(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    fail(
      "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
      "The Shared Cell cleanup pagination token is invalid.",
    );
  }
  return value;
}

function exactStackId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !stackIdPattern.test(value)) {
    fail(
      "SHARED_CELL_CLEANUP_SDK_STACK_ID_INVALID",
      "The Shared Cell cleanup adapter accepts only the exact reviewed StackId.",
    );
  }
}

function uniqueTags(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return fail(
      "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
      "DescribeStacks returned malformed tags.",
    );
  }
  const result: Record<string, string> = {};
  for (const raw of value) {
    const item = record(raw);
    const key = text(item.Key);
    const itemValue = text(item.Value);
    if (!key || itemValue === null || Object.hasOwn(result, key)) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
        "DescribeStacks returned missing, duplicate or malformed tags.",
      );
    }
    result[key] = itemValue;
  }
  return result;
}

function optionalStackParent(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = text(value);
  if (!result) {
    fail(
      "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
      "DescribeStacks returned a malformed root-Stack relation.",
    );
  }
  return result;
}

function isExactNameBoundMissing(error: unknown, requested: string): boolean {
  if (requested !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME) return false;
  const value = record(error);
  const message = error instanceof Error ? error.message.trim() : "";
  return (
    value.name === "ValidationError" &&
    message === `Stack with id ${SHARED_CELL_CLEANUP_DELETION_STACK_NAME} does not exist`
  );
}

/**
 * Read-only CloudFormation/STS adapter. The zero-tenant ownership source is a
 * separate injected strong-read capability and cannot expose a write here.
 */
export class AwsSdkSharedCellCleanupEvidenceAdapter
  implements SharedCellCleanupDeletionEvidenceReadPort
{
  readonly region: typeof SHARED_CELL_CLEANUP_DELETION_REGION;
  private readonly sdk: AwsSdkSharedCellCleanupEvidenceDependencies;

  constructor(
    region: string,
    dependencies: AwsSdkSharedCellCleanupEvidenceDependencies,
  ) {
    if (region !== SHARED_CELL_CLEANUP_DELETION_REGION) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_REGION_INVALID",
        "The Shared Cell cleanup adapter is fixed to ca-central-1.",
      );
    }
    if (
      !dependencies ||
      typeof dependencies !== "object" ||
      typeof dependencies.clients?.sts?.send !== "function" ||
      typeof dependencies.clients?.cloudFormation?.send !== "function" ||
      typeof dependencies.commands?.getCallerIdentity !== "function" ||
      typeof dependencies.commands?.listStacks !== "function" ||
      typeof dependencies.commands?.describeStacks !== "function" ||
      typeof dependencies.commands?.getTemplate !== "function" ||
      typeof dependencies.commands?.listStackResources !== "function" ||
      typeof dependencies.zeroTenantOwnership
        ?.readStrongZeroTenantOwnershipSnapshot !== "function"
    ) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_DEPENDENCY_INVALID",
        "The Shared Cell cleanup evidence dependencies are incomplete.",
      );
    }
    const readStrongZeroTenantOwnershipSnapshot =
      dependencies.zeroTenantOwnership.readStrongZeroTenantOwnershipSnapshot;
    this.region = SHARED_CELL_CLEANUP_DELETION_REGION;
    this.sdk = {
      clients: dependencies.clients,
      commands: dependencies.commands,
      zeroTenantOwnership: Object.freeze({
        readStrongZeroTenantOwnershipSnapshot: ({ signal }) =>
          readStrongZeroTenantOwnershipSnapshot.call(
            dependencies.zeroTenantOwnership,
            { signal },
          ),
      }),
    };
  }

  async getCallerIdentity(input: {
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The STS cleanup evidence request is malformed.",
      );
    }
    requireSignal(input.signal);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.sts.send(
        new this.sdk.commands.getCallerIdentity({}),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      const accountId = text(response.Account);
      const arn = text(response.Arn);
      if (!accountId || !/^\d{12}$/.test(accountId) || !arn) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "STS returned an incomplete cleanup caller identity.",
        );
      }
      return Object.freeze({ accountId, arn });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "STS_GET_CALLER_IDENTITY_FAILED");
    }
  }

  async listStackNamesPage(input: {
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["nextToken", "signal"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The CloudFormation Stack-list request is malformed.",
      );
    }
    requireSignal(input.signal);
    const token = requestToken(input.nextToken);
    const request: Record<string, unknown> = {
      StackStatusFilter: [...SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES],
    };
    if (token !== null) request.NextToken = token;
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.listStacks(request),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      if (!Array.isArray(response.StackSummaries)) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "ListStacks returned a malformed Stack page.",
        );
      }
      const stackNames = response.StackSummaries.map((raw) => {
        const item = record(raw);
        const name = text(item.StackName);
        const status = text(item.StackStatus);
        if (!name || !status || !activeStackStatuses.has(status)) {
          fail(
            "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
            "ListStacks returned an unnamed, historical or unknown-state Stack.",
          );
        }
        return name;
      });
      return Object.freeze({
        stackNames: Object.freeze(stackNames),
        nextToken: nextToken(response.NextToken, "ListStacks"),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_LIST_STACKS_FAILED");
    }
  }

  async describeCellStack(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal", "stackNameOrId"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The DescribeStacks cleanup request is malformed.",
      );
    }
    requireSignal(input.signal);
    if (input.stackNameOrId !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME) {
      exactStackId(input.stackNameOrId);
    }
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({
          StackName: input.stackNameOrId,
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      if (
        !Array.isArray(response.Stacks) ||
        response.Stacks.length !== 1
      ) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "DescribeStacks did not return exactly one Shared Cell Stack.",
        );
      }
      const stack = record(response.Stacks[0]);
      const stackName = text(stack.StackName);
      const stackId = text(stack.StackId);
      const stackStatus = text(stack.StackStatus);
      const roleArn = text(stack.RoleARN);
      if (!stackName || !stackId || !stackStatus || !roleArn) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "DescribeStacks returned an incomplete Shared Cell identity.",
        );
      }
      if (
        (input.stackNameOrId === SHARED_CELL_CLEANUP_DELETION_STACK_NAME &&
          stackName !== input.stackNameOrId) ||
        (input.stackNameOrId !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME &&
          stackId !== input.stackNameOrId)
      ) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "DescribeStacks returned a different Stack than the exact request.",
        );
      }
      return Object.freeze({
        state: "present" as const,
        stack: Object.freeze({
          stackName,
          stackId,
          stackStatus,
          roleArn,
          terminationProtection: stack.EnableTerminationProtection,
          parentId: optionalStackParent(stack.ParentId),
          rootId: optionalStackParent(stack.RootId),
          tags: Object.freeze(uniqueTags(stack.Tags)),
        }),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isExactNameBoundMissing(error, input.stackNameOrId)) {
        return Object.freeze({
          state: "missing" as const,
          stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
          proof: "NAME_BOUND_VALIDATION_ERROR" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_DESCRIBE_STACKS_FAILED");
    }
  }

  async getOriginalTemplate(input: {
    stackId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal", "stackId"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The GetTemplate cleanup request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactStackId(input.stackId);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.getTemplate({
          StackName: input.stackId,
          TemplateStage: "Original",
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      let template: unknown = response.TemplateBody;
      if (typeof template === "string") {
        try {
          template = JSON.parse(template);
        } catch {
          fail(
            "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
            "GetTemplate Original did not return the reviewed JSON template form.",
          );
        }
      }
      if (!template || typeof template !== "object" || Array.isArray(template)) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "GetTemplate Original returned a missing or malformed template.",
        );
      }
      return template;
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_GET_TEMPLATE_FAILED");
    }
  }

  async listStackResourcesPage(input: {
    stackId: string;
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["nextToken", "signal", "stackId"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The ListStackResources cleanup request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactStackId(input.stackId);
    const token = requestToken(input.nextToken);
    const request: Record<string, unknown> = { StackName: input.stackId };
    if (token !== null) request.NextToken = token;
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.listStackResources(request),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      if (!Array.isArray(response.StackResourceSummaries)) {
        fail(
          "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
          "ListStackResources returned a malformed inventory page.",
        );
      }
      const resources = response.StackResourceSummaries.map((raw) => {
        const item = record(raw);
        const logicalResourceId = text(item.LogicalResourceId);
        const physicalResourceId = text(item.PhysicalResourceId);
        const resourceStatus = text(item.ResourceStatus);
        const resourceType = text(item.ResourceType);
        if (
          !logicalResourceId ||
          !physicalResourceId ||
          !resourceStatus ||
          !resourceType
        ) {
          fail(
            "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
            "ListStackResources returned an incomplete resource identity.",
          );
        }
        return Object.freeze({
          logicalResourceId,
          physicalResourceId,
          resourceStatus,
          resourceType,
        });
      });
      return Object.freeze({
        resources: Object.freeze(resources),
        nextToken: nextToken(response.NextToken, "ListStackResources"),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_LIST_STACK_RESOURCES_FAILED");
    }
  }

  async readStrongZeroTenantOwnershipSnapshot(input: {
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal"])) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_INPUT_INVALID",
        "The strong zero-tenant cleanup request is malformed.",
      );
    }
    requireSignal(input.signal);
    input.signal.throwIfAborted();
    const result =
      await this.sdk.zeroTenantOwnership.readStrongZeroTenantOwnershipSnapshot({
        signal: input.signal,
      });
    input.signal.throwIfAborted();
    return result;
  }
}

/** The only mutation capability in this module: one exact DeleteStack call. */
export class AwsSdkSharedCellCleanupDeleteStackAdapter
  implements SharedCellCleanupDeleteStackPort
{
  private readonly sdk: AwsSdkSharedCellCleanupDeleteDependencies;

  constructor(dependencies: AwsSdkSharedCellCleanupDeleteDependencies) {
    if (
      !dependencies ||
      typeof dependencies !== "object" ||
      typeof dependencies.client?.send !== "function" ||
      typeof dependencies.deleteStack !== "function"
    ) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_DEPENDENCY_INVALID",
        "The Shared Cell cleanup DeleteStack dependencies are incomplete.",
      );
    }
    this.sdk = dependencies;
  }

  async deleteStack(input: {
    request: {
      StackName: string;
      RoleARN: typeof SHARED_CELL_CLEANUP_DELETION_ROLE_ARN;
      ClientRequestToken: string;
      DeletionMode: "STANDARD";
    };
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["request", "signal"]) ||
      !exactKeys(input.request, [
        "ClientRequestToken",
        "DeletionMode",
        "RoleARN",
        "StackName",
      ])
    ) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_DELETE_ENVELOPE_INVALID",
        "DeleteStack contains missing or unexpected fields.",
      );
    }
    requireSignal(input.signal);
    exactStackId(input.request.StackName);
    if (
      input.request.RoleARN !== SHARED_CELL_CLEANUP_DELETION_ROLE_ARN ||
      input.request.DeletionMode !== "STANDARD" ||
      !cloudFormationTokenPattern.test(input.request.ClientRequestToken) ||
      !stableDeleteTokenPattern.test(input.request.ClientRequestToken)
    ) {
      fail(
        "SHARED_CELL_CLEANUP_SDK_DELETE_ENVELOPE_INVALID",
        "DeleteStack is outside the exact reviewed role, mode or stable-token envelope.",
      );
    }
    try {
      input.signal.throwIfAborted();
      await this.sdk.client.send(
        new this.sdk.deleteStack({ ...input.request }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return Object.freeze({ operation: "delete_submitted" as const });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_DELETE_STACK_FAILED");
    }
  }
}

export interface AwsSdkSharedCellCleanupDeletionRuntime {
  evidence: AwsSdkSharedCellCleanupEvidenceAdapter;
  deleter: AwsSdkSharedCellCleanupDeleteStackAdapter;
}

export interface AwsSdkSharedCellCleanupDeletionRuntimeModules {
  sts: Record<string, unknown>;
  cloudFormation: Record<string, unknown>;
  credentialProvider: Record<string, unknown>;
}

export interface AwsSdkSharedCellCleanupDeletionRuntimeInput {
  zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkClientConstructor;
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkCommandConstructor;
}

function checkedZeroTenantReader(
  input: AwsSdkSharedCellCleanupDeletionRuntimeInput,
): SharedCellCleanupZeroTenantOwnershipReadPort {
  if (
    !exactKeys(input, ["zeroTenantOwnership"]) ||
    typeof input.zeroTenantOwnership?.readStrongZeroTenantOwnershipSnapshot !==
      "function"
  ) {
    throw new Error(
      "Shared Cell cleanup runtime requires one strong zero-tenant read capability.",
    );
  }
  const source = input.zeroTenantOwnership;
  return Object.freeze({
    readStrongZeroTenantOwnershipSnapshot: ({ signal }) =>
      source.readStrongZeroTenantOwnershipSnapshot.call(source, { signal }),
  });
}

/**
 * Pure dormant production construction seam. It creates clients around one
 * lazy ambient credential provider, but performs no AWS call and wires no
 * Worker/Lambda entry point.
 *
 * @internal
 */
export function createAwsSdkSharedCellCleanupDeletionRuntimeFromModules(
  modules: AwsSdkSharedCellCleanupDeletionRuntimeModules,
  input: AwsSdkSharedCellCleanupDeletionRuntimeInput,
): Readonly<AwsSdkSharedCellCleanupDeletionRuntime> {
  const zeroTenantOwnership = checkedZeroTenantReader(input);
  const defaultProvider = modules.credentialProvider.defaultProvider;
  if (typeof defaultProvider !== "function") {
    throw new Error("AWS SDK export defaultProvider is missing.");
  }
  const clientConfig = {
    region: SHARED_CELL_CLEANUP_DELETION_REGION,
    ignoreConfiguredEndpointUrls: true,
  };
  const credentials = (
    defaultProvider as (
      options: Record<string, unknown>,
    ) => AwsCredentialProvider
  )({ clientConfig });
  if (typeof credentials !== "function") {
    throw new Error("AWS SDK default credential provider is invalid.");
  }
  const STSClient = clientConstructor(modules.sts, "STSClient");
  const CloudFormationClient = clientConstructor(
    modules.cloudFormation,
    "CloudFormationClient",
  );
  const sts = new STSClient({ ...clientConfig, credentials });
  const cloudFormation = new CloudFormationClient({
    ...clientConfig,
    credentials,
  });

  return Object.freeze({
    evidence: new AwsSdkSharedCellCleanupEvidenceAdapter(
      SHARED_CELL_CLEANUP_DELETION_REGION,
      {
        clients: { sts, cloudFormation },
        commands: {
          getCallerIdentity: commandConstructor(
            modules.sts,
            "GetCallerIdentityCommand",
          ),
          listStacks: commandConstructor(
            modules.cloudFormation,
            "ListStacksCommand",
          ),
          describeStacks: commandConstructor(
            modules.cloudFormation,
            "DescribeStacksCommand",
          ),
          getTemplate: commandConstructor(
            modules.cloudFormation,
            "GetTemplateCommand",
          ),
          listStackResources: commandConstructor(
            modules.cloudFormation,
            "ListStackResourcesCommand",
          ),
        },
        zeroTenantOwnership,
      },
    ),
    deleter: new AwsSdkSharedCellCleanupDeleteStackAdapter({
      client: cloudFormation,
      deleteStack: commandConstructor(
        modules.cloudFormation,
        "DeleteStackCommand",
      ),
    }),
  });
}

export async function createAwsSdkSharedCellCleanupDeletionRuntime(
  input: AwsSdkSharedCellCleanupDeletionRuntimeInput,
): Promise<Readonly<AwsSdkSharedCellCleanupDeletionRuntime>> {
  const stsPackage = "@aws-sdk/client-sts";
  const cloudFormationPackage = "@aws-sdk/client-cloudformation";
  const credentialProviderPackage = "@aws-sdk/credential-provider-node";
  const [sts, cloudFormation, credentialProvider] = (await Promise.all([
    import(stsPackage),
    import(cloudFormationPackage),
    import(credentialProviderPackage),
  ])) as Record<string, unknown>[];
  return createAwsSdkSharedCellCleanupDeletionRuntimeFromModules(
    { sts, cloudFormation, credentialProvider },
    input,
  );
}
