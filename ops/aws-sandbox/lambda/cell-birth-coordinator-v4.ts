import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { cellV3Fail, CELL_LIFECYCLE_COORDINATOR_V3 } from "../../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { validateCellBirthTickV3 } from "../../../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { createCellParentSdkV4, AwsSdkCellParentRegistryReaderV4, AwsSdkCellParentProvisionPublisherV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { AwsSdkCellParentInstallationReaderV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { createCellV3EvidenceFromCredentials } from "../../../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";
import { createPreparedCellBirthParentRootV4 } from "../../../lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts";

// Actual running bundle bytes, NOT an environment/event-provided digest. esbuild
// preserves import.meta.url in the dependency-free ESM artifact. No AWS call on
// import; hash promise does not load a profile or read credential files.
const localBundleSha256 = readFile(fileURLToPath(import.meta.url)).then(bytes => createHash("sha256").update(bytes).digest("hex"));
export async function handler(rawEvent: unknown, context: unknown) {
  const event = validateCellBirthTickV3(rawEvent), c = context as { functionName?: string; functionVersion?: string; invokedFunctionArn?: string; getRemainingTimeInMillis?: () => number };
  if (!c || c.functionName !== "techlong-sandbox-cell-lifecycle-coordinator-v3" || c.functionVersion !== "$LATEST" || c.invokedFunctionArn !== CELL_LIFECYCLE_COORDINATOR_V3 ||
    typeof c.getRemainingTimeInMillis !== "function") cellV3Fail("CELL_PARENT_HANDLER_CONTEXT_INVALID");
  const remaining = c.getRemainingTimeInMillis(); if (!Number.isSafeInteger(remaining) || remaining < 5000 || remaining > 120000) cellV3Fail("CELL_PARENT_HANDLER_DEADLINE_INVALID");
  const signal = AbortSignal.timeout(remaining - 1000), credentials = fromEnv(), local = { bundleSha256: await localBundleSha256,
    functionName: c.functionName, functionVersion: c.functionVersion, invokedFunctionArn: c.invokedFunctionArn };
  const clients = createCellParentSdkV4(credentials), evidence = createCellV3EvidenceFromCredentials(credentials, "lifecycle_coordinator");
  try {
    const installation = new AwsSdkCellParentInstallationReaderV4(clients.installation, "lifecycle_coordinator"),
      registry = new AwsSdkCellParentRegistryReaderV4(clients.registry, installation, "lifecycle_coordinator", local),
      publisher = new AwsSdkCellParentProvisionPublisherV4(clients.registry, registry, evidence.reader),
      root = createPreparedCellBirthParentRootV4({ registry, publisher, stack: evidence.reader });
    return await root.run(event, signal);
  } catch { return cellV3Fail("CELL_PARENT_INVOCATION_REJECTED_INSPECT_ONLY"); }
  finally { clients.dispose(); evidence.dispose(); }
}
