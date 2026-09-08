import assert from "node:assert/strict";
import test from "node:test";

import {
  AwsSdkSharedCellCleanupStackEvidenceAdapter,
  createAwsSdkSharedCellCleanupStackEvidenceAdapter,
  createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules,
  type AwsSdkSharedCellCleanupStackEvidenceDependencies,
  type AwsSdkSharedCellCleanupStackEvidenceRuntimeModules,
} from "../lib/deployments/execution/aws-sdk-shared-cell-cleanup-stack-evidence.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellProvisionAuthorityRecord,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import {
  SHARED_CELL_ZERO_TENANT_SOURCE_WIRING_BLOCKER,
  SerializableSharedCellZeroTenantEvidenceAdapter,
  type ReadSerializableSharedCellOwnershipSnapshotInput,
  type SerializableSharedCellOwnershipSnapshot,
  type SerializableSharedCellOwnershipSnapshotSource,
} from "../lib/deployments/execution/shared-cell-zero-tenant-evidence.ts";

const now = Date.parse("2026-09-07T18:00:00.000Z");
const accountId = "402010193138" as const;
const region = "ca-central-1" as const;
const stackName = "techlong-sandbox-cell-sandbox-1" as const;
const stackId =
  `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/` +
  "12345678-1234-1234-1234-123456789012";
const cellRoleArn =
  `arn:aws:iam::${accountId}:role/` +
  "TechlongSandboxCellCloudFormationExecutionRole";
const operatorArn =
  `arn:aws:sts::${accountId}:assumed-role/` +
  "TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator";
const expiresAt = new Date(now - 60_000).toISOString();
const template = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: {
    CellLogGroup: { Type: "AWS::Logs::LogGroup" },
    CellSchedule: { Type: "AWS::Scheduler::Schedule" },
  },
};
const inventory = [
  {
    logicalResourceId: "CellLogGroup",
    physicalResourceId: "physical-CellLogGroup",
    resourceStatus: "CREATE_COMPLETE" as const,
    resourceType: "AWS::Logs::LogGroup",
  },
  {
    logicalResourceId: "CellSchedule",
    physicalResourceId: "physical-CellSchedule",
    resourceStatus: "CREATE_COMPLETE" as const,
    resourceType: "AWS::Scheduler::Schedule",
  },
];

async function predecessor(
  override: Partial<SharedCellProvisionAuthorityRecord> = {},
): Promise<SharedCellProvisionAuthorityRecord> {
  const operationSource = {
    schemaVersion: 1 as const,
    accountId,
    region,
    cellId: "cell-sandbox-1" as const,
    stackName,
    stackId,
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt: expiresAt,
    templateCanonicalSha256: await sha256Hex(template),
    resourceInventorySha256: await sha256Hex(inventory),
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const provisionOperationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(operationSource),
  );
  const unsigned = {
    ...operationSource,
    provisionOperationHash,
    revision: 1,
    state: "provision_verified" as const,
    ...override,
  };
  return {
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  } as SharedCellProvisionAuthorityRecord;
}

