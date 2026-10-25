// Explicit operator capabilities only. No CLI, credentials, connection or import-time I/O.
import {INITIALIZED_PLATFORM_SCOPE as S,prepareInitializedPlatformRequest} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';

export const TRANSFER=Object.freeze({oldJobId:'job_6e2e115c80301595512f11fb',newJobId:'job_6a1129afcebfc9fb580517c9',
  clientRequestId:'fb943e98-8990-4b59-9272-b962c14a2d60',requestId:'4d0939f655b4b35bd5ffb5263cf709ba8c85833dc7c6cf6b4aed2f7cc0ac3349',
  oldRequestId:'c99ca0cb30620d6f3ccc47dee1d6287ee3c9489531fd750db41d127182be7730',oldReviewRunId:'40106010722',
  oldSource:'a308e15781877687d1255b87ba29ac8d742f093e',claimBy:Date.parse('2026-10-24T15:30:44.165Z'),validMs:48*3600000,runMs:30000});
const must=(ok,c)=>{if(!ok)throw Error('TASK_TRANSFER_'+c);};
const clone=v=>JSON.parse(JSON.stringify(v));
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const unleased=j=>['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null);
const payload=j=>typeof j.payload==='string'?JSON.parse(j.payload):j.payload;
export function normalizedState(input){
  const s=clone(input);must(Object.keys(s).sort().join(',')==='deployment,jobs,ledger,protection','STATE_FIELDS');
  must(Array.isArray(s.jobs)&&s.jobs.length>1&&s.jobs.length<21,'JOBS');
  s.jobs=s.jobs.map(j=>{const row={...j,payload:payload(j)};
    for(const k of ['available_at','created_at','updated_at','completed_at','lease_expires_at'])if(typeof row[k]==='string'){
      must(/^\d+$/.test(row[k])&&Number.isSafeInteger(Number(row[k])),'INTEGER');row[k]=Number(row[k]);}return row;
  }).sort((a,b)=>a.id.localeCompare(b.id));
  for(const k of ['plans','approvals','attempts']){must(Array.isArray(s.ledger[k]),'LEDGER');s.ledger[k].sort((a,b)=>a.plan_sha.localeCompare(b.plan_sha));}
  return s;
}
export async function assertTransferState(input,at){
  const s=normalizedState(input);must(Number.isSafeInteger(at)&&at>=TRANSFER.claimBy,'OLD_WINDOW_NOT_EXPIRED');
  const old=s.jobs.find(j=>j.id===TRANSFER.oldJobId),p=old&&payload(old);
  must(old&&old.deployment_id===S.deploymentId&&old.job_type==='reconcile'&&old.status==='pending'&&old.attempts===0&&old.max_attempts===1&&
    String(old.available_at)==='9007199254740991'&&old.completed_at===null&&unleased(old),'OLD_JOB');
  must(p.kind==='express_initialized_request_v4'&&p.requestId===TRANSFER.oldRequestId&&p.requestedByUserId===REQUEST_ADMIN_V6&&
    p.reviewRequired===true&&p.cloudExecutionAuthorized===false&&same(p.scope,S)&&old.dedupe_key==='express-initialized-v2:'+p.requestId,'OLD_PAYLOAD');
  must(new Set(s.jobs.map(j=>j.id)).size===s.jobs.length&&s.jobs.every(j=>j.deployment_id===S.deploymentId)&&
    s.jobs.filter(j=>['pending','running','retry_wait'].includes(j.status)).length===1&&s.jobs.every(j=>unleased(j)),'ACTIVE_OR_LEASED_JOB');
  must(s.jobs.filter(j=>j.id!==old.id).every(j=>['succeeded','canceled'].includes(j.status))&&
    !s.jobs.some(j=>j.id===TRANSFER.newJobId||j.dedupe_key==='express-initialized-v2:'+TRANSFER.requestId),'NEW_SLOT');
  must(s.protection&&Object.keys(s.protection).sort().join(',')==='catalogSha256,triggersSha256'&&
    Object.values(s.protection).every(v=>/^[a-f0-9]{64}$/.test(v)),'PROTECTION');
  const l=s.ledger,a=l.attempts[0];must(l.plans.length===3&&l.approvals.length===1&&l.attempts.length===1&&a.job_id===old.id&&a.mode==='Review'&&
    a.run_id===TRANSFER.oldReviewRunId&&a.state==='ACKNOWLEDGED'&&a.run_status===null&&a.conclusion===null&&a.proof_sha===null&&
    l.approvals[0].plan_sha===a.plan_sha&&l.approvals[0].admin_id===REQUEST_ADMIN_V6,'CONTROL_HISTORY');
  for(const r of l.plans){const v=await validatePlan(r.body,B.platform,r.body.preparedAt);
    must(v.planSha256===r.plan_sha&&v.actionSha256===r.action_sha&&r.risk_sha===v.plan.riskSha256&&
      v.plan.jobId===old.id&&v.plan.mode==='Review'&&v.plan.expiresAt<=at,'PLAN_BINDING');}
  must(l.plans.find(p=>p.plan_sha===a.plan_sha)?.body.sourceCommit===TRANSFER.oldSource,'REVIEW_SOURCE');
  assertEvidenceSafeV5(s);return s;
}
export async function prepareTransferReview({baseline,sourceCommit,createdAt}){
  const state=await assertTransferState(baseline,createdAt);must(/^[a-f0-9]{40}$/.test(sourceCommit),'SOURCE');await compileTransfer(state,createdAt);
  const body={schema:'techlong/platform-task-transfer-review/v6',sourceCommit,createdAt,expiresAt:createdAt+TRANSFER.validMs,
    baseline:state,baselineSha256:await sha256Hex(state),target:TRANSFER,
    scope:{oldJobUpdates:1,newHeldJobs:1,controlWrites:0,deploymentUpdates:0,awsCalls:0,dispatches:0,protectionChanges:0},
    preparationIsNotApproval:true};return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertTransferReview(review,approved,at){
  must(same(review,await prepareTransferReview({baseline:review.baseline,sourceCommit:review.sourceCommit,createdAt:review.createdAt}))&&
    review.manifestSha256===approved&&at>=review.createdAt&&at<review.expiresAt,'APPROVAL');return review;
}
export async function compileTransfer(input,at){
  return compileHeldTransferProgram(await assertTransferState(input,at),at,TRANSFER);
}
// Shared SQL compiler. A code-selected profile must validate its complete live
// state first; no CLI/manifest data can select a profile or SQL implementation.
export async function compileHeldTransferProgram(state,at,target){
  must(target.runMs===30000&&target.oldJobId!==target.newJobId,'TARGET');
  const old=state.jobs.find(j=>j.id===target.oldJobId);must(old,'OLD_JOB');
  // This is a PROPOSED post-cancellation state for the existing pure compiler,
  // never a normalized live read or proof that cancellation has already occurred.
  const proposedJobs=state.jobs.map(j=>j.id===old.id?{...j,status:'canceled',updated_at:at,completed_at:at}:j);
  const request=await prepareInitializedPlatformRequest({deployment:state.deployment,jobs:proposedJobs,gateEnabled:true,
    body:{clientRequestId:target.clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},adminUserId:REQUEST_ADMIN_V6,now:at});
  must(request.program&&request.existingJobId===null&&request.program.jobId===target.newJobId&&request.requestId===target.requestId,'REQUEST_COMPILER');
  const insert=request.program,marker=') INSERT INTO public.deployment_jobs';
  must(insert.text.split(marker).length===2&&insert.isolationLevel==='Serializable','COMPILER_SHAPE');
  const lockAdmission={text:insert.text.split(marker)[0]+`) SELECT id FROM locked
    WHERE $1::text IS NOT NULL AND $3::text IS NOT NULL AND $4::text IS NOT NULL AND $5::bigint=9007199254740991`,values:insert.values};
  const cancel={text:`UPDATE public.deployment_jobs j SET status='canceled',updated_at=$4,completed_at=$4
    WHERE j.id=$1 AND j.deployment_id=$2 AND (to_jsonb(j)||jsonb_build_object('payload',j.payload::jsonb))=$3::jsonb
      AND j.status='pending' AND j.attempts=0 AND j.max_attempts=1 AND j.available_at=9007199254740991
      AND j.lease_owner IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.completed_at IS NULL
      AND NOT EXISTS(SELECT FROM deployment_control_v6.dispatch_attempts WHERE job_id=$1 AND mode<>'Review')
      AND (extract(epoch FROM clock_timestamp())*1000)::bigint BETWEEN $4 AND $4+30000
    RETURNING j.id`,values:[old.id,S.deploymentId,canonicalJson(old),at]};
  return {state,at,lockAdmission,cancel,insert};
}
export async function verifyTransferReadback(beforeInput,afterInput,at){
  return verifyHeldTransferReadback(await assertTransferState(beforeInput,at),afterInput,at,TRANSFER);
}
export async function verifyHeldTransferReadback(before,afterInput,at,target){
  const after=normalizedState(afterInput),old=before.jobs.find(j=>j.id===target.oldJobId),
    expected=before.jobs.map(j=>j.id===old.id?{...j,status:'canceled',updated_at:at,completed_at:at}:j),next=after.jobs.find(j=>j.id===target.newJobId);
  must(same(before.deployment,after.deployment)&&same(before.ledger,after.ledger)&&same(before.protection,after.protection)&&
    same(expected,after.jobs.filter(j=>j.id!==target.newJobId)),'PRESERVED_ROWS');
  const p=next&&payload(next);must(next&&same(p,{kind:'express_initialized_request_v4',requestId:target.requestId,requestedByUserId:REQUEST_ADMIN_V6,
    requestedAt:at,scope:S,reviewRequired:true,cloudExecutionAuthorized:false})&&next.deployment_id===S.deploymentId&&next.job_type==='reconcile'&&next.status==='pending'&&next.attempts===0&&
    next.max_attempts===1&&String(next.available_at)==='9007199254740991'&&unleased(next)&&next.completed_at===null&&next.last_error_code===null&&next.last_error_message===null&&
    next.dedupe_key==='express-initialized-v2:'+target.requestId&&p.kind==='express_initialized_request_v4'&&p.requestId===target.requestId&&
    p.requestedByUserId===REQUEST_ADMIN_V6&&p.requestedAt===at&&same(p.scope,S)&&p.reviewRequired===true&&p.cloudExecutionAuthorized===false&&
    Number(next.created_at)>=at&&Number(next.created_at)<=at+target.runMs&&Number(next.updated_at)>=at&&Number(next.updated_at)<=at+target.runMs,'NEW_HELD_ROW');
  return {outcome:'TASK_TRANSFER_ROWS_VERIFIED_NO_EXECUTION_APPROVAL',oldJobId:old.id,newJobId:next.id,otherJobsPreserved:before.jobs.length-1,
    controlHistoryPreserved:true,executionApproved:false,retryAllowed:false};
}
// SQL adapter has no default connection. Control-table SHARE locks precede the
// first snapshot read, preventing a racing dispatch/attestation during transfer.
// They can briefly block other controller writes; lock timeout is one second.
export function createTransferTransaction({client,readState,record=async()=>{},now=Date.now,profile}){
  const target=profile?.target??TRANSFER,assertState=profile?.assertState??assertTransferState,
    compile=profile?.compile??compileTransfer,verifyReadback=profile?.verifyReadback??verifyTransferReadback;
  let used=false;return async({baseline,assertApproved})=>{
    must(!used,'TRANSACTION_ONCE');used=true;let phase='BEGIN',started=false,committing=false,committed=false,at;
    try{
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
      await client.query('SET LOCAL search_path=pg_catalog');
      await client.query("SET LOCAL lock_timeout='1s'");await client.query("SET LOCAL statement_timeout='15s'");
      await client.query('LOCK TABLE deployment_control_v6.plans,deployment_control_v6.approvals,deployment_control_v6.dispatch_attempts IN SHARE MODE');
      at=Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0].at);
      phase='FRESH_STATE';const fresh=await assertState(await readState(client),at);
      must(same(fresh,normalizedState(baseline)),'STATE_DRIFT');const p=await compile(fresh,at);
      phase='ADMISSION_LOCK';const admission=await client.query(p.lockAdmission.text,p.lockAdmission.values);must(admission.rowCount===1,'ADMISSION');
      const jobs=await client.query('SELECT id FROM public.deployment_jobs WHERE deployment_id=$1 ORDER BY id FOR UPDATE',[S.deploymentId]);
      must(same(jobs.rows.map(j=>j.id),fresh.jobs.map(j=>j.id)),'JOB_SET');
      must(same(normalizedState(await readState(client)),fresh),'LOCKED_STATE_DRIFT');
      await assertApproved();must(now()-at>=0&&now()-at<target.runMs,'DEADLINE');
      await record('transfer-intent',{at,oldJobId:target.oldJobId,newJobId:target.newJobId,baselineSha256:await sha256Hex(fresh)});
      phase='CANCEL';must((await client.query(p.cancel.text,p.cancel.values)).rowCount===1,'CANCEL_RESULT');
      await assertApproved();phase='INSERT';must((await client.query(p.insert.text,p.insert.values)).rowCount===1,'INSERT_RESULT');
      phase='IN_TRANSACTION_READBACK';await verifyReadback(fresh,await readState(client),at);
      await assertApproved();must(now()-at<target.runMs,'DEADLINE');
      phase='COMMIT';committing=true;await client.query('COMMIT');committed=true;
      return {outcome:'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK',at,committed:true,retryAllowed:false};
    }catch{
      // Never rollback/retry a possibly committed submission. Destroy/close the
      // supplied connection and independently inspect after any ambiguous ACK.
      if(started&&!committing)try{await client.query('ROLLBACK');}catch{/* no retry */}
      return {outcome:committing?'TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK':'TASK_TRANSFER_STOPPED_REQUIRES_READBACK',phase,at:at??null,committed,
        commitSubmissionAttempted:committing,retryAllowed:false};
    }
  };
}
export function createReviewedTransfer({review,approved,io,now=Date.now,profile}){
  const target=profile?.target??TRANSFER,assertReview=profile?.assertReview??assertTransferReview;
  let used=false;return async()=>{
    must(!used,'OPERATION_ONCE');used=true;let phase='APPROVAL';try{
      await assertReview(review,approved,now());phase='SOURCE';await io.assertSource(review);
      // Permanent claim must be provided by a separately approved local entry.
      phase='PERMANENT_CLAIM';await io.claim({manifestSha256:approved,oldJobId:target.oldJobId,newJobId:target.newJobId});
      phase='TRANSACTION';return await io.transaction({baseline:review.baseline,assertApproved:async()=>{await assertReview(review,approved,now());await io.assertSource(review);}});
    }catch{return {outcome:'TASK_TRANSFER_ENTRY_STOPPED_REQUIRES_READBACK',phase,retryAllowed:false};}
  };
}
