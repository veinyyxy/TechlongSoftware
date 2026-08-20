import type {
  TenantApprovedBaseline,
  TenantDatabaseDestroyReceipt,
  TenantDatabaseInspection,
  TenantDatabaseLifecyclePort,
  TenantDatabaseLifecycleState,
  TenantDatabaseMutationReceipt,
  TenantExternalOperationFence,
  TenantProvisionPredecessor,
  TenantResourceFence,
  TenantSecretDestroyReceipt,
  TenantSecretInspection,
  TenantSecretReceipt,
  TenantSecretStorePort,
} from "./contracts.ts";
import type {
  EcsOneShotTaskRunner,
  TenantDatabaseOneShotOperation,
  TenantDatabaseOneShotOutput,
  TenantDatabaseOneShotReceipt,
} from "./ecs-one-shot-task.ts";
import { assertTenantRuntimeSecretArn } from "./ecs-one-shot-task.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  assertTenantProvisionPredecessor,
  requireActiveCleanupProvisionPredecessor,
} from "./external-ownership.ts";
import {
  assertTenantResourceFence,
  deriveTenantRuntimeSecretName,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";

const sha256Pattern = /^[a-f0-9]{64}$/;
const versionRefPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const secretNamePattern =
  /^techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g[1-9][0-9]*$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;

export const tenantRuntimeSecretExactJsonKeys = [
  "database_url",
  "hmac_secret_key",
  "jwt_secret_key",
  "stripe_secret_key",
  "stripe_webhook_secret",
] as const;

export type TenantRuntimeSecretJsonKey =
  (typeof tenantRuntimeSecretExactJsonKeys)[number];

export interface TenantRuntimeSecretOwnershipEvidence {
  resourceGeneration: number;
  ownershipMarker: string;
  externalEpoch: number;
  externalMarker: string;
  externalOperationHash: string;
}

export interface TenantRuntimeSecretProviderObservation {
  schemaVersion: 1;
  state: "missing" | "present";
  secretArn: string | null;
  versionRef: string | null;
  jsonKeys: readonly TenantRuntimeSecretJsonKey[];
  ownership: TenantRuntimeSecretOwnershipEvidence;
  evidenceHash: string;
  receiptHash: string;
}

export interface TenantRuntimeSecretProviderMutationReceipt {
  schemaVersion: 1;
  outcome: "created" | "already_exists";
  secretArn: string;
  versionRef: string;
  jsonKeys: readonly TenantRuntimeSecretJsonKey[];
  ownership: TenantRuntimeSecretOwnershipEvidence;
  evidenceHash: string;
  receiptHash: string;
}

export interface TenantRuntimeSecretProviderDeleteReceipt {
  schemaVersion: 1;
  outcome: "deleted" | "already_missing";
  secretName: string;
  ownership: TenantRuntimeSecretOwnershipEvidence;
  evidenceHash: string;
  receiptHash: string;
}

/**
 * SDK-free Secret provider boundary. ensureGeneratedSecret is intentionally a
 * provider-side generation operation: neither this adapter nor its caller can
 * supply or receive any of the five secret values.
 */
export interface TenantRuntimeSecretProviderApi {
  inspectSecret(input: {
    secretName: string;
    expectedJsonKeys: readonly TenantRuntimeSecretJsonKey[];
    expectedOwnership: TenantRuntimeSecretOwnershipEvidence;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderObservation>;
  ensureGeneratedSecret(input: {
    secretName: string;
    requiredJsonKeys: readonly TenantRuntimeSecretJsonKey[];
    ownership: TenantRuntimeSecretOwnershipEvidence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderMutationReceipt>;
  deleteSecret(input: {
    secretName: string;
    expectedOwnership: TenantRuntimeSecretOwnershipEvidence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderDeleteReceipt>;
}

export interface TenantRuntimeSecretReferenceResolver {
  resolve(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor?: TenantProvisionPredecessor;
    signal: AbortSignal;
  }): Promise<string>;
}

const ownershipKeys = [
  "resourceGeneration",
  "ownershipMarker",
  "externalEpoch",
  "externalMarker",
  "externalOperationHash",
] as const;
const secretObservationKeys = [
  "schemaVersion",
  "state",
  "secretArn",
  "versionRef",
  "jsonKeys",
  "ownership",
  "evidenceHash",
  "receiptHash",
] as const;
const secretMutationKeys = [
  "schemaVersion",
  "outcome",
  "secretArn",
  "versionRef",
  "jsonKeys",
  "ownership",
  "evidenceHash",
  "receiptHash",
] as const;
const secretDeleteKeys = [
  "schemaVersion",
  "outcome",
  "secretName",
  "ownership",
  "evidenceHash",
  "receiptHash",
] as const;

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  if (
    canonicalJson(Object.keys(value).sort()) !==
    canonicalJson([...expected].sort())
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_ADAPTER_CONTRACT_INVALID",
      `${label} contains missing or unexpected fields.`,
    );
  }
}

function assertIdempotencyKey(value: string): void {
  if (!idempotencyKeyPattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_IDEMPOTENCY_KEY_INVALID",
      "Tenant provider idempotency key is invalid.",
    );
  }
}

function assertExactJsonKeys(keys: readonly string[]): void {
  if (
    canonicalJson([...keys].sort()) !==
    canonicalJson([...tenantRuntimeSecretExactJsonKeys].sort())
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_SCHEMA_INVALID",
      "Tenant runtime Secret must contain exactly the reviewed five JSON keys.",
    );
  }
}

function ownershipEvidence(
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): TenantRuntimeSecretOwnershipEvidence {
  return {
    resourceGeneration: fence.generation,
    ownershipMarker: fence.ownershipMarker,
    externalEpoch: externalFence.epoch,
    externalMarker: externalFence.marker,
    externalOperationHash: externalFence.operationHash,
  };
}

function predecessorOwnershipEvidence(
  fence: TenantResourceFence,
  predecessor: TenantProvisionPredecessor,
): TenantRuntimeSecretOwnershipEvidence {
  return {
    resourceGeneration: fence.generation,
    ownershipMarker: fence.ownershipMarker,
    externalEpoch: predecessor.epoch,
    externalMarker: predecessor.marker,
    externalOperationHash: predecessor.operationHash,
  };
}

function assertActiveExternalFence(
  externalFence: TenantExternalOperationFence,
  fence: TenantResourceFence,
  intent: "provision" | "cleanup",
): TenantProvisionPredecessor | null {
  assertTenantResourceFence(externalFence.resourceFence, fence);
  if (
    externalFence.schemaVersion !== 1 ||
    externalFence.intent !== intent ||
    externalFence.state !== "active" ||
    externalFence.ownerDeploymentId !== fence.ownerDeploymentId ||
    !Number.isSafeInteger(externalFence.epoch) ||
    externalFence.epoch < 1 ||
    !sha256Pattern.test(externalFence.operationHash) ||
    externalFence.marker !==
      `tl_epoch_${fence.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${fence.generation}_e${externalFence.epoch}`
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_MISMATCH",
      "Tenant provider call requires the exact active external operation epoch.",
    );
  }
  if (intent === "cleanup") {
    return requireActiveCleanupProvisionPredecessor(externalFence);
  }
  if (externalFence.provisionPredecessor !== undefined) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_MISMATCH",
      "A provision provider call cannot carry cleanup predecessor evidence.",
    );
  }
  return null;
}

