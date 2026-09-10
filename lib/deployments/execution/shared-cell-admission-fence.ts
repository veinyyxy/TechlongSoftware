import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_CLOUD_FORMATION_ROLE_ARN,
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellProvisionAuthorityRecord,
} from "./shared-cell-cleanup-authority.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const digestPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface SharedCellAdmissionDrainIntent {
  readonly schemaVersion: 2;
  readonly action: "drain_shared_cell_admissions";
  readonly environmentId: typeof environmentId;
  readonly provisionLineage: Readonly<SharedCellAdmissionFenceLineage>;
}

export type SharedCellAdmissionFenceLineage = Pick<
  SharedCellProvisionAuthorityRecord,
  | "accountId"
  | "region"
  | "cellId"
  | "stackName"
  | "stackId"
  | "stackStatus"
  | "cellExpiresAt"
  | "cloudFormationRoleArn"
  | "templateCanonicalSha256"
  | "resourceInventorySha256"
  | "ownerDeploymentId"
  | "generation"
  | "provisionEpoch"
  | "provisionMarker"
  | "provisionOperationHash"
>;

export interface SharedCellAdmissionDrainReceipt {
  readonly schemaVersion: 1;
  readonly admissionState: "draining";
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly environmentId: typeof environmentId;
  readonly admissionEpoch: number;
  readonly admissionFenceSha256: string;
  readonly admissionProvisionOperationHash: string;
  readonly admissionStackId: string;
  readonly admissionCellExpiresAt: number;
  readonly admissionChangedAt: number;
  readonly dbObservedAt: number;
  readonly databaseCellExpired: true;
}

export interface BeginSharedCellAdmissionDrainInput {
  readonly predecessor: Readonly<SharedCellProvisionAuthorityRecord>;
  readonly signal: AbortSignal;
}

export interface SharedCellAdmissionFenceWriter {
  beginAdmissionDrain(
    input: BeginSharedCellAdmissionDrainInput,
  ): Promise<Readonly<SharedCellAdmissionDrainReceipt>>;
}

export class SharedCellAdmissionFenceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string): never {
  throw new SharedCellAdmissionFenceError(code, message, false);
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value as Record<string, unknown>).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function canonicalUtc(value: unknown): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence requires a canonical Shared Cell expiry.",
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence requires a real Shared Cell expiry.",
    );
  }
  return parsed;
}

async function assertPredecessor(
  value: Readonly<SharedCellProvisionAuthorityRecord>,
): Promise<void> {
  if (
    !exactKeys(value, [
      "accountId",
      "cellExpiresAt",
      "cellId",
      "cloudFormationRoleArn",
      "generation",
      "ownerDeploymentId",
      "provisionEpoch",
      "provisionMarker",
      "provisionOperationHash",
      "recordHash",
      "region",
      "resourceInventorySha256",
      "revision",
      "schemaVersion",
      "stackId",
      "stackName",
      "stackStatus",
      "state",
      "templateCanonicalSha256",
    ]) ||
    value.schemaVersion !== 2 ||
    value.accountId !== accountId ||
    value.region !== region ||
    value.cellId !== cellId ||
    value.stackName !== stackName ||
    value.cloudFormationRoleArn !== SHARED_CELL_CLOUD_FORMATION_ROLE_ARN ||
    value.state !== "provision_verified" ||
    !stackIdPattern.test(value.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(value.stackStatus) ||
    !ownerPattern.test(value.ownerDeploymentId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.provisionEpoch) ||
    value.provisionEpoch < 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    ![
      value.provisionOperationHash,
      value.recordHash,
      value.templateCanonicalSha256,
      value.resourceInventorySha256,
    ].every((digest) => digestPattern.test(digest))
  ) {
    fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence target is not the exact provision_verified Sandbox Cell lineage.",
    );
  }
  canonicalUtc(value.cellExpiresAt);
  if (
    value.provisionMarker !==
      sharedCellAuthorityMarker({
        generation: value.generation,
        epoch: value.provisionEpoch,
      })
  ) {
    fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence predecessor marker is not bound to its generation and epoch.",
    );
  }
  const unsigned = { ...value } as Record<string, unknown>;
  delete unsigned.recordHash;
  if (
    (await sha256Hex(unsigned)) !== value.recordHash ||
    (await sha256Hex(sharedCellProvisionOperationIntent(value))) !==
      value.provisionOperationHash
  ) {
    fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence predecessor hashes are not bound to the exact provision lineage.",
    );
  }
}

