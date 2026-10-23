import {C,protocol} from './candidate.mjs';
import {B} from './source-binding.mjs';
import {sourceReview,S as LEGACY} from '../platform-image-source-v2/review.mjs';
import {must,same} from '../platform-image-publication-v2/plan.mjs';
import {RETAINED_IMAGE} from '../platform-hosted-access-v6/publication.mjs';
export function sourceContext(binding=B){
  must(/^[a-f0-9]{40}$/.test(binding.reusableCommit??'')&&Number.isSafeInteger(binding.reusableCiRun)&&
    binding.reusableCiRun>0&&binding.reusableCiWorkflow===394308354,'HOSTED_SOURCE_BINDING_NOT_READY');
  const S=Object.freeze({...LEGACY,...binding,schema:'techlong/platform-hosted-image-source-review/v2',
    tokenPrefix:'platform-hosted-publication-v2',sourceCiFile:'platform-hosted-publication-candidate.yml',
    riskFile:'docs/aws-auto-deployment-platform-w8f-publish-review.md',
    publicReviewFile:'ops/aws-sandbox/reviews/platform-hosted-publication-w8f.review.json',
    intentFile:'techlong-platform-hosted-publication-v2.source.intent.json'});
  return sourceReview({protocol,settings:S});
}
export function verifyRetained(v){protocol.verifyInventory(v);}
export function verifyFinalInventory(v,digest){
  must(!v.nextToken&&v.imageDetails?.length===2&&/^sha256:[a-f0-9]{64}$/.test(digest??''),'HOSTED_FINAL_INVENTORY');
  const old=v.imageDetails.filter(i=>i.imageDigest===RETAINED_IMAGE.digest),fresh=v.imageDetails.filter(i=>i.imageDigest===digest);
  must(old.length===1&&fresh.length===1&&digest!==RETAINED_IMAGE.digest&&
    same(fresh[0].imageTags,[C.targetTag])&&fresh[0].registryId===C.account&&fresh[0].repositoryName===C.ecrRepository,'HOSTED_FINAL_NEW_IMAGE');
  verifyRetained({imageDetails:old});
}
