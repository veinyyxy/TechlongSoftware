import db from './aurora-database-contract-v2.cjs';
import createWire from './aurora-lifecycle-wire-v2.cjs';
import type { DatabaseBindingV2 } from './aurora-database-v2.ts';
const wire = createWire(db);
export type AuroraLifecycleOperation = 'inspect' | 'prepare_empty_database' | 'restore_approved_baseline' | 'migrate_saas' | 'verify' | 'destroy';
export interface AuroraLifecycleScope {
  appInstanceId: string; workspaceId: string; productId: string; environmentId: string; cellKey: 'cell-sandbox-1';
}
export interface AuroraLifecyclePredecessor {
  stableIdentity: string; resourceGeneration: number; epoch: number; intent: 'provision' | 'cleanup';
  ownerDeploymentId: string; marker: string; operationHash: string; bindingSha256: string;
}
export interface AuroraLifecycleTaskV2 {
  readonly schemaVersion: 2; readonly protocol: 'aurora_v2'; readonly operation: AuroraLifecycleOperation;
  readonly scope: Readonly<AuroraLifecycleScope>; readonly ownerDeploymentId: string;
  readonly binding: DatabaseBindingV2; readonly bindingSha256: string; readonly ownershipMarker: string;
  readonly externalFence: Readonly<{ epoch: number; intent: 'provision' | 'cleanup'; marker: string; operationHash: string;
    predecessor: Readonly<AuroraLifecyclePredecessor> | null }>;
  readonly baseline: Readonly<{ archiveSha256: string; manifestSha256: string }>;
}
export const auroraLifecycleModeV2: string = wire.MODE;
export const auroraLifecycleEntrypointV2: readonly string[] = wire.ENTRYPOINT;
export const createAuroraLifecycleTaskV2 = (input: { operation: AuroraLifecycleOperation; scope: AuroraLifecycleScope;
  ownerDeploymentId: string; binding: DatabaseBindingV2; epoch: number; intent?: 'provision' | 'cleanup';
  provisionPredecessor?: AuroraLifecyclePredecessor | null }): AuroraLifecycleTaskV2 => wire.createTask(input);
export const parseAuroraLifecycleTaskV2 = (raw: unknown, command: AuroraLifecycleOperation): AuroraLifecycleTaskV2 => wire.parseTask(raw, command);
export const auroraLifecycleTaskDigestV2 = (raw: AuroraLifecycleTaskV2): string => wire.taskHash(raw);
export const encodeAuroraLifecycleTaskV2 = (raw: AuroraLifecycleTaskV2): string => wire.encodeTask(raw);
export const decodeAuroraLifecycleTaskV2 = (raw: string, digest: string, command: AuroraLifecycleOperation): AuroraLifecycleTaskV2 => wire.decodeTask(raw, digest, command);

/** This prepares only the new diagnostic invocation. Full continues through
 * its unchanged prepared-v2 path; no cross-protocol capability translation. */
export function compileAuroraInspectionInvocationV2(raw: unknown) {
  const task = parseAuroraLifecycleTaskV2(raw, 'inspect');
  if (task.binding.profile !== 'express_iam') throw Error('AURORA_V2_USE_LEGACY_FULL_PROTOCOL');
  return Object.freeze({ protocol: 'aurora_v2', command: Object.freeze(['inspect']),
    entrypoint: auroraLifecycleEntrypointV2,
    definitionEnvironment: Object.freeze({ APP_RUNTIME_MODE: wire.MODE, NODE_ENV: 'production', AWS_REGION: 'ca-central-1',
      PG_DATABASE_PROFILE: 'express_iam', PGSSLMODE: 'verify-full', PGSSL_REJECT_UNAUTHORIZED: 'true', PGSSLROOTCERT: '' }),
    overrideEnvironment: Object.freeze({ TENANT_AURORA_TASK_JSON: wire.encodeTask(task), TENANT_AURORA_TASK_SHA256: wire.taskHash(task) }),
    coordinates: wire.coordinates(task), epochRecordCandidate: wire.epochRecord(task),
    receiptProtocol: 'aurora-lifecycle-inspection/v2', writeCommandsAvailable: false, executionAuthorized: false, runtimeEnabled: false });
}
