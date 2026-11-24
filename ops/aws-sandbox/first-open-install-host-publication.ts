import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, isAbsolute, resolve } from "node:path";
import { debuglog } from "node:util";
import { inspectFirstOpenInstallHostTransport } from "./first-open-install-host-transport.ts";

const sealDir = ".local-secrets/fc41597f-slot2-readback-policy-seal-v1";
const remote = "https://github.com/veinyyxy/TechlongSoftware.git", main = "refs/heads/main";
const sha1 = /^[0-9a-f]{40}$/, sha256 = /^[0-9a-f]{64}$/;
const safePath = /^[\w.-]+(?:\/[\w.-]+)*$/;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const gitHash = (kind: string, bytes: Buffer) =>
  createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
const fail = (code: string): never => { throw Error(`FIRST_OPEN_INSTALL_HOST_PUBLICATION_${code}`); };
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
const text = (raw: Buffer) => new TextDecoder("utf-8", { fatal: true }).decode(raw);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const relative = (x: unknown): x is string => typeof x === "string" && safePath.test(x) &&
  x.split("/").every(part => part !== "." && part !== "..");
const scopePath = (root: string, path: string) => resolve(root, path);

async function exactFile(path: string, max: number) {
  const before = await lstat(path);
  need(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= max, "INPUT_FILE");
  const raw = await readFile(path);
  need(raw.length === before.size, "INPUT_FILE_CHANGED");
  return raw;
}

async function absent(path: string) {
  try { await lstat(path); return false; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return true; }
}