function assertOwnershipEvidence(
  actual: TenantRuntimeSecretOwnershipEvidence,
  expected: TenantRuntimeSecretOwnershipEvidence,
): void {
  assertExactKeys(actual, ownershipKeys, "Tenant Secret ownership evidence");
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_OWNERSHIP_MISMATCH",
      "Tenant Secret provider did not re-observe the expected generation and epoch.",
    );
  }
}

async function receiptHash(value: object): Promise<string> {
  const hashInput = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "receiptHash"),
  );
  return sha256Hex(hashInput);
}

async function secretEvidenceHash(value: object): Promise<string> {
  const evidence = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "evidenceHash" && key !== "receiptHash",
    ),
  );
  return sha256Hex(evidence);
}

async function assertSecretObservation(
  observation: TenantRuntimeSecretProviderObservation,
  expected: TenantRuntimeSecretOwnershipEvidence,
  expectedSecretName: string,
  expectedAws: { accountId: string; region: string },
): Promise<void> {
  assertExactKeys(
    observation,
    secretObservationKeys,
    "Tenant Secret observation",
  );
  assertOwnershipEvidence(observation.ownership, expected);
  if (
    observation.schemaVersion !== 1 ||
    !sha256Pattern.test(observation.evidenceHash) ||
    observation.evidenceHash !== (await secretEvidenceHash(observation)) ||
    observation.receiptHash !== (await receiptHash(observation))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_RECEIPT_INVALID",
      "Tenant Secret observation is not hash-bound.",
    );
  }
  if (observation.state === "missing") {
    if (
      observation.secretArn !== null ||
      observation.versionRef !== null ||
      observation.jsonKeys.length !== 0
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_OBSERVATION_INVALID",
        "Missing tenant Secret observation contains residual material.",
      );
    }
    return;
  }
  if (
    observation.state !== "present" ||
    !observation.secretArn ||
    !observation.versionRef ||
    !versionRefPattern.test(observation.versionRef)
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_OBSERVATION_INVALID",
      "Present tenant Secret observation is incomplete.",
    );
  }
  assertTenantRuntimeSecretArn(observation.secretArn, {
    ...expectedAws,
    physicalSecretName: expectedSecretName,
  });
  assertExactJsonKeys(observation.jsonKeys);
}

