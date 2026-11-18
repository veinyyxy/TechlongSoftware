// Existing Grant/once/always-Revoke coordinator, restricted to exact overlay lineages.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { C, protocol, firstPurchaseProtocol, verifyRetained, verifyFinalInventory } from './contract.mjs';
import { sourceAdapter } from '../platform-hosted-publication-v2/source.mjs';
import { sourceReview, S as LEGACY } from '../platform-image-source-v2/review.mjs';
import { errorCode } from '../platform-image-source-v2/runner.mjs';
import { must } from '../platform-image-publication-v2/plan.mjs';

function overlayContext(candidateProtocol,overlaySettings) {
  const settings=Object.freeze({...LEGACY,reusableCiWorkflow:422828156,sourceCiFile:'sandbox-registration-publication-checks.yml',...overlaySettings});
  const base=sourceReview({protocol:candidateProtocol,settings});
  const validateOuter=(text,sha,now=Date.now())=>{
    const m=base.validateOuter(text,sha,now);
    // One hour for Grant+Revoke inside the five-hour deployment facts rule.
    must(now<Date.parse(m.issuedAt)+(4*3600-120)*1000,'REGISTRATION_PUBLICATION_FACTS_EXPIRED');
    return m;
  };
  return Object.freeze({...base,validateOuter});
}
export function sourceContext() {
  return overlayContext(protocol,{
    reusableCommit:'0b076037eaf04f9a47957548ebe36a454546d641',reusableCiRun:44346591038,
    schema:'techlong/sandbox-registration-image-source-review/v1',tokenPrefix:'registration-overlay-06d91b3e',
    riskFile:'docs/evidence/sandbox-registration-ecr-publication.prepared.json',
    publicReviewFile:'docs/evidence/sandbox-registration-ecr-publication.review.json',intentFile:'techlong-sandbox-registration-ecr-06d91b3e.intent.json'});
}
export function firstPurchaseSourceContext() {
  return overlayContext(firstPurchaseProtocol,{
    reusableCommit:'e7b2ee7ced834c065d4b9e414d4bb9d8bb6ddb42',reusableCiRun:44374702310,
    schema:'techlong/sandbox-first-purchase-image-source-review/v1',tokenPrefix:'first-purchase-overlay-b344a2e3',
    riskFile:'docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json',
    publicReviewFile:'docs/evidence/sandbox-first-purchase-activation-consolidated.review.json',
    intentFile:'techlong-sandbox-first-purchase-ecr-b344a2e3.intent.json'});
}
const dir='ops/platform-registration-publish-v1';
const cloudRoots=[`${dir}/cloud.mjs`,`${dir}/artifact.mjs`,`${dir}/preflight.sh`,`${dir}/extract.py`,
  `.github/workflows/${C.reusableFile}`,'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json',
  'docs/evidence/sandbox-registration-platform-candidate.observed.json','docs/evidence/sandbox-registration-ecr-publication.prepared.json'];
const adapter=sourceAdapter({candidate:C,protocol,sourceContext,verifyRetained,verifyFinalInventory,cloudRoots,
  sourceEntry:`${dir}/source.mjs`,testFile:'tests/sandbox-registration-publication.test.mjs',
  reviewPattern:/^F:\/ChatGPT_workshop\/techlong-sandbox-registration-ecr-review-[a-z0-9-]+\.json$/,
  // Reuse the coordinator's allowed private evidence-family directory; the
  // nonce, approval manifest, temporary request tokens and slot are unique.
  directoryPrefix:'techlong-platform-recovery-image-v1',inspectPrefix:'techlong-sandbox-registration-ecr-inspect',
  metadataFiles:['docs/auto-pending-provisioning.md','docs/aws-auto-deployment-execution-runbook.md','docs/aws-auto-deployment-mainline.md']});
const firstPurchaseAdapter=sourceAdapter({candidate:firstPurchaseProtocol.P,protocol:firstPurchaseProtocol,
  sourceContext:firstPurchaseSourceContext,verifyRetained:firstPurchaseProtocol.verifyRetained,verifyFinalInventory:firstPurchaseProtocol.verifyFinalInventory,
  cloudRoots:[...cloudRoots,'docs/evidence/sandbox-first-purchase-replacement.observed.json','docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json'],
  sourceEntry:`${dir}/source.mjs`,testFile:'tests/sandbox-registration-publication.test.mjs',
  reviewPattern:/^F:\/ChatGPT_workshop\/techlong-sandbox-first-purchase-ecr-review-[a-z0-9-]+\.json$/,
  directoryPrefix:'techlong-platform-recovery-image-v1',inspectPrefix:'techlong-sandbox-first-purchase-ecr-inspect',
  metadataFiles:['docs/aws-sandbox-first-purchase-activation-preparation.md','docs/aws-auto-deployment-execution-runbook.md','docs/aws-auto-deployment-mainline.md',
    'docs/evidence/sandbox-first-purchase-activation-prerequisites.observed.json']});
export const main=(...args)=>adapter.main(...args);
export const firstPurchaseMain=(...args)=>firstPurchaseAdapter.main(...args);
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)(process.argv[2]==='--first-purchase'?
  firstPurchaseMain(process.argv.slice(3)):main())
  .then(r=>{console.log(JSON.stringify(r));if(r.outcome==='REQUIRES_INDEPENDENT_INSPECT')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'REGISTRATION_PUBLICATION_STOPPED',code:errorCode(e),automaticRetry:false}));process.exitCode=1;});