export type FirstOpenInstallPublicationCoordinates = {
  workspaceRoot: string; sealSha256: string; base: string; runtime: string; caller: string; sourceProjectionSha256: string;
};
type GitRequest = { args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; input?: Buffer };
type PublicationEvent = { kind: "publish-intent" | "publish-ack"; base: string; caller: string; target: "refs/heads/main" };
function gitProcess(request: GitRequest) {
  return new Promise<Buffer>((ok, reject) => {
    const child = execFile("git", request.args, { cwd: request.cwd, env: request.env, windowsHide: true,
      encoding: "buffer", timeout: 60_000, signal: request.signal, maxBuffer: 16 * 1024 * 1024 }, (e, stdout) => {
      if (e) reject(Error("FIRST_OPEN_INSTALL_HOST_PUBLICATION_GIT_STOP_NO_RETRY"));
      else ok(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(request.input);
  });
}

/** Verify the seal with only local Git reads. No ref or credential is read. */
export async function verifyFirstOpenInstallSealedPublication(input: FirstOpenInstallPublicationCoordinates, signal: AbortSignal,
  runGit: (request: GitRequest) => Promise<Buffer> = gitProcess,
  ambientEnv: Readonly<Record<string, string | undefined>> = process.env) {
  const { workspaceRoot, sealSha256, base, runtime, caller, sourceProjectionSha256 } = { ...input };
  need(isAbsolute(workspaceRoot) && sha256.test(sealSha256) && sha256.test(sourceProjectionSha256) &&
    [base, runtime, caller].every(x => sha1.test(x)) && new Set([base, runtime, caller]).size === 3, "COORDINATES");
  signal.throwIfAborted();
  const inherited = inspectFirstOpenInstallHostTransport(ambientEnv);
  const cwd = await realpath(workspaceRoot), seal = scopePath(cwd, sealDir);
  const gitDir = scopePath(seal, "objects.git"), raw = await exactFile(scopePath(seal, "source-projection.json"), 128 * 1024);
  need(hash(raw) === sealSha256, "RAW_SEAL");
  const p: unknown = JSON.parse(text(raw));
  need(object(p) && p.schema === "techlong/fc41597f-slot2-install-source-projection/v1" &&
    p.base === base && p.runtime === runtime && p.caller === caller && p.sourceProjectionSha256Utf8Lf === sourceProjectionSha256 &&
    p.unpublished === true && p.refUpdates === 0 && p.executionAuthorized === false && p.gitDir === `${sealDir}/objects.git` &&
    typeof p.previousOfflineRuntime === "string" && sha1.test(p.previousOfflineRuntime) &&
    typeof p.runtimeTree === "string" && sha1.test(p.runtimeTree) && typeof p.callerTree === "string" && sha1.test(p.callerTree) &&
    Array.isArray(p.remoteClosure) && p.remoteClosure.length === 160 && hash(JSON.stringify(p.remoteClosure)) === sourceProjectionSha256 &&
    Array.isArray(p.offlineInstallerInputPins) && p.offlineInstallerInputPins.length === 8 &&
    Array.isArray(p.objectAlternates) && p.objectAlternates.length <= 32, "SOURCE_PROJECTION");
  const config = text(await exactFile(scopePath(gitDir, "config"), 2048)).replace(/\r\n/g, "\n");
  const lines = config.trimEnd().split("\n").map(x => x.trim());
  const core = ["repositoryformatversion = 0", "filemode = true", "filemode = false", "bare = true", "symlinks = false", "ignorecase = true"];
  need(lines[0] === "[core]" && lines.slice(1).every(x => core.includes(x)) &&
    lines.includes("repositoryformatversion = 0") && lines.includes("bare = true") &&
    new Set(lines).size === lines.length, "BARE_CONFIGURATION");
  need(await absent(scopePath(gitDir, "info/grafts")) && await absent(scopePath(gitDir, "shallow")), "GIT_HISTORY_OVERRIDE");
  const alternatePaths: string[] = [];
  for (const path of new Set(p.objectAlternates as unknown[])) {
    need(relative(path) && (path === ".git/objects" || path.startsWith(".local-secrets/") && path.endsWith("/objects")), "ALTERNATE_SCOPE");
    const pathName = scopePath(cwd, path);
    need(await realpath(pathName) === pathName && !pathName.includes(delimiter), "ALTERNATE_DIRECTORY");
    alternatePaths.push(pathName);
  }
  for (const objects of [scopePath(gitDir, "objects"), ...alternatePaths]) {
    need(await realpath(objects) === objects && await absent(scopePath(objects, "info/alternates")) &&
      await absent(scopePath(objects, "info/http-alternates")), "ALTERNATE_REDIRECTION");
  }
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const [k, v] of Object.entries(ambientEnv)) {
    if (["PATH", "PATHEXT", "WINDIR", "SYSTEMROOT", "TMP", "TEMP", "TMPDIR", "USERPROFILE", "HOME"].includes(k.toUpperCase())) env[k] = v;
  }
  Object.assign(env, inherited.config);
  const noConfig = process.platform === "win32" ? "NUL" : "/dev/null";
  Object.assign(env, { LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: noConfig, GIT_CONFIG_GLOBAL: noConfig,
    GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternatePaths.join(delimiter) });
  const argsPrefix = [`--git-dir=${gitDir}`, "-c", "protocol.allow=never"];
  async function git(args: string[], signal: AbortSignal, input?: Buffer, auth?: Record<string, string>) {
    signal.throwIfAborted();
    let out: Buffer;
    try { out = await runGit({ args: [...argsPrefix, ...args], cwd, env: { ...env, ...auth }, signal, input }); }
    catch { return fail("GIT_STOP_NO_RETRY"); }
    signal.throwIfAborted();
    return out;
  }
  const commit = async (sha: string, tree: string, parent: string) => {
    const bytes = await git(["cat-file", "commit", sha], signal);
    const header = text(bytes).split("\n\n", 1)[0].split("\n");
    need(gitHash("commit", bytes) === sha && header[0] === `tree ${tree}` &&
      header.filter(x => x.startsWith("parent ")).join("\n") === `parent ${parent}`, "COMMIT_CHAIN");
  };
  await commit(runtime, p.runtimeTree, p.previousOfflineRuntime);
  await commit(caller, p.callerTree, runtime);
  await git(["merge-base", "--is-ancestor", base, p.previousOfflineRuntime], signal);
  const paths = new Map(text(await git(["ls-tree", "-rz", caller], signal)).split("\0").filter(Boolean).map(line => {
    const match = /^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    return match ? [match[3], { mode: match[1], sha: match[2] }] as const : [line, undefined] as const;
  }));
  const pins = p.remoteClosure as unknown[];
  need(pins.every(pin => object(pin) && relative(pin.path) && typeof pin.gitBlob === "string" && sha1.test(pin.gitBlob) &&
    typeof pin.sha256 === "string" && sha256.test(pin.sha256) && paths.get(pin.path)?.sha === pin.gitBlob &&
    ["100644", "100755"].includes(paths.get(pin.path)!.mode)), "BLOB_PATHS");
  const closure = pins as { path: string; gitBlob: string; sha256: string }[];
  need(new Set(closure.map(x => x.path)).size === closure.length, "BLOB_PATHS");
  const batch = await git(["cat-file", "--batch"], signal, Buffer.from(closure.map(x => x.gitBlob).join("\n") + "\n"));
  let offset = 0;
  for (const pin of closure) {
    const end = batch.indexOf(10, offset), match = /^([0-9a-f]{40}) blob ([0-9]{1,8})$/.exec(batch.toString("ascii", offset, end));
    need(end >= offset && match?.[1] === pin.gitBlob, "BLOB_BATCH");
    offset = end + 1 + Number(match[2]);
    const body = batch.subarray(end + 1, offset);
    need(batch[offset++] === 10 && hash(body) === pin.sha256 && gitHash("blob", body) === pin.gitBlob, "BLOB_CONTENT");
  }
  need(offset === batch.length, "BLOB_BATCH");
  for (const pin of p.offlineInstallerInputPins as unknown[]) {
    need(object(pin) && relative(pin.path) && pin.path.startsWith("ops/aws-sandbox/") && typeof pin.sha256Utf8Lf === "string" &&
      sha256.test(pin.sha256Utf8Lf), "INSTALLER_PIN");
    const bytes = await exactFile(scopePath(cwd, pin.path), 512 * 1024);
    need(hash(text(bytes).replaceAll("\r\n", "\n")) === pin.sha256Utf8Lf, "INSTALLER_PIN");
  }
  let used = false;
  return Object.freeze({ base, runtime, caller, async publishOnce(operatorToken: string, signal: AbortSignal,
    record: (event: PublicationEvent) => Promise<void>) {
    need(!used && /^[A-Za-z0-9_]{20,255}$/.test(operatorToken) && !debuglog("child_process").enabled &&
      !process.env.NODE_DEBUG_NATIVE, "PUBLICATION_INPUT");
    used = true;
    // Append GitHub-only controls to the preserved managed entries. The PAT is
    // child-only, not sent to a credential helper or stored in args/config/URL.
    const n = inherited.configCount;
    const auth = { GIT_CONFIG_COUNT: String(n + 2), [`GIT_CONFIG_KEY_${n}`]: "http.https://github.com/.extraHeader",
      [`GIT_CONFIG_VALUE_${n}`]: `Authorization: Basic ${Buffer.from(`veinyyxy:${operatorToken}`).toString("base64")}`,
      [`GIT_CONFIG_KEY_${n + 1}`]: `credential.${remote}.helper`, [`GIT_CONFIG_VALUE_${n + 1}`]: "" };
    const https = ["-c", "protocol.https.allow=always", "-c", "http.followRedirects=false", "-c", "http.sslVerify=true"];
    const seen = text(await git([...https, "ls-remote", "--refs", "--exit-code", remote, main], signal, undefined, auth)).trim();
    need(seen === `${base}\t${main}`, "REMOTE_BASE_CHANGED");
    const binding = { base, caller, target: main } as const;
    await record({ kind: "publish-intent", ...binding });
    // Git's exact lease supplies the compare-and-swap race guard. The old
    // object must be precisely `base` and the verified destination descends
    // from it; no non-fast-forward update is possible under that lease.
    const result = text(await git([...https, "push", "--porcelain", "--no-verify", "--no-follow-tags", "--recurse-submodules=no",
      `--force-with-lease=${main}:${base}`, "--", remote, `${caller}:${main}`], signal, undefined, auth));
    const lines = result.replaceAll("\r\n", "\n").split("\n");
    need(lines.length === 4 && lines[0] === `To ${remote}` && lines[2] === "Done" && lines[3] === "" &&
      /^ \t[0-9a-f]{40}:refs\/heads\/main\t[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$/.test(lines[1]) &&
      lines[1].split("\t")[1] === `${caller}:${main}` &&
      lines[1].split("\t")[2].split("..").every((sha, index) => (index ? caller : base).startsWith(sha)), "PUSH_ACK_UNPROVED_NO_RETRY");
    await record({ kind: "publish-ack", ...binding });
  } });
}

const sodiumModules = "F:/ChatGPT_workshop/techlong-buyer-web-publication-20261028-a/node_modules";
const wrapper = "libsodium-wrappers/dist/modules/libsodium-wrappers.js", library = "libsodium/dist/modules/libsodium.js";
const verifiedCrypto = {
  "libsodium/package.json": "e505a54c7c82fb4ac4064badd7d1ae21f10cba4a83c10bfd7ab28927d91e5736",
  [library]: "8abec6b42fafb418f58bff3fd665005b3e700ee02dae5042ce5704d27e6fcb23",
  "libsodium-wrappers/package.json": "b13b20e6311fc6ada9213b2a0fca98654ef7bc1c5d172f5b6d27a60b58f9b4c0",
  [wrapper]: "828884732c06fa4443688b33ceb4ab42e6e1b99200e4749be375faa289e94158",
};
/** Prior approved 0.7.15 installation only. No install or library fallback. */
export async function prepareFirstOpenInstallSealer() {
  const root = await realpath(sodiumModules);
  for (const [path, pin] of Object.entries(verifiedCrypto)) {
    const target = scopePath(root, path);
    need(await realpath(target) === target && hash(await exactFile(target, 2 * 1024 * 1024)) === pin, "CRYPTO_PIN");
  }
  const entry = scopePath(root, wrapper), require = createRequire(entry);
  need(require.resolve("libsodium") === scopePath(root, library) && !require.cache[entry] && !require.cache[scopePath(root, library)], "CRYPTO_RESOLUTION");
  const sodium = require(entry) as { ready: Promise<void>; crypto_box_seal?: (data: Uint8Array, key: Uint8Array) => Uint8Array };
  await sodium.ready;
  const seal = sodium.crypto_box_seal;
  need(typeof seal === "function", "CRYPTO_SHAPE");
  return async (plaintext: Uint8Array, publicKey: Uint8Array) => {
    need(plaintext instanceof Uint8Array && plaintext.length > 0 && plaintext.length <= 32768 &&
      publicKey instanceof Uint8Array && publicKey.length === 32, "CRYPTO_INPUT");
    const boxed = seal(plaintext, publicKey);
    need(boxed instanceof Uint8Array && boxed.length === plaintext.length + 48, "CRYPTO_SHAPE");
    return boxed;
  };
}
