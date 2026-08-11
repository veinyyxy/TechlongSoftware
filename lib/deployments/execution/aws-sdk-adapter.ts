import type {
  ApplyReadyTenantStack,
  AwsCallerIdentity,
  AwsDeploymentPort,
  CloudFormationStackObservation,
} from "./contracts.ts";
import {
  tenantStackOperationTagKey,
  tenantStackStableOwnershipTagKeys,
} from "../cloudformation/tenant-stack.ts";

interface AwsSdkClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkAdapterDependencies {
  stsClient: AwsSdkClient;
  cloudFormationClient: AwsSdkClient;
  commands: {
    getCallerIdentity: AwsSdkCommandConstructor;
    describeStacks: AwsSdkCommandConstructor;
    createStack: AwsSdkCommandConstructor;
    updateStack: AwsSdkCommandConstructor;
    deleteStack: AwsSdkCommandConstructor;
  };
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStackMissing(error: unknown): boolean {
  const record = errorRecord(error);
  return (
    (record.name === "ValidationError" || record.Code === "ValidationError") &&
    /does not exist/i.test(errorMessage(error))
  );
}

function isNoUpdates(error: unknown): boolean {
  return /No updates are to be performed/i.test(errorMessage(error));
}

export class AwsDeploymentApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function normalizeAwsError(error: unknown, fallbackCode: string): AwsDeploymentApiError {
  if (error instanceof AwsDeploymentApiError) return error;
  const record = errorRecord(error);
  const metadata = errorRecord(record.$metadata);
  const statusCode = Number(metadata.httpStatusCode ?? 0);
  const name = textField(record.name) ?? fallbackCode;
  const retryable =
    Boolean(record.$retryable) ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500 ||
    /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name);
  return new AwsDeploymentApiError(
    name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    errorMessage(error).slice(0, 500),
    retryable,
  );
}

function stackState(status: string | null): CloudFormationStackObservation["state"] {
  if (!status) return "missing";
  if (status === "DELETE_IN_PROGRESS") return "delete_in_progress";
  if (/_IN_PROGRESS$/.test(status) || status.endsWith("_CLEANUP_IN_PROGRESS")) {
    return "in_progress";
  }
  if (["CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE"].includes(status)) {
    return "ready";
  }
  return "failed";
}

function toStringMap(
  values: unknown,
  keyName: string,
  valueName: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of objectArray(values)) {
    const key = textField(item[keyName]);
    const value = textField(item[valueName]);
    if (key && value) result[key] = value;
  }
  return result;
}

export class AwsSdkDeploymentAdapter implements AwsDeploymentPort {
  readonly region: string;
  private readonly sdk: AwsSdkAdapterDependencies;

