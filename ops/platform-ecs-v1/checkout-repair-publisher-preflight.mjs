import { verifySnapshot } from '../platform-image-source-v2/aws.mjs';
import { dahliaFirstPurchaseProtocol } from '../platform-registration-publish-v1/contract.mjs';
import { hash } from '../platform-image-publication-v2/plan.mjs';

// The previous publication's independent readback used this exact Revoke
// template, not the original role foundation (which had ECR Allow statements).
export const CHECKOUT_PREVIOUS_REVOKE_SHA256='9841a46b931a221eeb3564fdf70c59a9ecfa272e5c8ef1ffd27e2c41308cf109';

export function checkoutPreviousRevokeTemplate(previousReview){
  const expected=dahliaFirstPurchaseProtocol.templates(previousReview).revoke;
  if(hash(JSON.stringify(expected))!==CHECKOUT_PREVIOUS_REVOKE_SHA256)throw Error('CHECKOUT_PREVIOUS_REVOKE_CHANGED');
  return expected;
}

export function verifyCheckoutRepairPublisherLocked(snapshot,previousReview){
  return verifySnapshot(snapshot,checkoutPreviousRevokeTemplate(previousReview));
}
