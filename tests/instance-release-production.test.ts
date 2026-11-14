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
import { sealReleaseCandidate, preparePromotionIntent, promoteApprovedCandidate, assertPromotionBaseline,
  decodePromotionHandoff, derivePromotedPlan, type ReleasePromotionIntent } from "../lib/deployments/releases/promotion.ts";
import { prepareReleaseWorkflowJob, deployReleaseWorkflowJob } from "../lib/deployments/releases/workflow.ts";
import { releasePromotionPublisher, type PromotionCommand } from "../ops/releases/promotion-runtime.ts";
import { inspectInstanceRelease } from "../lib/deployments/releases/inspection.ts";
import { releaseReader } from "../lib/deployments/releases/sampling.ts";
import type { ReleaseEnvironmentConfig } from "../lib/deployments/releases/handoff.ts";

async function promotionFixture() {
  const f = await workflowFixture(), c = f.cycle, b = f.binding, p = await releaseProductionFixture();
  p.now = c.sql.now; p.artifact.expires_at = new Date(p.now + 86400_000).toISOString();
  p.receipt.osSecurityScan.databaseUpdatedAt = new Date(p.now - 3600_000).toISOString(); p.registry.observedAt = p.now; await p.repack();
  p.policy.repository = b.sourceRepository; p.run.repository.full_name = b.sourceRepository;
  const candidate = await sealReleaseCandidate(p.policy, p.run, p.artifact, p.files, p.now);
  f.job.releaseId = candidate.id;
  f.config.promotion = { roleArn: `arn:aws:iam::${b.accountId}:role/publisher`, database: { arn: "synthetic-publisher", versionId: "fixed", username: "deployment_release_publisher_login" },
    artifactToken: { arn: "synthetic-build-token", versionId: "fixed" }, sourceRepository: b.sourceRepository, sourceRepositoryId: p.policy.repositoryId, imageRepository: b.imageRepository };
  const context = c.sql.contexts.get(b.instanceId)!;
  context.releases = [context.releases.find(r => r.id === b.currentRelease!.id)!, candidate as unknown as SoftwareRelease];
  const baselineManifest = JSON.stringify({ schemaVersion: 2, config: { digest: "sha256:" + h("a") }, layers: [] });
  const baselineDigest = "sha256:" + await sha256Hex(baselineManifest);
  Object.assign(b.currentRelease!, { manifestDigest: baselineDigest, platformDigest: baselineDigest });
  Object.assign(context.releases[0].image, { manifestDigest: baselineDigest, platformDigest: baselineDigest });
  Object.assign(c.plan.from, { imageUri: b.imageRepository + "@" + baselineDigest, platformDigest: baselineDigest });
  const api = { ...f.api, read: async <T>(service: string, operation: string, input: Record<string, unknown>): Promise<T> => {
    if (operation !== "batch-get-image") return f.api.read<T>(service, operation, input);
    const ids = input.imageIds as { imageDigest: string }[];
    return (ids[0].imageDigest === baselineDigest ? { images: [{ imageId: { imageDigest: baselineDigest }, imageManifest: baselineManifest }] } : p.registry.root) as T;
  } };
  const repository = { context: c.plannerRepo.context.bind(c.plannerRepo), prepare: c.plannerRepo.prepare.bind(c.plannerRepo),
    recordDecision: c.plannerRepo.recordDecision.bind(c.plannerRepo), candidate: async () => candidate };
  const audit: string[] = [], controls = { failPublish: false, failConfirm: false, failAudit: "", pushes: 0 };
  const ports = { audit: async (kind: "intent" | "push" | "published" | "derived") => { audit.push(kind); if (kind === controls.failAudit) throw new Error("RELEASE_AUDIT_UNKNOWN"); },
    publish: async () => { controls.pushes++; if (controls.failPublish) throw new Error("RELEASE_PUSH_UNKNOWN"); return p.registry; },
    confirm: async (_sha: string, release: SoftwareRelease) => { if (controls.failConfirm) throw new Error("RELEASE_CATALOG_UNKNOWN");
      context.releases[1] = release; return release; } };
  return { ...f, api, p, candidate, repository, audit, promotionControls: controls, ports,
    sourceFacts: () => sampleInstanceRelease(b, context.releases[0], api, () => c.sql.now) };
}

