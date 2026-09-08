import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  GrantBoundSharedCellCleanupAuthorityCasPort,
  SharedCellCleanupStackEvidencePort,
  SharedCellZeroTenantEvidencePort,
  executeReviewedSharedCellCleanupAuthorityAdvance,
  inspectSharedCellCleanupAuthorityCandidate,
  recoverReviewedSharedCellCleanupAuthorityAdvance,
  type ReadSharedCellCleanupEvidenceInput,
  type SharedCellCleanupAuthorityCasGrant,
  type SharedCellCleanupAuthorityOperatorManifest,
  type VerifiedSharedCellCleanupStackEvidence,
  type VerifiedSharedCellZeroTenantEvidence,
} from "../lib/deployments/execution/shared-cell-cleanup-authority-operator.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  compileSharedCellCleanupAuthorityCandidateItem,
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellAuthorityItem,
  type SharedCellProvisionAuthorityRecord,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";

const now = Date.parse("2026-09-07T18:00:00.000Z");
const cellExpiresAt = new Date(now - 60_000).toISOString();
const cleanupExpiresAt = new Date(now + 30 * 60_000).toISOString();
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  "techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012";
const templateCanonicalSha256 = "1".repeat(64);
const resourceInventorySha256 = "2".repeat(64);
const ownerDeploymentId = "deployment_cell_owner_1";

async function provisionItem(
  revision = 1,
  selectedCellExpiresAt = cellExpiresAt,
): Promise<SharedCellAuthorityItem> {
  const operationSource = {
    schemaVersion: 1 as const,
    accountId: "402010193138" as const,
    region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId,
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt: selectedCellExpiresAt,
    templateCanonicalSha256,
    resourceInventorySha256,
    ownerDeploymentId,
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const provisionOperationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(operationSource),
  );
  const unsigned: Omit<SharedCellProvisionAuthorityRecord, "recordHash"> = {
    ...operationSource,
    provisionOperationHash,
    revision,
    state: "provision_verified",
  };
  const record: SharedCellProvisionAuthorityRecord = {
    ...unsigned,
    recordHash: await sha256Hex(unsigned),
  };
  return {
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 1,
    revision,
    record_json: canonicalJson(record),
  };
}

function manifestFrom(item: SharedCellAuthorityItem) {
  const record = JSON.parse(
    item.record_json,
  ) as SharedCellProvisionAuthorityRecord;
  const manifest: SharedCellCleanupAuthorityOperatorManifest = {
    expectedProvision: {
      ownerDeploymentId: record.ownerDeploymentId,
      generation: record.generation,
      epoch: record.provisionEpoch,
      operationHash: record.provisionOperationHash,
    },
    cleanup: {
      epoch: 2,
      expiresAt: cleanupExpiresAt,
    },
  };
  return manifest;
}

class MemoryAuthority {
  item: SharedCellAuthorityItem;
  observeCalls = 0;
  casCalls = 0;
  mutateOnRead: ((call: number) => Promise<void> | void) | null = null;

  constructor(item: SharedCellAuthorityItem) {
    this.item = item;
  }

  async observe(): Promise<{
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    revision: number;
    item: SharedCellAuthorityItem;
  }> {
    this.observeCalls += 1;
    await this.mutateOnRead?.(this.observeCalls);
    return {
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      revision: this.item.revision,
      item: this.item,
    };
  }

  async compareAndSet(input: {
    expected: { item: SharedCellAuthorityItem | null };
    next: SharedCellAuthorityItem;
  }): Promise<{
    applied: boolean;
    snapshot: {
      authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
      revision: number;
      item: SharedCellAuthorityItem;
    };
  }> {
    this.casCalls += 1;
    if (
      !input.expected.item ||
      canonicalJson(input.expected.item) !== canonicalJson(this.item)
    ) {
      return {
        applied: false,
        snapshot: {
          authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
          revision: this.item.revision,
          item: this.item,
        },
      };
    }
    this.item = input.next;
    return {
      applied: true,
      snapshot: {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision: this.item.revision,
        item: this.item,
      },
    };
  }
}

class FakeStackEvidence extends SharedCellCleanupStackEvidencePort {
  calls = 0;
  observedAt = now;
  templateHash = templateCanonicalSha256;
  abortAfterRead: AbortController | null = null;

  constructor() {
    super();
  }

  async readVerifiedCleanupStackEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellCleanupStackEvidence> {
    this.calls += 1;
    input.signal.throwIfAborted();
    const result = this.markVerified({
      schemaVersion: 1,
      verified: true,
      observedAt: this.observedAt,
      accountId: "402010193138",
      region: "ca-central-1",
      cellId: "cell-sandbox-1",
      stackName: "techlong-sandbox-cell-sandbox-1",
      stackId: input.predecessor.stackId,
      stackStatus: input.predecessor.stackStatus,
      cellExpiresAt: input.predecessor.cellExpiresAt,
      templateCanonicalSha256: this.templateHash,
      resourceInventorySha256:
        input.predecessor.resourceInventorySha256,
      cloudFormationRoleArn:
        "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
    });
    this.abortAfterRead?.abort(new Error("aborted during Stack evidence"));
    return result;
  }
}

class FakeZeroTenantEvidence extends SharedCellZeroTenantEvidencePort {
  calls = 0;
  observedAt = now;
  sourceSnapshotSha256 = "3".repeat(64);

  constructor() {
    super();
  }

  async readVerifiedZeroTenantEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellZeroTenantEvidence> {
    this.calls += 1;
    input.signal.throwIfAborted();
    return this.markVerified({
      schemaVersion: 1,
      verified: true,
      observedAt: this.observedAt,
      accountId: "402010193138",
      region: "ca-central-1",
      cellId: "cell-sandbox-1",
      environmentId: "env_aws_sandbox_ca_central_1",
      activeTenantCount: 0,
      activeCapacityReservationCount: 0,
      nonterminalDeploymentCount: 0,
      liveTenantResourceCount: 0,
      nonterminalTenantCleanupScheduleCount: 0,
      sourceSnapshotSha256: this.sourceSnapshotSha256,
    });
  }
}

class MemoryGrantBoundWriter extends GrantBoundSharedCellCleanupAuthorityCasPort {
  readonly store: MemoryAuthority;
  abortAfterCas: AbortController | null = null;

  constructor(
    grant: SharedCellCleanupAuthorityCasGrant,
    store: MemoryAuthority,
  ) {
    super(grant);
    this.store = store;
  }

  async observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }) {
    input.signal.throwIfAborted();
    return this.store.observe();
  }

  async compareAndSet(input: Parameters<MemoryAuthority["compareAndSet"]>[0]) {
    const result = await this.store.compareAndSet(input);
    this.abortAfterCas?.abort(new Error("aborted after CAS submission"));
    return result;
  }
}

function grant(input: {
  predecessorItemSha256: string;
  candidateItemSha256: string;
  expiresAt?: string;
}): SharedCellCleanupAuthorityCasGrant {
  return {
    schemaVersion: 1,
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    fromState: "provision_verified",
    toState: "cleanup_authorized",
    expectedPredecessorItemSha256: input.predecessorItemSha256,
    approvedCandidateItemSha256: input.candidateItemSha256,
    expiresAt: input.expiresAt ?? cleanupExpiresAt,
  };
}

