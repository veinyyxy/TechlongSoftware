import type { EcsOneShotReceiptReader } from "./aws-sdk-ecs-one-shot-api.ts";
import {
  tenantOneShotExpectedReceiptBucketArn,
  tenantOneShotReceiptBucketName,
  tenantOneShotReceiptHash,
  tenantOneShotRequestHash,
  type EcsOneShotTaskRequest,
  type TenantDatabaseOneShotOperation,
  type TenantDatabaseOneShotOutput,
  type TenantDatabaseOneShotReceipt,
} from "./ecs-one-shot-task.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkS3OneShotReceiptReaderDependencies {
  client: AwsSdkClient;
  commands: {
    getObject: AwsSdkCommandConstructor;
  };
}

export interface AwsSdkS3OneShotReceiptReaderConfig {
  expectedBucketOwner: string;
  expectedRegion: string;
  receiptBucketArn: string;
  maximumReceiptBytes?: number;
}

export interface TenantDatabaseOneShotRawResult {
  schemaVersion: 1;
  operation: TenantDatabaseOneShotOperation;
  resourceGeneration: number;
  ownershipMarker: string;
  externalEpoch: number;
  externalMarker: string;
  externalOperationHash: string;
  output: TenantDatabaseOneShotOutput;
  outputHash: string;
}

// Must remain byte-for-byte aligned with the SpeedFeast lifecycle publisher.
// This is a protocol limit, not a caller-tunable resource setting.
export const MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES = 4_096;

const accountPattern = /^\d{12}$/;
const regionPattern = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const digestPattern = /^[a-f0-9]{64}$/;
const checksumPattern = /^[A-Za-z0-9+/]{43}=$/;
const clusterArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):cluster\/([A-Za-z0-9][A-Za-z0-9_-]{0,254})$/;
const taskArnPattern =
  /^arn:aws:ecs:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):task\/([A-Za-z0-9][A-Za-z0-9_-]{0,254})\/([a-f0-9]{32})$/;
const receiptKeyPattern =
  /^tenant-lifecycle\/v1\/([a-f0-9]{32})\/g([1-9][0-9]*)\/([a-f0-9]{64})\.json$/;
const ownershipMarkerPattern =
  /^tl_owner_([a-f0-9]{32})_g([1-9][0-9]*)$/;
const rawResultKeys = [
  "schemaVersion",
  "operation",
  "resourceGeneration",
  "ownershipMarker",
  "externalEpoch",
  "externalMarker",
  "externalOperationHash",
  "output",
  "outputHash",
] as const;
const operations = [
  "inspect",
  "prepare_empty_database",
  "restore_approved_baseline",
  "migrate_saas",
  "verify",
  "destroy",
] as const satisfies readonly TenantDatabaseOneShotOperation[];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function fail(code: string, message: string, retryable = false): never {
  throw new TenantDatabaseLifecycleError(code, message, retryable);
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("AWS S3 receipt read was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
}

function isMissing(error: unknown): boolean {
  const value = errorRecord(error);
  const metadata = record(value.$metadata);
  return (
    ["NoSuchKey", "NotFound"].includes(text(value.name) ?? "") ||
    Number(metadata.httpStatusCode ?? 0) === 404
  );
}

function providerError(error: unknown): Error {
  const value = errorRecord(error);
  const metadata = record(value.$metadata);
  const name = text(value.name) ?? "AWS_S3_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(new Error("AWS S3 tenant receipt GetObject failed."), {
    code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    retryable:
      Boolean(value.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|SlowDown/i.test(name),
  });
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function readBoundedBody(
  value: unknown,
  maximumBytes: number,
): Promise<Uint8Array> {
  const direct = asBytes(value);
  if (direct) {
    if (direct.byteLength > maximumBytes) {
      fail(
        "TENANT_ONE_SHOT_RECEIPT_TOO_LARGE",
        "Tenant one-shot S3 receipt exceeds the reviewed byte bound.",
      );
    }
    return new Uint8Array(direct);
  }
  if (!value || typeof value !== "object") {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot S3 receipt has no readable byte body.",
    );
  }
  const iterable = value as AsyncIterable<unknown>;
  if (typeof iterable[Symbol.asyncIterator] !== "function") {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot S3 receipt body is not a bounded byte stream.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const candidate of iterable) {
    const chunk = asBytes(candidate);
    if (!chunk || chunk.byteLength < 1) {
      fail(
        "TENANT_ONE_SHOT_RECEIPT_INVALID",
        "Tenant one-shot S3 receipt stream contains a non-byte or empty chunk.",
      );
    }
    total += chunk.byteLength;
    if (total > maximumBytes) {
      fail(
        "TENANT_ONE_SHOT_RECEIPT_TOO_LARGE",
        "Tenant one-shot S3 receipt exceeds the reviewed byte bound.",
      );
    }
    chunks.push(new Uint8Array(chunk));
  }
  if (total < 1) {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot S3 receipt body is empty.",
    );
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput.buffer),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function assertSafeOutput(value: unknown): asserts value is TenantDatabaseOneShotOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot raw result output must be one JSON object.",
    );
  }
  const encoded = canonicalJson(value);
  if (
    encoded.length > 16_384 ||
    /(?:password|database[_-]?url|postgres(?:ql)?:\/\/|secret[_-]?value|access[_-]?token|private[_-]?key)/i.test(
      encoded,
    )
  ) {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_UNSAFE",
      "Tenant one-shot raw result contains forbidden secret material.",
    );
  }
}

