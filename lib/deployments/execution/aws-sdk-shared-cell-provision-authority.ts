import { canonicalJson } from "./hash.ts";
import {
  AwsSdkSharedCellCleanupAuthority,
  SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
  type AwsSdkSharedCellCleanupAuthorityDependencies,
} from "./aws-sdk-shared-cell-cleanup-authority.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  type SharedCellAuthorityItem,
  validateSharedCellAuthorityItem,
} from "./shared-cell-cleanup-authority.ts";
import {
  assertCompiledSharedCellProvisionAuthorityCandidate,
  SharedCellProvisionAuthorityError,
  type AtomicSharedCellProvisionAuthorityPort,
  type SharedCellProvisionAuthoritySnapshot,
} from "./shared-cell-provision-authority.ts";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

export interface AwsSdkSharedCellProvisionAuthorityDependencies {
  client: AwsSdkClient;
  commands: {
    get: AwsSdkCommandConstructor;
    put: AwsSdkCommandConstructor;
  };
  now?: () => number;
}

export interface AwsSdkSharedCellProvisionAuthorityConfig {
  tableArn: string;
}

const observeInputKeys = ["authorityKey", "signal"] as const;
const installInputKeys = ["authorityKey", "next", "signal"] as const;

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellProvisionAuthorityError(code, message, retryable);
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

function assertConfig(config: AwsSdkSharedCellProvisionAuthorityConfig): void {
  if (
    !exactKeys(config, ["tableArn"]) ||
    config.tableArn !== SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN
  ) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_CONFIG_INVALID",
      "Provision authority must use the exact reviewed Sandbox DynamoDB table ARN.",
    );
  }
}

function assertAuthorityKey(value: unknown): void {
  if (value !== SHARED_CELL_CLEANUP_AUTHORITY_KEY) {
    fail(
      "SHARED_CELL_PROVISION_AUTHORITY_KEY_INVALID",
      "Provision authority key is outside the fixed Shared Cell allowlist.",
    );
  }
}

function clockValue(clock: () => number, afterWrite = false): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID",
      afterWrite
        ? "Provision authority clock failed after PutItem; the write may already be committed."
        : "Provision authority clock failed before PutItem.",
      afterWrite,
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      afterWrite
        ? "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID_AFTER_WRITE"
        : "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_INVALID",
      afterWrite
        ? "Provision authority clock was invalid after PutItem; the write may already be committed."
        : "Provision authority clock is invalid.",
      afterWrite,
    );
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function conditionalFailure(error: unknown): boolean {
  return record(error).name === "ConditionalCheckFailedException";
}

function providerCode(error: unknown): string {
  const name = record(error).name;
  return (typeof name === "string" && name ? name : "PutItemFailed")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 100);
}

function failAbortedAfterWrite(signal: AbortSignal): never {
  const error = new SharedCellProvisionAuthorityError(
    "SHARED_CELL_PROVISION_AUTHORITY_ABORTED_AFTER_WRITE",
    "Provision authority install was aborted after PutItem started; the result is uncertain.",
    true,
  );
  Object.defineProperty(error, "cause", { value: signal.reason });
  throw error;
}

function sameItem(
  left: SharedCellAuthorityItem | null,
  right: SharedCellAuthorityItem,
): boolean {
  return left !== null && canonicalJson(left) === canonicalJson(right);
}

/**
 * Concrete, dormant DynamoDB adapter for the one allowed genesis transition.
 * It is intentionally separate from cleanup CAS and cannot overwrite any
 * existing item.
 */