test("J5g-b Inspect uses two exact strong reads and emits only reviewed digests", async () => {
  const predecessor = await provisionItem();
  const authority = new MemoryAuthority(predecessor);
  const stackEvidence = new FakeStackEvidence();
  const zeroTenantEvidence = new FakeZeroTenantEvidence();
  const inspected = await inspectSharedCellCleanupAuthorityCandidate({
    authority,
    stackEvidence,
    zeroTenantEvidence,
    manifest: manifestFrom(predecessor),
    signal: new AbortController().signal,
    now: () => now,
  });

  assert.equal(Object.isFrozen(inspected), true);
  assert.equal(inspected.phase, "INSPECTED");
  assert.equal(inspected.mutationPerformed, false);
  assert.equal(inspected.deletionPerformed, false);
  assert.equal(inspected.revision, 2);
  assert.equal(inspected.cleanupEpoch, 2);
  assert.match(inspected.predecessorItemSha256, /^[a-f0-9]{64}$/);
  assert.match(inspected.candidateItemSha256, /^[a-f0-9]{64}$/);
  assert.match(inspected.ownerDeploymentIdSha256, /^[a-f0-9]{64}$/);
  assert.match(inspected.stackEvidenceSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(inspected.zeroTenantEvidenceSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(
    Object.hasOwn(inspected, "ownerDeploymentId"),
    false,
    "raw owner must not be emitted",
  );
  assert.equal(Object.hasOwn(inspected, "stackId"), false);
  assert.equal(Object.hasOwn(inspected, "record_json"), false);
  assert.equal(authority.observeCalls, 2);
  assert.equal(authority.casCalls, 0);
  assert.equal(stackEvidence.calls, 1);
  assert.equal(zeroTenantEvidence.calls, 1);
});

test("J5g-b Execute recollects evidence, performs one grant-bound CAS, and readbacks exactly", async () => {
  const predecessor = await provisionItem();
  const authority = new MemoryAuthority(predecessor);
  const inspected = await inspectSharedCellCleanupAuthorityCandidate({
    authority,
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    signal: new AbortController().signal,
    now: () => now,
  });
  const stackEvidence = new FakeStackEvidence();
  stackEvidence.observedAt = now + 1_000;
  const zeroTenantEvidence = new FakeZeroTenantEvidence();
  zeroTenantEvidence.observedAt = now + 1_000;
  zeroTenantEvidence.sourceSnapshotSha256 = "4".repeat(64);
  const writer = new MemoryGrantBoundWriter(
    grant({
      predecessorItemSha256: inspected.predecessorItemSha256,
      candidateItemSha256: inspected.candidateItemSha256,
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
    }),
    authority,
  );
  const authorized = await executeReviewedSharedCellCleanupAuthorityAdvance({
    authority,
    writer,
    stackEvidence,
    zeroTenantEvidence,
    manifest: manifestFrom(predecessor),
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    signal: new AbortController().signal,
    now: () => now + 1_000,
  });

  assert.equal(authorized.phase, "AUTHORIZED");
  assert.equal(authorized.mutationPerformed, true);
  assert.equal(authorized.deletionPerformed, false);
  assert.equal(authorized.candidateItemSha256, inspected.candidateItemSha256);
  assert.equal(authority.casCalls, 1);
  assert.equal(stackEvidence.calls, 1);
  assert.equal(zeroTenantEvidence.calls, 1);
  assert.equal(JSON.parse(authority.item.record_json).state, "cleanup_authorized");
  assert.equal("deleteStack" in writer, false);
});

test("J5g-b Recover is one strong read even after expiry and never invokes evidence or a writer", async () => {
  const predecessor = await provisionItem();
  const authority = new MemoryAuthority(predecessor);
  const inspected = await inspectSharedCellCleanupAuthorityCandidate({
    authority,
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    signal: new AbortController().signal,
    now: () => now,
  });
  const writer = new MemoryGrantBoundWriter(
    grant({
      predecessorItemSha256: inspected.predecessorItemSha256,
      candidateItemSha256: inspected.candidateItemSha256,
    }),
    authority,
  );
  await executeReviewedSharedCellCleanupAuthorityAdvance({
    authority,
    writer,
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    signal: new AbortController().signal,
    now: () => now,
  });
  const readsBefore = authority.observeCalls;
  const writesBefore = authority.casCalls;
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(cleanupExpiresAt) + 1;
  const recovered = await (async () => {
    try {
      return await recoverReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        approvedCandidateItemSha256: inspected.candidateItemSha256,
        expectedOwnerDeploymentId: ownerDeploymentId,
        signal: new AbortController().signal,
      });
    } finally {
      Date.now = originalDateNow;
    }
  })();
  assert.equal(recovered.phase, "RECOVERED");
  assert.equal(recovered.mutationPerformed, false);
  assert.equal(recovered.deletionPerformed, false);
  assert.equal(recovered.stackEvidenceObservedAt, null);
  assert.equal(recovered.zeroTenantEvidenceObservedAt, null);
  assert.equal(authority.observeCalls, readsBefore + 1);
  assert.equal(authority.casCalls, writesBefore);
});

