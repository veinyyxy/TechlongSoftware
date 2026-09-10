import assert from "node:assert/strict";
import test from "node:test";

import {
  AwsSdkSharedCellCleanupAuthority,
  SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
  type AwsSdkSharedCellCleanupAuthorityDependencies,
} from "../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";
import {
  compileSharedCellCleanupAuthorityCandidateItem,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  sharedCellProvisionOperationIntent,
  type SharedCellAuthorityItem,
  type SharedCellCleanupAuthorityItem,
  type SharedCellProvisionOperationSource,
  type SharedCellProvisionAuthorityRecord,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";

class GetCommand {
  readonly kind = "get-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}

class PutCommand {
  readonly kind = "put-item";
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) { this.input = input; }
}

const now = Date.parse("2026-08-30T20:00:00.000Z");

function dependencies(
  send: AwsSdkSharedCellCleanupAuthorityDependencies["client"]["send"],
  clock: () => number = () => now,
): AwsSdkSharedCellCleanupAuthorityDependencies {
  return {
    client: { send },
    commands: { get: GetCommand, put: PutCommand },
    now: clock,
  };
}

function authority(
  send: AwsSdkSharedCellCleanupAuthorityDependencies["client"]["send"],
  clock?: () => number,
) {
  return new AwsSdkSharedCellCleanupAuthority(
    { tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN },
    dependencies(send, clock),
  );
}

async function item(revision: number, cleanupEpoch: number) {
  const cell = {
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555",
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt: "2026-08-30T19:00:00.000Z",
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
    templateCanonicalSha256: "a".repeat(64),
    resourceInventorySha256: "b".repeat(64),
  };
  const provision = {
    ownerDeploymentId: "deployment-one",
    generation: 1,
    epoch: 1,
    operationHash: await sha256Hex(
      sharedCellProvisionOperationIntent({
        schemaVersion: 2,
        accountId: "402010193138",
        region: "ca-central-1",
        cellId: "cell-sandbox-1",
        ...cell,
        generation: 1,
        provisionEpoch: 1,
        provisionMarker: "tl_cell_epoch_cell-sandbox-1_g1_e1",
        ownerDeploymentId: "deployment-one",
      }),
    ),
  };
  return compileSharedCellCleanupAuthorityCandidateItem({
    cell,
    provision,
    cleanup: {
      epoch: cleanupEpoch,
      expiresAt: "2026-08-30T20:30:00.000Z",
    },
    revision,
    now,
  });
}

async function provisionItem(
  revision = 1,
): Promise<Readonly<SharedCellAuthorityItem>> {
  const source: SharedCellProvisionOperationSource = {
    schemaVersion: 2,
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    stackName: "techlong-sandbox-cell-sandbox-1",
    stackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555",
    stackStatus: "CREATE_COMPLETE",
    cellExpiresAt: "2026-08-30T19:00:00.000Z",
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
    templateCanonicalSha256: "a".repeat(64),
    resourceInventorySha256: "b".repeat(64),
    ownerDeploymentId: "deployment-one",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: "tl_cell_epoch_cell-sandbox-1_g1_e1",
  };
  const unsigned: Omit<SharedCellProvisionAuthorityRecord, "recordHash"> = {
    ...source,
    provisionOperationHash: await sha256Hex(
      sharedCellProvisionOperationIntent(source),
    ),
    revision,
    state: "provision_verified",
  };
  const record: SharedCellProvisionAuthorityRecord = {
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  };
  return Object.freeze({
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 2,
    revision,
    record_json: canonicalJson(record),
  });
}

test("requires the exact sandbox authority table ARN", () => {
  let sends = 0;
  assert.throws(
    () =>
      new AwsSdkSharedCellCleanupAuthority(
        {
          tableArn:
            "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-other",
        },
        dependencies(async () => {
          sends += 1;
          return {};
        }),
      ),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_AUTHORITY_CONFIG_INVALID",
  );
  assert.equal(sends, 0);
});

test("observe accepts a provision predecessor through one full strongly consistent Get", async () => {
  const stored = await provisionItem();
  const controller = new AbortController();
  let input: Record<string, unknown> | undefined;
  const adapter = authority(async (command, options) => {
    assert.equal(options?.abortSignal, controller.signal);
    assert.equal((command as GetCommand).kind, "get-item");
    input = (command as GetCommand).input;
    return { Item: stored };
  });
  const snapshot = await adapter.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal: controller.signal,
  });
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(input, {
    TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
    Key: { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY },
    ConsistentRead: true,
  });
});

