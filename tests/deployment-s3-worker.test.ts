import assert from "node:assert/strict";
import test from "node:test";
import {
  AwsSdkDeploymentAdapter,
  createAwsSdkDeploymentAdapter,
} from "../lib/deployments/execution/aws-sdk-adapter.ts";
import { EmbeddedCloudFormationCleanupSchedule } from "../lib/deployments/execution/cleanup.ts";
import { MtlsSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import type {
  ApplyReadyTenantStack,
  ClaimedDeploymentJob,
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
} from "../lib/deployments/execution/contracts.ts";
import {
  AWS_SANDBOX_CONFIRMATION_PHRASE,
  type DeploymentWorkerRuntimeConfig,
} from "../lib/deployments/execution/gates.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { finalizeTenantStackForApply } from "../lib/deployments/execution/parameters.ts";
import { assertSharedCellSecurityObservation } from "../lib/deployments/execution/shared-cell-preflight.ts";
import { runDeploymentWorkerOnce } from "../lib/deployments/execution/worker.ts";
import { renderAwsSandboxTenantStack } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";

const now = Date.UTC(2026, 7, 9);
const workerRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole";
const cloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole";

test("loads the AWS SDK clients required by the standalone worker", async () => {
  const [{ STSClient }, { CloudFormationClient }] = await Promise.all([
    import("@aws-sdk/client-sts"),
    import("@aws-sdk/client-cloudformation"),
  ]);

  assert.equal(typeof STSClient, "function");
  assert.equal(typeof CloudFormationClient, "function");
});

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: "402010193138",
  region: "ca-central-1",
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: true,
  status: "active",
  policy: {
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: ["standard-v1"],
    allowNatGateway: false,
    allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14",
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300,
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: 1,
  },
};