test("J5g-b rejects structural evidence lookalikes and a structural writer", async (t) => {
  const predecessor = await provisionItem();
  const manifest = manifestFrom(predecessor);
  const structuralStack = {
    async readVerifiedCleanupStackEvidence() {
      return {
        schemaVersion: 1 as const,
        verified: true as const,
        observedAt: now,
        accountId: "402010193138" as const,
        region: "ca-central-1" as const,
        cellId: "cell-sandbox-1" as const,
        stackName: "techlong-sandbox-cell-sandbox-1" as const,
        stackId,
        stackStatus: "CREATE_COMPLETE" as const,
        cellExpiresAt,
        templateCanonicalSha256,
        resourceInventorySha256,
        cloudFormationRoleArn:
          "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
      };
    },
  };
  await t.test("Stack lookalike", async () => {
    const authority = new MemoryAuthority(predecessor);
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority,
        stackEvidence:
          structuralStack as unknown as SharedCellCleanupStackEvidencePort,
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_STACK_PORT_UNVERIFIED",
    );
    assert.equal(authority.casCalls, 0);
  });

  await t.test("zero-tenant lookalike", async () => {
    const authority = new MemoryAuthority(predecessor);
    const structuralZeroTenant = {
      async readVerifiedZeroTenantEvidence() {
        return {
          schemaVersion: 1 as const,
          verified: true as const,
          observedAt: now,
          accountId: "402010193138" as const,
          region: "ca-central-1" as const,
          cellId: "cell-sandbox-1" as const,
          environmentId: "env_aws_sandbox_ca_central_1" as const,
          activeTenantCount: 0 as const,
          activeCapacityReservationCount: 0 as const,
          nonterminalDeploymentCount: 0 as const,
          liveTenantResourceCount: 0 as const,
          nonterminalTenantCleanupScheduleCount: 0 as const,
          sourceSnapshotSha256: "3".repeat(64),
        };
      },
    };
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence:
          structuralZeroTenant as unknown as SharedCellZeroTenantEvidencePort,
        manifest,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_ZERO_TENANT_PORT_UNVERIFIED",
    );
    assert.equal(authority.observeCalls, 0);
    assert.equal(authority.casCalls, 0);
  });

  await t.test("writer lookalike", async () => {
    const authority = new MemoryAuthority(predecessor);
    const inspected = await inspectSharedCellCleanupAuthorityCandidate({
      authority,
      stackEvidence: new FakeStackEvidence(),
      zeroTenantEvidence: new FakeZeroTenantEvidence(),
      manifest,
      signal: new AbortController().signal,
      now: () => now,
    });
    const lookalike = {
      grant: grant({
        predecessorItemSha256: inspected.predecessorItemSha256,
        candidateItemSha256: inspected.candidateItemSha256,
      }),
      observe: authority.observe.bind(authority),
      compareAndSet: authority.compareAndSet.bind(authority),
    };
    await assert.rejects(
      executeReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        writer:
          lookalike as unknown as GrantBoundSharedCellCleanupAuthorityCasPort,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest,
        approvedCandidateItemSha256: inspected.candidateItemSha256,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_WRITER_UNVERIFIED",
    );
    assert.equal(authority.casCalls, 0);
  });
});

test("J5g-b fails closed on predecessor, live lineage, approval, and grant drift", async (t) => {
  await t.test("predecessor changes during Inspect", async () => {
    const predecessor = await provisionItem();
    const authority = new MemoryAuthority(predecessor);
    authority.mutateOnRead = async (call) => {
      if (call === 2) authority.item = await provisionItem(2);
    };
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_PREDECESSOR_CHANGED",
    );
    assert.equal(authority.casCalls, 0);
  });

  await t.test("live Stack lineage differs", async () => {
    const predecessor = await provisionItem();
    const authority = new MemoryAuthority(predecessor);
    const stackEvidence = new FakeStackEvidence();
    stackEvidence.templateHash = "9".repeat(64);
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority,
        stackEvidence,
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_LINEAGE_MISMATCH",
    );
    assert.equal(authority.casCalls, 0);
  });

  await t.test("approved candidate digest differs", async () => {
    const predecessor = await provisionItem();
    const authority = new MemoryAuthority(predecessor);
    const inspected = await inspectSharedCellCleanupAuthorityCandidate({
      authority,
      stackEvidence: new FakeStackEvidence(),
      zeroTenantEvidence: new FakeZeroTenantEvidence(),
      manifest: manifestFrom(predecessor),
      signal: new AbortController().signal,
      now: () => now,
    });
    const wrong = `${inspected.candidateItemSha256.slice(0, -1)}${
      inspected.candidateItemSha256.endsWith("0") ? "1" : "0"
    }`;
    const writer = new MemoryGrantBoundWriter(
      grant({
        predecessorItemSha256: inspected.predecessorItemSha256,
        candidateItemSha256: inspected.candidateItemSha256,
      }),
      authority,
    );
    await assert.rejects(
      executeReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        writer,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        approvedCandidateItemSha256: wrong,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_CANDIDATE_MISMATCH",
    );
    assert.equal(authority.casCalls, 0);
  });

  await t.test("grant predecessor digest differs", async () => {
    const predecessor = await provisionItem();
    const authority = new MemoryAuthority(predecessor);
    const inspected = await inspectSharedCellCleanupAuthorityCandidate({
      authority,
      stackEvidence: new FakeStackEvidence(),
      zeroTenantEvidence: new FakeZeroTenantEvidence(),
      manifest: manifestFrom(predecessor),
      signal: new AbortController().signal,
      now: () => now,
    });
    const writer = new MemoryGrantBoundWriter(
      grant({
        predecessorItemSha256: "0".repeat(64),
        candidateItemSha256: inspected.candidateItemSha256,
      }),
      authority,
    );
    await assert.rejects(
      executeReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        writer,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        approvedCandidateItemSha256: inspected.candidateItemSha256,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_GRANT_MISMATCH",
    );
    assert.equal(authority.casCalls, 0);
  });
});

