import type {
  DeploymentExecutionContext,
  TenantApprovedBaseline,
  TenantDatabaseInspection,
  TenantDatabaseLifecyclePort,
  TenantDatabaseLifecycleState,
  TenantDatabaseMutationReceipt,
  TenantDatabasePort,
  TenantExternalOperationFence,
  TenantResourceFence,
  TenantResourceIdentity,
  TenantSecretInspection,
  TenantSecretReceipt,
  TenantSecretStorePort,
} from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const postgresIdentifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const secretRefPattern =
  /^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g[1-9][0-9]*-[A-Za-z0-9]{6}$/;
const secretNamePattern =
  /^techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime$/;
const baselineArchivePattern =
  /^s3:\/\/[a-z0-9][a-z0-9.-]{1,62}\/_migration\/[A-Za-z0-9][A-Za-z0-9._/-]*\.dump$/;
const baselineManifestPattern =
  /^s3:\/\/[a-z0-9][a-z0-9.-]{1,62}\/_migration\/[A-Za-z0-9][A-Za-z0-9._/-]*\.manifest\.json$/;
const saasMigrationContract = "speedfeast-saas-control-v1" as const;
const saasMigrationCommand =
  "/usr/local/bin/node db/apply_saas_control.js" as const;

const identityKeys = [
  "schemaVersion",
  "appInstanceId",
  "workspaceId",
  "productId",
  "environmentId",
  "cellKey",
  "databaseName",
  "roleName",
  "secretName",
  "stableIdentityHash",
] as const;

const fenceKeys = [
  "schemaVersion",
  "identity",
  "generation",
  "ownerDeploymentId",
  "ownershipMarker",
] as const;

export class TenantDatabaseBoundaryDisabledError extends Error {
  readonly code = "TENANT_DATABASE_BOUNDARY_DISABLED";
  readonly retryable = false;

  constructor() {
    super(
      "Tenant database provisioning is not configured; CloudFormation apply remains blocked.",
    );
  }
}

export class TenantDatabaseLifecycleError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ADAPTER_CONTRACT_INVALID",
      `${label} contains missing or unexpected fields.`,
    );
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!postgresIdentifierPattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_NAME_INVALID",
      `${label} must contain only lowercase letters, numbers, and underscores.`,
    );
  }
}

function assertIdempotencyKey(value: string): void {
  if (!idempotencyKeyPattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_IDEMPOTENCY_KEY_INVALID",
      "Tenant database idempotency key is invalid.",
    );
  }
}

function stableStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-28) || "pending";
}

export async function deriveTenantResourceIdentity(
  context: DeploymentExecutionContext,
): Promise<TenantResourceIdentity> {
  if (
    context.deployment.appInstanceId !== context.appInstance.id ||
    context.appInstance.workspaceId !== context.workspace.id ||
    context.deployment.environmentId !== context.environment.id ||
    context.deployment.desiredPlan.cellKey !== context.environment.cellKey
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_CONTEXT_OWNERSHIP_INVALID",
      "Tenant database context contains inconsistent immutable ownership fields.",
    );
  }
  if (
    context.deployment.desiredPlan.resources.tenant.database.isolation !==
    "tenant_database"
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_MODE_UNSUPPORTED",
      "The AWS Sandbox lifecycle supports only the reviewed tenant_database mode.",
    );
  }

  const ownership = {
    appInstanceId: context.appInstance.id,
    workspaceId: context.workspace.id,
    productId: context.appInstance.productId,
    environmentId: context.environment.id,
    cellKey: context.environment.cellKey,
  };
  const stableIdentityHash = await sha256Hex(ownership);
  const token = `${stableStem(context.appInstance.id)}_${stableIdentityHash.slice(0, 10)}`;
  const plannedDatabase =
    context.deployment.desiredPlan.resources.tenant.database;
  // The immutable deployment plan is the audit source of truth for physical
  // database names. Re-deriving different names here would make the plan,
  // Worker steps and actual resources disagree and could bypass uniqueness
  // checks in the lifecycle repository.
  assertSafeIdentifier(plannedDatabase.databaseName, "databaseName");
  assertSafeIdentifier(plannedDatabase.roleName, "roleName");
  const identity: TenantResourceIdentity = {
    schemaVersion: 1,
    ...ownership,
    databaseName: plannedDatabase.databaseName,
    roleName: plannedDatabase.roleName,
    secretName: `techlong/sandbox/tenant/${token}/runtime`,
    stableIdentityHash,
  };
  assertIdentity(identity);
  return identity;
}