export async function compileSharedCellAdmissionDrainIntent(
  predecessor: Readonly<SharedCellProvisionAuthorityRecord>,
): Promise<{
  readonly intent: Readonly<SharedCellAdmissionDrainIntent>;
  readonly fenceSha256: string;
  readonly cellExpiresAt: number;
}> {
  let pinned: Readonly<SharedCellProvisionAuthorityRecord>;
  try {
    const serialized = canonicalJson(predecessor);
    if (typeof serialized !== "string") throw new Error("not JSON");
    pinned = Object.freeze(
      JSON.parse(serialized) as SharedCellProvisionAuthorityRecord,
    );
  } catch {
    return fail(
      "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
      "The admission fence predecessor is not immutable JSON data.",
    );
  }
  await assertPredecessor(pinned);
  const intent = sharedCellAdmissionDrainIntent(pinned);
  return Object.freeze({
    intent,
    fenceSha256: await sha256Hex(intent),
    cellExpiresAt: canonicalUtc(pinned.cellExpiresAt),
  });
}

/** Stable provision projection retained by both provision and cleanup records. */
export function sharedCellAdmissionDrainIntent(
  source: SharedCellAdmissionFenceLineage,
): Readonly<SharedCellAdmissionDrainIntent> {
  const provisionLineage = Object.freeze({
    accountId: source.accountId,
    region: source.region,
    cellId: source.cellId,
    stackName: source.stackName,
    stackId: source.stackId,
    stackStatus: source.stackStatus,
    cellExpiresAt: source.cellExpiresAt,
    cloudFormationRoleArn: source.cloudFormationRoleArn,
    templateCanonicalSha256: source.templateCanonicalSha256,
    resourceInventorySha256: source.resourceInventorySha256,
    ownerDeploymentId: source.ownerDeploymentId,
    generation: source.generation,
    provisionEpoch: source.provisionEpoch,
    provisionMarker: source.provisionMarker,
    provisionOperationHash: source.provisionOperationHash,
  });
  return Object.freeze({
    schemaVersion: 2 as const,
    action: "drain_shared_cell_admissions" as const,
    environmentId,
    provisionLineage,
  });
}

export function assertSharedCellAdmissionDrainReceipt(
  value: unknown,
  expected: {
    readonly predecessor: Pick<
      SharedCellAdmissionFenceLineage,
      "provisionOperationHash" | "stackId"
    >;
    readonly fenceSha256: string;
    readonly cellExpiresAt: number;
  },
): asserts value is SharedCellAdmissionDrainReceipt {
  if (
    !exactKeys(value, [
      "accountId",
      "admissionCellExpiresAt",
      "admissionChangedAt",
      "admissionEpoch",
      "admissionFenceSha256",
      "admissionProvisionOperationHash",
      "admissionStackId",
      "admissionState",
      "cellId",
      "databaseCellExpired",
      "dbObservedAt",
      "environmentId",
      "region",
      "schemaVersion",
    ])
  ) {
    fail(
      "SHARED_CELL_ADMISSION_RECEIPT_INVALID",
      "The admission drain receipt has missing or unexpected fields.",
    );
  }
  const receipt = value as SharedCellAdmissionDrainReceipt;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.admissionState !== "draining" ||
    receipt.accountId !== accountId ||
    receipt.region !== region ||
    receipt.cellId !== cellId ||
    receipt.environmentId !== environmentId ||
    !Number.isSafeInteger(receipt.admissionEpoch) ||
    receipt.admissionEpoch < 1 ||
    receipt.admissionFenceSha256 !== expected.fenceSha256 ||
    receipt.admissionProvisionOperationHash !==
      expected.predecessor.provisionOperationHash ||
    receipt.admissionStackId !== expected.predecessor.stackId ||
    receipt.admissionCellExpiresAt !== expected.cellExpiresAt ||
    !Number.isSafeInteger(receipt.admissionChangedAt) ||
    receipt.admissionChangedAt < expected.cellExpiresAt ||
    !Number.isSafeInteger(receipt.dbObservedAt) ||
    receipt.dbObservedAt < receipt.admissionChangedAt ||
    receipt.databaseCellExpired !== true
  ) {
    fail(
      "SHARED_CELL_ADMISSION_RECEIPT_INVALID",
      "The database did not prove one exact post-expiry draining fence for the provision lineage.",
    );
  }
}
