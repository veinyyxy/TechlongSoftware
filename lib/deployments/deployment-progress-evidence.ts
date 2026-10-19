// Server-side, bundled public evidence only. No F: filesystem, AWS/GitHub call or Secret read.
import record from '../../ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json';
import { sha256Hex } from './execution/hash.ts';
import { normalizeArchivedDeploymentEvidence } from './deployment-progress-v1.ts';

export const DEPLOYMENT_ARCHIVE_CANONICAL_SHA256 = '441957641641ebfd712ff087e5ed1329345b3c71195915452ec7741234346099';
export async function getArchivedDeploymentEvidence() {
  // Retain the original W5r record byte-for-byte; future archives need an explicit registry update.
  if (await sha256Hex(record) !== DEPLOYMENT_ARCHIVE_CANONICAL_SHA256) return null;
  return normalizeArchivedDeploymentEvidence(record);
}