function externalParameters(): Record<string, string> {
  const account = environment.expectedAccountId;
  const region = environment.region;
  const secret = (name: string) =>
    `arn:aws:secretsmanager:${region}:${account}:secret:techlong/sandbox/${name}-abcdef`;
  return {
    ClusterName: "cell-sandbox-1",
    VpcId: "vpc-0123456789abcdef0",
    SubnetIds: "subnet-0123456789abcdef0,subnet-0123456789abcdef1",
    TaskSecurityGroupId: "sg-0123456789abcdef0",
    HttpsListenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/0123456789abcdef`,
    ControlListenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/techlong-sandbox-cell/0123456789abcdef/fedcba9876543210`,
    TaskExecutionRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxTaskExecutionRole`,
    TaskRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxTaskRole`,
    DatabaseUrlValueFrom: secret("database-url"),
    ControlPublicKeyValueFrom: secret("control-public-key"),
    ControlIssuer: "https://console.techlong.cloud",
    CorsAllowedOrigins: "https://tenant-one.sandbox.techlong.cloud",
    HmacSecretKeyValueFrom: secret("hmac"),
    JwtSecretKeyValueFrom: secret("jwt"),
    StripeSecretKeyValueFrom: secret("stripe-secret"),
    StripePublishableKey: `pk_test_${"a".repeat(24)}`,
    StripeWebhookSecretValueFrom: secret("stripe-webhook"),
    StripeSuccessUrl: "https://console.techlong.cloud/dashboard/billing/success",
    StripeCancelUrl: "https://console.techlong.cloud/dashboard/billing/canceled",
    ImageS3Bucket: "techlong-sandbox-images",
    ImagePublicBaseUrl: "https://downloads.techlong.cloud",
    JanitorFunctionArn: `arn:aws:lambda:${region}:${account}:function:techlong-sandbox-janitor`,
    SchedulerInvokeRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxSchedulerInvokeRole`,
    SchedulerGroupName: "techlong-sandbox",
  };
}

async function executionFixture(): Promise<{
  context: DeploymentExecutionContext;
  stack: ApplyReadyTenantStack;
}> {
  const configurationSnapshot = { store_name: "Tenant One" };
  const plan = new AwsEcsCellPlanOnlyDriver({
    region: environment.region,
    cellKey: environment.cellKey,
    mode: "aws_sandbox",
  }).buildPlan({
    appInstanceId: "app_tenant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
  });
  const planHash = await sha256Hex(canonicalJson(plan));
  const configurationHash = await sha256Hex(canonicalJson(configurationSnapshot));
  const job: ClaimedDeploymentJob = {
    id: "job_tenant_one",
    deploymentId: "dep_tenant_one",
    jobType: "apply",
    payload: {
      schemaVersion: 1,
      deploymentId: "dep_tenant_one",
      planHash,
    },
    attempt: 1,
    maxAttempts: 5,
    leaseExpiresAt: now + 120_000,
  };
  const context: DeploymentExecutionContext = {
    job,
    deployment: {
      id: "dep_tenant_one",
      appInstanceId: "app_tenant_one",
      environmentId: environment.id,
      status: "planned",
      planHash,
      configurationHash,
      artifactRef: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
      desiredPlan: plan,
      createdAt: now,
    },
    environment,
    binding: {
      environmentId: environment.id,
      workerRoleArn,
      cloudFormationRoleArn,
      tenantStackParameters: externalParameters(),
      status: "active",
    },
    cleanupSchedule: null,
    workspace: { id: "wsp_one", status: "active" },
    subscription: { id: "sub_one", status: "active" },
    appInstance: {
      id: "app_tenant_one",
      workspaceId: "wsp_one",
      productId: "prd_restaurant_order_system",
      subscriptionId: "sub_one",
      status: "pending",
      slug: "tenant-one",
      tenantKey: "tenant_one",
      configurationSnapshot,
    },
    activeCellCount: 1,
    activeTenantCount: 0,
  };
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
    plan,
    environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: now,
  });
  const stack = finalizeTenantStackForApply({
    rendered,
    environment,
    binding: context.binding!,
  });
  return { context, stack };
}

const enabledConfig: DeploymentWorkerRuntimeConfig = {
  workerEnabled: true,
  applyEnabled: true,
  environmentKey: environment.key,
  expectedAccountId: environment.expectedAccountId,
  expectedRegion: environment.region,
  workerRoleArn,
  confirmation: AWS_SANDBOX_CONFIRMATION_PHRASE,
  leaseDurationMs: 120_000,
  pollIntervalMs: 10_000,
};

function inMemoryRepository(input: {
  context: DeploymentExecutionContext;
  transitions?: string[];
  reserveCapacity?: () => boolean;
  onMarkReady?: () => void;
  onMarkUnavailable?: () => void;
  onEnqueue?: () => void;
}): DeploymentExecutionRepository {
  return {
    claimNext: async () => input.context.job,
    loadContext: async () => input.context,
    reserveEnvironmentCapacity: async () => input.reserveCapacity?.() ?? true,
    confirmCleanupSchedule: async (scheduleInput) => {
      const schedule = {
        id: "clean_one",
        deploymentId: scheduleInput.deploymentId,
        status: "confirmed" as const,
        expiresAt: scheduleInput.expiresAt,
        providerScheduleRef: scheduleInput.providerScheduleRef,
        confirmedAt: scheduleInput.confirmedAt,
      };
      input.context.cleanupSchedule = schedule;
      return schedule;
    },
    heartbeat: async () => true,
    transitionDeployment: async (transition) => {
      input.transitions?.push(transition.to);
      input.context.deployment.status = transition.to;
      return true;
    },
    beginStep: async (step) => ({
      id: `step_${step.stepKey}`,
      alreadySucceeded: false,
      previousOutput: {},
    }),
    finishStep: async () => true,
    enqueueJob: async () => {
      input.onEnqueue?.();
    },
    completeJob: async () => true,
    retryJob: async (retry) => retry.retryable ? "retry_wait" : "dead_letter",
    markReady: async () => {
      input.onMarkReady?.();
      input.context.deployment.status = "ready";
      return true;
    },
    markInstanceUnavailable: async () => {
      input.onMarkUnavailable?.();
    },
    markCleanupStatus: async () => undefined,
  };
}

function readyAwsPort(input?: {
  onDescribe?: () => void;
  onDelete?: () => void;
  observationState?: "missing" | "in_progress" | "ready" | "failed" | "delete_in_progress";
  tags?: Record<string, string>;
}) {
  return {
    region: environment.region,
    getCallerIdentity: async () => ({
      accountId: environment.expectedAccountId,
      arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/test-session",
    }),
    applyTenantStack: async () => ({ operation: "create" as const, stackId: "stack-one" }),
    describeTenantStack: async () => {
      input?.onDescribe?.();
      const state = input?.observationState ?? "ready";
      return {
        state,
        rawStatus: state === "ready" ? "CREATE_COMPLETE" : null,
        stackId: state === "missing" ? null : "stack-one",
        outputs: {},
        tags: input?.tags ?? {
          Environment: "aws-sandbox",
          ManagedBy: "techlong-provisioner",
          DeploymentId: "dep_tenant_one",
          AppInstanceId: "app_tenant_one",
        },
      };
    },
    deleteTenantStack: async () => {
      input?.onDelete?.();
      return { operation: "already_deleted" as const };
    },
  };
}

function verifiedSharedCellSecurityPreflight() {
  return {
    verify: async () => ({ verified: true as const, evidenceHash: "c".repeat(64) }),
  };
}

function compiledPayloadCompiler() {
  return {
    compile: async (input: {
      context: DeploymentExecutionContext;
      configurationHash: string;
    }) => ({
      configurationHash: input.configurationHash,
      compiledPayload: {
        instance: {
          external_instance_id: input.context.appInstance.id,
          metadata: { configuration_hash: input.configurationHash },
        },
        entitlements: {},
        default_store: { name: "Tenant One" },
        first_owner: {
          username: "owner",
          password: "temporary-test-password",
          display_name: "Owner",
        },
      },
    }),
  };
}

test("a closed apply gate claims cleanup-only work and never constructs an AWS adapter", async () => {
  let repositoryCalls = 0;
  let awsCalls = 0;
  let claimedTypes: string[] = [];
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:disabled",
    config: { ...enabledConfig, applyEnabled: false },
    dependencies: {
      repository: {
        claimNext: async (
          claim: Parameters<DeploymentExecutionRepository["claimNext"]>[0],
        ) => {
          repositoryCalls += 1;
          claimedTypes = [...claim.jobTypes];
          return null;
        },
      } as unknown as DeploymentExecutionRepository,
      applyRuntimeReady: true,
      awsFactory: async () => {
        awsCalls += 1;
        throw new Error("must not construct AWS adapter");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: true, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "idle");
  assert.equal(repositoryCalls, 1);
  assert.deepEqual(claimedTypes, ["cleanup", "rollback"]);
  assert.equal(awsCalls, 0);
});

test("disabled apply adapters cannot be bypassed by an infrastructure_provisioning resume", async () => {
  const { context } = await executionFixture();
  context.deployment.status = "infrastructure_provisioning";
  let awsFactoryCalls = 0;
  let databaseCalls = 0;
  let claimedTypes: string[] = [];
  let retries = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:runtime-disabled",
    config: enabledConfig,
    dependencies: {
      repository: {
        claimNext: async (
          claim: Parameters<DeploymentExecutionRepository["claimNext"]>[0],
        ) => {
          claimedTypes = [...claim.jobTypes];
          // Deliberately violate the repository contract to verify the worker's
          // second defensive check still prevents an apply path.
          return context.job;
        },
        retryJob: async () => {
          retries += 1;
          return "retry_wait" as const;
        },
      } as unknown as DeploymentExecutionRepository,
      applyRuntimeReady: false,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        throw new Error("disabled apply must not construct AWS");
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw new Error("disabled apply must not run preflight");
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.errorCode, "APPLY_RUNTIME_ADAPTERS_DISABLED");
  assert.deepEqual(claimedTypes, ["cleanup", "rollback"]);
  assert.equal(retries, 1);
  assert.equal(awsFactoryCalls, 0);
  assert.equal(databaseCalls, 0);
});

test("renders the allowlisted stack prefix, ownership tag, and cleanup-before-service guardrail", async () => {
  const { stack } = await executionFixture();
  assert.match(stack.stackName, /^techlong-sandbox-tenant-/);
  assert.equal(stack.tags.Environment, "aws-sandbox");
  assert.equal(stack.safety.cleanupScheduleFirst, true);
  const resources = stack.template.Resources as Record<
    string,
    { Type: string; DependsOn?: string[]; Properties?: Record<string, unknown> }
  >;
  assert.equal(resources.TenantCleanupSchedule.Type, "AWS::Scheduler::Schedule");
  assert.equal(resources.TenantCleanupSchedule.Properties?.GroupName instanceof Object, true);
  assert.ok(resources.TenantService.DependsOn?.includes("TenantCleanupSchedule"));
  const referencedResources = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(referencedResources);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const refs = typeof record.Ref === "string" ? [record.Ref] : [];
    return refs.concat(Object.values(record).flatMap(referencedResources));
  };
  const dependsOnCleanup = (name: string, visited = new Set<string>()): boolean => {
    if (name === "TenantCleanupSchedule") return true;
    if (visited.has(name)) return false;
    visited.add(name);
    const resource = resources[name];
    if (!resource) return false;
    const dependencies = [
      ...(resource.DependsOn ?? []),
      ...referencedResources(resource.Properties).filter((refName) => refName in resources),
    ];
    return dependencies.some((dependency) => dependsOnCleanup(dependency, visited));
  };
  for (const resourceName of Object.keys(resources)) {
    if (resourceName !== "TenantCleanupSchedule") {
      assert.equal(
        dependsOnCleanup(resourceName),
        true,
        `${resourceName} must be created after the cleanup schedule`,
      );
    }
  }
  assert.equal(resources.TenantService.Properties?.DeploymentConfiguration instanceof Object, true);
  assert.equal(
    (resources.TenantService.Properties?.DeploymentConfiguration as Record<string, unknown>)
      .MaximumPercent,
    100,
  );
  assert.equal(
    Object.values(resources).some((resource) =>
      resource.Type.startsWith("AWS::ApplicationAutoScaling::"),
    ),
    false,
  );
  assert.equal(stack.parameters.CleanupAt, "2026-08-09T02:00:00");
  assert.equal(stack.parameters.SchedulerGroupName, "techlong-sandbox");
});

test("requires an exact, validated CloudFormation parameter set", async () => {
  const { context } = await executionFixture();
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: context.deployment.id,
    plan: context.deployment.desiredPlan,
    environment,
    imageUri: context.deployment.artifactRef,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: now,
  });
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            DatabaseUrlValueFrom: "postgresql://owner:password@example/db",
          },
        },
      }),
    /allowlist|parameter/i,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            UnexpectedParameter: "true",
          },
        },
      }),
    /not exact/,
  );
  assert.throws(
    () =>
      finalizeTenantStackForApply({
        rendered,
        environment,
        binding: {
          ...context.binding!,
          tenantStackParameters: {
            ...context.binding!.tenantStackParameters,
            JanitorFunctionArn:
              `${context.binding!.tenantStackParameters.JanitorFunctionArn}-shadow`,
          },
        },
      }),
    /allowlist/,
  );
});

test("Shared Cell security proof rejects a non-mTLS listener and public task ingress", () => {
  const binding: NonNullable<DeploymentExecutionContext["binding"]> = {
    environmentId: environment.id,
    workerRoleArn,
    cloudFormationRoleArn,
    tenantStackParameters: externalParameters(),
    status: "active",
  };
  const loadBalancerSecurityGroupId = "sg-0123456789abcdef1";
  const observation = {
    accountId: environment.expectedAccountId,
    region: environment.region,
    clusterName: "cell-sandbox-1",
    vpcId: binding.tenantStackParameters.VpcId,
    subnetIds: binding.tenantStackParameters.SubnetIds.split(","),
    httpsListener: {
      arn: binding.tenantStackParameters.HttpsListenerArn,
      protocol: "HTTPS" as const,
      port: 443,
      mutualAuthenticationMode: "off" as const,
    },
    controlListener: {
      arn: binding.tenantStackParameters.ControlListenerArn,
      protocol: "HTTPS" as const,
      port: 8443,
      mutualAuthenticationMode: "verify" as const,
    },
    loadBalancerSecurityGroupIds: [loadBalancerSecurityGroupId],
    taskSecurityGroup: {
      id: binding.tenantStackParameters.TaskSecurityGroupId,
      vpcId: binding.tenantStackParameters.VpcId,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 3000,
          toPort: 3000,
          sourceSecurityGroupId: loadBalancerSecurityGroupId,
        },
      ],
    },
  };
  assert.doesNotThrow(() =>
    assertSharedCellSecurityObservation({ environment, binding, observation }),
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          controlListener: {
            ...observation.controlListener,
            mutualAuthenticationMode: "off",
          },
        },
      }),
    /mTLS verify/,
  );
  assert.throws(
    () =>
      assertSharedCellSecurityObservation({
        environment,
        binding,
        observation: {
          ...observation,
          taskSecurityGroup: {
            ...observation.taskSecurityGroup,
            ingress: [
              {
                protocol: "tcp",
                fromPort: 3000,
                toPort: 3000,
                cidrIpv4: "0.0.0.0/0",
              },
            ],
          },
        },
      }),
    /only from an observed ALB security group/,
  );
});

test("mTLS control client reads body.control and sends only a compiled provisioning payload", async () => {
  const configurationHash = "b".repeat(64);
  const imageRevision = `sha256:${"a".repeat(64)}`;
  const requests: Array<{ url: string; body?: string }> = [];
  const client = new MtlsSaaSControlClient(
    {
      send: async (request) => {
        requests.push({ url: request.url, ...(request.body ? { body: request.body } : {}) });
        if (request.method === "GET") {
          return {
            status: 200,
            body: {
              success: true,
              control: {
                desired_configuration_hash: configurationHash,
                image_revision: imageRevision,
              },
            },
          };
        }
        return { status: 201, body: { success: true, replayed: false } };
      },
    },
    { issue: async () => "test.jwt.signature" },
  );
  const observed = await client.readConfiguration({
    appInstanceId: "app_tenant_one",
    hostname: "tenant-one.sandbox.techlong.cloud",
  });
  assert.equal(observed.desiredConfigurationHash, configurationHash);
  assert.equal(observed.imageRevision, imageRevision);
  assert.equal(requests[0].url.endsWith("/api/saas/control"), true);

  const compiledPayload = {
    instance: {
      external_instance_id: "app_tenant_one",
      metadata: { configuration_hash: configurationHash },
    },
    entitlements: { "stores.max": 1 },
    default_store: { name: "Tenant One" },
    first_owner: {
      username: "owner",
      password: "temporary-test-password",
      display_name: "Owner",
    },
  };
  await assert.doesNotReject(() =>
    client.provision({
      appInstanceId: "app_tenant_one",
      hostname: "tenant-one.sandbox.techlong.cloud",
      idempotencyKey: `dep:${configurationHash}`,
      compiledPayload,
    }),
  );
  assert.equal(requests[1].url.endsWith("/api/saas/provision"), true);
  assert.deepEqual(JSON.parse(requests[1].body ?? "{}"), compiledPayload);
  await assert.rejects(
    () =>
      client.provision({
        appInstanceId: "app_tenant_one",
        hostname: "tenant-one.sandbox.techlong.cloud",
        idempotencyKey: `dep:${configurationHash}`,
        compiledPayload: {
          instance_id: "app_tenant_one",
          desired_configuration_hash: configurationHash,
          configuration: { store_name: "raw snapshot" },
        },
      }),
    /compiled v2 control shape/i,
  );
});

test("CloudFormation adapter creates once and treats a repeated no-update request as idempotent", async () => {
  const { stack } = await executionFixture();
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class GetCallerIdentityCommand extends TestCommand {}
  class DescribeStacksCommand extends TestCommand {}
  class CreateStackCommand extends TestCommand {}
  class UpdateStackCommand extends TestCommand {}
  class DeleteStackCommand extends TestCommand {}
  let exists = false;
  let creates = 0;
  let updates = 0;
  const cloudFormationClient = {
    async send(command: unknown): Promise<Record<string, unknown>> {
      if (command instanceof DescribeStacksCommand) {
        if (!exists) {
          throw Object.assign(new Error("Stack does not exist"), { name: "ValidationError" });
        }
        return {
          Stacks: [
            {
              StackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-one/id",
              StackStatus: "CREATE_COMPLETE",
              Tags: Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value })),
            },
          ],
        };
      }
      if (command instanceof CreateStackCommand) {
        creates += 1;
        exists = true;
        return { StackId: "stack-id-one" };
      }
      if (command instanceof UpdateStackCommand) {
        updates += 1;
        throw Object.assign(new Error("No updates are to be performed."), {
          name: "ValidationError",
        });
      }
      throw new Error("unexpected command");
    },
  };
  const adapter = new AwsSdkDeploymentAdapter(environment.region, {
    stsClient: { send: async () => ({ Account: environment.expectedAccountId }) },
    cloudFormationClient,
    commands: {
      getCallerIdentity: GetCallerIdentityCommand,
      describeStacks: DescribeStacksCommand,
      createStack: CreateStackCommand,
      updateStack: UpdateStackCommand,
      deleteStack: DeleteStackCommand,
    },
  });
  assert.equal((await adapter.applyTenantStack(stack)).operation, "create");
  assert.equal((await adapter.applyTenantStack(stack)).operation, "no_change");
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});

test("declared AWS SDK runtime packages construct the adapter without making a request", async () => {
  const adapter = await createAwsSdkDeploymentAdapter(environment.region);
  assert.equal(adapter.region, environment.region);
});

test("CloudFormation adapter resumes owned creates and treats delete-in-progress as idempotent", async () => {
  const { stack } = await executionFixture();
  class TestCommand {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class GetCallerIdentityCommand extends TestCommand {}
  class DescribeStacksCommand extends TestCommand {}
  class CreateStackCommand extends TestCommand {}
  class UpdateStackCommand extends TestCommand {}
  class DeleteStackCommand extends TestCommand {}
  const makeAdapter = (status: string) => {
    const calls = { creates: 0, updates: 0, deletes: 0 };
    const cloudFormationClient = {
      async send(command: unknown): Promise<Record<string, unknown>> {
        if (command instanceof DescribeStacksCommand) {
          return {
            Stacks: [
              {
                StackId: "stack-id-one",
                StackStatus: status,
                Tags: Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value })),
              },
            ],
          };
        }
        if (command instanceof CreateStackCommand) calls.creates += 1;
        else if (command instanceof UpdateStackCommand) calls.updates += 1;
        else if (command instanceof DeleteStackCommand) calls.deletes += 1;
        return { StackId: "stack-id-one" };
      },
    };
    return {
      calls,
      adapter: new AwsSdkDeploymentAdapter(environment.region, {
        stsClient: { send: async () => ({ Account: environment.expectedAccountId }) },
        cloudFormationClient,
        commands: {
          getCallerIdentity: GetCallerIdentityCommand,
          describeStacks: DescribeStacksCommand,
          createStack: CreateStackCommand,
          updateStack: UpdateStackCommand,
          deleteStack: DeleteStackCommand,
        },
      }),
    };
  };

  const creating = makeAdapter("CREATE_IN_PROGRESS");
  assert.equal(
    (await creating.adapter.applyTenantStack(stack)).operation,
    "existing_in_progress",
  );
  assert.deepEqual(creating.calls, { creates: 0, updates: 0, deletes: 0 });

  const deleting = makeAdapter("DELETE_IN_PROGRESS");
  assert.equal(
    (
      await deleting.adapter.deleteTenantStack({
        stackName: stack.stackName,
        clientRequestToken: `delete-${stack.clientRequestToken}`.slice(0, 128),
        expectedTags: stack.tags,
        cloudFormationRoleArn: stack.cloudFormationRoleArn,
      })
    ).operation,
    "delete_in_progress",
  );
  assert.equal(deleting.calls.deletes, 0);

  const deleteFailed = makeAdapter("DELETE_FAILED");
  assert.equal(
    (
      await deleteFailed.adapter.deleteTenantStack({
        stackName: stack.stackName,
        clientRequestToken: `delete-${stack.clientRequestToken}`.slice(0, 128),
        expectedTags: stack.tags,
        cloudFormationRoleArn: stack.cloudFormationRoleArn,
      })
    ).operation,
    "delete",
  );
  assert.equal(deleteFailed.calls.deletes, 1);

  const failedApply = makeAdapter("ROLLBACK_COMPLETE");
  await assert.rejects(
    () => failedApply.adapter.applyTenantStack(stack),
    /terminal state ROLLBACK_COMPLETE/,
  );
  assert.equal(failedApply.calls.updates, 0);
});

test("records a retry without calling CloudFormation when tenant database preparation fails", async () => {
  const { context } = await executionFixture();
  let awsFactoryCalls = 0;
  let cloudFormationCalls = 0;
  let retryable: boolean | null = null;
  const repository: DeploymentExecutionRepository = {
    claimNext: async () => context.job,
    loadContext: async () => context,
    reserveEnvironmentCapacity: async () => true,
    confirmCleanupSchedule: async (input) => {
      const schedule = {
        id: "clean_one",
        deploymentId: input.deploymentId,
        status: "confirmed" as const,
        expiresAt: input.expiresAt,
        providerScheduleRef: input.providerScheduleRef,
        confirmedAt: input.confirmedAt,
      };
      context.cleanupSchedule = schedule;
      return schedule;
    },
    heartbeat: async () => true,
    transitionDeployment: async (input) => {
      context.deployment.status = input.to;
      return true;
    },
    beginStep: async (input) => ({
      id: `step_${input.stepKey}`,
      alreadySucceeded: false,
      previousOutput: {},
    }),
    finishStep: async () => true,
    enqueueJob: async () => undefined,
    completeJob: async () => true,
    retryJob: async (input) => {
      retryable = input.retryable;
      return "retry_wait";
    },
    markReady: async () => true,
    markInstanceUnavailable: async () => undefined,
    markCleanupStatus: async () => undefined,
  };
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:retry",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return {
          region: environment.region,
          getCallerIdentity: async () => ({
            accountId: environment.expectedAccountId,
            arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/test-session",
          }),
          applyTenantStack: async () => {
            cloudFormationCalls += 1;
            return { operation: "create", stackId: "stack-one" };
          },
          describeTenantStack: async () => ({
            state: "missing",
            rawStatus: null,
            stackId: null,
            outputs: {},
            tags: {},
          }),
          deleteTenantStack: async () => ({ operation: "already_deleted" }),
        };
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          throw Object.assign(new Error("temporary database lock"), {
            code: "DATABASE_BUSY",
            retryable: true,
          });
        },
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(retryable, true);
  assert.equal(awsFactoryCalls, 1);
  assert.equal(cloudFormationCalls, 0);
});

test("an unverified Shared Cell stops before capacity, tenant database, or CloudFormation writes", async () => {
  const { context } = await executionFixture();
  let capacityCalls = 0;
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cell-preflight-disabled",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        reserveCapacity: () => {
          capacityCalls += 1;
          return true;
        },
      }),
      applyRuntimeReady: true,
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw Object.assign(new Error("Shared Cell proof unavailable"), {
            code: "SHARED_CELL_SECURITY_PREFLIGHT_DISABLED",
            retryable: false,
          });
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(capacityCalls, 0);
  assert.equal(databaseCalls, 0);
  assert.equal(cloudFormationCalls, 0);
});

test("an atomic capacity reservation loser stops before tenant database and CloudFormation writes", async () => {
  const { context } = await executionFixture();
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:capacity-loser",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        reserveCapacity: () => false,
      }),
      applyRuntimeReady: true,
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(databaseCalls, 0);
  assert.equal(cloudFormationCalls, 0);
});

test("a persisted gate flip during migration is re-read before the CloudFormation write", async () => {
  const { context } = await executionFixture();
  const baseRepository = inMemoryRepository({ context });
  let contextLoads = 0;
  let databaseCalls = 0;
  let cloudFormationCalls = 0;
  const repository: DeploymentExecutionRepository = {
    ...baseRepository,
    loadContext: async () => {
      contextLoads += 1;
      if (contextLoads === 1) return context;
      return {
        ...context,
        environment: {
          ...context.environment,
          applyEnabled: false,
        },
      };
    },
  };
  const aws = readyAwsPort();
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:prewrite-gate-flip",
    config: enabledConfig,
    dependencies: {
      repository,
      applyRuntimeReady: true,
      awsFactory: async () => ({
        ...aws,
        applyTenantStack: async () => {
          cloudFormationCalls += 1;
          return { operation: "create" as const, stackId: "stack-one" };
        },
      }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now + 1_000),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
        migrateTenantDatabase: async () => {
          databaseCalls += 1;
          return {};
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(contextLoads, 2);
  assert.equal(databaseCalls, 2);
  assert.equal(cloudFormationCalls, 0);
});

test("reconcile advances health, configuration and verification without entering cancellation", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "waiting_healthy";
  const transitions: string[] = [];
  let markedReady = 0;
  let controlCalls = 0;
  const imageRevision = context.deployment.artifactRef.split("@").at(-1) ?? null;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:reconcile",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({
        context,
        transitions,
        onMarkReady: () => {
          markedReady += 1;
        },
      }),
      applyRuntimeReady: true,
      awsFactory: async () => readyAwsPort(),
      cleanupScheduler: {
        confirmSchedule: async () => {
          throw new Error("reconcile must not recreate a cleanup schedule");
        },
      },
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return {
            ready: true,
            desiredConfigurationHash: context.deployment.configurationHash,
            imageRevision,
          };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(transitions, ["configuring", "verifying"]);
  assert.equal(transitions.includes("cancel_requested"), false);
  assert.equal(transitions.includes("rolling_back"), false);
  assert.equal(markedReady, 1);
  assert.equal(controlCalls, 3);
});

test("reconcile rejects a stack with mismatched ownership tags before control calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "waiting_healthy";
  let controlCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:ownership-mismatch",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: true,
      awsFactory: async () =>
        readyAwsPort({
          tags: {
            Environment: "aws-sandbox",
            ManagedBy: "techlong-provisioner",
            DeploymentId: "dep_another_tenant",
            AppInstanceId: context.appInstance.id,
          },
        }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(controlCalls, 0);
});

test("a ready reconcile is an idempotent success without delete or control calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "reconcile";
  context.deployment.status = "ready";
  context.appInstance.status = "active";
  const transitions: string[] = [];
  let describes = 0;
  let controlCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:ready-reconcile",
    config: enabledConfig,
    dependencies: {
      repository: inMemoryRepository({ context, transitions }),
      applyRuntimeReady: true,
      awsFactory: async () =>
        readyAwsPort({
          onDescribe: () => {
            describes += 1;
          },
        }),
      cleanupScheduler: {
        confirmSchedule: async () => {
          throw new Error("ready reconcile must not recreate cleanup");
        },
      },
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
        provision: async () => {
          controlCalls += 1;
          return { accepted: true as const };
        },
        readConfiguration: async () => {
          controlCalls += 1;
          return { ready: true, desiredConfigurationHash: null, imageRevision: null };
        },
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now + 1_000,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(transitions, []);
  assert.equal(describes, 0);
  assert.equal(controlCalls, 0);
});

for (const jobType of ["cleanup", "rollback"] as const) {
  test(`expired ${jobType} reaches delete handling without recreating cleanup`, async () => {
    const { context } = await executionFixture();
    context.job.jobType = jobType;
    context.deployment.status = "ready";
    context.appInstance.status = "active";
    context.environment = {
      ...context.environment,
      applyEnabled: false,
      status: "inactive",
    };
    context.binding = { ...context.binding!, status: "inactive" };
    context.subscription = { id: "sub_one", status: "canceled" };
    context.appInstance.configurationSnapshot = { drifted_after_expiry: true };
    context.deployment.createdAt = now - context.environment.policy.ttlSeconds * 1_000;
    context.cleanupSchedule = {
      id: "clean_expired",
      deploymentId: context.deployment.id,
      status: "confirmed",
      expiresAt: now,
      providerScheduleRef:
        "cloudformation:techlong-sandbox-tenant-tenantone:TenantCleanupSchedule",
      confirmedAt: now - 1_000,
    };
    const transitions: string[] = [];
    let unavailable = 0;
    let cleanupEnqueues = 0;
    let cleanupConfirmations = 0;
    const result = await runDeploymentWorkerOnce({
      workerId: `worker:test:${jobType}`,
      config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
      dependencies: {
        repository: inMemoryRepository({
          context,
          transitions,
          onMarkUnavailable: () => {
            unavailable += 1;
          },
          onEnqueue: () => {
            cleanupEnqueues += 1;
          },
        }),
        applyRuntimeReady: false,
        awsFactory: async () => readyAwsPort({ observationState: "missing" }),
        cleanupScheduler: {
          confirmSchedule: async () => {
            cleanupConfirmations += 1;
            throw new Error("expired delete work must not recreate cleanup");
          },
        },
        sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
        tenantDatabase: {
          ensureTenantDatabase: async () => ({}),
          migrateTenantDatabase: async () => ({}),
        },
        controlClient: {
          waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
          provision: async () => ({ accepted: true as const }),
          readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        },
        controlPayloadCompiler: compiledPayloadCompiler(),
        now: () => now,
      },
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(transitions, ["cancel_requested", "rolling_back", "rolled_back"]);
    assert.equal(unavailable, 1);
    assert.equal(cleanupEnqueues, 0);
    assert.equal(cleanupConfirmations, 0);
  });
}

test("cleanup waits idempotently while CloudFormation deletion is already in progress", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "rolling_back";
  context.appInstance.status = "active";
  let deleteCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:delete-in-progress",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      awsFactory: async () =>
        readyAwsPort({
          observationState: "delete_in_progress",
          onDelete: () => {
            deleteCalls += 1;
          },
        }),
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: {
        verify: async () => {
          throw new Error("cleanup must bypass Shared Cell apply preflight");
        },
      },
      tenantDatabase: {
        ensureTenantDatabase: async () => {
          throw new Error("cleanup must bypass tenant database");
        },
        migrateTenantDatabase: async () => {
          throw new Error("cleanup must bypass tenant database");
        },
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(deleteCalls, 0);
});

test("cleanup with a non-allowlisted CloudFormation role makes zero AWS calls", async () => {
  const { context } = await executionFixture();
  context.job.jobType = "cleanup";
  context.deployment.status = "ready";
  context.binding = {
    ...context.binding!,
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/UnexpectedCloudFormationRole",
  };
  let awsFactoryCalls = 0;
  const result = await runDeploymentWorkerOnce({
    workerId: "worker:test:cleanup-role-mismatch",
    config: { ...enabledConfig, applyEnabled: false, confirmation: "" },
    dependencies: {
      repository: inMemoryRepository({ context }),
      applyRuntimeReady: false,
      awsFactory: async () => {
        awsFactoryCalls += 1;
        return readyAwsPort();
      },
      cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(() => now),
      sharedCellSecurityPreflight: verifiedSharedCellSecurityPreflight(),
      tenantDatabase: {
        ensureTenantDatabase: async () => ({}),
        migrateTenantDatabase: async () => ({}),
      },
      controlClient: {
        waitUntilHealthy: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
        provision: async () => ({ accepted: true as const }),
        readConfiguration: async () => ({ ready: false, desiredConfigurationHash: null, imageRevision: null }),
      },
      controlPayloadCompiler: compiledPayloadCompiler(),
      now: () => now,
    },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(awsFactoryCalls, 0);
});
