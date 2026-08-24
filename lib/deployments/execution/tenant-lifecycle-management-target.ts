import type { TenantResourceFence } from "./contracts.ts";
import { canonicalJson } from "./hash.ts";
import {
  assertTenantResourceFence,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";
import { assertVerifiedSharedCellLifecycleEvidence } from "./shared-cell-evidence-adapter.ts";
import type { OfflineTenantLifecycleTaskBinding } from "./tenant-lifecycle-task-binding.ts";
import type { VerifiedSharedCellLifecycleEvidence } from "./shared-cell-preflight.ts";

const sandboxAccountId = "402010193138";
const sandboxRegion = "ca-central-1";
const sandboxCellId = "cell-sandbox-1";
const managementDatabase = "cell_admin";
const managementUsername = "cell_admin";
const evidenceFreshnessWindowMs = 5 * 60_000;
const tenantDatabaseNamePattern = /^tenant_([a-z0-9]{1,16})_db$/;
const tenantRoleNamePattern = /^tenant_([a-z0-9]{1,16})_role$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const subnetIdPattern = /^subnet-[a-f0-9]{8,17}$/;
const securityGroupIdPattern = /^sg-[a-f0-9]{8,17}$/;
const hostnamePattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const rdsManagedSecretArnPattern =
  /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:rds!cluster-[A-Za-z0-9/_+=.@!-]{7,512}$/;
const inputKeys = [
  "taskBinding",
  "sharedCellEvidence",
  "resourceFence",
] as const;
const taskBindingKeys = [
  "schemaVersion",
  "mode",
  "registrationReady",
  "liveReadbackReady",
  "blocker",
  "image",
  "taskDefinition",
  "clusterArn",
  "receiptBucketArn",
  "commands",
  "networkIntent",
] as const;
const networkIntentKeys = [
  "candidateSubnetIds",
  "candidateOneShotSecurityGroupId",
  "assignPublicIp",
  "sharedCellEvidenceReady",
] as const;
const evidenceKeys = [
  "schemaVersion",
  "verified",
  "observedAt",
  "accountId",
  "region",
  "cellId",
  "clusterArn",
  "taskSubnetIds",
  "oneShotTaskSecurityGroupId",
  "databaseClusterArn",
  "databaseClusterIdentifier",
  "managementEndpoint",
  "managementPort",
  "managementSecretArn",
  "managementDatabase",
  "managementUsername",
  "sharedCellEvidenceHash",
] as const;
const managementTargetKeys = [
  "schemaVersion",
  "registrationReady",
  "liveReadbackReady",
  "cellId",
  "clusterArn",
  "databaseClusterIdentifier",
  "managementEndpoint",
  "managementPort",
  "managementSecretArn",
  "managementDatabase",
  "managementUsername",
  "targetDatabaseName",
  "targetRoleName",
  "sharedCellEvidenceHash",
] as const;
const backendWireTargetKeys = [
  "cellId",
  "clusterArn",
  "databaseClusterIdentifier",
  "managementEndpoint",
  "managementPort",
  "managementSecretArn",
  "managementDatabase",
  "managementUsername",
  "targetDatabaseName",
  "targetRoleName",
  "sharedCellEvidenceHash",
] as const;
const compiledManagementTargets = new WeakMap<
  object,
  Readonly<{ observedAt: number; validThrough: number }>
>();
const systemClock: TenantLifecycleManagementClock = Object.freeze({
  now: () => Date.now(),
});

export interface TenantLifecycleManagementClock {
  now(): number;
}

export interface TenantLifecycleManagementTargetInput {
  taskBinding: OfflineTenantLifecycleTaskBinding;
  sharedCellEvidence: VerifiedSharedCellLifecycleEvidence;
  resourceFence: TenantResourceFence;
}

export interface TenantLifecycleManagementTarget {
  readonly schemaVersion: 1;
  readonly registrationReady: false;
  readonly liveReadbackReady: false;
  readonly cellId: "cell-sandbox-1";
  readonly clusterArn: string;
  readonly databaseClusterIdentifier: string;
  readonly managementEndpoint: string;
  readonly managementPort: 5432;
  readonly managementSecretArn: string;
  readonly managementDatabase: "cell_admin";
  readonly managementUsername: "cell_admin";
  readonly targetDatabaseName: string;
  readonly targetRoleName: string;
  readonly sharedCellEvidenceHash: string;
}

export type BackendTenantLifecycleManagementTarget = Readonly<
  Pick<
    TenantLifecycleManagementTarget,
    | "cellId"
    | "clusterArn"
    | "databaseClusterIdentifier"
    | "managementEndpoint"
    | "managementPort"
    | "managementSecretArn"
    | "managementDatabase"
    | "managementUsername"
    | "targetDatabaseName"
    | "targetRoleName"
    | "sharedCellEvidenceHash"
  >
>;

function fail(message: string): never {
  throw new TenantDatabaseLifecycleError(
    "TENANT_LIFECYCLE_MANAGEMENT_TARGET_INVALID",
    message,
  );
}

function readClock(clock: TenantLifecycleManagementClock): number {
  if (!clock || typeof clock.now !== "function") {
    fail("Lifecycle management target clock is unavailable.");
  }
  let value: number;
  try {
    value = clock.now();
  } catch {
    fail("Lifecycle management target clock could not be read.");
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("Lifecycle management target clock returned an invalid timestamp.");
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    canonicalJson([...new Set(left)].sort()) ===
    canonicalJson([...new Set(right)].sort())
  );
}

/**
 * Binds one tenant's immutable database/role names to a fully verified Shared
 * Cell management endpoint. The result is reference-only reviewed intent: it
 * cannot register or describe a TaskDefinition and cannot configure a Worker.
 */
export function compileTenantLifecycleManagementTarget(
  input: TenantLifecycleManagementTargetInput,
  clock: TenantLifecycleManagementClock = systemClock,
): TenantLifecycleManagementTarget {
  if (!input || typeof input !== "object" || !exactKeys(input, inputKeys)) {
    fail("Lifecycle management target input contains missing or unexpected fields.");
  }

  const taskBinding = input.taskBinding;
  if (
    !taskBinding ||
    typeof taskBinding !== "object" ||
    !exactKeys(taskBinding, taskBindingKeys) ||
    taskBinding.schemaVersion !== 1 ||
    taskBinding.mode !== "offline_reviewed_intent" ||
    taskBinding.registrationReady !== false ||
    taskBinding.liveReadbackReady !== false ||
    taskBinding.blocker !==
      "tenant_lifecycle_task_definition_live_readback_missing" ||
    !taskBinding.networkIntent ||
    typeof taskBinding.networkIntent !== "object" ||
    !exactKeys(taskBinding.networkIntent, networkIntentKeys) ||
    taskBinding.networkIntent.assignPublicIp !== "ENABLED" ||
    taskBinding.networkIntent.sharedCellEvidenceReady !== false
  ) {
    fail("Lifecycle task binding is not the reviewed offline B5-J1 intent.");
  }

  const evidence = input.sharedCellEvidence;
  try {
    assertVerifiedSharedCellLifecycleEvidence(evidence);
  } catch {
    fail("Lifecycle management target requires adapter-verified Shared Cell evidence.");
  }
  if (
    !evidence ||
    typeof evidence !== "object" ||
    !exactKeys(evidence, evidenceKeys) ||
    evidence.schemaVersion !== 1 ||
    evidence.verified !== true ||
    evidence.accountId !== sandboxAccountId ||
    evidence.region !== sandboxRegion ||
    evidence.cellId !== sandboxCellId ||
    !Number.isSafeInteger(evidence.observedAt) ||
    evidence.observedAt <= 0 ||
    !sha256Pattern.test(evidence.sharedCellEvidenceHash)
  ) {
    fail("Lifecycle management target requires exact verified Sandbox Shared Cell evidence.");
  }
  const currentTime = readClock(clock);
  const validThrough = evidence.observedAt + evidenceFreshnessWindowMs;
  if (
    !Number.isSafeInteger(validThrough) ||
    evidence.observedAt > currentTime ||
    currentTime > validThrough
  ) {
    fail("Lifecycle management target requires fresh Shared Cell evidence.");
  }

  const expectedClusterArn =
    `arn:aws:ecs:${sandboxRegion}:${sandboxAccountId}:cluster/${sandboxCellId}`;
  if (
    evidence.clusterArn !== expectedClusterArn ||
    taskBinding.clusterArn !== evidence.clusterArn ||
    !Array.isArray(taskBinding.networkIntent.candidateSubnetIds) ||
    taskBinding.networkIntent.candidateSubnetIds.length !== 2 ||
    new Set(taskBinding.networkIntent.candidateSubnetIds).size !== 2 ||
    taskBinding.networkIntent.candidateSubnetIds.some(
      (value) => !subnetIdPattern.test(value),
    ) ||
    !securityGroupIdPattern.test(
      taskBinding.networkIntent.candidateOneShotSecurityGroupId,
    ) ||
    !Array.isArray(evidence.taskSubnetIds) ||
    evidence.taskSubnetIds.length !== 2 ||
    new Set(evidence.taskSubnetIds).size !== 2 ||
    evidence.taskSubnetIds.some((value) => !subnetIdPattern.test(value)) ||
    !securityGroupIdPattern.test(evidence.oneShotTaskSecurityGroupId) ||
    !sameSet(
      taskBinding.networkIntent.candidateSubnetIds,
      evidence.taskSubnetIds,
    ) ||
    taskBinding.networkIntent.candidateOneShotSecurityGroupId !==
      evidence.oneShotTaskSecurityGroupId
  ) {
    fail("Lifecycle task cluster or candidate network differs from verified Shared Cell evidence.");
  }

  const expectedDatabaseClusterIdentifier =
    `techlong-sandbox-${sandboxCellId}`;
  const expectedDatabaseClusterArn =
    `arn:aws:rds:${sandboxRegion}:${sandboxAccountId}:cluster:` +
    expectedDatabaseClusterIdentifier;
  const expectedEndpointPrefix = `${expectedDatabaseClusterIdentifier}.cluster-`;
  const expectedEndpointSuffix = `.${sandboxRegion}.rds.amazonaws.com`;
  const endpointToken = evidence.managementEndpoint.slice(
    expectedEndpointPrefix.length,
    evidence.managementEndpoint.length - expectedEndpointSuffix.length,
  );
  const expectedSecretPrefix =
    `arn:aws:secretsmanager:${sandboxRegion}:${sandboxAccountId}:` +
    "secret:rds!cluster-";
  if (
    evidence.databaseClusterIdentifier !== expectedDatabaseClusterIdentifier ||
    evidence.databaseClusterArn !== expectedDatabaseClusterArn ||
    !evidence.managementEndpoint.startsWith(expectedEndpointPrefix) ||
    !evidence.managementEndpoint.endsWith(expectedEndpointSuffix) ||
    !/^[a-z0-9-]{6,63}$/.test(endpointToken) ||
    !hostnamePattern.test(evidence.managementEndpoint) ||
    !evidence.managementSecretArn.startsWith(expectedSecretPrefix) ||
    !rdsManagedSecretArnPattern.test(evidence.managementSecretArn) ||
    evidence.managementPort !== 5432 ||
    evidence.managementDatabase !== managementDatabase ||
    evidence.managementUsername !== managementUsername
  ) {
    fail("Lifecycle management database references differ from the reviewed Shared Cell target.");
  }

  try {
    assertTenantResourceFence(input.resourceFence);
  } catch {
    fail("Lifecycle tenant database target requires an exact immutable resource fence.");
  }
  const identity = input.resourceFence.identity;
  const databaseName = tenantDatabaseNamePattern.exec(identity.databaseName);
  const roleName = tenantRoleNamePattern.exec(identity.roleName);
  if (
    identity.cellKey !== sandboxCellId ||
    !databaseName ||
    !roleName ||
    databaseName[1] !== roleName[1]
  ) {
    fail("Lifecycle tenant database and role names are outside the reviewed Cell target.");
  }

  const target: TenantLifecycleManagementTarget = Object.freeze({
    schemaVersion: 1 as const,
    registrationReady: false as const,
    liveReadbackReady: false as const,
    cellId: sandboxCellId,
    clusterArn: evidence.clusterArn,
    databaseClusterIdentifier: evidence.databaseClusterIdentifier,
    managementEndpoint: evidence.managementEndpoint,
    managementPort: 5432 as const,
    managementSecretArn: evidence.managementSecretArn,
    managementDatabase,
    managementUsername,
    targetDatabaseName: identity.databaseName,
    targetRoleName: identity.roleName,
    sharedCellEvidenceHash: evidence.sharedCellEvidenceHash,
  });
  compiledManagementTargets.set(
    target,
    Object.freeze({ observedAt: evidence.observedAt, validThrough }),
  );
  return target;
}

/**
 * Removes review-only metadata and produces the backend's exact normalized
 * managementTarget object. Field names deliberately match the backend wire
 * contract; this mapper never renames or invents a value.
 */
export function projectTenantLifecycleManagementTargetForBackend(
  target: TenantLifecycleManagementTarget,
  clock: TenantLifecycleManagementClock = systemClock,
): BackendTenantLifecycleManagementTarget {
  const endpoint = target?.managementEndpoint ?? "";
  const secretArn = target?.managementSecretArn ?? "";
  const databaseName = tenantDatabaseNamePattern.exec(target?.targetDatabaseName ?? "");
  const roleName = tenantRoleNamePattern.exec(target?.targetRoleName ?? "");
  const expectedDatabaseClusterIdentifier = `techlong-sandbox-${sandboxCellId}`;
  const expectedEndpointPrefix = `${expectedDatabaseClusterIdentifier}.cluster-`;
  const expectedEndpointSuffix = `.${sandboxRegion}.rds.amazonaws.com`;
  const endpointToken = endpoint.slice(
    expectedEndpointPrefix.length,
    endpoint.length - expectedEndpointSuffix.length,
  );
  const expectedSecretPrefix =
    `arn:aws:secretsmanager:${sandboxRegion}:${sandboxAccountId}:` +
    "secret:rds!cluster-";
  const evidenceValidity =
    target && typeof target === "object"
      ? compiledManagementTargets.get(target)
      : undefined;
  const currentTime = evidenceValidity ? readClock(clock) : null;
  if (
    !target ||
    typeof target !== "object" ||
    !evidenceValidity ||
    currentTime === null ||
    currentTime < evidenceValidity.observedAt ||
    currentTime > evidenceValidity.validThrough ||
    !exactKeys(target, managementTargetKeys) ||
    target.schemaVersion !== 1 ||
    target.registrationReady !== false ||
    target.liveReadbackReady !== false ||
    target.cellId !== sandboxCellId ||
    target.clusterArn !==
      `arn:aws:ecs:${sandboxRegion}:${sandboxAccountId}:cluster/${sandboxCellId}` ||
    target.databaseClusterIdentifier !== expectedDatabaseClusterIdentifier ||
    target.managementPort !== 5432 ||
    target.managementDatabase !== managementDatabase ||
    target.managementUsername !== managementUsername ||
    !endpoint.startsWith(expectedEndpointPrefix) ||
    !endpoint.endsWith(expectedEndpointSuffix) ||
    !/^[a-z0-9-]{6,63}$/.test(endpointToken) ||
    !hostnamePattern.test(endpoint) ||
    !secretArn.startsWith(expectedSecretPrefix) ||
    !rdsManagedSecretArnPattern.test(secretArn) ||
    !databaseName ||
    !roleName ||
    databaseName[1] !== roleName[1] ||
    !sha256Pattern.test(target.sharedCellEvidenceHash)
  ) {
    fail("Lifecycle management target cannot be projected to the backend wire contract.");
  }

  const projection = Object.freeze({
    cellId: target.cellId,
    clusterArn: target.clusterArn,
    databaseClusterIdentifier: target.databaseClusterIdentifier,
    managementEndpoint: target.managementEndpoint,
    managementPort: target.managementPort,
    managementSecretArn: target.managementSecretArn,
    managementDatabase: target.managementDatabase,
    managementUsername: target.managementUsername,
    targetDatabaseName: target.targetDatabaseName,
    targetRoleName: target.targetRoleName,
    sharedCellEvidenceHash: target.sharedCellEvidenceHash,
  });
  if (!exactKeys(projection, backendWireTargetKeys)) {
    fail("Lifecycle backend management target projection contains field drift.");
  }
  return projection;
}
