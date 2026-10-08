import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  compileSealedCellCleanupAuthorityCandidateV3, SealedCellAuthorityOwnershipEvidenceAdapterV3,
  SealedCellDeletionOwnershipEvidenceAdapterV3, sealedCellOwnershipStateV3,
} from "../lib/deployments/execution/sealed-cell-cleanup-evidence-v3.ts";
import { SerializableSharedCellZeroTenantEvidenceAdapter } from "../lib/deployments/execution/shared-cell-zero-tenant-evidence.ts";
import type { SealedPlanCertificateV1 } from "../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import { now, sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;
async function prepared(fixture?: Awaited<ReturnType<typeof sealedEvidenceFixture>>) {
  const f = fixture ?? await sealedEvidenceFixture();
  const adapter = new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now });
  const ownership = await adapter.readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() });
  const input = { predecessor: f.predecessor, stack: f.stack, ownership, cleanupEpoch: 2, expiresAt: now + 60_000, now };
  return { ...f, ownership, input, candidate: await compileSealedCellCleanupAuthorityCandidateV3(input) };
}

test("v3 fresh evidence, authority candidate and second-read deletion plan retain full certificate/raw witness", async () => {
  const f = await prepared();
  assert.equal(f.reads(), 1);
  assert.equal(f.ownership.schemaVersion, 3);
  assert.equal(await sha256Hex(sealedCellOwnershipStateV3(f.ownership.snapshot)), f.ownership.snapshot.ownershipStateSha256);
  assert.deepEqual(f.candidate.ownershipState.sealedCertificates, [f.cert]);
  const deletion = await new SealedCellDeletionOwnershipEvidenceAdapterV3(f.source, { now: () => now })
    .prepareFreshDeletionPlan({ candidate: f.candidate, signal: signal() });
  assert.equal(f.reads(), 2);
  assert.equal(deletion.plan.authorityCandidate.recordSha256, f.candidate.recordSha256);
  assert.deepEqual(deletion.plan.ownershipState.rawOwnershipWitness.nonterminalDeploymentIds, [f.cert.deployment_id]);
  assert.equal(deletion.planSha256, await sha256Hex(deletion.plan));
  assert.equal(deletion.mutationAuthorized, false); assert.equal(deletion.runtimeActivationAuthorized, false);
  assert.equal(deletion.plan.plannedDeleteMode, "STANDARD"); assert.deepEqual(deletion.plan.retainResources, []);
  assert.throws(() => deletion.plan.ownershipState.sealedCertificates.push(f.cert), TypeError);
});

test("JSON/copies cannot manufacture source, ownership, Stack or candidate provenance", async () => {
  const f = await prepared();
  const fakeSource = { readCertifiedSerializableSnapshot: async () => structuredClone(f.ownership.snapshot) };
  await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(fakeSource, { now: () => now })
    .readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_SOURCE_UNVERIFIED"));
  for (const key of ["ownership", "stack"] as const) {
    await assert.rejects(compileSealedCellCleanupAuthorityCandidateV3({ ...f.input, [key]: structuredClone(f.input[key]) }));
  }
  await assert.rejects(new SealedCellDeletionOwnershipEvidenceAdapterV3(f.source, { now: () => now })
    .prepareFreshDeletionPlan({ candidate: structuredClone(f.candidate), signal: signal() }), code("SEALED_V3_AUTHORITY_CANDIDATE_UNVERIFIED"));
});

test("all five real ownership categories block a zero proof, including terminal deployment associations", async () => {
  for (const index of [5, 6, 7, 8, 4]) {
    const f = await sealedEvidenceFixture();
    if (index === 4) { f.results[4].rows.push({ instance_id: f.cert.app_instance_id, deployment_id: "dep_terminal_new" }); }
    else { f.results[index].rows.push({ id: "zz_live" }); }
    await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now })
      .readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_NOT_ZERO"));
  }
});

test("stale/future DB time, slow read and regressing host clock fail closed", async () => {
  for (const time of [now - 30_001, now + 1]) {
    const f = await sealedEvidenceFixture(); f.results[1].rows[0].observed_at = time;
    if (time < now) f.results[1].rows[0].admission_changed_at = now - 40_000;
    await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now })
      .readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_EVIDENCE_STALE"));
  }
  for (const end of [now + 30_001, now - 1]) {
    const f = await sealedEvidenceFixture(); let reads = 0;
    await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => reads++ === 0 ? now : end })
      .readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_EVIDENCE_STALE"));
  }
});

