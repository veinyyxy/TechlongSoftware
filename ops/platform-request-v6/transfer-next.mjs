// W8y fixed successor profile. Pure compilation only; no filesystem or clients.
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {normalizedState,compileHeldTransferProgram,verifyHeldTransferReadback,TRANSFER as OLD} from './transfer.mjs';
export const NEXT=Object.freeze({oldJobId:OLD.newJobId,newJobId:'job_9db8466fd95cef0c23ad6bfc',
  clientRequestId:'a7677ac6-c65c-498a-8e76-46c8dbd47067',requestId:'a30a73a3c2302b288e5583384ea5d4de3b3280ddb88b74552580a426c9add361',
  oldRequestId:OLD.requestId,oldReviewRunId:'40165734067',oldSource:'320be62add8fad5ad3f05ff40d44612b0b87e493',
  claimBy:1792907146211,validMs:48*3600000,runMs:30000});
export const NEXT_ENTRY=Object.freeze({slot:'F:/ChatGPT_workshop/techlong-w8y-held-handoff.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8y-held-handoff-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8y-held-handoff.md',configPath:'E:/NodejsProject/TechlongSoftware/.env.local'});
export const NEXT_FACTS=Object.freeze({factsAt:1792934352436,databaseCheckedAt:1792934392007,jobCount:8,
  baselineSha256:'8f8c1f5e230f54e267cbbc4aec8655f837881bf4ab7857ae7e2e3b47dc07495f',
  ledgerSha256:'0cc51124773b2498a442ef78d1b6cfcab76358f41d5d50d6ecb5ef210ee75d6d',
  protection:Object.freeze({catalogSha256:'ff430aee9aa57bdee25d611251683283cdbad76a05d5c746212096e806eb9f33',
    triggersSha256:'72037e9bea389b19d38ad2875ec350fc8f13eee4d435ba9bb307d664daf621b8'}),
  closureFile:'F:/ChatGPT_workshop/techlong-w8x-fresh-readonly-completed-verified-20261025-a.json',
  closureRawSha256:'3006f88107bffb8f9405546b580f20f725dd0ae64ccbef3cc485b80bc0f412ad'});
const must=(v,c)=>{if(!v)throw Error('TASK_TRANSFER_NEXT_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const unleased=j=>['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null);
// Explicit code capabilities allow isolated synthetic/CI fixtures. Production
// entry imports NEXT_PROFILE only; neither flags nor manifest can supply facts.
export function makeNextTransferProfile(facts){
  const f=structuredClone(facts),target=NEXT;
  must(Number.isSafeInteger(f.factsAt)&&f.factsAt>=target.claimBy&&f.databaseCheckedAt>=f.factsAt&&
    /^[a-f0-9]{64}$/.test(f.baselineSha256)&&/^[a-f0-9]{64}$/.test(f.ledgerSha256),'FACTS');
  Object.freeze(f.protection);Object.freeze(f);
  const assertState=async(input,at)=>{
    const s=normalizedState(input),old=s.jobs.find(j=>j.id===target.oldJobId);
    must(Number.isSafeInteger(at)&&at>=f.databaseCheckedAt&&at<f.factsAt+target.validMs,'FACT_WINDOW');
    must(s.jobs.length===f.jobCount&&new Set(s.jobs.map(j=>j.id)).size===s.jobs.length&&s.jobs.every(j=>j.deployment_id===S.deploymentId&&unleased(j)),'JOBS');
    must(old?.status==='pending'&&old.job_type==='reconcile'&&old.attempts===0&&old.max_attempts===1&&old.available_at===Number.MAX_SAFE_INTEGER&&old.completed_at===null,'OLD_JOB');
    const p=old.payload;must(p.kind==='express_initialized_request_v4'&&p.requestId===target.oldRequestId&&p.requestedByUserId===ADMIN&&
      same(p.scope,S)&&p.reviewRequired===true&&p.cloudExecutionAuthorized===false&&old.dedupe_key==='express-initialized-v2:'+p.requestId,'OLD_PAYLOAD');
    must(s.jobs.filter(j=>j.id!==old.id).every(j=>['succeeded','canceled'].includes(j.status))&&
      !s.jobs.some(j=>j.id===target.newJobId||j.dedupe_key==='express-initialized-v2:'+target.requestId),'NEW_SLOT');
    const l=s.ledger;must(l.plans.length===4&&l.approvals.length===2&&l.attempts.length===2&&await sha256Hex(l)===f.ledgerSha256,'FULL_HISTORY');
    for(const [jobId,runId,source] of [[OLD.oldJobId,OLD.oldReviewRunId,OLD.oldSource],[target.oldJobId,target.oldReviewRunId,target.oldSource]]){
      const a=l.attempts.find(a=>a.job_id===jobId),approval=l.approvals.find(p=>p.plan_sha===a?.plan_sha);
      must(a?.mode==='Review'&&a.run_id===runId&&a.state==='ACKNOWLEDGED'&&a.run_status===null&&a.conclusion===null&&a.proof_sha===null&&
        approval?.admin_id===ADMIN&&l.plans.find(p=>p.plan_sha===a.plan_sha)?.body.sourceCommit===source,'ACK_HISTORY');
    }
    for(const r of l.plans){const v=await validatePlan(r.body,B.platform,r.body.preparedAt);
      must(v.planSha256===r.plan_sha&&v.actionSha256===r.action_sha&&r.risk_sha===v.plan.riskSha256&&
        [OLD.oldJobId,target.oldJobId].includes(v.plan.jobId)&&v.plan.mode==='Review'&&v.plan.expiresAt<=at,'PLAN_BINDING');}
    must(same(s.protection,f.protection)&&await sha256Hex(s)===f.baselineSha256,'EXACT_BASELINE');
    assertEvidenceSafeV5(s);return s;
  };
  const compile=async(input,at)=>compileHeldTransferProgram(await assertState(input,at),at,target);
  const verifyReadback=async(before,after,at)=>verifyHeldTransferReadback(await assertState(before,at),after,at,target);
  const prepareReview=async({baseline,sourceCommit,createdAt})=>{
    const state=await assertState(baseline,createdAt);must(/^[a-f0-9]{40}$/.test(sourceCommit),'SOURCE');await compile(state,createdAt);
    const body={schema:'techlong/platform-held-successor-review/v6',sourceCommit,createdAt,expiresAt:f.factsAt+target.validMs,
      facts:f,baseline:state,baselineSha256:await sha256Hex(state),target,
      scope:{oldJobUpdates:1,newHeldJobs:1,controlWrites:0,deploymentUpdates:0,awsCalls:0,dispatches:0,protectionChanges:0},preparationIsNotApproval:true};
    return {...body,manifestSha256:await sha256Hex(body)};
  };
  const assertReview=async(m,approved,at)=>{
    must(same(m,await prepareReview({baseline:m.baseline,sourceCommit:m.sourceCommit,createdAt:m.createdAt}))&&
      m.manifestSha256===approved&&at>=m.createdAt&&at<m.expiresAt,'APPROVAL');return m;
  };
  return Object.freeze({target,assertState,compile,verifyReadback,prepareReview,assertReview,entry:NEXT_ENTRY,
    operatorSchema:'techlong/platform-held-successor-operator-review/v6',
    reader:Object.freeze({ledgerJobIds:Object.freeze([OLD.oldJobId,target.oldJobId]),candidateJobId:target.newJobId})});
}
export const NEXT_PROFILE=makeNextTransferProfile(NEXT_FACTS);