test("release promotion: one preapproval intent binds checked bytes and baseline, without a fake registry digest or cloud mutation", async () => {
  const f = await promotionFixture();
  try {
    const previousRequests = f.cycle.sql.requests.size;
    const out = await prepareReleaseWorkflowJob(f.job, f.config, { repository: f.repository, api: f.api, now: () => f.cycle.sql.now });
    assert.equal(out.outputs.status, "PROMOTION_PLANNED"); assert.equal(f.cycle.sql.requests.size, previousRequests); assert.equal(f.audit.length, 0);
    const intent = await decodePromotionHandoff(out.outputs.handoff, out.outputs.handoff_sha, f.job, f.cycle.sql.now);
    assert.equal(intent.target.imageConfigDigest, f.candidate.build.imageConfigDigest);
    assert.equal("manifestDigest" in intent.target, false); assert.equal("platformDigest" in intent.target, false);
    assert.equal(intent.writeBefore, f.cycle.sql.now + 5 * 3600_000);
    assert.match(out.summary, /ONE environment approval/); assert.doesNotMatch(out.summary, /selfCheck|password|secret-canary/);
    await assert.rejects(decodePromotionHandoff(out.outputs.handoff, out.outputs.handoff_sha, { ...f.job, runId: "999" }, f.cycle.sql.now), /HANDOFF_REJECTED/);
    await assert.rejects(decodePromotionHandoff(out.outputs.handoff, out.outputs.handoff_sha, f.job, intent.writeBefore), /HANDOFF_REJECTED/);
  } finally { f.cycle.destroy(); }
});

test("release promotion: stopped, busy, incompatible or changed candidate baseline refuses all push/catalog/audit writes", async () => {
  for (const mode of ["stopped", "busy", "incompatible", "changed"]) {
    const f = await promotionFixture();
    try {
      if (mode === "stopped") f.controls.stopped = true;
      if (mode === "busy") f.cycle.sql.states.get(f.job.instanceId)!.active = "older-request";
      if (mode === "incompatible") f.candidate.policy.compatibility = { ...f.candidate.policy.compatibility, applicationPort: 9000 };
      if (mode === "changed") f.candidate.build.source.commit = "a".repeat(40);
      await assert.rejects(prepareReleaseWorkflowJob(f.job, f.config, { repository: f.repository, api: f.api, now: () => f.cycle.sql.now }), /RELEASE_/);
      assert.equal(f.promotionControls.pushes, 0); assert.equal(f.audit.length, 0); assert.equal(f.cycle.events.length, 0);
    } finally { f.cycle.destroy(); }
  }
});

test("release promotion: unknown audit/push/catalog ACK and wrong manifest stop before CFN, without upload retries", async () => {
  for (const mode of ["intent", "published", "push", "confirm", "manifest"]) {
    const f = await promotionFixture();
    try {
      const intent = await preparePromotionIntent(f.job, f.candidate, f.binding, await f.sourceFacts(), f.cycle.sql.now);
      if (["intent", "published"].includes(mode)) f.promotionControls.failAudit = mode;
      if (mode === "push") f.promotionControls.failPublish = true;
      if (mode === "confirm") f.promotionControls.failConfirm = true;
      if (mode === "manifest") f.p.image.imageManifest += "changed";
      await assert.rejects(promoteApprovedCandidate(f.candidate, intent, f.ports, () => f.cycle.sql.now));
      assert.equal(f.promotionControls.pushes, mode === "intent" ? 0 : 1); assert.equal(f.cycle.events.includes("CreateChangeSet"), false);
    } finally { f.cycle.destroy(); }
  }
});

test("release promotion: post-push source drift blocks the derived update; original approval deadline cannot grow", async () => {
  const f = await promotionFixture();
  try {
    const facts = await f.sourceFacts(), intent = await preparePromotionIntent(f.job, f.candidate, f.binding, facts, f.cycle.sql.now);
    const release = await promoteApprovedCandidate(f.candidate, intent, f.ports, () => f.cycle.sql.now);
    const plan = await derivePromotedPlan(intent, release, f.binding, facts, f.cycle.sql.now + 1000);
    assert.equal(plan.writeBefore, intent.writeBefore); assert.equal(plan.to.imageUri, `${release.image.repository}@${release.image.manifestDigest}`);
    await assert.rejects(derivePromotedPlan(intent, release, { ...f.binding, stateRevision: 99 }, facts, f.cycle.sql.now), /BASELINE_CHANGED/);
    await assert.rejects(assertPromotionBaseline(intent, f.candidate, f.binding, { ...facts, roleArn: "changed-role" }, f.cycle.sql.now), /CHANGED/);
    await assert.rejects(derivePromotedPlan(intent, release, f.binding, facts, intent.writeBefore), /EXPIRED/);
  } finally { f.cycle.destroy(); }
});

