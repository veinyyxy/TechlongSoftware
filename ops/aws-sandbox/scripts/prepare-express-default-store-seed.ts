import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compileExpressDefaultStoreSeedV1 } from '../../../lib/deployments/execution/express-default-store-seed-v1.ts';
import { canonicalJson } from '../../../lib/deployments/execution/hash.ts';

/** Local metadata compiler only. Historical facts are NOT renewed permission.
 * This script does not import an AWS/SQL client, load .env or consume a slot. */
export async function prepare(args: string[]) {
  if (args.length !== 4 || args[0] !== '--review' || args[2] !== '--control-plane' || !args[1] || !args[3]) {
    throw Error('EXPRESS_DEFAULT_STORE_SEED_ARGUMENTS_REJECTED');
  }
  const files = await Promise.all([args[1], args[3]].map(async p => {
    const bytes = await readFile(p); if (bytes.length > 256_000) throw Error('EXPRESS_DEFAULT_STORE_SEED_INPUT_TOO_LARGE');
    return JSON.parse(bytes.toString('utf8'));
  }));
  const [r, observed] = files;
  if (observed.mode !== 'InspectOnly' || observed.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED' ||
      observed.result.materialSha256 !== r.materialSha256 || Object.values(observed.result.checks).some(v => v !== true) ||
      !observed.proposal || observed.executionAuthorized !== false) throw Error('EXPRESS_DEFAULT_STORE_SEED_DISCOVERY_REQUIRED');
  const candidate = await compileExpressDefaultStoreSeedV1({ material: r.material, materialSha256: r.materialSha256,
    subscriptionId: observed.result.subscriptionId });
  if (canonicalJson(candidate.scope) !== canonicalJson(observed.proposal.scope)) throw Error('EXPRESS_DEFAULT_STORE_SEED_OWNER_PROPOSAL_CHANGED');
  return { mode: 'PrepareOnly', candidate, controlPlaneObservedAt: observed.result.completedAt,
    controlPlaneMustBeRepeatedBeforeActualWrite: true, approvalManifestIssued: false, sqlConnections: 0, writes: 0, executionAuthorized: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await prepare(process.argv.slice(2)), null, 2)); }
  catch { console.error('EXPRESS_DEFAULT_STORE_SEED_PREPARE_FAILED_NO_WRITE'); process.exitCode = 1; }
}
