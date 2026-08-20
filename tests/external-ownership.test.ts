import assert from "node:assert/strict";
import test from "node:test";

import type {
  AwsDeploymentPort,
  TenantExternalOperationFence,
  TenantExternalOwnershipPort,
  TenantExternalOwnershipProof,
} from "../lib/deployments/execution/contracts.ts";
import {
  AuthorityBackedTenantExternalOwnershipProvider,
  CloudFormationTenantOwnershipReadback,
  DisabledAtomicTenantExternalEpochAuthority,
  type AtomicTenantExternalEpochAuthorityPort,
  type TenantExternalEpochAuthorityRecord,
} from "../lib/deployments/execution/cloudformation-external-ownership.ts";
import { DisabledTenantExternalOwnershipPort } from "../lib/deployments/execution/external-ownership.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const pendingFence: TenantExternalOperationFence = {
  schemaVersion: 1,
  resourceFence: {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      appInstanceId: "app_tenant_one",
      workspaceId: "wsp_one",
      productId: "prd_restaurant",
      environmentId: "env_sandbox",
      cellKey: "cell-sandbox-1",
      databaseName: "tenant_app_one",
      roleName: "tenant_role_one",
      secretName: "techlong/sandbox/tenant/app_one/runtime",
      stableIdentityHash: "a".repeat(64),
    },
    generation: 1,
    ownerDeploymentId: "dep_one",
    ownershipMarker: `tl_owner_${"a".repeat(32)}_g1`,
  },
  epoch: 1,
  intent: "provision",
  ownerDeploymentId: "dep_one",
  operationHash: "b".repeat(64),
  marker: `tl_epoch_${"a".repeat(24)}_g1_e1`,
  state: "pending_external",
};

test("disabled ownership provider fails closed and preserves an already-aborted reason", async () => {
  const port = new DisabledTenantExternalOwnershipPort();
  await assert.rejects(
    port.installAndObserve({
      pendingFence,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_OWNERSHIP_BOUNDARY_DISABLED",
  );

  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    port.installAndObserve({ pendingFence, signal: controller.signal }),
    /lease lost/,
  );
});
test("an injected ownership provider receives the exact pending fence and signal", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | null = null;
  const proof: TenantExternalOwnershipProof = {
    schemaVersion: 1,
    pendingFence,
    evidenceHash: "c".repeat(64),
    evidence: { provider: "offline-mock", marker: pendingFence.marker },
  };
  const port: TenantExternalOwnershipPort = {
    installAndObserve: async (input) => {
      observedSignal = input.signal;
      assert.deepEqual(input.pendingFence, pendingFence);
      return proof;
    },
  };

  assert.deepEqual(
    await port.installAndObserve({ pendingFence, signal: controller.signal }),
    proof,
  );
  assert.equal(observedSignal, controller.signal);
});

function pending(input: {
  epoch?: number;
  generation?: number;
  intent?: "provision" | "cleanup";
  operationHash?: string;
} = {}): TenantExternalOperationFence {
  const epoch = input.epoch ?? 1;
  const generation = input.generation ?? 1;
  const intent = input.intent ?? "provision";
  return {
    ...pendingFence,
    epoch,
    intent,
    operationHash: input.operationHash ?? String(epoch).repeat(64).slice(0, 64),
    marker: `tl_epoch_${"a".repeat(24)}_g${generation}_e${epoch}`,
    resourceFence: {
      ...pendingFence.resourceFence,
      generation,
      ownershipMarker: `tl_owner_${"a".repeat(32)}_g${generation}`,
    },
  };
}

function authorityRecord(
  fence: TenantExternalOperationFence,
  predecessor: TenantExternalEpochAuthorityRecord["predecessor"] = null,
): TenantExternalEpochAuthorityRecord {
  return {
    schemaVersion: 1,
    stableIdentityHash: fence.resourceFence.identity.stableIdentityHash,
    generation: fence.resourceFence.generation,
    epoch: fence.epoch,
    intent: fence.intent,
    ownerDeploymentId: fence.ownerDeploymentId,
    operationHash: fence.operationHash,
    marker: fence.marker,
    predecessor,
  };
}

