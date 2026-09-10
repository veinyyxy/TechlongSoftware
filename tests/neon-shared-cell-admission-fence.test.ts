import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellProvisionAuthorityRecord,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import {
  createNeonSharedCellAdmissionFenceWriter,
  NeonSharedCellAdmissionFenceWriter,
  type NeonSharedCellAdmissionFenceSqlClient,
} from "../lib/deployments/execution/neon-shared-cell-admission-fence.ts";
import { SharedCellAdmissionFenceError } from "../lib/deployments/execution/shared-cell-admission-fence.ts";

const now = Date.parse("2026-09-08T12:00:00.000Z");
const expiresAt = new Date(now - 60_000).toISOString();
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  "techlong-sandbox-cell-sandbox-1/" +
  "12345678-1234-1234-1234-123456789012";

async function predecessor(): Promise<SharedCellProvisionAuthorityRecord> {
  const operation = {
    schemaVersion: 2 as const,
    accountId: "402010193138" as const,
    region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId,
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt: expiresAt,
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
    templateCanonicalSha256: "a".repeat(64),
    resourceInventorySha256: "b".repeat(64),
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const provisionOperationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(operation),
  );
  const unsigned = {
    ...operation,
    provisionOperationHash,
    revision: 1,
    state: "provision_verified" as const,
  };
  return { ...unsigned, recordHash: await sha256Hex(unsigned) };
}

function client(mode: "success" | "empty" | "failure" = "success") {
  const calls: Array<{
    statement: string;
    values: unknown[];
    options: unknown;
  }> = [];
  const sql: NeonSharedCellAdmissionFenceSqlClient = {
    async query(statement, values, options) {
      calls.push({ statement, values, options });
      if (mode === "failure") {
        throw Object.assign(new Error("postgres://secret@host/db"), {
          name: "Serialization Failure!",
        });
      }
      if (mode === "empty") return { rows: [] };
      return {
        rows: [
          {
            environment_id: values[0],
            account_id: values[1],
            region: values[2],
            cell_key: values[3],
            admission_state: "draining",
            admission_epoch: 1,
            admission_fence_sha256: values[7],
            admission_provision_operation_hash: values[6],
            admission_stack_id: values[4],
            admission_cell_expires_at: values[5],
            admission_changed_at: now,
            db_observed_at: now,
            database_cell_expired: true,
          },
        ],
      };
    },
  };
  return { sql, calls };
}

test("atomically begins one DB-clock-gated admission drain and returns its fence", async () => {
  const fake = client();
  const writer = new NeonSharedCellAdmissionFenceWriter(fake.sql);
  assert.equal(fake.calls.length, 0);
  const signal = new AbortController().signal;
  const lineage = await predecessor();
  const result = await writer.beginAdmissionDrain({ predecessor: lineage, signal });
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].statement, /transaction_timestamp\(\)/);
  assert.match(
    fake.calls[0].statement,
    /locked_environment AS MATERIALIZED[\s\S]*?FOR UPDATE OF environment/,
  );
  assert.match(
    fake.calls[0].statement,
    /admission_state = 'open'[\s\S]*?admission_state = 'draining'/,
  );
  assert.match(fake.calls[0].statement, /\$6::bigint <= db_clock\.now_ms/);
  assert.deepEqual(fake.calls[0].options, {
    fullResults: true,
    fetchOptions: { signal },
  });
  assert.equal(fake.calls[0].values[4], stackId);
  assert.equal(fake.calls[0].values[5], Date.parse(expiresAt));
  assert.equal(fake.calls[0].values[6], lineage.provisionOperationHash);
  assert.match(String(fake.calls[0].values[7]), /^[a-f0-9]{64}$/);
  assert.deepEqual(result, {
    schemaVersion: 1,
    admissionState: "draining",
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    environmentId: "env_aws_sandbox_ca_central_1",
    admissionEpoch: 1,
    admissionFenceSha256: fake.calls[0].values[7],
    admissionProvisionOperationHash: lineage.provisionOperationHash,
    admissionStackId: stackId,
    admissionCellExpiresAt: Date.parse(expiresAt),
    admissionChangedAt: now,
    dbObservedAt: now,
    databaseCellExpired: true,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("early, missing or lineage-drifted drains fail closed on an empty DB result", async () => {
  const fake = client("empty");
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(fake.sql).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: new AbortController().signal,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "NEON_SHARED_CELL_ADMISSION_DRAIN_REJECTED",
  );
});

test("tampered provision lineage is rejected before the database write", async () => {
  const fake = client();
  const lineage = await predecessor();
  for (const tampered of [
    {
      ...lineage,
      cellExpiresAt: "2020-01-01T00:00:00.000Z",
    },
    {
      ...lineage,
      cloudFormationRoleArn:
        "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole",
    },
    { ...lineage, schemaVersion: 1 },
  ]) {
    await assert.rejects(
      new NeonSharedCellAdmissionFenceWriter(fake.sql).beginAdmissionDrain({
        predecessor: tampered as unknown as SharedCellProvisionAuthorityRecord,
        signal: new AbortController().signal,
      }),
      (error) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_ADMISSION_PREDECESSOR_INVALID",
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("provider failures are sanitized and pre-abort performs no query", async () => {
  const failing = client("failure");
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(failing.sql).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: new AbortController().signal,
    }),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      return (
        value.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
        value.retryable === true &&
        !String(value.message).includes("secret")
      );
    },
  );
  const conflict: NeonSharedCellAdmissionFenceSqlClient = {
    async query() {
      throw Object.assign(new Error("unsafe provider detail"), {
        name: "NeonDbError",
        code: "40001",
      });
    },
  };
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(conflict).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: new AbortController().signal,
    }),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      return (
        value.code === "40001" &&
        value.retryable === true &&
        !String(value.message).includes("unsafe")
      );
    },
  );
  const aborted = client();
  const controller = new AbortController();
  const reason = new Error("lease lost");
  controller.abort(reason);
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(aborted.sql).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
  assert.equal(aborted.calls.length, 0);
});

