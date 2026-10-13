import { cellV3Fail, CELL_LIFECYCLE_COORDINATOR_V3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellParentInstallationReaderV4, type CellParentInstallationSdkV4, type CellParentInstallationProfileV4,
  type CellParentLocalRuntimeV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";
import type { CellParentRuntimeBindingV4 } from "./cell-birth-parent-v4.ts";
import { AwsSdkCellParentRegistryReaderV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";

export const CELL_PARENT_FUNCTION_NAME_V5 = "techlong-sandbox-cell-lifecycle-coordinator-v3";
/** F3c9e's actual committed, independently double-read protection catalog. */
export const CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 = "015db4276a151d5c0dd0fb96cdb6df214af40fc8be89c8d6d955071b4c7340b9";
/** Only the two representations of the SAME $LATEST function. No prefix,
 * alias, numeric version, region/account substitution or code normalization. */
export function normalizeCellParentLatestArnV5(arn: unknown, name: unknown, version: unknown) {
  if (name !== CELL_PARENT_FUNCTION_NAME_V5 || version !== "$LATEST" ||
    (arn !== CELL_LIFECYCLE_COORDINATOR_V3 && arn !== `${CELL_LIFECYCLE_COORDINATOR_V3}:$LATEST`)) cellV3Fail("CELL_PARENT_V5_LATEST_IDENTITY_INVALID");
  return CELL_LIFECYCLE_COORDINATOR_V3;
}
export function normalizeCellParentConfigV5(f: Record<string, unknown>): Record<string, unknown> {
  const FunctionArn = normalizeCellParentLatestArnV5(f.FunctionArn, f.FunctionName, f.Version);
  if (f.Layers !== undefined && f.Layers !== null && (!Array.isArray(f.Layers) || f.Layers.length)) cellV3Fail("CELL_PARENT_V5_LAYERS_INVALID");
  return { ...f, FunctionArn, ...(f.Layers === null ? { Layers: [] } : {}) };
}
export function normalizeCellParentLocalV5(local: CellParentLocalRuntimeV4) {
  return { ...local, invokedFunctionArn: normalizeCellParentLatestArnV5(local.invokedFunctionArn, local.functionName, local.functionVersion) };
}
/** Preserves V4's genuine private proof brand and every policy, ZIP, Revision,
 * actual-running-bundle, trust, identity and double-read check. Historical
 * approved V4 sources remain byte-for-byte unchanged. */
export class AwsSdkCellParentInstallationReaderV5 extends AwsSdkCellParentInstallationReaderV4 {
  constructor(sdk: CellParentInstallationSdkV4, profile: CellParentInstallationProfileV4, now: () => number = Date.now) {
    const send = sdk.lambda.send.bind(sdk.lambda);
    super({ ...sdk, lambda: { send: async (command, options) => normalizeCellParentConfigV5(await send(command, options)) } }, profile, now);
  }
  override read(binding: CellParentRuntimeBindingV4, stackId: string, signal: AbortSignal, local?: CellParentLocalRuntimeV4) {
    return super.read(binding, stackId, signal, local === undefined ? undefined : normalizeCellParentLocalV5(local));
  }
}
/** Also bind protection BEFORE provision publication, not just when a later
 * cleanup branch loads its DB material. V4 registry proof remains genuine. */
export class AwsSdkCellParentRegistryReaderV5 extends AwsSdkCellParentRegistryReaderV4 {
  override async readStrong(signal: AbortSignal) {
    const parent = await super.readStrong(signal);
    if (parent && parent.record.manifest.failedProtectionSha256 !== CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5) cellV3Fail("CELL_PARENT_V5_REGISTERED_PROTECTION_MISMATCH");
    return parent;
  }
}

// Exact old statement, not a regex rewriting arbitrary SQL. All other SQL,
// parameter arrays, query objects and transaction settings remain unchanged.
export const CELL_PARENT_LEGACY_JOBS_SQL_V5 = "SELECT j.id FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=$1 AND j.status IN ('queued','running') ORDER BY j.id";
export const CELL_PARENT_JOBS_SQL_V5 = "SELECT j.id FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=$1 AND j.status IN ('pending','running','retry_wait') ORDER BY j.id";
export function cellParentJobsSqlAdapterV5(sql: NeonSerializableSnapshotSqlClient): NeonSerializableSnapshotSqlClient {
  const transaction = sql.transaction.bind(sql);
  const adapter: NeonSerializableSnapshotSqlClient = { transaction: (queries, options) => transaction(tx => queries({ query: (statement, values) =>
    tx.query(statement === CELL_PARENT_LEGACY_JOBS_SQL_V5 ? CELL_PARENT_JOBS_SQL_V5 : statement, values) }), options) };
  return Object.freeze(adapter);
}
