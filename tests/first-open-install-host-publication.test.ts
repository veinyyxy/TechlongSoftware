import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { verifyFirstOpenInstallSealedPublication } from "../ops/aws-sandbox/first-open-install-host-publication.ts";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const gitSha = (kind: string, value: Buffer) => createHash("sha1").update(`${kind} ${value.length}\0`).update(value).digest("hex");
const target = "refs/heads/main", remote = "https://github.com/veinyyxy/TechlongSoftware.git";
const simulatedOperator = "offline_fixture_not_a_real_github_credential";
const base = "1".repeat(40), prior = "2".repeat(40), runtimeTree = "3".repeat(40), callerTree = "4".repeat(40);
const commit = (tree: string, parent: string) => Buffer.from(`tree ${tree}\nparent ${parent}\n\nfixture\n`);
const runtimeBytes = commit(runtimeTree, prior), runtime = gitSha("commit", runtimeBytes);
const callerBytes = commit(callerTree, runtime), caller = gitSha("commit", callerBytes);
const blob = Buffer.from("synthetic sealed projection blob\n"), gitBlob = gitSha("blob", blob);
const sealDir = ".local-secrets/fc41597f-slot2-readback-policy-seal-v1", gitDir = `${sealDir}/objects.git`;
const hostInput = "export const synthetic = true;\n";

