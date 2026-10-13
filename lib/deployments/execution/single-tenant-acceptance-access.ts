import { compileSingleTenantLifecycleIamV1 } from "./cell-deployment-prerequisites-v1.ts";
import { compilePreparedLifecycleDeploymentReview } from "./tenant-lifecycle-prepared-review.ts";
import { preparedLifecycleEntrypoint, preparedLifecycleRuntimeMode } from "./tenant-lifecycle-prepared-contract.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE, validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import { PUBLISHED_F3_IMAGES_V1 } from "./cell-launch-readiness-v1.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";

type LifecycleInput = Parameters<typeof compileSingleTenantLifecycleIamV1>[0];
export const FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP = "/ecs/techlong-sandbox-first-acceptance-lifecycle";
type CellTarget = LifecycleInput["deployment"]["managementTarget"];

/** Pre-registration draft needs a real Cell target, not an invented :1/:999
 * task revision. Activation is compiled separately AFTER registration/readback.
 */
export function compileAcceptanceLifecycleRegistration(raw: CellTarget) {
  const target = structuredClone(raw);
  const keys = ["cellId", "clusterArn", "databaseClusterIdentifier", "managementEndpoint", "managementPort",
    "managementSecretArn", "managementDatabase", "managementUsername", "sharedCellEvidenceHash"];
  if (!target || canonicalJson(Object.keys(target).sort()) !== canonicalJson(keys.sort()) ||
    target.cellId !== "cell-sandbox-1" || target.clusterArn !== "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1" ||
    target.databaseClusterIdentifier !== "techlong-sandbox-cell-sandbox-1" || target.managementPort !== 5432 ||
    target.managementDatabase !== "cell_admin" || target.managementUsername !== "cell_admin" ||
    !/^techlong-sandbox-cell-sandbox-1\.cluster-[a-z0-9-]{6,63}\.ca-central-1\.rds\.amazonaws\.com$/.test(target.managementEndpoint) ||
    !/^arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-[A-Za-z0-9/_+=.@!-]{7,512}$/.test(target.managementSecretArn) ||
    !/^[a-f0-9]{64}$/.test(target.sharedCellEvidenceHash)) throw Error("SINGLE_TENANT_REGISTRATION_TARGET_INVALID");
  const environment = { APP_RUNTIME_MODE: preparedLifecycleRuntimeMode, NODE_ENV: "production", AWS_REGION: "ca-central-1",
    PGSSLMODE: "verify-full", PGSSL_REJECT_UNAUTHORIZED: "true", PGSSLROOTCERT: "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem",
    TENANT_CELL_ID: target.cellId, TENANT_CELL_CLUSTER_ARN: target.clusterArn, TENANT_DATABASE_CLUSTER_IDENTIFIER: target.databaseClusterIdentifier,
    TENANT_DATABASE_MANAGEMENT_ENDPOINT: target.managementEndpoint, TENANT_DATABASE_MANAGEMENT_PORT: String(target.managementPort),
    TENANT_DATABASE_MANAGEMENT_SECRET_ARN: target.managementSecretArn, TENANT_DATABASE_MANAGEMENT_DATABASE: target.managementDatabase,
    TENANT_DATABASE_MANAGEMENT_USERNAME: target.managementUsername, TENANT_SHARED_CELL_EVIDENCE_SHA256: target.sharedCellEvidenceHash };
  const definition = { family: "tenant-lifecycle", networkMode: "awsvpc", requiresCompatibilities: ["FARGATE"], cpu: "256", memory: "512",
    runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
    executionRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
    taskRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole", volumes: [{ name: "tenant-lifecycle-workspace" }],
    containerDefinitions: [{ name: "tenant-database-lifecycle", image: FIRST_ACCEPTANCE_APP_IMAGE.replace(PUBLISHED_F3_IMAGES_V1[0].digest, PUBLISHED_F3_IMAGES_V1[1].digest),
      essential: true, entryPoint: [...preparedLifecycleEntrypoint], command: ["--check-bundle"], user: "65532:65532", readonlyRootFilesystem: true,
      mountPoints: [{ sourceVolume: "tenant-lifecycle-workspace", containerPath: "/tmp/tenant-lifecycle", readOnly: false }],
      environment: Object.entries(environment).map(([name, value]) => ({ name, value })),
      logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP,
        "awslogs-region": "ca-central-1", "awslogs-stream-prefix": "lifecycle" } } }] };
  return { definition, observedCoordinatesNotProvedLiveByThisCompiler: true, requiresPostRegistrationReadback: true,
    registrationAuthorized: false, runtimeEnabled: false };
}