test("J5g-b rejects a live Cell, stale evidence, and an expired cleanup window", async (t) => {
  await t.test("Cell has not expired", async () => {
    const item = await provisionItem();
    const record = JSON.parse(item.record_json) as Record<string, unknown>;
    record.cellExpiresAt = new Date(now + 60_000).toISOString();
    const operationSource = { ...record };
    delete operationSource.recordHash;
    delete operationSource.revision;
    delete operationSource.state;
    delete operationSource.provisionOperationHash;
    record.provisionOperationHash = await sha256Hex(
      sharedCellProvisionOperationIntent(
        operationSource as unknown as Parameters<
          typeof sharedCellProvisionOperationIntent
        >[0],
      ),
    );
    const unsigned = { ...record };
    delete unsigned.recordHash;
    record.recordHash = await sha256Hex(unsigned);
    const futureItem: SharedCellAuthorityItem = {
      ...item,
      record_json: canonicalJson(record),
    };
    const authority = new MemoryAuthority(futureItem);
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority,
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(futureItem),
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_CELL_NOT_EXPIRED",
    );
  });

  await t.test("evidence is older than 30 seconds", async () => {
    const predecessor = await provisionItem();
    const stackEvidence = new FakeStackEvidence();
    stackEvidence.observedAt = now - 30_001;
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority: new MemoryAuthority(predecessor),
        stackEvidence,
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_STALE",
    );
  });

  await t.test("evidence was collected before Cell expiry", async () => {
    const nearExpiry = new Date(now - 5_000).toISOString();
    const predecessor = await provisionItem(1, nearExpiry);
    const stackEvidence = new FakeStackEvidence();
    stackEvidence.observedAt = now - 6_000;
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority: new MemoryAuthority(predecessor),
        stackEvidence,
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest: manifestFrom(predecessor),
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_PREDATES_EXPIRY",
    );
  });

  await t.test("cleanup authorization already expired", async () => {
    const predecessor = await provisionItem();
    const manifest = manifestFrom(predecessor);
    manifest.cleanup.expiresAt = new Date(now - 1).toISOString();
    await assert.rejects(
      inspectSharedCellCleanupAuthorityCandidate({
        authority: new MemoryAuthority(predecessor),
        stackEvidence: new FakeStackEvidence(),
        zeroTenantEvidence: new FakeZeroTenantEvidence(),
        manifest,
        signal: new AbortController().signal,
        now: () => now,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED",
    );
  });
});

