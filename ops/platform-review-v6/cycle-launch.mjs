// Fixed W8w profile: a truthful pre-window page statement, not a forged later view.
import {CYCLE,CYCLE_SCOPE,compileCycleReview,must,same} from './cycle-plan.mjs';
import {parseNextArgs,assertNextOnline,assertNextAvailable} from './cycle-next.mjs';
import {assertHostedHandoffLease} from './hosted-handoff.mjs';
import {K,P} from '../platform-hosted-window-v6/contract.mjs';
import {readinessDeadlines} from '../platform-operations-v6/window.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
export const LAUNCH=Object.freeze({...CYCLE,slot:'F:/ChatGPT_workshop/techlong-w8w-hosted-cycle.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8w-hosted-cycle-inspect.intent.json',riskFile:'docs/aws-auto-deployment-platform-w8w-preconfirmed-review.md'});
export const LAUNCH_SLOTS=Object.freeze({publicationSlot:'F:/ChatGPT_workshop/techlong-w8w-review-publish.intent.json',
  handoffSlot:'F:/ChatGPT_workshop/techlong-w8w-hosted-handoff.intent.json'});
export const LAUNCH_BASE=Object.freeze({definition:`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:6`,
  rootEventId:'268b7f80-d030-11f1-88a1-06ffe310ff0d',sourceCommit:'ecf51e9496b04790a322b4b2475f99b42341a416',
  closure:'F:/ChatGPT_workshop/techlong-w8v-window-stopped-independently-verified-20261025-a.json',
  closureSha256:'c7d246c197c15b1d3552f3016f2f8bd25886f812a1024c76ae638e2fb1b6a26c'});
const PROFILE=Object.freeze({cycle:LAUNCH,baselineDefinition:LAUNCH_BASE.definition,schema:'techlong/preconfirmed-hosted-cycle-review/v6',
  scope:{...CYCLE_SCOPE,humanOnlineFreshMs:90000,humanOnlineMinutes:40,pageConfirmationBeforeWindow:true,authenticatedPageRecheckedAfterUpdate:false},
  binding:{...LAUNCH_SLOTS,slot:LAUNCH.slot,inspectSlot:LAUNCH.inspectSlot,baselineRootEventId:LAUNCH_BASE.rootEventId,
    parentClosureSha256:LAUNCH_BASE.closureSha256,tokenPrefix:'platform-preconfirmed-',
    additionalRetiredDefinitions:[4,5].map(n=>`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:${n}`)},
  clocks:'Fresh page-normal and continuous40min confirmation <=90s before entry; wait until previous lease expires; actual new lease30min; original cloud claim15min not extended'});
export async function makeLaunchReview(input){
  const p=input.preparation;must(p?.baseline?.rootEventId===LAUNCH_BASE.rootEventId&&p.parentClosureSha256===LAUNCH_BASE.closureSha256&&
    Number.isSafeInteger(p.factsAt)&&p.createdAt>=p.factsAt&&p.expiresAt===p.factsAt+48*3600000&&
    Number.isSafeInteger(p.baseline.oldLease?.expiresAt),'LAUNCH_BASELINE');
  const {manifestSha256:ignored,...base}=await compileCycleReview(input,PROFILE);void ignored;
  const body={...base,notBeforeAt:Math.max(input.createdAt,p.baseline.oldLease.expiresAt)};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateLaunchReview(m,sha,at,{inspect=false,running=false}={}){
  must(same(m,await makeLaunchReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  must(Number.isSafeInteger(at)&&at>=m.createdAt&&(inspect||at>=m.notBeforeAt&&at<(running?m.expiresAt:m.latestStartAt)),'APPROVAL_EXPIRED_OR_TOO_EARLY');return m;
}
export function parseLaunchArgs(args){
  const rest=[],page=[];for(let n=0;n<args.length;n+=2){if(args[n]==='--page-viewed-before-window')page.push(args[n+1]);else rest.push(args[n],args[n+1]);}
  const a=parseNextArgs(rest);must(a['--mode']!=='ConfirmPage'&&page.length===(a['--mode']==='RunReviewed'?1:0)&&page.every(v=>v==='yes'),'PREWINDOW_PAGE_ARGUMENT');
  if(page.length)a['--page-viewed-before-window']=page[0];return a;
}
export function assertLaunchOnline(a,m,at){
  must(a['--page-viewed-before-window']==='yes','PREWINDOW_PAGE_REQUIRED');
  return {...assertNextOnline(a,m,at),pageViewedBeforeWindow:true,authenticatedPageRecheckedAfterUpdate:false};
}
export async function preconfirmedReadiness({manifest:m,online,manifestSha256,scope,lease,release,hosting,checkedAt}){
  return compilePreconfirmedReadiness({manifest:m,online,manifestSha256,scope,lease,release,hosting,checkedAt});
}
export async function compilePreconfirmedReadiness({manifest:m,online,manifestSha256,scope,lease,release,hosting,checkedAt},cycle=LAUNCH){
  must(manifestSha256===m.manifestSha256&&same(release,m.binding.platform)&&scope.sourceCommit===m.sourceCommit&&scope.jobId===cycle.jobId&&
    online?.manifestSha256===manifestSha256&&online.sourceCommit===m.sourceCommit&&online.pageViewedBeforeWindow===true&&
    online.authenticatedPageRecheckedAfterUpdate===false&&online.confirmedAt<=lease.issuedAt&&
    checkedAt>=lease.issuedAt&&checkedAt<readinessDeadlines(lease).pageReadyBy,'PRECONFIRMED_BINDING');
  assertNextAvailable(online,lease.expiresAt,checkedAt);await assertHostedHandoffLease(lease,release,scope,checkedAt);
  must(hosting?.stackId===K.stackId&&Object.keys(hosting).sort().join(',')==='stackId,taskDefinition'&&
    new RegExp(`^arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:[1-9][0-9]*$`).test(hosting.taskDefinition),'PRECONFIRMED_HOSTING');
  return {schema:'techlong/hosted-preconfirmed-readiness/v6',manifestSha256,...scope,...hosting,leaseSha256:await sha256Hex(lease),checkedAt,
    humanReadyUntil:lease.expiresAt,humanConfirmedAt:online.confirmedAt,pageViewedBeforeWindow:true,publicProbePassed:true,
    authenticatedPageRecheckedAfterUpdate:false,notPlanApproval:true};
}
