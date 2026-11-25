import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { awsSandboxTenantStackName } from "../../lib/deployments/cloudformation/tenant-stack.ts";
import { SELECT_FIRST_ONBOARDING, loadFirstOnboardingReview, type FirstOnboardingReviewRow } from "../../lib/deployments/first-onboarding.ts";
import type { AwsEcsCellDeploymentPlan } from "../../lib/deployments/types.ts";
import type { DeploymentExecutionBinding } from "../../lib/deployments/execution/contracts.ts";
import type { FirstOpenDispatchSelection } from "../../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { readEcsFirstOpenRelease } from "../../lib/deployments/execution/ecs-first-open-runtime.ts";
import { tenantExternalOperationHash } from "../../lib/deployments/execution/external-ownership-coordinator.ts";
import { FIRST_OPEN_BASELINE_OBJECTS } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { deriveTenantOwnershipMarker, deriveTenantResourceIdentityFromPlan } from "../../lib/deployments/execution/tenant-database.ts";
import { createFirstOpenInspectorSdk, isFirstOpenRoute53Endpoint } from "./first-open-inspector-sdk.ts";
import { bindFirstOpenRdsCell } from "./first-open-rds-cell.ts";
import { createFirstOpenPrivateSecretReader, createFirstOpenRdsControl } from "./first-open-rds-control.ts";
import { createFirstOpenRdsInspector } from "./first-open-rds-inspector.ts";
import { createFirstOpenRdsManagement } from "./first-open-rds-management.ts";
import { createFirstOpenRdsOwnership, createFirstOpenRdsRepository, FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN } from "./first-open-rds-ownership.ts";
import { readFirstOpenRdsResourceBinding, type FirstOpenResourceSecretPin } from "./first-open-resources-binding.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as taskRole } from "./first-open-task-identity.ts";
import type { FirstOpenTaskResourceFactory } from "./first-open-task-runtime.ts";
import { tenantRdsApplicationConfiguration } from "./first-open-tenant-postgres.mjs";

type FactoryInput = Parameters<FirstOpenTaskResourceFactory>[0];
type Env = Readonly<Record<string, string | undefined>>;

const sha = /^[a-f0-9]{64}$/;
const shape = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const missing = () => Error("ECS_FIRST_OPEN_RESOURCE_BINDING");
const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
const mandatoryCellOutputs = ["ClusterName", "HttpsListenerArn", "ControlListenerArn"];
const optionalCellOutputs = ["VpcId", "SubnetIds", "TaskSecurityGroupId"];
const readEnvironmentBinding = `SELECT environment_id AS "environmentId", worker_role_arn AS "workerRoleArn",
  cloudformation_role_arn AS "cloudFormationRoleArn", tenant_stack_parameters::jsonb AS "tenantStackParameters", status
  FROM deployment_environment_bindings WHERE environment_id = $1 AND status = 'active'`;
function validSecret(value: FirstOpenResourceSecretPin) {
  return typeof value?.arn === "string" && value.arn.startsWith(secretPrefix) &&
    /^[A-Za-z0-9/_.+=@-]+-[a-zA-Z0-9]{6}$/.test(value.arn.slice(secretPrefix.length)) && /^[A-Za-z0-9-]{32,64}$/.test(value.versionId);
}
function secretField(raw: string, key: string) {
  try {
    const document: unknown = JSON.parse(raw);
    if (shape(document) && typeof document[key] === "string") return document[key];
  } catch { /* keep secret content out of parse errors */ }
  throw Error("ECS_FIRST_OPEN_PINNED_SECRET_UNVERIFIED");
}

async function readPinnedSecret(pin: FirstOpenResourceSecretPin, identity: FactoryInput["identity"], signal: AbortSignal) {
  // The caller selects one reviewed resource and exact version.
  try {
    const read = createFirstOpenPrivateSecretReader(identity);
    const response = await read(new GetSecretValueCommand({ SecretId: pin.arn, VersionId: pin.versionId }), signal);
    signal.throwIfAborted();
    if (response.ARN !== pin.arn || response.VersionId !== pin.versionId || typeof response.SecretString !== "string" ||
      Buffer.byteLength(response.SecretString) > 65_536 || response.SecretBinary !== undefined) throw missing();
    return response.SecretString;
  } catch {
    throw Error("ECS_FIRST_OPEN_PINNED_SECRET_UNVERIFIED");
  }
}