function command(kind: string) {
  return class {
    readonly kind = kind;
    readonly input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

interface AwsCall {
  kind: string;
  input: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

interface AwsFixtureOverrides {
  callerArn?: string;
  firstStack?: Record<string, unknown>;
  finalStack?: Record<string, unknown>;
  template?: unknown;
  summaries?: Record<string, unknown>[];
  repeatToken?: boolean;
  providerError?: Error & { $metadata?: { httpStatusCode: number } };
  clock?: number[];
}

function awsFixture(
  lineage: SharedCellProvisionAuthorityRecord,
  override: AwsFixtureOverrides = {},
) {
  const tags = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: "cell-sandbox-1",
    ExpiresAt: lineage.cellExpiresAt,
  };
  const baseStack: Record<string, unknown> = {
    StackId: lineage.stackId,
    StackName: stackName,
    StackStatus: lineage.stackStatus,
    RoleARN: cellRoleArn,
    EnableTerminationProtection: false,
    CreationTime: new Date(now - 7_200_000),
    LastUpdatedTime: new Date(now - 3_600_000),
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  };
  const summaries =
    override.summaries ??
    inventory.map((item) => ({
      LogicalResourceId: item.logicalResourceId,
      PhysicalResourceId: item.physicalResourceId,
      ResourceStatus: item.resourceStatus,
      ResourceType: item.resourceType,
    }));
  const calls: AwsCall[] = [];
  let describeCount = 0;
  const clock = [...(override.clock ?? [now, now + 1_000])];
  const client = {
    send: async (
      rawCommand: unknown,
      options?: { abortSignal?: AbortSignal },
    ): Promise<Record<string, unknown>> => {
      const value = rawCommand as {
        kind: string;
        input: Record<string, unknown>;
      };
      calls.push({ kind: value.kind, input: value.input, signal: options?.abortSignal });
      if (override.providerError) throw override.providerError;
      switch (value.kind) {
        case "GetCallerIdentity":
          return { Account: accountId, Arn: override.callerArn ?? operatorArn };
        case "DescribeStacks": {
          describeCount += 1;
          const selected =
            describeCount === 1 ? override.firstStack : override.finalStack;
          return { Stacks: [{ ...baseStack, ...selected }] };
        }
        case "GetTemplate":
          return { TemplateBody: override.template ?? template };
        case "ListStackResources": {
          if (value.input.NextToken === undefined) {
            return {
              StackResourceSummaries: summaries.slice(0, 1),
              NextToken: "page-two",
            };
          }
          return {
            StackResourceSummaries: summaries.slice(1),
            ...(override.repeatToken ? { NextToken: "page-two" } : {}),
          };
        }
        default:
          throw new Error(`unexpected command ${value.kind}`);
      }
    },
  };
  const dependencies: AwsSdkSharedCellCleanupStackEvidenceDependencies = {
    clients: { sts: client, cloudFormation: client },
    commands: {
      getCallerIdentity: command("GetCallerIdentity"),
      describeStacks: command("DescribeStacks"),
      getTemplate: command("GetTemplate"),
      listStackResources: command("ListStackResources"),
    },
    now: () => {
      const value = clock.shift();
      if (value === undefined) throw new Error("clock exhausted");
      return value;
    },
  };
  return { calls, dependencies };
}

test("cleanup Stack adapter performs a stable Original-template and complete-inventory read", async () => {
  const lineage = await predecessor();
  const fixture = awsFixture(lineage);
  const adapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
    region,
    fixture.dependencies,
  );
  assert.equal(fixture.calls.length, 0, "construction must not call AWS");

  const controller = new AbortController();
  const evidence = await adapter.readVerifiedCleanupStackEvidence({
    predecessor: lineage,
    signal: controller.signal,
  });
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    verified: true,
    observedAt: now + 1_000,
    accountId,
    region,
    cellId: "cell-sandbox-1",
    stackName,
    stackId,
    stackStatus: "CREATE_COMPLETE",
    cellExpiresAt: expiresAt,
    templateCanonicalSha256: lineage.templateCanonicalSha256,
    resourceInventorySha256: lineage.resourceInventorySha256,
    cloudFormationRoleArn: cellRoleArn,
  });
  assert.deepEqual(
    fixture.calls.map((call) => call.kind),
    [
      "GetCallerIdentity",
      "DescribeStacks",
      "GetTemplate",
      "ListStackResources",
      "ListStackResources",
      "DescribeStacks",
    ],
  );
  assert.deepEqual(fixture.calls[1].input, { StackName: stackName });
  assert.deepEqual(fixture.calls[2].input, {
    StackName: stackId,
    TemplateStage: "Original",
  });
  assert.deepEqual(fixture.calls[3].input, { StackName: stackId });
  assert.deepEqual(fixture.calls[4].input, {
    StackName: stackId,
    NextToken: "page-two",
  });
  assert.deepEqual(fixture.calls[5].input, { StackName: stackId });
  assert(fixture.calls.every((call) => call.signal === controller.signal));
  assert(Object.isFrozen(evidence));
});