function authorityCoordinate(
  record: TenantExternalEpochAuthorityRecord,
): NonNullable<TenantExternalEpochAuthorityRecord["predecessor"]> {
  return {
    schemaVersion: 1,
    generation: record.generation,
    epoch: record.epoch,
    intent: record.intent,
    ownerDeploymentId: record.ownerDeploymentId,
    operationHash: record.operationHash,
    marker: record.marker,
  };
}

function authority(input: {
  initial?: TenantExternalEpochAuthorityRecord | null;
  conflict?: boolean;
} = {}): AtomicTenantExternalEpochAuthorityPort & {
  observeCalls: number;
  compareCalls: number;
} {
  const key = `tenant:${"a".repeat(64)}`;
  let record = input.initial ?? null;
  let revision = "rev-0";
  return {
    observeCalls: 0,
    compareCalls: 0,
    async observe({ authorityKey, signal }) {
      signal.throwIfAborted();
      this.observeCalls += 1;
      assert.equal(authorityKey, key);
      return { authorityKey, revision, record };
    },
    async compareAndSet({ authorityKey, expected, next, signal }) {
      signal.throwIfAborted();
      this.compareCalls += 1;
      assert.equal(authorityKey, key);
      if (
        input.conflict ||
        expected.revision !== revision ||
        JSON.stringify(expected.record) !== JSON.stringify(record)
      ) {
        return {
          applied: false,
          snapshot: { authorityKey, revision, record },
        };
      }
      record = {
        ...next,
        predecessor: expected.record
          ? authorityCoordinate(expected.record)
          : null,
      };
      revision = "rev-1";
      return {
        applied: true,
        snapshot: { authorityKey, revision, record },
      };
    },
  };
}

function workloadTags(
  fence: TenantExternalOperationFence,
  operation: TenantExternalOperationFence = fence,
): Record<string, string> {
  return {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-provisioner",
    AppInstanceId: fence.resourceFence.identity.appInstanceId,
    CellId: fence.resourceFence.identity.cellKey,
    ResourceGeneration: String(fence.resourceFence.generation),
    DeploymentId: fence.ownerDeploymentId,
    ExternalOperationEpoch: String(operation.epoch),
    ExternalOperationIntent: operation.intent,
    ExternalOperationMarker: operation.marker,
    ExternalOperationHash: operation.operationHash,
  };
}

function workload(input: {
  state?: "missing" | "ready";
  tags?: Record<string, string>;
} = {}) {
  return {
    calls: 0,
    async observe({
      signal,
    }: {
      pendingFence: TenantExternalOperationFence;
      signal: AbortSignal;
    }) {
      signal.throwIfAborted();
      this.calls += 1;
      return {
        stackName: "techlong-sandbox-tenant-tenantone",
        state: input.state ?? "missing",
        stackId: input.state === "ready" ? "stack-1" : null,
        tags: input.tags ?? {},
      } as const;
    },
  };
}

test("atomic authority is the only ownership grant and the disabled default fails before workload readback", async () => {
  const readback = workload();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: new DisabledAtomicTenantExternalEpochAuthority(),
    workload: readback,
  });
  await assert.rejects(
    provider.installAndObserve({
      pendingFence: pending(),
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_DISABLED",
  );
  assert.equal(readback.calls, 0);
});

test("authority-backed provider performs atomic CAS and independently reads back the exact epoch", async () => {
  const fence = pending();
  const epochAuthority = authority();
  const readback = workload();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  const proof = await provider.installAndObserve({
    pendingFence: fence,
    signal: new AbortController().signal,
  });
  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(epochAuthority.observeCalls, 2);
  assert.equal(readback.calls, 2);
  assert.deepEqual(proof.pendingFence, fence);
  assert.equal(proof.evidenceHash, await sha256Hex(proof.evidence));
  assert.deepEqual(
    (proof.evidence.authorityRecord as TenantExternalEpochAuthorityRecord),
    authorityRecord(fence),
  );
});

test("an exact authority replay skips CAS but still performs independent readback", async () => {
  const fence = pending();
  const epochAuthority = authority({ initial: authorityRecord(fence) });
  const readback = workload();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  await provider.installAndObserve({
    pendingFence: fence,
    signal: new AbortController().signal,
  });
  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(epochAuthority.observeCalls, 2);
  assert.equal(readback.calls, 2);
});