type ResourceAdapters = {
  now?: () => number;
  openInspectorCloud?: typeof createFirstOpenInspectorSdk;
  readSecret?: typeof readPinnedSecret;
  management?: typeof createFirstOpenRdsManagement;
  inspector?: typeof createFirstOpenRdsInspector;
};

/** Compare the reviewed non-secret document with the approval after the runtime
 * has checked its dispatch ACK against the attested task and revision. */
export function createFirstOpenRdsResourceFactory(env: Env, {
  now = Date.now, openInspectorCloud = createFirstOpenInspectorSdk, readSecret = readPinnedSecret,
  management = createFirstOpenRdsManagement,
  inspector = createFirstOpenRdsInspector,
}: ResourceAdapters = {}): FirstOpenTaskResourceFactory | undefined {
  const pin = readFirstOpenRdsResourceBinding(env);
  if (!pin) return undefined;
  return async ({ approval, identity, readDb, repositorySql, maxWriteBefore, signal }) => {
    const { selection, settings, scope, inspector: inspected, applicationSecret, controlPublicKey } = pin;
    const { fence, target, managementSecret } = pin.management;
    const { tenant, sampling, ingress, mediaPublicBaseUrl } = inspected;
    const { providerVariable, bucketVariable } = sampling.persistence;
    signal.throwIfAborted();
    const expectedSelection: FirstOpenDispatchSelection = { jobId: approval.jobId, instanceId: approval.instanceId,
      workspaceId: approval.workspaceId, releaseId: approval.releaseId, reviewSha256: approval.reviewSha256, hostname: approval.hostname };
    if (identity.roleArn !== taskRole ||
      !same(selection, expectedSelection) || scope.appInstanceId !== selection.instanceId || scope.environmentId !== "env_aws_sandbox_ca_central_1" ||
      !Number.isSafeInteger(settings.writeBefore) || settings.writeBefore > maxWriteBefore || settings.writeBefore <= now() ||
      settings.baselineDigest !== FIRST_OPEN_BASELINE_OBJECTS.archive.sha256 || !/^[A-Za-z0-9._-]{1,100}$/.test(settings.databaseSchemaVersion) ||
      ![ingress.dnsName, "dualstack." + ingress.dnsName].includes(settings.dnsTarget) || !isFirstOpenRoute53Endpoint(inspected.route53Endpoint) ||
      inspected.stackName !== awsSandboxTenantStackName(selection.instanceId) || sampling.apiHostname !== selection.hostname ||
      providerVariable !== "IMAGE_STORAGE_PROVIDER" || bucketVariable !== "IMAGE_S3_BUCKET" ||
      !/^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(mediaPublicBaseUrl) ||
      ![managementSecret, inspected.readSecret, applicationSecret, controlPublicKey, pin.control.credentials].every(validSecret) ||
      !controlPublicKey.arn.startsWith(secretPrefix + "techlong/sandbox/") ||
      (controlPublicKey.jsonKey !== undefined && !/^[A-Za-z0-9_.-]{1,128}$/.test(controlPublicKey.jsonKey)) ||
      new Set([managementSecret, inspected.readSecret, applicationSecret, controlPublicKey, pin.control.credentials].map(s => s.arn)).size !== 5 ||
      tenant.runtimeSecretArn !== applicationSecret.arn || sampling.database.kind !== "instance" || sampling.database.profile !== "full_password" ||
      sampling.database.identifier !== target.dbInstanceIdentifier || sampling.database.schemaVersion !== settings.databaseSchemaVersion ||
      !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-platform-hosting-v1\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sampling.platformStackId) ||
      !mandatoryCellOutputs.every(name => sampling.cellOutputParameters[name] === name) ||
      Object.entries(sampling.cellOutputParameters).some(([key, value]) => key !== value || ![...mandatoryCellOutputs, ...optionalCellOutputs].includes(key)) ||
      sampling.secrets.length !== 2 ||
      ![applicationSecret, controlPublicKey].every(p => sampling.secrets.filter(s => s.arn === p.arn && s.versionId === p.versionId).length === 1) ||
      !["database", "host", "dbInstanceIdentifier", "owner", "databaseOid", "ownershipMarker"].every(key =>
        tenant[key as keyof typeof tenant] === target[key as keyof typeof target]) ||
      new Set([tenant.owner, tenant.username, tenant.applicationRole]).size !== 3 ||
      pin.ownershipTableArn !== FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN || !sha.test(pin.control.configurationSchemaSha256)) throw missing();

    const row = await readDb.prepare(SELECT_FIRST_ONBOARDING).bind(selection.jobId).first<FirstOnboardingReviewRow>();
    if (!row || row.job.id !== selection.jobId || row.job.status !== "pending" || row.job.attempts !== 0) {
      throw Error("ECS_FIRST_OPEN_RESOURCE_REVIEW_CHANGED");
    }
    const release = await readEcsFirstOpenRelease(readDb, selection.releaseId);
    const review = row && release && await loadFirstOnboardingReview(selection.jobId, {
      databaseProfile: "full_password", readOne: async () => row, readRelease: async id => id === release.id ? release : null,
    });
    if (!row || !release || !review || review.reviewSha256 !== selection.reviewSha256 || row.appInstanceId !== selection.instanceId ||
      row.workspaceId !== selection.workspaceId || row.environmentId !== scope.environmentId || row.accountId !== account ||
      row.deployment.id !== scope.deploymentId || row.deployment.planHash !== scope.planHash ||
      row.deployment.configurationHash !== scope.configurationHash || row.deployment.artifactRef !== scope.artifactRef ||
      `${row.slug}.sandbox.techlong.cloud` !== selection.hostname || Number(row.subscriptionEnd) <= settings.writeBefore) {
      throw Error("ECS_FIRST_OPEN_RESOURCE_REVIEW_CHANGED");
    }
    const { productId, environmentId } = review.payload.scope;
    const plan = row.desiredPlan as AwsEcsCellDeploymentPlan;
    const tenantIdentity = await deriveTenantResourceIdentityFromPlan({ appInstanceId: selection.instanceId, workspaceId: selection.workspaceId,
      productId, environmentId, cellKey: plan.cellKey }, plan.resources.tenant.database);
    if (!same(fence.resourceFence.identity, tenantIdentity) || fence.resourceFence.ownershipMarker !== deriveTenantOwnershipMarker(tenantIdentity, 1) ||
      fence.ownerDeploymentId !== scope.deploymentId || fence.resourceFence.ownerDeploymentId !== scope.deploymentId ||
      fence.operationHash !== await tenantExternalOperationHash("provision", fence.resourceFence, { ...row.deployment, artifactRef: scope.artifactRef }) ||
      tenant.applicationRole !== tenantIdentity.roleName) {
      throw Error("ECS_FIRST_OPEN_RESOURCE_FENCE_CHANGED");
    }
    const reader = inspector({ approval: { ...approval, ...settings }, scope: { productId, environmentId }, release, identity, now,
      async material(signal) {
        const databaseUrl = secretField(await readSecret(inspected.readSecret, identity, signal), "database_url");
        return { ...inspected, tenant: { ...tenant, databaseUrl } };
      },
    });
    const repository = createFirstOpenRdsRepository(repositorySql, { scope, approval, fence, writeBefore: settings.writeBefore, now });
    const managed = management({ identity, scope: { ...pin.management, writeBefore: settings.writeBefore, applicationSecretRef: applicationSecret.arn },
      assertActive: (f, signal) => epoch.assertActive(f, signal), now });
    const epoch = createFirstOpenRdsOwnership({ identity, scope, approval, fence, repository, tableArn: pin.ownershipTableArn,
      describeTenantStack: (name, options) => managed.aws.describeTenantStack(name, options), writeBefore: settings.writeBefore, now });
    const applicationDatabase = tenantRdsApplicationConfiguration({ target: { ...target, username: tenant.applicationRole },
      runtimeSecretArn: applicationSecret.arn, versionId: applicationSecret.versionId });
    const controlPorts = createFirstOpenRdsControl({ identity, fence, hostname: selection.hostname, albDnsName: ingress.dnsName,
      templateVersionId: row.templateVersionId, configurationHash: scope.configurationHash, configurationSchemaSha256: pin.control.configurationSchemaSha256,
      artifactRef: scope.artifactRef, writeBefore: settings.writeBefore, readDb, assertActive: epoch.assertActive,
      credentials: pin.control.credentials, applicationSecret, now });

    const cloud = openInspectorCloud(identity.credentials, inspected.route53Endpoint);
    const cell = await bindFirstOpenRdsCell({ pin: pin.cell, cellStackId: sampling.cellStackId, cellOutputParameters: sampling.cellOutputParameters, ingress, tenant, scope,
      writeBefore: settings.writeBefore, now, read: cloud.read });
    const binding = await readDb.prepare(readEnvironmentBinding).bind(scope.environmentId).first<DeploymentExecutionBinding>();
    await cell.checkBinding(binding);
    if (binding?.tenantStackParameters.ControlPublicKeyValueFrom !== controlPublicKey.arn ||
      binding.tenantStackParameters.ControlIssuer !== "https://techlong.cloud") {
      throw Error("ECS_FIRST_OPEN_RESOURCE_CONTROL_KEY_CHANGED");
    }
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, settings.writeBefore - now()))]);
    const caller = await cloud.caller(bounded);
    if (caller.Account !== account || !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxFirstOpenTaskRole\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(caller.Arn ?? "")) {
      throw Error("ECS_FIRST_OPEN_RESOURCE_ROLE_UNVERIFIED");
    }
    await cell.observeSecurity(binding, bounded);
    const publicMaterial = await readSecret(controlPublicKey, identity, bounded);
    const publicKey = controlPublicKey.jsonKey ? secretField(publicMaterial, controlPublicKey.jsonKey) : publicMaterial;
    if (await sha256Hex(publicKey) !== pin.control.credentials.signingPublicKeySha256) {
      throw Error("ECS_FIRST_OPEN_RESOURCE_CONTROL_KEY_CHANGED");
    }
    bounded.throwIfAborted();
    const disabled = () => { throw Error("ECS_FIRST_OPEN_OPERATION_DISABLED"); };
    return { settings, reader, management: {
      config: { workerEnabled: false, applyEnabled: false, confirmation: "", environmentKey: "aws-sandbox-ca-central-1",
        expectedAccountId: account, expectedRegion: region, workerRoleArn: taskRole, leaseDurationMs: 60_000, pollIntervalMs: 5_000 },
      databaseProfile: "full_password", rdsApplicationSecret: applicationSecret, rdsControlPublicKey: controlPublicKey,
      rdsPersistence: { ...sampling.persistence, providerVariable, bucketVariable, mediaPublicBaseUrl },
      cleanupReadiness: cell.cleanupReadiness,
      dependencies: { ...controlPorts, repository, now, applyRuntimeReady: false,
        async awsFactory(request) {
          if (request.region !== region || request.workerRoleArn !== taskRole) throw Error("ECS_FIRST_OPEN_RESOURCE_ROLE_UNVERIFIED");
          return managed.aws;
        },
        tenantDatabase: {
          async ensureTenantDatabase(input) {
            await epoch.assertActive(input.externalFence, input.signal);
            const databaseUrl = secretField(await readSecret(applicationSecret, identity, input.signal), "database_url");
            applicationDatabase.validateDatabaseUrl(databaseUrl);
            return managed.tenantDatabase.ensureTenantDatabase(input);
          },
          migrateTenantDatabase: input => managed.tenantDatabase.migrateTenantDatabase(input),
        },
        tenantExternalOperationCoordinator: epoch.coordinator,
        sharedCellSecurityPreflight: cell.sharedCellSecurityPreflight, cleanupScheduler: { confirmSchedule: disabled },
      },
    } };
  };
}
