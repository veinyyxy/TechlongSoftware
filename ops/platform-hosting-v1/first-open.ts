import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isFirstOpenExecutionId, runEcsFirstOpen, type EcsFirstOpenPorts } from "../../lib/deployments/execution/ecs-first-open.ts";
import { loadFirstOpenBackend } from "./first-open-backend.mjs";

class FirstOpenEntryError extends Error {}

const runTool = promisify(execFile);
const toolOptions = { encoding: "utf8" as const, timeout: 5_000, maxBuffer: 4_096,
  env: { NODE_ENV: "production" as const, LANG: "C", PATH: "/usr/bin:/bin" } };

export async function checkFirstOpenImageDependencies() {
  try {
    const [backend, restore, python] = await Promise.all([
      loadFirstOpenBackend("/app/first-open-backend"),
      runTool("/usr/bin/pg_restore", ["--version"], toolOptions),
      runTool("/usr/bin/python3", ["-I", "-B", "--version"], toolOptions),
    ]);
    const { isPgRestore16_14, ...provenance } = backend;
    const pgRestore = restore.stdout.trim(), pythonVersion = python.stdout.trim();
    if (!isPgRestore16_14(pgRestore) || !/^Python 3\.\d+\.\d+$/.test(pythonVersion) || provenance.atsRootCount !== 5) throw Error();
    return { ...provenance, pgRestore, python: pythonVersion };
  } catch {
    throw new FirstOpenEntryError("ECS_FIRST_OPEN_IMAGE_DEPENDENCIES");
  }
}

async function loadRuntime(): Promise<EcsFirstOpenPorts> {
  await checkFirstOpenImageDependencies();
  // T1 uses injected resource ports. A deployed task remains closed until the approved runtime is wired.
  throw new FirstOpenEntryError("ECS_FIRST_OPEN_RUNTIME_UNAVAILABLE");
}

export async function runFirstOpenCommand(args: readonly string[], loadPorts = loadRuntime) {
  if (args.length !== 1 || !isFirstOpenExecutionId(args[0])) throw new FirstOpenEntryError("ECS_FIRST_OPEN_EXECUTION_ID");
  return runEcsFirstOpen(args[0], await loadPorts());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runFirstOpenCommand(process.argv.slice(2)).catch(error => {
    console.error(error instanceof FirstOpenEntryError ? error.message : "ECS_FIRST_OPEN_STOPPED");
    process.exitCode = 1;
  });
}
