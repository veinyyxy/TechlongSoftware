import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { firstOpenNeonCoordinates, firstOpenNeonPort } from "../ops/aws-sandbox/first-open-entry/runner-neon.ts";
import { checkedRunnerPaths, firstOpenSameRunUpload } from "../ops/aws-sandbox/first-open-entry/runner-supply.ts";
import { inspectHost, renderRunOnceCapsule, type ReviewedRunOnceHostInputs } from "../ops/aws-sandbox/first-open-entry/runner-hosts.ts";
import { offlineHandoffArtifactName } from "../ops/aws-sandbox/first-open-oidc-offline.ts";
import { sealedFirstOpenHost } from "../ops/aws-sandbox/first-open-workflow-launcher.ts";

const backend = "b9ca2138738900afc23a6a2ddce141b37a1f0a31", artifact = "b7c566a772e6b6bfb58ed0dc250532a479d7789f";
const digest = "a".repeat(64);
const env = { NODE_ENV: "test" as const, RUNNER_OS: "Linux", RUNNER_ARCH: "X64", RUNNER_TEMP: tmpdir() };
const directoryCommit = (path: string) => basename(path) === ".first-open-backend" ? backend : artifact;

test("runner source is checked per role; unchecked ref and platform fail closed", () => {
  const observed: string[] = [], git = (path: string) => { observed.push(basename(path)); return directoryCommit(path); };
  const management = checkedRunnerPaths("management", env, process.cwd(), git);
  assert.equal(basename(management.pgRestore), "first-open-pg-restore");
  assert.equal(basename(management.workspace), "first-open-fc41597f-baseline");
  assert.deepEqual(observed.splice(0), [".first-open-backend"]);
  checkedRunnerPaths("runonce", env, process.cwd(), git);
  assert.deepEqual(observed.splice(0), [".first-open-artifact-action"]);
  checkedRunnerPaths("inspect", env, process.cwd(), git);
  assert.deepEqual(observed, [".first-open-backend", ".first-open-artifact-action"]);
  assert.throws(() => checkedRunnerPaths("management", env, process.cwd(), () => artifact), /BACKEND_COMMIT/);
  assert.throws(() => checkedRunnerPaths("runonce", env, process.cwd(), () => backend), /ARTIFACT_COMMIT/);
  assert.throws(() => checkedRunnerPaths("management", { ...env, RUNNER_ARCH: "ARM64" }, process.cwd(), git), /PATHS/);
});