async function assertSecretMutationReceipt(
  receipt: TenantRuntimeSecretProviderMutationReceipt,
  expected: TenantRuntimeSecretOwnershipEvidence,
  expectedSecretName: string,
  expectedAws: { accountId: string; region: string },
): Promise<void> {
  assertExactKeys(receipt, secretMutationKeys, "Tenant Secret mutation receipt");
  assertOwnershipEvidence(receipt.ownership, expected);
  assertTenantRuntimeSecretArn(receipt.secretArn, {
    ...expectedAws,
    physicalSecretName: expectedSecretName,
  });
  assertExactJsonKeys(receipt.jsonKeys);
  if (
    receipt.schemaVersion !== 1 ||
    !["created", "already_exists"].includes(receipt.outcome) ||
    !versionRefPattern.test(receipt.versionRef) ||
    !sha256Pattern.test(receipt.evidenceHash) ||
    receipt.evidenceHash !== (await secretEvidenceHash(receipt)) ||
    receipt.receiptHash !== (await receiptHash(receipt))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_RECEIPT_INVALID",
      "Tenant Secret mutation receipt is stale or not hash-bound.",
    );
  }
}

async function assertSecretDeleteReceipt(
  receipt: TenantRuntimeSecretProviderDeleteReceipt,
  expected: TenantRuntimeSecretOwnershipEvidence,
  expectedSecretName: string,
): Promise<void> {
  assertExactKeys(receipt, secretDeleteKeys, "Tenant Secret delete receipt");
  assertOwnershipEvidence(receipt.ownership, expected);
  if (
    receipt.schemaVersion !== 1 ||
    !["deleted", "already_missing"].includes(receipt.outcome) ||
    receipt.secretName !== expectedSecretName ||
    !sha256Pattern.test(receipt.evidenceHash) ||
    receipt.evidenceHash !== (await secretEvidenceHash(receipt)) ||
    receipt.receiptHash !== (await receiptHash(receipt))
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_SECRET_DELETE_RECEIPT_INVALID",
      "Tenant Secret deletion is stale or not hash-bound to its provision predecessor.",
    );
  }
}

/**
 * Enforces the exact five-key JSON schema without ever accepting raw values.
 * Provider metadata must prove both resource generation and external epoch.
 */
