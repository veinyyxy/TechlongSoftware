import { canonicalJson, sha256Hex } from "./hash.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";
import { compilePreparedLifecycleAuthorityEnvironment, preparedLifecycleActivationKey,
  preparedLifecycleEntrypoint, preparedLifecycleRuntimeMode, preparedBaselinePins } from "./tenant-lifecycle-prepared-contract.ts";
import type { TenantResourceFence } from "./contracts.ts";
import type { BackendTenantLifecycleManagementTarget } from "./tenant-lifecycle-management-target.ts";

const account = "402010193138", region = "ca-central-1";
const clusterArn = `arn:aws:ecs:${region}:${account}:cluster/cell-sandbox-1`;
const taskRoleArn = `arn:aws:iam::${account}:role/TechlongSandboxTenantLifecycleTaskRole`;
const executionRoleArn = `arn:aws:iam::${account}:role/TechlongSandboxTaskExecutionRole`;
const tableArn = `arn:aws:dynamodb:${region}:${account}:table/techlong-sandbox-tenant-external-epoch-authority`;
const baselineBucket = `techlong-sandbox-${account}-${region}-tenant-baselines`;
const receiptBucket = `techlong-sandbox-${account}-${region}-tenant-receipts`;
type CellTarget = Omit<BackendTenantLifecycleManagementTarget, "targetDatabaseName" | "targetRoleName">;
export interface PreparedLifecycleDeploymentReviewInput {
  imageUri: string;
  /** Proposed coordinate, not proof that a revision exists or contains this image. */
  taskDefinitionArn: string;
  managementTarget: CellTarget;
  tenantFence: TenantResourceFence;
  notBefore: string;
  expiresAt: string;
}
function fail(): never {
  throw new TenantDatabaseLifecycleError("TENANT_PREPARED_REVIEW_INVALID", "Prepared deployment review coordinates are invalid.");
}
function exact(value: object, keys: readonly string[]) {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Data-only draft compiler. No AWS client, registration, approval, baseline
 * promotion or activation writer. An input digest URI is syntax, not ECR proof.
 * Permission drafts are scoped to ONE reviewed tenant/generation, not tenant:*.
 * This package is not an executable approval manifest. */
export async function compilePreparedLifecycleDeploymentReview(raw: PreparedLifecycleDeploymentReviewInput,
  now = Date.now()) {
  const input = structuredClone(raw), target = input.managementTarget;
  if (!exact(input, ["imageUri", "taskDefinitionArn", "managementTarget", "tenantFence", "notBefore", "expiresAt"]) ||
    !new RegExp(`^${account}\\.dkr\\.ecr\\.${region}\\.amazonaws\\.com/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$`).test(input.imageUri) ||
    !new RegExp(`^arn:aws:ecs:${region}:${account}:task-definition/tenant-lifecycle:[1-9][0-9]*$`).test(input.taskDefinitionArn) ||
    !target || !exact(target, ["cellId", "clusterArn", "databaseClusterIdentifier", "managementEndpoint", "managementPort",
      "managementSecretArn", "managementDatabase", "managementUsername", "sharedCellEvidenceHash"]) ||
    target.cellId !== "cell-sandbox-1" || target.clusterArn !== clusterArn ||
    target.databaseClusterIdentifier !== "techlong-sandbox-cell-sandbox-1" || target.managementPort !== 5432 ||
    target.managementDatabase !== "cell_admin" || target.managementUsername !== "cell_admin" ||
    !/^techlong-sandbox-cell-sandbox-1\.cluster-[a-z0-9-]{6,63}\.ca-central-1\.rds\.amazonaws\.com$/.test(target.managementEndpoint) ||
    !/^arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-[A-Za-z0-9/_+=.@!-]{7,512}$/.test(target.managementSecretArn) ||
    !/^[a-f0-9]{64}$/.test(target.sharedCellEvidenceHash)) fail();
  const start = Date.parse(input.notBefore), end = Date.parse(input.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) ||
    new Date(start).toISOString() !== input.notBefore || new Date(end).toISOString() !== input.expiresAt ||
    end - start < 180000 || end - start > 6 * 3600000 || end - now < 180000) fail();
  const authorityEnvironment = await compilePreparedLifecycleAuthorityEnvironment(input.tenantFence);
  const baseline = {
    archive: { bucket: baselineBucket, key: `approved/${preparedBaselinePins.archiveSha256}/baseline.dump`, sha256: preparedBaselinePins.archiveSha256 },
    manifest: { bucket: baselineBucket, key: `approved/${preparedBaselinePins.manifestSha256}/baseline.manifest.json`, sha256: preparedBaselinePins.manifestSha256 },
  };
  const environment = {
    APP_RUNTIME_MODE: preparedLifecycleRuntimeMode, NODE_ENV: "production", AWS_REGION: region,
    PGSSLMODE: "verify-full", PGSSL_REJECT_UNAUTHORIZED: "true",
    PGSSLROOTCERT: "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem",
    TENANT_CELL_ID: target.cellId, TENANT_CELL_CLUSTER_ARN: target.clusterArn,
    TENANT_DATABASE_CLUSTER_IDENTIFIER: target.databaseClusterIdentifier,
    TENANT_DATABASE_MANAGEMENT_ENDPOINT: target.managementEndpoint,
    TENANT_DATABASE_MANAGEMENT_PORT: String(target.managementPort),
    TENANT_DATABASE_MANAGEMENT_SECRET_ARN: target.managementSecretArn,
    TENANT_DATABASE_MANAGEMENT_DATABASE: target.managementDatabase,
    TENANT_DATABASE_MANAGEMENT_USERNAME: target.managementUsername,
    TENANT_SHARED_CELL_EVIDENCE_SHA256: target.sharedCellEvidenceHash,
  };
  const taskDefinitionDraft = {
    family: "tenant-lifecycle", networkMode: "awsvpc", requiresCompatibilities: ["FARGATE"], cpu: "256", memory: "512",
    runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
    executionRoleArn, taskRoleArn, volumes: [{ name: "tenant-lifecycle-workspace" }],
    containerDefinitions: [{ name: "tenant-database-lifecycle", image: input.imageUri, essential: true,
      entryPoint: [...preparedLifecycleEntrypoint], command: ["--check-bundle"], user: "65532:65532",
      readonlyRootFilesystem: true, mountPoints: [{ sourceVolume: "tenant-lifecycle-workspace", containerPath: "/tmp/tenant-lifecycle", readOnly: false }],
      environment: Object.entries(environment).map(([name, value]) => ({ name, value })),
    }],
  };
  const activationRecordDraft = { schemaVersion: 1, purpose: "tenant-lifecycle-prepared-activation/v1", status: "active",
    notBefore: input.notBefore, expiresAt: input.expiresAt, clusterArn, taskDefinitionArn: input.taskDefinitionArn,
    imageUri: input.imageUri, managementTarget: target, baseline, receiptSchemaVersion: 2 };
  const fence = input.tenantFence;
  const secretResource = `arn:aws:secretsmanager:${region}:${account}:secret:${fence.identity.secretName}/g${fence.generation}-??????`;
  const receiptResource = `arn:aws:s3:::${receiptBucket}/tenant-lifecycle/v1/${fence.identity.stableIdentityHash.slice(0, 32)}/g${fence.generation}/*.json`;
  const taskRolePolicyDraft = { Version: "2012-10-17", Statement: [
    { Sid: "ReadExactActivationAndTenantEpoch", Effect: "Allow", Action: ["dynamodb:GetItem"], Resource: [tableArn],
      Condition: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [preparedLifecycleActivationKey, authorityEnvironment.TENANT_EXTERNAL_AUTHORITY_KEY] },
        Null: { "dynamodb:LeadingKeys": "false" } } },
    // ECS does not support resource-level permission for DescribeTaskDefinition.
    // The read capability is necessarily *, while admission pins the actual ARN.
    { Sid: "DescribeTaskDefinitions", Effect: "Allow", Action: ["ecs:DescribeTaskDefinition"], Resource: ["*"],
      Condition: { StringEquals: { "aws:RequestedRegion": region } } },
    { Sid: "ReadCellTasks", Effect: "Allow", Action: ["ecs:DescribeTasks"], Resource: [`arn:aws:ecs:${region}:${account}:task/cell-sandbox-1/*`] },
    { Sid: "ReadCurrentDatabaseSecrets", Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: [target.managementSecretArn, secretResource],
      Condition: { StringEquals: { "secretsmanager:VersionStage": "AWSCURRENT" } } },
    { Sid: "ReadPinnedBaseline", Effect: "Allow", Action: ["s3:GetObject"], Resource: Object.values(baseline).map(pin => `arn:aws:s3:::${pin.bucket}/${pin.key}`) },
    { Sid: "ReadGenerationReceipts", Effect: "Allow", Action: ["s3:GetObject"], Resource: [receiptResource] },
    { Sid: "PublishGenerationReceipts", Effect: "Allow", Action: ["s3:PutObject"], Resource: [receiptResource],
      Condition: { StringEquals: { "s3:x-amz-server-side-encryption": "AES256", "s3:if-none-match": "*" } } },
  ] };
  const executionRolePolicyDraft = { Version: "2012-10-17", Statement: [
    { Sid: "EcrAuthentication", Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: ["*"] },
    { Sid: "PullLifecycleImage", Effect: "Allow", Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
      Resource: [`arn:aws:ecr:${region}:${account}:repository/techlong-sandbox-speedfeast`] },
  ] };
  const material = { taskDefinitionDraft, activationItemDraft: { authority_key: { S: preparedLifecycleActivationKey },
    schema_version: { N: "2" }, revision: { N: "1" }, record_json: { S: canonicalJson(activationRecordDraft) } },
    taskRolePolicyDraft, executionRolePolicyDraft };
  return freeze({ schemaVersion: 1 as const, mode: "review_only_not_installable" as const,
    runtimeEnabled: false as const, registrationAuthorized: false as const, permissionsInstallationAuthorized: false as const,
    activationInstallationAuthorized: false as const, baselineApproved: false as const, imagePublicationVerified: false as const,
    liveTaskDefinitionVerified: false as const, monthlyBudgetTargetUsd: 50,
    blockers: ["fresh_image_publication_and_registry_readback", "private_baseline_approval_and_immutable_upload",
      "live_cell_endpoint_and_pg_version_readback", "reviewed_iam_and_boundaries_installation", "registered_task_definition_readback",
      "fresh_conditional_activation_write_approval", "fargate_metadata_volume_credentials_and_rds_acceptance",
      "distributed_lease_ttl_and_cleanup_acceptance", "worker_activation_approval"],
    authorityEnvironment, ...material, reviewSha256: await sha256Hex({ lifecycleProtocol: "prepared_v2", authorityEnvironment, ...material }) });
}
