import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SerializableSharedCellCleanupDeletionZeroTenantAdapter } from "../lib/deployments/execution/shared-cell-cleanup-deletion-zero-tenant.ts";
import type { SerializableSharedCellOwnershipSnapshotSource } from "../lib/deployments/execution/shared-cell-zero-tenant-evidence.ts";

const now = Date.parse("2026-09-07T20:00:00.000Z");

function source(
  lists: Partial<{
    activeTenantIds: string[];
    activeCapacityReservationIds: string[];
    nonterminalDeploymentIds: string[];
    liveTenantResourceIds: string[];
    nonterminalTenantCleanupScheduleIds: string[];
  }> = {},
) {
  let reads = 0;
  let received: unknown;
  const value: SerializableSharedCellOwnershipSnapshotSource = {
    async readSerializableReadOnlySnapshot(input) {
      reads += 1;
      received = input;
      return {
        schemaVersion: 1,
        isolationLevel: "Serializable",
        readOnly: true,
        deferrable: true,
        accountId: "402010193138",
        region: "ca-central-1",
        cellId: "cell-sandbox-1",
        environmentId: "env_aws_sandbox_ca_central_1",
        dbObservedAt: now,
        activeTenantIds: lists.activeTenantIds ?? [],
        activeCapacityReservationIds:
          lists.activeCapacityReservationIds ?? [],
        nonterminalDeploymentIds: lists.nonterminalDeploymentIds ?? [],
        liveTenantResourceIds: lists.liveTenantResourceIds ?? [],
        nonterminalTenantCleanupScheduleIds:
          lists.nonterminalTenantCleanupScheduleIds ?? [],
      };
    },
  };
  return { value, state: () => ({ reads, received }) };
}

test("projects one serializable snapshot into exact deletion evidence", async () => {
  const trusted = source();
  const signal = new AbortController().signal;
  const adapter = new SerializableSharedCellCleanupDeletionZeroTenantAdapter(
    trusted.value,
    { now: () => now },
  );
  const result = (await adapter.readStrongZeroTenantOwnershipSnapshot({
    signal,
  })) as Record<string, unknown>;
  const expectedSource = {
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
  };
  assert.deepEqual(result, {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    cellId: "cell-sandbox-1",
    environmentId: "env_aws_sandbox_ca_central_1",
    observedAt: now,
    activeTenantCount: 0,
    activeCapacityReservationCount: 0,
    nonterminalDeploymentCount: 0,
    liveTenantResourceCount: 0,
    nonterminalTenantCleanupScheduleCount: 0,
    sourceSnapshot: expectedSource,
    sourceSnapshotSha256: await sha256Hex(expectedSource),
  });
  assert.deepEqual(trusted.state(), {
    reads: 1,
    received: {
      accountId: "402010193138",
      region: "ca-central-1",
      cellId: "cell-sandbox-1",
      environmentId: "env_aws_sandbox_ca_central_1",
      signal,
    },
  });
});

test("preserves every nonzero source ID and derives matching counts", async () => {
  const trusted = source({
    activeTenantIds: ["instance-a"],
    activeCapacityReservationIds: ["deployment-a"],
    nonterminalDeploymentIds: ["deployment-a"],
    liveTenantResourceIds: ["instance-a"],
    nonterminalTenantCleanupScheduleIds: ["cleanup-a"],
  });
  const result = (await new SerializableSharedCellCleanupDeletionZeroTenantAdapter(
    trusted.value,
    { now: () => now },
  ).readStrongZeroTenantOwnershipSnapshot({
    signal: new AbortController().signal,
  })) as Record<string, unknown>;
  assert.equal(result.activeTenantCount, 1);
  assert.equal(result.activeCapacityReservationCount, 1);
  assert.equal(result.nonterminalDeploymentCount, 1);
  assert.equal(result.liveTenantResourceCount, 1);
  assert.equal(result.nonterminalTenantCleanupScheduleCount, 1);
});

test("foreign or non-serializable snapshots are rejected", async () => {
  const malformed: SerializableSharedCellOwnershipSnapshotSource = {
    async readSerializableReadOnlySnapshot() {
      return {
        schemaVersion: 1,
        isolationLevel: "ReadCommitted" as never,
        readOnly: true,
        deferrable: true,
        accountId: "402010193138",
        region: "ca-central-1",
        cellId: "cell-sandbox-1",
        environmentId: "env_aws_sandbox_ca_central_1",
        dbObservedAt: now,
        activeTenantIds: [],
        activeCapacityReservationIds: [],
        nonterminalDeploymentIds: [],
        liveTenantResourceIds: [],
        nonterminalTenantCleanupScheduleIds: [],
      };
    },
  };
  await assert.rejects(
    new SerializableSharedCellCleanupDeletionZeroTenantAdapter(malformed, {
      now: () => now,
    }).readStrongZeroTenantOwnershipSnapshot({
      signal: new AbortController().signal,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_ZERO_TENANT_SNAPSHOT_INVALID",
  );
});

test("source failures are sanitized and pre-abort makes no source call", async () => {
  let reads = 0;
  const failing: SerializableSharedCellOwnershipSnapshotSource = {
    async readSerializableReadOnlySnapshot() {
      reads += 1;
      throw Object.assign(new Error("postgres://secret@host/db"), {
        name: "Serialization Failure!",
      });
    },
  };
  const adapter = new SerializableSharedCellCleanupDeletionZeroTenantAdapter(
    failing,
    { now: () => now },
  );
  await assert.rejects(
    adapter.readStrongZeroTenantOwnershipSnapshot({
      signal: new AbortController().signal,
    }),
    (error) => {
      const value = error as {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      return (
        value.code === "Serialization_Failure_" &&
        value.retryable === true &&
        !String(value.message).includes("secret")
      );
    },
  );
  const controller = new AbortController();
  const reason = new Error("stop");
  controller.abort(reason);
  await assert.rejects(
    adapter.readStrongZeroTenantOwnershipSnapshot({
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
  assert.equal(reads, 1);
});
