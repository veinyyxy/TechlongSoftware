import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { FirstOpenRolePorts } from "../first-open-workflow-launcher.ts";

// Management and Inspector load only the original A's pinned DB utility
// source. The task-only release changes the deployed app, not these tools.
const backendCommit = "b9ca2138738900afc23a6a2ddce141b37a1f0a31";
const artifactCommit = "b7c566a772e6b6bfb58ed0dc250532a479d7789f";
const run = promisify(execFile);
const fail = (code: string): never => { throw Error("FIRST_OPEN_RUNNER_" + code); };
type Uploader = Awaited<ReturnType<FirstOpenRolePorts["inspect"]>>["uploadOwn"];
type UploadExec = (exe: string, args: string[], options: import("node:child_process").ExecFileOptions) => Promise<unknown>;

export function checkedRunnerPaths(role: "management" | "runonce" | "inspect", env = process.env, root = process.cwd(),
  git = (path: string) => execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 3000 }).trim()) {
  if (!isAbsolute(root) || !env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) || env.RUNNER_OS !== "Linux" ||
    env.RUNNER_ARCH !== "X64") return fail("PATHS");
  const backend = join(root, ".first-open-backend"), artifact = join(root, ".first-open-artifact-action");
  if (role !== "runonce" && git(backend) !== backendCommit) return fail("BACKEND_COMMIT");
  if (role !== "management" && git(artifact) !== artifactCommit) return fail("ARTIFACT_COMMIT");
  return Object.freeze({ role, backend, artifact, temp: env.RUNNER_TEMP, pgRestore: join(env.RUNNER_TEMP, "first-open-pg-restore"),
    workspace: join(env.RUNNER_TEMP, "first-open-fc41597f-baseline") });
}

export async function managementBackend(paths: ReturnType<typeof checkedRunnerPaths>, signal: AbortSignal) {
  const load = createRequire(join(paths.backend, "package.json"));
  // Use A's own version predicate rather than matching any PG16 binary.
  const { isPgRestore16_14 } = load("./services/saas/tenant_postgres_tools.js") as { isPgRestore16_14(v: string): boolean };
  try {
    const env = { NODE_ENV: "production" as const, PATH: "/usr/bin:/bin", LANG: "C" };
    const [pg, py] = await Promise.all([
      run(paths.pgRestore, ["--version"], { signal, env, timeout: 12_000, maxBuffer: 4096 }),
      run("/usr/bin/python3", ["-I", "--version"], { signal, env, timeout: 3000, maxBuffer: 4096 }),
    ]);
    if (!isPgRestore16_14(pg.stdout) || !/^Python 3\./.test(py.stdout)) return fail("TOOL_VERSION");
  } catch { return fail("TOOL_VERSION"); }
  return { backendDirectory: paths.backend, baselineTools: { pgRestorePath: paths.pgRestore,
    pythonPath: "/usr/bin/python3", workspace: paths.workspace } };
}

/** Use the pinned official action's same-run artifact transport. Give it only
 * the handoff and the GitHub runner's artifact scope, never host credentials. */
export function firstOpenSameRunUpload(paths: ReturnType<typeof checkedRunnerPaths>, env = process.env,
  exec: UploadExec = run): Uploader {
  const { ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL, ACTIONS_RUNTIME_URL, GITHUB_RUN_ID, FIRST_OPEN_ARTIFACT_NODE } = env;
  if (!ACTIONS_RUNTIME_TOKEN || !ACTIONS_RESULTS_URL || !GITHUB_RUN_ID || !/^[1-9][0-9]{0,19}$/.test(GITHUB_RUN_ID) ||
    !FIRST_OPEN_ARTIFACT_NODE || !isAbsolute(FIRST_OPEN_ARTIFACT_NODE)) {
    return fail("ARTIFACT_RUNTIME");
  }
  for (const base of [ACTIONS_RESULTS_URL, ...(ACTIONS_RUNTIME_URL ? [ACTIONS_RUNTIME_URL] : [])]) {
    const u = new URL(base);
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash ||
      !u.hostname.endsWith(".actions.githubusercontent.com")) return fail("ARTIFACT_ENDPOINT");
  }
  const names = new Set<string>();
  const lanes = new Set<string>(paths.role === "inspect" ? ["01-inspector-ready", "02-g1-metadata-observed", "03-runtime-observed",
    "cfn-version-observed", "cfn-version-relocked"] : paths.role === "runonce" ? ["02-g1-check-request", "03-runtime-check-request",
      "cfn-version-request"] : []);
  return async ({ name, member, bytes, signal }) => {
    signal.throwIfAborted();
    const lane = /^fc41597f-[a-f0-9]{64}-([0-9a-z-]+)$/.exec(name)?.[1];
    if (!lane || !lanes.has(lane) ||
      member !== "handoff.json" || !bytes.length || bytes.length > 16_384 || names.has(name)) return fail("ARTIFACT_SCOPE");
    names.add(name);
    const dir = await mkdtemp(join(paths.temp, "first-open-handoff-")), output = join(dir, "outputs");
    try {
      const input = join(dir, member);
      await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
      await writeFile(output, "", { flag: "wx", mode: 0o600 });
      await exec(FIRST_OPEN_ARTIFACT_NODE, [join(paths.artifact, "dist", "upload", "index.js")], { cwd: dir, signal, timeout: 20_000,
        maxBuffer: 128_000, env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL, ACTIONS_RUNTIME_URL,
          GITHUB_RUN_ID, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: output, GITHUB_ACTIONS: "true",
          INPUT_NAME: name, INPUT_PATH: input, "INPUT_IF-NO-FILES-FOUND": "error", "INPUT_RETENTION-DAYS": "1",
          "INPUT_COMPRESSION-LEVEL": "0", INPUT_OVERWRITE: "false", "INPUT_INCLUDE-HIDDEN-FILES": "false" } });
      signal.throwIfAborted();
      // @actions/core writes outputs with its randomized delimiter.
      const results = await readFile(output, "utf8");
      const ids = [...results.matchAll(/^artifact-id<<(ghadelimiter_[a-f0-9-]+)\r?\n([1-9][0-9]{0,19})\r?\n\1\r?$/gm)];
      if (ids.length !== 1) return fail("ARTIFACT_ACK");
      return { artifactId: ids[0][2] };
    } catch { return fail("ARTIFACT_UPLOAD_UNVERIFIED"); }
    finally { await rm(dir, { recursive: true, force: true }); }
  };
}