test("same-run official uploader gets only the exact handoff and runtime context; no replay", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "first-open-supply-test-"));
  try {
    const e = { ...env, RUNNER_TEMP: tmp, ACTIONS_RUNTIME_TOKEN: "synthetic",
      ACTIONS_RESULTS_URL: "https://results-receiver.actions.githubusercontent.com/",
      GITHUB_RUN_ID: "111", FIRST_OPEN_ARTIFACT_NODE: process.execPath,
      FIRST_OPEN_PROTECTED_HOST_B64: "must-not-propagate", AWS_SESSION_TOKEN: "must-not-propagate" };
    const paths = checkedRunnerPaths("inspect", e, process.cwd(), directoryCommit);
    assert.throws(() => firstOpenSameRunUpload(paths, { ...e, ACTIONS_RESULTS_URL: "https://other.invalid/" }), /ARTIFACT_ENDPOINT/);
    let calls = 0;
    const name = offlineHandoffArtifactName(digest, "01-inspector-ready");
    let expectedName = name;
    const runUpload = async (exe: string, args: string[], options: import("node:child_process").ExecFileOptions) => {
      ++calls;
      assert.equal(exe, process.execPath);
      assert.deepEqual(args, [join(paths.artifact, "dist", "upload", "index.js")]);
      assert.equal(options.env?.ACTIONS_RUNTIME_TOKEN, "synthetic");
      assert.equal(options.env?.INPUT_NAME, expectedName);
      assert.equal(options.env?.INPUT_OVERWRITE, "false");
      assert.equal(options.env?.FIRST_OPEN_PROTECTED_HOST_B64, undefined);
      assert.equal(options.env?.AWS_SESSION_TOKEN, undefined);
      assert.equal(await readFile(options.env!.INPUT_PATH!, "utf8"), "{}");
      await writeFile(options.env!.GITHUB_OUTPUT!, "artifact-id<<ghadelimiter_2389ab\n123\nghadelimiter_2389ab\n");
    };
    const upload = firstOpenSameRunUpload(paths, e, runUpload);
    const input = { name, member: "handoff.json" as const, bytes: Buffer.from("{}"), signal: new AbortController().signal };
    await assert.rejects(upload({ ...input, bytes: Buffer.alloc(16_385) }), /ARTIFACT_SCOPE/);
    assert.deepEqual(await upload(input), { artifactId: "123" });
    await assert.rejects(upload(input), /ARTIFACT_SCOPE/);
    const unknown = firstOpenSameRunUpload(paths, e, async () => { ++calls; throw Error("network unknown"); });
    await assert.rejects(unknown(input), /ARTIFACT_UPLOAD_UNVERIFIED/);
    await assert.rejects(unknown(input), /ARTIFACT_SCOPE/);
    assert.equal(calls, 2);
    const request = offlineHandoffArtifactName(digest, "cfn-version-request");
    const relocked = offlineHandoffArtifactName(digest, "cfn-version-relocked");
    await assert.rejects(upload({ ...input, name: request }), /ARTIFACT_SCOPE/);
    expectedName = relocked;
    assert.deepEqual(await upload({ ...input, name: relocked }), { artifactId: "123" });
    const writer = firstOpenSameRunUpload(checkedRunnerPaths("runonce", e, process.cwd(), directoryCommit), e, runUpload);
    await assert.rejects(writer({ ...input, name: relocked }), /ARTIFACT_SCOPE/);
    expectedName = request;
    assert.deepEqual(await writer({ ...input, name: request }), { artifactId: "123" });
    assert.equal(calls, 4);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test("Neon role and exact RPC fence reject owner, TLS overrides and unrelated SQL without connecting", async () => {
  const url = "postgresql://first_onboarding_fc41597f_review:synthetic@ep-synthetic.c-1.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full";
  assert.equal(firstOpenNeonCoordinates("management", url).user, "first_onboarding_fc41597f_review");
  assert.throws(() => firstOpenNeonCoordinates("claim", url), /COORDINATES/);
  assert.throws(() => firstOpenNeonCoordinates("review", url.replace("verify-full", "disable")), /COORDINATES/);
  assert.throws(() => firstOpenNeonCoordinates("review", url.replace("first_onboarding_fc41597f_review", "neondb_owner")), /COORDINATES/);
  const port = firstOpenNeonPort("management", url, new AbortController().signal);
  await assert.rejects(port.query("SELECT 1", []), /STATEMENT/);
  await assert.rejects(port.query("SELECT techlong_first_onboarding_claim.review() AS result", []), /STATEMENT/);
  await port.dispose();
});

test("verified ESM can bind an exact role; missing RunOnce evidence stops before credentials", async () => {
  const src = Buffer.from("export const firstOpenHost = { inspect() { throw Error('not called'); } };");
  const h = createHash("sha256").update(src).digest("hex");
  assert.equal(typeof (await sealedFirstOpenHost(src.toString("base64"), "inspect", h)).inspect, "function");
  assert.equal(typeof inspectHost, "function");
  await assert.rejects(sealedFirstOpenHost(src.toString("base64"), "runonce", h), /SEALED_HOST_UNAVAILABLE/);
  const capsule = renderRunOnceCapsule({ approvedSha256: digest } as ReviewedRunOnceHostInputs);
  const capsuleSha = createHash("sha256").update(capsule).digest("hex");
  const { runonce: scope } = await sealedFirstOpenHost(capsule.toString("base64"), "runonce", capsuleSha);
  let credentials = 0;
  await assert.rejects(scope({ approvalSha256: digest, signal: new AbortController().signal,
    approval: {} as Parameters<typeof scope>[0]["approval"], seed: {} as Parameters<typeof scope>[0]["seed"], initialVersionId: digest,
    async credentials() { ++credentials; throw Error("unreachable"); } }), /RUNONCE_EVIDENCE/);
  assert.equal(credentials, 0);
});

test("workflows stage A and digest-pinned restore tools without exposing checkout credentials to other roles", async () => {
  const root = ".github/workflows/sandbox-first-open-";
  const [management, inspect, runonce, pg] = await Promise.all([
    readFile(root + "management-job-v1.yml", "utf8"), readFile(root + "inspect-job-v1.yml", "utf8"),
    readFile(root + "run-once-job-v1.yml", "utf8"), readFile("ops/aws-sandbox/first-open-entry/pg-restore.sh", "utf8")]);
  for (const yml of [management, inspect]) {
    assert.ok(yml.includes(backend));
    assert.ok(yml.includes("npm ci --prefix .first-open-backend --omit=dev --ignore-scripts"));
  }
  for (const yml of [runonce, inspect]) {
    assert.ok(yml.includes(artifact));
    assert.ok(yml.includes("uses: ./.github/actions/first-open-launch"));
  }
  const toolDigest = "sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b";
  assert.ok(management.includes(toolDigest) && pg.includes(toolDigest));
  assert.ok(pg.includes("--network none") && pg.includes("--pull=never") && pg.includes("--file=-") && pg.includes("dst=/baseline,readonly"));
  assert.ok(!runonce.includes(backend) && !runonce.includes("TECHLONG_FIRST_OPEN_BACKEND_READ_TOKEN") && !inspect.includes(toolDigest));
});
