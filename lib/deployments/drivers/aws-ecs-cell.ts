import { getDeploymentProfile } from "../profiles.ts";
import {
  renderAwsSandboxTenantStack,
  type AwsSandboxTenantStackInput,
  type CloudFormationTenantStackPlan,
} from "../cloudformation/tenant-stack.ts";
import type {
  AwsEcsCellDeploymentPlan,
  DeploymentDriver,
  DeploymentPlanMode,
  DeploymentPlanningInput,
} from "../types.ts";

export class DeploymentAutomationDisabledError extends Error {
  readonly code = "AUTOMATION_DISABLED";

  constructor() {
    super("AWS 自动部署尚未启用；当前驱动只生成部署计划。");
  }
}

interface AwsEcsCellDriverOptions {
  region?: string;
  cellKey?: string;
  mode?: DeploymentPlanMode;
}

function safeConfigValue(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim() ?? "";
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(normalized)
    ? normalized
    : fallback;
}

function resourceToken(instanceId: string): string {
  const normalized = instanceId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `tenant-${normalized.slice(-16) || "pending"}`;
}

export class AwsEcsCellPlanOnlyDriver
  implements DeploymentDriver<AwsEcsCellDeploymentPlan>
{
  readonly id = "aws_ecs_cell";
  readonly workflowVersion = "v1";
  private readonly region: string;
  private readonly cellKey: string;
  private readonly mode: DeploymentPlanMode;

  constructor(options: AwsEcsCellDriverOptions = {}) {
    this.region = safeConfigValue(options.region, "ca-central-1");
    this.cellKey = safeConfigValue(options.cellKey, "cell-demo-1");
    this.mode = options.mode ?? "plan_only";
  }

  buildPlan(input: DeploymentPlanningInput): AwsEcsCellDeploymentPlan {
    const profile = getDeploymentProfile(input.deploymentProfileKey);
    const token = resourceToken(input.appInstanceId);
    const databaseToken = token.replaceAll("-", "_");
    const region = safeConfigValue(input.region, this.region);
    const cellKey = safeConfigValue(input.cellKey, this.cellKey);

    return {
      schemaVersion: 1,
      architecture: "aws-ecs-cell",
      driver: "aws_ecs_cell",
      workflowVersion: "v1",
      mode: this.mode,
      region,
      cellKey,
      deploymentProfileKey: profile.key,
      resources: {
        shared: {
          buyerWeb: {
            cloudFront: "shared-buyer-web-cloudfront",
            s3: "shared-buyer-web-s3",
          },
          controlPlane: "shared-saas-control-plane",
        },
        cell: {
          alb: `${cellKey}-alb`,
          databaseCluster: `${cellKey}-aurora-rds`,
          network: {
            vpc: `${cellKey}-vpc`,
            egress: `${cellKey}-nat-or-vpc-endpoints`,
          },
        },
        tenant: {
          ecsService: `${token}-ecs-service`,
          taskDefinition: {
            logicalName: `${token}-task-definition`,
            cpu: profile.ecs.cpu,
            memoryMiB: profile.ecs.memoryMiB,
            desiredCount: profile.ecs.desiredCount,
          },
          targetGroup: `${token}-target-group`,
          listenerRule: `${token}-listener-rule`,
          database: {
            isolation: profile.database.isolation,
            dedicatedClusterLogicalName:
              profile.database.isolation === "dedicated_database"
                ? `${token}-dedicated-aurora-rds`
                : null,
            roleName: `${databaseToken}_role`,
            databaseName: `${databaseToken}_db`,
          },
          secret: { logicalName: `${token}-runtime-secret` },
          autoScaling: { ...profile.autoScaling },
          logs: { logGroupName: `/saas/${cellKey}/${token}` },
          costTags: {
            WorkspaceId: input.workspaceId,
            ProductId: input.productId,
            PlanId: input.planId,
            AppInstanceId: input.appInstanceId,
            CellId: cellKey,
          },
        },
      },
      safety: {
        applyEnabled: false,
        createsAwsResources: false,
        storesSecretValues: false,
      },
    };
  }

  renderTenantStack(
    input: AwsSandboxTenantStackInput,
  ): CloudFormationTenantStackPlan {
    return renderAwsSandboxTenantStack(input);
  }

  async apply(plan: AwsEcsCellDeploymentPlan): Promise<never> {
    void plan;
    throw new DeploymentAutomationDisabledError();
  }
}