export class ExactTenantRuntimeSecretAdapter
  implements TenantSecretStorePort, TenantRuntimeSecretReferenceResolver
{
  private readonly provider: TenantRuntimeSecretProviderApi;
  private readonly expectedAws: { accountId: string; region: string };

  constructor(input: {
    provider: TenantRuntimeSecretProviderApi;
    expectedAccountId: string;
    expectedRegion: string;
  }) {
    if (
      !/^\d{12}$/.test(input.expectedAccountId) ||
      !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(input.expectedRegion)
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_PROVIDER_CONFIG_INVALID",
        "Tenant Secret provider account or region is invalid.",
      );
    }
    this.provider = input.provider;
    this.expectedAws = {
      accountId: input.expectedAccountId,
      region: input.expectedRegion,
    };
  }

  async inspectRuntimeSecret(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantSecretInspection> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    assertActiveExternalFence(input.externalFence, input.fence, "provision");
    const expected = ownershipEvidence(input.fence, input.externalFence);
    const secretName = deriveTenantRuntimeSecretName(input.fence);
    const observation = await this.provider.inspectSecret({
      secretName,
      expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
      expectedOwnership: expected,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    await assertSecretObservation(
      observation,
      expected,
      secretName,
      this.expectedAws,
    );
    return {
      fence: input.fence,
      externalFence: input.externalFence,
      state: observation.state,
      secretRef: observation.secretArn,
      ownershipMarker:
        observation.state === "present" ? input.fence.ownershipMarker : null,
      versionRef: observation.versionRef,
    };
  }

  async ensureRuntimeSecret(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantSecretReceipt> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    assertActiveExternalFence(input.externalFence, input.fence, "provision");
    assertIdempotencyKey(input.idempotencyKey);
    const expected = ownershipEvidence(input.fence, input.externalFence);
    const secretName = deriveTenantRuntimeSecretName(input.fence);
    const receipt = await this.provider.ensureGeneratedSecret({
      secretName,
      requiredJsonKeys: tenantRuntimeSecretExactJsonKeys,
      ownership: expected,
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    await assertSecretMutationReceipt(
      receipt,
      expected,
      secretName,
      this.expectedAws,
    );
    return {
      fence: input.fence,
      externalFence: input.externalFence,
      outcome: receipt.outcome,
      secretRef: receipt.secretArn,
      ownershipMarker: input.fence.ownershipMarker,
      versionRef: receipt.versionRef,
    };
  }

  async destroyRuntimeSecret(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor: TenantProvisionPredecessor;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantSecretDestroyReceipt> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    const predecessor = assertActiveExternalFence(
      input.externalFence,
      input.fence,
      "cleanup",
    );
    assertTenantProvisionPredecessor(
      input.provisionPredecessor,
      input.fence,
      input.externalFence.epoch,
      predecessor ?? undefined,
    );
    assertIdempotencyKey(input.idempotencyKey);
    const secretName = deriveTenantRuntimeSecretName(input.fence);
    const expected = predecessorOwnershipEvidence(
      input.fence,
      input.provisionPredecessor,
    );
    input.signal.throwIfAborted();
    const receipt = await this.provider.deleteSecret({
      secretName,
      expectedOwnership: expected,
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    await assertSecretDeleteReceipt(receipt, expected, secretName);
    return {
      fence: input.fence,
      externalFence: input.externalFence,
      outcome: receipt.outcome,
      ownershipMarker: input.fence.ownershipMarker,
    };
  }

  async resolve(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor?: TenantProvisionPredecessor;
    signal: AbortSignal;
  }): Promise<string> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    const predecessor = assertActiveExternalFence(
      input.externalFence,
      input.fence,
      input.externalFence.intent,
    );
    if (predecessor) {
      assertTenantProvisionPredecessor(
        input.provisionPredecessor,
        input.fence,
        input.externalFence.epoch,
        predecessor,
      );
    } else if (input.provisionPredecessor !== undefined) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
        "Provision Secret resolution cannot accept cleanup predecessor evidence.",
      );
    }
    const expected = predecessor
      ? predecessorOwnershipEvidence(input.fence, predecessor)
      : ownershipEvidence(input.fence, input.externalFence);
    const secretName = deriveTenantRuntimeSecretName(input.fence);
    const observation = await this.provider.inspectSecret({
      secretName,
      expectedJsonKeys: tenantRuntimeSecretExactJsonKeys,
      expectedOwnership: expected,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    await assertSecretObservation(
      observation,
      expected,
      secretName,
      this.expectedAws,
    );
    if (observation.state !== "present" || !observation.secretArn) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_UNAVAILABLE",
        "Tenant database one-shot task requires an owned runtime Secret ARN.",
      );
    }
    return observation.secretArn;
  }
}

function assertDatabaseOutputKeys(
  output: TenantDatabaseOneShotOutput,
  expected: readonly string[],
): void {
  assertExactKeys(output, expected, "Tenant database task output");
}

function assertEvidenceHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_EVIDENCE_INVALID",
      "Tenant database task evidence hash is invalid.",
    );
  }
}

