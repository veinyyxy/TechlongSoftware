import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { buildReleaseCandidate, verifyPublishedRelease, readPublishedRelease } from "../lib/deployments/releases/production.ts";
import { registerVerifiedRelease } from "../lib/deployments/releases/catalog.ts";
import { ReleasePersistenceUnknown, type ReleaseSqlClient } from "../lib/deployments/releases/repository.ts";
import type { SoftwareRelease } from "../lib/deployments/releases/contract.ts";
import { planInstanceRelease } from "../lib/deployments/releases/planning.ts";
import { readCheckedBuildFiles } from "../ops/releases/build-artifact.ts";
import { releaseProductionFixture, h } from "./instance-release-fixture.ts";
import { workflowFixture } from "./instance-release-workflow-fixture.ts";
import { sampleInstanceRelease, sampledObservation } from "../lib/deployments/releases/sampling.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

async function checked() {
  const f = await releaseProductionFixture();
  return { ...f, candidate: await buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now) };
}
class CatalogSql implements ReleaseSqlClient {
  rows: SoftwareRelease[] = []; calls: string[] = []; loseAck = false;
  async query(statement: string, values: unknown[]) {
    this.calls.push(statement);
    if (statement.startsWith("insert into")) {
      const value = JSON.parse(values[4] as string) as SoftwareRelease;
      if (this.rows.some(r => r.id === value.id || r.productId === value.productId && r.component === value.component && r.version === value.version)) return { rows: [] };
      this.rows.push(value);
      if (this.loseAck) throw new Error("secret-canary-provider-error");
      return { rows: [{ result: value }] };
    }
    return { rows: this.rows.filter(r => r.id === values[0] || r.productId === values[1] && r.component === values[2] && r.version === values[3]).map(result => ({ result })) };
  }
}

test("release production: exact existing backend app artifact becomes a product candidate, never a deployable config digest", async () => {
  const f = await checked();
  assert.equal(f.candidate.status, "candidate"); assert.equal(f.candidate.executionAuthorized, false);
  assert.equal(f.candidate.imageConfigDigest, f.receipt.imageConfigDigest);
  assert.equal("manifestDigest" in f.candidate, false); assert.equal("instanceId" in f.candidate, false);
  assert.equal(f.candidate.source.artifactSha256, f.artifact.digest.slice(7));
  assert.deepEqual(f.candidate, await buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now + 1));
});

test("release production: failed/wrong/fork/rerun builds and wrong artifact source/ZIP/expiry are rejected", async () => {
  for (const patch of [{ conclusion: "failure" }, { run_attempt: 2 }, { path: ".github/workflows/backend-release.yml" }, { head_branch: "unreviewed" },
    { repository: { id: 43, full_name: "other/backend" } }, { head_repository: { id: 43 } }]) {
    const f = await releaseProductionFixture();
    await assert.rejects(buildReleaseCandidate(f.policy, { ...f.run, ...patch }, f.artifact, f.files, f.now), /RUN_REJECTED/);
  }
  for (const patch of [{ expired: true }, { expires_at: "invalid" }, { size_in_bytes: 1 }, { digest: `sha256:${h("b")}` },
    { name: "checked-lifecycle-other" }, { workflow_run: { id: 999, repository_id: 42, head_repository_id: 42, head_branch: "main", head_sha: "1".repeat(40) } }]) {
    const f = await releaseProductionFixture();
    await assert.rejects(buildReleaseCandidate(f.policy, f.run, { ...f.artifact, ...patch }, f.files, f.now), /ARTIFACT_REJECTED/);
  }
});

test("release production: exact checksum inventory and original receipt/self-check bytes are required", async () => {
  const f = await releaseProductionFixture();
  for (const checksums of ["", f.files.checksums + f.files.checksums.split("\n")[0], f.files.checksums.replace("image.tar.gz", "../image.tar.gz"),
    f.files.checksums.replace(f.files.archiveSha256, h("b"))]) {
    await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, { ...f.files, checksums }, f.now), /CHECKSUM_MISMATCH/);
  }
  await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, { ...f.files, selfCheck: "changed" }, f.now), /CHECKSUM_MISMATCH/);
});

