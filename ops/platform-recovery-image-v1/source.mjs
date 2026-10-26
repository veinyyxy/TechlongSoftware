// Code-only profile of the existing one-grant/one-push/always-revoke controller.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {C,protocol,verifyRetained,verifyFinalInventory} from './candidate.mjs';
import {sourceContext} from './source-review.mjs';
import {sourceAdapter} from '../platform-hosted-publication-v2/source.mjs';
import {errorCode} from '../platform-image-source-v2/runner.mjs';
export const CLOUD_ROOTS=Object.freeze(['ops/platform-recovery-image-v1/cloud.mjs','ops/platform-recovery-image-v1/artifact.mjs',
  'ops/platform-recovery-image-v1/preflight.sh','ops/platform-image-publication-v1/extract.py',
  '.github/workflows/platform-image-recovery-publish-job-v1.yml','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json']);
const adapter=sourceAdapter({candidate:C,protocol,sourceContext,verifyRetained,verifyFinalInventory,cloudRoots:CLOUD_ROOTS,
  sourceEntry:'ops/platform-recovery-image-v1/source.mjs',testFile:'tests/platform-recovery-image-v1.test.mjs',
  reviewPattern:/^F:\/ChatGPT_workshop\/techlong-w9o-recovery-image-review-[a-z0-9-]+\.json$/,
  directoryPrefix:'techlong-platform-recovery-image-v1',inspectPrefix:'techlong-w9o-recovery-image-inspect',
  metadataFiles:['docs/aws-auto-deployment-w9o-recovery-image-publication-prepared.md',
    'ops/aws-sandbox/reviews/platform-recovery-image-v1.prepared.json']});
export const main=(...args)=>adapter.main(...args);
export const revokeOnce=(...args)=>adapter.revokeOnce(...args);
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>{console.log(JSON.stringify(r));if(r.outcome==='REQUIRES_INDEPENDENT_INSPECT')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'RECOVERY_IMAGE_SOURCE_STOPPED',errorCode:errorCode(e),automaticRetry:false}));process.exitCode=1;});
