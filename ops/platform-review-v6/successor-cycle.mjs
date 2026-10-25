// W8z fixed new-job profile. No service access, activation or manifest-selected ports.
import {NEXT,NEXT_PROFILE} from '../platform-request-v6/transfer-next.mjs';
import {CYCLE_SCOPE,compileCycleReview,must,same} from './cycle-plan.mjs';
import {LAUNCH,parseLaunchArgs,assertLaunchOnline,compilePreconfirmedReadiness} from './cycle-launch.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
export const SUCCESSOR_REVIEW=Object.freeze({target:NEXT,reader:NEXT_PROFILE.reader,verifyReadback:NEXT_PROFILE.verifyReadback,
  anchorSchema:'techlong/held-successor-review-anchor/v6'});
export const SUCCESSOR_BASE=Object.freeze({definition:'arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-platform-web-v1:7',
  rootEventId:'cf550b50-d034-11f1-92cf-06fff46e9227',sourceCommit:'320be62add8fad5ad3f05ff40d44612b0b87e493',
  windowClosure:'F:/ChatGPT_workshop/techlong-w8w-review-handoff-stopped-independently-verified-20261025-a.json',
  windowClosureSha256:'aba7a69b78b0790f5e56eebd2d1c92b88a98387c36268f5b3fd578e501da8394',
  taskClosure:'F:/ChatGPT_workshop/techlong-w8y-held-handoff-executed-verified-20261025-a.json',
  taskClosureSha256:'e8bca8a71717d4214e4e10c4d0da74aee0cdebfd916ac299859f7a9b83847ce6'});
export const SUCCESSOR_CYCLE=Object.freeze({...LAUNCH,jobId:NEXT.newJobId,slot:'F:/ChatGPT_workshop/techlong-w8z-hosted-cycle.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8z-hosted-cycle-inspect.intent.json',riskFile:'docs/aws-auto-deployment-platform-w8z-successor-review.md'});
export const SUCCESSOR_SLOTS=Object.freeze({publicationSlot:'F:/ChatGPT_workshop/techlong-w8z-review-publish.intent.json',
  handoffSlot:'F:/ChatGPT_workshop/techlong-w8z-hosted-handoff.intent.json'});
// Test injection is an explicit code capability only; production wrapper below
// always uses SUCCESSOR_REVIEW, never a profile recovered from a saved manifest.
export async function compileSuccessorReview(input,reviewProfile=SUCCESSOR_REVIEW){
  const p=input.preparation;
  must(p?.baseline?.rootEventId===SUCCESSOR_BASE.rootEventId&&p.parentTaskClosureSha256===SUCCESSOR_BASE.taskClosureSha256&&
    p.parentHostingClosureSha256===SUCCESSOR_BASE.windowClosureSha256&&Number.isSafeInteger(p.factsAt)&&
    p.createdAt>=p.factsAt&&p.expiresAt===p.factsAt+48*3600000&&Number.isSafeInteger(p.baseline.oldLease?.expiresAt),'SUCCESSOR_BASELINE');
  const profile={cycle:SUCCESSOR_CYCLE,reviewProfile,baselineDefinition:SUCCESSOR_BASE.definition,
    schema:'techlong/held-successor-hosted-cycle-review/v6',
    scope:{...CYCLE_SCOPE,humanOnlineFreshMs:90000,humanOnlineMinutes:40,pageConfirmationBeforeWindow:true,authenticatedPageRecheckedAfterUpdate:false},
    binding:{...SUCCESSOR_SLOTS,slot:SUCCESSOR_CYCLE.slot,inspectSlot:SUCCESSOR_CYCLE.inspectSlot,
      baselineRootEventId:SUCCESSOR_BASE.rootEventId,parentTaskClosureSha256:SUCCESSOR_BASE.taskClosureSha256,
      parentClosureSha256:SUCCESSOR_BASE.windowClosureSha256,tokenPrefix:'platform-successor-',
      additionalRetiredDefinitions:[4,5,6].map(n=>'arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-platform-web-v1:'+n)},
    clocks:'Fresh page-normal +40min human confirmation <=90s before entry; original expired lease never reused; new30min window only after exact approval; new Review then separate manual RunOnce approvals; cloud claim15min not extended'};
  const {manifestSha256:ignored,...body}=await compileCycleReview(input,profile);void ignored;
  const result={...body,notBeforeAt:Math.max(input.createdAt,p.baseline.oldLease.expiresAt)};
  return {...result,manifestSha256:await sha256Hex(result)};
}
export const makeSuccessorReview=input=>compileSuccessorReview(input);
export async function validateSuccessorReview(m,sha,at,{inspect=false,running=false}={}){
  must(same(m,await makeSuccessorReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  must(Number.isSafeInteger(at)&&at>=m.createdAt&&(inspect||at>=m.notBeforeAt&&at<(running?m.expiresAt:m.latestStartAt)),'APPROVAL_EXPIRED_OR_TOO_EARLY');return m;
}
export const parseSuccessorCycleArgs=parseLaunchArgs;
export const assertSuccessorOnline=assertLaunchOnline;
export const successorReadiness=input=>compilePreconfirmedReadiness(input,SUCCESSOR_CYCLE);