  constructor(
    region: string,
    sdk: AwsSdkAdapterDependencies,
  ) {
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
      throw new Error("AWS SDK adapter region is invalid.");
    }
    this.region = region;
    this.sdk = sdk;
  }

  async getCallerIdentity(): Promise<AwsCallerIdentity> {
    try {
      const response = await this.sdk.stsClient.send(
        new this.sdk.commands.getCallerIdentity({}),
      );
      const accountId = textField(response.Account);
      const arn = textField(response.Arn);
      if (!accountId || !/^\d{12}$/.test(accountId) || !arn) {
        throw new AwsDeploymentApiError(
          "STS_IDENTITY_INVALID",
          "STS returned an incomplete caller identity.",
          false,
        );
      }
      return { accountId, arn };
    } catch (error) {
      throw normalizeAwsError(error, "STS_GET_CALLER_IDENTITY_FAILED");
    }
  }

  async describeTenantStack(stackName: string): Promise<CloudFormationStackObservation> {
    try {
      const response = await this.sdk.cloudFormationClient.send(
        new this.sdk.commands.describeStacks({ StackName: stackName }),
      );
      const stack = objectArray(response.Stacks)[0];
      if (!stack) {
        return { state: "missing", rawStatus: null, stackId: null, outputs: {}, tags: {} };
      }
      const rawStatus = textField(stack.StackStatus);
      return {
        state: stackState(rawStatus),
        rawStatus,
        stackId: textField(stack.StackId),
        outputs: toStringMap(stack.Outputs, "OutputKey", "OutputValue"),
        tags: toStringMap(stack.Tags, "Key", "Value"),
      };
    } catch (error) {
      if (isStackMissing(error)) {
        return { state: "missing", rawStatus: null, stackId: null, outputs: {}, tags: {} };
      }
      throw normalizeAwsError(error, "CLOUDFORMATION_DESCRIBE_FAILED");
    }
  }

  async applyTenantStack(stack: ApplyReadyTenantStack): Promise<{
    operation: "create" | "update" | "no_change" | "existing_in_progress";
    stackId: string;
  }> {
    if (!stack.safety.applyReady || stack.safety.renderOnly) {
      throw new AwsDeploymentApiError(
        "STACK_NOT_APPLY_READY",
        "CloudFormation stack did not pass final parameter validation.",
        false,
      );
    }
    if (stack.templateBody.length > 51_200) {
      throw new AwsDeploymentApiError(
        "STACK_TEMPLATE_TOO_LARGE",
        "Inline CloudFormation template exceeds 51,200 bytes.",
        false,
      );
    }
    const observed = await this.describeTenantStack(stack.stackName);
    if (observed.state !== "missing") {
      for (const key of tenantStackStableOwnershipTagKeys) {
        if (observed.tags[key] !== stack.tags[key]) {
          throw new AwsDeploymentApiError(
            "STACK_OWNERSHIP_MISMATCH",
            `Existing CloudFormation stack tag ${key} does not match.`,
            false,
          );
        }
      }
      const observedOperation = observed.tags[tenantStackOperationTagKey];
      const currentOperation = stack.tags[tenantStackOperationTagKey];
      if (observedOperation !== currentOperation) {
        throw new AwsDeploymentApiError(
          "STACK_OPERATION_FENCE_MISMATCH",
          "Existing CloudFormation stack is not owned by the current deployment.",
          false,
        );
      }
    }
    if (observed.state === "delete_in_progress") {
      throw new AwsDeploymentApiError(
        "CLOUDFORMATION_DELETE_IN_PROGRESS",
        "The owned tenant stack is currently being deleted.",
        true,
      );
    }
    if (observed.state === "in_progress") {
      if (
        observed.tags[tenantStackOperationTagKey] !==
        stack.tags[tenantStackOperationTagKey]
      ) {
        throw new AwsDeploymentApiError(
          "CLOUDFORMATION_PREVIOUS_OPERATION_IN_PROGRESS",
          "The durable tenant stack is still being changed by a previous deployment.",
          true,
        );
      }
      if (!observed.stackId) {
        throw new AwsDeploymentApiError(
          "CLOUDFORMATION_STACK_ID_MISSING",
          "The in-progress tenant stack has no stack id.",
          true,
        );
      }
      return { operation: "existing_in_progress", stackId: observed.stackId };
    }
    if (observed.state === "failed") {
      throw new AwsDeploymentApiError(
        "CLOUDFORMATION_STACK_FAILED",
        `The owned tenant stack is in terminal state ${observed.rawStatus ?? "unknown"}; cleanup is required before retry.`,
        false,
      );
    }
    const base = {
      StackName: stack.stackName,
      TemplateBody: stack.templateBody,
      Parameters: Object.entries(stack.parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
      Tags: Object.entries(stack.tags)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([Key, Value]) => ({ Key, Value })),
      ClientRequestToken: stack.clientRequestToken,
      RoleARN: stack.cloudFormationRoleArn,
      EnableTerminationProtection: false,
    };
    try {
      if (observed.state === "missing") {
        const response = await this.sdk.cloudFormationClient.send(
          new this.sdk.commands.createStack({
            ...base,
            OnFailure: "ROLLBACK",
          }),
        );
        const stackId = textField(response.StackId);
        if (!stackId) {
          throw new AwsDeploymentApiError(
            "CLOUDFORMATION_STACK_ID_MISSING",
            "CreateStack did not return a stack id.",
            true,
          );
        }
        return { operation: "create", stackId };
      }
      const response = await this.sdk.cloudFormationClient.send(
        new this.sdk.commands.updateStack(base),
      );
      return {
        operation: "update",
        stackId: textField(response.StackId) ?? observed.stackId ?? stack.stackName,
      };
    } catch (error) {
      if (isNoUpdates(error) && observed.stackId) {
        return { operation: "no_change", stackId: observed.stackId };
      }
      throw normalizeAwsError(error, "CLOUDFORMATION_APPLY_FAILED");
    }
  }

  async deleteTenantStack(input: {
    stackName: string;
    clientRequestToken: string;
    expectedTags: Record<string, string>;
    cloudFormationRoleArn: string;
  }): Promise<{ operation: "delete" | "delete_in_progress" | "already_deleted" }> {
    const observed = await this.describeTenantStack(input.stackName);
    if (observed.state === "missing") return { operation: "already_deleted" };
    for (const key of [
      ...tenantStackStableOwnershipTagKeys,
      tenantStackOperationTagKey,
    ] as const) {
      if (observed.tags[key] !== input.expectedTags[key]) {
        throw new AwsDeploymentApiError(
          "STACK_OWNERSHIP_MISMATCH",
          `Refusing to delete a stack with a mismatched ${key} tag.`,
          false,
        );
      }
    }
    if (observed.state === "delete_in_progress") {
      return { operation: "delete_in_progress" };
    }
    try {
      await this.sdk.cloudFormationClient.send(
        new this.sdk.commands.deleteStack({
          StackName: input.stackName,
          ClientRequestToken: input.clientRequestToken,
          RoleARN: input.cloudFormationRoleArn,
          DeletionMode: "STANDARD",
        }),
      );
      return { operation: "delete" };
    } catch (error) {
      if (isStackMissing(error)) return { operation: "already_deleted" };
      throw normalizeAwsError(error, "CLOUDFORMATION_DELETE_FAILED");
    }
  }
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkCommandConstructor;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkClientConstructor;
}

export async function createAwsSdkDeploymentAdapter(
  region: string,
): Promise<AwsSdkDeploymentAdapter> {
  // Variable module names keep the browser build from eagerly bundling the
  // Node-only AWS SDK. The independent worker installs these runtime packages.
  const stsPackage = "@aws-sdk/client-sts";
  const cloudFormationPackage = "@aws-sdk/client-cloudformation";
  const [stsModule, cloudFormationModule] = (await Promise.all([
    import(stsPackage),
    import(cloudFormationPackage),
  ])) as [Record<string, unknown>, Record<string, unknown>];
  const STSClient = clientConstructor(stsModule, "STSClient");
  const CloudFormationClient = clientConstructor(
    cloudFormationModule,
    "CloudFormationClient",
  );
  return new AwsSdkDeploymentAdapter(region, {
    stsClient: new STSClient({ region }),
    cloudFormationClient: new CloudFormationClient({ region }),
    commands: {
      getCallerIdentity: commandConstructor(stsModule, "GetCallerIdentityCommand"),
      describeStacks: commandConstructor(
        cloudFormationModule,
        "DescribeStacksCommand",
      ),
      createStack: commandConstructor(cloudFormationModule, "CreateStackCommand"),
      updateStack: commandConstructor(cloudFormationModule, "UpdateStackCommand"),
      deleteStack: commandConstructor(cloudFormationModule, "DeleteStackCommand"),
    },
  });
}
