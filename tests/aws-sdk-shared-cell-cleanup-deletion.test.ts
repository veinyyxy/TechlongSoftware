import assert from "node:assert/strict";
import test from "node:test";
import {
  AwsSdkSharedCellCleanupAdapterError,
  AwsSdkSharedCellCleanupDeleteStackAdapter,
  AwsSdkSharedCellCleanupEvidenceAdapter,
  createAwsSdkSharedCellCleanupDeletionRuntime,
  createAwsSdkSharedCellCleanupDeletionRuntimeFromModules,
  SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES,
  type AwsSdkSharedCellCleanupEvidenceDependencies,
  type SharedCellCleanupZeroTenantOwnershipReadPort,
} from "../lib/deployments/execution/aws-sdk-shared-cell-cleanup-deletion.ts";
import {
  SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
  SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
} from "../lib/deployments/execution/shared-cell-cleanup-deletion.ts";

const region = "ca-central-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${SHARED_CELL_CLEANUP_DELETION_STACK_NAME}/12345678-1234-1234-1234-123456789012`;
const clientRequestToken = `cell-delete-${"a".repeat(64)}`;

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
const ListStacksCommand = command("ListStacks");
const DescribeStacksCommand = command("DescribeStacks");
const GetTemplateCommand = command("GetTemplate");
const ListStackResourcesCommand = command("ListStackResources");
const DeleteStackCommand = command("DeleteStack");

function stack() {
  return {
    StackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
    StackId: stackId,
    StackStatus: "CREATE_COMPLETE",
    RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    EnableTerminationProtection: false,
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-cell-operator" },
      { Key: "CellId", Value: "cell-sandbox-1" },
      { Key: "ExpiresAt", Value: "2026-09-07T11:59:00.000Z" },
    ],
  };
}

function zeroTenantReader(
  reads: AbortSignal[] = [],
): SharedCellCleanupZeroTenantOwnershipReadPort {
  return {
    async readStrongZeroTenantOwnershipSnapshot({ signal }) {
      reads.push(signal);
      return { proof: "injected-strong-read" };
    },
  };
}

function evidenceDependencies(input: {
  send: (
    command: FakeCommandValue,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<Record<string, unknown>>;
  zeroTenant?: SharedCellCleanupZeroTenantOwnershipReadPort;
}): AwsSdkSharedCellCleanupEvidenceDependencies {
  const client = { send: input.send as AwsSdkSharedCellCleanupEvidenceDependencies["clients"]["sts"]["send"] };
  return {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      listStacks: ListStacksCommand,
      describeStacks: DescribeStacksCommand,
      getTemplate: GetTemplateCommand,
      listStackResources: ListStackResourcesCommand,
    },
    zeroTenantOwnership: input.zeroTenant ?? zeroTenantReader(),
  };
}

test("STS caller read sends an empty command and propagates AbortSignal", async () => {
  const calls: FakeCommandValue[] = [];
  const controller = new AbortController();
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async (value, options) => {
        assert.equal(options?.abortSignal, controller.signal);
        calls.push(value);
        return {
          Account: "402010193138",
          Arn:
            "arn:aws:sts::402010193138:assumed-role/" +
            "TechlongSandboxCellJanitorExecutionRole/cell-janitor",
        };
      },
    }),
  );
  assert.deepEqual(
    await adapter.getCallerIdentity({ signal: controller.signal }),
    {
      accountId: "402010193138",
      arn:
        "arn:aws:sts::402010193138:assumed-role/" +
        "TechlongSandboxCellJanitorExecutionRole/cell-janitor",
    },
  );
  assert.equal(calls[0].kind, "GetCallerIdentity");
  assert.deepEqual(calls[0].input, {});
});

test("ListStacks requests every live status, paginates, and rejects historical output", async () => {
  const calls: FakeCommandValue[] = [];
  const controller = new AbortController();
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async (value, options) => {
        assert.equal(options?.abortSignal, controller.signal);
        calls.push(value);
        return {
          StackSummaries: [
            {
              StackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
              StackStatus: "CREATE_COMPLETE",
            },
          ],
          NextToken: "page-two",
        };
      },
    }),
  );

  const result = await adapter.listStackNamesPage({
    nextToken: "page-one",
    signal: controller.signal,
  });
  assert.deepEqual(result, {
    stackNames: [SHARED_CELL_CLEANUP_DELETION_STACK_NAME],
    nextToken: "page-two",
  });
  assert.deepEqual(calls[0].input, {
    StackStatusFilter: [...SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES],
    NextToken: "page-one",
  });
  assert.equal(SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES.length, 22);
  assert.equal(
    SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES.some(
      (status: string) => status === "DELETE_COMPLETE",
    ),
    false,
  );

  const historical = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async () => ({
        StackSummaries: [
          {
            StackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
            StackStatus: "DELETE_COMPLETE",
          },
        ],
      }),
    }),
  );
  await assert.rejects(
    historical.listStackNamesPage({
      nextToken: null,
      signal: controller.signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_SDK_RESPONSE_INVALID",
  );
});

