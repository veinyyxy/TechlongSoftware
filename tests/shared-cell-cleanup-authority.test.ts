import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { AwsSdkDynamoDbEpochAuthority } from "../lib/deployments/execution/aws-sdk-dynamodb-epoch-authority.ts";
import {
  advanceSharedCellCleanupAuthority,
  compileSharedCellCleanupAuthorityCandidateItem as compileRawSharedCellCleanupAuthorityCandidateItem,
  DisabledAtomicSharedCellCleanupAuthority,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  type AtomicSharedCellCleanupAuthorityPort,
  type CompileSharedCellCleanupAuthorityInput,
  type SharedCellAuthorityItem,
  type SharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthoritySnapshot,
  type SharedCellProvisionAuthorityRecord,
  sharedCellProvisionOperationIntent,
  validateSharedCellAuthorityItem,
  validateSharedCellCleanupAuthorityItem,
  validateSharedCellCleanupAuthorityTransition,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";

const require = createRequire(import.meta.url);
const { decodeAuthorityItem, validateAuthorityItem } = require(
  "../ops/aws-sandbox/lambda/cell-janitor.cjs",
) as {
  decodeAuthorityItem(item: unknown): Record<string, unknown>;
  validateAuthorityItem(item: unknown, now: number): Record<string, unknown>;
};

const now = Date.UTC(2026, 7, 29, 6, 0, 0);
const stackName = "techlong-sandbox-cell-sandbox-1" as const;
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${stackName}/12345678-1234-1234-1234-123456789012`;

function compileInput(
  overrides: Partial<CompileSharedCellCleanupAuthorityInput> = {},
): CompileSharedCellCleanupAuthorityInput {
  return {
    cell: {
      stackName,
      stackId,
      stackStatus: "UPDATE_COMPLETE",
      cellExpiresAt: new Date(now - 60_000).toISOString(),
      templateCanonicalSha256: "a".repeat(64),
      resourceInventorySha256: "b".repeat(64),
    },
    provision: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 3,
      epoch: 8,
      operationHash:
        "bc2dbf0d90da77e539caaa16bb71f78e7d5da61eeacaefe5c4c6a1563dc467c4",
    },
    cleanup: {
      epoch: 9,
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
    },
    revision: 7,
    now,
    ...overrides,
  };
}

async function compileSharedCellCleanupAuthorityCandidateItem(
  input: CompileSharedCellCleanupAuthorityInput,
) {
  const provisionMarker =
    `tl_cell_epoch_cell-sandbox-1_g${input.provision.generation}` +
    `_e${input.provision.epoch}`;
  const operationHash = await sha256Hex(
    sharedCellProvisionOperationIntent({
      schemaVersion: 1,
      accountId: "402010193138",
      region: "ca-central-1",
      cellId: "cell-sandbox-1",
      stackName,
      stackId: input.cell.stackId,
      stackStatus: input.cell.stackStatus,
      cellExpiresAt: input.cell.cellExpiresAt,
      templateCanonicalSha256: input.cell.templateCanonicalSha256,
      resourceInventorySha256: input.cell.resourceInventorySha256,
      ownerDeploymentId: input.provision.ownerDeploymentId,
      generation: input.provision.generation,
      provisionEpoch: input.provision.epoch,
      provisionMarker,
    }),
  );
  return compileRawSharedCellCleanupAuthorityCandidateItem({
    ...input,
    provision: { ...input.provision, operationHash },
  });
}

function snapshot(
  revision = 0,
  item: SharedCellAuthorityItem | null = null,
): SharedCellCleanupAuthoritySnapshot {
  return {
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    revision,
    item,
  };
}

async function provisionItem(
  revision = 6,
  overrides: Partial<Omit<SharedCellProvisionAuthorityRecord, "recordHash">> = {},
): Promise<Readonly<SharedCellAuthorityItem>> {
  const seed: Omit<
    SharedCellProvisionAuthorityRecord,
    "provisionOperationHash" | "recordHash"
  > = {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    stackName,
    stackId,
    stackStatus: "UPDATE_COMPLETE",
    cellExpiresAt: new Date(now - 60_000).toISOString(),
    templateCanonicalSha256: "a".repeat(64),
    resourceInventorySha256: "b".repeat(64),
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 3,
    provisionEpoch: 8,
    provisionMarker: "tl_cell_epoch_cell-sandbox-1_g3_e8",
    revision,
    state: "provision_verified",
    ...overrides,
  };
  const derivedOperationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(seed),
  );
  const unsigned: Omit<SharedCellProvisionAuthorityRecord, "recordHash"> = {
    ...seed,
    provisionOperationHash:
      overrides.provisionOperationHash ?? derivedOperationHash,
  };
  const record: SharedCellProvisionAuthorityRecord = {
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  };
  return Object.freeze({
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 1,
    revision: unsigned.revision,
    record_json: canonicalJson(record),
  });
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) =>
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === code;
}

test("compiler emits the exact J4c four-field item and twenty-two-field record", async () => {
  const item = await compileSharedCellCleanupAuthorityCandidateItem(compileInput());
  const record = JSON.parse(item.record_json) as Record<string, unknown>;

  assert.equal(Object.isFrozen(item), true);
  assert.deepEqual(Object.keys(item).sort(), [
    "authority_key",
    "record_json",
    "revision",
    "schema_version",
  ]);
  assert.equal(Object.keys(record).length, 22);
  assert.equal(item.authority_key, "cell:cell-sandbox-1");
  assert.equal(item.schema_version, 1);
  assert.equal(item.revision, 7);
  assert.equal(record.provisionMarker, "tl_cell_epoch_cell-sandbox-1_g3_e8");
  assert.equal(record.cleanupMarker, "tl_cell_epoch_cell-sandbox-1_g3_e9");
  assert.match(String(record.cleanupOperationHash), /^[a-f0-9]{64}$/);
  assert.notEqual(record.cleanupOperationHash, record.provisionOperationHash);
  assert.equal(record.state, "cleanup_authorized");
  assert.equal(canonicalJson(record), item.record_json);

  const decoded = decodeAuthorityItem({
    authority_key: { S: item.authority_key },
    schema_version: { N: String(item.schema_version) },
    revision: { N: String(item.revision) },
    record_json: { S: item.record_json },
  });
  assert.deepEqual(decoded, item);
  const consumed = validateAuthorityItem(item, now);
  assert.equal(consumed.recordHash, record.recordHash);
  assert.equal(consumed.stackId, stackId);
});

test("generic validator accepts only the exact eighteen-field provision record", async () => {
  const item = await provisionItem();
  const validated = await validateSharedCellAuthorityItem(item);
  assert.equal(Object.keys(validated.record).length, 18);
  assert.equal(validated.record.state, "provision_verified");
  assert.equal(validated.record.revision, item.revision);
  await assert.rejects(
    validateSharedCellCleanupAuthorityItem(item),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_STATE_INVALID"),
  );
  assert.throws(() => validateAuthorityItem(item, now));

  const record = JSON.parse(item.record_json) as Record<string, unknown>;
  for (const invalid of [
    { ...item, record_json: canonicalJson({ ...record, unexpected: true }) },
    { ...item, record_json: canonicalJson({ ...record, state: "provisioned" }) },
    { ...item, record_json: canonicalJson({ ...record, recordHash: "f".repeat(64) }) },
  ]) {
    await assert.rejects(
      validateSharedCellAuthorityItem(invalid),
      (error: unknown) =>
        String((error as { code?: string }).code).startsWith(
          "SHARED_CELL_CLEANUP_AUTHORITY_",
        ),
    );
  }
});

test("transition accepts provision to cleanup and rejects any lineage drift", async () => {
  const expected = await provisionItem();
  const next = await compileSharedCellCleanupAuthorityCandidateItem(compileInput());
  const transition = await validateSharedCellCleanupAuthorityTransition({
    expected,
    next,
  });
  assert.equal(transition.kind, "advance");
  assert.equal(transition.expected.record.state, "provision_verified");
  assert.equal(transition.next.record.state, "cleanup_authorized");

  for (const drift of [
    { ownerDeploymentId: "foreign_owner" },
    { resourceInventorySha256: "e".repeat(64) },
    { stackId: stackId.replace("12345678", "22345678") },
  ]) {
    await assert.rejects(
      validateSharedCellCleanupAuthorityTransition({
        expected: await provisionItem(6, drift),
        next,
      }),
      errorCode("SHARED_CELL_CLEANUP_AUTHORITY_TRANSITION_INVALID"),
    );
  }
  await assert.rejects(
    validateSharedCellCleanupAuthorityTransition({
      expected: await provisionItem(6, {
        provisionOperationHash: "e".repeat(64),
      }),
      next,
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_OPERATION_HASH_MISMATCH"),
  );
});

test("cleanup operation hash is deterministic and bound to the exact intent", async () => {
  const base = compileInput();
  const first = JSON.parse(
    (await compileSharedCellCleanupAuthorityCandidateItem(base)).record_json,
  ) as Record<string, unknown>;
  const newRevision = JSON.parse(
    (
      await compileSharedCellCleanupAuthorityCandidateItem({
        ...base,
        revision: base.revision + 1,
      })
    ).record_json,
  ) as Record<string, unknown>;
  const changedExpiry = JSON.parse(
    (
      await compileSharedCellCleanupAuthorityCandidateItem({
        ...base,
        cleanup: {
          ...base.cleanup,
          expiresAt: new Date(now + 16 * 60_000).toISOString(),
        },
      })
    ).record_json,
  ) as Record<string, unknown>;
  const changedEvidence = JSON.parse(
    (
      await compileSharedCellCleanupAuthorityCandidateItem({
        ...base,
        cell: {
          ...base.cell,
          resourceInventorySha256: "e".repeat(64),
        },
      })
    ).record_json,
  ) as Record<string, unknown>;

  assert.equal(first.cleanupOperationHash, newRevision.cleanupOperationHash);
  assert.notEqual(first.cleanupOperationHash, changedExpiry.cleanupOperationHash);
  assert.notEqual(first.cleanupOperationHash, changedEvidence.cleanupOperationHash);
});

test("compiler rejects unexpected input, foreign Stack evidence, invalid digests and cleanup before provision", async () => {
  const base = compileInput();
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({ ...base, unexpected: true } as never),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_INVALID"),
  );
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({
      ...base,
      cell: { ...base.cell, stackId: stackId.replace("402010193138", "000000000000") },
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_INVALID"),
  );
  for (const field of [
    "templateCanonicalSha256",
    "resourceInventorySha256",
  ] as const) {
    await assert.rejects(
      compileSharedCellCleanupAuthorityCandidateItem({
        ...base,
        cell: { ...base.cell, [field]: "not-a-digest" },
      }),
      errorCode("SHARED_CELL_CLEANUP_AUTHORITY_INVALID"),
    );
  }
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({
      ...base,
      cleanup: { ...base.cleanup, epoch: base.provision.epoch },
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_INVALID"),
  );
});

test("compiler rejects an unexpired Cell and an expired or overlong authorization", async () => {
  const base = compileInput();
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({
      ...base,
      cell: { ...base.cell, cellExpiresAt: new Date(now + 1).toISOString() },
    }),
    errorCode("SHARED_CELL_CLEANUP_CELL_NOT_EXPIRED"),
  );
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({
      ...base,
      cleanup: { ...base.cleanup, expiresAt: new Date(now).toISOString() },
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED"),
  );
  await assert.rejects(
    compileSharedCellCleanupAuthorityCandidateItem({
      ...base,
      cleanup: {
        ...base.cleanup,
        expiresAt: new Date(now + 60 * 60_000 + 1).toISOString(),
      },
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED"),
  );
});

test("an empty authority cannot bootstrap cleanup", async () => {
  let casCalls = 0;
  const port: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      return snapshot();
    },
    async compareAndSet() {
      casCalls += 1;
      throw new Error("unreachable");
    },
  };
  const base = compileInput();
  await assert.rejects(
    advanceSharedCellCleanupAuthority({
      port,
      cell: base.cell,
      provision: base.provision,
      cleanup: base.cleanup,
      signal: new AbortController().signal,
      now: () => now,
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_BOOTSTRAP_MISSING"),
  );
  assert.equal(casCalls, 0);
});

test("an existing lineage advances through conditional CAS and exact re-observe", async () => {
  const base = compileInput();
  const predecessor = await provisionItem();
  let stored = snapshot(predecessor.revision, predecessor);
  const calls: string[] = [];
  const port: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      calls.push("observe");
      return stored;
    },
    async compareAndSet(input) {
      calls.push("compareAndSet");
      assert.deepEqual(input.expected, snapshot(predecessor.revision, predecessor));
      assert.equal(input.next.revision, predecessor.revision + 1);
      stored = snapshot(input.next.revision, input.next);
      return { applied: true, snapshot: stored };
    },
  };
  const item = await advanceSharedCellCleanupAuthority({
    port,
    cell: base.cell,
    provision: base.provision,
    cleanup: {
      epoch: base.cleanup.epoch + 1,
      expiresAt: new Date(now + 20 * 60_000).toISOString(),
    },
    signal: new AbortController().signal,
    now: () => now,
  });

  assert.deepEqual(calls, ["observe", "compareAndSet", "observe"]);
  assert.equal(item.revision, predecessor.revision + 1);
  assert.equal(validateAuthorityItem(item, now).cleanupEpoch, 10);
});

test("an exact retry returns the predecessor without another write", async () => {
  const base = compileInput();
  const predecessor = await compileSharedCellCleanupAuthorityCandidateItem(base);
  let casCalls = 0;
  const port: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      return snapshot(predecessor.revision, predecessor);
    },
    async compareAndSet() {
      casCalls += 1;
      throw new Error("unreachable");
    },
  };
  const replay = await advanceSharedCellCleanupAuthority({
    port,
    cell: base.cell,
    provision: base.provision,
    cleanup: base.cleanup,
    signal: new AbortController().signal,
    now: () => now,
  });

  assert.deepEqual(replay, predecessor);
  assert.equal(casCalls, 0);
});

test("lineage drift and cleanup epoch regression fail before CAS", async () => {
  const base = compileInput();
  const predecessor = await compileSharedCellCleanupAuthorityCandidateItem(base);
  const cases = [
    { provision: { ...base.provision, ownerDeploymentId: "foreign_owner" } },
    { provision: { ...base.provision, generation: base.provision.generation + 1 } },
    { provision: { ...base.provision, epoch: base.provision.epoch + 1 } },
    { provision: { ...base.provision, operationHash: "e".repeat(64) } },
    { cell: { ...base.cell, stackId: base.cell.stackId.replace("12345678", "22345678") } },
    { cell: { ...base.cell, resourceInventorySha256: "e".repeat(64) } },
    {
      cleanup: {
        epoch: base.cleanup.epoch,
        expiresAt: new Date(now + 16 * 60_000).toISOString(),
      },
    },
  ];
  for (const drift of cases) {
    let casCalls = 0;
    const port: AtomicSharedCellCleanupAuthorityPort = {
      async observe() {
        return snapshot(predecessor.revision, predecessor);
      },
      async compareAndSet() {
        casCalls += 1;
        throw new Error("unreachable");
      },
    };
    await assert.rejects(
      advanceSharedCellCleanupAuthority({
        port,
        cell: drift.cell ?? base.cell,
        provision: drift.provision ?? base.provision,
        cleanup: drift.cleanup ?? {
          epoch: base.cleanup.epoch + 1,
          expiresAt: new Date(now + 20 * 60_000).toISOString(),
        },
        signal: new AbortController().signal,
        now: () => now,
      }),
      errorCode("SHARED_CELL_CLEANUP_AUTHORITY_TRANSITION_INVALID"),
    );
    assert.equal(casCalls, 0);
  }
});

test("CAS conflicts and independent readback drift never report success", async () => {
  const base = compileInput();
  const predecessor = await compileSharedCellCleanupAuthorityCandidateItem(base);
  const cleanup = {
    epoch: base.cleanup.epoch + 1,
    expiresAt: new Date(now + 20 * 60_000).toISOString(),
  };
  let mode: "conflict" | "drift" = "conflict";
  let observations = 0;
  const port: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      observations += 1;
      if (observations === 1) return snapshot(predecessor.revision, predecessor);
      return snapshot(predecessor.revision, predecessor);
    },
    async compareAndSet(input) {
      if (mode === "conflict") {
        return { applied: false, snapshot: snapshot(predecessor.revision, predecessor) };
      }
      return { applied: true, snapshot: snapshot(input.next.revision, input.next) };
    },
  };
  await assert.rejects(
    advanceSharedCellCleanupAuthority({
      port,
      cell: base.cell,
      provision: base.provision,
      cleanup,
      signal: new AbortController().signal,
      now: () => now,
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_CAS_CONFLICT"),
  );
  mode = "drift";
  observations = 0;
  await assert.rejects(
    advanceSharedCellCleanupAuthority({
      port,
      cell: base.cell,
      provision: base.provision,
      cleanup,
      signal: new AbortController().signal,
      now: () => now,
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_READBACK_MISMATCH"),
  );
});

test("invalid predecessor encodings fail before CAS", async () => {
  const valid = await compileSharedCellCleanupAuthorityCandidateItem(compileInput());
  const record = JSON.parse(valid.record_json) as Record<string, unknown>;
  const { recordHash, ...withoutHash } = record;
  const invalidItems: SharedCellCleanupAuthorityItem[] = [
    { ...valid, record_json: canonicalJson({ ...record, recordHash: "f".repeat(64) }) },
    { ...valid, revision: valid.revision + 1 },
    { ...valid, record_json: JSON.stringify({ recordHash, ...withoutHash }) },
  ];
  for (const invalid of invalidItems) {
    let casCalls = 0;
    const port: AtomicSharedCellCleanupAuthorityPort = {
      async observe() {
        return snapshot(invalid.revision, invalid);
      },
      async compareAndSet() {
        casCalls += 1;
        throw new Error("unreachable");
      },
    };
    const base = compileInput();
    await assert.rejects(
      advanceSharedCellCleanupAuthority({
        port,
        cell: base.cell,
        provision: base.provision,
        cleanup: {
          epoch: base.cleanup.epoch + 1,
          expiresAt: new Date(now + 20 * 60_000).toISOString(),
        },
        signal: new AbortController().signal,
        now: () => now,
      }),
    );
    assert.equal(casCalls, 0);
  }
});

test("expiry and clock regression are rechecked around CAS", async () => {
  const base = compileInput();
  const predecessor = await compileSharedCellCleanupAuthorityCandidateItem(base);
  const cleanup = {
    epoch: base.cleanup.epoch + 1,
    expiresAt: new Date(now + 10).toISOString(),
  };
  for (const scenario of [
    { times: [now, now + 11], code: "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED", cas: 0 },
    { times: [now, now + 5, now + 11], code: "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED_AFTER_WRITE", cas: 1 },
    { times: [now, now - 1], code: "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED", cas: 0 },
  ]) {
    let clockIndex = 0;
    let casCalls = 0;
    let stored = snapshot(predecessor.revision, predecessor);
    const port: AtomicSharedCellCleanupAuthorityPort = {
      async observe() {
        return stored;
      },
      async compareAndSet(input) {
        casCalls += 1;
        stored = snapshot(input.next.revision, input.next);
        return { applied: true, snapshot: stored };
      },
    };
    await assert.rejects(
      advanceSharedCellCleanupAuthority({
        port,
        cell: base.cell,
        provision: base.provision,
        cleanup,
        signal: new AbortController().signal,
        now: () => scenario.times[clockIndex++] ?? scenario.times.at(-1)!,
      }),
      errorCode(scenario.code),
    );
    assert.equal(casCalls, scenario.cas);
  }
});

test("aborted and disabled authority paths make no provider progress", async () => {
  const reason = new Error("lease lost");
  const controller = new AbortController();
  controller.abort(reason);
  let observeCalls = 0;
  const port: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      observeCalls += 1;
      return snapshot();
    },
    async compareAndSet() {
      throw new Error("unreachable");
    },
  };
  const base = compileInput();
  await assert.rejects(
    advanceSharedCellCleanupAuthority({
      port,
      cell: base.cell,
      provision: base.provision,
      cleanup: base.cleanup,
      signal: controller.signal,
      now: () => now,
    }),
    (error) => error === reason,
  );
  assert.equal(observeCalls, 0);

  const disabled = new DisabledAtomicSharedCellCleanupAuthority();
  await assert.rejects(
    disabled.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: new AbortController().signal,
    }),
    errorCode("SHARED_CELL_CLEANUP_AUTHORITY_WRITER_DISABLED"),
  );
});

test("tenant DynamoDB authority continues to reject the cell authority schema", async () => {
  let sends = 0;
  class Command {
    readonly input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  const authority = new AwsSdkDynamoDbEpochAuthority(
    {
      tableArn:
        "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority",
    },
    {
      client: {
        async send() {
          sends += 1;
          return {};
        },
      },
      commands: { get: Command, put: Command },
    },
  );
  await assert.rejects(
    authority.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: new AbortController().signal,
    }),
    errorCode("TENANT_EXTERNAL_EPOCH_AUTHORITY_KEY_INVALID"),
  );
  assert.equal(sends, 0);
});
