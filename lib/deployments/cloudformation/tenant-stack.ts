import type { DeploymentEnvironment } from "../environment.ts";
import { assertAwsSandboxPreflight } from "../preflight.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";

export interface AwsSandboxTenantStackInput {
  deploymentId: string;
  /** Durable external-resource incarnation claimed before rendering. */
  resourceGeneration: number;
  /** Exact provider-observed provision epoch for this mutation. */
  externalOperation: {
    epoch: number;
    intent: "provision";
    ownerDeploymentId: string;
    operationHash: string;
    marker: string;
    state: "active";
  };
  /**
   * Base ARN of the generation-bound tenant JSON Secret. The renderer derives
   * ECS JSON-key references from this ARN; tenant credentials must never come
   * from the environment-level execution binding.
  */
  runtimeSecretRef: string;
  /** Exact generation-bound physical Secret name derived from the resource fence. */
  runtimeSecretName: string;
  plan: AwsEcsCellDeploymentPlan;
  environment: DeploymentEnvironment;
  imageUri: string;
  tenantHostname: string;
  listenerPriority: number;
  activeCellCount: number;
  activeTenantCount: number;
  requestedAt: number;
}

export interface CloudFormationTenantStackPlan {
  schemaVersion: 1;
  stackName: string;
  region: string;
  accountId: string;
  clientRequestToken: string;
  onFailure: "ROLLBACK";
  capabilities: [];
  template: Record<string, unknown>;
  templateBody: string;
  parameters: Record<string, string>;
  requiredExternalParameters: string[];
  tags: Record<string, string>;
  safety: {
    renderOnly: true;
    applyReady: false;
    callsAws: false;
    containsSecretValues: false;
    allowsNatGateway: false;
    allowsInterfaceEndpoints: false;
    createsDatabaseResources: false;
    controlListenerMtlsRequired: true;
    cleanupScheduleFirst: true;
    fixedTaskCount: 1;
  };
}

const imageDigestPattern = /^(\d{12})\.dkr\.ecr\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.amazonaws\.com\/[a-z0-9][a-z0-9._\/-]{1,254}@sha256:[a-f0-9]{64}$/;
const hostnamePattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const tenantRuntimeSecretJsonKeys = {
  databaseUrl: "database_url",
  hmacSecretKey: "hmac_secret_key",
  jwtSecretKey: "jwt_secret_key",
  stripeSecretKey: "stripe_secret_key",
  stripeWebhookSecret: "stripe_webhook_secret",
} as const;

/** Tags that identify the durable tenant workload across deployments. */
export const tenantStackStableOwnershipTagKeys = [
  "Environment",
  "ManagedBy",
  "AppInstanceId",
  "CellId",
  "ResourceGeneration",
] as const;

/** Tag that identifies the deployment currently operating the durable stack. */
export const tenantStackOperationTagKey = "DeploymentId" as const;

/** Tags that bind a workload mutation to one active external operation. */
export const tenantStackExternalOperationTagKeys = [
  "ExternalOperationEpoch",
  "ExternalOperationIntent",
  "ExternalOperationMarker",
  "ExternalOperationHash",
] as const;

function resourceToken(appInstanceId: string): string {
  const normalized = appInstanceId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `tenant-${normalized.slice(-16) || "pending"}`;
}

export function assertAwsSandboxTenantRuntimeSecretRef(input: {
  runtimeSecretRef: string;
  accountId: string;
  region: string;
  expectedSecretName?: string;
}): void {
  const escapedRegion = input.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const secretNamePattern =
    /^techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g[1-9][0-9]*$/;
  if (
    input.expectedSecretName !== undefined &&
    !secretNamePattern.test(input.expectedSecretName)
  ) {
    throw new Error("Expected tenant runtime Secret name is invalid.");
  }
  const escapedSecretName = input.expectedSecretName?.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const pattern = new RegExp(
    `^arn:aws:secretsmanager:${escapedRegion}:${input.accountId}:secret:` +
      (escapedSecretName ??
        "techlong/sandbox/tenant/[a-z0-9][a-z0-9_-]{2,63}/runtime/g[1-9][0-9]*") +
      "-[A-Za-z0-9]{6}$",
  );
  if (!pattern.test(input.runtimeSecretRef)) {
    throw new Error(
      "Tenant runtime Secret must be an exact base ARN in the current Sandbox account and region.",
    );
  }
}

