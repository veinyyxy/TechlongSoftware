import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import { catalogSourceReaders, collectCatalogSource, catalogSourceIdentity, type CatalogSourceScope } from "../ops/releases/import-source.ts";
import { prepareCatalogRegistration, importCodeFiles } from "../ops/releases/import-review.ts";
import { writeCatalogRelease, inspectCatalogRelease } from "../ops/releases/catalog-transaction.ts";

async function checked() {
  const f = await releaseProductionFixture();
  return { ...f, candidate: await buildReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now) };
}

// Authenticated providers are synthetic here; this helper never invokes git/aws/network.
async function sourceFixture() {
  const f = await releaseProductionFixture();
  f.run.repository.full_name = catalogSourceIdentity.repository;
  f.policy.repository = catalogSourceIdentity.repository;
  f.policy.imageRepository = `${catalogSourceIdentity.accountId}.dkr.ecr.ca-central-1.amazonaws.com/${catalogSourceIdentity.ecrRepository}`;
  f.image.registryId = catalogSourceIdentity.accountId; f.image.repositoryName = catalogSourceIdentity.ecrRepository;
  const tag = `app-sha${f.run.head_sha}-r${f.run.id}-a1`;
  const scope: CatalogSourceScope = { schema: "techlong/catalog-source-read/v1", ...catalogSourceIdentity,
    nodeVersion: f.policy.nodeVersion, scannerVersion: f.policy.scannerVersion, scannerArchiveSha256: f.policy.scannerArchiveSha256,
    expiresAt: f.now + 3600_000 };
  const calls: { url: string; init?: RequestInit }[] = [], commands: string[][] = [];
  const controls = { identity: true, immutable: true, published: true, tag, redirect: "https://synthetic.blob.core.windows.net/artifact?signature=private-canary", zip: "synthetic-zip", tokenReads: 0 };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString(); calls.push({ url, init });
    if (url.includes("/workflows/")) return Response.json({ workflow_runs: [f.run] });
    if (url.includes("/runs/")) return Response.json({ total_count: 1, artifacts: [f.artifact] });
    if (url.includes("/artifacts/")) return new Response(null, { status: 302, headers: { location: controls.redirect } });
    assert.match(url, /^https:\/\/synthetic\.blob\.core\.windows\.net\//);
    assert.equal(init?.headers, undefined); return new Response(controls.zip);
  }) as typeof fetch;
  const command = async (args: string[]) => {
    commands.push(args); assert.equal(args[args.indexOf("--profile") + 1], "techlong-sandbox-user");
    assert.match(args[args.indexOf("--endpoint-url") + 1], /^https:\/\/(sts|api\.ecr)\.ca-central-1\.amazonaws\.com$/);
    if (args[0] === "sts") return JSON.stringify({ Account: catalogSourceIdentity.accountId,
      Arn: `arn:aws:iam::402010193138:${controls.identity ? "user/techlong-sandbox-dev" : "role/wrong"}` });
    if (args[1] === "describe-repositories") return JSON.stringify({ repositories: [{ registryId: catalogSourceIdentity.accountId,
      repositoryName: catalogSourceIdentity.ecrRepository, imageTagMutability: controls.immutable ? "IMMUTABLE" : "MUTABLE" }] });
    assert.equal(args[1], "batch-get-image");
    const input = JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
    return JSON.stringify({ images: controls.published ? [{ ...f.image, imageId: { ...f.image.imageId, ...(input.imageIds[0].imageTag ? { imageTag: controls.tag } : {}) } }] : [], failures: [] });
  };
  const readers = catalogSourceReaders(scope, async () => { controls.tokenReads++; return "synthetic-auth-canary"; }, fetcher, command, () => f.now);
  return { ...f, scope, calls, commands, controls, readers };
}
async function temporarySource<T>(fn: (root: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "release-source-test-"));
  try { return await fn(path.join(dir, "collection")); }
  finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^release-source-test-/);
    await rm(dir, { recursive: true });
  }
}
const codePins = () => importCodeFiles.map(file => ({ path: file, sha256: h("a") }));

