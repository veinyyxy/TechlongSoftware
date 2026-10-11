import { validateSealedCellDrainEventV3 } from "../../../lib/deployments/execution/prepared-sealed-cell-drain-coordinator-v3.ts";
import { cellCleanupInvocationSignal } from "../../../lib/deployments/execution/cell-cleanup-lambda-context.ts";
import { loadFixedSealedRuntimeMaterialV3 } from "../../../lib/deployments/execution/sealed-cell-runtime-material-v3.ts";
import { createAwsSdkPreparedSealedCellDrainV3 } from "../../../lib/deployments/execution/aws-sdk-prepared-sealed-cell-drain-v3.ts";
export async function handler(event: unknown, context: unknown) {
  const reviewed = validateSealedCellDrainEventV3(event), signal = cellCleanupInvocationSignal(context, "techlong-sandbox-cell-drain-coordinator");
  const material = await loadFixedSealedRuntimeMaterialV3("drain", signal);
  if (!material.writerDatabaseUrl) throw new Error("SEALED_DRAIN_WRITER_MISSING");
  const root = await createAwsSdkPreparedSealedCellDrainV3({ ...material, writerDatabaseUrl: material.writerDatabaseUrl });
  try { return await root.run(reviewed, signal); } finally { root.dispose(); }
}
