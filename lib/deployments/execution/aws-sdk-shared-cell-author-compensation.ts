import {
  SHARED_CELL_AUTHOR_COMPENSATION_REGION,
  SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
  type SharedCellAuthorCompensationReadPort,
  type SharedCellAuthorDeleteChangeSetMutationPort,
  type SharedCellAuthorDeleteStackMutationPort,
} from "./shared-cell-author-compensation.ts";

const profile = "techlong-sandbox-cell-operator";
const mfaDeviceArn =
  "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev";
const maximumPages = 100;
const stackIdPattern = new RegExp(
  "^arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
    `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
);
const changeSetArnPattern = new RegExp(
  "^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
    `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}-[a-f0-9]{16}/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
);
const deleteStackTokenPattern = /^b5-author-comp-[a-f0-9]{32}$/;
const cloudFormationTokenPattern = /^[A-Za-z0-9][-A-Za-z0-9]{0,127}$/;

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
type MfaCodeProvider = (mfaSerial: string) => Promise<string>;

export interface AwsSdkSharedCellAuthorCompensationEvidenceDependencies {
  clients: {
    sts: AwsSdkClient;
    cloudFormation: AwsSdkClient;
  };
  commands: {
    getCallerIdentity: AwsSdkCommandConstructor;
    describeStacks: AwsSdkCommandConstructor;
    getTemplate: AwsSdkCommandConstructor;
    listStackResources: AwsSdkCommandConstructor;
    describeChangeSet: AwsSdkCommandConstructor;
  };
}

export interface AwsSdkSharedCellAuthorDeleteChangeSetDependencies {
  clients: {
    sts: AwsSdkClient;
    cloudFormation: AwsSdkClient;
  };
  commands: {
    getCallerIdentity: AwsSdkCommandConstructor;
    deleteChangeSet: AwsSdkCommandConstructor;
  };
}

export interface AwsSdkSharedCellAuthorDeleteStackDependencies {
  clients: {
    sts: AwsSdkClient;
    cloudFormation: AwsSdkClient;
  };
  commands: {
    getCallerIdentity: AwsSdkCommandConstructor;
    deleteStack: AwsSdkCommandConstructor;
  };
}

export interface AwsSdkSharedCellAuthorCompensationRuntimeInput {
  mfaCodeProvider: MfaCodeProvider;
}

export interface AwsSdkSharedCellAuthorCompensationRuntimeModules {
  sts: Record<string, unknown>;
  cloudFormation: Record<string, unknown>;
  credentialProvider: Record<string, unknown>;
}

export interface AwsSdkSharedCellAuthorCompensationRuntime {
  evidence: AwsSdkSharedCellAuthorCompensationEvidenceAdapter;
  deleteChangeSetMutations: AwsSdkSharedCellAuthorDeleteChangeSetAdapter;
  deleteStackMutations: AwsSdkSharedCellAuthorDeleteStackAdapter;
}

export class AwsSdkSharedCellAuthorCompensationAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new AwsSdkSharedCellAuthorCompensationAdapterError(
    code,
    message,
    retryable,
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_RESPONSE_INVALID",
      `${label} returned a malformed optional string.`,
    );
  }
  return value;
}

function requireSignal(value: unknown): asserts value is AbortSignal {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as AbortSignal).throwIfAborted !== "function" ||
    typeof (value as AbortSignal).aborted !== "boolean"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
      "Every Shared Cell author-compensation provider call requires an AbortSignal.",
    );
  }
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(
        new Error("Shared Cell author-compensation provider call was aborted."),
        { name: "AbortError", code: "ABORT_ERR" },
      );
}

function providerError(
  error: unknown,
  fallbackCode: string,
): AwsSdkSharedCellAuthorCompensationAdapterError {
  if (error instanceof AwsSdkSharedCellAuthorCompensationAdapterError) {
    return error;
  }
  const value = record(error);
  const metadata = record(value.$metadata);
  const status =
    typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : 0;
  const name = text(value.name) ?? fallbackCode;
  const code = name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  return new AwsSdkSharedCellAuthorCompensationAdapterError(
    code || fallbackCode,
    "An AWS Shared Cell author-compensation provider request failed.",
    Boolean(value.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  );
}

function responseInvalid(message: string): never {
  return fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_SDK_RESPONSE_INVALID",
    message,
  );
}

