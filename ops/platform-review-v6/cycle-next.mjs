// Fixed successor profile. Importing this module performs no service I/O.
import {CYCLE,CYCLE_SCOPE,compileCycleReview,must,same} from './cycle-plan.mjs';
import {parseCycleArgs} from './cycle-local.mjs';
import {P} from '../platform-hosted-window-v6/contract.mjs';
export const NEXT_CYCLE=Object.freeze({...CYCLE,
  slot:'F:/ChatGPT_workshop/techlong-w8v-hosted-cycle.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8v-hosted-cycle-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8v-execution-review.md'});
export const NEXT_SLOTS=Object.freeze({publicationSlot:'F:/ChatGPT_workshop/techlong-w8v-review-publish.intent.json',
  handoffSlot:'F:/ChatGPT_workshop/techlong-w8v-hosted-handoff.intent.json'});
export const NEXT_BASE=Object.freeze({definition:`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:5`,
  rootEventId:'25e53060-d00f-11f1-8cb6-02ad2146c393',
  closure:'F:/ChatGPT_workshop/techlong-w8u-window-stopped-independently-verified-20261024-a.json',
  closureSha256:'a8e4dea0fe3737af541e876a28c59876c08fe34d0e1852bd50bf13505d5904cc'});
const PROFILE=Object.freeze({cycle:NEXT_CYCLE,baselineDefinition:NEXT_BASE.definition,
  schema:'techlong/transferred-hosted-next-cycle-review/v6',scope:{...CYCLE_SCOPE,humanOnlineFreshMs:90000,humanOnlineMinutes:40},
  binding:{baselineRootEventId:NEXT_BASE.rootEventId,parentClosureSha256:NEXT_BASE.closureSha256,
    tokenPrefix:'platform-next-cycle-',additionalRetiredDefinitions:[`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:4`],
    ...NEXT_SLOTS,slot:NEXT_CYCLE.slot,inspectSlot:NEXT_CYCLE.inspectSlot},
  clocks:'Fresh explicit human online confirmation <=90s before entry; available40min; 30min lease from actual UpdateStack intent; original cloud claim15min not extended'});
export async function makeNextCycleReview(input){
  const p=input.preparation;
  must(p?.baseline?.rootEventId===NEXT_BASE.rootEventId&&p.parentClosureSha256===NEXT_BASE.closureSha256&&
    Number.isSafeInteger(p.factsAt)&&p.createdAt>=p.factsAt&&p.expiresAt===p.factsAt+48*3600000,'NEXT_BASELINE');
  return compileCycleReview(input,PROFILE);
}
export async function validateNextCycleReview(m,sha,at,{inspect=false,running=false}={}){
  must(same(m,await makeNextCycleReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  must(Number.isSafeInteger(at)&&at>=m.createdAt&&(inspect||at<(running?m.expiresAt:m.latestStartAt)),'APPROVAL_EXPIRED');return m;
}
export function parseNextArgs(args){
  const remaining=[],online=[];
  for(let n=0;n<args.length;n+=2){if(args[n]==='--human-online-at-ms')online.push(args[n+1]);else remaining.push(args[n],args[n+1]);}
  const a=parseCycleArgs(remaining);
  must(online.length===(a['--mode']==='RunReviewed'?1:0)&&online.every(v=>typeof v==='string'&&/^[1-9][0-9]{12}$/.test(v)),'HUMAN_ONLINE_ARGUMENT');
  if(online.length)a['--human-online-at-ms']=online[0];return a;
}
export function assertNextOnline(a,m,now){
  const confirmedAt=Number(a['--human-online-at-ms']);
  must(Number.isSafeInteger(now)&&Number.isSafeInteger(confirmedAt)&&now>=confirmedAt&&now-confirmedAt<=90000,'HUMAN_ONLINE_STALE');
  return {schema:'techlong/human-online-before-window/v6',manifestSha256:m.manifestSha256,sourceCommit:m.sourceCommit,
    confirmedAt,humanReadyUntil:confirmedAt+40*60000,notPlanApproval:true};
}
export function assertNextAvailable(receipt,until,now){
  must(receipt?.schema==='techlong/human-online-before-window/v6'&&receipt.notPlanApproval===true&&
    Number.isSafeInteger(now)&&Number.isSafeInteger(until)&&now>=receipt.confirmedAt&&until>=now&&
    receipt.humanReadyUntil===receipt.confirmedAt+40*60000&&receipt.humanReadyUntil>=until,'HUMAN_AVAILABILITY_EXHAUSTED');
}