function inspectionFromReceipt(
  receipt: TenantDatabaseOneShotReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
): TenantDatabaseInspection {
  const output = receipt.output;
  assertDatabaseOutputKeys(output, [
    "state",
    "databaseExists",
    "roleExists",
    "databaseOwnershipMarker",
    "roleOwnershipMarker",
    "baselineDigest",
    "migrationContract",
    "evidenceHash",
  ]);
  const states: readonly TenantDatabaseLifecycleState[] = [
    "missing",
    "partial",
    "empty",
    "baseline_restored",
    "saas_migrated",
    "verified",
  ];
  if (
    typeof output.state !== "string" ||
    !states.includes(output.state as TenantDatabaseLifecycleState) ||
    typeof output.databaseExists !== "boolean" ||
    typeof output.roleExists !== "boolean" ||
    !(
      output.databaseOwnershipMarker === null ||
      typeof output.databaseOwnershipMarker === "string"
    ) ||
    !(
      output.roleOwnershipMarker === null ||
      typeof output.roleOwnershipMarker === "string"
    ) ||
    !(output.baselineDigest === null || typeof output.baselineDigest === "string") ||
    !(
      output.migrationContract === null ||
      output.migrationContract === "speedfeast-saas-control-v1"
    )
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_OBSERVATION_INVALID",
      "Tenant database task returned a malformed inspection.",
    );
  }
  assertEvidenceHash(output.evidenceHash);
  return {
    fence,
    externalFence,
    state: output.state as TenantDatabaseLifecycleState,
    databaseExists: output.databaseExists,
    roleExists: output.roleExists,
    databaseOwnershipMarker: output.databaseOwnershipMarker,
    roleOwnershipMarker: output.roleOwnershipMarker,
    baselineDigest: output.baselineDigest,
    migrationContract: output.migrationContract,
    evidenceHash: output.evidenceHash,
  };
}

function mutationFromReceipt(
  receipt: TenantDatabaseOneShotReceipt,
  fence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
  operation: Exclude<TenantDatabaseOneShotOperation, "inspect" | "destroy">,
): TenantDatabaseMutationReceipt {
  const output = receipt.output;
  assertDatabaseOutputKeys(output, ["outcome", "resultingState", "evidenceHash"]);
  const expectedState: Record<
    Exclude<TenantDatabaseOneShotOperation, "inspect" | "destroy">,
    TenantDatabaseMutationReceipt["resultingState"]
  > = {
    prepare_empty_database: "empty",
    restore_approved_baseline: "baseline_restored",
    migrate_saas: "saas_migrated",
    verify: "verified",
  };
  if (
    !["applied", "already_applied"].includes(String(output.outcome)) ||
    output.resultingState !== expectedState[operation]
  ) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_DATABASE_RECEIPT_INVALID",
      "Tenant database task returned an invalid mutation result.",
    );
  }
  assertEvidenceHash(output.evidenceHash);
  return {
    fence,
    externalFence,
    operation,
    outcome: output.outcome as "applied" | "already_applied",
    resultingState: output.resultingState as TenantDatabaseMutationReceipt["resultingState"],
    evidenceHash: output.evidenceHash,
  };
}

/**
 * Maps the existing lifecycle port to reviewed one-shot ECS requests. The task
 * receives only a Secret ARN, an independently approved baseline digest when
 * required, immutable fence metadata, and a fixed command selected by the
 * runner configuration. It never receives a password or database URL.
 */