function assertExactTaskAndLocation(input: {
  clusterArn: string;
  taskArn: string;
  expectedRequest: EcsOneShotTaskRequest;
  expectedBucketOwner: string;
  expectedRegion: string;
  receiptBucketArn: string;
}): void {
  const cluster = clusterArnPattern.exec(input.clusterArn);
  const task = taskArnPattern.exec(input.taskArn);
  const requestCluster = clusterArnPattern.exec(input.expectedRequest.clusterArn);
  const bucketName = tenantOneShotReceiptBucketName(input.receiptBucketArn);
  const environment = input.expectedRequest.container.environment;
  const owner = ownershipMarkerPattern.exec(environment.TENANT_OWNERSHIP_MARKER);
  const key = receiptKeyPattern.exec(input.expectedRequest.receipt.key);
  const generation = environment.TENANT_RESOURCE_GENERATION;
  if (
    !cluster ||
    !task ||
    !requestCluster ||
    input.expectedRequest.clusterArn !== input.clusterArn ||
    cluster[1] !== input.expectedRegion ||
    cluster[2] !== input.expectedBucketOwner ||
    task[1] !== input.expectedRegion ||
    task[2] !== input.expectedBucketOwner ||
    task[3] !== cluster[3] ||
    requestCluster[1] !== input.expectedRegion ||
    requestCluster[2] !== input.expectedBucketOwner ||
    input.expectedRequest.receipt.bucketArn !== input.receiptBucketArn ||
    !owner ||
    owner[2] !== generation ||
    !key ||
    key[1] !== owner[1] ||
    key[2] !== generation ||
    key[3] !== input.expectedRequest.clientToken ||
    environment.TENANT_RECEIPT_BUCKET !== bucketName ||
    environment.TENANT_RECEIPT_EXPECTED_BUCKET_OWNER !==
      input.expectedBucketOwner ||
    environment.TENANT_RECEIPT_KEY !== input.expectedRequest.receipt.key
  ) {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_LOCATION_INVALID",
      "Tenant receipt location is not bound to the exact task, request, tenant generation, account, and region.",
    );
  }
}