function tenantRuntimeSecretValueFrom(
  jsonKey: (typeof tenantRuntimeSecretJsonKeys)[keyof typeof tenantRuntimeSecretJsonKeys],
): { "Fn::Sub": string } {
  return { "Fn::Sub": `\${TenantRuntimeSecretArn}:${jsonKey}::` };
}

export function awsSandboxTenantStackName(appInstanceId: string): string {
  return `techlong-sandbox-${resourceToken(appInstanceId)}`.slice(0, 128);
}

function assertRenderInput(input: AwsSandboxTenantStackInput): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(input.deploymentId)) {
    throw new Error("Deployment id is invalid.");
  }
  if (
    !Number.isSafeInteger(input.resourceGeneration) ||
    input.resourceGeneration < 1
  ) {
    throw new Error("Tenant resource generation is invalid.");
  }
  const external = input.externalOperation;
  const expectedMarker = external
    ? new RegExp(
        `^tl_epoch_[a-f0-9]{24}_g${input.resourceGeneration}_e${external.epoch}$`,
      )
    : null;
  if (
    !external ||
    external.intent !== "provision" ||
    external.state !== "active" ||
    external.ownerDeploymentId !== input.deploymentId ||
    !Number.isSafeInteger(external.epoch) ||
    external.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(external.operationHash) ||
    !expectedMarker?.test(external.marker)
  ) {
    throw new Error(
      "Tenant stack requires one exact active provision external-operation epoch.",
    );
  }
  assertAwsSandboxTenantRuntimeSecretRef({
    runtimeSecretRef: input.runtimeSecretRef,
    accountId: input.environment.expectedAccountId,
    region: input.environment.region,
    expectedSecretName: input.runtimeSecretName,
  });
  if (!input.runtimeSecretName.endsWith(`/g${input.resourceGeneration}`)) {
    throw new Error(
      "Tenant runtime Secret name does not match the current resource generation.",
    );
  }
  if (input.plan.mode !== "aws_sandbox") {
    throw new Error("Tenant stack renderer only accepts aws_sandbox plans.");
  }
  assertAwsSandboxPreflight({
    environment: input.environment,
    operation: "render",
    deploymentProfileKey: input.plan.deploymentProfileKey,
    observedAccountId: input.environment.expectedAccountId,
    observedRegion: input.plan.region,
    activeCellCount: input.activeCellCount,
    activeTenantCount: input.activeTenantCount,
    cellOperation: "reuse",
  });
  if (input.plan.cellKey !== input.environment.cellKey) {
    throw new Error("Deployment plan cell does not match the sandbox environment.");
  }
  const image = input.imageUri.match(imageDigestPattern);
  if (!image) {
    throw new Error("Sandbox image must be an immutable private ECR digest.");
  }
  if (image[1] !== input.environment.expectedAccountId || image[2] !== input.environment.region) {
    throw new Error("Sandbox image account and region must match the environment allowlist.");
  }
  if (!hostnamePattern.test(input.tenantHostname)) {
    throw new Error("Tenant hostname is invalid.");
  }
  if (!input.tenantHostname.endsWith(`.${input.environment.baseDomain}`)) {
    throw new Error("Tenant hostname must belong to the environment base domain.");
  }
  const tenantLabel = input.tenantHostname.slice(
    0,
    -(input.environment.baseDomain.length + 1),
  );
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenantLabel)) {
    throw new Error(
      "Tenant hostname must contain exactly one tenant label before the environment base domain.",
    );
  }
  if (!Number.isSafeInteger(input.requestedAt) || input.requestedAt <= 0) {
    throw new Error("Sandbox render time is invalid.");
  }
  if (
    !Number.isSafeInteger(input.listenerPriority) ||
    input.listenerPriority < 1 ||
    input.listenerPriority > 49_999
  ) {
    throw new Error("Listener priority must be an integer between 1 and 49999.");
  }
}

function ref(name: string): { Ref: string } {
  return { Ref: name };
}