test("release promotion workflow: same protected-job path promotes, derives, updates, independently verifies and writes back", async () => {
  const f = await promotionFixture(), c = f.cycle;
  try {
    const prepared = await prepareReleaseWorkflowJob(f.job, f.config, { repository: f.repository, api: f.api, now: () => c.sql.now });
    const release = await verifyPublishedRelease(f.candidate.build, f.p.registry, c.sql.now);
    const api = f.api;
    const resolve = async (plan: typeof c.plan) => ({ binding: (await c.executorRepo.context(plan.selection.instanceId))!.binding, release });
    const reader = releaseReader(resolve, () => api, () => c.sql.now);
    let inspectionError = "";
    const result = await deployReleaseWorkflowJob(f.job, f.config, prepared.outputs.handoff, prepared.outputs.handoff_sha,
      { ...c.deps, reader, inspector: { inspect: async input => {
        try { return await inspectInstanceRelease(input, { repository: c.verifierRepo, reader: releaseReader(resolve, () => api, () => c.sql.now), evidence: c.evidence, now: () => c.sql.now }); }
        catch (error) { inspectionError = error instanceof Error ? error.message : "unknown"; throw error; }
      } } },
      { ports: f.ports, api: () => api, repository: { candidate: async () => f.candidate, preparePromoted: async (plan, sha) => {
        Object.assign(c.plan, plan); c.input.requestId = plan.selection.requestId;
        const params = f.raw().parameters;
        c.controls.changeSetPatch = cs => { for (const p of cs.Parameters ?? []) if (p.ParameterKey !== "ImageUri") p.ParameterValue = params[p.ParameterKey!]; };
        return c.plannerRepo.prepare(plan, sha);
      } } });
    assert.equal(result.status, "SUCCEEDED", JSON.stringify({ result, events: c.events, inspectionError })); assert.equal(f.promotionControls.pushes, 1);
    assert.deepEqual(f.audit, ["intent", "published", "derived"]);
    assert.equal(c.events.filter(e => e === "CreateChangeSet").length, 1); assert.equal(c.events.filter(e => e === "ExecuteChangeSet").length, 1);
    assert.equal((await c.executorRepo.context(f.job.instanceId))!.binding.currentRelease!.id, release.id);
  } finally { c.destroy(); }
});

