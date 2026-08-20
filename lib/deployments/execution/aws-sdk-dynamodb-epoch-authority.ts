import type {
  AtomicTenantExternalEpochAuthorityPort,
  TenantExternalEpochAuthorityCandidate,
  TenantExternalEpochAuthorityCoordinate,
  TenantExternalEpochAuthorityRecord,
  TenantExternalEpochAuthoritySnapshot,
} from "./cloudformation-external-ownership.ts";
import { canonicalJson } from "./hash.ts";

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

export interface AwsSdkDynamoDbEpochAuthorityDependencies {
  client: AwsSdkClient;
  commands: {
    get: AwsSdkCommandConstructor;
    put: AwsSdkCommandConstructor;
  };
}

export interface AwsSdkDynamoDbEpochAuthorityConfig {
  tableArn: string;
}

const tableArnPattern =
  /^arn:aws:dynamodb:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):table\/(techlong-sandbox-[A-Za-z0-9_.-]{3,200})$/;
const authorityKeyPattern = /^tenant:([a-f0-9]{64})$/;
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^rev:([0-9]{1,16})$/;
const itemKeys = ["authority_key", "schema_version", "revision", "record_json"] as const;
const recordKeys = [
  "schemaVersion",
  "stableIdentityHash",
  "generation",
  "epoch",
  "intent",
  "ownerDeploymentId",
  "operationHash",
  "marker",
  "predecessor",
] as const;
const candidateKeys = recordKeys.filter((key) => key !== "predecessor");
const coordinateKeys = [
  "schemaVersion",
  "generation",
  "epoch",
  "intent",
  "ownerDeploymentId",
  "operationHash",
  "marker",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function fail(code: string, message: string, retryable = false): never {
  throw Object.assign(new Error(message), { code, retryable });
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

function conditionalFailure(error: unknown): boolean {
  return errorRecord(error).name === "ConditionalCheckFailedException";
}

function providerError(error: unknown, operation: string): Error {
  const source = errorRecord(error);
  const metadata = record(source.$metadata);
  const name = text(source.name) ?? "AWS_DYNAMODB_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(new Error(`AWS DynamoDB authority ${operation} failed.`), {
    code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    retryable:
      Boolean(source.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  });
}

function isLocalAuthorityError(error: unknown): boolean {
  const code = text(errorRecord(error).code);
  return Boolean(code?.startsWith("TENANT_EXTERNAL_EPOCH_"));
}

function coordinate(
  value: TenantExternalEpochAuthorityRecord,
): TenantExternalEpochAuthorityCoordinate {
  return {
    schemaVersion: value.schemaVersion,
    generation: value.generation,
    epoch: value.epoch,
    intent: value.intent,
    ownerDeploymentId: value.ownerDeploymentId,
    operationHash: value.operationHash,
    marker: value.marker,
  };
}

function assertCoordinate(
  value: TenantExternalEpochAuthorityCoordinate,
  stableIdentityHash: string,
): void {
  if (
    !exactKeys(value, coordinateKeys) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    !["provision", "cleanup"].includes(value.intent) ||
    typeof value.ownerDeploymentId !== "string" ||
    value.ownerDeploymentId.length < 1 ||
    value.ownerDeploymentId.length > 200 ||
    !digestPattern.test(value.operationHash) ||
    value.marker !==
      `tl_epoch_${stableIdentityHash.slice(0, 24)}` +
        `_g${value.generation}_e${value.epoch}`
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority predecessor coordinate is invalid.",
    );
  }
}

function assertRecord(
  value: TenantExternalEpochAuthorityRecord,
  stableIdentityHash: string,
): void {
  if (
    !exactKeys(value, recordKeys) ||
    value.schemaVersion !== 1 ||
    value.stableIdentityHash !== stableIdentityHash ||
    !digestPattern.test(value.stableIdentityHash) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    !["provision", "cleanup"].includes(value.intent) ||
    typeof value.ownerDeploymentId !== "string" ||
    value.ownerDeploymentId.length < 1 ||
    value.ownerDeploymentId.length > 200 ||
    !digestPattern.test(value.operationHash) ||
    value.marker !==
      `tl_epoch_${stableIdentityHash.slice(0, 24)}` +
        `_g${value.generation}_e${value.epoch}`
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority record is malformed or belongs to another tenant.",
    );
  }
  if (value.predecessor !== null) {
    assertCoordinate(value.predecessor, stableIdentityHash);
  }
  const previous = value.predecessor;
  if (value.intent === "cleanup") {
    if (
      !previous ||
      previous.intent !== "provision" ||
      previous.generation !== value.generation ||
      previous.epoch >= value.epoch ||
      previous.ownerDeploymentId !== value.ownerDeploymentId
    ) {
      fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "A cleanup authority record requires its exact same-generation provision predecessor.",
      );
    }
  } else if (!previous) {
    if (value.generation !== 1) {
      fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "Only generation-one provision may omit an authority predecessor.",
      );
    }
  } else {
    const sameGenerationProvision =
      previous.intent === "provision" &&
      previous.generation === value.generation &&
      previous.epoch < value.epoch &&
      previous.ownerDeploymentId === value.ownerDeploymentId;
    const reopenedGeneration =
      previous.intent === "cleanup" &&
      previous.generation === value.generation - 1 &&
      value.epoch === 1;
    if (!sameGenerationProvision && !reopenedGeneration) {
      fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "A provision authority record has an invalid predecessor transition.",
      );
    }
  }
}

