import type { DeploymentProfileKey } from "./profiles.ts";

export type DeploymentPlanMode = "plan_only" | "aws_sandbox" | "aws_production";
export type { DeploymentStatus } from "./state-machine.ts";

export interface AwsEcsCellDeploymentPlan {
  schemaVersion: 1;
  architecture: "aws-ecs-cell";
  driver: "aws_ecs_cell";
  workflowVersion: "v1";
  mode: DeploymentPlanMode;
  region: string;
  cellKey: string;
  deploymentProfileKey: DeploymentProfileKey;
  resources: {
    shared: {
      buyerWeb: { cloudFront: string; s3: string };
      controlPlane: string;
    };
    cell: {
      alb: string;
      databaseCluster: string;
      network: { vpc: string; egress: string };
    };
    tenant: {
      ecsService: string;
      taskDefinition: {
        logicalName: string;
        cpu: number;
        memoryMiB: number;
        desiredCount: number;
      };
      targetGroup: string;
      listenerRule: string;
      database: {
        isolation: "tenant_database" | "dedicated_database";
        dedicatedClusterLogicalName: string | null;
        roleName: string;
        databaseName: string;
      };
      secret: { logicalName: string };
      autoScaling: { minCapacity: number; maxCapacity: number };
      logs: { logGroupName: string };
      costTags: Record<string, string>;
    };
  };
  safety: {
    applyEnabled: false;
    createsAwsResources: false;
    storesSecretValues: false;
  };
}

export interface DeploymentPlanningInput {
  appInstanceId: string;
  workspaceId: string;
  productId: string;
  planId: string;
  subscriptionId: string;
  tenantKey: string;
  deploymentProfileKey: DeploymentProfileKey;
  cellKey?: string;
  region?: string;
  /** Untrusted customer configuration is accepted at the boundary but never copied into AWS plans. */
  configurationSnapshot?: unknown;
  /** Runtime secrets are intentionally ignored by the plan-only driver. */
  runtimeSecrets?: unknown;
}

export interface DeploymentDriver<Plan> {
  readonly id: string;
  readonly workflowVersion: string;
  buildPlan(input: DeploymentPlanningInput): Plan;
  apply(plan: Plan): Promise<never>;
}

export interface DeploymentTemplateRenderer<RenderInput, Artifact> {
  render(input: RenderInput): Artifact;
}