/** Consolidates existing prepared-v2 task/activation/least-privilege material.
 * Requires actual post-Cell endpoints, physical Secrets/Keys and registered
 * task ARN as inputs. This DATA compiler does not prove those inputs are live,
 * install IAM/activation, register a task, claim a job, or enable a Worker.
 */
export async function compileSingleTenantAcceptanceAccess(input: {
  scope: SingleDeploymentClaimScope;
  plan: AwsEcsCellDeploymentPlan;
  lifecycle: LifecycleInput;
  controlPublicKeySecretArn: string;
  controlPublicKeyKmsKeyArn: string;
}, now = Date.now()) {
  const scope = validateSingleDeploymentScope(input.scope), fence = input.lifecycle.deployment.tenantFence;
  if (input.plan.mode !== "aws_sandbox" || input.plan.cellKey !== "cell-sandbox-1" || input.plan.deploymentProfileKey !== "standard-v1" ||
    await sha256Hex(input.plan) !== scope.planHash || input.plan.resources.tenant.costTags.AppInstanceId !== scope.appInstanceId ||
    fence.ownerDeploymentId !== scope.deploymentId || fence.identity.appInstanceId !== scope.appInstanceId || fence.identity.environmentId !== scope.environmentId ||
    fence.identity.databaseName !== input.plan.resources.tenant.database.databaseName || fence.identity.roleName !== input.plan.resources.tenant.database.roleName ||
    input.lifecycle.deployment.imageUri !== FIRST_ACCEPTANCE_APP_IMAGE.replace(PUBLISHED_F3_IMAGES_V1[0].digest, PUBLISHED_F3_IMAGES_V1[1].digest) ||
    !/^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/(?:control[-/]|saas-control)[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(input.controlPublicKeySecretArn) ||
    !/^arn:aws:kms:ca-central-1:402010193138:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.controlPublicKeyKmsKeyArn)) {
    throw Error("SINGLE_TENANT_ACCESS_SCOPE_INVALID");
  }
  const appLogGroup = input.plan.resources.tenant.logs.logGroupName;
  if (!/^\/saas\/cell-sandbox-1\/tenant-[a-z0-9]{1,16}$/.test(appLogGroup)) throw Error("SINGLE_TENANT_LOG_SCOPE_INVALID");
  const lifecycleRole = await compileSingleTenantLifecycleIamV1(input.lifecycle, now);
  const prepared = await compilePreparedLifecycleDeploymentReview(input.lifecycle.deployment, now);
  const taskDefinitionDraft = compileAcceptanceLifecycleRegistration(input.lifecycle.deployment.managementTarget).definition;
  const secrets = [input.lifecycle.generationSecretArn, input.controlPublicKeySecretArn];
  const executionRoleSupplement = { roleName: "TechlongSandboxTaskExecutionRole", policyName: "FirstAcceptanceSecretsAndLogsV1",
    policyDocument: { Version: "2012-10-17", Statement: [
      { Sid: "ReadOnlyTenantAndControlPublicKey", Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secrets },
      { Sid: "DecryptOnlyForwardedExecutionSecrets", Effect: "Allow", Action: ["kms:Decrypt"],
        Resource: [...new Set([input.lifecycle.generationKmsKeyArn, input.controlPublicKeyKmsKeyArn])].sort(),
        Condition: { StringEquals: { "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:CallerAccount": "402010193138",
          "kms:EncryptionContext:SecretARN": secrets } } },
      { Sid: "WriteOnlyTwoAcceptanceLogStreams", Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: [appLogGroup, FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP].map((name, i) =>
          `arn:aws:logs:ca-central-1:402010193138:log-group:${name}:log-stream:${i === 0 ? "app" : "lifecycle"}/*`) },
    ] } };
  const material = { scope, lifecycleRole, taskDefinitionDraft, activationItemDraft: prepared.activationItemDraft,
    executionRoleSupplement, lifecycleLogGroupDraft: { Type: "AWS::Logs::LogGroup", Properties: {
      LogGroupName: FIRST_ACCEPTANCE_LIFECYCLE_LOG_GROUP, RetentionInDays: 7,
      Tags: [{ Key: "Environment", Value: "aws-sandbox" }, { Key: "DeliveryTrack", Value: "single-tenant-acceptance" }] } } };
  return { ...material, packageSha256: await sha256Hex(material), mode: "DATA_ONLY_NOT_INSTALLABLE" as const,
    effectivePermissionsVerified: false, cloudWriteCalls: 0, activationInstallationAuthorized: false,
    existingExecutionRolePoliciesAndSharedBoundaryMustBePreserved: true, secretValuesIncluded: false,
    runtimeEnabled: false, executionAuthorized: false,
    lifecycleBoundaryBytes: Buffer.byteLength(canonicalJson(lifecycleRole.boundaryDocument)) };
}
