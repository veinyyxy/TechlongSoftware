// In-memory capabilities only: JSON, later Date.now(), and CLI flags cannot mint a new reply.
import {H,must,same,validate,verifyInspection,verifyIntent} from './plan.mjs';
const sessions=new WeakMap();
export function beginSession(m,approved,readyAt,at){validate(m,approved,at);
  must(Number.isSafeInteger(readyAt)&&at>=readyAt&&at-readyAt<180000,'HUMAN_READY');
  const ticket=Object.freeze({});sessions.set(ticket,{m,readyAt,startedAt:at,intent:null,review:null});return ticket;
}
export function assertSession(ticket,at,{beforeUpdate=false}={}){const s=sessions.get(ticket);must(s,'SESSION');
  validate(s.m,s.m.manifestSha256,at);must(at>=s.startedAt&&at>=s.readyAt&&at-s.readyAt<40*60000,'SESSION_TIME');
  if(beforeUpdate)must(at-s.readyAt<180000,'HUMAN_READY');
  if(s.intent)must(at>=s.intent.intentAt&&at-s.intent.intentAt<H.chainMs,'CHAIN_DEADLINE');return s;
}
export function attachIntent(ticket,intent,at){const s=assertSession(ticket,at,{beforeUpdate:true});must(!s.intent,'INTENT_ONCE');
  verifyIntent(s.m,intent);must(intent.intentAt>=s.startedAt&&intent.intentAt<=at&&at-intent.intentAt<30000,'INTENT_TIME');
  s.intent=structuredClone(intent);return s;
}
export function authorizeReview(ticket,review,intent,inspection,at){const s=assertSession(ticket,at);verifyInspection(s.m,intent,inspection);
  must(same(intent,s.intent)&&!s.review&&intent.controlLease.expiresAt-at>=H.reviewStartMarginMs,'REVIEW_MARGIN');
  const m=s.m;
  must(review.sourceCommit===m.sourceCommit&&review.action.operation==='PublishReview'&&Number.isSafeInteger(review.createdAt)&&
    review.createdAt<=at&&at-review.createdAt<30000&&review.createdAt>=intent.intentAt&&
    review.hostingManifestSha256===m.manifestSha256&&review.hostingIntentFile===m.outputs.run+'/update-intent.json'&&
    same(review.pins,m.reviewPins)&&same(review.ci,m.ci)&&same(review.auth,m.auth)&&same(review.requestEvidence,m.requestEvidence),'DERIVED_REVIEW');
  s.review=structuredClone(review);return ticket;
}
export function assertReviewSession(ticket,{review,lease,readyAt,at}){const s=assertSession(ticket,at);
  must(s.review&&same(review,s.review)&&same(lease,s.intent.controlLease)&&readyAt===s.readyAt&&review.action.operation==='PublishReview','REVIEW_SESSION');
}
