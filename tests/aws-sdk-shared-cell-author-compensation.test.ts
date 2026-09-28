import assert from "node:assert/strict";
import test from "node:test";

import { ChangeSetNotFoundException } from "@aws-sdk/client-cloudformation";

import {
  AwsSdkSharedCellAuthorCompensationAdapterError,
  AwsSdkSharedCellAuthorCompensationEvidenceAdapter,
  AwsSdkSharedCellAuthorDeleteChangeSetAdapter,
  AwsSdkSharedCellAuthorDeleteStackAdapter,
  createAwsSdkSharedCellAuthorCompensationRuntime,
  createAwsSdkSharedCellAuthorCompensationRuntimeFromModules,
  type AwsSdkSharedCellAuthorCompensationEvidenceDependencies,
} from "../lib/deployments/execution/aws-sdk-shared-cell-author-compensation.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
  SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
  SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
} from "../lib/deployments/execution/shared-cell-author-compensation.ts";

const region = "ca-central-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}/12345678-1234-4234-8234-123456789012`;
const changeSetName = `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}-${"a".repeat(16)}`;
const changeSetArn =
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
  `${changeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
const deleteToken = `b5-author-comp-${"b".repeat(32)}`;

interface FakeCommandValue {
  kind: string;
  input: Record<string, unknown>;
}

function command(kind: string) {
  return class implements FakeCommandValue {
    readonly kind = kind;
    readonly input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

const GetCallerIdentityCommand = command("GetCallerIdentity");
const DescribeStacksCommand = command("DescribeStacks");
const GetTemplateCommand = command("GetTemplate");
const ListStackResourcesCommand = command("ListStackResources");
const DescribeChangeSetCommand = command("DescribeChangeSet");
const DeleteChangeSetCommand = command("DeleteChangeSet");
const DeleteStackCommand = command("DeleteStack");

function evidenceDependencies(
  send: (
    value: FakeCommandValue,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<Record<string, unknown>>,
): AwsSdkSharedCellAuthorCompensationEvidenceDependencies {
  const client = {
    send: send as AwsSdkSharedCellAuthorCompensationEvidenceDependencies["clients"]["sts"]["send"],
  };
  return {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      describeStacks: DescribeStacksCommand,
      getTemplate: GetTemplateCommand,
      listStackResources: ListStackResourcesCommand,
      describeChangeSet: DescribeChangeSetCommand,
    },
  };
}

function stackResponse() {
  return {
    Stacks: [
      {
        StackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
        StackId: stackId,
        StackStatus: "REVIEW_IN_PROGRESS",
        RoleARN: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
        EnableTerminationProtection: false,
        Tags: [
          { Key: "Environment", Value: "aws-sandbox" },
          { Key: "ManagedBy", Value: "techlong-cell-operator" },
          { Key: "CellId", Value: "cell-sandbox-1" },
          { Key: "ExpiresAt", Value: "2026-09-27T18:00:00.000Z" },
        ],
      },
    ],
  };
}

function changeSetPage(
  changes: unknown[],
  nextToken?: string,
): Record<string, unknown> {
  return {
    ChangeSetName: changeSetName,
    ChangeSetId: changeSetArn,
    StackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
    StackId: stackId,
    Description: "provider description",
    Status: "CREATE_COMPLETE",
    ExecutionStatus: "AVAILABLE",
    Capabilities: [],
    IncludeNestedStacks: false,
    Parameters: [
      { ParameterKey: "AvailabilityZoneA", ParameterValue: "ca-central-1a" },
    ],
    Tags: [{ Key: "Environment", Value: "aws-sandbox" }],
    NotificationARNs: [],
    OnStackFailure: "DELETE",
    ImportExistingResources: false,
    Changes: changes,
    ...(nextToken === undefined ? {} : { NextToken: nextToken }),
  };
}

test("evidence adapter forwards exact read requests and returns provider observations", async () => {
  const calls: FakeCommandValue[] = [];
  const controller = new AbortController();
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Resources: { CellCluster: { Type: "AWS::ECS::Cluster" } },
  };
  const adapter = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async (value, options) => {
      assert.equal(options?.abortSignal, controller.signal);
      calls.push(value);
      if (value.kind === "GetCallerIdentity") {
        return {
          Account: "402010193138",
          Arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
        };
      }
      if (value.kind === "DescribeStacks") return stackResponse();
      if (value.kind === "GetTemplate") {
        return { TemplateBody: JSON.stringify(template) };
      }
      return {
        StackResourceSummaries: [
          {
            LogicalResourceId: "CellCluster",
            PhysicalResourceId: "cell-sandbox-1",
            ResourceStatus: "CREATE_COMPLETE",
            ResourceType: "AWS::ECS::Cluster",
          },
        ],
        NextToken: "next-resource-page",
      };
    }),
  );

  assert.deepEqual(
    await adapter.getCallerIdentity({ signal: controller.signal }),
    {
      accountId: "402010193138",
      arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
    },
  );
  assert.deepEqual(
    await adapter.describeStack({
      stackNameOrId: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      signal: controller.signal,
    }),
    {
      state: "present",
      stack: {
        stackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
        stackId,
        stackStatus: "REVIEW_IN_PROGRESS",
        roleArn: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
        terminationProtection: false,
        parentId: null,
        rootId: null,
        tags: [
          { Key: "Environment", Value: "aws-sandbox" },
          { Key: "ManagedBy", Value: "techlong-cell-operator" },
          { Key: "CellId", Value: "cell-sandbox-1" },
          { Key: "ExpiresAt", Value: "2026-09-27T18:00:00.000Z" },
        ],
      },
    },
  );
  assert.deepEqual(
    await adapter.getOriginalTemplate({
      stackNameOrId: stackId,
      signal: controller.signal,
    }),
    { state: "present", stackNameOrId: stackId, templateBody: template },
  );
  assert.deepEqual(
    await adapter.listStackResourcesPage({
      stackNameOrId: stackId,
      nextToken: "resource-page-one",
      signal: controller.signal,
    }),
    {
      resources: [
        {
          logicalResourceId: "CellCluster",
          physicalResourceId: "cell-sandbox-1",
          resourceStatus: "CREATE_COMPLETE",
          resourceType: "AWS::ECS::Cluster",
        },
      ],
      nextToken: "next-resource-page",
    },
  );
  assert.deepEqual(
    calls.map((value) => value.input),
    [
      {},
      { StackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME },
      { StackName: stackId, TemplateStage: "Original" },
      { StackName: stackId, NextToken: "resource-page-one" },
    ],
  );
});

test("DescribeChangeSet reads every page and never fabricates reviewed metadata", async () => {
  const calls: FakeCommandValue[] = [];
  const signal = new AbortController().signal;
  const adapter = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async (value, options) => {
      assert.equal(options?.abortSignal, signal);
      calls.push(value);
      return value.input.NextToken === undefined
        ? changeSetPage(
            [
              {
                Type: "Resource",
                ResourceChange: {
                  Action: "Add",
                  LogicalResourceId: "CellVpc",
                  ResourceType: "AWS::EC2::VPC",
                  Details: [{ providerOnly: true }],
                },
              },
            ],
            "page-two",
          )
        : changeSetPage([
            {
              Type: "Resource",
              ResourceChange: {
                Action: "Add",
                LogicalResourceId: "CellCluster",
                ResourceType: "AWS::ECS::Cluster",
              },
            },
          ]);
    }),
  );

  assert.deepEqual(
    await adapter.describeChangeSet({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    {
      state: "present",
      changeSet: {
        changeSetName,
        changeSetArn,
        stackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
        stackId,
        description: "provider description",
        status: "CREATE_COMPLETE",
        executionStatus: "AVAILABLE",
        capabilities: [],
        includeNestedStacks: false,
        parameters: [
          {
            ParameterKey: "AvailabilityZoneA",
            ParameterValue: "ca-central-1a",
          },
        ],
        tags: [{ Key: "Environment", Value: "aws-sandbox" }],
        notificationArns: [],
        parentChangeSetId: null,
        rootChangeSetId: null,
        onStackFailure: "DELETE",
        importExistingResources: false,
        changes: [
          {
            type: "Resource",
            action: "Add",
            logicalResourceId: "CellVpc",
            resourceType: "AWS::EC2::VPC",
          },
          {
            type: "Resource",
            action: "Add",
            logicalResourceId: "CellCluster",
            resourceType: "AWS::ECS::Cluster",
          },
        ],
      },
    },
  );
  assert.deepEqual(
    calls.map((value) => value.input),
    [
      {
        ChangeSetName: changeSetArn,
        IncludePropertyValues: true,
        StackName: stackId,
      },
      {
        ChangeSetName: changeSetArn,
        IncludePropertyValues: true,
        StackName: stackId,
        NextToken: "page-two",
      },
    ],
  );
});

test("GetTemplate binds the exact Change Set ARN and returns raw Original JSON", async () => {
  const calls: FakeCommandValue[] = [];
  const template = {
    Parameters: { AvailabilityZoneA: { Type: "String" } },
    Resources: { CellVpc: { Type: "AWS::EC2::VPC" } },
  };
  const signal = new AbortController().signal;
  const adapter = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async (value, options) => {
      assert.equal(options?.abortSignal, signal);
      calls.push(value);
      return { TemplateBody: JSON.stringify(template) };
    }),
  );
  assert.deepEqual(
    await adapter.getChangeSetTemplate({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    {
      state: "present",
      changeSetArn,
      stackId,
      templateBody: template,
    },
  );
  assert.deepEqual(calls[0].input, {
    ChangeSetName: changeSetArn,
    StackName: stackId,
    TemplateStage: "Original",
  });
});

test("only exact target-bound provider errors prove missing", async () => {
  const signal = new AbortController().signal;
  const stackMissing = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async () => {
      throw Object.assign(
        new Error(
          `Stack with id ${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME} does not exist`,
        ),
        { name: "ValidationError" },
      );
    }),
  );
  assert.deepEqual(
    await stackMissing.describeStack({
      stackNameOrId: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      signal,
    }),
    {
      state: "missing",
      stackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      proof: "NAME_BOUND_VALIDATION_ERROR",
    },
  );

  const changeSetMissing =
    new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
      region,
      evidenceDependencies(async () => {
        throw new ChangeSetNotFoundException({
          $metadata: { httpStatusCode: 404 },
          message: `ChangeSet [${changeSetArn}] does not exist`,
        });
      }),
    );
  assert.deepEqual(
    await changeSetMissing.describeChangeSet({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    {
      state: "missing",
      changeSetArn,
      proof: "ARN_BOUND_CHANGE_SET_NOT_FOUND",
    },
  );
  assert.deepEqual(
    await changeSetMissing.getChangeSetTemplate({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    {
      state: "missing",
      changeSetArn,
      proof: "ARN_BOUND_CHANGE_SET_NOT_FOUND",
    },
  );

  const ambiguous = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async () => {
      throw new ChangeSetNotFoundException({
        $metadata: { httpStatusCode: 404 },
        message: "ChangeSet does not exist",
      });
    }),
  );
  await assert.rejects(
    ambiguous.describeChangeSet({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    (error: unknown) =>
      error instanceof AwsSdkSharedCellAuthorCompensationAdapterError &&
      error.code === "ChangeSetNotFoundException" &&
      !error.message.includes(changeSetArn),
  );

  const wrongTarget = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async () => {
      throw new ChangeSetNotFoundException({
        $metadata: { httpStatusCode: 404 },
        message: `ChangeSet [${changeSetArn.replace("a".repeat(16), "b".repeat(16))}] does not exist`,
      });
    }),
  );
  await assert.rejects(
    wrongTarget.describeChangeSet({
      changeSetNameOrArn: changeSetArn,
      stackNameOrId: stackId,
      signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "ChangeSetNotFoundException",
  );
});

test("DescribeChangeSet fails closed when safety booleans are absent", async () => {
  for (const missing of ["IncludeNestedStacks", "ImportExistingResources"] as const) {
    const adapter = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
      region,
      evidenceDependencies(async () => {
        const response = changeSetPage([]);
        delete response[missing];
        return response;
      }),
    );
    await assert.rejects(
      adapter.describeChangeSet({
        changeSetNameOrArn: changeSetArn,
        stackNameOrId: stackId,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_AUTHOR_COMPENSATION_SDK_RESPONSE_INVALID",
    );
  }
});

test("narrow mutation adapters send only their exact reviewed envelopes", async () => {
  const calls: FakeCommandValue[] = [];
  const signal = new AbortController().signal;
  const client = {
    async send(value: unknown, options?: { abortSignal?: AbortSignal }) {
      assert.equal(options?.abortSignal, signal);
      calls.push(value as FakeCommandValue);
      if ((value as FakeCommandValue).kind === "GetCallerIdentity") {
        return {
          Account: "402010193138",
          Arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
        };
      }
      return {};
    },
  };
  const deleteChangeSet = new AwsSdkSharedCellAuthorDeleteChangeSetAdapter(
    region,
    {
      clients: { sts: client, cloudFormation: client },
      commands: {
        getCallerIdentity: GetCallerIdentityCommand,
        deleteChangeSet: DeleteChangeSetCommand,
      },
    },
  );
  const deleteStack = new AwsSdkSharedCellAuthorDeleteStackAdapter(region, {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      deleteStack: DeleteStackCommand,
    },
  });

  assert.equal("deleteStack" in deleteChangeSet, false);
  assert.equal("deleteChangeSet" in deleteStack, false);
  await deleteChangeSet.getCallerIdentity({ signal });
  assert.deepEqual(
    await deleteChangeSet.deleteChangeSet({
      request: { ChangeSetName: changeSetArn, StackName: stackId },
      signal,
    }),
    { operation: "delete_change_set_submitted" },
  );
  await deleteStack.getCallerIdentity({ signal });
  assert.deepEqual(
    await deleteStack.deleteStack({
      request: {
        StackName: stackId,
        DeletionMode: "STANDARD",
        ClientRequestToken: deleteToken,
      },
      signal,
    }),
    { operation: "delete_stack_submitted" },
  );
  assert.deepEqual(
    calls.map((value) => ({ kind: value.kind, input: value.input })),
    [
      { kind: "GetCallerIdentity", input: {} },
      {
        kind: "DeleteChangeSet",
        input: { ChangeSetName: changeSetArn, StackName: stackId },
      },
      { kind: "GetCallerIdentity", input: {} },
      {
        kind: "DeleteStack",
        input: {
          StackName: stackId,
          DeletionMode: "STANDARD",
          ClientRequestToken: deleteToken,
        },
      },
    ],
  );
});

test("mutation envelopes reject extras and broadened deletion before AWS", async () => {
  let sends = 0;
  const client = {
    async send() {
      sends += 1;
      return {};
    },
  };
  const deleteChangeSet = new AwsSdkSharedCellAuthorDeleteChangeSetAdapter(
    region,
    {
      clients: { sts: client, cloudFormation: client },
      commands: {
        getCallerIdentity: GetCallerIdentityCommand,
        deleteChangeSet: DeleteChangeSetCommand,
      },
    },
  );
  const deleteStack = new AwsSdkSharedCellAuthorDeleteStackAdapter(region, {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      deleteStack: DeleteStackCommand,
    },
  });
  const signal = new AbortController().signal;
  await assert.rejects(
    deleteChangeSet.deleteChangeSet({
      request: {
        ChangeSetName: changeSetArn,
        StackName: stackId,
        RoleARN: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
      } as never,
      signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_AUTHOR_COMPENSATION_SDK_DELETE_ENVELOPE_INVALID",
  );
  for (const request of [
    {
      StackName: stackId,
      DeletionMode: "FORCE_DELETE_STACK",
      ClientRequestToken: deleteToken,
    },
    {
      StackName: stackId,
      DeletionMode: "STANDARD",
      ClientRequestToken: "manual-delete",
    },
    {
      StackName: stackId,
      DeletionMode: "STANDARD",
      ClientRequestToken: deleteToken,
      RetainResources: ["CellVpc"],
    },
  ]) {
    await assert.rejects(
      deleteStack.deleteStack({ request: request as never, signal }),
      (error: unknown) =>
        error instanceof AwsSdkSharedCellAuthorCompensationAdapterError,
    );
  }
  assert.equal(sends, 0);
});

test("provider errors are sanitized and AbortSignal wins", async () => {
  const throttled = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async () => {
      throw Object.assign(new Error("private endpoint and credentials"), {
        name: "Throttling Exception!",
        $metadata: { httpStatusCode: 429 },
      });
    }),
  );
  await assert.rejects(
    throttled.getCallerIdentity({ signal: new AbortController().signal }),
    (error: unknown) => {
      const value = error as AwsSdkSharedCellAuthorCompensationAdapterError;
      return (
        value.code === "Throttling_Exception_" &&
        value.retryable === true &&
        !value.message.includes("credentials")
      );
    },
  );

  let sends = 0;
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  const aborted = new AwsSdkSharedCellAuthorCompensationEvidenceAdapter(
    region,
    evidenceDependencies(async () => {
      sends += 1;
      return {};
    }),
  );
  await assert.rejects(
    aborted.describeStack({
      stackNameOrId: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      signal: controller.signal,
    }),
    /lease lost/,
  );
  assert.equal(sends, 0);
});

test("dormant runtime shares one lazy MFA provider and isolates read from mutation clients", async () => {
  const configurations: Array<{
    service: string;
    sequence: number;
    value: Record<string, unknown>;
  }> = [];
  const sends: Array<{ service: string; sequence: number }> = [];
  let stsSequence = 0;
  let cloudFormationSequence = 0;
  let providerCalls = 0;
  let providerOptions: Record<string, unknown> | undefined;
  const credentials = async () => ({
    accessKeyId: "test-only",
    secretAccessKey: "test-only",
  });

  function client(service: "sts" | "cloudformation") {
    return class {
      readonly sequence: number;

      constructor(value: Record<string, unknown>) {
        this.sequence =
          service === "sts" ? ++stsSequence : ++cloudFormationSequence;
        configurations.push({ service, sequence: this.sequence, value });
      }

      async send(): Promise<Record<string, unknown>> {
        sends.push({ service, sequence: this.sequence });
        return service === "sts"
          ? {
              Account: "402010193138",
              Arn: SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN,
            }
          : {};
      }
    };
  }

  const runtime = createAwsSdkSharedCellAuthorCompensationRuntimeFromModules(
    {
      sts: {
        STSClient: client("sts"),
        GetCallerIdentityCommand,
      },
      cloudFormation: {
        CloudFormationClient: client("cloudformation"),
        DescribeStacksCommand,
        GetTemplateCommand,
        ListStackResourcesCommand,
        DescribeChangeSetCommand,
        DeleteChangeSetCommand,
        DeleteStackCommand,
      },
      credentialProvider: {
        defaultProvider(options: Record<string, unknown>) {
          providerCalls += 1;
          providerOptions = options;
          return credentials;
        },
      },
    },
    { mfaCodeProvider: async () => "123456" },
  );

  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(providerCalls, 1);
  assert.deepEqual(sends, []);
  assert.ok(
    runtime.evidence instanceof AwsSdkSharedCellAuthorCompensationEvidenceAdapter,
  );
  assert.ok(
    runtime.deleteChangeSetMutations instanceof
      AwsSdkSharedCellAuthorDeleteChangeSetAdapter,
  );
  assert.ok(
    runtime.deleteStackMutations instanceof AwsSdkSharedCellAuthorDeleteStackAdapter,
  );
  assert.equal("deleteStack" in runtime.deleteChangeSetMutations, false);
  assert.equal("deleteChangeSet" in runtime.deleteStackMutations, false);
  assert.equal(configurations.length, 4);
  assert.deepEqual(
    configurations.map(({ service, sequence }) => ({ service, sequence })),
    [
      { service: "sts", sequence: 1 },
      { service: "cloudformation", sequence: 1 },
      { service: "sts", sequence: 2 },
      { service: "cloudformation", sequence: 2 },
    ],
  );
  for (const configuration of configurations) {
    assert.equal(configuration.value.region, region);
    assert.equal(configuration.value.credentials, credentials);
    assert.equal(configuration.value.ignoreConfiguredEndpointUrls, true);
    assert.equal(
      configuration.value.maxAttempts,
      configuration.sequence === 1 ? undefined : 1,
    );
  }
  assert.equal(providerOptions?.profile, "techlong-sandbox-cell-operator");
  assert.deepEqual(providerOptions?.clientConfig, {
    region,
    ignoreConfiguredEndpointUrls: true,
  });
  const checkedMfa = providerOptions?.mfaCodeProvider as (
    serial: string,
  ) => Promise<string>;
  assert.equal(
    await checkedMfa(
      "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
    ),
    "123456",
  );
  await assert.rejects(checkedMfa("arn:aws:iam::402010193138:mfa/foreign"));

  const signal = new AbortController().signal;
  await runtime.evidence.getCallerIdentity({ signal });
  await runtime.deleteChangeSetMutations.getCallerIdentity({ signal });
  await runtime.deleteStackMutations.getCallerIdentity({ signal });
  assert.deepEqual(sends, [
    { service: "sts", sequence: 1 },
    { service: "sts", sequence: 2 },
    { service: "sts", sequence: 2 },
  ]);
});

test("installed dormant runtime construction performs no AWS request", async () => {
  const runtime = await createAwsSdkSharedCellAuthorCompensationRuntime({
    mfaCodeProvider: async () => "123456",
  });
  assert.equal(Object.isFrozen(runtime), true);
  assert.ok(
    runtime.evidence instanceof AwsSdkSharedCellAuthorCompensationEvidenceAdapter,
  );
  assert.ok(
    runtime.deleteChangeSetMutations instanceof
      AwsSdkSharedCellAuthorDeleteChangeSetAdapter,
  );
  assert.ok(
    runtime.deleteStackMutations instanceof AwsSdkSharedCellAuthorDeleteStackAdapter,
  );
});