test("release production: lifecycle, successful readiness, root identity and cloud-write claims are not app smoke proof", async () => {
  for (const patch of [{ kind: "lifecycle" }, { ecrPublished: true }, { registryManifestDigest: "sha256:foreign" }, { awsMutationPerformed: true }]) {
    const f = await releaseProductionFixture(); Object.assign(f.receipt, patch); await f.repack();
    await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now), /RECEIPT_REJECTED/);
  }
  for (const patch of [{ readyStatus: 200 }, { uid: 0 }, { network: "online" }, { cloudMutationPerformed: true }]) {
    const f = await releaseProductionFixture(); Object.assign(f.check, patch); await f.repack();
    await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now), /SELF_CHECK_REJECTED/);
  }
});

test("release production: HIGH findings, stale scanner DB and changed scanner identity fail; a compatibility claim cannot hide migration", async () => {
  for (const patch of [{ findingSeverityCounts: { HIGH: 1, CRITICAL: 0 } }, { ignoredFindingsAllowed: true },
    { databaseUpdatedAt: new Date(0).toISOString() }, { scannerArchiveSha256: h("e") }]) {
    const f = await releaseProductionFixture(); Object.assign(f.receipt.osSecurityScan, patch); await f.repack();
    await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now), /SCAN_REJECTED/);
  }
  const f = await releaseProductionFixture(); f.policy.compatibility.requiresMigration = true;
  await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now), /COMPATIBILITY_REQUIRED/);
});

test("release production: registry bytes and config digest produce an ECR version distinct from the Docker image ID", async () => {
  const f = await checked(), release = await verifyPublishedRelease(f.candidate, f.registry, f.now);
  assert.equal(release.status, "ecr_verified"); assert.equal(release.image.manifestDigest, f.image.imageId.imageDigest);
  assert.equal(release.image.platformDigest, release.image.manifestDigest);
  assert.notEqual(release.image.platformDigest, f.candidate.imageConfigDigest);
  assert.deepEqual(await verifyPublishedRelease(f.candidate, { ...f.registry, observedAt: f.now + 1 }, f.now + 1), release);
  await assert.rejects(verifyPublishedRelease(f.candidate, f.registry, f.candidate.validUntil), /FACTS_REJECTED/);
});

test("release production: OCI index requires the one exact amd64 child and its matching checked config", async () => {
  const f = await checked();
  const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: f.image.imageId.imageDigest, platform: { os: "linux", architecture: "amd64" } }] });
  const root = { ...f.image, imageId: { imageDigest: `sha256:${await sha256Hex(index)}` }, imageManifest: index };
  const readback = { observedAt: f.now, root: { images: [root] }, platform: f.registry.root };
  const release = await verifyPublishedRelease(f.candidate, readback, f.now);
  assert.equal(release.image.manifestDigest, root.imageId.imageDigest); assert.equal(release.image.platformDigest, f.image.imageId.imageDigest);
  await assert.rejects(verifyPublishedRelease(f.candidate, { observedAt: f.now, root: readback.root }, f.now), /PLATFORM_REJECTED/);
  const wrong = structuredClone(readback); wrong.platform.images[0].imageId.imageDigest = `sha256:${h("b")}`;
  await assert.rejects(verifyPublishedRelease(f.candidate, wrong, f.now), /BYTES_MISMATCH/);
});

