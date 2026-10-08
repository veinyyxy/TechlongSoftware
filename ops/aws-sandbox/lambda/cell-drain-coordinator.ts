import { validateCellDrainEvent } from "../../../lib/deployments/execution/prepared-cell-drain-coordinator.ts";
import { cellCleanupInvocationSignal, loadCellCleanupDatabaseUrl } from "../../../lib/deployments/execution/cell-cleanup-lambda-context.ts";
import { createAwsSdkPreparedCellDrainCoordinator } from "../../../lib/deployments/execution/aws-sdk-prepared-cell-drain-coordinator.ts";

/** NEW, UNINSTALLED handler. Does not replace the legacy PLAN_ONLY Lambda. */
export async function handler(event: unknown, context: unknown) {
  const reviewed = validateCellDrainEvent(event);
  const signal = cellCleanupInvocationSignal(context, "techlong-sandbox-cell-drain-coordinator");
  const databaseUrl = await loadCellCleanupDatabaseUrl("TechlongSandboxCellDrainCoordinatorRole", signal);
  return createAwsSdkPreparedCellDrainCoordinator(databaseUrl).run(reviewed, signal);
}