function requireRegion(selectedRegion: string): void {
  if (selectedRegion !== SHARED_CELL_AUTHOR_COMPENSATION_REGION) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_REGION_INVALID",
      "The Shared Cell author-compensation adapter is fixed to ca-central-1.",
    );
  }
}

function exactStackNameOrId(value: unknown): asserts value is string {
  if (
    value !== SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME &&
    (typeof value !== "string" || !stackIdPattern.test(value))
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_STACK_INVALID",
      "The author-compensation adapter accepts only the exact reviewed Stack name or ID.",
    );
  }
}

function exactStackId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !stackIdPattern.test(value)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_STACK_INVALID",
      "The author-compensation mutation requires the exact reviewed Stack ID.",
    );
  }
}

function exactChangeSetArn(value: unknown): asserts value is string {
  if (typeof value !== "string" || !changeSetArnPattern.test(value)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_CHANGE_SET_INVALID",
      "The author-compensation adapter accepts only the exact reviewed Change Set ARN shape.",
    );
  }
}

function requestToken(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
      "The author-compensation pagination token is invalid.",
    );
  }
  return value;
}

function responseToken(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    responseInvalid(`${label} returned an invalid pagination token.`);
  }
  return value;
}

function isExactStackMissing(error: unknown, requested: string): boolean {
  const value = record(error);
  return (
    value.name === "ValidationError" &&
    error instanceof Error &&
    error.message === `Stack with id ${requested} does not exist`
  );
}

function isExactChangeSetMissing(error: unknown, requested: string): boolean {
  const value = record(error);
  const metadata = record(value.$metadata);
  return (
    value.name === "ChangeSetNotFoundException" &&
    metadata.httpStatusCode === 404 &&
    error instanceof Error &&
    error.message === `ChangeSet [${requested}] does not exist`
  );
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    responseInvalid(`${label} returned a malformed string list.`);
  }
  const result = value.map((item) => {
    const normalized = text(item);
    if (!normalized) responseInvalid(`${label} returned an empty list item.`);
    return normalized;
  });
  return Object.freeze(result);
}

function keyValueEntries(
  value: unknown,
  keyName: "Key" | "ParameterKey",
  valueName: "Value" | "ParameterValue",
  label: string,
): readonly Readonly<Record<string, string>>[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    responseInvalid(`${label} returned a malformed entry list.`);
  }
  const seen = new Set<string>();
  const result = value.map((raw) => {
    const item = record(raw);
    const key = text(item[keyName]);
    const itemValue = text(item[valueName]);
    if (!key || itemValue === null || seen.has(key)) {
      responseInvalid(
        `${label} returned a missing, duplicate or malformed entry.`,
      );
    }
    seen.add(key);
    return Object.freeze({ [keyName]: key, [valueName]: itemValue });
  });
  return Object.freeze(result);
}

function normalizeTemplateBody(value: unknown, label: string): Readonly<Record<string, unknown>> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      responseInvalid(`${label} did not return a JSON template.`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    responseInvalid(`${label} returned a missing or malformed template.`);
  }
  try {
    return Object.freeze(
      JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>,
    );
  } catch {
    return responseInvalid(`${label} returned a non-JSON template.`);
  }
}

function optionalRelation(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const normalized = text(value);
  if (!normalized) responseInvalid(`${label} returned a malformed relation.`);
  return normalized;
}

function assertEvidenceDependencies(
  dependencies: AwsSdkSharedCellAuthorCompensationEvidenceDependencies,
): void {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    typeof dependencies.clients?.sts?.send !== "function" ||
    typeof dependencies.clients?.cloudFormation?.send !== "function" ||
    typeof dependencies.commands?.getCallerIdentity !== "function" ||
    typeof dependencies.commands?.describeStacks !== "function" ||
    typeof dependencies.commands?.getTemplate !== "function" ||
    typeof dependencies.commands?.listStackResources !== "function" ||
    typeof dependencies.commands?.describeChangeSet !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DEPENDENCY_INVALID",
      "The author-compensation evidence dependencies are incomplete.",
    );
  }
}