test("provider-domain and nested SQLSTATE failures are rewrapped without secrets", async () => {
  const failures = [
    {
      failure: new SharedCellAdmissionFenceError(
        "40001",
        "postgres://secret@host/db",
        true,
      ),
      expectedCode: "40001",
    },
    {
      failure: Object.assign(new Error("outer secret"), {
        cause: Object.assign(new Error("postgres://nested-secret@host/db"), {
          code: "40001",
        }),
      }),
      expectedCode: "40001",
    },
  ];
  for (const { failure, expectedCode } of failures) {
    const sql: NeonSharedCellAdmissionFenceSqlClient = {
      async query() {
        throw failure;
      },
    };
    await assert.rejects(
      new NeonSharedCellAdmissionFenceWriter(sql).beginAdmissionDrain({
        predecessor: await predecessor(),
        signal: new AbortController().signal,
      }),
      (error) => {
        const value = error as {
          code?: string;
          message?: string;
          retryable?: boolean;
        };
        return (
          value.code === expectedCode &&
          value.retryable === true &&
          !String(value.message).includes("secret")
        );
      },
    );
  }

  const uncertainSql: NeonSharedCellAdmissionFenceSqlClient = {
    async query() {
      throw new SharedCellAdmissionFenceError(
        "08006",
        "postgres://uncertain-secret@host/db",
        true,
      );
    },
  };
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(uncertainSql).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: new AbortController().signal,
    }),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        cause?: { message?: string };
      };
      return (
        value.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
        !String(value.message).includes("secret") &&
        !String(value.cause?.message).includes("secret")
      );
    },
  );
});

test("abort after a drain request starts is reported as write-uncertain", async () => {
  const controller = new AbortController();
  const sql: NeonSharedCellAdmissionFenceSqlClient = {
    async query() {
      controller.abort(new Error("caller lease lost"));
      throw new Error("transport canceled");
    },
  };
  await assert.rejects(
    new NeonSharedCellAdmissionFenceWriter(sql).beginAdmissionDrain({
      predecessor: await predecessor(),
      signal: controller.signal,
    }),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      return (
        value.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
        value.retryable === true &&
        !String(value.message).includes("caller lease")
      );
    },
  );
});

test("ambiguous failures after the write starts are always reported as write-uncertain", async () => {
  const failures = [
    Object.assign(new Error("connection lost"), {
      name: "NeonDbError",
      code: "08006",
    }),
    Object.assign(new Error("server shut down"), {
      name: "NeonDbError",
      code: "57P01",
    }),
    Object.assign(new Error("statement completion unknown"), {
      name: "NeonDbError",
      code: "40003",
    }),
    Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("socket detail"), {
        code: "UND_ERR_SOCKET",
      }),
    }),
    Object.assign(new Error("wrapped connection loss"), {
      name: "NeonDbError",
      cause: Object.assign(new Error("connection closed"), {
        code: "08006",
      }),
    }),
    new SyntaxError("Unexpected end of JSON input"),
  ];
  for (const failure of failures) {
    const sql: NeonSharedCellAdmissionFenceSqlClient = {
      async query() {
        throw failure;
      },
    };
    await assert.rejects(
      new NeonSharedCellAdmissionFenceWriter(sql).beginAdmissionDrain({
        predecessor: await predecessor(),
        signal: new AbortController().signal,
      }),
      (error) => {
        const value = error as {
          code?: string;
          message?: string;
          retryable?: boolean;
          cause?: { message?: string };
        };
        return (
          value.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
          value.retryable === true &&
          !String(value.message).includes("socket detail") &&
          !String(value.cause?.message).includes("socket detail")
        );
      },
    );
  }
});

