import { canonicalJson } from "./hash.ts";
import {
  assertSharedCellCleanupAuthorityActive,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  SharedCellCleanupAuthorityError,
  type AtomicSharedCellCleanupAuthorityPort,
  type SharedCellAuthorityItem,
  type SharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthoritySnapshot,
  validateSharedCellAuthorityItem,
  validateSharedCellCleanupAuthorityItem,
  validateSharedCellCleanupAuthorityTransition,
} from "./shared-cell-cleanup-authority.ts";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => unknown;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkSharedCellCleanupAuthorityDependencies {
  client: AwsSdkClient;
  commands: {
    get: AwsSdkCommandConstructor;
    put: AwsSdkCommandConstructor;
  };
  now?: () => number;
}

export interface AwsSdkSharedCellCleanupAuthorityConfig {
  tableArn: string;
}

export const SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN =
  "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority" as const;

const expectedRegion = "ca-central-1";
const configKeys = ["tableArn"] as const;
const observeInputKeys = ["authorityKey", "signal"] as const;
const compareAndSetInputKeys = [
  "authorityKey",
  "expected",
  "next",
  "signal",
] as const;
const snapshotKeys = ["authorityKey", "item", "revision"] as const;

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  const source = objectRecord(value);
  return (
    Object.keys(source).length === expected.length &&
    canonicalJson(Object.keys(source).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupAuthorityError(code, message, retryable);
}

function assertConfig(config: AwsSdkSharedCellCleanupAuthorityConfig): void {
  if (
    !exactKeys(config, configKeys) ||
    config.tableArn !== SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CONFIG_INVALID",
      "Shared Cell cleanup authority requires the exact sandbox account, region and table ARN.",
    );
  }
}

function assertAuthorityKey(value: unknown): asserts value is typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY {
  if (value !== SHARED_CELL_CLEANUP_AUTHORITY_KEY) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_KEY_INVALID",
      "Shared Cell cleanup authority key is invalid.",
    );
  }
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("AWS DynamoDB operation was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
}

function failAbortedAfterWrite(signal: AbortSignal): never {
  const error = new SharedCellCleanupAuthorityError(
    "SHARED_CELL_CLEANUP_AUTHORITY_ABORTED_AFTER_WRITE",
    "Shared Cell cleanup authority CAS may be committed; an exact readback is required after the abort.",
    true,
  );
  if (signal.reason !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: signal.reason,
    });
  }
  throw error;
}

function requireNotAbortedAfterWrite(signal: AbortSignal): void {
  if (signal.aborted) failAbortedAfterWrite(signal);
}

function conditionalFailure(error: unknown): boolean {
  return objectRecord(error).name === "ConditionalCheckFailedException";
}

function providerError(error: unknown, operation: string): Error {
  const source = objectRecord(error);
  const metadata = objectRecord(source.$metadata);
  const name = text(source.name) ?? "AWS_DYNAMODB_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(
    new Error(`AWS DynamoDB Shared Cell cleanup authority ${operation} failed.`),
    {
      code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
      retryable:
        Boolean(source.$retryable) ||
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
    },
  );
}

function isLocalAuthorityError(error: unknown): boolean {
  return error instanceof SharedCellCleanupAuthorityError;
}

function requireClockValue(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_INVALID",
      "Shared Cell cleanup authority clock is invalid.",
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_INVALID",
      "Shared Cell cleanup authority clock is invalid.",
    );
  }
  return value;
}

function requireClockValueAfterWrite(now: () => number): number {
  try {
    return requireClockValue(now);
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_INVALID_AFTER_WRITE",
      "Shared Cell cleanup authority clock failed after CAS; the write may already be committed.",
      true,
    );
  }
}

function sameItem(
  left: SharedCellAuthorityItem | null,
  right: SharedCellCleanupAuthorityItem,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right);
}

async function snapshotFromItem(
  item: unknown,
): Promise<Readonly<SharedCellCleanupAuthoritySnapshot>> {
  if (item === undefined) {
    return Object.freeze({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      revision: 0,
      item: null,
    });
  }
  const validated = await validateSharedCellAuthorityItem(item);
  return Object.freeze({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    revision: validated.item.revision,
    item: validated.item,
  });
}