function assertCandidate(
  value: TenantExternalEpochAuthorityCandidate,
  stableIdentityHash: string,
): void {
  if (!exactKeys(value, candidateKeys)) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority candidate contains missing or unexpected fields.",
    );
  }
  if (
    value.schemaVersion !== 1 ||
    value.stableIdentityHash !== stableIdentityHash ||
    !digestPattern.test(value.stableIdentityHash) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    !["provision", "cleanup"].includes(value.intent) ||
    typeof value.ownerDeploymentId !== "string" ||
    value.ownerDeploymentId.length < 1 ||
    value.ownerDeploymentId.length > 200 ||
    !digestPattern.test(value.operationHash) ||
    value.marker !==
      `tl_epoch_${stableIdentityHash.slice(0, 24)}` +
        `_g${value.generation}_e${value.epoch}`
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority candidate is malformed or belongs to another tenant.",
    );
  }
}

function assertTransition(
  current: TenantExternalEpochAuthorityRecord | null,
  next: TenantExternalEpochAuthorityCandidate,
): void {
  if (!current) {
    if (next.generation !== 1 || next.intent !== "provision") {
      fail(
        "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
        "An empty authority accepts only a generation-one provision epoch.",
      );
    }
    return;
  }
  if (next.generation === current.generation) {
    if (
      current.intent !== "provision" ||
      !["provision", "cleanup"].includes(next.intent) ||
      next.epoch <= current.epoch ||
      next.ownerDeploymentId !== current.ownerDeploymentId
    ) {
      fail(
        "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
        "A generation accepts only a newer provision update or cleanup from its provision predecessor.",
      );
    }
    return;
  }
  if (
    next.generation !== current.generation + 1 ||
    current.intent !== "cleanup" ||
    next.intent !== "provision" ||
    next.epoch !== 1
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
      "A reopened generation requires the immediately preceding cleanup and provision epoch one.",
    );
  }
}

function revisionNumber(revision: string): number {
  const match = revisionPattern.exec(revision);
  const parsed = Number(match?.[1] ?? Number.NaN);
  if (!match || !Number.isSafeInteger(parsed) || parsed < 0) {
    fail("TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID", "Authority revision is invalid.");
  }
  return parsed;
}

function snapshotFromItem(
  authorityKey: string,
  item: unknown,
): TenantExternalEpochAuthoritySnapshot {
  const stableIdentityHash = authorityKeyPattern.exec(authorityKey)?.[1];
  if (!stableIdentityHash) {
    fail("TENANT_EXTERNAL_EPOCH_AUTHORITY_KEY_INVALID", "Authority key is invalid.");
  }
  if (item === undefined) {
    return { authorityKey, revision: "rev:0", record: null };
  }
  const value = record(item);
  if (
    !exactKeys(value, itemKeys) ||
    value.authority_key !== authorityKey ||
    value.schema_version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.record_json !== "string" ||
    value.record_json.length > 16_384
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB returned an invalid authority item.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.record_json);
  } catch {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority record JSON is invalid.",
    );
  }
  const authorityRecord = parsed as TenantExternalEpochAuthorityRecord;
  assertRecord(authorityRecord, stableIdentityHash);
  if (canonicalJson(authorityRecord) !== value.record_json) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "DynamoDB authority record is not canonical JSON.",
    );
  }
  return {
    authorityKey,
    revision: `rev:${value.revision as number}`,
    record: authorityRecord,
  };
}

function assertExpectedSnapshot(
  expected: TenantExternalEpochAuthoritySnapshot,
  authorityKey: string,
): { revision: number; stableIdentityHash: string } {
  const stableIdentityHash = authorityKeyPattern.exec(authorityKey)?.[1];
  if (
    !stableIdentityHash ||
    !exactKeys(expected, ["authorityKey", "revision", "record"]) ||
    expected.authorityKey !== authorityKey
  ) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "Expected authority snapshot does not match the requested key.",
    );
  }
  const revision = revisionNumber(expected.revision);
  if ((expected.record === null) !== (revision === 0)) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "Authority revision zero must represent only an absent record.",
    );
  }
  if (expected.record) assertRecord(expected.record, stableIdentityHash);
  return { revision, stableIdentityHash };
}

/**
 * DynamoDB DocumentClient implementation of the linearizable authority. The
 * item stores canonical record JSON so the single Put condition compares both
 * the revision and the complete predecessor record. No Worker root constructs
 * this adapter yet.
 */
