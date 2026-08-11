import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createAwsSdkDeploymentAdapter } from "../lib/deployments/execution/aws-sdk-adapter.ts";
import { EmbeddedCloudFormationCleanupSchedule } from "../lib/deployments/execution/cleanup.ts";
import { DisabledSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import { DisabledSaaSControlPayloadCompiler } from "../lib/deployments/execution/control-payload.ts";
import { DisabledSharedCellSecurityPreflight } from "../lib/deployments/execution/shared-cell-preflight.ts";
import {
  evaluateWorkerRuntimeGate,
  loadDeploymentWorkerRuntimeConfig,
} from "../lib/deployments/execution/gates.ts";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import { DisabledTenantDatabasePort } from "../lib/deployments/execution/tenant-database.ts";
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
const dependencies = {
  repository: new NeonDeploymentExecutionRepository(databaseUrl),
  // This remains false until every apply/reconcile boundary below has a
  // reviewed production adapter. Queued apply work remains untouched.
  applyRuntimeReady: false,
  // Full fenced workload -> database/role -> secret cleanup adapters are not
  // installed in B0-B4. Keep jobs queued instead of partially deleting AWS.
  cleanupRuntimeReady: false,
  awsFactory: ({ region }: { region: string; workerRoleArn: string }) =>
    createAwsSdkDeploymentAdapter(region),
  cleanupScheduler: new EmbeddedCloudFormationCleanupSchedule(),
  sharedCellSecurityPreflight: new DisabledSharedCellSecurityPreflight(),
  // Both boundaries deliberately fail closed until their reviewed S3 runtime
  // adapters are supplied. The worker can never mark an instance active while
  // either database migration or mTLS control reconciliation is unavailable.
  tenantDatabase: new DisabledTenantDatabasePort(),
  controlClient: new DisabledSaaSControlClient(),
  controlPayloadCompiler: new DisabledSaaSControlPayloadCompiler(),
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