test("release source: concrete reader collects exact app source/tag/manifest without inventing product identity", async () => {
  const f = await sourceFixture();
  await temporarySource(async root => {
    const result = await collectCatalogSource(f.scope, root, f.readers, () => f.now, async () => f.files);
    assert.equal(result.status, "SOURCE_AND_ECR_VERIFIED_PRODUCT_BINDING_PENDING");
    assert.equal(result.productBound, false); assert.equal(result.catalogWritten, false);
    assert.equal("productId" in result.build, false); assert.equal("version" in result.build, false);
    assert.deepEqual(result.counts, { sts: 1, ecr: 3, githubGets: 3, zipDownloads: 1, downloadedBytes: 13 });
    assert.equal(f.controls.tokenReads, 1); assert.equal(result.awsWrites, 0);
    const text = await readFile(path.join(root, "source-evidence.json"), "utf8");
    assert.equal(text.includes("synthetic-auth-canary"), false); assert.equal(text.includes("signature=private-canary"), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "run-metadata.json"), "utf8")), { workflow_runs: [f.run] });
    await assert.rejects(collectCatalogSource(f.scope, root, f.readers, () => f.now), /EEXIST/);
    assert.deepEqual(f.commands.map(c => c[1]), ["get-caller-identity", "describe-repositories", "batch-get-image", "batch-get-image"]);
  });
});

test("release source: failed fixed IAM identity stops before GitHub credential acquisition or ECR", async () => {
  const f = await sourceFixture(); f.controls.identity = false;
  await temporarySource(async root => {
    await assert.rejects(collectCatalogSource(f.scope, root, f.readers, () => f.now), /IDENTITY_REJECTED/);
    assert.equal(f.controls.tokenReads, 0); assert.equal(f.calls.length, 0); assert.equal(f.commands.length, 1);
    const stopped = JSON.parse(await readFile(path.join(root, "stopped.json"), "utf8"));
    assert.equal(stopped.automaticRetry, false); assert.equal(stopped.counts.zipDownloads, 0);
  });
});

test("release source: no rerun/expired artifact/mutable repository/wrong tag fallback and no large download", async () => {
  for (const kind of ["rerun", "expired", "mutable", "unpublished", "wrong-tag"]) {
    const f = await sourceFixture();
    if (kind === "rerun") f.run.run_attempt = 2;
    if (kind === "expired") f.artifact.expired = true;
    if (kind === "mutable") f.controls.immutable = false;
    if (kind === "unpublished") f.controls.published = false;
    if (kind === "wrong-tag") f.controls.tag += "-wrong";
    await temporarySource(async root => {
      await assert.rejects(collectCatalogSource(f.scope, root, f.readers, () => f.now, async () => f.files), /RELEASE_SOURCE_/);
      assert.equal(f.readers.counts.zipDownloads, 0); assert.equal(f.readers.counts.downloadedBytes, 0);
    });
  }
});

test("release source: signed ZIP host isolation, size/hash and create-only download are enforced", async () => {
  for (const kind of ["foreign-host", "changed-hash", "oversize", "existing-file"]) {
    const f = await sourceFixture();
    if (kind === "foreign-host") f.controls.redirect = "https://untrusted.example/artifact";
    if (kind === "changed-hash") f.controls.zip = "changed-bytes";
    if (kind === "oversize") f.controls.zip += "extra";
    await temporarySource(async root => {
      const destination = path.join(path.dirname(root), "input.zip");
      if (kind === "existing-file") await writeFile(destination, "original");
      await assert.rejects(f.readers.download(f.artifact, destination));
      assert.equal(f.readers.counts.zipDownloads, 1);
      await assert.rejects(f.readers.download(f.artifact, destination), /DOWNLOAD_REJECTED/);
      if (kind === "existing-file") assert.equal(await readFile(destination, "utf8"), "original");
      if (kind === "foreign-host") assert.equal(f.calls.length, 1);
    });
  }
});

test("release source: fixed read-only API allowlist and budgets reject writes, wrong scope and expired windows", async () => {
  const f = await sourceFixture();
  await assert.rejects(f.readers.read("ecr", "put-image", {}), /ECR_SCOPE_REJECTED/);
  await assert.rejects(f.readers.read("ecr", "batch-get-image", { registryId: "foreign" }), /ECR_SCOPE_REJECTED/);
  for (let i = 0; i < 5; i++) await f.readers.tag(f.controls.tag);
  await assert.rejects(f.readers.tag(f.controls.tag), /AWS_BUDGET/); assert.equal(f.commands.length, 5);
  for (let i = 0; i < 12; i++) await f.readers.runs();
  await assert.rejects(f.readers.runs(), /GITHUB_BUDGET/); assert.equal(f.calls.length, 12);
  assert.throws(() => catalogSourceReaders({ ...f.scope, expiresAt: f.now }, async () => "not-read", undefined, undefined, () => f.now), /WINDOW_REJECTED/);
  assert.throws(() => catalogSourceReaders({ ...f.scope, accountId: "foreign" } as unknown as CatalogSourceScope, async () => "not-read"), /SCOPE_REJECTED/);
});

