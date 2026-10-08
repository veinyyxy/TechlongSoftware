import { createAwsSdkPreparedCellTtlJanitor } from "../../../lib/deployments/execution/aws-sdk-prepared-cell-ttl-janitor.ts";
import { createNeonSerializableSharedCellOwnershipSnapshotSource } from "../../../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";
import { SerializableSharedCellCleanupDeletionZeroTenantAdapter } from "../../../lib/deployments/execution/shared-cell-cleanup-deletion-zero-tenant.ts";
import { cellCleanupInvocationSignal, loadCellCleanupDatabaseUrl } from "../../../lib/deployments/execution/cell-cleanup-lambda-context.ts";

/** Separate UNINSTALLED delete root: no drain/job/authority writer injected. */
export async function handler(event: unknown, context: unknown) {
  const value = event as Record<string, unknown> | null;
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["action", "approvedDeletionPlanSha256", "schemaVersion"]) ||
    value.schemaVersion !== 1 || value.action !== "execute_reviewed_cell_ttl_cleanup" || typeof value.approvedDeletionPlanSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.approvedDeletionPlanSha256)) throw new Error("CELL_TTL_EVENT_INVALID");
  const reviewed = { schemaVersion: 1, action: "execute_reviewed_cell_ttl_cleanup", approvedDeletionPlanSha256: value.approvedDeletionPlanSha256 };
  const signal = cellCleanupInvocationSignal(context, "techlong-sandbox-cell-ttl-executor");
  const databaseUrl = await loadCellCleanupDatabaseUrl("TechlongSandboxCellJanitorExecutionRole", signal);
  const source = createNeonSerializableSharedCellOwnershipSnapshotSource(databaseUrl);
  const root = await createAwsSdkPreparedCellTtlJanitor({ zeroTenantOwnership: new SerializableSharedCellCleanupDeletionZeroTenantAdapter(source) });
  return root.run(reviewed, signal);
}
