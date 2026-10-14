import compiler from './aurora-express-bootstrap-v3.cjs';
import type { AuroraLifecycleScope } from './aurora-lifecycle-v2.ts';

export interface ExpressManagementTargetV3 {
  readonly schema: 'techlong/express-management-target/v3';
  readonly clusterArn: string; readonly clusterResourceId: string; readonly endpoint: string; readonly port: 5432;
  readonly observedEngineVersion: '17.9'; readonly managementDatabase: 'postgres'; readonly managementUsername: 'postgres';
  readonly stableIdentity: string; readonly resourceGeneration: 1; readonly tenantDatabase: string; readonly tenantUsername: string;
}
/** Pre-Secret SQL review data, NOT a v2 runtime binding or executable manifest.
 * Exact real resource facts, fresh approval and a permanent attempt root remain
 * required. No synthetic Secret ARN or v2 activation is generated. */
export const parseExpressManagementTargetV3 = (raw: unknown): ExpressManagementTargetV3 => compiler.parseManagementTargetV3(raw);
export function compileExpressBootstrapCandidateV3(input: {
  target: ExpressManagementTargetV3; scope: AuroraLifecycleScope; nonce: string;
}) {
  return compiler.compileExpressBootstrapV3(input);
}
export const expressBootstrapCandidateDigestV3 = (candidate: unknown): string => compiler.digest(candidate);
