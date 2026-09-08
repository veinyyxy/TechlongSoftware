import assert from "node:assert/strict";
import test from "node:test";

import {
  NeonSerializableSharedCellOwnershipSnapshotSource,
  type NeonSerializableSnapshotSqlClient,
} from "../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";

const fixedInput = (signal = new AbortController().signal) => ({
  accountId: "402010193138" as const,
  region: "ca-central-1" as const,
  cellId: "cell-sandbox-1" as const,
  environmentId: "env_aws_sandbox_ca_central_1" as const,
  signal,
});

function result(rows: Record<string, unknown>[]) {
  return { rows };
}

function client(
  response: unknown[] = [
    result([
      {
        environment_id: "env_aws_sandbox_ca_central_1",
        account_id: "402010193138",
        region: "ca-central-1",
        cell_key: "cell-sandbox-1",
        db_observed_at: "1788811200000",
      },
    ]),
    result([]),
    result([]),
    result([]),
    result([]),
    result([]),
  ],
) {
  const calls: Array<{ statement: string; values: unknown[] }> = [];
  let transactionOptions: Record<string, unknown> | undefined;
  let transactions = 0;
  const sql: NeonSerializableSnapshotSqlClient = {
    async transaction(build, options) {
      transactions += 1;
      transactionOptions = options;
      const handles = build({
        query(statement, values = []) {
          calls.push({ statement, values });
          return { queryData: { statement, values } };
        },
      });
      assert.equal(handles.length, 6);
      return response;
    },
  };
  return {
    sql,
    calls,
    state: () => ({ transactions, transactionOptions }),
  };
}

test("reads all ownership sources in one serializable read-only transaction", async () => {
  const fake = client();
  const source = new NeonSerializableSharedCellOwnershipSnapshotSource(fake.sql);
  assert.equal(fake.state().transactions, 0);
  const signal = new AbortController().signal;
  const snapshot = await source.readSerializableReadOnlySnapshot(
    fixedInput(signal),
  );
  assert.equal(fake.state().transactions, 1);
  assert.deepEqual(fake.state().transactionOptions, {
    isolationLevel: "Serializable",
    readOnly: true,
    deferrable: true,
    fullResults: true,
    fetchOptions: { signal },
  });
  assert.equal(fake.calls.length, 6);
  assert.match(fake.calls[0].statement, /transaction_timestamp\(\)/);
  assert.match(fake.calls[1].statement, /instance\.status IN \('pending', 'active'\)/);
  assert.match(fake.calls[2].statement, /deployment_environment_capacity_reservations/);
  assert.match(fake.calls[3].statement, /NOT IN \('rolled_back', 'canceled'\)/);
  assert.match(fake.calls[4].statement, /lifecycle_status <> 'destroyed'/);
  assert.match(fake.calls[5].statement, /NOT IN \('succeeded', 'canceled'\)/);
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    isolationLevel: "Serializable",
    readOnly: true,
    deferrable: true,
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    environmentId: "env_aws_sandbox_ca_central_1",
    dbObservedAt: 1788811200000,
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
  });
  assert.equal(Object.isFrozen(snapshot), true);
});

test("returns complete ordered IDs for fail-closed nonzero evidence", async () => {
  const fake = client([
    result([
      {
        environment_id: "env_aws_sandbox_ca_central_1",
        account_id: "402010193138",
        region: "ca-central-1",
        cell_key: "cell-sandbox-1",
        db_observed_at: 1788811200000,
      },
    ]),
    result([{ id: "instance-a" }]),
    result([{ id: "deployment-a" }]),
    result([{ id: "deployment-a" }]),
    result([{ id: "instance-a" }]),
    result([{ id: "cleanup-a" }]),
  ]);
  const snapshot =
    await new NeonSerializableSharedCellOwnershipSnapshotSource(
      fake.sql,
    ).readSerializableReadOnlySnapshot(fixedInput());
  assert.deepEqual(snapshot.activeTenantIds, ["instance-a"]);
  assert.deepEqual(snapshot.activeCapacityReservationIds, ["deployment-a"]);
  assert.deepEqual(snapshot.nonterminalDeploymentIds, ["deployment-a"]);
  assert.deepEqual(snapshot.liveTenantResourceIds, ["instance-a"]);
  assert.deepEqual(snapshot.nonterminalTenantCleanupScheduleIds, ["cleanup-a"]);
});

test("foreign input and malformed environment fail closed", async () => {
  const fake = client([
    result([]),
    result([]),
    result([]),
    result([]),
    result([]),
    result([]),
  ]);
  const source = new NeonSerializableSharedCellOwnershipSnapshotSource(fake.sql);
  await assert.rejects(
    source.readSerializableReadOnlySnapshot({
      ...fixedInput(),
      environmentId: "env_other" as never,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "NEON_SHARED_CELL_SNAPSHOT_INPUT_INVALID",
  );
  assert.equal(fake.state().transactions, 0);
  await assert.rejects(
    source.readSerializableReadOnlySnapshot(fixedInput()),
    (error) =>
      (error as { code?: string }).code ===
      "NEON_SHARED_CELL_ENVIRONMENT_INVALID",
  );
});

test("provider failures are sanitized and abort reason is preserved", async () => {
  const failing: NeonSerializableSnapshotSqlClient = {
    async transaction() {
      throw Object.assign(new Error("postgres://secret@host/db"), {
        name: "Connection Timeout!",
      });
    },
  };
  const source = new NeonSerializableSharedCellOwnershipSnapshotSource(failing);
  await assert.rejects(
    source.readSerializableReadOnlySnapshot(fixedInput()),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      return (
        value.code === "Connection_Timeout_" &&
        value.retryable === true &&
        !String(value.message).includes("secret")
      );
    },
  );
  const controller = new AbortController();
  const reason = new Error("lease lost");
  controller.abort(reason);
  const inert = client();
  await assert.rejects(
    new NeonSerializableSharedCellOwnershipSnapshotSource(
      inert.sql,
    ).readSerializableReadOnlySnapshot(fixedInput(controller.signal)),
    (error) => error === reason,
  );
  assert.equal(inert.state().transactions, 0);
});
