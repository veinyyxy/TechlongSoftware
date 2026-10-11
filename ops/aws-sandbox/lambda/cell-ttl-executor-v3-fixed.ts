import { cellCleanupInvocationSignal } from "../../../lib/deployments/execution/cell-cleanup-lambda-context.ts";
import { loadFixedSealedRuntimeMaterialV3 } from "../../../lib/deployments/execution/sealed-cell-runtime-material-v3.ts";
import { createNeonSealedCellOwnershipSourceV3 } from "../../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import { createAwsSdkPreparedSealedCellTtlExecutorV3 } from "../../../lib/deployments/execution/aws-sdk-sealed-cell-cleanup-v3.ts";
import { sealedV3Keys, sealedV3Fail } from "../../../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";
/** New uninstalled candidate: avoids old environment Secret binding and missing VersionId. */
export async function handler(event: unknown, context: unknown) {
  const e = event as Record<string, unknown>;
  if (!sealedV3Keys(e, ["schemaVersion", "action", "approvedDeletionPlanSha256"]) || e.schemaVersion !== 3 || e.action !== "execute_reviewed_sealed_cell_ttl_cleanup" ||
    typeof e.approvedDeletionPlanSha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.approvedDeletionPlanSha256)) sealedV3Fail("SEALED_V3_EVENT_INVALID");
  const signal = cellCleanupInvocationSignal(context, "techlong-sandbox-cell-ttl-executor-v3"), material = await loadFixedSealedRuntimeMaterialV3("ttl", signal);
  const root = await createAwsSdkPreparedSealedCellTtlExecutorV3({ source: createNeonSealedCellOwnershipSourceV3(material.readerDatabaseUrl, material.expectedRegisteredCertificate), certificateSha256: material.certificateSha256 });
  return root.run(e, signal);
}
