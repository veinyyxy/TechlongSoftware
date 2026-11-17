import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { releaseProductionFixture, h } from "./instance-release-fixture.ts";
import { workflowEnvironment } from "./instance-release-workflow-fixture.ts";
import { sealReleaseCandidate } from "../lib/deployments/releases/promotion.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { bootstrapCodeFiles, candidateSummary, validateBootstrapReview, assertBootstrapJob, publishInitialA,
  prepareBootstrapRegistration, registerBootstrapCatalog, type BootstrapReview, type BootstrapJob } from "../ops/releases/bootstrap.ts";
import { releasePromotionPublisher, type PromotionCommand } from "../ops/releases/promotion-runtime.ts";
import type { ReleaseSqlClient } from "../lib/deployments/releases/repository.ts";

async function fixture(currentNow?: number) {
  const a = await releaseProductionFixture(), b = await releaseProductionFixture();
  for (const [f, label, runId] of [[a, "a", 100], [b, "b", 101]] as const) {
    if (currentNow) { f.now = currentNow; f.registry.observedAt = currentNow; f.artifact.expires_at = new Date(currentNow + 86400000).toISOString(); f.receipt.osSecurityScan.databaseUpdatedAt = new Date(currentNow).toISOString(); }
    f.policy.repository = "veinyyxy/SpeedFeast_Backend_main"; f.policy.repositoryId = 1064124445;
    f.policy.imageRepository = "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast";
    f.policy.version = "bootstrap-test-" + label;
    f.run.id = runId; f.run.repository = { id: 1064124445, full_name: f.policy.repository }; f.run.head_repository.id = 1064124445;
    f.artifact.workflow_run = { ...f.artifact.workflow_run, id: runId, repository_id: 1064124445, head_repository_id: 1064124445 };
    f.artifact.name = `checked-app-${f.run.head_sha}-${runId}-1`; f.artifact.id = runId + 200;
    f.receipt.runId = String(runId);
    if (label === "b") { f.receipt.imageConfigDigest = "sha256:" + h("8"); f.receipt.osSecurityScan.imageConfigDigest = f.receipt.imageConfigDigest; }
    f.image.registryId = "402010193138"; f.image.repositoryName = "techlong-sandbox-speedfeast";
    await f.repack();
  }
  const ca = await sealReleaseCandidate(a.policy, a.run, a.artifact, a.files, a.now), cb = await sealReleaseCandidate(b.policy, b.run, b.artifact, b.files, b.now);
  const e = workflowEnvironment(); Object.assign(e, { accountId: "402010193138", repositoryId: "1323312747",
    deploySubject: "repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy",
    evidence: { owner: "402010193138", bucket: "techlong-sandbox-cloud-worker-evidence-402010193138", prefix: "instance-releases" },
    promotion: { roleArn: "arn:aws:iam::402010193138:role/TechlongSandboxInstanceReleasePublisherRole", database: e.database.planner,
      sourceRepository: a.policy.repository, sourceRepositoryId: 1064124445, imageRepository: a.policy.imageRepository,
      artifactToken: { arn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/instance-release/backend-build-read-token-v1-abcdef", versionId: "1".repeat(32) } } });
  const code = bootstrapCodeFiles.map(path => ({ path, sha256: h("a") }));
  const review: BootstrapReview = { schema: "techlong/instance-release-bootstrap-review/v1", enabled: true,
    repository: "veinyyxy/TechlongSoftware", environment: e, observedAt: a.now, writeBefore: a.now + 3600000,
    codeArtifacts: code, a: candidateSummary(ca), b: candidateSummary(cb) };
  const sha = await sha256Hex(review), job: BootstrapJob = { repository: review.repository, repositoryId: e.repositoryId,
    runId: "123456", runAttempt: 1, sourceSha: "1".repeat(40), ref: "refs/heads/main", event: "workflow_dispatch",
    actor: "operator", actorId: String(e.reviewerId), workflowRef: `${review.repository}/.github/workflows/instance-release-bootstrap.yml@refs/heads/main` };
  const events: string[] = [];
  const ports = { audit: async (kind: string) => { events.push(kind); }, publish: async (c: unknown) => { assert.deepEqual(c, review.a); events.push("publish-A"); return a.registry; } };
  return { a, b, ca, cb, review, sha, job, code, events, ports };
}

test("bootstrap: closed default/check/publish never uses ambient canaries or changes daily runtime", async () => {
  for (const args of [[], ["check"], ["publish"]]) {
    const r = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/instance-release-bootstrap.ts", ...args],
      { env: { ...process.env, DATABASE_URL: "canary", AWS_ACCESS_KEY_ID: "canary", RELEASE_BOOTSTRAP_REVIEW_SHA: "canary" }, timeout: 10000 });
    assert.deepEqual(JSON.parse(r.stdout), { status: "BOOTSTRAP_PUBLICATION_NOT_EXECUTED", enabled: false, credentialsUsed: false, productionCalls: 0 });
  }
  const runtime = JSON.parse(await readFile("ops/releases/runtime.json", "utf8")); assert.equal(runtime.enabled, false); assert.deepEqual(runtime.environments, {});
  assert.equal(await sha256Hex((await readFile(".github/workflows/instance-release.yml", "utf8")).replaceAll("\r\n", "\n")), "b31f33aed8a000876385e1cf8a0001d3e1157bc8ea7863002262600b509fadff");
});

test("bootstrap: review binds only the distinct original pair, authority, source code and original deadline", async () => {
  const f = await fixture(); await validateBootstrapReview(f.review, f.sha, f.code, f.a.now); assertBootstrapJob(f.job, f.review);
  assert.equal("files" in f.review.a, false); assert.equal("instanceId" in f.job, false);
  for (const mutation of ["approval", "code", "expiry", "role", "candidate", "pair"]) {
    const r = structuredClone(f.review); let code = f.code, sha = f.sha, now = f.a.now;
    if (mutation === "approval") sha = h("b");
    if (mutation === "code") code = f.code.map(c => ({ ...c, sha256: h("b") }));
    if (mutation === "expiry") now = r.writeBefore;
    if (mutation === "role") r.environment.promotion!.roleArn = "arn:aws:iam::402010193138:role/wrong";
    if (mutation === "candidate") r.a.candidateSha256 = h("b");
    if (mutation === "pair") r.b = r.a;
    if (!["approval", "code", "expiry"].includes(mutation)) sha = await sha256Hex(r);
    await assert.rejects(validateBootstrapReview(r, sha, code, now), /RELEASE_BOOTSTRAP_/);
  }
  for (const patch of [{ runAttempt: 2 }, { actorId: "wrong" }, { event: "push" }, { workflowRef: f.job.workflowRef.replace("bootstrap", "other") }])
    assert.throws(() => assertBootstrapJob({ ...f.job, ...patch }, f.review), /JOB_REJECTED/);
});

test("bootstrap: only A publishes; B stays a candidate, real manifests derive A without an active instance", async () => {
  const f = await fixture(), publication = await publishInitialA(f.review, f.sha, f.job, f.ports, () => f.a.now);
  assert.deepEqual(f.events, ["intent", "publish-A", "published"]);
  assert.equal(publication.release.status, "ecr_verified"); assert.equal(publication.status, "A_PUBLISHED_CATALOG_NOT_WRITTEN");
  const input = { review: f.review, reviewSha256: f.sha, publication, b: f.cb };
  const plan = await prepareBootstrapRegistration(input, { path: "private/input.json", rawSha256: h("a") }, f.a.now);
  assert.equal(plan.a.id, f.ca.id); assert.equal(plan.b.id, f.cb.id); assert.equal(plan.b.status, "candidate");
  assert.equal(plan.limits.catalogRows, 2); assert.equal(plan.limits.connections, 2); assert.equal(plan.writeBefore, f.review.writeBefore);
  const changed = structuredClone(publication); changed.readback.root.images![0].imageManifest += " ";
  await assert.rejects(prepareBootstrapRegistration({ ...input, publication: changed }, { path: "x", rawSha256: h("a") }, f.a.now), /RELEASE_REGISTRY_/);
  await assert.rejects(prepareBootstrapRegistration({ ...input, b: f.ca }, { path: "x", rawSha256: h("a") }, f.a.now), /CATALOG_SOURCE_CHANGED/);
});

test("bootstrap: unknown publication audit/push stops without retry, catalog, B publication or workload actions", async () => {
  for (const at of ["intent", "publish", "published"]) {
    const f = await fixture(); let pushes = 0;
    const ports = { audit: async (kind: string) => { if (kind === at) throw new Error("UNKNOWN_ACK"); },
      publish: async () => { pushes++; if (at === "publish") throw new Error("UNKNOWN_PUSH"); return f.a.registry; } };
    await assert.rejects(publishInitialA(f.review, f.sha, f.job, ports, () => f.a.now), /UNKNOWN/);
    assert.equal(pushes, at === "intent" ? 0 : 1);
  }
});

test("bootstrap: shared publisher validates downloaded original without committed receipt bodies and refuses occupied tags", async () => {
  for (const occupied of [false, true]) {
    const f = await fixture(), root = await mkdtemp(path.join(os.tmpdir(), "bootstrap-image-test-")); let hasImage = occupied;
    const commands: string[] = [];
    const execute: PromotionCommand = async (binary, args) => {
      commands.push(binary + " " + args[0]);
      if (binary === "docker") {
        assert.ok(!["build", "run"].includes(args[0]));
        if (args[0] === "push") hasImage = true;
        if (args[0] === "image") return JSON.stringify([{ Id: f.ca.build.imageConfigDigest, Os: "linux", Architecture: "amd64", Config: { Labels: { "org.opencontainers.image.revision": f.a.run.head_sha } } }]);
        return "";
      }
      if (args[1] === "describe-repositories") return JSON.stringify({ repositories: [{ registryId: "402010193138", repositoryName: "techlong-sandbox-speedfeast", imageTagMutability: "IMMUTABLE" }] });
      if (args[1] === "get-login-password") return "synthetic-ecr-password";
      return JSON.stringify(hasImage ? { images: [{ ...f.a.image, imageId: { ...f.a.image.imageId, imageTag: `app-sha${f.a.run.head_sha}-r${f.a.run.id}-a1` } }], failures: [] } : { images: [], failures: [{ failureCode: "ImageNotFound" }] });
    };
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const s = String(url);
      if (s.endsWith(`/runs/${f.a.run.id}`)) return Response.json(f.a.run);
      if (s.endsWith(`/artifacts/${f.a.artifact.id}`)) return Response.json(f.a.artifact);
      if (s.endsWith("/zip")) return new Response(null, { status: 302, headers: { location: "https://test.blob.core.windows.net/original" } });
      assert.equal(init?.headers, undefined); return new Response("synthetic-zip");
    }) as typeof fetch;
    const publisher = releasePromotionPublisher(f.review.environment, { accessKeyId: "synthetic", secretAccessKey: "synthetic", sessionToken: "synthetic", expiresAt: f.review.writeBefore }, path.join(root, "image"),
      { token: async () => "synthetic", put: async () => {} }, execute, fetcher, () => f.a.now, async () => f.a.files, true);
    try {
      if (occupied) await assert.rejects(publishInitialA(f.review, f.sha, f.job, publisher, () => f.a.now), /TAG_OCCUPIED/);
      else await publishInitialA(f.review, f.sha, f.job, publisher, () => f.a.now);
      assert.equal(commands.filter(c => c === "docker push").length, occupied ? 0 : 1);
    } finally { assert.equal(path.dirname(root), os.tmpdir()); await rm(root, { recursive: true }); }
  }
});

test("bootstrap: two-row writer closes before independent inspection; unknown COMMIT never inserts/retries the next row", async () => {
  for (const mode of ["success", "lost-a", "lost-b", "candidate-conflict"]) {
    const f = await fixture(), pub = await publishInitialA(f.review, f.sha, f.job, f.ports, () => f.a.now);
    const rows = new Map<string, unknown>(), events: string[] = [], queries: string[] = []; let lastId = "";
    const connect = async (label: string) => {
      events.push("open-" + label);
      const sql: ReleaseSqlClient = { query: async (text, values = []) => {
        queries.push(text);
        if (text.includes("'ownerAdmin'")) return { rows: [{ result: { user: "installer", session: "installer", super: false, createRole: true,
          setOwner: false, inheritOwner: false, ownerAdmin: true, schemaOid: 1, releasesOid: 2, owner: "deployment_release_owner", rls: false } }] };
        if (text.startsWith("insert into")) {
          lastId = values[0] as string; if (mode === "candidate-conflict" && lastId === f.cb.id) return { rows: [] };
          const doc = JSON.parse(values.at(-1) as string); rows.set(lastId, doc); return { rows: [{ result: doc }] };
        }
        if (text === "COMMIT" && label === "writer" && (mode === "lost-a" && lastId === f.ca.id || mode === "lost-b" && lastId === f.cb.id)) throw new Error("secret-canary-unknown-ack");
        if (text.startsWith("select document")) return { rows: rows.has(values[0] as string) ? [{ result: rows.get(values[0] as string) }] : [] };
        if (text.includes("'setOwner'")) return { rows: [{ result: { setOwner: false, inheritOwner: false } }] };
        return { rows: [] };
      } };
      return { sql, close: async () => { events.push("close-" + label); } };
    };
    const result = await registerBootstrapCatalog(pub.release, f.cb, { installer: "installer", schemaOid: 1, releasesOid: 2 }, connect, () => f.a.now);
    assert.equal(result.status, mode === "success" ? "A_AND_B_CATALOG_INDEPENDENTLY_VERIFIED" : "STOPPED_REQUIRES_INSPECTION");
    assert.equal(result.attempted, mode === "lost-a" ? 1 : 2);
    assert.equal(queries.filter(q => q.startsWith("insert into")).length, mode === "lost-a" ? 1 : 2);
    assert.ok(queries.length <= 64); assert.ok(events.indexOf("close-writer") < events.indexOf("open-inspection"));
    if (mode === "lost-a") { assert.equal(rows.has(f.cb.id), false); assert.equal(result.inspections.length, 1); assert.notEqual(result.code, null); }
  }
});

test("bootstrap workflow: one manual protected publish job, no automatic trigger or runtime activation", async () => {
  const yaml = createRequire(import.meta.url)("js-yaml"), workflow = yaml.load(await readFile(".github/workflows/instance-release-bootstrap.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]); assert.deepEqual(Object.keys(workflow.jobs), ["publish"]);
  assert.equal(workflow.jobs.publish.environment, "techlong-sandbox-deploy"); assert.equal(workflow.jobs.publish["timeout-minutes"], 25);
  const runs = workflow.jobs.publish.steps.map((s: { run?: string }) => s.run ?? "").join("\n");
  assert.match(runs, /instance-release-bootstrap.ts publish/); assert.doesNotMatch(runs, /instance-release.ts deploy|cloudformation|docker build|db:migrate/);
});

test("bootstrap catalog CLI: preparation is local-only; wrong approval stops before config or attempt creation", async () => {
  const f = await fixture(Date.now());
  f.review.codeArtifacts = await Promise.all(bootstrapCodeFiles.map(async path => ({ path, sha256: await sha256Hex((await readFile(path, "utf8")).replaceAll("\r\n", "\n")) })));
  f.sha = await sha256Hex(f.review);
  const publication = await publishInitialA(f.review, f.sha, f.job, f.ports, () => f.a.now);
  const parent = path.resolve(".local-secrets"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, "bootstrap-cli-test-"));
  const input = path.join(root, "input.json"), output = path.join(root, "review.json");
  try {
    await writeFile(input, JSON.stringify({ review: f.review, reviewSha256: f.sha, publication, b: f.cb }), { flag: "wx" });
    const done = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/instance-release-import.ts", "prepare-bootstrap", input, output], { timeout: 10000 });
    assert.equal(JSON.parse(done.stdout).productionCalls, 0);
    const review = JSON.parse(await readFile(output, "utf8")); assert.equal(review.a.status, "ecr_verified"); assert.equal(review.b.status, "candidate");
    await assert.rejects(promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/instance-release-import.ts", "register-bootstrap", output, h("a")],
      { env: { ...process.env, DATABASE_URL: "must-not-read" }, timeout: 10000 }), (e: unknown) => {
      assert.match((e as { stderr: string }).stderr, /RELEASE_IMPORT_EXPLICIT_SHA_REQUIRED/); return true;
    });
    assert.deepEqual((await readdir(root)).sort(), ["input.json", "review.json"]);
  } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true }); }
});