test("observe represents an absent key and rejects every foreign key before send", async () => {
  let sends = 0;
  const adapter = authority(async () => {
    sends += 1;
    return {};
  });
  assert.deepEqual(
    await adapter.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: new AbortController().signal,
    }),
    {
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      revision: 0,
      item: null,
    },
  );
  await assert.rejects(
    adapter.observe({
      authorityKey: "cell:cell-sandbox-2" as never,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_AUTHORITY_KEY_INVALID",
  );
  assert.equal(sends, 1);
});

test("observe cannot return a snapshot when abort arrives during item validation", async () => {
  const stored = await item(1, 2);
  const reason = new Error("lease lost during validation");
  const controller = new AbortController();
  const adapter = authority(async () => {
    const response: Record<string, unknown> = {};
    Object.defineProperty(response, "Item", {
      enumerable: true,
      get() {
        controller.abort(reason);
        return stored;
      },
    });
    return response;
  });
  await assert.rejects(
    adapter.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: controller.signal,
    }),
    (error: unknown) => error === reason,
  );
});

test("observe rejects malformed, foreign and non-canonical stored items", async () => {
  const valid = await item(1, 2);
  const invalidItems = [
    { ...valid, unexpected: true },
    { ...valid, authority_key: "tenant:" + "a".repeat(64) },
    { ...valid, schema_version: 1 },
    { ...valid, revision: 2 },
    { ...valid, record_json: "{" },
    { ...valid, record_json: `${valid.record_json} ` },
  ];
  for (const invalid of invalidItems) {
    const adapter = authority(async () => ({ Item: invalid }));
    await assert.rejects(
      adapter.observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        String((error as { code?: string }).code).startsWith(
          "SHARED_CELL_CLEANUP_AUTHORITY_",
        ),
    );
  }
});

test("CAS writes provision to cleanup under the complete canonical predecessor condition", async () => {
  const previous = await provisionItem();
  const next = await item(2, 3);
  let stored: SharedCellAuthorityItem = previous;
  let put: Record<string, unknown> | undefined;
  const adapter = authority(async (command) => {
    if ((command as GetCommand).kind === "get-item") return { Item: stored };
    put = (command as PutCommand).input;
    stored = put.Item as SharedCellAuthorityItem;
    return {};
  });
  const result = await adapter.compareAndSet({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
    next,
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(Object.keys(put?.Item as object).sort(), [
    "authority_key", "record_json", "revision", "schema_version",
  ]);
  assert.equal(put?.TableName, SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN);
  assert.equal(
    put?.ConditionExpression,
    "#schemaVersion = :expectedSchemaVersion AND #revision = :expectedRevision AND #recordJson = :expectedRecordJson",
  );
  assert.deepEqual(put?.ExpressionAttributeNames, {
    "#schemaVersion": "schema_version",
    "#revision": "revision",
    "#recordJson": "record_json",
  });
  assert.deepEqual(put?.ExpressionAttributeValues, {
    ":expectedSchemaVersion": 2,
    ":expectedRevision": 1,
    ":expectedRecordJson": previous.record_json,
  });
  assert.equal(put?.ReturnValues, "NONE");
  assert.equal(put?.ReturnValuesOnConditionCheckFailure, "NONE");
});

test("CAS cannot bootstrap an empty authority and performs no SDK call", async () => {
  let sends = 0;
  const adapter = authority(async () => {
    sends += 1;
    return {};
  });
  await assert.rejects(
    adapter.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 0, item: null },
      next: await item(1, 2),
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_AUTHORITY_BOOTSTRAP_MISSING",
  );
  assert.equal(sends, 0);
});

test("an exact replay performs only a consistent read and no Put", async () => {
  const stored = await item(1, 2);
  let gets = 0;
  let puts = 0;
  const adapter = authority(async (command) => {
    if ((command as GetCommand).kind === "get-item") {
      gets += 1;
      return { Item: stored };
    }
    puts += 1;
    return {};
  });
  const result = await adapter.compareAndSet({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: stored },
    next: stored,
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, true);
  assert.equal(gets, 1);
  assert.equal(puts, 0);
});

test("an exact replay rejects a regressed clock without a Put", async () => {
  const stored = await item(1, 2);
  let puts = 0;
  const clockValues = [now, now - 1];
  const adapter = authority(
    async (command) => {
      if ((command as PutCommand).kind === "put-item") puts += 1;
      return { Item: stored };
    },
    () => clockValues.shift() as number,
  );
  await assert.rejects(
    adapter.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: stored },
      next: stored,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_REGRESSED",
  );
  assert.equal(puts, 0);
});