function assertIdentity(
  identity: TenantResourceIdentity,
  expected?: TenantResourceIdentity,
): void {
  assertExactKeys(identity, identityKeys, "Tenant resource identity");
  if (identity.schemaVersion !== 1) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_OWNERSHIP_VERSION_INVALID",
      "Tenant ownership marker version is unsupported.",
    );
  }
  for (const [label, value] of [
    ["appInstanceId", identity.appInstanceId],
    ["workspaceId", identity.workspaceId],
    ["productId", identity.productId],
    ["environmentId", identity.environmentId],
    ["cellKey", identity.cellKey],
  ] as const) {
    if (!value || value.length > 128) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_OWNERSHIP_INVALID",
        `Tenant ownership ${label} is invalid.`,
      );
    }
  }
  assertSafeIdentifier(identity.databaseName, "databaseName");
  assertSafeIdentifier(identity.roleName, "roleName");
  if (!secretNamePattern.test(identity.secretName)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_NAME_INVALID",
      "secretName must stay inside the reviewed tenant Secret namespace.",
    );
  }
  if (!sha256Pattern.test(identity.stableIdentityHash)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_STABLE_IDENTITY_HASH_INVALID",
      "Tenant stable identity hash is invalid.",
    );
  }
  if (expected && canonicalJson(identity) !== canonicalJson(expected)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_OWNERSHIP_MISMATCH",
      "Tenant adapter returned resources owned by another deployment.",
    );
  }
}

export function assertTenantResourceIdentity(
  identity: TenantResourceIdentity,
  expected?: TenantResourceIdentity,
): void {
  assertIdentity(identity, expected);
}

export function deriveTenantOwnershipMarker(
  identity: TenantResourceIdentity,
  generation: number,
): string {
  assertIdentity(identity);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_GENERATION_INVALID",
      "Tenant resource generation must be a positive safe integer.",
    );
  }
  return `tl_owner_${identity.stableIdentityHash.slice(0, 32)}_g${generation}`;
}

export function assertTenantResourceFence(
  fence: TenantResourceFence,
  expected?: TenantResourceFence,
): void {
  assertExactKeys(fence, fenceKeys, "Tenant resource fence");
  if (fence.schemaVersion !== 1) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_FENCE_VERSION_INVALID",
      "Tenant resource fence version is unsupported.",
    );
  }
  assertIdentity(fence.identity, expected?.identity);
  if (
    !Number.isSafeInteger(fence.generation) ||
    fence.generation < 1 ||
    !fence.ownerDeploymentId ||
    fence.ownerDeploymentId.length > 128 ||
    fence.ownershipMarker !==
      deriveTenantOwnershipMarker(fence.identity, fence.generation)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_FENCE_INVALID",
      "Tenant resource fence does not match its stable identity and generation.",
    );
  }
  if (expected && canonicalJson(fence) !== canonicalJson(expected)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_FENCE_MISMATCH",
      "Tenant adapter returned a stale or foreign resource generation fence.",
    );
  }
}

/**
 * Physical Secret names rotate with the resource generation. The immutable
 * identity retains only the logical /runtime prefix so a Secret pending
 * deletion from g1 cannot block a safe g2 reopen.
 */