test("DescribeStacks normalizes the exact Stack and only name-bound missing is proof", async () => {
  const calls: FakeCommandValue[] = [];
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async (value) => {
        calls.push(value);
        return { Stacks: [stack()] };
      },
    }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(
    await adapter.describeCellStack({
      stackNameOrId: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      signal,
    }),
    {
      state: "present",
      stack: {
        stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
        stackId,
        stackStatus: "CREATE_COMPLETE",
        roleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
        terminationProtection: false,
        parentId: null,
        rootId: null,
        tags: {
          Environment: "aws-sandbox",
          ManagedBy: "techlong-cell-operator",
          CellId: "cell-sandbox-1",
          ExpiresAt: "2026-09-07T11:59:00.000Z",
        },
      },
    },
  );
  assert.deepEqual(calls[0].input, {
    StackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
  });

  const missingError = () =>
    Object.assign(
      new Error(
        `Stack with id ${SHARED_CELL_CLEANUP_DELETION_STACK_NAME} does not exist`,
      ),
      { name: "ValidationError" },
    );
  const missing = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({ send: async () => Promise.reject(missingError()) }),
  );
  assert.deepEqual(
    await missing.describeCellStack({
      stackNameOrId: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      signal,
    }),
    {
      state: "missing",
      stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      proof: "NAME_BOUND_VALIDATION_ERROR",
    },
  );
  await assert.rejects(
    missing.describeCellStack({ stackNameOrId: stackId, signal }),
    (error: unknown) =>
      error instanceof AwsSdkSharedCellCleanupAdapterError &&
      error.code === "ValidationError" &&
      !error.message.includes(SHARED_CELL_CLEANUP_DELETION_STACK_NAME),
  );

  const ambiguous = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async () =>
        Promise.reject(
          Object.assign(new Error("Stack does not exist"), {
            name: "ValidationError",
          }),
        ),
    }),
  );
  await assert.rejects(
    ambiguous.describeCellStack({
      stackNameOrId: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "ValidationError",
  );
});

test("Original template and resource pages use the exact StackId and propagate AbortSignal", async () => {
  const calls: FakeCommandValue[] = [];
  const signals: AbortSignal[] = [];
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Resources: { CellCluster: { Type: "AWS::ECS::Cluster" } },
  };
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async (value, options) => {
        calls.push(value);
        if (options?.abortSignal) signals.push(options.abortSignal);
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
          NextToken: "resource-page-two",
        };
      },
    }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await adapter.getOriginalTemplate({ stackId, signal }), template);
  assert.deepEqual(
    await adapter.listStackResourcesPage({
      stackId,
      nextToken: "resource-page-one",
      signal,
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
      nextToken: "resource-page-two",
    },
  );
  assert.deepEqual(calls.map((value) => value.input), [
    { StackName: stackId, TemplateStage: "Original" },
    { StackName: stackId, NextToken: "resource-page-one" },
  ]);
  assert.deepEqual(signals, [signal, signal]);
});

test("the strong zero-tenant source remains a separate injected read capability", async () => {
  const reads: AbortSignal[] = [];
  const signal = new AbortController().signal;
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async () => assert.fail("zero-tenant read must not call AWS clients here"),
      zeroTenant: zeroTenantReader(reads),
    }),
  );
  assert.deepEqual(
    await adapter.readStrongZeroTenantOwnershipSnapshot({ signal }),
    { proof: "injected-strong-read" },
  );
  assert.deepEqual(reads, [signal]);
  assert.equal(
    "compareAndSet" in
      (adapter as unknown as Record<string, unknown>),
    false,
  );
});

test("DeleteStack sends one exact STANDARD request with no RetainResources", async () => {
  const calls: FakeCommandValue[] = [];
  const controller = new AbortController();
  const adapter = new AwsSdkSharedCellCleanupDeleteStackAdapter({
    client: {
      async send(value, options) {
        assert.equal(options?.abortSignal, controller.signal);
        calls.push(value as FakeCommandValue);
        return {};
      },
    },
    deleteStack: DeleteStackCommand,
  });
  assert.deepEqual(
    await adapter.deleteStack({
      request: {
        StackName: stackId,
        RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
        ClientRequestToken: clientRequestToken,
        DeletionMode: "STANDARD",
      },
      signal: controller.signal,
    }),
    { operation: "delete_submitted" },
  );
  assert.deepEqual(calls[0].input, {
    StackName: stackId,
    RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    ClientRequestToken: clientRequestToken,
    DeletionMode: "STANDARD",
  });
  assert.equal(Object.hasOwn(calls[0].input, "RetainResources"), false);
});