test("release production: foreign registry, altered raw manifest/config, extra image and stale observations never verify", async () => {
  for (const change of [(r: Awaited<ReturnType<typeof checked>>["registry"]) => { r.root.images[0].registryId = "222222222222"; },
    (r: Awaited<ReturnType<typeof checked>>["registry"]) => { r.root.images[0].imageManifest += " "; },
    (r: Awaited<ReturnType<typeof checked>>["registry"]) => { r.root.images.push(r.root.images[0]); }]) {
    const f = await checked(); change(f.registry); await assert.rejects(verifyPublishedRelease(f.candidate, f.registry, f.now), /REGISTRY_/);
  }
  const f = await checked();
  await assert.rejects(verifyPublishedRelease({ ...f.candidate, imageConfigDigest: `sha256:${h("b")}` }, f.registry, f.now), /CONFIG_MISMATCH/);
  await assert.rejects(verifyPublishedRelease(f.candidate, { ...f.registry, observedAt: f.now - 5 * 3600_000 }, f.now), /FACTS_REJECTED/);
});

test("release production: normal ECR adapter reads by exact digest, no tags/push/extra registry calls", async () => {
  const f = await checked(), calls: unknown[] = [];
  const release = await readPublishedRelease(f.candidate, f.image.imageId.imageDigest, { read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
    calls.push({ service, operation, input }); return f.registry.root as T;
  } }, () => f.now);
  assert.equal(release.status, "ecr_verified");
  assert.deepEqual(calls, [{ service: "ecr", operation: "batch-get-image", input: { registryId: "111111111111", repositoryName: "example-api", imageIds: [{ imageDigest: f.image.imageId.imageDigest }] } }]);
  await assert.rejects(readPublishedRelease(f.candidate, "latest", { read: async () => { throw Error("must not call"); } }, () => f.now), /REFERENCE_REJECTED/);
  const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: f.image.imageId.imageDigest, platform: { os: "linux", architecture: "amd64" } }] });
  const indexImage = { ...f.image, imageId: { imageDigest: `sha256:${await sha256Hex(index)}` }, imageManifest: index }, digests: string[] = [];
  const multi = await readPublishedRelease(f.candidate, indexImage.imageId.imageDigest, { read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
    assert.equal(service, "ecr"); assert.equal(operation, "batch-get-image");
    const requested = (input.imageIds as { imageDigest: string }[])[0].imageDigest; digests.push(requested);
    return { images: [requested === indexImage.imageId.imageDigest ? indexImage : f.image] } as T;
  } }, () => f.now);
  assert.deepEqual(digests, [indexImage.imageId.imageDigest, f.image.imageId.imageDigest]);
  assert.equal(multi.image.platformDigest, f.image.imageId.imageDigest);
});

test("release production: output projection excludes canary environment/secrets and cannot leak malformed JSON", async () => {
  const f = await releaseProductionFixture();
  Object.assign(f.receipt, { environment: { PASSWORD: "secret-canary" } });
  Object.assign(f.policy.compatibility, { credentials: "secret-canary" }); await f.repack();
  const candidate = await buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now);
  const release = await verifyPublishedRelease(candidate, f.registry, f.now);
  assert.doesNotMatch(JSON.stringify({ candidate, release }), /secret-canary|PASSWORD|credentials/);
  const receipt = "{ secret-canary-invalid-json";
  const checksums = `${f.files.archiveSha256}  image.tar.gz\n${await sha256Hex(receipt)}  candidate-receipt.json\n${await sha256Hex(f.files.selfCheck)}  self-check.json\n`;
  await assert.rejects(buildReleaseCandidate(f.policy, f.run, f.artifact, { ...f.files, receipt, checksums }, f.now),
    (error: Error) => error.message === "RELEASE_BUILD_JSON_INVALID");
});

