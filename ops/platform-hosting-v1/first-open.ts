import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isFirstOpenExecutionId, runEcsFirstOpen, type EcsFirstOpenPorts } from "../../lib/deployments/execution/ecs-first-open.ts";
import { loadFirstOpenBackend } from "./first-open-backend.mjs";
import { createFirstOpenRdsResourceFactory } from "./first-open-rds-resources.ts";
import { runPreparedFirstOpenTask } from "./first-open-task-runtime.ts";

export { createEcsFirstOpenTaskPorts } from "../../lib/deployments/execution/ecs-first-open-runtime.ts";
export { createFirstOpenRdsManagement } from "./first-open-rds-management.ts";
export { createFirstOpenRdsInspector } from "./first-open-rds-inspector.ts";
export { createTenantPostgresAdapter, tenantRdsApplicationConfiguration } from "./first-open-tenant-postgres.mjs";
export { prepareFirstOpenTaskRuntime, runPreparedFirstOpenTask, type FirstOpenTaskResourceFactory } from "./first-open-task-runtime.ts";

class FirstOpenEntryError extends Error {}

const runTool = promisify(execFile);
const toolOptions = { encoding: "utf8" as const, timeout: 5_000, maxBuffer: 4_096,
  env: { NODE_ENV: "production" as const, LANG: "C", PATH: "/usr/bin:/bin" } };

export async function checkFirstOpenImageDependencies() {
  try {
    const [backend, restore] = await Promise.all([
      loadFirstOpenBackend("/app/first-open-backend"),
      runTool("/usr/bin/pg_restore", ["--version"], toolOptions),
    ]);
    const { isPgRestore16_14, ...provenance } = backend;
    const pgRestore = restore.stdout.trim();
    if (!isPgRestore16_14(pgRestore) || provenance.atsRootCount !== 5) throw Error();
    return { ...provenance, pgRestore };
  } catch {
    throw new FirstOpenEntryError("ECS_FIRST_OPEN_IMAGE_DEPENDENCIES");
  }
}

type EntryOptions = Omit<Parameters<typeof runPreparedFirstOpenTask>[1], "env" | "signal" | "createResources"> & {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  verifyImage?: () => Promise<unknown>;
  resourceAdapters?: Parameters<typeof createFirstOpenRdsResourceFactory>[1];
};

async function runRuntime(executionId: string, {
  env = process.env, signal = AbortSignal.timeout(3_600_000), verifyImage = checkFirstOpenImageDependencies,
  resourceAdapters, ...runtimeOptions
}: EntryOptions = {}) {
  await verifyImage();
  try {
    const createResources = createFirstOpenRdsResourceFactory(env, { now: runtimeOptions.now, ...resourceAdapters });
    return await runPreparedFirstOpenTask(executionId, { ...runtimeOptions, env, signal, createResources });
  } catch (error) {
    if (error instanceof Error && error.message === "ECS_FIRST_OPEN_RUNTIME_UNAVAILABLE") {
      throw new FirstOpenEntryError(error.message);
    }
    throw error;
  }
}

export async function runFirstOpenCommand(args: readonly string[], loadPorts?: (executionId: string) => Promise<EcsFirstOpenPorts>, options?: EntryOptions) {
  if (args.length !== 1 || !isFirstOpenExecutionId(args[0])) throw new FirstOpenEntryError("ECS_FIRST_OPEN_EXECUTION_ID");
  return loadPorts ? runEcsFirstOpen(args[0], await loadPorts(args[0])) : runRuntime(args[0], options);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runFirstOpenCommand(process.argv.slice(2)).catch(error => {
    console.error(error instanceof FirstOpenEntryError ? error.message : "ECS_FIRST_OPEN_STOPPED");
    process.exitCode = 1;
  });
}