function assertExpectedSnapshot(
  expected: SharedCellCleanupAuthoritySnapshot,
): SharedCellAuthorityItem {
  if (
    !exactKeys(expected, snapshotKeys) ||
    expected.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(expected.revision) ||
    expected.revision < 0 ||
    (expected.revision === 0) !== (expected.item === null)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_SNAPSHOT_INVALID",
      "Expected Shared Cell cleanup authority snapshot is malformed.",
    );
  }
  if (expected.item === null) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_BOOTSTRAP_MISSING",
      "Cleanup authority cannot bootstrap an empty table; a trusted provision authority must already exist.",
    );
  }
  if (
    typeof expected.item !== "object" ||
    Array.isArray(expected.item) ||
    expected.item.revision !== expected.revision
  ) {
    fail(
      "SHARED_CELL_CLEANUP_AUTHORITY_SNAPSHOT_INVALID",
      "Expected Shared Cell cleanup authority revision drifted from its item.",
    );
  }
  return expected.item;
}

/**
 * Production DynamoDB DocumentClient port for the Shared Cell cleanup
 * authority. The default runtime does not construct this adapter yet. It is
 * intentionally unable to bootstrap an empty key and accepts only the fixed
 * sandbox table and Cell authority key.
 */
export class AwsSdkSharedCellCleanupAuthority
  implements AtomicSharedCellCleanupAuthorityPort
{
  private readonly tableArn: typeof SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN;
  private readonly sdk: AwsSdkSharedCellCleanupAuthorityDependencies;
  private readonly now: () => number;

  constructor(
    config: AwsSdkSharedCellCleanupAuthorityConfig,
    sdk: AwsSdkSharedCellCleanupAuthorityDependencies,
  ) {
    assertConfig(config);
    this.tableArn = SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN;
    this.sdk = sdk;
    this.now = sdk.now ?? Date.now;
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot> {
    if (!exactKeys(input, observeInputKeys)) {
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
        "Shared Cell cleanup authority observe input is malformed.",
      );
    }
    assertAuthorityKey(input.authorityKey);
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.client.send(
        new this.sdk.commands.get({
          TableName: this.tableArn,
          Key: { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY },
          ConsistentRead: true,
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      const snapshot = await snapshotFromItem(response.Item);
      input.signal.throwIfAborted();
      return snapshot;
    } catch (error) {
      rethrowAbort(input.signal);
      if (isLocalAuthorityError(error)) throw error;
      throw providerError(error, "GetItem");
    }
  }

  async compareAndSet(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    expected: SharedCellCleanupAuthoritySnapshot;
    next: SharedCellCleanupAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellCleanupAuthoritySnapshot;
  }> {
    if (!exactKeys(input, compareAndSetInputKeys)) {
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_INVALID",
        "Shared Cell cleanup authority CAS input is malformed.",
      );
    }
    assertAuthorityKey(input.authorityKey);
    input.signal.throwIfAborted();
    const expectedItem = assertExpectedSnapshot(input.expected);
    const transition = await validateSharedCellCleanupAuthorityTransition({
      expected: expectedItem,
      next: input.next,
    });
    if (transition.expected.item.revision !== input.expected.revision) {
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_SNAPSHOT_INVALID",
        "Expected Shared Cell cleanup authority item failed exact validation.",
      );
    }
    const preWriteNow = requireClockValue(this.now);
    assertSharedCellCleanupAuthorityActive(
      transition.next.record,
      preWriteNow,
    );

    if (transition.kind === "replay") {
      const observed = await this.observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal: input.signal,
      });
      const applied = sameItem(observed.item, transition.next.item);
      if (applied && observed.item) {
        const validated = await validateSharedCellCleanupAuthorityItem(
          observed.item,
        );
        const replayNow = requireClockValue(this.now);
        if (replayNow < preWriteNow) {
          fail(
            "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED",
            "The authority clock regressed while confirming an exact replay.",
          );
        }
        assertSharedCellCleanupAuthorityActive(
          validated.record,
          replayNow,
        );
      }
      input.signal.throwIfAborted();
      return { applied, snapshot: observed };
    }

    input.signal.throwIfAborted();
    try {
      await this.sdk.client.send(
        new this.sdk.commands.put({
          TableName: this.tableArn,
          Item: transition.next.item,
          ConditionExpression:
            "#schemaVersion = :expectedSchemaVersion AND #revision = :expectedRevision AND #recordJson = :expectedRecordJson",
          ExpressionAttributeNames: {
            "#schemaVersion": "schema_version",
            "#revision": "revision",
            "#recordJson": "record_json",
          },
          ExpressionAttributeValues: {
            ":expectedSchemaVersion": transition.expected.item.schema_version,
            ":expectedRevision": transition.expected.item.revision,
            ":expectedRecordJson": transition.expected.item.record_json,
          },
          ReturnValues: "NONE",
          ReturnValuesOnConditionCheckFailure: "NONE",
        }),
        { abortSignal: input.signal },
      );
    } catch (error) {
      if (conditionalFailure(error)) {
        rethrowAbort(input.signal);
        return {
          applied: false,
          snapshot: await this.observe({
            authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
            signal: input.signal,
          }),
        };
      }
      if (input.signal.aborted) failAbortedAfterWrite(input.signal);
      if (isLocalAuthorityError(error)) throw error;
      throw providerError(error, "PutItem");
    }

    requireNotAbortedAfterWrite(input.signal);
    let observed: SharedCellCleanupAuthoritySnapshot;
    try {
      observed = await this.observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal: input.signal,
      });
    } catch {
      if (input.signal.aborted) failAbortedAfterWrite(input.signal);
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_READBACK_FAILED_AFTER_WRITE",
        "DynamoDB accepted the CAS but its exact Shared Cell cleanup authority readback failed.",
        true,
      );
    }
    requireNotAbortedAfterWrite(input.signal);
    if (!sameItem(observed.item, transition.next.item)) {
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_READBACK_MISMATCH",
        "DynamoDB did not read back the exact Shared Cell cleanup authority after CAS.",
        true,
      );
    }
    const afterWriteNow = requireClockValueAfterWrite(this.now);
    if (afterWriteNow < preWriteNow) {
      fail(
        "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE",
        "The authority clock regressed after CAS; the write may already be committed.",
        true,
      );
    }
    assertSharedCellCleanupAuthorityActive(
      transition.next.record,
      afterWriteNow,
      true,
    );
    requireNotAbortedAfterWrite(input.signal);
    return { applied: true, snapshot: observed };
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