async function callerIdentity(
  client: AwsSdkClient,
  command: AwsSdkCommandConstructor,
  signal: AbortSignal,
): Promise<Readonly<{ accountId: string; arn: string }>> {
  try {
    signal.throwIfAborted();
    const response = await client.send(new command({}), {
      abortSignal: signal,
    });
    signal.throwIfAborted();
    const observedAccountId = text(response.Account);
    const arn = text(response.Arn);
    if (!observedAccountId || !/^\d{12}$/.test(observedAccountId) || !arn) {
      responseInvalid("STS returned an incomplete caller identity.");
    }
    return Object.freeze({ accountId: observedAccountId, arn });
  } catch (error) {
    rethrowAbort(signal);
    throw providerError(error, "STS_GET_CALLER_IDENTITY_FAILED");
  }
}

interface NormalizedChangeSetHeader {
  changeSetName: string;
  changeSetArn: string;
  stackName: string;
  stackId: string;
  description: string | null;
  status: string;
  executionStatus: string;
  capabilities: readonly string[];
  includeNestedStacks: boolean;
  parameters: readonly Readonly<Record<string, string>>[];
  tags: readonly Readonly<Record<string, string>>[];
  notificationArns: readonly string[];
  parentChangeSetId: string | null;
  rootChangeSetId: string | null;
  onStackFailure: string | null;
  importExistingResources: boolean;
}

function normalizeChangeSetHeader(
  response: Record<string, unknown>,
): Readonly<NormalizedChangeSetHeader> {
  const changeSetName = text(response.ChangeSetName);
  const changeSetArn = text(response.ChangeSetId);
  const observedStackName = text(response.StackName);
  const stackId = text(response.StackId);
  const status = text(response.Status);
  const executionStatus = text(response.ExecutionStatus);
  if (
    !changeSetName ||
    !changeSetArn ||
    !observedStackName ||
    !stackId ||
    !status ||
    !executionStatus ||
    typeof response.IncludeNestedStacks !== "boolean" ||
    typeof response.ImportExistingResources !== "boolean"
  ) {
    responseInvalid("DescribeChangeSet returned an incomplete identity or state.");
  }
  return Object.freeze({
    changeSetName,
    changeSetArn,
    stackName: observedStackName,
    stackId,
    description: optionalText(response.Description, "DescribeChangeSet"),
    status,
    executionStatus,
    capabilities: stringArray(response.Capabilities, "DescribeChangeSet capabilities"),
    includeNestedStacks: response.IncludeNestedStacks,
    parameters: keyValueEntries(
      response.Parameters,
      "ParameterKey",
      "ParameterValue",
      "DescribeChangeSet parameters",
    ),
    tags: keyValueEntries(
      response.Tags,
      "Key",
      "Value",
      "DescribeChangeSet tags",
    ),
    notificationArns: stringArray(
      response.NotificationARNs,
      "DescribeChangeSet notification ARNs",
    ),
    parentChangeSetId: optionalRelation(
      response.ParentChangeSetId,
      "DescribeChangeSet ParentChangeSetId",
    ),
    rootChangeSetId: optionalRelation(
      response.RootChangeSetId,
      "DescribeChangeSet RootChangeSetId",
    ),
    onStackFailure: optionalText(
      response.OnStackFailure,
      "DescribeChangeSet OnStackFailure",
    ),
    importExistingResources: response.ImportExistingResources,
  });
}

function changeSetHeaderComparable(
  value: Readonly<NormalizedChangeSetHeader>,
): string {
  return JSON.stringify(value);
}

