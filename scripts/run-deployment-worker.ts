import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createAwsSdkDeploymentAdapter } from "../lib/deployments/execution/aws-sdk-adapter.ts";
import { EmbeddedCloudFormationCleanupSchedule } from "../lib/deployments/execution/cleanup.ts";
import {
  evaluateWorkerRuntimeGate,
  loadDeploymentWorkerRuntimeConfig,
} from "../lib/deployments/execution/gates.ts";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import { createDefaultDisabledWorkerRuntime } from "../lib/deployments/execution/runtime-composition.ts";
import { runDeploymentWorkerOnce } from "../lib/deployments/execution/worker.ts";

const nodeVersion = process.versions.node.split(".").map(Number);
if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) {
  throw new Error("Deployment worker requires Node.js 22.13 or newer.");
}

const config = loadDeploymentWorkerRuntimeConfig(process.env);
const workerGate = evaluateWorkerRuntimeGate(config);
if (!workerGate.ok) {
  process.stdout.write(
    `${JSON.stringify({ status: "disabled", failures: workerGate.failures })}\n`,
  );
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Deployment worker requires DATABASE_URL.");

const workerId = `worker:${hostname().replace(/[^A-Za-z0-9._-]/g, "-")}:${randomUUID().slice(0, 8)}`;
const runtime = createDefaultDisabledWorkerRuntime();
const dependencies = {
  repository: new NeonDeploymentExecutionRepository(databaseUrl),
  ...runtime,
  awsFactory: ({ region }: { region: string; workerRoleArn: string }) =>
    createAwsSdkDeploymentAdapter(region),
  cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(),
};

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

const once = process.argv.includes("--once");
do {
  const result = await runDeploymentWorkerOnce({ workerId, config, dependencies });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (once || result.status === "disabled") break;
  if (!stopping && result.status === "idle") {
    await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
} while (!stopping);