export function renderAwsSandboxTenantStack(
  input: AwsSandboxTenantStackInput,
): CloudFormationTenantStackPlan {
  assertRenderInput(input);
  const imageRevision = input.imageUri.slice(input.imageUri.indexOf("@") + 1);
  const appInstanceId = input.plan.resources.tenant.costTags.AppInstanceId;
  const token = resourceToken(appInstanceId);
  const stackName = awsSandboxTenantStackName(appInstanceId);
  const cleanupAt = new Date(
    input.requestedAt + input.environment.policy.ttlSeconds * 1_000,
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "");
  const tags = {
    Environment: "aws-sandbox",
    EnvironmentKey: input.environment.key,
    CellId: input.environment.cellKey,
    WorkspaceId: input.plan.resources.tenant.costTags.WorkspaceId,
    ProductId: input.plan.resources.tenant.costTags.ProductId,
    PlanId: input.plan.resources.tenant.costTags.PlanId,
    AppInstanceId: input.plan.resources.tenant.costTags.AppInstanceId,
    DeploymentId: input.deploymentId,
    ResourceGeneration: String(input.resourceGeneration),
    ExternalOperationEpoch: String(input.externalOperation.epoch),
    ExternalOperationIntent: input.externalOperation.intent,
    ExternalOperationMarker: input.externalOperation.marker,
    ExternalOperationHash: input.externalOperation.operationHash,
    DeploymentProfile: input.plan.deploymentProfileKey,
    ManagedBy: "techlong-provisioner",
    ExpiresAt: `${cleanupAt}.000Z`,
  };
  const resourceTags = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
  const cpu = String(input.plan.resources.tenant.taskDefinition.cpu);
  const memory = String(input.plan.resources.tenant.taskDefinition.memoryMiB);
  const logRetention = input.environment.policy.logRetentionDays;
  const template: Record<string, unknown> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Render-only S1 tenant workload for the SaaS AWS sandbox cell.",
    Parameters: {
      ClusterName: { Type: "String" },
      VpcId: { Type: "AWS::EC2::VPC::Id" },
      SubnetIds: { Type: "List<AWS::EC2::Subnet::Id>" },
      TaskSecurityGroupId: { Type: "AWS::EC2::SecurityGroup::Id" },
      HttpsListenerArn: { Type: "String" },
      ControlListenerArn: { Type: "String" },
      TaskExecutionRoleArn: { Type: "String" },
      TaskRoleArn: { Type: "String" },
      TenantRuntimeSecretArn: { Type: "String", NoEcho: true },
      ControlPublicKeyValueFrom: { Type: "String", NoEcho: true },
      ControlIssuer: { Type: "String" },
      CorsAllowedOrigins: { Type: "String" },
      JwtExpiresIn: { Type: "String", Default: "7d" },
      MerchantJwtExpiresIn: { Type: "String", Default: "12h" },
      StripePublishableKey: { Type: "String" },
      StripeSuccessUrl: { Type: "String" },
      StripeCancelUrl: { Type: "String" },
      ImageS3Bucket: { Type: "String" },
      ImagePublicBaseUrl: { Type: "String" },
      ImageUri: { Type: "String" },
      TenantHostname: { Type: "String" },
      AppInstanceId: { Type: "String" },
      JanitorFunctionArn: { Type: "String" },
      SchedulerInvokeRoleArn: { Type: "String" },
      SchedulerGroupName: {
        Type: "String",
        AllowedValues: ["techlong-sandbox"],
      },
      CleanupAt: {
        Type: "String",
        AllowedPattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$",
      },
    },
    Rules: {
      DistinctBusinessAndControlListeners: {
        Assertions: [
          {
            Assert: {
              "Fn::Not": [
                {
                  "Fn::Equals": [
                    ref("HttpsListenerArn"),
                    ref("ControlListenerArn"),
                  ],
                },
              ],
            },
            AssertDescription:
              "The business listener and mTLS control listener must be different.",
          },
        ],
      },
    },
    Resources: {
      TenantCleanupSchedule: {
        Type: "AWS::Scheduler::Schedule",
        Properties: {
          Name: `${token}-ttl-cleanup`.slice(0, 64),
          GroupName: ref("SchedulerGroupName"),
          Description: `TTL cleanup for ${input.deploymentId}`.slice(0, 512),
          ActionAfterCompletion: "DELETE",
          FlexibleTimeWindow: { Mode: "OFF" },
          ScheduleExpression: { "Fn::Sub": "at(${CleanupAt})" },
          ScheduleExpressionTimezone: "UTC",
          State: "ENABLED",
          Target: {
            Arn: ref("JanitorFunctionArn"),
            RoleArn: ref("SchedulerInvokeRoleArn"),
            RetryPolicy: {
              MaximumEventAgeInSeconds: 3_600,
              MaximumRetryAttempts: 5,
            },
            Input: JSON.stringify({
              schemaVersion: 1,
              action: "delete_cloudformation_stack",
              stackName,
              deploymentId: input.deploymentId,
              appInstanceId,
              resourceGeneration: input.resourceGeneration,
            }),
          },
        },
      },
      TenantLogGroup: {
        Type: "AWS::Logs::LogGroup",
        DependsOn: ["TenantCleanupSchedule"],
        Properties: {
          LogGroupName: input.plan.resources.tenant.logs.logGroupName,
          RetentionInDays: logRetention,
          Tags: resourceTags,
        },
      },
      TenantTaskDefinition: {
        Type: "AWS::ECS::TaskDefinition",
        DependsOn: ["TenantCleanupSchedule"],
        Properties: {
          Family: input.plan.resources.tenant.taskDefinition.logicalName,
          Cpu: cpu,
          Memory: memory,
          NetworkMode: "awsvpc",
          RequiresCompatibilities: ["FARGATE"],
          ExecutionRoleArn: ref("TaskExecutionRoleArn"),
          TaskRoleArn: ref("TaskRoleArn"),
          ContainerDefinitions: [
            {
              Name: "speedfeast-backend",
              Image: ref("ImageUri"),
              Essential: true,
              PortMappings: [
                { ContainerPort: 3000, Protocol: "tcp", Name: "http" },
              ],
              Environment: [
                { Name: "PORT", Value: "3000" },
                { Name: "NODE_ENV", Value: "production" },
                { Name: "HOST", Value: "0.0.0.0" },
                { Name: "CORS_ALLOWED_ORIGINS", Value: ref("CorsAllowedOrigins") },
                { Name: "SAAS_JWT_ISSUER", Value: ref("ControlIssuer") },
                {
                  Name: "SAAS_JWT_AUDIENCE",
                  Value: { "Fn::Sub": "speedfeast-instance:${AppInstanceId}" },
                },
                { Name: "SAAS_REQUIRE_MTLS", Value: "true" },
                { Name: "SAAS_TRUST_PROXY_MTLS_HEADER", Value: "true" },
                { Name: "SAAS_MTLS_PROXY_MODE", Value: "aws_alb_verify" },
                { Name: "SAAS_INSTANCE_ID", Value: ref("AppInstanceId") },
                { Name: "SAAS_REQUIRE_INSTANCE_CLAIM", Value: "true" },
                { Name: "JWT_EXPIRES_IN", Value: ref("JwtExpiresIn") },
                {
                  Name: "MERCHANT_JWT_EXPIRES_IN",
                  Value: ref("MerchantJwtExpiresIn"),
                },
                { Name: "PAYMENT_PROVIDER", Value: "stripe" },
                { Name: "SMS_PROVIDER", Value: "demo" },
                {
                  Name: "STRIPE_PUBLISHABLE_KEY",
                  Value: ref("StripePublishableKey"),
                },
                { Name: "STRIPE_SUCCESS_URL", Value: ref("StripeSuccessUrl") },
                { Name: "STRIPE_CANCEL_URL", Value: ref("StripeCancelUrl") },
                { Name: "IMAGE_STORAGE_PROVIDER", Value: "s3" },
                { Name: "IMAGE_S3_BUCKET", Value: ref("ImageS3Bucket") },
                {
                  Name: "IMAGE_PUBLIC_BASE_URL",
                  Value: ref("ImagePublicBaseUrl"),
                },
                { Name: "AWS_REGION", Value: input.environment.region },
                { Name: "PGSSLMODE", Value: "verify-full" },
                { Name: "PGSSL_REJECT_UNAUTHORIZED", Value: "true" },
                {
                  Name: "PGSSLROOTCERT",
                  Value: "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem",
                },
                { Name: "APP_IMAGE_REVISION", Value: imageRevision },
              ],
              Secrets: [
                {
                  Name: "DATABASE_URL",
                  ValueFrom: tenantRuntimeSecretValueFrom(
                    tenantRuntimeSecretJsonKeys.databaseUrl,
                  ),
                },
                {
                  Name: "HMAC_SECRET_KEY",
                  ValueFrom: tenantRuntimeSecretValueFrom(
                    tenantRuntimeSecretJsonKeys.hmacSecretKey,
                  ),
                },
                {
                  Name: "JWT_SECRET_KEY",
                  ValueFrom: tenantRuntimeSecretValueFrom(
                    tenantRuntimeSecretJsonKeys.jwtSecretKey,
                  ),
                },
                {
                  Name: "STRIPE_SECRET_KEY",
                  ValueFrom: tenantRuntimeSecretValueFrom(
                    tenantRuntimeSecretJsonKeys.stripeSecretKey,
                  ),
                },
                {
                  Name: "STRIPE_WEBHOOK_SECRET",
                  ValueFrom: tenantRuntimeSecretValueFrom(
                    tenantRuntimeSecretJsonKeys.stripeWebhookSecret,
                  ),
                },
                {
                  Name: "SAAS_CONTROL_PUBLIC_KEY",
                  ValueFrom: ref("ControlPublicKeyValueFrom"),
                },
              ],
              HealthCheck: {
                Command: [
                  "CMD",
                  "/usr/local/bin/node",
                  "-e",
                  "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
                ],
                Interval: 30,
                Timeout: 5,
                Retries: 3,
                StartPeriod: 60,
              },
              LogConfiguration: {
                LogDriver: "awslogs",
                Options: {
                  "awslogs-group": { Ref: "TenantLogGroup" },
                  "awslogs-region": input.environment.region,
                  "awslogs-stream-prefix": "app",
                },
              },
            },
          ],
          Tags: resourceTags,
        },
      },
      TenantTargetGroup: {
        Type: "AWS::ElasticLoadBalancingV2::TargetGroup",
        DependsOn: ["TenantCleanupSchedule"],
        Properties: {
          Name: input.plan.resources.tenant.targetGroup.slice(0, 32),
          VpcId: ref("VpcId"),
          Port: 3000,
          Protocol: "HTTP",
          TargetType: "ip",
          HealthCheckEnabled: true,
          HealthCheckPath: "/ready",
          Matcher: { HttpCode: "200" },
          Tags: resourceTags,
        },
      },
      TenantBusinessControlDenyRule: {
        Type: "AWS::ElasticLoadBalancingV2::ListenerRule",
        DependsOn: ["TenantCleanupSchedule"],
        Properties: {
          ListenerArn: ref("HttpsListenerArn"),
          Priority: input.listenerPriority,
          Conditions: [
            { Field: "host-header", HostHeaderConfig: { Values: [ref("TenantHostname")] } },
            {
              Field: "path-pattern",
              PathPatternConfig: { Values: ["/api/saas", "/api/saas/*"] },
            },
          ],
          Actions: [
            {
              Type: "fixed-response",
              FixedResponseConfig: {
                StatusCode: "404",
                ContentType: "application/json",
                MessageBody: '{"success":false,"code":"NOT_FOUND"}',
              },
            },
          ],
        },
      },
      TenantListenerRule: {
        Type: "AWS::ElasticLoadBalancingV2::ListenerRule",
        Properties: {
          ListenerArn: ref("HttpsListenerArn"),
          Priority: input.listenerPriority + 1,
          Conditions: [
            { Field: "host-header", HostHeaderConfig: { Values: [ref("TenantHostname")] } },
          ],
          Actions: [
            { Type: "forward", TargetGroupArn: { Ref: "TenantTargetGroup" } },
          ],
        },
      },
      TenantControlListenerRule: {
        Type: "AWS::ElasticLoadBalancingV2::ListenerRule",
        Properties: {
          ListenerArn: ref("ControlListenerArn"),
          Priority: input.listenerPriority,
          Conditions: [
            { Field: "host-header", HostHeaderConfig: { Values: [ref("TenantHostname")] } },
            {
              Field: "path-pattern",
              PathPatternConfig: { Values: ["/api/saas", "/api/saas/*"] },
            },
          ],
          Actions: [
            { Type: "forward", TargetGroupArn: { Ref: "TenantTargetGroup" } },
          ],
        },
      },
      TenantService: {
        Type: "AWS::ECS::Service",
        DependsOn: [
          "TenantBusinessControlDenyRule",
          "TenantListenerRule",
          "TenantControlListenerRule",
          "TenantCleanupSchedule",
        ],
        Properties: {
          ServiceName: input.plan.resources.tenant.ecsService,
          Cluster: ref("ClusterName"),
          TaskDefinition: { Ref: "TenantTaskDefinition" },
          // JSON-key Secrets Manager references require Fargate Linux 1.4.0+.
          PlatformVersion: "1.4.0",
          DesiredCount: 1,
          EnableExecuteCommand: false,
          CapacityProviderStrategy: [
            { CapacityProvider: "FARGATE_SPOT", Base: 0, Weight: 1 },
          ],
          DeploymentConfiguration: {
            MinimumHealthyPercent: 0,
            MaximumPercent: 100,
            DeploymentCircuitBreaker: { Enable: true, Rollback: true },
          },
          NetworkConfiguration: {
            AwsvpcConfiguration: {
              AssignPublicIp: "ENABLED",
              SecurityGroups: [ref("TaskSecurityGroupId")],
              Subnets: ref("SubnetIds"),
            },
          },
          LoadBalancers: [
            {
              ContainerName: "speedfeast-backend",
              ContainerPort: 3000,
              TargetGroupArn: { Ref: "TenantTargetGroup" },
            },
          ],
          PropagateTags: "SERVICE",
          Tags: resourceTags,
        },
      },
    },
    Outputs: {
      ServiceName: { Value: { Ref: "TenantService" } },
      TargetGroupArn: { Value: { Ref: "TenantTargetGroup" } },
      TenantHostname: { Value: ref("TenantHostname") },
    },
  };
  const parameters = {
    ImageUri: input.imageUri,
    TenantHostname: input.tenantHostname,
    AppInstanceId: tags.AppInstanceId,
    TenantRuntimeSecretArn: input.runtimeSecretRef,
    CleanupAt: cleanupAt,
  };
  const clientRequestToken =
    (`render-${input.deploymentId}-${input.plan.workflowVersion}` +
      `-e${input.externalOperation.epoch}-${input.externalOperation.operationHash.slice(0, 16)}`)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 128);

  return {
    schemaVersion: 1,
    stackName,
    region: input.environment.region,
    accountId: input.environment.expectedAccountId,
    clientRequestToken,
    onFailure: "ROLLBACK",
    capabilities: [],
    template,
    templateBody: JSON.stringify(template),
    parameters,
    requiredExternalParameters: [
      "ClusterName",
      "VpcId",
      "SubnetIds",
      "TaskSecurityGroupId",
      "HttpsListenerArn",
      "ControlListenerArn",
      "TaskExecutionRoleArn",
      "TaskRoleArn",
      "ControlPublicKeyValueFrom",
      "ControlIssuer",
      "CorsAllowedOrigins",
      "StripePublishableKey",
      "StripeSuccessUrl",
      "StripeCancelUrl",
      "ImageS3Bucket",
      "ImagePublicBaseUrl",
      "JanitorFunctionArn",
      "SchedulerInvokeRoleArn",
      "SchedulerGroupName",
    ],
    tags,
    safety: {
      renderOnly: true,
      applyReady: false,
      callsAws: false,
      containsSecretValues: false,
      allowsNatGateway: false,
      allowsInterfaceEndpoints: false,
      createsDatabaseResources: false,
      controlListenerMtlsRequired: true,
      cleanupScheduleFirst: true,
      fixedTaskCount: 1,
    },
  };
}