export class AwsSdkDynamoDbEpochAuthority
  implements AtomicTenantExternalEpochAuthorityPort
{
  private readonly tableArn: string;
  private readonly sdk: AwsSdkDynamoDbEpochAuthorityDependencies;

  constructor(
    config: AwsSdkDynamoDbEpochAuthorityConfig,
    sdk: AwsSdkDynamoDbEpochAuthorityDependencies,
  ) {
    const match = tableArnPattern.exec(config.tableArn);
    if (!match) {
      fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_CONFIG_INVALID",
        "DynamoDB authority requires an exact sandbox table ARN.",
      );
    }
    // Keep the complete ARN. GetItem and PutItem both accept a table ARN;
    // reducing it to a name would silently redirect the authority to a
    // same-named table if the credential provider resolved another account.
    this.tableArn = config.tableArn;
    this.sdk = sdk;
  }

  async observe(input: {
    authorityKey: string;
    signal: AbortSignal;
  }): Promise<TenantExternalEpochAuthoritySnapshot> {
    if (!authorityKeyPattern.test(input.authorityKey)) {
      fail("TENANT_EXTERNAL_EPOCH_AUTHORITY_KEY_INVALID", "Authority key is invalid.");
    }
    try {
      input.signal.throwIfAborted();
      const response = await this.sdk.client.send(
        new this.sdk.commands.get({
          TableName: this.tableArn,
          Key: { authority_key: input.authorityKey },
          ConsistentRead: true,
          ProjectionExpression:
            "#authorityKey, #schemaVersion, #revision, #recordJson",
          ExpressionAttributeNames: {
            "#authorityKey": "authority_key",
            "#schemaVersion": "schema_version",
            "#revision": "revision",
            "#recordJson": "record_json",
          },
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return snapshotFromItem(input.authorityKey, response.Item);
    } catch (error) {
      rethrowAbort(input.signal);
      if (isLocalAuthorityError(error)) throw error;
      throw providerError(error, "GetItem");
    }
  }

  async compareAndSet(input: {
    authorityKey: string;
    expected: TenantExternalEpochAuthoritySnapshot;
    next: TenantExternalEpochAuthorityCandidate;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: TenantExternalEpochAuthoritySnapshot;
  }> {
    const { revision, stableIdentityHash } = assertExpectedSnapshot(
      input.expected,
      input.authorityKey,
    );
    assertCandidate(input.next, stableIdentityHash);
    assertTransition(input.expected.record, input.next);
    const nextRecord: TenantExternalEpochAuthorityRecord = {
      ...input.next,
      predecessor: input.expected.record
        ? coordinate(input.expected.record)
        : null,
    };
    assertRecord(nextRecord, stableIdentityHash);
    const recordJson = canonicalJson(nextRecord);
    const nextRevision = revision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      fail("TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID", "Authority revision overflowed.");
    }
    try {
      input.signal.throwIfAborted();
      await this.sdk.client.send(
        new this.sdk.commands.put({
          TableName: this.tableArn,
          Item: {
            authority_key: input.authorityKey,
            schema_version: 1,
            revision: nextRevision,
            record_json: recordJson,
          },
          ConditionExpression:
            revision === 0
              ? "attribute_not_exists(#authorityKey)"
              : "#revision = :expectedRevision AND #recordJson = :expectedRecordJson",
          ExpressionAttributeNames: {
            "#authorityKey": "authority_key",
            "#revision": "revision",
            "#recordJson": "record_json",
          },
          ...(revision === 0
            ? {}
            : {
                ExpressionAttributeValues: {
                  ":expectedRevision": revision,
                  ":expectedRecordJson": canonicalJson(input.expected.record),
                },
              }),
          ReturnValuesOnConditionCheckFailure: "NONE",
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      return {
        applied: true,
        snapshot: {
          authorityKey: input.authorityKey,
          revision: `rev:${nextRevision}`,
          record: nextRecord,
        },
      };
    } catch (error) {
      rethrowAbort(input.signal);
      if (conditionalFailure(error)) {
        return {
          applied: false,
          snapshot: await this.observe({
            authorityKey: input.authorityKey,
            signal: input.signal,
          }),
        };
      }
      if (isLocalAuthorityError(error)) throw error;
      throw providerError(error, "PutItem");
    }
  }
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkCommandConstructor;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkClientConstructor;
}

export async function createAwsSdkDynamoDbEpochAuthority(
  config: AwsSdkDynamoDbEpochAuthorityConfig,
): Promise<AwsSdkDynamoDbEpochAuthority> {
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
  const match = tableArnPattern.exec(config.tableArn);
  if (!match) {
    fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_CONFIG_INVALID",
      "DynamoDB authority requires an exact sandbox table ARN.",
    );
  }
  const lowLevelClient = new DynamoDBClient({ region: match[1] });
  const client = documentFactory.from(lowLevelClient, {
    marshallOptions: {
      removeUndefinedValues: false,
      convertClassInstanceToMap: false,
    },
  });
  return new AwsSdkDynamoDbEpochAuthority(config, {
    client,
    commands: {
      get: commandConstructor(documentModule, "GetCommand"),
      put: commandConstructor(documentModule, "PutCommand"),
    },
  });
}