test("exact drain fence/provision/Stack/expiry pins cannot be substituted", async () => {
  for (const [key, value] of [["admission_fence_sha256", "0".repeat(64)], ["admission_provision_operation_hash", "0".repeat(64)],
    ["admission_stack_id", "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/22345678-1234-1234-1234-123456789012"],
    ["admission_cell_expires_at", now - 60_001]] as const) {
    const f = await sealedEvidenceFixture(); f.results[1].rows[0][key] = value;
    await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now })
      .readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_ADMISSION_LINEAGE_MISMATCH"));
  }
  const f = await sealedEvidenceFixture();
  await assert.rejects(new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now })
    .readFreshZeroOwnershipEvidence({ predecessor: { ...f.predecessor, recordHash: "0".repeat(64) }, signal: signal() }));
  assert.equal(f.reads(), 0);
});

test("full raw ownership state is compared even when classified sets remain zero", async () => {
  const f = await prepared(); f.results[3].rows = []; f.results[4].rows = [];
  await assert.rejects(new SealedCellDeletionOwnershipEvidenceAdapterV3(f.source, { now: () => now })
    .prepareFreshDeletionPlan({ candidate: f.candidate, signal: signal() }), code("SEALED_V3_OWNERSHIP_STATE_DRIFT"));
});

test("every certificate pin affects the candidate and plan hash, and prevents cross-pin deletion evidence", async () => {
  const baseline = await prepared();
  const original = await new SealedCellDeletionOwnershipEvidenceAdapterV3(baseline.source, { now: () => now })
    .prepareFreshDeletionPlan({ candidate: baseline.candidate, signal: signal() });
  for (const key of ["original_row_sha256", "original_plan_bytes_sha256", "original_plan_hash", "business_state_sha256",
    "approved_registration_sha256", "protection_schema_sha256", "sealed_at"] as const) {
    const overrides: Partial<SealedPlanCertificateV1> = { [key]: key === "sealed_at" ? now - 120_001 : "0".repeat(64) };
    const changed = await prepared(await sealedEvidenceFixture(overrides));
    const deletion = new SealedCellDeletionOwnershipEvidenceAdapterV3(changed.source, { now: () => now });
    const newPlan = await deletion.prepareFreshDeletionPlan({ candidate: changed.candidate, signal: signal() });
    assert.notEqual(changed.candidate.recordSha256, baseline.candidate.recordSha256);
    assert.notEqual(newPlan.planSha256, original.planSha256);
    await assert.rejects(deletion.prepareFreshDeletionPlan({ candidate: baseline.candidate, signal: signal() }), code("SEALED_V3_OWNERSHIP_STATE_DRIFT"));
  }
});

test("candidate window, cleanup epoch, proof freshness and runtime overrides are bounded", async () => {
  const f = await prepared();
  for (const change of [{ cleanupEpoch: 1 }, { expiresAt: now }, { expiresAt: now + 3_600_001 }, { now: now + 30_001 }, { executorRoleArn: "other" }]) {
    await assert.rejects(compileSealedCellCleanupAuthorityCandidateV3({ ...f.input, ...change }));
  }
  const deletion = new SealedCellDeletionOwnershipEvidenceAdapterV3(f.source, { now: () => now + 60_000 });
  await assert.rejects(deletion.prepareFreshDeletionPlan({ candidate: f.candidate, signal: signal() }), code("SEALED_V3_AUTHORITY_EXPIRED"));
});

test("aborted and failed source reads cannot synthesize zero or expose a raw connection error", async () => {
  const f = await sealedEvidenceFixture(); const controller = new AbortController(); controller.abort();
  const adapter = new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now });
  await assert.rejects(adapter.readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: controller.signal }));
  assert.equal(f.reads(), 0);
  const failing = new SealedCellAuthorityOwnershipEvidenceAdapterV3({ async readCertifiedSerializableSnapshot() {
    throw new Error("postgres://sensitive-test-marker");
  } }, { now: () => now });
  await assert.rejects(failing.readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() }), code("SEALED_V3_SOURCE_READ_FAILED"));
});

test("v3 adapters are not an implicit schema2/legacy bridge", async () => {
  const f = await sealedEvidenceFixture();
  assert.throws(() => new SerializableSharedCellZeroTenantEvidenceAdapter(f.source as never));
  const adapter = new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source);
  assert.equal("readVerifiedZeroTenantEvidence" in adapter, false);
  assert.equal("execute" in new SealedCellDeletionOwnershipEvidenceAdapterV3(f.source), false);
});