export class EcsOneShotTenantDatabaseLifecycleAdapter
  implements TenantDatabaseLifecyclePort
{
  private readonly runner: EcsOneShotTaskRunner;
  private readonly secretRefs: TenantRuntimeSecretReferenceResolver;
  private readonly approvedBaselineDigest: string;

  constructor(input: {
    runner: EcsOneShotTaskRunner;
    secretRefs: TenantRuntimeSecretReferenceResolver;
    approvedBaselineDigest: string;
  }) {
    if (!sha256Pattern.test(input.approvedBaselineDigest)) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_NOT_APPROVED",
        "One-shot tenant lifecycle requires an independently approved baseline digest.",
      );
    }
    this.runner = input.runner;
    this.secretRefs = input.secretRefs;
    this.approvedBaselineDigest = input.approvedBaselineDigest;
  }

  private async runtimeSecretRef(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor?: TenantProvisionPredecessor;
    supplied?: string;
    signal: AbortSignal;
  }): Promise<string> {
    input.signal.throwIfAborted();
    const resolved = await this.secretRefs.resolve({
      fence: input.fence,
      externalFence: input.externalFence,
      provisionPredecessor: input.provisionPredecessor,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertTenantRuntimeSecretArn(resolved, {
      physicalSecretName: deriveTenantRuntimeSecretName(input.fence),
    });
    if (input.supplied !== undefined && input.supplied !== resolved) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_SECRET_REFERENCE_MISMATCH",
        "Tenant database task rejected a runtime Secret ARN not re-observed for this epoch.",
      );
    }
    return resolved;
  }

  private async execute(input: {
    operation: TenantDatabaseOneShotOperation;
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor?: TenantProvisionPredecessor;
    runtimeSecretRef?: string;
    approvedBaselineDigest: string | null;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantDatabaseOneShotReceipt> {
    assertTenantResourceFence(input.fence);
    const predecessor = assertActiveExternalFence(
      input.externalFence,
      input.fence,
      input.operation === "destroy" ? "cleanup" : "provision",
    );
    if (input.operation === "destroy") {
      assertTenantProvisionPredecessor(
        input.provisionPredecessor,
        input.fence,
        input.externalFence.epoch,
        predecessor ?? undefined,
      );
    } else if (input.provisionPredecessor !== undefined) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
        "Provision database tasks cannot carry cleanup predecessor evidence.",
      );
    }
    assertIdempotencyKey(input.idempotencyKey);
    const runtimeSecretRef = await this.runtimeSecretRef({
      fence: input.fence,
      externalFence: input.externalFence,
      provisionPredecessor: input.provisionPredecessor,
      supplied: input.runtimeSecretRef,
      signal: input.signal,
    });
    const common = {
      fence: input.fence,
      externalFence: input.externalFence,
      runtimeSecretRef,
      approvedBaselineDigest: input.approvedBaselineDigest,
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    };
    return input.operation === "destroy"
      ? this.runner.execute({
          ...common,
          operation: "destroy",
          provisionPredecessor: input.provisionPredecessor!,
        })
      : this.runner.execute({
          ...common,
          operation: input.operation,
        });
  }

  async inspect(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantDatabaseInspection> {
    const receipt = await this.execute({
      ...input,
      operation: "inspect",
      approvedBaselineDigest: null,
      idempotencyKey: `${input.externalFence.operationHash}:inspect`,
    });
    return inspectionFromReceipt(receipt, input.fence, input.externalFence);
  }

  async prepareEmptyDatabase(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    runtimeSecretRef: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantDatabaseMutationReceipt> {
    const receipt = await this.execute({
      ...input,
      operation: "prepare_empty_database",
      approvedBaselineDigest: null,
    });
    return mutationFromReceipt(
      receipt,
      input.fence,
      input.externalFence,
      "prepare_empty_database",
    );
  }

  async restoreApprovedBaseline(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    runtimeSecretRef: string;
    baseline: TenantApprovedBaseline;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantDatabaseMutationReceipt> {
    if (
      input.baseline.archiveSha256 !== this.approvedBaselineDigest ||
      input.baseline.approvedArchiveSha256 !== this.approvedBaselineDigest
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_NOT_APPROVED",
        "Tenant baseline task digest is not the independently approved digest.",
      );
    }
    const receipt = await this.execute({
      ...input,
      operation: "restore_approved_baseline",
      approvedBaselineDigest: this.approvedBaselineDigest,
    });
    return mutationFromReceipt(
      receipt,
      input.fence,
      input.externalFence,
      "restore_approved_baseline",
    );
  }

  async migrateSaas(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    runtimeSecretRef: string;
    command: "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas";
    migrationContract: "speedfeast-saas-control-v1";
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantDatabaseMutationReceipt> {
    if (
      input.command !== "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas" ||
      input.migrationContract !== "speedfeast-saas-control-v1"
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_ONE_SHOT_COMMAND_INVALID",
        "Tenant SaaS migration command is outside the reviewed SpeedFeast contract.",
      );
    }
    const receipt = await this.execute({
      ...input,
      operation: "migrate_saas",
      approvedBaselineDigest: this.approvedBaselineDigest,
    });
    return mutationFromReceipt(
      receipt,
      input.fence,
      input.externalFence,
      "migrate_saas",
    );
  }

  async verify(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    expectedBaselineDigest: string;
    expectedMigrationContract: "speedfeast-saas-control-v1";
    signal: AbortSignal;
  }): Promise<TenantDatabaseMutationReceipt> {
    if (
      input.expectedBaselineDigest !== this.approvedBaselineDigest ||
      input.expectedMigrationContract !== "speedfeast-saas-control-v1"
    ) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_BASELINE_NOT_APPROVED",
        "Tenant verification does not match the approved baseline and migration contract.",
      );
    }
    const receipt = await this.execute({
      ...input,
      operation: "verify",
      approvedBaselineDigest: this.approvedBaselineDigest,
      idempotencyKey: `${input.externalFence.operationHash}:verify`,
    });
    return mutationFromReceipt(
      receipt,
      input.fence,
      input.externalFence,
      "verify",
    );
  }

  async destroy(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    provisionPredecessor: TenantProvisionPredecessor;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantDatabaseDestroyReceipt> {
    input.signal.throwIfAborted();
    assertTenantResourceFence(input.fence);
    const predecessor = assertActiveExternalFence(
      input.externalFence,
      input.fence,
      "cleanup",
    );
    assertTenantProvisionPredecessor(
      input.provisionPredecessor,
      input.fence,
      input.externalFence.epoch,
      predecessor ?? undefined,
    );
    assertIdempotencyKey(input.idempotencyKey);
    const receipt = await this.execute({
      ...input,
      operation: "destroy",
      approvedBaselineDigest: null,
    });
    const output = receipt.output;
    assertDatabaseOutputKeys(output, [
      "outcome",
      "databaseDeleted",
      "roleDeleted",
      "evidenceHash",
    ]);
    const completeDelete =
      output.outcome === "deleted" &&
      output.databaseDeleted === true &&
      output.roleDeleted === true;
    const completeAbsence =
      output.outcome === "already_missing" &&
      output.databaseDeleted === false &&
      output.roleDeleted === false;
    assertEvidenceHash(output.evidenceHash);
    if (!completeDelete && !completeAbsence) {
      throw new TenantDatabaseLifecycleError(
        "TENANT_DATABASE_CLEANUP_PARTIAL",
        "Tenant database task did not delete or prove absence of both the database and role.",
      );
    }
    return {
      fence: input.fence,
      externalFence: input.externalFence,
      outcome: output.outcome as "deleted" | "already_missing",
      databaseDeleted: output.databaseDeleted as boolean,
      roleDeleted: output.roleDeleted as boolean,
      evidenceHash: output.evidenceHash,
    };
  }
}

export async function createTenantSecretProviderReceiptHash(
  receipt:
    | Omit<TenantRuntimeSecretProviderObservation, "receiptHash">
    | Omit<TenantRuntimeSecretProviderMutationReceipt, "receiptHash">
    | Omit<TenantRuntimeSecretProviderDeleteReceipt, "receiptHash">,
): Promise<string> {
  return sha256Hex(receipt);
}

export async function createTenantSecretProviderEvidenceHash(
  receipt:
    | Omit<TenantRuntimeSecretProviderObservation, "evidenceHash" | "receiptHash">
    | Omit<
        TenantRuntimeSecretProviderMutationReceipt,
        "evidenceHash" | "receiptHash"
      >
    | Omit<TenantRuntimeSecretProviderDeleteReceipt, "evidenceHash" | "receiptHash">,
): Promise<string> {
  return sha256Hex(receipt);
}

export function assertTenantRuntimeSecretName(value: string): void {
  if (!secretNamePattern.test(value)) {
    throw new TenantDatabaseLifecycleError(
      "TENANT_RESOURCE_NAME_INVALID",
      "Tenant runtime Secret name is outside the reviewed namespace.",
    );
  }
}
