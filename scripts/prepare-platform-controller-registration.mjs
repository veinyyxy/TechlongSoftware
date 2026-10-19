// Offline, public files only. This does not read env, authenticate, open a URL or
// register an App. --prepare prints a review; --check checks the committed review.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { platformControllerRegistrationPlan, platformControllerRegistrationUrl } from '../lib/deployments/platform-controller-registration-v1.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';

const ROOT = new URL('../', import.meta.url);
export const REGISTRATION_REVIEW_PATH = 'ops/aws-sandbox/reviews/platform-controller-registration-w6b.prepared.json';
export const REGISTRATION_SOURCE_FILES = Object.freeze([
  'lib/deployments/platform-controller-registration-v1.ts',
  'scripts/prepare-platform-controller-registration.mjs',
  'tests/platform-controller-registration-v1.test.ts',
  '.github/workflows/cloud-worker-execute.yml', '.github/workflows/cloud-worker-job.yml',
  'ops/cloud-worker/activation/runtime-v5.mjs', 'ops/cloud-worker/install/plan-v5.mjs',
  'scripts/local-deployment-platform.mjs', 'ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json',
]);

export async function prepareRegistrationReview() {
  const sourcePins = [];
  for (const file of REGISTRATION_SOURCE_FILES) {
    const content = (await readFile(new URL(file, ROOT), 'utf8')).replace(/\r\n/g, '\n');
    sourcePins.push({ file, normalizedLfSha256: createHash('sha256').update(content).digest('hex') });
  }
  const subject = { schema: 'techlong/platform-controller-registration-review/v1',
    state: 'PREPARED_NOT_REGISTERED_NOT_INSTALLED_NOT_ACTIVATED',
    plan: platformControllerRegistrationPlan(), registrationUrl: platformControllerRegistrationUrl(), sourcePins,
    currentActorId: '14145707', currentDeploymentWorkflowsAndTrustPreserved: true,
    appIdentityKnown: false, privateKeyRead: false, cloudOrDatabaseWrites: 0, workflowDispatches: 0,
    nextAfterApproval: 'Manual registration and single-repository installation only. Record public IDs; review settings. Credentials, identity probe, SQL install and workflow/trust publication need separate approval.',
  };
  return { subject, manifestSha256: await sha256Hex(subject) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--prepare', '--check'].includes(args[0])) throw new Error('Use --prepare or --check only.');
  const review = await prepareRegistrationReview();
  if (args[0] === '--prepare') return console.log(JSON.stringify(review, null, 2));
  const saved = JSON.parse(await readFile(new URL(REGISTRATION_REVIEW_PATH, ROOT), 'utf8'));
  if (saved.manifestSha256 !== review.manifestSha256 || await sha256Hex(saved.subject) !== review.manifestSha256)
    throw new Error('REGISTRATION_REVIEW_STALE_OR_CHANGED: no external action performed.');
  console.log(JSON.stringify({ state: 'PREPARED_ONLY_VERIFIED', manifestSha256: review.manifestSha256,
    sourcePinsVerified: review.subject.sourcePins.length, externalCalls: 0, credentialReads: 0, writes: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(() => { console.error('REGISTRATION_PREPARATION_STOPPED: no external action or credential access.'); process.exitCode = 1; });
