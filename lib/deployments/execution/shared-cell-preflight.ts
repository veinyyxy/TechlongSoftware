import type {
  DeploymentExecutionBinding,
  SharedCellSecurityPreflightPort,
} from "./contracts.ts";
import type { DeploymentEnvironment } from "../environment.ts";

export interface SharedCellListenerObservation {
  arn: string;
  protocol: "HTTPS";
  port: number;
  mutualAuthenticationMode: "off" | "passthrough" | "verify";
}

export interface SharedCellSecurityObservation {
  accountId: string;
  region: string;
  clusterName: string;
  vpcId: string;
  subnetIds: string[];
  httpsListener: SharedCellListenerObservation;
  controlListener: SharedCellListenerObservation;
  loadBalancerSecurityGroupIds: string[];
  taskSecurityGroup: {
    id: string;
    vpcId: string;
    ingress: Array<{
      protocol: "tcp" | string;
      fromPort: number;
      toPort: number;
      sourceSecurityGroupId?: string;
      cidrIpv4?: string;
      cidrIpv6?: string;
      prefixListId?: string;
    }>;
  };
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function assertSharedCellSecurityObservation(input: {
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  observation: SharedCellSecurityObservation;
}): void {
  const { environment, binding, observation } = input;
  const parameters = binding.tenantStackParameters;
  if (
    observation.accountId !== environment.expectedAccountId ||
    observation.region !== environment.region ||
    observation.clusterName !== parameters.ClusterName ||
    observation.vpcId !== parameters.VpcId ||
    observation.taskSecurityGroup.id !== parameters.TaskSecurityGroupId ||
    observation.taskSecurityGroup.vpcId !== parameters.VpcId
  ) {
    throw new Error("Shared Cell security observation does not match the deployment binding.");
  }
  if (
    sorted(observation.subnetIds).join(",") !==
    sorted(parameters.SubnetIds.split(",").map((value) => value.trim())).join(",")
  ) {
    throw new Error("Shared Cell subnet observation does not match the deployment binding.");
  }
  if (
    observation.httpsListener.arn !== parameters.HttpsListenerArn ||
    observation.httpsListener.protocol !== "HTTPS" ||
    observation.httpsListener.port !== 443
  ) {
    throw new Error("Shared Cell business listener is not the reviewed HTTPS listener.");
  }
  if (
    observation.controlListener.arn !== parameters.ControlListenerArn ||
    observation.controlListener.protocol !== "HTTPS" ||
    observation.controlListener.port !== 8443 ||
    observation.controlListener.mutualAuthenticationMode !== "verify"
  ) {
    throw new Error("Shared Cell control listener must use HTTPS 8443 with mTLS verify mode.");
  }
  const albSecurityGroups = new Set(observation.loadBalancerSecurityGroupIds);
  if (albSecurityGroups.size < 1) {
    throw new Error("Shared Cell load balancer has no observed security group.");
  }
  if (
    observation.taskSecurityGroup.ingress.length < 1 ||
    observation.taskSecurityGroup.ingress.some(
      (rule) =>
        rule.protocol !== "tcp" ||
        rule.fromPort !== 3000 ||
        rule.toPort !== 3000 ||
        !rule.sourceSecurityGroupId ||
        !albSecurityGroups.has(rule.sourceSecurityGroupId) ||
        Boolean(rule.cidrIpv4 || rule.cidrIpv6 || rule.prefixListId),
    )
  ) {
    throw new Error(
      "Shared Cell task security group must allow port 3000 only from an observed ALB security group.",
    );
  }
}

export class DisabledSharedCellSecurityPreflight
  implements SharedCellSecurityPreflightPort
{
  async verify(): Promise<never> {
    const error = new Error(
      "ELBv2 and EC2 Shared Cell security preflight adapters are not configured.",
    );
    Object.assign(error, {
      code: "SHARED_CELL_SECURITY_PREFLIGHT_DISABLED",
      retryable: false,
    });
    throw error;
  }
}
