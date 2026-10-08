import { cellCleanupInvocationSignal } from "../../../lib/deployments/execution/cell-cleanup-lambda-context.ts";
import { loadSealedCellTtlControlMaterialV3, SEALED_CELL_LAMBDA_NAME_V3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts";
import { createNeonSealedCellOwnershipSourceV3 } from "../../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import { createAwsSdkPreparedSealedCellTtlExecutorV3 } from "../../../lib/deployments/execution/aws-sdk-sealed-cell-cleanup-v3.ts";
import { sealedV3Keys, sealedV3Fail } from "../../../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";

/** Separate, uninstalled root. No environment switch enables the default Worker or an old v2 handler. */
export async function handler(event: unknown, context: unknown) {
  const value = event as Record<string, unknown>;
  if (!sealedV3Keys(value, ["schemaVersion", "action", "approvedDeletionPlanSha256"]) || value.schemaVersion !== 3 ||
    value.action !== "execute_reviewed_sealed_cell_ttl_cleanup" || typeof value.approvedDeletionPlanSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.approvedDeletionPlanSha256)) sealedV3Fail("SEALED_V3_EVENT_INVALID");
  const reviewed = { schemaVersion: 3, action: "execute_reviewed_sealed_cell_ttl_cleanup", approvedDeletionPlanSha256: value.approvedDeletionPlanSha256 };
  const signal = cellCleanupInvocationSignal(context, SEALED_CELL_LAMBDA_NAME_V3);
  const material = await loadSealedCellTtlControlMaterialV3(signal);
  const source = createNeonSealedCellOwnershipSourceV3(material.databaseUrl, material.expectedRegisteredCertificate);
  const root = await createAwsSdkPreparedSealedCellTtlExecutorV3({ source, certificateSha256: material.certificateSha256 });
  return root.run(reviewed, signal);
}