test("a same-generation provision update atomically advances authority while CloudFormation remains on its exact predecessor", async () => {
  const previous = pending({ epoch: 1, intent: "provision" });
  const update = pending({
    epoch: 2,
    intent: "provision",
    operationHash: "e".repeat(64),
  });
  const previousRecord = authorityRecord(previous);
  const epochAuthority = authority({ initial: previousRecord });
  const readback = workload({
    state: "ready",
    tags: workloadTags(update, previous),
  });
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });

  const proof = await provider.installAndObserve({
    pendingFence: update,
    signal: new AbortController().signal,
  });

  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(readback.calls, 2);
  assert.deepEqual(
    proof.evidence.authorityRecord,
    authorityRecord(update, authorityCoordinate(previousRecord)),
  );
});

test("a same-generation provision update replay retains its exact predecessor without a second CAS", async () => {
  const previous = pending({ epoch: 1, intent: "provision" });
  const update = pending({
    epoch: 2,
    intent: "provision",
    operationHash: "e".repeat(64),
  });
  const previousRecord = authorityRecord(previous);
  const updateRecord = authorityRecord(
    update,
    authorityCoordinate(previousRecord),
  );
  const epochAuthority = authority({ initial: updateRecord });
  const readback = workload({
    state: "ready",
    tags: workloadTags(update, previous),
  });

  const proof = await new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  }).installAndObserve({
    pendingFence: update,
    signal: new AbortController().signal,
  });

  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(readback.calls, 2);
  assert.deepEqual(proof.evidence.authorityRecord, updateRecord);
});

test("a same-generation provision update can recover while its predecessor workload is still missing", async () => {
  const previous = pending({ epoch: 1, intent: "provision" });
  const update = pending({
    epoch: 2,
    intent: "provision",
    operationHash: "e".repeat(64),
  });
  const previousRecord = authorityRecord(previous);
  const epochAuthority = authority({ initial: previousRecord });
  const readback = workload();

  const proof = await new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  }).installAndObserve({
    pendingFence: update,
    signal: new AbortController().signal,
  });

  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(readback.calls, 2);
  assert.deepEqual(
    proof.evidence.authorityRecord,
    authorityRecord(update, authorityCoordinate(previousRecord)),
  );
});

