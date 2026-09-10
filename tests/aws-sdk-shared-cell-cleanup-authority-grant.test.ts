import assert from "node:assert/strict";
import test from "node:test";

import {
  AwsSdkGrantBoundSharedCellCleanupAuthorityCas,
  SharedCellCleanupAuthorityStrongReadView,
} from "../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority-grant.ts";
import {
  compileSharedCellCleanupAuthorityCandidateItem,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type AtomicSharedCellCleanupAuthorityPort,
  type SharedCellAuthorityItem,
  type SharedCellProvisionAuthorityRecord,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const now = Date.parse("2026-09-07T20:00:00.000Z");

async function predecessor(): Promise<SharedCellAuthorityItem> {
  const partial = {
    schemaVersion: 2 as const,
    accountId: "402010193138" as const,
    region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt: "2026-09-07T19:00:00.000Z",
    cloudFormationRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
    templateCanonicalSha256: "a".repeat(64),
    resourceInventorySha256: "b".repeat(64),
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const unsigned: Omit<SharedCellProvisionAuthorityRecord, "recordHash"> = {
    ...partial,
    provisionOperationHash: await sha256Hex(
      sharedCellProvisionOperationIntent(partial),
    ),
    revision: 1,
    state: "provision_verified",
  };
  const record: SharedCellProvisionAuthorityRecord = {
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  };
  return {
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 2,
    revision: 1,
    record_json: JSON.stringify(record),
  };
}

async function fixture(expiry = now + 60_000) {
  const previous = await predecessor();
  const next = await compileSharedCellCleanupAuthorityCandidateItem({
    cell: {
      stackName: "techlong-sandbox-cell-sandbox-1",
      stackId:
        "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
      stackStatus: "CREATE_COMPLETE",
      cellExpiresAt: "2026-09-07T19:00:00.000Z",
      cloudFormationRoleArn:
        "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
      templateCanonicalSha256: "a".repeat(64),
      resourceInventorySha256: "b".repeat(64),
    },
    provision: {
      ownerDeploymentId: "deployment_cell_owner_1",
      generation: 1,
      epoch: 1,
      operationHash: (JSON.parse(previous.record_json) as {
        provisionOperationHash: string;
      }).provisionOperationHash,
    },
    cleanup: {
      epoch: 2,
      expiresAt: new Date(now + 30 * 60_000).toISOString(),
    },
    revision: 2,
    now,
  });
  let reads = 0;
  let writes = 0;
  let submitted:
    | Parameters<AtomicSharedCellCleanupAuthorityPort["compareAndSet"]>[0]
    | undefined;
  const snapshot = {
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    revision: 1,
    item: previous,
  } as const;
  const delegate: AtomicSharedCellCleanupAuthorityPort = {
    async observe() {
      reads += 1;
      return snapshot;
    },
    async compareAndSet(input) {
      writes += 1;
      submitted = input;
      return {
        applied: true,
        snapshot: {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: 2,
          item: next,
        },
      };
    },
  };
  const grant = {
    schemaVersion: 1 as const,
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    fromState: "provision_verified" as const,
    toState: "cleanup_authorized" as const,
    expectedPredecessorItemSha256: await sha256Hex(previous),
    approvedCandidateItemSha256: await sha256Hex(next),
    expiresAt: new Date(expiry).toISOString(),
  };
  return {
    previous,
    next,
    snapshot,
    delegate,
    grant,
    calls: () => ({ reads, writes }),
    submitted: () => submitted,
  };
}

test("grant-bound CAS delegates only the exact reviewed transition", async () => {
  const subject = await fixture();
  const adapter = new AwsSdkGrantBoundSharedCellCleanupAuthorityCas(
    subject.grant,
    subject.delegate,
    () => now,
  );
  const result = await adapter.compareAndSet({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    expected: subject.snapshot,
    next: subject.next,
    signal: new AbortController().signal,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(subject.calls(), { reads: 0, writes: 1 });
  assert.deepEqual(subject.submitted()?.expected, subject.snapshot);
  assert.deepEqual(subject.submitted()?.next, subject.next);
  assert.notEqual(subject.submitted()?.expected, subject.snapshot);
  assert.notEqual(subject.submitted()?.expected.item, subject.snapshot.item);
  assert.notEqual(subject.submitted()?.next, subject.next);
});

test("digest drift and absent bootstrap fail before the delegate", async () => {
  const subject = await fixture();
  const adapter = new AwsSdkGrantBoundSharedCellCleanupAuthorityCas(
    subject.grant,
    subject.delegate,
    () => now,
  );
  await assert.rejects(
    adapter.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected: subject.snapshot,
      next: { ...subject.next, revision: 3 },
      signal: new AbortController().signal,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_GRANT_SCOPE_MISMATCH",
  );
  await assert.rejects(
    adapter.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected: {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision: 0,
        item: null,
      },
      next: subject.next,
      signal: new AbortController().signal,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_GRANT_PREDECESSOR_MISSING",
  );
  assert.deepEqual(subject.calls(), { reads: 0, writes: 0 });
});

test("an expired grant and a pre-aborted signal make no provider call", async () => {
  const subject = await fixture(now);
  const adapter = new AwsSdkGrantBoundSharedCellCleanupAuthorityCas(
    subject.grant,
    subject.delegate,
    () => now,
  );
  await assert.rejects(
    adapter.compareAndSet({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      expected: subject.snapshot,
      next: subject.next,
      signal: new AbortController().signal,
    }),
    (error) =>
      (error as { code?: string }).code === "SHARED_CELL_CLEANUP_GRANT_EXPIRED",
  );
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(
    adapter.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: controller.signal,
    }),
    /stop/,
  );
  assert.deepEqual(subject.calls(), { reads: 0, writes: 0 });
});

test("strong-read view supports both operator and deleter without exposing CAS", async () => {
  const subject = await fixture();
  const view = new SharedCellCleanupAuthorityStrongReadView(subject.delegate);
  const signal = new AbortController().signal;
  assert.deepEqual(
    await view.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal,
    }),
    subject.snapshot,
  );
  assert.deepEqual(
    await view.readStrong({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal,
    }),
    subject.snapshot,
  );
  assert.equal("compareAndSet" in view, false);
  assert.deepEqual(subject.calls(), { reads: 2, writes: 0 });
});