test("J5g-b treats abort after CAS as uncertain and resolves only by pure recovery", async () => {
  const predecessor = await provisionItem();
  const authority = new MemoryAuthority(predecessor);
  const inspected = await inspectSharedCellCleanupAuthorityCandidate({
    authority,
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    signal: new AbortController().signal,
    now: () => now,
  });
  const controller = new AbortController();
  const writer = new MemoryGrantBoundWriter(
    grant({
      predecessorItemSha256: inspected.predecessorItemSha256,
      candidateItemSha256: inspected.candidateItemSha256,
    }),
    authority,
  );
  writer.abortAfterCas = controller;
  await assert.rejects(
    executeReviewedSharedCellCleanupAuthorityAdvance({
      authority,
      writer,
      stackEvidence: new FakeStackEvidence(),
      zeroTenantEvidence: new FakeZeroTenantEvidence(),
      manifest: manifestFrom(predecessor),
      approvedCandidateItemSha256: inspected.candidateItemSha256,
      signal: controller.signal,
      now: () => now,
    }),
    (error: unknown) =>
      (error as { code?: string; retryable?: boolean }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_WRITE_UNCERTAIN" &&
      (error as { retryable?: boolean }).retryable === true,
  );
  assert.equal(authority.casCalls, 1);
  assert.equal(JSON.parse(authority.item.record_json).state, "cleanup_authorized");

  const readsBefore = authority.observeCalls;
  const recovered = await recoverReviewedSharedCellCleanupAuthorityAdvance({
    authority,
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    expectedOwnerDeploymentId: ownerDeploymentId,
    signal: new AbortController().signal,
  });
  assert.equal(recovered.phase, "RECOVERED");
  assert.equal(authority.observeCalls, readsBefore + 1);
  assert.equal(authority.casCalls, 1);
});

test("J5g-b Recover rejects owner, digest, and impossible predecessor revision drift", async (t) => {
  const predecessor = await provisionItem();
  const predecessorRecord = JSON.parse(
    predecessor.record_json,
  ) as SharedCellProvisionAuthorityRecord;
  const malformedCleanup = await compileSharedCellCleanupAuthorityCandidateItem({
    cell: {
      stackName: predecessorRecord.stackName,
      stackId: predecessorRecord.stackId,
      stackStatus: predecessorRecord.stackStatus,
      cellExpiresAt: predecessorRecord.cellExpiresAt,
      templateCanonicalSha256: predecessorRecord.templateCanonicalSha256,
      resourceInventorySha256: predecessorRecord.resourceInventorySha256,
    },
    provision: {
      ownerDeploymentId: predecessorRecord.ownerDeploymentId,
      generation: predecessorRecord.generation,
      epoch: predecessorRecord.provisionEpoch,
      operationHash: predecessorRecord.provisionOperationHash,
    },
    cleanup: { epoch: 2, expiresAt: cleanupExpiresAt },
    revision: 1,
    now,
  });
  const malformedDigest = await sha256Hex(malformedCleanup);

  await t.test("cleanup revision 1 cannot reconstruct revision 0", async () => {
    await assert.rejects(
      recoverReviewedSharedCellCleanupAuthorityAdvance({
        authority: new MemoryAuthority(malformedCleanup),
        approvedCandidateItemSha256: malformedDigest,
        expectedOwnerDeploymentId: ownerDeploymentId,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
    );
  });

  const authority = new MemoryAuthority(predecessor);
  const inspected = await inspectSharedCellCleanupAuthorityCandidate({
    authority,
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    signal: new AbortController().signal,
    now: () => now,
  });
  await executeReviewedSharedCellCleanupAuthorityAdvance({
    authority,
    writer: new MemoryGrantBoundWriter(
      grant({
        predecessorItemSha256: inspected.predecessorItemSha256,
        candidateItemSha256: inspected.candidateItemSha256,
      }),
      authority,
    ),
    stackEvidence: new FakeStackEvidence(),
    zeroTenantEvidence: new FakeZeroTenantEvidence(),
    manifest: manifestFrom(predecessor),
    approvedCandidateItemSha256: inspected.candidateItemSha256,
    signal: new AbortController().signal,
    now: () => now,
  });

  await t.test("owner drift", async () => {
    await assert.rejects(
      recoverReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        approvedCandidateItemSha256: inspected.candidateItemSha256,
        expectedOwnerDeploymentId: "deployment_different_owner",
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
    );
  });

  await t.test("candidate digest drift", async () => {
    await assert.rejects(
      recoverReviewedSharedCellCleanupAuthorityAdvance({
        authority,
        approvedCandidateItemSha256: "0".repeat(64),
        expectedOwnerDeploymentId: ownerDeploymentId,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_DIGEST_MISMATCH",
    );
  });
});

test("J5g-b AbortSignal stops before evidence or mutation", async () => {
  const predecessor = await provisionItem();
  const authority = new MemoryAuthority(predecessor);
  const stackEvidence = new FakeStackEvidence();
  const zeroTenantEvidence = new FakeZeroTenantEvidence();
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(
    inspectSharedCellCleanupAuthorityCandidate({
      authority,
      stackEvidence,
      zeroTenantEvidence,
      manifest: manifestFrom(predecessor),
      signal: controller.signal,
      now: () => now,
    }),
    (error: unknown) => error === controller.signal.reason,
  );
  assert.equal(authority.observeCalls, 0);
  assert.equal(authority.casCalls, 0);
  assert.equal(stackEvidence.calls, 0);
  assert.equal(zeroTenantEvidence.calls, 0);
});
