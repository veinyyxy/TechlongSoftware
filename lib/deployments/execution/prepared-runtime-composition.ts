import type {
  AwsDeploymentPort,
  DeploymentExecutionRepository,
  SaaSControlPayloadCompilerPort,
  SharedCellSecurityPreflightPort,
  TenantApprovedBaseline,
} from "./contracts.ts";
import {
  createAwsSdkTenantRuntimeSecretProvider,
  type AwsSdkTenantRuntimeSecretConfig,
  type TenantRuntimeSecretMaterialGenerator,
} from "./aws-sdk-tenant-secret-provider.ts";
import { OrderedTenantResourceCleanup } from "./cleanup.ts";
import {
  AuthorityBackedTenantExternalOwnershipProvider,
  CloudFormationTenantOwnershipReadback,
  type AtomicTenantExternalEpochAuthorityPort,
} from "./cloudformation-external-ownership.ts";
import {
  CloudFormationTenantWorkloadLifecycleAdapter,
  type CloudFormationTenantWorkloadLifecycleConfig,
} from "./cloudformation-tenant-workload.ts";
import {
  MtlsSaaSControlClient,
  type SaaSControlEndpointPolicy,
  type SaaSControlTokenProvider,
  type SaaSControlTransport,
} from "./control-client.ts";
import {
  EcsOneShotTaskRunner,
  type AbortableWaitPort,
  type EcsOneShotTaskApi,
  type EcsOneShotTaskRunnerConfig,
} from "./ecs-one-shot-task.ts";
import { RepositoryTenantExternalOwnershipCoordinator } from "./external-ownership-coordinator.ts";
import {
  GuardedTenantDatabasePort,
  TenantDatabaseLifecycleError,
  validateApprovedBaseline,
} from "./tenant-database.ts";
import {
  EcsOneShotTenantDatabaseLifecycleAdapter,
  ExactTenantRuntimeSecretAdapter,
  type TenantRuntimeSecretProviderApi,
} from "./tenant-aws-one-shot-adapters.ts";
import {
  NodeTenantRuntimeSecretMaterialGenerator,
  type TenantPaymentCredentialSource,
  type TenantRuntimeMaterialConfig,
} from "./tenant-runtime-material.ts";
import type { DeploymentWorkerDependencies } from "./worker.ts";

export const PREPARED_RUNTIME_BLOCKERS = Object.freeze([
  "tenant_lifecycle_provision_image_live_proof_missing",
  "shared_cell_and_authority_live_proof_missing",
  "control_and_cleanup_end_to_end_proof_missing",
  "reviewed_live_activation_missing",
] as const);

export interface PreparedWorkerRuntimeInput {
  repository: DeploymentExecutionRepository;
  aws: AwsDeploymentPort;
  taskApi: EcsOneShotTaskApi;
  waiter: AbortableWaitPort;
  taskConfig: EcsOneShotTaskRunnerConfig;
  secretConfig: AwsSdkTenantRuntimeSecretConfig;
  materialConfig: TenantRuntimeMaterialConfig;
  paymentCredentials: TenantPaymentCredentialSource;
  approvedBaseline: TenantApprovedBaseline;
  epochAuthority: AtomicTenantExternalEpochAuthorityPort;
  workloadConfig: CloudFormationTenantWorkloadLifecycleConfig;
  sharedCellSecurityPreflight: SharedCellSecurityPreflightPort;
  controlTransport: SaaSControlTransport;
  controlTokens: SaaSControlTokenProvider;
  controlEndpoint: SaaSControlEndpointPolicy;
  controlPayloadCompiler: SaaSControlPayloadCompilerPort;
  /** Construction-only test seam; the default constructs the actual AWS SDK provider. */
  secretProviderFactory?: (
    generator: TenantRuntimeSecretMaterialGenerator,
    config: AwsSdkTenantRuntimeSecretConfig,
  ) => Promise<TenantRuntimeSecretProviderApi>;
}

export type PreparedWorkerRuntime = Readonly<
  Required<Pick<DeploymentWorkerDependencies,
    | "sharedCellSecurityPreflight" | "tenantDatabase" | "tenantResourceCleanup"
    | "tenantExternalOperationCoordinator" | "controlClient" | "controlPayloadCompiler"
  >> & {
    mode: "prepared_not_activated";
    applyRuntimeReady: false;
    cleanupRuntimeReady: false;
    blockers: typeof PREPARED_RUNTIME_BLOCKERS;
  }
