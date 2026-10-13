import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { neon } from "@neondatabase/serverless";
import { cellV3Fail } from "../../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { validateCellBirthTickV3 } from "../../../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { createCellParentSdkV4, AwsSdkCellParentProvisionPublisherV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { AwsSdkCellParentInstallationReaderV6 } from "../../../lib/deployments/execution/cell-parent-compatibility-v6.ts";
import { AwsSdkCellParentRegistryReaderV5, normalizeCellParentLocalV5, cellParentJobsSqlAdapterV5 } from "../../../lib/deployments/execution/cell-parent-compatibility-v5.ts";
import { createCellV3EvidenceFromCredentials } from "../../../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";
import { createPreparedCellBirthParentRootV4 } from "../../../lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts";
import { AwsSdkCellParentCleanupJournalV4 } from "../../../lib/deployments/execution/cell-parent-cleanup-v4.ts";
import { AwsSdkCellParentDeleteV4, createCellParentDeleteSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-parent-delete-v4.ts";
import { createCellParentDatabaseLoaderV5, readCellParentGateReaderV5, CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 } from "../../../lib/deployments/execution/cell-parent-runtime-material-v5.ts";
import { PreparedCellParentCleanupRuntimeV4 } from "../../../lib/deployments/execution/prepared-cell-parent-cleanup-runtime-v4.ts";
import { validateCellParentGateEventV5, runCellParentGatesV5 } from "../../../lib/deployments/execution/cell-parent-gates-v5.ts";
import { NeonCellParentDatabaseV4 } from "../../../lib/deployments/execution/neon-cell-parent-control-v4.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import type { NeonSerializableSnapshotSqlClient } from "../../../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";

// New candidate only: same event protocols/handler name and whole V5 root,
// with exact V6 IAM-response compatibility. No registration/code mutation here.
const localBundleSha256 = readFile(fileURLToPath(import.meta.url)).then(bytes => createHash("sha256").update(bytes).digest("hex"));
export async function handler(rawEvent: unknown, context: unknown) {
  const isGate = (rawEvent as { action?: unknown } | null)?.action === "inspect_fixed_cell_parent_gates_v5";
  const event = isGate ? await validateCellParentGateEventV5(rawEvent, Date.now()) : validateCellBirthTickV3(rawEvent);
  const c = context as { functionName?: string; functionVersion?: string; invokedFunctionArn?: string; getRemainingTimeInMillis?: () => number };
  if (!c || typeof c.getRemainingTimeInMillis !== "function") cellV3Fail("CELL_PARENT_V5_HANDLER_CONTEXT_INVALID");
  const local = normalizeCellParentLocalV5({ bundleSha256: await localBundleSha256, functionName: c.functionName ?? "",
    functionVersion: c.functionVersion ?? "", invokedFunctionArn: c.invokedFunctionArn ?? "" });
  const remaining = c.getRemainingTimeInMillis();
  if (!Number.isSafeInteger(remaining) || remaining < 5000 || remaining > 120000) cellV3Fail("CELL_PARENT_V5_HANDLER_DEADLINE_INVALID");
  const signal = AbortSignal.timeout(remaining - 1000), credentials = fromEnv(), clients = createCellParentSdkV4(credentials);
  const installation = new AwsSdkCellParentInstallationReaderV6(clients.installation, "lifecycle_coordinator");
  try {
    if (isGate) {
      const sm = new SecretsManagerClient({ credentials, region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 });
      try {
        return await runCellParentGatesV5(event, {
          now: Date.now, installation: (e, s) => installation.read(e.binding, e.stackId, s, local),
          snapshot: (input, s) => clients.registry.ddb.send(new clients.registry.commands.transactGet(input), { abortSignal: s }),
          conditional: (operation, input, s) => clients.registry.ddb.send(operation === "put" ? new PutCommand(input as never) : new clients.registry.commands.transactWrite(input), { abortSignal: s }),
          reader: async s => {
            const t = targets[0], m = await readCellParentGateReaderV5(async () => ({ ...await sm.send(new GetSecretValueCommand({ SecretId: t.secretArn,
              VersionId: t.secretVersionId, VersionStage: "AWSCURRENT" }), { abortSignal: s }) }), s);
            const sql = cellParentJobsSqlAdapterV5(neon(m.databaseUrl, { fullResults: true }) as unknown as NeonSerializableSnapshotSqlClient);
            const noWriter = { query: async () => cellV3Fail("CELL_PARENT_V5_GATE_DB_WRITE_FORBIDDEN") };
            return new NeonCellParentDatabaseV4(sql, noWriter, m.certificate, CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5).readOpen(s, true);
          },
        }, signal);
      } finally { sm.destroy(); }
    }
    const evidence = createCellV3EvidenceFromCredentials(credentials, "lifecycle_coordinator"), deletion = createCellParentDeleteSdkV4(credentials);
    try {
      const registry = new AwsSdkCellParentRegistryReaderV5(clients.registry, installation, "lifecycle_coordinator", local),
        publisher = new AwsSdkCellParentProvisionPublisherV4(clients.registry, registry, evidence.reader),
        journal = new AwsSdkCellParentCleanupJournalV4(clients.registry), deleter = new AwsSdkCellParentDeleteV4(deletion.sdk),
        cleanup = new PreparedCellParentCleanupRuntimeV4({ registry, stack: evidence.reader, journal, deleter, loadDatabase: createCellParentDatabaseLoaderV5(credentials) }),
        root = createPreparedCellBirthParentRootV4({ registry, publisher, stack: evidence.reader, cleanup });
      return await root.run(event, signal);
    } finally { evidence.dispose(); deletion.dispose(); }
  } catch { return cellV3Fail("CELL_PARENT_V5_INVOCATION_REJECTED_INSPECT_ONLY"); }
  finally { clients.dispose(); }
}