test("a conditional conflict returns a fresh consistent winner snapshot", async () => {
  const previous = await item(1, 2);
  const candidate = await item(2, 3);
  const winner = await item(2, 4);
  let gets = 0;
  const adapter = authority(async (command) => {
    if ((command as PutCommand).kind === "put-item") {
      throw Object.assign(new Error("conflict"), {
        name: "ConditionalCheckFailedException",
      });
    }
    gets += 1;
    return { Item: winner };
  });
  const result = await adapter.compareAndSet({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
    next: candidate,
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.snapshot.item, winner);
  assert.equal(gets, 1);
});

test("abort, provider failure and post-write readback drift all fail closed", async (t) => {
  await t.test("pre-abort makes no provider progress", async () => {
    let sends = 0;
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(
      authority(async () => { sends += 1; return {}; }).observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal: controller.signal,
      }),
      /stop/,
    );
    assert.equal(sends, 0);
  });

  await t.test("provider errors are sanitized and retain retryability", async () => {
    await assert.rejects(
      authority(async () => {
        throw Object.assign(new Error("secret payload"), {
          name: "Throttling Exception!",
          $metadata: { httpStatusCode: 429 },
        });
      }).observe({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        signal: new AbortController().signal,
      }),
      (error: unknown) => {
        const value = error as { code?: string; retryable?: boolean; message?: string };
        return value.code === "Throttling_Exception_" && value.retryable === true &&
          !String(value.message).includes("secret payload");
      },
    );
  });

  await t.test("a successful Put with missing readback is never success", async () => {
    const previous = await item(1, 2);
    const next = await item(2, 3);
    const adapter = authority(async (command) =>
      (command as PutCommand).kind === "put-item" ? {} : {},
    );
    await assert.rejects(
      adapter.compareAndSet({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
        next,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_CLEANUP_AUTHORITY_READBACK_MISMATCH" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });

  await t.test("a successful Put with a failed readback remains retryable and sanitized", async () => {
    const previous = await item(1, 2);
    const next = await item(2, 3);
    const adapter = authority(async (command) => {
      if ((command as PutCommand).kind === "put-item") return {};
      throw Object.assign(new Error("secret provider payload"), {
        name: "InternalServerError",
        $metadata: { httpStatusCode: 500 },
      });
    });
    await assert.rejects(
      adapter.compareAndSet({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
        next,
        signal: new AbortController().signal,
      }),
      (error: unknown) => {
        const value = error as {
          code?: string;
          retryable?: boolean;
          message?: string;
        };
        return (
          value.code ===
            "SHARED_CELL_CLEANUP_AUTHORITY_READBACK_FAILED_AFTER_WRITE" &&
          value.retryable === true &&
          !String(value.message).includes("secret provider payload")
        );
      },
    );
  });

  await t.test("an abort after Put starts is an explicit retryable uncertain write", async () => {
    const previous = await item(1, 2);
    const next = await item(2, 3);
    const controller = new AbortController();
    let puts = 0;
    const adapter = authority(async (command) => {
      if ((command as PutCommand).kind === "put-item") {
        puts += 1;
        controller.abort(new Error("lease lost"));
      }
      return {};
    });
    await assert.rejects(
      adapter.compareAndSet({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
        next,
        signal: controller.signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean; cause?: unknown }).code ===
          "SHARED_CELL_CLEANUP_AUTHORITY_ABORTED_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true &&
        (error as { cause?: unknown }).cause === controller.signal.reason,
    );
    assert.equal(puts, 1);
  });

  await t.test("an invalid clock after exact readback is retryable", async () => {
    const previous = await item(1, 2);
    const next = await item(2, 3);
    let stored: SharedCellCleanupAuthorityItem = previous;
    const clockValues = [now, Number.NaN];
    const adapter = authority(
      async (command) => {
        if ((command as PutCommand).kind === "put-item") {
          stored = (command as PutCommand).input.Item as SharedCellCleanupAuthorityItem;
          return {};
        }
        return { Item: stored };
      },
      () => clockValues.shift() as number,
    );
    await assert.rejects(
      adapter.compareAndSet({
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        expected: { authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY, revision: 1, item: previous },
        next,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "SHARED_CELL_CLEANUP_AUTHORITY_CLOCK_INVALID_AFTER_WRITE" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  });
});