test("provider identifiers cannot carry arbitrary secret material", async () => {
  const failures = [
    Object.assign(new Error("message-secret"), {
      name: "postgres://name-secret@host/db",
      code: "postgres://code-secret@host/db",
    }),
    Object.assign(new Error("five-character secret"), {
      name: "S3CRT",
      code: "S3CRT",
    }),
    Object.defineProperties({}, {
      name: {
        get() {
          throw new Error("getter-name-secret");
        },
      },
      code: {
        get() {
          throw new Error("getter-code-secret");
        },
      },
      cause: {
        get() {
          throw new Error("getter-cause-secret");
        },
      },
    }),
  ];
  for (const failure of failures) {
    const sql: NeonSharedCellAdmissionFenceSqlClient = {
      async query() {
        throw failure;
      },
    };
    await assert.rejects(
      new NeonSharedCellAdmissionFenceWriter(sql).beginAdmissionDrain({
        predecessor: await predecessor(),
        signal: new AbortController().signal,
      }),
      (error) => {
        const value = error as {
          code?: string;
          message?: string;
          stack?: string;
          cause?: { code?: string; message?: string; stack?: string };
        };
        const exposed = [
          value.code,
          value.message,
          value.stack,
          value.cause?.code,
          value.cause?.message,
          value.cause?.stack,
        ].join(" ");
        return (
          value.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
          value.cause?.code === "NEON_SHARED_CELL_ADMISSION_DRAIN_FAILED" &&
          !exposed.includes("message-secret") &&
          !exposed.includes("name-secret") &&
          !exposed.includes("code-secret") &&
          !exposed.includes("S3CRT") &&
          !exposed.includes("getter-")
        );
      },
    );
  }
});

test("factory hides malformed credential-bearing database URLs", () => {
  assert.throws(
    () =>
      createNeonSharedCellAdmissionFenceWriter(
        "postgres://user:database-secret@[invalid",
      ),
    (error) => {
      const value = error as { code?: string; message?: string; stack?: string };
      const exposed = [value.code, value.message, value.stack].join(" ");
      return (
        value.code === "NEON_SHARED_CELL_ADMISSION_DATABASE_URL_INVALID" &&
        !exposed.includes("database-secret")
      );
    },
  );
});

test("malformed post-write receipts are uncertain while an exact empty result is rejected", async () => {
  for (const response of [{}, { rows: [{}] }, { rows: [{}, {}] }]) {
    const sql: NeonSharedCellAdmissionFenceSqlClient = {
      async query() {
        return response;
      },
    };
    await assert.rejects(
      new NeonSharedCellAdmissionFenceWriter(sql).beginAdmissionDrain({
        predecessor: await predecessor(),
        signal: new AbortController().signal,
      }),
      (error) =>
        (error as { code?: string; retryable?: boolean }).code ===
          "NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN" &&
        (error as { retryable?: boolean }).retryable === true,
    );
  }
});

test("the validated predecessor is pinned across the asynchronous write boundary", async () => {
  const lineage = await predecessor();
  const originalOperationHash = lineage.provisionOperationHash;
  const mutable = lineage as { provisionOperationHash: string; stackId: string };
  const sql: NeonSharedCellAdmissionFenceSqlClient = {
    async query(_statement, values) {
      mutable.provisionOperationHash = "f".repeat(64);
      mutable.stackId = stackId.replace("12345678", "87654321");
      return {
        rows: [
          {
            environment_id: values[0],
            account_id: values[1],
            region: values[2],
            cell_key: values[3],
            admission_state: "draining",
            admission_epoch: 1,
            admission_fence_sha256: values[7],
            admission_provision_operation_hash: values[6],
            admission_stack_id: values[4],
            admission_cell_expires_at: values[5],
            admission_changed_at: now,
            db_observed_at: now,
            database_cell_expired: true,
          },
        ],
      };
    },
  };
  const result = await new NeonSharedCellAdmissionFenceWriter(
    sql,
  ).beginAdmissionDrain({
    predecessor: lineage,
    signal: new AbortController().signal,
  });
  assert.equal(result.admissionStackId, stackId);
  assert.equal(result.admissionProvisionOperationHash, originalOperationHash);
});

test("an exact retry reads back the same epoch and changed-at receipt", async () => {
  const fake = client();
  const writer = new NeonSharedCellAdmissionFenceWriter(fake.sql);
  const lineage = await predecessor();
  const input = {
    predecessor: lineage,
    signal: new AbortController().signal,
  };
  const first = await writer.beginAdmissionDrain(input);
  const second = await writer.beginAdmissionDrain(input);
  assert.deepEqual(second, first);
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[1].values, fake.calls[0].values);
});