export function deriveTenantRuntimeSecretName(
  fence: TenantResourceFence,
): string {
  assertTenantResourceFence(fence);
  return `${fence.identity.secretName}/g${fence.generation}`;
}

function assertProvisionExternalFence(
  actual: TenantExternalOperationFence,
  expected: TenantExternalOperationFence,
  resourceFence: TenantResourceFence,
): void {
  if (
    actual.schemaVersion !== 1 ||
    actual.intent !== "provision" ||
    actual.state !== "active" ||
    actual.ownerDeploymentId !== resourceFence.ownerDeploymentId ||
    !Number.isSafeInteger(actual.epoch) ||
    actual.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(actual.operationHash) ||
    actual.marker !==
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${resourceFence.generation}_e${actual.epoch}` ||
    canonicalJson(actual.resourceFence) !== canonicalJson(resourceFence) ||
    canonicalJson(actual) !== canonicalJson(expected)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_MISMATCH",
      "Tenant adapter did not use the exact active provision epoch.",
    );
  }
}

function assertEvidenceHash(value: string): void {
  if (!sha256Pattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EVIDENCE_INVALID",
      "Tenant database evidence hash is invalid.",
    );
  }
}

function assertInspection(
  inspection: TenantDatabaseInspection,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): void {
  assertExactKeys(
    inspection,
    [
      "fence",
      "externalFence",
      "state",
      "databaseExists",
      "roleExists",
      "databaseOwnershipMarker",
      "roleOwnershipMarker",
      "baselineDigest",
      "migrationContract",
      "evidenceHash",
    ],
    "Tenant database inspection",
  );
  assertTenantResourceFence(inspection.fence, fence);
  assertProvisionExternalFence(inspection.externalFence, externalFence, fence);
  assertEvidenceHash(inspection.evidenceHash);

  if (inspection.state === "partial") {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_PARTIAL_STATE",
      "Tenant database or role is only partially present; automatic adoption is forbidden.",
    );
  }
  if (inspection.state === "missing") {
    if (
      inspection.databaseExists ||
      inspection.roleExists ||
      inspection.databaseOwnershipMarker !== null ||
      inspection.roleOwnershipMarker !== null ||
      inspection.baselineDigest !== null ||
      inspection.migrationContract !== null
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_OBSERVATION_INVALID",
        "Missing tenant database observation contains residual resources.",
      );
    }
    return;
  }
  if (!inspection.databaseExists || !inspection.roleExists) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_PARTIAL_STATE",
      "Tenant database and role must exist together.",
    );
  }
  if (
    inspection.databaseOwnershipMarker !== fence.ownershipMarker ||
    inspection.roleOwnershipMarker !== fence.ownershipMarker
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_OWNERSHIP_MISMATCH",
      "Existing tenant database resources do not carry the expected ownership marker.",
    );
  }
  if (inspection.state === "empty") {
    if (inspection.baselineDigest !== null || inspection.migrationContract !== null) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_OBSERVATION_INVALID",
        "Empty tenant database unexpectedly reports migration evidence.",
      );
    }
    return;
  }
  if (!inspection.baselineDigest || !sha256Pattern.test(inspection.baselineDigest)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_BASELINE_EVIDENCE_INVALID",
      "Restored tenant database has no valid approved baseline digest.",
    );
  }
  if (
    inspection.state === "baseline_restored" &&
    inspection.migrationContract !== null
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_OBSERVATION_INVALID",
      "Baseline-only tenant database unexpectedly reports the SaaS migration.",
    );
  }
  if (
    (inspection.state === "saas_migrated" || inspection.state === "verified") &&
    inspection.migrationContract !== saasMigrationContract
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_MIGRATION_EVIDENCE_INVALID",
      "Tenant database does not report the reviewed SaaS migration contract.",
    );
  }
}

function assertSecretRef(
  value: string,
  fence: TenantResourceFence,
  expectedAws?: { accountId: string; region: string },
): void {
  const expectedName = deriveTenantRuntimeSecretName(fence).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  if (
    !secretRefPattern.test(value) ||
    !new RegExp(`:secret:${expectedName}-[A-Za-z0-9]{6}$`).test(value) ||
    (expectedAws !== undefined &&
      !value.startsWith(
        `arn:aws:secretsmanager:${expectedAws.region}:${expectedAws.accountId}:secret:`,
      ))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_REFERENCE_INVALID",
      "Tenant secret adapter returned an invalid Secrets Manager reference.",
    );
  }
}

function assertSecretInspection(
  inspection: TenantSecretInspection,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
  expectedAws?: { accountId: string; region: string },
): void {
  assertExactKeys(
    inspection,
    ["externalFence", "fence", "state", "secretRef", "ownershipMarker", "versionRef"],
    "Tenant secret inspection",
  );
  assertTenantResourceFence(inspection.fence, fence);
  assertProvisionExternalFence(inspection.externalFence, externalFence, fence);
  if (inspection.state === "missing") {
    if (
      inspection.secretRef !== null ||
      inspection.ownershipMarker !== null ||
      inspection.versionRef !== null
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_OBSERVATION_INVALID",
        "Missing tenant secret observation contains residual references.",
      );
    }
    return;
  }
  if (
    !inspection.secretRef ||
    !inspection.versionRef ||
    inspection.ownershipMarker !== fence.ownershipMarker
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_OWNERSHIP_MISMATCH",
      "Existing tenant secret is missing the expected ownership evidence.",
    );
  }
  assertSecretRef(inspection.secretRef, fence, expectedAws);
}

function assertSecretReceipt(
  receipt: TenantSecretReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
  expectedAws?: { accountId: string; region: string },
): void {
  assertExactKeys(
    receipt,
    [
      "fence",
      "externalFence",
      "outcome",
      "secretRef",
      "ownershipMarker",
      "versionRef",
    ],
    "Tenant secret receipt",
  );
  assertTenantResourceFence(receipt.fence, fence);
  assertProvisionExternalFence(receipt.externalFence, externalFence, fence);
  assertSecretRef(receipt.secretRef, fence, expectedAws);
  if (
    !["created", "already_exists"].includes(receipt.outcome) ||
    receipt.ownershipMarker !== fence.ownershipMarker ||
    !receipt.versionRef
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_RECEIPT_INVALID",
      "Tenant secret receipt is missing exact ownership evidence.",
    );
  }
}

function assertMutationReceipt(
  receipt: TenantDatabaseMutationReceipt,
  expected: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    operation: TenantDatabaseMutationReceipt["operation"];
    states: TenantDatabaseMutationReceipt["resultingState"][];
  },
): void {
  assertExactKeys(
    receipt,
    [
      "fence",
      "externalFence",
      "operation",
      "outcome",
      "resultingState",
      "evidenceHash",
    ],
    "Tenant database mutation receipt",
  );
  assertTenantResourceFence(receipt.fence, expected.fence);
  assertProvisionExternalFence(
    receipt.externalFence,
    expected.externalFence,
    expected.fence,
  );
  assertEvidenceHash(receipt.evidenceHash);
  if (
    receipt.operation !== expected.operation ||
    !["applied", "already_applied"].includes(receipt.outcome) ||
    !expected.states.includes(receipt.resultingState)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_RECEIPT_INVALID",
      "Tenant database adapter returned an invalid lifecycle receipt.",
    );
  }
}

function validateApprovedBaseline(
  baseline: TenantApprovedBaseline | null,
): TenantApprovedBaseline {
  if (!baseline) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_BASELINE_NOT_APPROVED",
      "No independently approved tenant baseline is configured; restore remains blocked.",
    );
  }
  if (
    baseline.contract !== "speedfeast-pg16.14-tenant-baseline-v1" ||
    !baselineArchivePattern.test(baseline.archiveS3Uri) ||
    !baselineManifestPattern.test(baseline.manifestS3Uri) ||
    baseline.archiveS3Uri.includes("..") ||
    baseline.manifestS3Uri.includes("..") ||
    !sha256Pattern.test(baseline.archiveSha256) ||
    !sha256Pattern.test(baseline.approvedArchiveSha256) ||
    baseline.archiveSha256 !== baseline.approvedArchiveSha256 ||
    !sha256Pattern.test(baseline.manifestSha256) ||
    !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(baseline.sourceDatabase)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_BASELINE_INVALID",
      "Tenant baseline does not satisfy the reviewed PostgreSQL 16.14 artifact contract.",
    );
  }
  return baseline;
}

function safeOutput(input: {
  fence: TenantResourceFence;
  externalFence: TenantExternalOperationFence;
  secretRef: string;
  state: TenantDatabaseLifecycleState;
  baselineDigest: string | null;
  migrationContract: string | null;
  evidenceHash: string;
}): Record<string, unknown> {
  return {
    // Checkpoint output is persisted and inspected by the generic safety
    // scanner. Keep only non-secret scalar proof here; the complete fence has
    // already been validated against every in-memory provider receipt.
    externalEpoch: input.externalFence.epoch,
    externalMarker: input.externalFence.marker,
    externalOperationHash: input.externalFence.operationHash,
    databaseName: input.fence.identity.databaseName,
    roleName: input.fence.identity.roleName,
    ownershipMarker: input.fence.ownershipMarker,
    resourceGeneration: input.fence.generation,
    resourceOwnerDeploymentId: input.fence.ownerDeploymentId,
    secretRef: input.secretRef,
    lifecycleState: input.state,
    baselineDigest: input.baselineDigest,
    migrationContract: input.migrationContract,
    evidenceHash: input.evidenceHash,
  };
}

function currentFence(
  context: DeploymentExecutionContext,
  identity: TenantResourceIdentity,
): TenantResourceFence {
  const record = context.tenantResources;
  if (!record) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_GENERATION_UNCLAIMED",
      "Tenant resource generation must be claimed before any external write.",
    );
  }
  const fence: TenantResourceFence = {
    schemaVersion: 1,
    identity: record.identity,
    generation: record.generation,
    ownerDeploymentId: record.ownerDeploymentId,
    ownershipMarker: record.ownershipMarker,
  };
  assertTenantResourceFence(fence);
  assertIdentity(fence.identity, identity);
  if (fence.ownerDeploymentId !== context.deployment.id) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_OWNER_STALE",
      "The deployment does not own the current tenant resource generation.",
    );
  }
  if (["destroying", "destroyed", "failed"].includes(record.lifecycleStatus)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_LIFECYCLE_BLOCKED",
      `Tenant resource lifecycle ${record.lifecycleStatus} cannot be provisioned.`,
    );
  }
  return fence;
}

function currentProvisionExternalFence(
  context: DeploymentExecutionContext,
  resourceFence: TenantResourceFence,
  expected: TenantExternalOperationFence,
): TenantExternalOperationFence {
  const current = context.tenantExternalOperation;
  if (!current) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_UNPROVEN",
      "Tenant provisioning requires an active externally proven operation epoch.",
    );
  }
  assertProvisionExternalFence(current, expected, resourceFence);
  return current;
}

/**
 * Bridges the existing two Worker checkpoints to the reviewed, typed database
 * and secret lifecycle. It intentionally does not contain AWS or PostgreSQL
 * clients; production adapters must be injected after separate review.
 */
export class GuardedTenantDatabasePort implements TenantDatabasePort {
  private readonly lifecycle: TenantDatabaseLifecyclePort;
  private readonly secrets: TenantSecretStorePort;
  private readonly baseline: TenantApprovedBaseline | null;

  constructor(input: {
    lifecycle: TenantDatabaseLifecyclePort;
    secrets: TenantSecretStorePort;
    approvedBaseline: TenantApprovedBaseline | null;
  }) {
    this.lifecycle = input.lifecycle;
    this.secrets = input.secrets;
    this.baseline = input.approvedBaseline;
  }

  async ensureTenantDatabase(input: {
    context: DeploymentExecutionContext;
    externalFence: TenantExternalOperationFence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>> {
    input.signal.throwIfAborted();
    assertIdempotencyKey(input.idempotencyKey);
    const identity = await deriveTenantResourceIdentity(input.context);
    const fence = currentFence(input.context, identity);
    const externalFence = currentProvisionExternalFence(
      input.context,
      fence,
      input.externalFence,
    );
    const expectedAws = {
      accountId: input.context.environment.expectedAccountId,
      region: input.context.environment.region,
    };
    let database = await this.lifecycle.inspect({
      fence,
      externalFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertInspection(database, fence, externalFence);
    let secret = await this.secrets.inspectRuntimeSecret({
      fence,
      externalFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertSecretInspection(secret, fence, externalFence, expectedAws);

    if (database.state !== "missing" && secret.state === "missing") {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_PARTIAL_STATE",
        "Tenant database exists without its owned runtime secret; automatic credential replacement is forbidden.",
      );
    }
    if (database.state === "missing" && secret.state === "missing") {
      const created = await this.secrets.ensureRuntimeSecret({
        fence,
        externalFence,
        idempotencyKey: `${input.idempotencyKey}:secret`,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertSecretReceipt(created, fence, externalFence, expectedAws);
      secret = {
        fence,
        externalFence,
        state: "present",
        secretRef: created.secretRef,
        ownershipMarker: fence.ownershipMarker,
        versionRef: created.versionRef,
      };
    }
    if (secret.state !== "present" || !secret.secretRef) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_UNAVAILABLE",
        "An owned tenant runtime secret is required before database preparation.",
      );
    }

    if (database.state === "missing") {
      const receipt = await this.lifecycle.prepareEmptyDatabase({
        fence,
        externalFence,
        runtimeSecretRef: secret.secretRef,
        idempotencyKey: `${input.idempotencyKey}:prepare`,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertMutationReceipt(receipt, {
        fence,
        externalFence,
        operation: "prepare_empty_database",
        states: ["empty"],
      });
      database = await this.lifecycle.inspect({
        fence,
        externalFence,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertInspection(database, fence, externalFence);
      if (database.state !== "empty") {
        throw new TenantDatabaseLifecycleError(
          "TENANT_DATABASE_PREPARE_UNVERIFIED",
          "Tenant database preparation did not produce a verified empty database and role.",
          true,
        );
      }
    }
    return safeOutput({
      fence,
      externalFence,
      secretRef: secret.secretRef,
      state: database.state,
      baselineDigest: database.baselineDigest,
      migrationContract: database.migrationContract,
      evidenceHash: database.evidenceHash,
    });
  }

  async migrateTenantDatabase(input: {
    context: DeploymentExecutionContext;
    externalFence: TenantExternalOperationFence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>> {
    input.signal.throwIfAborted();
    assertIdempotencyKey(input.idempotencyKey);
    const identity = await deriveTenantResourceIdentity(input.context);
    const fence = currentFence(input.context, identity);
    const externalFence = currentProvisionExternalFence(
      input.context,
      fence,
      input.externalFence,
    );
    const expectedAws = {
      accountId: input.context.environment.expectedAccountId,
      region: input.context.environment.region,
    };
    const baseline = validateApprovedBaseline(this.baseline);
    const secret = await this.secrets.inspectRuntimeSecret({
      fence,
      externalFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertSecretInspection(secret, fence, externalFence, expectedAws);
    if (secret.state !== "present" || !secret.secretRef) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_UNAVAILABLE",
        "An owned runtime secret is required before tenant migration.",
      );
    }

    let database = await this.lifecycle.inspect({
      fence,
      externalFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertInspection(database, fence, externalFence);
    if (database.state === "missing") {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_NOT_PREPARED",
        "Tenant database migration cannot create a missing database implicitly.",
      );
    }
    if (database.state === "empty") {
      const receipt = await this.lifecycle.restoreApprovedBaseline({
        fence,
        externalFence,
        runtimeSecretRef: secret.secretRef,
        baseline,
        idempotencyKey: `${input.idempotencyKey}:baseline`,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertMutationReceipt(receipt, {
        fence,
        externalFence,
        operation: "restore_approved_baseline",
        states: ["baseline_restored"],
      });
      database = await this.lifecycle.inspect({ fence, externalFence, signal: input.signal });
      input.signal.throwIfAborted();
      assertInspection(database, fence, externalFence);
    }
    if (
      database.state !== "baseline_restored" &&
      database.baselineDigest !== baseline.archiveSha256
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_OWNERSHIP_MISMATCH",
        "Tenant database baseline digest differs from the independently approved artifact.",
      );
    }
    if (database.state === "baseline_restored") {
      if (database.baselineDigest !== baseline.archiveSha256) {
        throw new TenantDatabaseLifecycleError(
          "TENANT_BASELINE_OWNERSHIP_MISMATCH",
          "Tenant database baseline digest differs from the independently approved artifact.",
        );
      }
      const receipt = await this.lifecycle.migrateSaas({
        fence,
        externalFence,
        runtimeSecretRef: secret.secretRef,
        command: saasMigrationCommand,
        migrationContract: saasMigrationContract,
        idempotencyKey: `${input.idempotencyKey}:saas`,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertMutationReceipt(receipt, {
        fence,
        externalFence,
        operation: "migrate_saas",
        states: ["saas_migrated"],
      });
      database = await this.lifecycle.inspect({ fence, externalFence, signal: input.signal });
      input.signal.throwIfAborted();
      assertInspection(database, fence, externalFence);
    }
    if (database.state !== "saas_migrated" && database.state !== "verified") {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_MIGRATION_UNVERIFIED",
        "Tenant database did not reach the reviewed SaaS migration state.",
        true,
      );
    }
    if (database.baselineDigest !== baseline.archiveSha256) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_OWNERSHIP_MISMATCH",
        "Tenant database baseline digest differs from the independently approved artifact.",
      );
    }
    const verified = await this.lifecycle.verify({
      fence,
      externalFence,
      expectedBaselineDigest: baseline.archiveSha256,
      expectedMigrationContract: saasMigrationContract,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertMutationReceipt(verified, {
      fence,
      externalFence,
      operation: "verify",
      states: ["verified"],
    });
    database = await this.lifecycle.inspect({ fence, externalFence, signal: input.signal });
    input.signal.throwIfAborted();
    assertInspection(database, fence, externalFence);
    if (
      database.state !== "verified" ||
      database.baselineDigest !== baseline.archiveSha256 ||
      database.migrationContract !== saasMigrationContract
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_VERIFICATION_FAILED",
        "Tenant database final evidence does not match the approved lifecycle.",
      );
    }
    return safeOutput({
      fence,
      externalFence,
      secretRef: secret.secretRef,
      state: database.state,
      baselineDigest: database.baselineDigest,
      migrationContract: database.migrationContract,
      evidenceHash: database.evidenceHash,
    });
  }
}

/**
 * Safe default for the standalone worker. Runtime wiring must replace this
 * only after the database, baseline, migration and Secret adapters are all
 * reviewed together.
 */
export class DisabledTenantDatabasePort implements TenantDatabasePort {
  async ensureTenantDatabase(): Promise<Record<string, unknown>> {
    throw new TenantDatabaseBoundaryDisabledError();
  }

  async migrateTenantDatabase(): Promise<Record<string, unknown>> {
    throw new TenantDatabaseBoundaryDisabledError();
  }
}