export class AwsSdkSharedCellProvisionAuthority
  implements AtomicSharedCellProvisionAuthorityPort
{
  readonly #sdk: AwsSdkSharedCellProvisionAuthorityDependencies;
  readonly #observer: AwsSdkSharedCellCleanupAuthority;
  readonly #now: () => number;

  constructor(
    config: AwsSdkSharedCellProvisionAuthorityConfig,
    sdk: AwsSdkSharedCellProvisionAuthorityDependencies,
  ) {
    assertConfig(config);
    this.#sdk = sdk;
    this.#now = sdk.now ?? Date.now;
    const observerDependencies: AwsSdkSharedCellCleanupAuthorityDependencies = {
      client: sdk.client,
      commands: sdk.commands,
      now: this.#now,
    };
    this.#observer = new AwsSdkSharedCellCleanupAuthority(
      { tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN },
      observerDependencies,
    );
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellProvisionAuthoritySnapshot> {
    if (!exactKeys(input, observeInputKeys)) {
      fail(
        "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
        "Provision authority observe input is malformed.",
      );
    }
    const authorityKey = input.authorityKey;
    const signal = input.signal;
    assertAuthorityKey(authorityKey);
    return this.#observer.observe({ authorityKey, signal });
  }

  async installIfAbsent(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    next: SharedCellAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellProvisionAuthoritySnapshot;
  }> {
    if (!exactKeys(input, installInputKeys)) {
      fail(
        "SHARED_CELL_PROVISION_AUTHORITY_INVALID",
        "Provision authority install input is malformed.",
      );
    }
    const authorityKey = input.authorityKey;
    const next = input.next;
    const signal = input.signal;
    assertAuthorityKey(authorityKey);
    signal.throwIfAborted();
    const validated = await validateSharedCellAuthorityItem(next);
    signal.throwIfAborted();
    if (
      validated.record.state !== "provision_verified" ||
      validated.item.revision !== 1 ||
      validated.record.revision !== 1 ||
      validated.record.generation !== 1 ||
      validated.record.provisionEpoch !== 1
    ) {
      fail(
        "SHARED_CELL_PROVISION_AUTHORITY_GENESIS_INVALID",
        "DynamoDB may install only the exact generation 1, epoch 1 provision predecessor.",
      );
    }
    const preWriteNow = clockValue(this.#now);
    assertCompiledSharedCellProvisionAuthorityCandidate(next, preWriteNow);
    signal.throwIfAborted();

    try {
      await this.#sdk.client.send(
        new this.#sdk.commands.put({
          TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
          Item: validated.item,
          ConditionExpression: "attribute_not_exists(#authorityKey)",
          ExpressionAttributeNames: {
            "#authorityKey": "authority_key",
          },
          ReturnValuesOnConditionCheckFailure: "NONE",
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      if (conditionalFailure(error)) {
        if (signal.aborted) signal.throwIfAborted();
        return {
          applied: false,
          snapshot: await this.observe({
            authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
            signal,
          }),
        };
      }
      if (signal.aborted) failAbortedAfterWrite(signal);
      throw new SharedCellProvisionAuthorityError(
        "SHARED_CELL_PROVISION_AUTHORITY_WRITE_UNCERTAIN",
        `DynamoDB ${providerCode(error)} failed after PutItem started; the result is uncertain.`,
        true,
      );
    }

    if (signal.aborted) failAbortedAfterWrite(signal);
    let observed: SharedCellProvisionAuthoritySnapshot;
    try {
      observed = await this.observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal,
      });
    } catch {
      if (signal.aborted) failAbortedAfterWrite(signal);
      return fail(
        "SHARED_CELL_PROVISION_AUTHORITY_READBACK_FAILED_AFTER_WRITE",
        "DynamoDB accepted PutItem but its strongly consistent readback failed.",
        true,
      );
    }
    if (signal.aborted) failAbortedAfterWrite(signal);
    if (observed.revision !== 1 || !sameItem(observed.item, validated.item)) {
      fail(
        "SHARED_CELL_PROVISION_AUTHORITY_READBACK_MISMATCH",
        "DynamoDB did not read back the exact provision predecessor after PutItem.",
        true,
      );
    }
    const afterWriteNow = clockValue(this.#now, true);
    if (afterWriteNow < preWriteNow) {
      fail(
        "SHARED_CELL_PROVISION_AUTHORITY_CLOCK_REGRESSED_AFTER_WRITE",
        "Provision authority clock regressed after PutItem; the write may already be committed.",
        true,
      );
    }
    assertCompiledSharedCellProvisionAuthorityCandidate(
      next,
      afterWriteNow,
      true,
    );
    if (signal.aborted) failAbortedAfterWrite(signal);
    return { applied: true, snapshot: observed };
  }
}