test("DeleteStack rejects IDs, roles, tokens, modes and extra fields before AWS", async (t) => {
  let sends = 0;
  const adapter = new AwsSdkSharedCellCleanupDeleteStackAdapter({
    client: {
      async send() {
        sends += 1;
        return {};
      },
    },
    deleteStack: DeleteStackCommand,
  });
  const valid = {
    StackName: stackId,
    RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    ClientRequestToken: clientRequestToken,
    DeletionMode: "STANDARD" as const,
  };
  for (const [name, request] of [
    ["name instead of ID", { ...valid, StackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME }],
    ["foreign role", { ...valid, RoleARN: "arn:aws:iam::402010193138:role/foreign" }],
    ["unstable token", { ...valid, ClientRequestToken: "manual-delete" }],
    ["invalid token characters", { ...valid, ClientRequestToken: `${"a".repeat(128)}!` }],
    ["force mode", { ...valid, DeletionMode: "FORCE_DELETE_STACK" }],
    ["retain resources", { ...valid, RetainResources: ["CellCluster"] }],
  ] as const) {
    await t.test(name, async () => {
      await assert.rejects(
        adapter.deleteStack({
          request: request as unknown as Parameters<
            AwsSdkSharedCellCleanupDeleteStackAdapter["deleteStack"]
          >[0]["request"],
          signal: new AbortController().signal,
        }),
        (error: unknown) =>
          error instanceof AwsSdkSharedCellCleanupAdapterError,
      );
    });
  }
  assert.equal(sends, 0);
});

test("provider errors are sanitized, classified, and abort wins", async () => {
  const retrying = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async () =>
        Promise.reject(
          Object.assign(new Error("secret provider endpoint and credential"), {
            name: "ThrottlingException:<private>",
            $metadata: { httpStatusCode: 429 },
          }),
        ),
    }),
  );
  await assert.rejects(
    retrying.getCallerIdentity({ signal: new AbortController().signal }),
    (error: unknown) => {
      const value = error as AwsSdkSharedCellCleanupAdapterError;
      assert.equal(value.retryable, true);
      assert.equal(value.code, "ThrottlingException__private_");
      assert.equal(value.message.includes("credential"), false);
      return true;
    },
  );

  let sends = 0;
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(new Error("lease lost"));
  const adapter = new AwsSdkSharedCellCleanupEvidenceAdapter(
    region,
    evidenceDependencies({
      send: async () => {
        sends += 1;
        return {};
      },
    }),
  );
  await assert.rejects(
    adapter.listStackNamesPage({
      nextToken: null,
      signal: alreadyAborted.signal,
    }),
    /lease lost/,
  );
  assert.equal(sends, 0);

  const duringCall = new AbortController();
  const aborting = new AwsSdkSharedCellCleanupDeleteStackAdapter({
    client: {
      async send() {
        duringCall.abort(new Error("authority lease lost"));
        throw new Error("provider detail");
      },
    },
    deleteStack: DeleteStackCommand,
  });
  await assert.rejects(
    aborting.deleteStack({
      request: {
        StackName: stackId,
        RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
        ClientRequestToken: clientRequestToken,
        DeletionMode: "STANDARD",
      },
      signal: duringCall.signal,
    }),
    /authority lease lost/,
  );
});

test("dormant production construction shares one lazy provider and makes no AWS call", async () => {
  const configurations: Array<{ name: string; value: Record<string, unknown> }> = [];
  const sends: string[] = [];
  let providerCalls = 0;
  let providerOptions: Record<string, unknown> | undefined;
  const credentials = async () => ({
    accessKeyId: "test-only",
    secretAccessKey: "test-only",
  });

  function client(name: string) {
    return class {
      constructor(value: Record<string, unknown>) {
        configurations.push({ name, value });
      }
      async send(): Promise<Record<string, unknown>> {
        sends.push(name);
        return {};
      }
    };
  }

  const runtime = createAwsSdkSharedCellCleanupDeletionRuntimeFromModules(
    {
      sts: {
        STSClient: client("sts"),
        GetCallerIdentityCommand,
      },
      cloudFormation: {
        CloudFormationClient: client("cloudformation"),
        ListStacksCommand,
        DescribeStacksCommand,
        GetTemplateCommand,
        ListStackResourcesCommand,
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
    { zeroTenantOwnership: zeroTenantReader() },
  );
  assert.equal(Object.isFrozen(runtime), true);
  assert.ok(runtime.evidence instanceof AwsSdkSharedCellCleanupEvidenceAdapter);
  assert.ok(runtime.deleter instanceof AwsSdkSharedCellCleanupDeleteStackAdapter);
  assert.equal("deleteStack" in runtime.evidence, false);
  assert.equal("getCallerIdentity" in runtime.deleter, false);
  assert.equal(providerCalls, 1);
  assert.equal(sends.length, 0);
  assert.deepEqual(providerOptions, {
    clientConfig: {
      region,
      ignoreConfiguredEndpointUrls: true,
    },
  });
  assert.deepEqual(
    configurations.map(({ name }) => name),
    ["sts", "cloudformation"],
  );
  for (const { value } of configurations) {
    assert.deepEqual(value, {
      region,
      ignoreConfiguredEndpointUrls: true,
      credentials,
    });
  }

  const installed = await createAwsSdkSharedCellCleanupDeletionRuntime({
    zeroTenantOwnership: zeroTenantReader(),
  });
  assert.equal(Object.isFrozen(installed), true);
  assert.ok(installed.evidence instanceof AwsSdkSharedCellCleanupEvidenceAdapter);
  assert.ok(installed.deleter instanceof AwsSdkSharedCellCleanupDeleteStackAdapter);
});