function normalizeChanges(
  value: unknown,
): readonly Readonly<{
  type: string;
  action: string;
  logicalResourceId: string;
  resourceType: string;
}>[] {
  if (!Array.isArray(value)) {
    responseInvalid("DescribeChangeSet returned a malformed Changes page.");
  }
  return Object.freeze(
    value.map((raw) => {
      const item = record(raw);
      const resource = record(item.ResourceChange);
      const type = text(item.Type);
      const action = text(resource.Action);
      const logicalResourceId = text(resource.LogicalResourceId);
      const resourceType = text(resource.ResourceType);
      if (!type || !action || !logicalResourceId || !resourceType) {
        responseInvalid(
          "DescribeChangeSet returned an incomplete Resource change.",
        );
      }
      return Object.freeze({
        type,
        action,
        logicalResourceId,
        resourceType,
      });
    }),
  );
}

/**
 * Read-only evidence adapter for the dormant author-compensation controller.
 * It projects only fields actually returned by AWS; reviewed digests and URLs
 * are deliberately not injected into provider observations.
 */
export class AwsSdkSharedCellAuthorCompensationEvidenceAdapter
  implements SharedCellAuthorCompensationReadPort
{
  readonly region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  private readonly sdk: AwsSdkSharedCellAuthorCompensationEvidenceDependencies;

  constructor(
    selectedRegion: string,
    dependencies: AwsSdkSharedCellAuthorCompensationEvidenceDependencies,
  ) {
    requireRegion(selectedRegion);
    assertEvidenceDependencies(dependencies);
    this.region = SHARED_CELL_AUTHOR_COMPENSATION_REGION;
    this.sdk = dependencies;
  }

  async getCallerIdentity(input: { signal: AbortSignal }): Promise<unknown> {
    if (!exactKeys(input, ["signal"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation STS evidence request is malformed.",
      );
    }
    requireSignal(input.signal);
    return callerIdentity(
      this.sdk.clients.sts,
      this.sdk.commands.getCallerIdentity,
      input.signal,
    );
  }

  async describeStack(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal", "stackNameOrId"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation DescribeStacks request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactStackNameOrId(input.stackNameOrId);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({
          StackName: input.stackNameOrId,
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      if (!Array.isArray(response.Stacks) || response.Stacks.length !== 1) {
        responseInvalid(
          "DescribeStacks did not return exactly one Shared Cell Stack.",
        );
      }
      const stack = record(response.Stacks[0]);
      const observedStackName = text(stack.StackName);
      const stackId = text(stack.StackId);
      const stackStatus = text(stack.StackStatus);
      const roleArn = text(stack.RoleARN);
      if (
        !observedStackName ||
        !stackId ||
        !stackStatus ||
        !roleArn ||
        typeof stack.EnableTerminationProtection !== "boolean" ||
        (input.stackNameOrId === SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME
          ? observedStackName !== input.stackNameOrId
          : stackId !== input.stackNameOrId)
      ) {
        responseInvalid(
          "DescribeStacks returned a different or incomplete Shared Cell Stack.",
        );
      }
      return Object.freeze({
        state: "present" as const,
        stack: Object.freeze({
          stackName: observedStackName,
          stackId,
          stackStatus,
          roleArn,
          terminationProtection: stack.EnableTerminationProtection,
          parentId: optionalRelation(stack.ParentId, "DescribeStacks ParentId"),
          rootId: optionalRelation(stack.RootId, "DescribeStacks RootId"),
          tags: keyValueEntries(
            stack.Tags,
            "Key",
            "Value",
            "DescribeStacks tags",
          ),
        }),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isExactStackMissing(error, input.stackNameOrId)) {
        return Object.freeze({
          state: "missing" as const,
          stackName: input.stackNameOrId,
          proof: "NAME_BOUND_VALIDATION_ERROR" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_DESCRIBE_STACKS_FAILED");
    }
  }

  async getOriginalTemplate(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["signal", "stackNameOrId"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation GetTemplate request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactStackNameOrId(input.stackNameOrId);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.getTemplate({
          StackName: input.stackNameOrId,
          TemplateStage: "Original",
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return Object.freeze({
        state: "present" as const,
        stackNameOrId: input.stackNameOrId,
        templateBody: normalizeTemplateBody(
          response.TemplateBody,
          "GetTemplate Original",
        ),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isExactStackMissing(error, input.stackNameOrId)) {
        return Object.freeze({
          state: "missing" as const,
          stackNameOrId: input.stackNameOrId,
          proof: "NAME_BOUND_VALIDATION_ERROR" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_GET_TEMPLATE_FAILED");
    }
  }

  async listStackResourcesPage(input: {
    stackNameOrId: string;
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (!exactKeys(input, ["nextToken", "signal", "stackNameOrId"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation ListStackResources request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactStackNameOrId(input.stackNameOrId);
    const token = requestToken(input.nextToken);
    const request: Record<string, unknown> = {
      StackName: input.stackNameOrId,
    };
    if (token !== null) request.NextToken = token;
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.listStackResources(request),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      if (!Array.isArray(response.StackResourceSummaries)) {
        responseInvalid(
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
          responseInvalid(
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
        nextToken: responseToken(
          response.NextToken,
          "ListStackResources",
        ),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isExactStackMissing(error, input.stackNameOrId)) {
        return Object.freeze({
          state: "missing" as const,
          stackNameOrId: input.stackNameOrId,
          proof: "NAME_BOUND_VALIDATION_ERROR" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_LIST_STACK_RESOURCES_FAILED");
    }
  }

  async describeChangeSet(input: {
    changeSetNameOrArn: string;
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["changeSetNameOrArn", "signal", "stackNameOrId"])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation DescribeChangeSet request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactChangeSetArn(input.changeSetNameOrArn);
    exactStackId(input.stackNameOrId);

    let completedPages = 0;
    try {
      const changes: Array<Readonly<{
        type: string;
        action: string;
        logicalResourceId: string;
        resourceType: string;
      }>> = [];
      const seenTokens = new Set<string>();
      let nextToken: string | null = null;
      let header: Readonly<NormalizedChangeSetHeader> | null = null;
      for (let page = 0; page < maximumPages; page += 1) {
        const request: Record<string, unknown> = {
          ChangeSetName: input.changeSetNameOrArn,
          IncludePropertyValues: true,
          StackName: input.stackNameOrId,
        };
        if (nextToken !== null) request.NextToken = nextToken;
        input.signal.throwIfAborted();
        const response = await this.sdk.clients.cloudFormation.send(
          new this.sdk.commands.describeChangeSet(request),
          { abortSignal: input.signal },
        );
        input.signal.throwIfAborted();
        const pageHeader = normalizeChangeSetHeader(response);
        if (header === null) {
          header = pageHeader;
        } else if (
          changeSetHeaderComparable(pageHeader) !==
          changeSetHeaderComparable(header)
        ) {
          responseInvalid(
            "DescribeChangeSet metadata changed while pagination was in progress.",
          );
        }
        changes.push(...normalizeChanges(response.Changes));
        completedPages += 1;
        const observedToken = responseToken(
          response.NextToken,
          "DescribeChangeSet",
        );
        if (observedToken === null) {
          nextToken = null;
          break;
        }
        if (seenTokens.has(observedToken) || page === maximumPages - 1) {
          responseInvalid(
            "DescribeChangeSet pagination was repeated or excessive.",
          );
        }
        seenTokens.add(observedToken);
        nextToken = observedToken;
      }
      if (!header || nextToken !== null) {
        responseInvalid("DescribeChangeSet pagination did not terminate.");
      }
      if (
        header.changeSetArn !== input.changeSetNameOrArn ||
        header.stackId !== input.stackNameOrId ||
        header.stackName !== SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME
      ) {
        responseInvalid(
          "DescribeChangeSet returned a different Change Set or Stack binding.",
        );
      }
      return Object.freeze({
        state: "present" as const,
        changeSet: Object.freeze({
          ...header,
          changes: Object.freeze(changes),
        }),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (
        completedPages === 0 &&
        isExactChangeSetMissing(error, input.changeSetNameOrArn)
      ) {
        return Object.freeze({
          state: "missing" as const,
          changeSetArn: input.changeSetNameOrArn,
          proof: "ARN_BOUND_CHANGE_SET_NOT_FOUND" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_DESCRIBE_CHANGE_SET_FAILED");
    }
  }

  async getChangeSetTemplate(input: {
    changeSetNameOrArn: string;
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["changeSetNameOrArn", "signal", "stackNameOrId"])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The author-compensation Change Set GetTemplate request is malformed.",
      );
    }
    requireSignal(input.signal);
    exactChangeSetArn(input.changeSetNameOrArn);
    exactStackId(input.stackNameOrId);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.getTemplate({
          ChangeSetName: input.changeSetNameOrArn,
          StackName: input.stackNameOrId,
          TemplateStage: "Original",
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return Object.freeze({
        state: "present" as const,
        changeSetArn: input.changeSetNameOrArn,
        stackId: input.stackNameOrId,
        templateBody: normalizeTemplateBody(
          response.TemplateBody,
          "GetTemplate Change Set Original",
        ),
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isExactChangeSetMissing(error, input.changeSetNameOrArn)) {
        return Object.freeze({
          state: "missing" as const,
          changeSetArn: input.changeSetNameOrArn,
          proof: "ARN_BOUND_CHANGE_SET_NOT_FOUND" as const,
        });
      }
      throw providerError(error, "CLOUDFORMATION_GET_CHANGE_SET_TEMPLATE_FAILED");
    }
  }
}

function assertDeleteChangeSetDependencies(
  dependencies: AwsSdkSharedCellAuthorDeleteChangeSetDependencies,
): void {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    typeof dependencies.clients?.sts?.send !== "function" ||
    typeof dependencies.clients?.cloudFormation?.send !== "function" ||
    typeof dependencies.commands?.getCallerIdentity !== "function" ||
    typeof dependencies.commands?.deleteChangeSet !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DEPENDENCY_INVALID",
      "The DeleteChangeSet dependencies are incomplete.",
    );
  }
}

/** Narrow mutation adapter: this object has no DeleteStack capability. */
export class AwsSdkSharedCellAuthorDeleteChangeSetAdapter
  implements SharedCellAuthorDeleteChangeSetMutationPort
{
  readonly region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  private readonly sdk: AwsSdkSharedCellAuthorDeleteChangeSetDependencies;

  constructor(
    selectedRegion: string,
    dependencies: AwsSdkSharedCellAuthorDeleteChangeSetDependencies,
  ) {
    requireRegion(selectedRegion);
    assertDeleteChangeSetDependencies(dependencies);
    this.region = SHARED_CELL_AUTHOR_COMPENSATION_REGION;
    this.sdk = dependencies;
  }

  async getCallerIdentity(input: { signal: AbortSignal }): Promise<unknown> {
    if (!exactKeys(input, ["signal"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The DeleteChangeSet STS request is malformed.",
      );
    }
    requireSignal(input.signal);
    return callerIdentity(
      this.sdk.clients.sts,
      this.sdk.commands.getCallerIdentity,
      input.signal,
    );
  }

  async deleteChangeSet(input: {
    request: { ChangeSetName: string; StackName: string };
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["request", "signal"]) ||
      !exactKeys(record(input).request, ["ChangeSetName", "StackName"])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DELETE_ENVELOPE_INVALID",
        "DeleteChangeSet contains missing or unexpected fields.",
      );
    }
    requireSignal(input.signal);
    exactChangeSetArn(input.request.ChangeSetName);
    exactStackId(input.request.StackName);
    try {
      input.signal.throwIfAborted();
      await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.deleteChangeSet({ ...input.request }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return Object.freeze({
        operation: "delete_change_set_submitted" as const,
      });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_DELETE_CHANGE_SET_FAILED");
    }
  }
}

function assertDeleteStackDependencies(
  dependencies: AwsSdkSharedCellAuthorDeleteStackDependencies,
): void {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    typeof dependencies.clients?.sts?.send !== "function" ||
    typeof dependencies.clients?.cloudFormation?.send !== "function" ||
    typeof dependencies.commands?.getCallerIdentity !== "function" ||
    typeof dependencies.commands?.deleteStack !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DEPENDENCY_INVALID",
      "The DeleteStack dependencies are incomplete.",
    );
  }
}

/** Narrow mutation adapter: this object has no DeleteChangeSet capability. */
export class AwsSdkSharedCellAuthorDeleteStackAdapter
  implements SharedCellAuthorDeleteStackMutationPort
{
  readonly region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  private readonly sdk: AwsSdkSharedCellAuthorDeleteStackDependencies;

  constructor(
    selectedRegion: string,
    dependencies: AwsSdkSharedCellAuthorDeleteStackDependencies,
  ) {
    requireRegion(selectedRegion);
    assertDeleteStackDependencies(dependencies);
    this.region = SHARED_CELL_AUTHOR_COMPENSATION_REGION;
    this.sdk = dependencies;
  }

  async getCallerIdentity(input: { signal: AbortSignal }): Promise<unknown> {
    if (!exactKeys(input, ["signal"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_INPUT_INVALID",
        "The DeleteStack STS request is malformed.",
      );
    }
    requireSignal(input.signal);
    return callerIdentity(
      this.sdk.clients.sts,
      this.sdk.commands.getCallerIdentity,
      input.signal,
    );
  }

  async deleteStack(input: {
    request: {
      StackName: string;
      DeletionMode: "STANDARD";
      ClientRequestToken: string;
    };
    signal: AbortSignal;
  }): Promise<unknown> {
    if (
      !exactKeys(input, ["request", "signal"]) ||
      !exactKeys(record(input).request, [
        "ClientRequestToken",
        "DeletionMode",
        "StackName",
      ])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DELETE_ENVELOPE_INVALID",
        "DeleteStack contains missing or unexpected fields.",
      );
    }
    requireSignal(input.signal);
    exactStackId(input.request.StackName);
    if (
      input.request.DeletionMode !== "STANDARD" ||
      !cloudFormationTokenPattern.test(input.request.ClientRequestToken) ||
      !deleteStackTokenPattern.test(input.request.ClientRequestToken)
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DELETE_ENVELOPE_INVALID",
        "DeleteStack is outside the exact STANDARD stable-token envelope.",
      );
    }
    try {
      input.signal.throwIfAborted();
      await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.deleteStack({ ...input.request }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return Object.freeze({ operation: "delete_stack_submitted" as const });
    } catch (error) {
      rethrowAbort(input.signal);
      throw providerError(error, "CLOUDFORMATION_DELETE_STACK_FAILED");
    }
  }
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

function checkedMfaCodeProvider(
  input: AwsSdkSharedCellAuthorCompensationRuntimeInput,
): MfaCodeProvider {
  if (
    !exactKeys(input, ["mfaCodeProvider"]) ||
    typeof input.mfaCodeProvider !== "function"
  ) {
    throw new Error(
      "Shared Cell author-compensation MFA provider input is invalid.",
    );
  }
  const source = input.mfaCodeProvider;
  return async (serial: string) => {
    if (serial !== mfaDeviceArn) {
      throw new Error(
        "Shared Cell author-compensation MFA device is outside the allowlist.",
      );
    }
    const code = await source(serial);
    if (!/^[0-9]{6}$/.test(code)) {
      throw new Error("Shared Cell author-compensation MFA code is invalid.");
    }
    return code;
  };
}

/**
 * Pure dormant construction seam. It creates isolated read and mutation
 * clients around one shared lazy credential provider. Construction neither
 * resolves credentials nor sends AWS calls, and this module is not wired into
 * the default Worker or application runtime.
 *
 * @internal
 */
export function createAwsSdkSharedCellAuthorCompensationRuntimeFromModules(
  modules: AwsSdkSharedCellAuthorCompensationRuntimeModules,
  input: AwsSdkSharedCellAuthorCompensationRuntimeInput,
): Readonly<AwsSdkSharedCellAuthorCompensationRuntime> {
  const defaultProvider = modules.credentialProvider.defaultProvider;
  if (typeof defaultProvider !== "function") {
    throw new Error("AWS SDK export defaultProvider is missing.");
  }
  const credentials = (
    defaultProvider as (
      options: Record<string, unknown>,
    ) => AwsCredentialProvider
  )({
    profile,
    mfaCodeProvider: checkedMfaCodeProvider(input),
    clientConfig: {
      region: SHARED_CELL_AUTHOR_COMPENSATION_REGION,
      ignoreConfiguredEndpointUrls: true,
    },
  });
  if (typeof credentials !== "function") {
    throw new Error("AWS SDK default credential provider is invalid.");
  }

  const STSClient = clientConstructor(modules.sts, "STSClient");
  const CloudFormationClient = clientConstructor(
    modules.cloudFormation,
    "CloudFormationClient",
  );
  const readClientConfiguration = {
    region: SHARED_CELL_AUTHOR_COMPENSATION_REGION,
    credentials,
    ignoreConfiguredEndpointUrls: true,
  };
  const mutationClientConfiguration = {
    ...readClientConfiguration,
    maxAttempts: 1,
  };
  const readSts = new STSClient(readClientConfiguration);
  const readCloudFormation = new CloudFormationClient(
    readClientConfiguration,
  );
  const mutationSts = new STSClient(mutationClientConfiguration);
  const mutationCloudFormation = new CloudFormationClient(
    mutationClientConfiguration,
  );

  const GetCallerIdentityCommand = commandConstructor(
    modules.sts,
    "GetCallerIdentityCommand",
  );
  const evidence = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    SHARED_CELL_AUTHOR_COMPENSATION_REGION,
    {
      clients: {
        sts: readSts,
        cloudFormation: readCloudFormation,
      },
      commands: {
        getCallerIdentity: GetCallerIdentityCommand,
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
        describeChangeSet: commandConstructor(
          modules.cloudFormation,
          "DescribeChangeSetCommand",
        ),
      },
    },
  );
  const deleteChangeSetMutations =
    new AwsSdkSharedCellAuthorDeleteChangeSetAdapter(
      SHARED_CELL_AUTHOR_COMPENSATION_REGION,
      {
        clients: {
          sts: mutationSts,
          cloudFormation: mutationCloudFormation,
        },
        commands: {
          getCallerIdentity: GetCallerIdentityCommand,
          deleteChangeSet: commandConstructor(
            modules.cloudFormation,
            "DeleteChangeSetCommand",
          ),
        },
      },
    );
  const deleteStackMutations = new AwsSdkSharedCellAuthorDeleteStackAdapter(
    SHARED_CELL_AUTHOR_COMPENSATION_REGION,
    {
      clients: {
        sts: mutationSts,
        cloudFormation: mutationCloudFormation,
      },
      commands: {
        getCallerIdentity: GetCallerIdentityCommand,
        deleteStack: commandConstructor(
          modules.cloudFormation,
          "DeleteStackCommand",
        ),
      },
    },
  );

  return Object.freeze({
    evidence,
    deleteChangeSetMutations,
    deleteStackMutations,
  });
}

/** Dynamically loads installed SDK modules without making an AWS request. */
export async function createAwsSdkSharedCellAuthorCompensationRuntime(
  input: AwsSdkSharedCellAuthorCompensationRuntimeInput,
): Promise<Readonly<AwsSdkSharedCellAuthorCompensationRuntime>> {
  const stsPackage = "@aws-sdk/client-sts";
  const cloudFormationPackage = "@aws-sdk/client-cloudformation";
  const credentialProviderPackage = "@aws-sdk/credential-provider-node";
  const [sts, cloudFormation, credentialProvider] = (await Promise.all([
    import(stsPackage),
    import(cloudFormationPackage),
    import(credentialProviderPackage),
  ])) as Record<string, unknown>[];
  return createAwsSdkSharedCellAuthorCompensationRuntimeFromModules(
    { sts, cloudFormation, credentialProvider },
    input,
  );
}