async function fixture(t: TestContext, options: { head?: string; pushAck?: string; changedInput?: boolean; historyIsAncestor?: boolean;
  ambientEnv?: Readonly<Record<string, string>> } = {}) {
  const tempRoot = await realpath(tmpdir()), root = await mkdtemp(join(tempRoot, "fc41597f-pub-fixture-"));
  t.after(async () => {
    assert.equal(dirname(await realpath(root)), tempRoot);
    await rm(root, { recursive: true });
  });
  await mkdir(join(root, gitDir, "objects"), { recursive: true });
  await mkdir(join(root, "ops/aws-sandbox"), { recursive: true });
  await writeFile(join(root, gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n");
  const closure = Array.from({ length: 160 }, (_, n) => ({ path: `file-${n}`, gitBlob, sha256: sha(blob) }));
  const installer = Array.from({ length: 8 }, (_, n) => ({ path: `ops/aws-sandbox/installer-${n}.ts`, sha256Utf8Lf: sha(hostInput) }));
  for (const [i, pin] of installer.entries()) await writeFile(join(root, pin.path), options.changedInput && i === 0 ? "changed\n" : hostInput);
  const projectionSha256 = sha(JSON.stringify(closure));
  const sealed = JSON.stringify({ schema: "techlong/fc41597f-slot2-install-source-projection/v1", base, runtime, caller,
    sourceProjectionSha256Utf8Lf: projectionSha256, gitDir, previousOfflineRuntime: prior, runtimeTree, callerTree,
    unpublished: true, refUpdates: 0, executionAuthorized: false, remoteClosure: closure, offlineInstallerInputPins: installer, objectAlternates: [] });
  await writeFile(join(root, sealDir, "source-projection.json"), sealed);
  const coordinates = { workspaceRoot: root, sealSha256: sha(sealed), base, runtime, caller, sourceProjectionSha256: projectionSha256 };
  const remoteCalls: string[][] = [], events: string[] = [];
  const ambientEnv = options.ambientEnv ?? {}, managedCount = Number(ambientEnv.GIT_CONFIG_COUNT ?? "0");
  let calls = 0;
  const signal = AbortSignal.timeout(5000);
  const verify = () => verifyFirstOpenInstallSealedPublication(coordinates, signal, async ({ args, env, input }) => {
    calls++;
    assert.ok(args.includes("protocol.allow=never"));
    assert.ok(args.every(x => !x.includes(simulatedOperator)));
    assert.equal(env.GIT_NO_REPLACE_OBJECTS, "1");
    for (const [key, value] of Object.entries(ambientEnv)) {
      if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) assert.equal(env[key], value);
    }
    const has = (x: string) => args.includes(x);
    if (has("ls-remote") || has("push")) {
      assert.ok(args.includes("protocol.https.allow=always") && args.includes("http.followRedirects=false") && args.includes("http.sslVerify=true"));
      assert.equal(env.GIT_CONFIG_COUNT, String(managedCount + 2));
      assert.equal(env[`GIT_CONFIG_KEY_${managedCount}`], "http.https://github.com/.extraHeader");
      assert.equal(env[`GIT_CONFIG_VALUE_${managedCount}`], `Authorization: Basic ${Buffer.from(`veinyyxy:${simulatedOperator}`).toString("base64")}`);
      assert.equal(env[`GIT_CONFIG_KEY_${managedCount + 1}`], `credential.${remote}.helper`);
      assert.equal(env[`GIT_CONFIG_VALUE_${managedCount + 1}`], "");
      remoteCalls.push([...args]);
      if (has("ls-remote")) {
        assert.deepEqual(args.slice(-5), ["ls-remote", "--refs", "--exit-code", remote, target]);
        return Buffer.from(`${options.head ?? base}\t${target}\n`);
      }
      assert.equal(events.at(-1), "publish-intent");
      assert.deepEqual(args.slice(-4), [`--force-with-lease=${target}:${base}`, "--", remote, `${caller}:${target}`]);
      assert.ok(args.includes("--no-follow-tags") && args.includes("--recurse-submodules=no"));
      assert.ok(!args.includes("--force") && !args.includes(`+${caller}:${target}`));
      return Buffer.from(options.pushAck ?? `To ${remote}\n \t${caller}:${target}\t${base.slice(0, 7)}..${caller.slice(0, 7)}\nDone\n`);
    }
    assert.equal(env.GIT_CONFIG_COUNT, ambientEnv.GIT_CONFIG_COUNT);
    assert.equal(env[`GIT_CONFIG_KEY_${managedCount}`], undefined);
    assert.equal(env[`GIT_CONFIG_VALUE_${managedCount}`], undefined);
    if (has("commit")) return args.at(-1) === runtime ? runtimeBytes : callerBytes;
    if (has("merge-base")) {
      assert.deepEqual(args.slice(-4), ["merge-base", "--is-ancestor", base, prior]);
      if (options.historyIsAncestor === false) throw Error("synthetic non-fast-forward");
      return Buffer.alloc(0);
    }
    if (has("ls-tree")) return Buffer.from(closure.map(({ path }) => `100644 blob ${gitBlob}\t${path}\0`).join(""));
    assert.ok(has("--batch"));
    assert.equal(input?.toString(), `${gitBlob}\n`.repeat(closure.length));
    const entry = Buffer.concat([Buffer.from(`${gitBlob} blob ${blob.length}\n`), blob, Buffer.from("\n")]);
    return Buffer.concat(closure.map(() => entry));
  }, ambientEnv);
  return { verify, signal, remoteCalls, events, gitCalls: () => calls, record: async (event: { kind: string }) => { events.push(event.kind); } };
}

test("managed URL-scoped config reaches every child unchanged; authentication is appended only on the two GitHub calls", async t => {
  const managed = ["https://managed.example.test/Org/Repository", "https://second.example.test/Other/Repository"].flatMap(url => [
    [`credential.${url}.helper`, ""],
    [`credential.${url}.helper`, "offline-fixture --option='spaces preserved'"],
    [`credential.${url}.useHttpPath`, "true"],
    [`http.${url}.proactiveAuth`, "auto"],
    [`http.${url}.followRedirects`, "false"],
  ]);
  const ambientEnv: Record<string, string> = { GIT_CONFIG_COUNT: String(managed.length) };
  for (const [i, [key, value]] of managed.entries()) {
    ambientEnv[`GIT_CONFIG_KEY_${i}`] = key;
    ambientEnv[`GIT_CONFIG_VALUE_${i}`] = value;
  }
  const before = { ...ambientEnv }, f = await fixture(t, { ambientEnv }), p = await f.verify();
  assert.equal(f.remoteCalls.length, 0);
  await p.publishOnce(simulatedOperator, f.signal, f.record);
  assert.equal(f.remoteCalls.length, 2);
  assert.deepEqual(ambientEnv, before);
});

test("managed config for GitHub is rejected before local or remote Git can run", async t => {
  const f = await fixture(t, { ambientEnv: { GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `credential.${remote}.helper`, GIT_CONFIG_VALUE_0: "offline-fixture" } });
  await assert.rejects(f.verify());
  assert.equal(f.gitCalls(), 0);
});

test("local seal verification does not read remote state; only exact fast-forward can submit once", async t => {
  const f = await fixture(t), p = await f.verify();
  assert.equal(f.remoteCalls.length, 0);
  await p.publishOnce(simulatedOperator, f.signal, f.record);
  assert.deepEqual(f.events, ["publish-intent", "publish-ack"]);
  assert.equal(f.remoteCalls.length, 2);
  await assert.rejects(p.publishOnce(simulatedOperator, f.signal, f.record), /PUBLICATION_INPUT$/);
  assert.equal(f.remoteCalls.length, 2);
});

test("stale or already-published main is not accepted as the reviewed preimage", async t => {
  for (const head of ["9".repeat(40), caller]) {
    const f = await fixture(t, { head }), p = await f.verify();
    await assert.rejects(p.publishOnce(simulatedOperator, f.signal, f.record), /REMOTE_BASE_CHANGED$/);
    assert.equal(f.remoteCalls.length, 1);
    assert.deepEqual(f.events, []);
  }
});

test("an unproved push ACK retains the single attempt and never retries", async t => {
  const f = await fixture(t, { pushAck: `To ${remote}\n=\t${caller}:${target}\t[up to date]\nDone\n` }), p = await f.verify();
  await assert.rejects(p.publishOnce(simulatedOperator, f.signal, f.record), /PUSH_ACK_UNPROVED_NO_RETRY$/);
  await assert.rejects(p.publishOnce(simulatedOperator, f.signal, f.record), /PUBLICATION_INPUT$/);
  assert.deepEqual(f.events, ["publish-intent"]);
  assert.equal(f.remoteCalls.length, 2);
});

test("a changed local input or non-fast-forward fails before any remote operation", async t => {
  const changed = await fixture(t, { changedInput: true });
  await assert.rejects(changed.verify(), /INSTALLER_PIN$/);
  assert.equal(changed.remoteCalls.length, 0);
  const nonFastForward = await fixture(t, { historyIsAncestor: false });
  await assert.rejects(nonFastForward.verify(), /GIT_STOP_NO_RETRY$/);
  assert.equal(nonFastForward.remoteCalls.length, 0);
});