test("a same-generation provision update cannot adopt a workload already mutated to the unactivated epoch", async () => {
  const previous = pending({ epoch: 1, intent: "provision" });
  const update = pending({
    epoch: 2,
    intent: "provision",
    operationHash: "e".repeat(64),
  });
  const epochAuthority = authority({ initial: authorityRecord(previous) });
  const readback = workload({ state: "ready", tags: workloadTags(update) });

  await assert.rejects(
    new AuthorityBackedTenantExternalOwnershipProvider({
      authority: epochAuthority,
      workload: readback,
    }).installAndObserve({
      pendingFence: update,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_WORKLOAD_CLEANUP_FIRST_REQUIRED",
  );
  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(readback.calls, 1);
});

test("an empty authority rejects a later generation before workload readback or CAS", async () => {
  const epochAuthority = authority();
  const readback = workload();
  await assert.rejects(
    new AuthorityBackedTenantExternalOwnershipProvider({
      authority: epochAuthority,
      workload: readback,
    }).installAndObserve({
      pendingFence: pending({ generation: 2, epoch: 1 }),
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_UNADOPTED",
  );
  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(readback.calls, 0);
});

test("old, future, same-coordinate drift and CAS conflicts never produce an ownership proof", async () => {
  const cases: Array<{
    name: string;
    fence: TenantExternalOperationFence;
    initial: TenantExternalEpochAuthorityRecord;
    code: string;
    conflict?: boolean;
  }> = [
    {
      name: "old",
      fence: pending({ epoch: 1 }),
      initial: authorityRecord(
        pending({ epoch: 2, intent: "cleanup" }),
        authorityCoordinate(authorityRecord(pending({ epoch: 1 }))),
      ),
      code: "TENANT_EXTERNAL_EPOCH_STALE",
    },
    {
      name: "future generation",
      fence: pending({ epoch: 4, generation: 3 }),
      initial: authorityRecord(
        pending({ epoch: 2, intent: "cleanup" }),
        authorityCoordinate(authorityRecord(pending({ epoch: 1 }))),
      ),
      code: "TENANT_EXTERNAL_EPOCH_FUTURE_GENERATION",
    },
    {
      name: "same epoch drift",
      fence: pending({ epoch: 2, intent: "cleanup", operationHash: "e".repeat(64) }),
      initial: authorityRecord(
        pending({ epoch: 2, intent: "cleanup", operationHash: "f".repeat(64) }),
        authorityCoordinate(authorityRecord(pending({ epoch: 1 }))),
      ),
      code: "TENANT_EXTERNAL_EPOCH_DRIFT",
    },
  ];
  for (const item of cases) {
    const epochAuthority = authority({ initial: item.initial });
    const readback = workload();
    const provider = new AuthorityBackedTenantExternalOwnershipProvider({
      authority: epochAuthority,
      workload: readback,
    });
    await assert.rejects(
      provider.installAndObserve({
        pendingFence: item.fence,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === item.code,
      item.name,
    );
    assert.equal(epochAuthority.compareCalls, 0, item.name);
    assert.equal(readback.calls, 0, item.name);
  }

  const epochAuthority = authority({ conflict: true });
  const readback = workload();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  await assert.rejects(
    provider.installAndObserve({
      pendingFence: pending(),
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_EXTERNAL_EPOCH_CAS_CONFLICT" &&
      (error as { retryable?: boolean }).retryable === true,
  );
  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(readback.calls, 1);
});

test("CloudFormation readback is a compatibility guard, never an ownership grant", async () => {
  const fence = pending();
  let describes = 0;
  let writes = 0;
  const aws = {
    region: "ca-central-1",
    getCallerIdentity: async () => ({ accountId: "402010193138", arn: "test" }),
    describeTenantStack: async () => {
      describes += 1;
      return {
        state: "ready",
        rawStatus: "CREATE_COMPLETE",
        stackId: "stack-1",
        outputs: {},
        tags: workloadTags(fence, {
          ...fence,
          operationHash: "f".repeat(64),
        }),
      } as const;
    },
    applyTenantStack: async () => {
      writes += 1;
      throw new Error("must not apply");
    },
    deleteTenantStack: async () => {
      writes += 1;
      throw new Error("must not delete");
    },
  } as AwsDeploymentPort;
  const epochAuthority = authority();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: new CloudFormationTenantOwnershipReadback(aws),
  });
  await assert.rejects(
    provider.installAndObserve({
      pendingFence: fence,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_WORKLOAD_AUTHORITY_ADOPTION_REQUIRED",
  );
  assert.equal(describes, 1);
  assert.equal(writes, 0);
  assert.equal(epochAuthority.compareCalls, 0);
});

test("cleanup may claim authority for the exact older provision workload only", async () => {
  const provision = pending({ epoch: 1, intent: "provision" });
  const cleanup = pending({ epoch: 2, intent: "cleanup" });
  const epochAuthority = authority({ initial: authorityRecord(provision) });
  const readback = workload({
    state: "ready",
    tags: workloadTags(cleanup, provision),
  });
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  const proof = await provider.installAndObserve({
    pendingFence: cleanup,
    signal: new AbortController().signal,
  });
  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(readback.calls, 2);
  assert.equal(
    (proof.evidence.authorityRecord as TenantExternalEpochAuthorityRecord).intent,
    "cleanup",
  );
});

test("cleanup can supersede a provider-installed provision whose workload was never created", async () => {
  const provision = pending({ epoch: 1, intent: "provision" });
  const cleanup = pending({ epoch: 2, intent: "cleanup" });
  const provisionRecord = authorityRecord(provision);
  const epochAuthority = authority({ initial: provisionRecord });
  const readback = workload();

  const proof = await new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  }).installAndObserve({
    pendingFence: cleanup,
    signal: new AbortController().signal,
  });

  assert.equal(epochAuthority.compareCalls, 1);
  assert.equal(readback.calls, 2);
  assert.deepEqual(
    proof.evidence.authorityRecord,
    authorityRecord(cleanup, authorityCoordinate(provisionRecord)),
  );
});

test("cleanup crash replay retains the exact provision predecessor and performs no second CAS", async () => {
  const provision = pending({ epoch: 1, intent: "provision" });
  const cleanup = pending({ epoch: 2, intent: "cleanup" });
  const provisionRecord = authorityRecord(provision);
  const cleanupRecord = authorityRecord(
    cleanup,
    authorityCoordinate(provisionRecord),
  );
  const epochAuthority = authority({ initial: cleanupRecord });
  const readback = workload({
    state: "ready",
    tags: workloadTags(cleanup, provision),
  });
  const proof = await new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  }).installAndObserve({
    pendingFence: cleanup,
    signal: new AbortController().signal,
  });
  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(readback.calls, 2);
  assert.deepEqual(proof.evidence.authorityRecord, cleanupRecord);
});

test("cleanup rejects a workload that does not exactly match its authority-derived predecessor", async () => {
  const provision = pending({ epoch: 1, intent: "provision" });
  const cleanup = pending({ epoch: 2, intent: "cleanup" });
  const forgedProvision = {
    ...provision,
    operationHash: "f".repeat(64),
  };
  const epochAuthority = authority({ initial: authorityRecord(provision) });
  const readback = workload({
    state: "ready",
    tags: workloadTags(cleanup, forgedProvision),
  });
  await assert.rejects(
    new AuthorityBackedTenantExternalOwnershipProvider({
      authority: epochAuthority,
      workload: readback,
    }).installAndObserve({
      pendingFence: cleanup,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_WORKLOAD_CLEANUP_FIRST_REQUIRED",
  );
  assert.equal(epochAuthority.compareCalls, 0);
});

test("provider rejects an authority CAS that forges rather than derives the predecessor", async () => {
  const provision = pending({ epoch: 1, intent: "provision" });
  const cleanup = pending({ epoch: 2, intent: "cleanup" });
  const current = authorityRecord(provision);
  const forgedPredecessor = {
    ...authorityCoordinate(current),
    operationHash: "f".repeat(64),
  };
  let observations = 0;
  const maliciousAuthority: AtomicTenantExternalEpochAuthorityPort = {
    observe: async ({ authorityKey }) => {
      observations += 1;
      return {
        authorityKey,
        revision: observations === 1 ? "rev-0" : "rev-1",
        record:
          observations === 1
            ? current
            : authorityRecord(cleanup, forgedPredecessor),
      };
    },
    compareAndSet: async ({ authorityKey }) => ({
      applied: true,
      snapshot: {
        authorityKey,
        revision: "rev-1",
        record: authorityRecord(cleanup, forgedPredecessor),
      },
    }),
  };
  await assert.rejects(
    new AuthorityBackedTenantExternalOwnershipProvider({
      authority: maliciousAuthority,
      workload: workload({
        state: "ready",
        tags: workloadTags(cleanup, provision),
      }),
    }).installAndObserve({
      pendingFence: cleanup,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_EPOCH_CAS_CONFLICT",
  );
});

test("a cleaned generation reopens at epoch one without comparing epochs across generations", async () => {
  const previousProvision = pending({ epoch: 1, generation: 1, intent: "provision" });
  const previousCleanup = pending({ epoch: 2, generation: 1, intent: "cleanup" });
  const reopened = pending({ epoch: 1, generation: 2, intent: "provision" });
  const previousProvisionRecord = authorityRecord(previousProvision);
  const previousCleanupRecord = authorityRecord(
    previousCleanup,
    authorityCoordinate(previousProvisionRecord),
  );
  const epochAuthority = authority({ initial: previousCleanupRecord });
  const readback = workload();
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  const proof = await provider.installAndObserve({
    pendingFence: reopened,
    signal: new AbortController().signal,
  });
  assert.equal(epochAuthority.compareCalls, 1);
  assert.deepEqual(
    proof.evidence.authorityRecord,
    authorityRecord(reopened, authorityCoordinate(previousCleanupRecord)),
  );

  const notCleaned = authority({ initial: authorityRecord(previousProvision) });
  await assert.rejects(
    new AuthorityBackedTenantExternalOwnershipProvider({
      authority: notCleaned,
      workload: workload(),
    }).installAndObserve({
      pendingFence: reopened,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
  );
});

test("an empty authority refuses to self-adopt an existing workload even when its tags look exact", async () => {
  const fence = pending();
  const epochAuthority = authority();
  const readback = workload({ state: "ready", tags: workloadTags(fence) });
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority: epochAuthority,
    workload: readback,
  });
  await assert.rejects(
    provider.installAndObserve({
      pendingFence: fence,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_WORKLOAD_AUTHORITY_ADOPTION_REQUIRED",
  );
  assert.equal(epochAuthority.compareCalls, 0);
  assert.equal(readback.calls, 1);
});
