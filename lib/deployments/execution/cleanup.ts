import type { CleanupSchedulePort } from "./contracts.ts";

const stackNamePattern = /^techlong-sandbox-tenant-[a-z0-9]{1,16}$/;

/**
 * Confirms the cleanup boundary represented inside the reviewed tenant stack.
 * CloudFormation must create TenantCleanupSchedule before TenantService. The
 * global Janitor scan remains a separate S3 bootstrap responsibility.
 */
export class EmbeddedCloudFormationCleanupSchedule
  implements CleanupSchedulePort
{
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async confirmSchedule(input: {
    deploymentId: string;
    stackName: string;
    expiresAt: number;
    expectedTags: Record<string, string>;
  }): Promise<{ providerScheduleRef: string; confirmedAt: number }> {
    const current = this.now();
    if (!stackNamePattern.test(input.stackName)) {
      throw new Error("Cleanup schedule stack name is outside the sandbox prefix.");
    }
    if (
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt < current + 5 * 60_000 ||
      input.expiresAt > current + 2 * 60 * 60_000 + 5 * 60_000
    ) {
      throw new Error("Cleanup schedule expiry is outside the two-hour sandbox TTL.");
    }
    if (
      input.expectedTags.Environment !== "aws-sandbox" ||
      input.expectedTags.ManagedBy !== "techlong-provisioner" ||
      input.expectedTags.DeploymentId !== input.deploymentId ||
      !input.expectedTags.ExpiresAt
    ) {
      throw new Error("Cleanup schedule is missing required ownership tags.");
    }
    return {
      providerScheduleRef: `cloudformation:${input.stackName}:TenantCleanupSchedule`,
      confirmedAt: current,
    };
  }
}