test("release promotion runtime: real command serialization loads exact checked bytes, sends password only via stdin and pushes once", async () => {
  for (const mode of ["publish", "existing", "bad-load", "push-unknown", "bad-source", "used-slot"]) {
    const f = await sourceFixture();
    const candidate = await sealReleaseCandidate(f.policy, f.run, f.artifact, f.files, f.now);
    const calls: { binary: string; args: string[]; input?: string }[] = [], audits: string[] = [];
    let hasImage = mode === "existing";
    const execute: PromotionCommand = async (binary, args, env, input) => {
      calls.push({ binary, args, input });
      if (binary === "docker") {
        assert.equal(env.AWS_ACCESS_KEY_ID, undefined); assert.equal(env.GITHUB_TOKEN, undefined);
        assert.equal(["build", "run"].includes(args[0]), false);
        if (args[0] === "login") { assert.equal(input, "synthetic-ecr-password"); assert.equal(args.includes(input!), false); }
        if (args[0] === "push") { if (mode === "push-unknown") throw new Error("RELEASE_PUSH_UNKNOWN"); hasImage = true; }
        if (args[0] === "image") return JSON.stringify([{ Id: mode === "bad-load" ? "wrong" : candidate.build.imageConfigDigest,
          Os: "linux", Architecture: "amd64", Config: { Labels: { "org.opencontainers.image.revision": candidate.build.source.commit } } }]);
        return "";
      }
      assert.equal(env.AWS_MAX_ATTEMPTS, "1"); assert.equal(env.AWS_PROFILE, undefined);
      if (args[1] === "describe-repositories") return JSON.stringify({ repositories: [{ registryId: "402010193138", repositoryName: "techlong-sandbox-speedfeast", imageTagMutability: "IMMUTABLE" }] });
      if (args[1] === "get-login-password") { assert.equal(args.includes("--cli-input-json"), false); return "synthetic-ecr-password\n"; }
      assert.equal(args[1], "batch-get-image");
      if (!hasImage) return JSON.stringify({ images: [], failures: [{ failureCode: "ImageNotFound" }] });
      return JSON.stringify({ images: [{ ...f.image, imageId: { ...f.image.imageId, imageTag: f.controls.tag } }], failures: [] });
    };
    const config = { accountId: "402010193138", region: "ca-central-1", promotion: { sourceRepository: f.policy.repository,
      sourceRepositoryId: f.policy.repositoryId, imageRepository: f.policy.imageRepository }, evidence: { prefix: "releases" } } as ReleaseEnvironmentConfig;
    const intent = { candidateId: candidate.id, candidateSha256: candidate.candidateSha256, requestId: "test-request", writeBefore: f.now + 3600_000,
      target: { repository: f.policy.imageRepository, tag: f.controls.tag } } as ReleasePromotionIntent;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const name = String(url);
      if (name.endsWith(`/runs/${f.run.id}`)) return Response.json(mode === "bad-source" ? { ...f.run, run_attempt: 2 } : f.run);
      if (name.endsWith(`/artifacts/${f.artifact.id}`)) return Response.json(f.artifact);
      if (name.endsWith("/zip")) return new Response(null, { status: 302, headers: { location: "https://test.blob.core.windows.net/original" } });
      assert.equal(init?.headers, undefined); return new Response("synthetic-zip");
    }) as typeof fetch;
    await temporarySource(async root => {
      const publisher = releasePromotionPublisher(config, { accessKeyId: "synthetic", secretAccessKey: "synthetic", sessionToken: "synthetic", expiresAt: f.now + 7200_000 }, root,
        { token: async () => "synthetic-read-token", put: async key => { audits.push(key); if (mode === "used-slot") throw new Error("RELEASE_SLOT_USED"); } }, execute, fetcher, () => f.now, async () => f.files);
      if (["publish", "existing"].includes(mode)) assert.equal((await publisher.publish(candidate, intent)).root.images![0].imageId.imageDigest, f.image.imageId.imageDigest);
      else await assert.rejects(publisher.publish(candidate, intent), /RELEASE_/);
      assert.equal(calls.filter(c => c.binary === "docker" && c.args[0] === "push").length, ["publish", "push-unknown"].includes(mode) ? 1 : 0);
      assert.equal(audits.length, ["publish", "push-unknown", "used-slot"].includes(mode) ? 1 : 0);
      await assert.rejects(publisher.publish(candidate, intent), /SCOPE_REJECTED/);
    });
  }
});

test("release promotion installation: additive draft has no LOGIN, passwords, DML grants or expansion of the executor into catalog publisher", async () => {
  const raw = await readFile(new URL("../ops/releases/promotion.draft.sql", import.meta.url), "utf8");
  assert.equal((raw.match(/CREATE FUNCTION /g) ?? []).length, 3);
  assert.match(raw, /confirm_promotion\(text,text\) TO deployment_release_publisher/);
  assert.match(raw, /prepare_promoted_request\(text,text,text,text\) TO deployment_release_executor/);
  assert.doesNotMatch(raw, /CREATE ROLE \S+ LOGIN|PASSWORD '|GRANT (?:INSERT|UPDATE|DELETE|ALL)|DROP |TRUNCATE /);
  assert.match(raw, /SET FALSE;\s*COMMIT/);
  const yaml = await readFile(new URL("../.github/workflows/instance-release.yml", import.meta.url), "utf8");
  assert.equal((yaml.match(/environment: techlong-sandbox-deploy/g) ?? []).length, 1);
  assert.match(yaml, /PROMOTION_PLANNED/); assert.doesNotMatch(yaml, /workflow_call|workflow_run|backend-reviewed-ecr-publish/);
});

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
