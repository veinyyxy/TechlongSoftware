// Exact source-selected transfer profile; no manifest/flag can select facts.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {normalizedState,assertAdmissionSnapshot} from '../platform-request-v6/state-contract.mjs';
import {compileHeldTransferProgram,verifyHeldTransferReadback} from '../platform-request-v6/transfer.mjs';
import {TARGET,SUCCESSFUL_PREDECESSOR} from './coordinates.mjs';
export const ENTRY=Object.freeze({slot:'F:/ChatGPT_workshop/techlong-a604-request-handoff-v1.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-a604-request-handoff-v1.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-a604-handoff-v1.md',configPath:'E:/NodejsProject/TechlongSoftware/.env.local'});
export const FACTS=Object.freeze({observedAt:1793107724255,checkedAt:1793107729195,databaseCheckedAt:1793107725223,expiresAt:1793126877695,
  sourceCommit:'c7d92babf75068d40559aee54e948db13d315164',jobCount:10,
  baselineSha256:'4241f9e3083ff6b6f123241ca83e0ef93e23f020ac2cb7917c2d62895cdb71e5',ledgerSha256:'dce7767ad63ae2a2dccc4fd8ed47eb85bdd77aa7ab4a501ddb4fd36a1049ff6a',
  reviewPlanSha256:'45fdaf3400e08cc7b1b1a99c7254d682246161f0f7e38b9a75a3791115f80ebb',reviewRunId:'40453693112',
  historicalPlanSha256:'636676cb2faed296b492797942328486b4089962fa23cf5ceb36ca0cdc3b461e',
  protection:Object.freeze({catalogSha256:'ff430aee9aa57bdee25d611251683283cdbad76a05d5c746212096e806eb9f33',triggersSha256:'72037e9bea389b19d38ad2875ec350fc8f13eee4d435ba9bb307d664daf621b8'}),
  sealFile:'F:/ChatGPT_workshop/techlong-delegated-request-readonly-verified-20261027-a.json',sealRawSha256:'d6d243f7b929632bab4dfe4b20ff2c25ef434a3a7dbf7b7aaa695eec69dea4c1',
  evidenceRoot:'F:/ChatGPT_workshop/techlong-delegated-request-readonly-20261027-a'});
export const must=(v,c)=>{if(!v)throw Error('TASK_TRANSFER_CANDIDATE_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function createHandoffProfile(input){
  const copy=structuredClone(input);Object.freeze(copy.protection);const facts=Object.freeze(copy);must([facts.baselineSha256,facts.ledgerSha256].every(x=>/^[a-f0-9]{64}$/.test(x))&&
    Number.isSafeInteger(facts.checkedAt)&&facts.checkedAt<facts.expiresAt,'FACTS');
  const assertState=async(input,at)=>{
    const state=normalizedState(input);must(Number.isSafeInteger(at)&&at>=facts.checkedAt&&at<facts.expiresAt,'FACT_WINDOW');
    assertAdmissionSnapshot(state.deployment,at);
    must(state.jobs.length===facts.jobCount&&await sha256Hex(state)===facts.baselineSha256&&await sha256Hex(state.ledger)===facts.ledgerSha256&&same(state.protection,facts.protection),'EXACT_BASELINE');
    const old=state.jobs.find(j=>j.id===TARGET.oldJobId),p=old?.payload;
    must(old?.deployment_id===S.deploymentId&&old.status==='pending'&&old.job_type==='reconcile'&&old.attempts===0&&old.max_attempts===1&&
      old.available_at===Number.MAX_SAFE_INTEGER&&old.completed_at===null&&p?.requestId===TARGET.oldRequestId&&p.requestedByUserId===ADMIN&&
      p.kind==='express_initialized_request_v4'&&p.reviewRequired===true&&p.cloudExecutionAuthorized===false&&same(p.scope,S),'OLD_HELD_REQUEST');
    must(new Set(state.jobs.map(j=>j.id)).size===state.jobs.length&&state.jobs.every(j=>['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null))&&
      state.jobs.filter(j=>['pending','running','retry_wait'].includes(j.status)).length===1&&
      !state.jobs.some(j=>j.id===TARGET.newJobId||j.dedupe_key==='express-initialized-v2:'+TARGET.requestId),'JOB_SET');
    const plans=state.ledger.plans.filter(p=>p.job_id===old.id),attempts=state.ledger.attempts.filter(a=>a.job_id===old.id),approval=state.ledger.approvals.filter(a=>plans.some(p=>p.plan_sha===a.plan_sha));
    must(plans.every(p=>p.mode==='Review'&&p.body.expiresAt<=at),'OLD_REVIEW_EXPIRY');
    must(same(plans.map(p=>p.plan_sha).sort(),[facts.historicalPlanSha256,facts.reviewPlanSha256].sort())&&attempts.length===1&&approval.length===1&&
      attempts[0].plan_sha===facts.reviewPlanSha256&&attempts[0].run_id===facts.reviewRunId&&attempts[0].mode==='Review'&&attempts[0].state==='ACKNOWLEDGED'&&
      attempts[0].run_status===null&&attempts[0].conclusion===null&&attempts[0].proof_sha===null&&approval[0].admin_id===ADMIN,'REVIEW_HISTORY');
    must(state.jobs.find(j=>j.id===SUCCESSFUL_PREDECESSOR)?.status==='succeeded','SUCCESSFUL_PREDECESSOR');return state;
  };
  const compile=async(s,at)=>compileHeldTransferProgram(await assertState(s,at),at,TARGET);
  const verifyReadback=async(before,after,at)=>verifyHeldTransferReadback(await assertState(before,at),after,at,TARGET);
  const prepareReview=async({baseline,sourceCommit,createdAt})=>{
    const state=await assertState(baseline,createdAt);must(/^[a-f0-9]{40}$/.test(sourceCommit),'SOURCE');await compile(state,createdAt);
    const body={schema:'techlong/a604-held-request-review/v1',sourceCommit,createdAt,expiresAt:facts.expiresAt,facts,baseline:state,baselineSha256:facts.baselineSha256,target:TARGET,
      scope:{oldJobUpdates:1,newHeldJobs:1,controlWrites:0,deploymentUpdates:0,awsCalls:0,dispatches:0,protectionChanges:0},
      cloudRuntimeCompatible:false,preparationIsNotApproval:true};return {...body,manifestSha256:await sha256Hex(body)};
  };
  const assertReview=async(m,approved,at)=>{must(same(m,await prepareReview({baseline:m.baseline,sourceCommit:m.sourceCommit,createdAt:m.createdAt}))&&
    approved===m.manifestSha256&&at>=m.createdAt&&at<m.expiresAt,'APPROVAL');return m;};
  return Object.freeze({target:TARGET,facts,entry:ENTRY,operatorSchema:'techlong/a604-held-request-operator/v1',assertState,compile,verifyReadback,prepareReview,assertReview});
}
export const PROFILE=createHandoffProfile(FACTS);
