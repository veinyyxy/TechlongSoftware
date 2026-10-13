import { awsSandboxTenantStackName } from "../cloudformation/tenant-stack.ts";
import { CloudFormationTenantWorkloadLifecycleAdapter, type CloudFormationTenantWorkloadLifecycleConfig } from "./cloudformation-tenant-workload.ts";
import type { AwsDeploymentPort, TenantResourceFence, TenantProvisionPredecessor, TenantWorkloadLifecyclePort } from "./contracts.ts";

export interface SupervisedWorkloadReceiptReader {
  read(input: { fence: TenantResourceFence; provisionPredecessor: TenantProvisionPredecessor; signal: AbortSignal }): Promise<string>;
}
/** Keep the established cleanup epoch/predecessor/lease and ordered cleanup
 * checks, but resolve observations/deletion to the ORIGINAL captured UUID.
 * Missing/unknown create receipt is not absence proof and stops for inspection.
 */
export class SupervisedTenantWorkloadCleanup implements TenantWorkloadLifecyclePort {
  private readonly aws: AwsDeploymentPort;
  private readonly reader: SupervisedWorkloadReceiptReader;
  private readonly config: CloudFormationTenantWorkloadLifecycleConfig;
  constructor(input: { aws: AwsDeploymentPort; reader: SupervisedWorkloadReceiptReader; config: CloudFormationTenantWorkloadLifecycleConfig }) {
    this.aws = input.aws; this.reader = input.reader; this.config = { ...input.config };
  }
  async destroy(input: Parameters<TenantWorkloadLifecyclePort["destroy"]>[0]) {
    input.signal.throwIfAborted();
    const id = await this.reader.read(input), name = awsSandboxTenantStackName(input.fence.identity.appInstanceId);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^arn:aws:cloudformation:ca-central-1:402010193138:stack/${escaped}/[a-f0-9-]{36}$`).test(id)) {
      throw Object.assign(Error("SUPERVISED_WORKLOAD_CREATION_UUID_UNPROVED"), { code: "SUPERVISED_WORKLOAD_CREATION_UUID_UNPROVED", retryable: false });
    }
    const exactAws: AwsDeploymentPort = {
      region: this.aws.region,
      getCallerIdentity: i => this.aws.getCallerIdentity(i),
      applyTenantStack: async () => { throw Error("Cleanup cannot apply a workload"); },
      describeTenantStack: async (_name, i) => {
        const observed = await this.aws.describeTenantStack(id, i);
        if (observed.state !== "missing" && (observed.stackId !== id || observed.tags.DeliveryTrack !== "single-tenant-acceptance" || observed.tags.CleanupMode !== "supervised-reviewed")) {
          throw Object.assign(Error("SUPERVISED_WORKLOAD_UUID_OR_TRACK_DRIFT"), { code: "SUPERVISED_WORKLOAD_UUID_OR_TRACK_DRIFT", retryable: false });
        }
        return observed;
      },
      deleteTenantStack: i => this.aws.deleteTenantStack({ ...i, stackName: id,
        expectedTags: { ...i.expectedTags, DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed" } }),
    };
    return new CloudFormationTenantWorkloadLifecycleAdapter({ aws: exactAws, config: this.config }).destroy(input);
  }
}