test("release catalog: one atomic INSERT, exact duplicate is reusable, different bytes or revoked version never overwrite", async () => {
  const f = await checked(), release = await verifyPublishedRelease(f.candidate, f.registry, f.now), sql = new CatalogSql();
  assert.equal(await registerVerifiedRelease(sql, release), "REGISTERED");
  assert.equal(await registerVerifiedRelease(sql, release), "ALREADY_REGISTERED");
  await assert.rejects(registerVerifiedRelease(sql, { ...release, image: { ...release.image, platformDigest: `sha256:${h("a")}` } }), /VERSION_CONFLICT/);
  assert.equal(sql.rows.length, 1); assert.deepEqual(sql.rows[0], release);
  sql.rows[0].status = "revoked";
  await assert.rejects(registerVerifiedRelease(sql, release), /VERSION_CONFLICT/);
  assert.equal(sql.rows[0].status, "revoked");
});

test("release catalog: lost INSERT ACK is unknown with no retry or read-based claim that rollback happened", async () => {
  const f = await checked(), release = await verifyPublishedRelease(f.candidate, f.registry, f.now), sql = new CatalogSql(); sql.loseAck = true;
  await assert.rejects(registerVerifiedRelease(sql, release), ReleasePersistenceUnknown);
  assert.equal(sql.calls.length, 1); assert.equal(sql.rows.length, 1);
  await assert.rejects(registerVerifiedRelease(sql, { ...release, status: "candidate" }), /VERIFIED_ONLY/);
  assert.equal(sql.calls.length, 1);
});

test("release production: one built version supplies two initialized instances through the unchanged ImageUri planner", async () => {
  const f = await checked(), release = await verifyPublishedRelease(f.candidate, f.registry, f.now);
  const sql = new CatalogSql(); await registerVerifiedRelease(sql, release);
  const w = await workflowFixture(); const binding = structuredClone(w.binding); binding.sourceRepository = release.source.repository;
  const facts = await sampleInstanceRelease(w.binding, w.cycle.planningInput.release, w.api, () => w.cycle.sql.now);
  const observation = await sampledObservation(binding, facts);
  for (const instanceId of ["app_first", "app_second"]) {
    const result = await planInstanceRelease({ binding: { ...binding, instanceId }, observation: { ...observation, instanceId }, release,
      selection: { requestId: "request_" + instanceId, requestedBy: "operator", workspaceId: binding.workspaceId, instanceId,
        environmentId: binding.environmentId, releaseId: release.id }, now: observation.observedAt + 1 });
    assert.equal(result.status, "PLANNED");
    if (result.status === "PLANNED") assert.equal(result.plan.to.imageUri, release.image.repository + "@" + release.image.manifestDigest);
  }
});

// Small stored ZIP fixture: extraction itself uses Python's standard zipfile, not this writer.
function zipMembers(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), bytes = Buffer.from(name); let crc = 0xffffffff;
    for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(bytes.length, 26);
    parts.push(local, bytes, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(bytes.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, bytes); offset += local.length + bytes.length + data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

test("release artifact files: original ZIP hash precedes fixed four-file extraction; occupied output is not overwritten", { skip: process.platform === "win32" }, async () => {
  const f = await releaseProductionFixture(), dir = await mkdtemp(path.join(os.tmpdir(), "release-candidate-test-"));
  try {
    const zip = zipMembers({ "image.tar.gz": "synthetic-image", "candidate-receipt.json": f.files.receipt, "self-check.json": f.files.selfCheck, SHA256SUMS: f.files.checksums });
    const artifact = { ...f.artifact, digest: "sha256:" + createHash("sha256").update(zip).digest("hex"), size_in_bytes: zip.length };
    const input = path.join(dir, "input.zip"), output = path.join(dir, "checked"); await writeFile(input, zip);
    const files = await readCheckedBuildFiles(artifact, input, output);
    assert.equal((await buildReleaseCandidate(f.policy, f.run, artifact, files, f.now)).status, "candidate");
    await assert.rejects(readCheckedBuildFiles(artifact, input, output), /EXTRACTION_FAILED/);
    await assert.rejects(readCheckedBuildFiles({ ...artifact, digest: "sha256:" + h("a") }, input, path.join(dir, "uncreated")), /ZIP_MISMATCH/);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^release-candidate-test-/);
    await rm(dir, { recursive: true });
  }
});
