import {C,protocol} from './candidate.mjs';
import {B} from './source-binding.mjs';
import {sourceReview,S as LEGACY} from '../platform-image-source-v2/review.mjs';
import {must} from '../platform-image-publication-v2/plan.mjs';
export function sourceContext(binding=B){
  must(/^[a-f0-9]{40}$/.test(binding.reusableCommit??'')&&Number.isSafeInteger(binding.reusableCiRun)&&binding.reusableCiRun>0&&
    Number.isSafeInteger(binding.reusableCiWorkflow)&&binding.reusableCiWorkflow>0,'RECOVERY_IMAGE_BINDING_NOT_READY');
  const settings=Object.freeze({...LEGACY,...binding,schema:'techlong/recovery-image-source-review/v1',
    tokenPrefix:'recovery-image-v1',sourceCiFile:'platform-recovery-image-candidate.yml',
    riskFile:'docs/aws-auto-deployment-w9o-recovery-image-publication-review.md',
    publicReviewFile:'ops/aws-sandbox/reviews/platform-recovery-image-v1.review.json',
    intentFile:'techlong-recovery-image-v1.source.intent.json'});
  return sourceReview({protocol,settings});
}
export {C};