async function finalReceipt(input: {
  taskArn: string;
  expectedRequest: EcsOneShotTaskRequest;
  raw: TenantDatabaseOneShotRawResult;
}): Promise<TenantDatabaseOneShotReceipt> {
  const environment = input.expectedRequest.container.environment;
  assertSafeOutput(input.raw.output);
  const outputHash = await sha256Hex(input.raw.output);
  if (
    !exactKeys(input.raw, rawResultKeys) ||
    input.raw.schemaVersion !== 1 ||
    !operations.includes(input.raw.operation) ||
    input.raw.operation !== environment.TENANT_DATABASE_OPERATION ||
    !Number.isSafeInteger(input.raw.resourceGeneration) ||
    input.raw.resourceGeneration < 1 ||
    input.raw.resourceGeneration !== Number(environment.TENANT_RESOURCE_GENERATION) ||
    input.raw.ownershipMarker !== environment.TENANT_OWNERSHIP_MARKER ||
    !Number.isSafeInteger(input.raw.externalEpoch) ||
    input.raw.externalEpoch < 1 ||
    input.raw.externalEpoch !== Number(environment.TENANT_EXTERNAL_OPERATION_EPOCH) ||
    input.raw.externalMarker !== environment.TENANT_EXTERNAL_OPERATION_MARKER ||
    input.raw.externalOperationHash !== environment.TENANT_EXTERNAL_OPERATION_HASH ||
    !digestPattern.test(input.raw.externalOperationHash) ||
    !digestPattern.test(input.raw.outputHash) ||
    input.raw.outputHash !== outputHash
  ) {
    fail(
      "TENANT_ONE_SHOT_RECEIPT_INVALID",
      "Tenant one-shot raw result is stale, foreign, malformed, or has an invalid output hash.",
    );
  }
  const withoutReceiptHash = {
    schemaVersion: 1 as const,
    taskArn: input.taskArn,
    operation: input.raw.operation,
    outcome: "succeeded" as const,
    resourceGeneration: input.raw.resourceGeneration,
    ownershipMarker: input.raw.ownershipMarker,
    externalEpoch: input.raw.externalEpoch,
    externalMarker: input.raw.externalMarker,
    externalOperationHash: input.raw.externalOperationHash,
    requestHash: await tenantOneShotRequestHash(input.expectedRequest),
    output: input.raw.output,
    outputHash,
  };
  return {
    ...withoutReceiptHash,
    receiptHash: await tenantOneShotReceiptHash(withoutReceiptHash),
  };
}

/**
 * Reads one task result from an exact, account-owned S3 bucket. The task is
 * allowed to write only the raw, fence-bound result. Task/request/output and
 * final receipt hashes are constructed here, inside the trusted platform.
 * This adapter is deliberately not wired into the deployment Worker root.
 */
export class AwsSdkS3OneShotReceiptReader implements EcsOneShotReceiptReader {
  private readonly config: Required<AwsSdkS3OneShotReceiptReaderConfig>;
  private readonly bucketName: string;
  private readonly sdk: AwsSdkS3OneShotReceiptReaderDependencies;

  constructor(
    config: AwsSdkS3OneShotReceiptReaderConfig,
    sdk: AwsSdkS3OneShotReceiptReaderDependencies,
  ) {
    let bucketName: string;
    try {
      bucketName = tenantOneShotReceiptBucketName(config.receiptBucketArn);
    } catch {
      fail(
        "TENANT_ONE_SHOT_RECEIPT_CONFIG_INVALID",
        "S3 receipt reader requires a complete sandbox bucket ARN.",
      );
    }
    const maximumReceiptBytes =
      config.maximumReceiptBytes ?? MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES;
    if (
      !accountPattern.test(config.expectedBucketOwner) ||
      !regionPattern.test(config.expectedRegion) ||
      config.receiptBucketArn !==
        tenantOneShotExpectedReceiptBucketArn({
          accountId: config.expectedBucketOwner,
          region: config.expectedRegion,
        }) ||
      maximumReceiptBytes !== MAX_TENANT_ONE_SHOT_RAW_RECEIPT_BYTES ||
      !sdk.client ||
      typeof sdk.client.send !== "function" ||
      typeof sdk.commands.getObject !== "function"
    ) {
      fail(
        "TENANT_ONE_SHOT_RECEIPT_CONFIG_INVALID",
        "S3 receipt reader account, region, byte bound, or SDK boundary is invalid.",
      );
    }
    this.bucketName = bucketName;
    this.config = { ...config, maximumReceiptBytes };
    this.sdk = sdk;
  }

