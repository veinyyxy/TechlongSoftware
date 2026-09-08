import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  type AtomicSharedCellCleanupAuthorityPort,
  type SharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthoritySnapshot,
} from "./shared-cell-cleanup-authority.ts";
import {
  GrantBoundSharedCellCleanupAuthorityCasPort,
  SharedCellCleanupAuthorityOperatorError,
  type SharedCellCleanupAuthorityCasGrant,
  type StrongReadSharedCellCleanupAuthorityPort,
} from "./shared-cell-cleanup-authority-operator.ts";
import type { StrongSharedCellCleanupAuthorityReadPort } from "./shared-cell-cleanup-deletion.ts";

const inputKeys = ["authorityKey", "expected", "next", "signal"] as const;
const readKeys = ["authorityKey", "signal"] as const;

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  const keys = Object.keys(objectRecord(value)).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupAuthorityOperatorError(code, message, retryable);
}

function requireSignal(value: unknown): asserts value is AbortSignal {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as AbortSignal).throwIfAborted !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_GRANT_SIGNAL_INVALID",
      "The cleanup authority grant requires an AbortSignal.",
    );
  }
}

function canonicalClone<T>(value: T, label: string): T {
  try {
    return JSON.parse(canonicalJson(value)) as T;
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_GRANT_WRITE_INVALID",
      `The cleanup authority ${label} is not immutable JSON data.`,
    );
  }
}

function pinnedClock(value: (() => number) | undefined): () => number {
  if (value !== undefined && typeof value !== "function") {
    fail(
      "SHARED_CELL_CLEANUP_GRANT_CLOCK_INVALID",
      "The cleanup authority grant clock is invalid.",
    );
  }
  return value ?? Date.now;
}

function readClock(clock: () => number): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_GRANT_CLOCK_INVALID",
      "The cleanup authority grant clock could not be read.",
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_CLEANUP_GRANT_CLOCK_INVALID",
      "The cleanup authority grant clock is not a positive safe integer.",
    );
  }
  return value;
}

function pinnedDelegate(
  value: AtomicSharedCellCleanupAuthorityPort,
): AtomicSharedCellCleanupAuthorityPort {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.observe !== "function" ||
    typeof value.compareAndSet !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_GRANT_DELEGATE_INVALID",
      "The cleanup authority CAS delegate is invalid.",
    );
  }
  const observe = value.observe;
  const compareAndSet = value.compareAndSet;
  return Object.freeze({
    observe: (
      input: Parameters<AtomicSharedCellCleanupAuthorityPort["observe"]>[0],
    ) => observe.call(value, input),
    compareAndSet: (
      input: Parameters<
        AtomicSharedCellCleanupAuthorityPort["compareAndSet"]
      >[0],
    ) => compareAndSet.call(value, input),
  });
}

function assertReadInput(input: {
  authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
  signal: AbortSignal;
}): void {
  if (
    !exactKeys(input, readKeys) ||
    input.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY
  ) {
    fail(
      "SHARED_CELL_CLEANUP_GRANT_READ_INVALID",
      "The cleanup authority strong-read input is invalid.",
    );
  }
  requireSignal(input.signal);
}

/**
 * A capability-reducing view over the production DynamoDB authority adapter.
 * It deliberately omits compareAndSet(), so deletion code cannot acquire a
 * writer merely by receiving its strong-read dependency.
 */
export class SharedCellCleanupAuthorityStrongReadView
  implements
    StrongReadSharedCellCleanupAuthorityPort,
    StrongSharedCellCleanupAuthorityReadPort
{
  private readonly read: AtomicSharedCellCleanupAuthorityPort["observe"];

  constructor(delegate: Pick<AtomicSharedCellCleanupAuthorityPort, "observe">) {
    if (!delegate || typeof delegate.observe !== "function") {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_READER_INVALID",
        "The cleanup authority strong reader is invalid.",
      );
    }
    const observe = delegate.observe;
    this.read = (input) => observe.call(delegate, input);
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot> {
    assertReadInput(input);
    input.signal.throwIfAborted();
    return await this.read(input);
  }

  async readStrong(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot> {
    return await this.observe(input);
  }
}

/**
 * Defense-in-depth around the existing conditional DynamoDB adapter. The
 * operator already checks this binding; this wrapper repeats it at the final
 * provider capability boundary so direct or accidental calls cannot widen a
 * reviewed grant.
 */
export class AwsSdkGrantBoundSharedCellCleanupAuthorityCas
  extends GrantBoundSharedCellCleanupAuthorityCasPort
{
  private readonly delegate: AtomicSharedCellCleanupAuthorityPort;
  private readonly now: () => number;
  private readonly grantExpiresAt: number;

  constructor(
    grant: SharedCellCleanupAuthorityCasGrant,
    delegate: AtomicSharedCellCleanupAuthorityPort,
    now?: () => number,
  ) {
    super(grant);
    this.delegate = pinnedDelegate(delegate);
    this.now = pinnedClock(now);
    this.grantExpiresAt = Date.parse(this.grant.expiresAt);
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot> {
    assertReadInput(input);
    input.signal.throwIfAborted();
    return await this.delegate.observe(input);
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
    if (
      !exactKeys(input, inputKeys) ||
      input.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY
    ) {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_WRITE_INVALID",
        "The cleanup authority grant write input is invalid.",
      );
    }
    requireSignal(input.signal);
    input.signal.throwIfAborted();
    if (this.grantExpiresAt <= readClock(this.now)) {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_EXPIRED",
        "The cleanup authority CAS grant expired before provider submission.",
      );
    }
    const expected = canonicalClone(input.expected, "expected snapshot");
    const next = canonicalClone(input.next, "candidate item");
    if (!expected.item) {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_PREDECESSOR_MISSING",
        "The cleanup authority grant cannot bootstrap an absent predecessor.",
      );
    }
    const [expectedSha256, nextSha256] = await Promise.all([
      sha256Hex(expected.item),
      sha256Hex(next),
    ]);
    input.signal.throwIfAborted();
    if (
      expectedSha256 !== this.grant.expectedPredecessorItemSha256 ||
      nextSha256 !== this.grant.approvedCandidateItemSha256
    ) {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_SCOPE_MISMATCH",
        "The cleanup authority CAS differs from the exact reviewed grant.",
      );
    }
    if (this.grantExpiresAt <= readClock(this.now)) {
      fail(
        "SHARED_CELL_CLEANUP_GRANT_EXPIRED",
        "The cleanup authority CAS grant expired before provider submission.",
      );
    }
    input.signal.throwIfAborted();
    return this.delegate.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected,
      next,
      signal: input.signal,
    });
  }
}