test("release catalog review: explicit product policy binds sealed verified sources; no expiry extension or deployment permission", async () => {
  const f = await sourceFixture();
  await temporarySource(async root => {
    const source = await collectCatalogSource(f.scope, root, f.readers, () => f.now, async () => f.files);
    const review = await prepareCatalogRegistration(source, f.policy, path.join(root, "source-evidence.json"), h("b"), codePins(), f.now);
    assert.equal(review.release.productId, f.policy.productId); assert.equal(review.release.version, f.policy.version);
    assert.equal(review.validUntil, source.validUntil); assert.equal(review.runtimeEnabled, false);
    assert.equal(review.limits.catalogInsertSubmissions, 1); assert.equal(review.limits.connections, 2);
    assert.match(review.risks.join(" "), /NOT an entirely READ ONLY/);
    for (const policy of [{ ...f.policy, repositoryId: 999 }, { ...f.policy, imageRepository: "other" }, { ...f.policy, productId: "" }]) {
      await assert.rejects(prepareCatalogRegistration(source, policy, "source-evidence.json", h("b"), codePins(), f.now));
    }
    await assert.rejects(prepareCatalogRegistration(source, f.policy, "source-evidence.json", h("b"), codePins(), source.validUntil), /SOURCE_OR_POLICY_REJECTED/);
    await assert.rejects(prepareCatalogRegistration(source, f.policy, "source-evidence.json", h("b"), [], f.now), /SOURCE_OR_POLICY_REJECTED/);
  });
});

test("release catalog CLI: check/default cannot acquire credentials or connect even with ambient canaries", async () => {
  for (const args of [[], ["check"]]) {
    const result = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/instance-release-import.ts", ...args], {
      env: { ...process.env, GH_TOKEN: "canary", AWS_ACCESS_KEY_ID: "canary", DATABASE_URL: "canary" }, timeout: 10000,
    });
    assert.deepEqual(JSON.parse(result.stdout), { status: "CATALOG_IMPORT_DISABLED", credentialsUsed: false, productionCalls: 0 });
  }
});

test("release catalog transaction: temporary owner rights close before commit; unknown ACK never resubmits INSERT", async () => {
  const f = await checked(), release = await verifyPublishedRelease(f.candidate, f.registry, f.now);
  for (const mode of ["write", "inspect", "lost-commit", "wrong-target"]) {
    const calls: string[] = [];
    const sql: ReleaseSqlClient = { query: async (statement: string) => {
      calls.push(statement);
      if (statement.includes("'ownerAdmin'")) return { rows: [{ result: { user: "installer", session: "installer", super: false,
        createRole: true, setOwner: false, inheritOwner: false, ownerAdmin: true, schemaOid: 1, releasesOid: mode === "wrong-target" ? 3 : 2, owner: "deployment_release_owner", rls: false } }] };
      if (statement.startsWith("insert into") || statement.startsWith("select document")) return { rows: [{ result: release }] };
      if (statement === "COMMIT" && mode === "lost-commit") throw new Error("secret-provider-canary");
      if (statement.includes("'setOwner'")) return { rows: [{ result: { setOwner: false, inheritOwner: false } }] };
      return { rows: [] };
    } };
    const target = { installer: "installer", schemaOid: 1, releasesOid: 2 };
    if (mode === "wrong-target") { await assert.rejects(writeCatalogRelease(sql, release, target), /TARGET_OR_OWNER_REJECTED/); assert.equal(calls.some(s => s.startsWith("GRANT")), false); }
    else {
      if (mode === "lost-commit") await assert.rejects(writeCatalogRelease(sql, release, target), /TRANSACTION_REQUIRES_INSPECTION/);
      else await (mode === "inspect" ? inspectCatalogRelease : writeCatalogRelease)(sql, release, target);
      assert.ok(calls.indexOf("GRANT deployment_release_owner TO SESSION_USER WITH SET FALSE") < calls.indexOf("COMMIT"));
      assert.equal(calls.filter(s => s.startsWith("insert into")).length, mode === "inspect" ? 0 : 1);
      if (mode === "lost-commit") assert.equal(calls.includes("ROLLBACK"), false);
    }
  }
});
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