test("production cleanup Stack construction shares one lazy credential provider and sends nothing", async () => {
  const configurations: Array<{
    name: string;
    value: Record<string, unknown>;
  }> = [];
  const sends: string[] = [];
  let providerCalls = 0;
  let credentialResolutions = 0;
  let credentialOptions: Record<string, unknown> | undefined;
  let mfaPrompts = 0;
  let mfaCode = "123456";
  const credentials = async () => {
    credentialResolutions += 1;
    return {
      accessKeyId: "test-only",
      secretAccessKey: "test-only",
    };
  };

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

  class FakeCommand {
    readonly input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  const modules: AwsSdkSharedCellCleanupStackEvidenceRuntimeModules = {
    sts: {
      STSClient: client("sts"),
      GetCallerIdentityCommand: FakeCommand,
    },
    cloudFormation: {
      CloudFormationClient: client("cloudformation"),
      DescribeStacksCommand: FakeCommand,
      GetTemplateCommand: FakeCommand,
      ListStackResourcesCommand: FakeCommand,
    },
    credentialProvider: {
      defaultProvider(options: Record<string, unknown>) {
        providerCalls += 1;
        credentialOptions = options;
        return credentials;
      },
    },
  };
  const adapter =
    createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules(modules, {
      mfaCodeProvider: async (serial) => {
        mfaPrompts += 1;
        assert.equal(
          serial,
          "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
        );
        return mfaCode;
      },
    });

  assert(adapter instanceof AwsSdkSharedCellCleanupStackEvidenceAdapter);
  assert.equal(providerCalls, 1);
  assert.equal(credentialResolutions, 0);
  assert.equal(mfaPrompts, 0);
  assert.equal(sends.length, 0);
  assert.deepEqual(
    configurations.map(({ name }) => name),
    ["sts", "cloudformation"],
  );
  for (const { value } of configurations) {
    assert.deepEqual(value, {
      region,
      credentials,
      ignoreConfiguredEndpointUrls: true,
    });
  }
  assert.equal(credentialOptions?.profile, "techlong-sandbox-cell-operator");
  assert.deepEqual(credentialOptions?.clientConfig, {
    region,
    ignoreConfiguredEndpointUrls: true,
  });
  assert.equal(typeof credentialOptions?.mfaCodeProvider, "function");
  const checkedMfa = credentialOptions?.mfaCodeProvider as (
    serial: string,
  ) => Promise<string>;
  assert.equal(
    await checkedMfa(
      "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
    ),
    "123456",
  );
  assert.equal(mfaPrompts, 1);
  mfaCode = "12A456";
  await assert.rejects(
    checkedMfa("arn:aws:iam::402010193138:mfa/techlong-sandbox-dev"),
    /MFA code is invalid/,
  );
  assert.equal(mfaPrompts, 2);
  await assert.rejects(
    checkedMfa("arn:aws:iam::402010193138:mfa/unreviewed-device"),
    /outside the allowlist/,
  );
  assert.equal(mfaPrompts, 2);
});

test("production cleanup Stack construction validates input before provider use", () => {
  let providerCalls = 0;
  assert.throws(
    () =>
      createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules(
        {
          sts: {},
          cloudFormation: {},
          credentialProvider: {
            defaultProvider() {
              providerCalls += 1;
              return async () => ({});
            },
          },
        },
        {
          mfaCodeProvider: async () => "123456",
          unexpected: true,
        } as unknown as { mfaCodeProvider: () => Promise<string> },
      ),
    /MFA provider input is invalid/,
  );
  assert.equal(providerCalls, 0);
});

test("factory-created cleanup Stack adapter still rejects a non-Operator runtime identity", async () => {
  const lineage = await predecessor();
  const sends: string[] = [];
  class FakeCommand {
    readonly kind: string;
    readonly input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.kind = "command";
      this.input = input;
    }
  }
  class STSClient {
    constructor(configuration: Record<string, unknown>) {
      assert.equal(configuration.region, region);
    }

    async send(): Promise<Record<string, unknown>> {
      sends.push("sts");
      return {
        Account: accountId,
        Arn:
          `arn:aws:sts::${accountId}:assumed-role/` +
          "TechlongSandboxProvisionerRole/techlong-sandbox-provisioner",
      };
    }
  }
  class CloudFormationClient {
    constructor(configuration: Record<string, unknown>) {
      assert.equal(configuration.region, region);
    }

    async send(): Promise<Record<string, unknown>> {
      sends.push("cloudformation");
      return {};
    }
  }
  const adapter =
    createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules(
      {
        sts: { STSClient, GetCallerIdentityCommand: FakeCommand },
        cloudFormation: {
          CloudFormationClient,
          DescribeStacksCommand: FakeCommand,
          GetTemplateCommand: FakeCommand,
          ListStackResourcesCommand: FakeCommand,
        },
        credentialProvider: {
          defaultProvider() {
            return async () => ({});
          },
        },
      },
      { mfaCodeProvider: async () => "123456" },
    );
  assert.equal(sends.length, 0);
  await assert.rejects(
    adapter.readVerifiedCleanupStackEvidence({
      predecessor: lineage,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_STACK_CALLER_INVALID",
  );
  assert.deepEqual(sends, ["sts"]);
});

test("installed AWS SDK modules construct the dormant cleanup Stack collector", async () => {
  let mfaPrompts = 0;
  const adapter = await createAwsSdkSharedCellCleanupStackEvidenceAdapter({
    mfaCodeProvider: async () => {
      mfaPrompts += 1;
      return "123456";
    },
  });
  assert(adapter instanceof AwsSdkSharedCellCleanupStackEvidenceAdapter);
  assert.equal(mfaPrompts, 0);
});

test("cleanup Stack adapter is exact-region and exact human Cell Operator only", async () => {
  const lineage = await predecessor();
  const valid = awsFixture(lineage);
  assert.throws(
    () =>
      new AwsSdkSharedCellCleanupStackEvidenceAdapter(
        "us-east-1",
        valid.dependencies,
      ),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_STACK_REGION_INVALID",
  );
  for (const callerArn of [
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner`,
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxCellJanitorExecutionRole/janitor`,
    `arn:aws:sts::${accountId}:assumed-role/TechlongSandboxCellOperatorRole/wrong-session`,
  ]) {
    const fixture = awsFixture(lineage, { callerArn });
    const adapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
      region,
      fixture.dependencies,
    );
    await assert.rejects(
      adapter.readVerifiedCleanupStackEvidence({
        predecessor: lineage,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_STACK_CALLER_INVALID",
    );
    assert.equal(fixture.calls.length, 1);
  }
});

test("cleanup Stack adapter rejects exact role, tag and between-read drift", async () => {
  const lineage = await predecessor();
  const cases: AwsFixtureOverrides[] = [
    {
      firstStack: {
        RoleARN:
          `arn:aws:iam::${accountId}:role/TechlongSandboxCloudFormationExecutionRole`,
      },
    },
    {
      firstStack: {
        Tags: [
          { Key: "Environment", Value: "aws-sandbox" },
          { Key: "ManagedBy", Value: "techlong-cell-operator" },
          { Key: "CellId", Value: "cell-sandbox-1" },
          { Key: "ExpiresAt", Value: expiresAt },
          { Key: "Unreviewed", Value: "true" },
        ],
      },
    },
    { finalStack: { LastUpdatedTime: new Date(now - 1_000) } },
  ];
  for (const selected of cases) {
    const fixture = awsFixture(lineage, selected);
    const adapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
      region,
      fixture.dependencies,
    );
    await assert.rejects(
      adapter.readVerifiedCleanupStackEvidence({
        predecessor: lineage,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        [
          "SHARED_CELL_CLEANUP_STACK_DRIFT",
          "SHARED_CELL_CLEANUP_STACK_CHANGED",
        ].includes((error as { code?: string }).code ?? ""),
    );
  }
});

test("cleanup Stack adapter rejects template, inventory and pagination drift", async () => {
  const lineage = await predecessor();
  const cases: Array<{
    override: AwsFixtureOverrides;
    code: string;
  }> = [
    {
      override: {
        template: {
          ...template,
          Description: "not the provisioned template",
        },
      },
      code: "SHARED_CELL_CLEANUP_STACK_TEMPLATE_MISMATCH",
    },
    {
      override: {
        summaries: [
          {
            LogicalResourceId: "CellLogGroup",
            PhysicalResourceId: "replacement-log-group",
            ResourceStatus: "CREATE_COMPLETE",
            ResourceType: "AWS::Logs::LogGroup",
          },
          {
            LogicalResourceId: "CellSchedule",
            PhysicalResourceId: "physical-CellSchedule",
            ResourceStatus: "CREATE_COMPLETE",
            ResourceType: "AWS::Scheduler::Schedule",
          },
        ],
      },
      code: "SHARED_CELL_CLEANUP_STACK_INVENTORY_MISMATCH",
    },
    {
      override: { repeatToken: true },
      code: "SHARED_CELL_CLEANUP_STACK_PAGINATION_INVALID",
    },
  ];
  for (const selected of cases) {
    const fixture = awsFixture(lineage, selected.override);
    const adapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
      region,
      fixture.dependencies,
    );
    await assert.rejects(
      adapter.readVerifiedCleanupStackEvidence({
        predecessor: lineage,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === selected.code,
    );
  }
});

test("cleanup Stack adapter propagates abort and classifies retryable provider errors", async () => {
  const lineage = await predecessor();
  const providerError = Object.assign(new Error("throttled"), {
    name: "ThrottlingException",
    $metadata: { httpStatusCode: 429 },
  });
  const fixture = awsFixture(lineage, { providerError });
  const adapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
    region,
    fixture.dependencies,
  );
  await assert.rejects(
    adapter.readVerifiedCleanupStackEvidence({
      predecessor: lineage,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "ThrottlingException" &&
      (error as { retryable?: boolean }).retryable === true,
  );

  const controller = new AbortController();
  controller.abort(new Error("review cancelled"));
  const abortedFixture = awsFixture(lineage);
  const abortedAdapter = new AwsSdkSharedCellCleanupStackEvidenceAdapter(
    region,
    abortedFixture.dependencies,
  );
  await assert.rejects(
    abortedAdapter.readVerifiedCleanupStackEvidence({
      predecessor: lineage,
      signal: controller.signal,
    }),
    /review cancelled/,
  );
  assert.equal(abortedFixture.calls.length, 0);
});

function ownershipSnapshot(
  override: Partial<SerializableSharedCellOwnershipSnapshot> = {},
): SerializableSharedCellOwnershipSnapshot {
  return {
    schemaVersion: 1,
    isolationLevel: "Serializable",
    readOnly: true,
    deferrable: true,
    accountId,
    region,
    cellId: "cell-sandbox-1",
    environmentId: "env_aws_sandbox_ca_central_1",
    dbObservedAt: now + 500,
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
    ...override,
  };
}

class OwnershipSource implements SerializableSharedCellOwnershipSnapshotSource {
  calls: ReadSerializableSharedCellOwnershipSnapshotInput[] = [];
  result: SerializableSharedCellOwnershipSnapshot;
  error: Error | null = null;

  constructor(result = ownershipSnapshot()) {
    this.result = result;
  }

  async readSerializableReadOnlySnapshot(
    input: ReadSerializableSharedCellOwnershipSnapshotInput,
  ): Promise<SerializableSharedCellOwnershipSnapshot> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.result;
  }
}

test("zero-tenant adapter requires one fresh serializable DB snapshot and computes its hash", async () => {
  const lineage = await predecessor();
  const source = new OwnershipSource();
  const clock = [now, now + 1_000];
  const adapter = new SerializableSharedCellZeroTenantEvidenceAdapter(source, {
    now: () => clock.shift() ?? 0,
  });
  assert.equal(source.calls.length, 0, "construction must not query Neon");
  const controller = new AbortController();
  const evidence = await adapter.readVerifiedZeroTenantEvidence({
    predecessor: lineage,
    signal: controller.signal,
  });
  const sourceIds = {
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
  };
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    verified: true,
    observedAt: now + 500,
    accountId,
    region,
    cellId: "cell-sandbox-1",
    environmentId: "env_aws_sandbox_ca_central_1",
    activeTenantCount: 0,
    activeCapacityReservationCount: 0,
    nonterminalDeploymentCount: 0,
    liveTenantResourceCount: 0,
    nonterminalTenantCleanupScheduleCount: 0,
    sourceSnapshotSha256: await sha256Hex(sourceIds),
  });
  assert.equal(source.calls.length, 1);
  assert.deepEqual(
    { ...source.calls[0], signal: undefined },
    {
      accountId,
      region,
      cellId: "cell-sandbox-1",
      environmentId: "env_aws_sandbox_ca_central_1",
      signal: undefined,
    },
  );
  assert.equal(source.calls[0].signal, controller.signal);
  assert.equal(
    SHARED_CELL_ZERO_TENANT_SOURCE_WIRING_BLOCKER,
    "neon_serializable_zero_tenant_snapshot_source_not_wired",
  );
  assert(Object.isFrozen(evidence));
});

test("zero-tenant adapter never turns occupied or malformed data into zero", async () => {
  const lineage = await predecessor();
  const cases: Array<{
    value: SerializableSharedCellOwnershipSnapshot;
    code: string;
  }> = [
    {
      value: ownershipSnapshot({ activeTenantIds: ["tenant_1"] }),
      code: "SHARED_CELL_ZERO_TENANT_NOT_ZERO",
    },
    {
      value: ownershipSnapshot({
        nonterminalDeploymentIds: ["deployment_b", "deployment_a"],
      }),
      code: "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
    },
    {
      value: {
        ...ownershipSnapshot(),
        readOnly: undefined,
      } as unknown as SerializableSharedCellOwnershipSnapshot,
      code: "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
    },
    {
      value: ownershipSnapshot({ dbObservedAt: now - 120_000 }),
      code: "SHARED_CELL_ZERO_TENANT_SNAPSHOT_INVALID",
    },
  ];
  for (const selected of cases) {
    const source = new OwnershipSource(selected.value);
    const clock = [now, now + 1_000];
    const adapter = new SerializableSharedCellZeroTenantEvidenceAdapter(source, {
      now: () => clock.shift() ?? 0,
    });
    await assert.rejects(
      adapter.readVerifiedZeroTenantEvidence({
        predecessor: lineage,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === selected.code,
    );
  }
});

test("zero-tenant adapter requires the source and preserves retry/abort semantics", async () => {
  assert.throws(
    () =>
      new SerializableSharedCellZeroTenantEvidenceAdapter(
        {} as SerializableSharedCellOwnershipSnapshotSource,
      ),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_ZERO_TENANT_SOURCE_MISSING",
  );
  const lineage = await predecessor();
  const source = new OwnershipSource();
  source.error = Object.assign(new Error("serialization conflict"), {
    name: "SerializationFailure",
  });
  const adapter = new SerializableSharedCellZeroTenantEvidenceAdapter(source, {
    now: () => now,
  });
  await assert.rejects(
    adapter.readVerifiedZeroTenantEvidence({
      predecessor: lineage,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "SerializationFailure" &&
      (error as { retryable?: boolean }).retryable === true,
  );

  const controller = new AbortController();
  controller.abort(new Error("snapshot cancelled"));
  const abortedSource = new OwnershipSource();
  const abortedAdapter = new SerializableSharedCellZeroTenantEvidenceAdapter(
    abortedSource,
    { now: () => now },
  );
  await assert.rejects(
    abortedAdapter.readVerifiedZeroTenantEvidence({
      predecessor: lineage,
      signal: controller.signal,
    }),
    /snapshot cancelled/,
  );
  assert.equal(abortedSource.calls.length, 0);
});