export async function createAwsSdkSharedCellCleanupAuthority(
  config: AwsSdkSharedCellCleanupAuthorityConfig,
): Promise<AwsSdkSharedCellCleanupAuthority> {
  assertConfig(config);
  const dynamoPackage = "@aws-sdk/client-dynamodb";
  const documentPackage = "@aws-sdk/lib-dynamodb";
  const [dynamoModule, documentModule] = (await Promise.all([
    import(dynamoPackage),
    import(documentPackage),
  ])) as [Record<string, unknown>, Record<string, unknown>];
  const DynamoDBClient = clientConstructor(dynamoModule, "DynamoDBClient");
  const documentFactory = documentModule.DynamoDBDocumentClient as
    | { from(client: unknown, options?: Record<string, unknown>): AwsSdkClient }
    | undefined;
  if (!documentFactory || typeof documentFactory.from !== "function") {
    throw new Error("AWS SDK export DynamoDBDocumentClient is missing.");
  }
  const lowLevelClient = new DynamoDBClient({ region: expectedRegion });
  const client = documentFactory.from(lowLevelClient, {
    marshallOptions: {
      removeUndefinedValues: false,
      convertClassInstanceToMap: false,
    },
  });
  return new AwsSdkSharedCellCleanupAuthority(config, {
    client,
    commands: {
      get: commandConstructor(documentModule, "GetCommand"),
      put: commandConstructor(documentModule, "PutCommand"),
    },
  });
}