  async read(input: {
    clusterArn: string;
    taskArn: string;
    expectedRequest: EcsOneShotTaskRequest;
    signal: AbortSignal;
  }): Promise<TenantDatabaseOneShotReceipt | null> {
    assertExactTaskAndLocation({
      ...input,
      expectedBucketOwner: this.config.expectedBucketOwner,
      expectedRegion: this.config.expectedRegion,
      receiptBucketArn: this.config.receiptBucketArn,
    });
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.client.send(
        new this.sdk.commands.getObject({
          Bucket: this.bucketName,
          Key: input.expectedRequest.receipt.key,
          ExpectedBucketOwner: this.config.expectedBucketOwner,
          ChecksumMode: "ENABLED",
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      const contentLength = response.ContentLength;
      const expectedChecksum = text(response.ChecksumSHA256);
      if (
        typeof contentLength !== "number" ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1 ||
        contentLength > this.config.maximumReceiptBytes ||
        response.ContentType !== "application/json" ||
        response.ContentEncoding !== undefined ||
        response.ContentRange !== undefined ||
        response.ServerSideEncryption !== "AES256" ||
        response.ChecksumType !== "FULL_OBJECT" ||
        !expectedChecksum ||
        response.ChecksumSHA256 !== expectedChecksum ||
        !checksumPattern.test(expectedChecksum)
      ) {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_METADATA_INVALID",
          "S3 receipt metadata, encryption, checksum, content type, or byte length is invalid.",
        );
      }
      const bytes = await readBoundedBody(
        response.Body,
        this.config.maximumReceiptBytes,
      );
      input.signal.throwIfAborted();
      if (
        bytes.byteLength !== contentLength ||
        (await sha256Base64(bytes)) !== expectedChecksum
      ) {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_CHECKSUM_INVALID",
          "S3 receipt body does not match its full-object SHA-256 checksum.",
        );
      }
      if (
        bytes.byteLength >= 3 &&
        bytes[0] === 0xef &&
        bytes[1] === 0xbb &&
        bytes[2] === 0xbf
      ) {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_INVALID",
          "S3 receipt body must be canonical UTF-8 without a byte-order mark.",
        );
      }
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_INVALID",
          "S3 receipt body is not valid UTF-8 JSON.",
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(source);
      } catch {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_INVALID",
          "S3 receipt body is not exactly one JSON envelope.",
        );
      }
      const raw = record(decoded);
      if (
        !exactKeys(raw, rawResultKeys) ||
        canonicalJson(decoded) !== source
      ) {
        fail(
          "TENANT_ONE_SHOT_RECEIPT_INVALID",
          "S3 receipt body must contain exactly one minimal raw-result envelope.",
        );
      }
      return await finalReceipt({
        taskArn: input.taskArn,
        expectedRequest: input.expectedRequest,
        raw: raw as unknown as TenantDatabaseOneShotRawResult,
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isMissing(error)) return null;
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error);
    }
  }
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkCommandConstructor;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkClientConstructor;
}

export async function createAwsSdkS3OneShotReceiptReader(
  config: AwsSdkS3OneShotReceiptReaderConfig,
): Promise<AwsSdkS3OneShotReceiptReader> {
  const packageName = "@aws-sdk/client-s3";
  const sdkModule = (await import(packageName)) as Record<string, unknown>;
  const S3Client = clientConstructor(sdkModule, "S3Client");
  return new AwsSdkS3OneShotReceiptReader(config, {
    client: new S3Client({ region: config.expectedRegion }),
    commands: {
      getObject: commandConstructor(sdkModule, "GetObjectCommand"),
    },
  });
}