>;

/**
 * Real composition, not another cloud simulator: Secret generation, one-shot
 * lifecycle, ordered cleanup and the provider-backed ownership coordinator
 * use the SAME instances. Assembly never submits a task, changes IAM, claims
 * a job or activates a readiness gate. It accepts no enablement boolean.
 *
 * Only a separately reviewed live root may consume these capabilities after
 * proving the deployed provision image, Cell, authority and cleanup path.
 */
export async function createPreparedDeploymentWorkerRuntime(
  input: PreparedWorkerRuntimeInput,
): Promise<PreparedWorkerRuntime> {
  const baseline = Object.freeze({ ...validateApprovedBaseline(input.approvedBaseline) });
  const secretConfig = { ...input.secretConfig };
  const taskConfig = structuredClone(input.taskConfig);
  const workloadConfig = { ...input.workloadConfig };
  if (
    secretConfig.expectedAccountId !== "402010193138" ||
    secretConfig.expectedRegion !== "ca-central-1" ||
    secretConfig.expectedWorkerRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    taskConfig.environmentKind !== "aws_sandbox" ||
    taskConfig.expectedAccountId !== secretConfig.expectedAccountId ||
    taskConfig.expectedRegion !== secretConfig.expectedRegion ||
    workloadConfig.expectedAccountId !== secretConfig.expectedAccountId ||
    workloadConfig.expectedRegion !== secretConfig.expectedRegion ||
    input.materialConfig.expectedRegion !== secretConfig.expectedRegion ||
    input.aws.region !== secretConfig.expectedRegion ||
    input.controlEndpoint.baseDomain !== "sandbox.techlong.cloud"
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RUNTIME_COMPOSITION_SCOPE_INVALID",
      "Worker components must share the exact reviewed account, region, role and control domain.",
    );
  }
  const generator = new NodeTenantRuntimeSecretMaterialGenerator(input.materialConfig, input.paymentCredentials);
  const runner = new EcsOneShotTaskRunner({ api: input.taskApi, waiter: input.waiter, config: structuredClone(taskConfig) });
  const workload = new CloudFormationTenantWorkloadLifecycleAdapter({ aws: input.aws, config: { ...workloadConfig } });
  const controlClient = new MtlsSaaSControlClient(input.controlTransport, input.controlTokens, { ...input.controlEndpoint });
  // Validate all local construction before loading SDK modules. SDK construction
  // does not resolve credentials or make a cloud call.
  const factory = input.secretProviderFactory ?? ((materialGenerator, config) =>
    createAwsSdkTenantRuntimeSecretProvider({ materialGenerator, config }));
  const provider = await factory(generator, { ...secretConfig });
  const exactSecrets = new ExactTenantRuntimeSecretAdapter({
    provider,
    expectedAccountId: secretConfig.expectedAccountId,
    expectedRegion: secretConfig.expectedRegion,
  });
  const secrets = generator.bindSecretStore(exactSecrets);
  const lifecycle = new EcsOneShotTenantDatabaseLifecycleAdapter({
    runner,
    secretRefs: exactSecrets,
    approvedBaselineDigest: baseline.archiveSha256,
  });
  const tenantDatabase = new GuardedTenantDatabasePort({ lifecycle, secrets, approvedBaseline: baseline });
  const tenantResourceCleanup = new OrderedTenantResourceCleanup({
    repository: input.repository, workload, database: lifecycle, secrets,
  });
  const external = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: input.epochAuthority,
    workload: new CloudFormationTenantOwnershipReadback(input.aws),
  });
  const tenantExternalOperationCoordinator = new RepositoryTenantExternalOwnershipCoordinator(input.repository, external);
  return Object.freeze({
    mode: "prepared_not_activated" as const,
    applyRuntimeReady: false as const,
    cleanupRuntimeReady: false as const,
    blockers: PREPARED_RUNTIME_BLOCKERS,
    sharedCellSecurityPreflight: input.sharedCellSecurityPreflight,
    tenantDatabase,
    tenantResourceCleanup,
    tenantExternalOperationCoordinator,
    controlClient,
    controlPayloadCompiler: input.controlPayloadCompiler,
  });
}
