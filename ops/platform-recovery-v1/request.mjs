// One proposed INSERT, not a cancellation/retry. Connections and permanent-slot
// capability must be separately supplied by a reviewed future operator entry.
import {prepareInitializedPlatformRequest,INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {assertAdmissionSnapshot} from '../platform-request-v6/transfer-state.mjs';
import {recoveryData,must,same,freeze} from './basis.mjs';

export async function compileRecoveryRequest(basis,at){
  const {target,state}=recoveryData(basis,at);assertAdmissionSnapshot(state.deployment,at);
  const p=await prepareInitializedPlatformRequest({deployment:state.deployment,jobs:state.jobs,gateEnabled:true,
    body:{clientRequestId:target.clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},adminUserId:ADMIN,now:at});
  must(p.program?.jobId===target.newJobId&&p.requestId===target.requestId&&p.existingJobId===null&&
    p.program.isolationLevel==='Serializable'&&!/\b(?:UPDATE|DELETE)\s+public\./i.test(p.program.text),'INSERT_ONLY_COMPILER');
  return freeze(p.program);
}
export async function makeRecoveryRequestReview({basis,sourceCommit,createdAt}){
  const {target}=recoveryData(basis,createdAt);must(/^[a-f0-9]{40}$/.test(sourceCommit)&&createdAt<basis.expiresAt-120000,'REQUEST_SOURCE_OR_WINDOW');
  const p=await compileRecoveryRequest(basis,createdAt),body={schema:'techlong/retired-unaccepted-request-review/v1',basisSha256:basis.basisSha256,
    sourceCommit,createdAt,expiresAt:basis.expiresAt,latestStartAt:basis.expiresAt-120000,
    target:{oldJobId:target.oldJobId,newJobId:target.newJobId,requestId:target.requestId,clientRequestId:target.clientRequestId,slot:target.requestSlot},
    sqlSha256:await sha256Hex(p.text),stateSha256:basis.stateSha256,
    effects:{newHeldTaskRows:1,oldTaskUpdates:0,controlLedgerWrites:0,deploymentUpdates:0,cloudCalls:0,dispatches:0,retries:0},
    policy:{freshDatabaseClockAtExecution:true,preserveAllOldRows:true,independentReadbackRequired:true,
      serializable:true,permanentSlotNeverReset:true,preparationIsNotApproval:true,productionEntryInstalled:false}};
  return freeze({...body,manifestSha256:await sha256Hex(body)});
}
export async function verifyRecoveryRequestReview(m,basis,approved,at){
  must(same(m,await makeRecoveryRequestReview({basis,sourceCommit:m.sourceCommit,createdAt:m.createdAt}))&&
    approved===m.manifestSha256&&at>=m.createdAt&&at<m.latestStartAt,'REQUEST_APPROVAL_OR_EXPIRED');recoveryData(basis,at);
}
export async function verifyRecoveryRequestReadback(basis,afterInput,at){
  const {state:before,target}=recoveryData(basis,at),after=normalizedState(afterInput),p=await compileRecoveryRequest(basis,at);
  const j=after.jobs.find(j=>j.id===target.newJobId);
  must(same(before.deployment,after.deployment)&&same(before.ledger,after.ledger)&&same(before.protection,after.protection)&&
    same(before.jobs,after.jobs.filter(j=>j.id!==target.newJobId)),'OLD_ROWS_CHANGED');
  must(j&&after.jobs.length===before.jobs.length+1&&j.deployment_id===S.deploymentId&&j.job_type==='reconcile'&&j.status==='pending'&&
    j.attempts===0&&j.max_attempts===1&&j.available_at===Number.MAX_SAFE_INTEGER&&j.completed_at===null&&j.last_error_code===null&&j.last_error_message===null&&
    ['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null)&&j.dedupe_key==='express-initialized-v2:'+target.requestId&&same(j.payload,p.payload)&&
    Number.isSafeInteger(j.created_at)&&j.created_at>=at&&j.created_at<=at+30000&&Number.isSafeInteger(j.updated_at)&&j.updated_at>=at&&j.updated_at<=at+30000,'EXACT_NEW_HELD_ROW');
  return {outcome:'RECOVERY_HELD_REQUEST_ROWS_VERIFIED_ONLY',newJobId:j.id,oldSuccessfulJobPreserved:true,
    cloudExecutionAuthorized:false,independentCloudAcceptance:false,retryAllowed:false};
}
export function createRecoveryRequestTransaction({client,readState,assertApproved,claimPermanent,record=async()=>{},now=Date.now}){
  must(client&&[client.query,readState,assertApproved,claimPermanent,record,now].every(f=>typeof f==='function'),'REQUEST_CAPABILITIES');let used=false;
  return async({review,basis,approved})=>{
    must(!used,'REQUEST_MEMORY_ONCE');used=true;await verifyRecoveryRequestReview(review,basis,approved,now());
    const d=recoveryData(basis,now());let phase='BEGIN',started=false,commitSubmitted=false,at=null,claimAttempted=false;
    const unchanged=async()=>must(same(normalizedState(await readState(client)),d.state),'REQUEST_STATE_DRIFT');
    try{
      await assertApproved(review);await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
      await client.query('SET LOCAL search_path=pg_catalog');await client.query("SET LOCAL lock_timeout='1s'");await client.query("SET LOCAL statement_timeout='15s'");
      await client.query('LOCK TABLE deployment_control_v6.plans,deployment_control_v6.approvals,deployment_control_v6.dispatch_attempts IN SHARE MODE');
      at=Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0].at);
      await verifyRecoveryRequestReview(review,basis,approved,at);phase='FRESH_STATE';await unchanged();
      const p=await compileRecoveryRequest(basis,at),marker=') INSERT INTO public.deployment_jobs';
      must(p.text.split(marker).length===2&&await sha256Hex(p.text)===review.sqlSha256,'REQUEST_SQL_BINDING');
      const locked=await client.query(p.text.split(marker)[0]+`) SELECT id FROM locked WHERE $1::text IS NOT NULL AND $3::text IS NOT NULL
        AND $4::text IS NOT NULL AND $5::bigint=9007199254740991`,p.values);must(locked.rowCount===1,'REQUEST_ADMISSION');
      const rows=await client.query('SELECT id FROM public.deployment_jobs WHERE deployment_id=$1 ORDER BY id FOR UPDATE',[S.deploymentId]);
      must(same(rows.rows.map(j=>j.id),d.state.jobs.map(j=>j.id)),'REQUEST_JOB_SET');await unchanged();
      await assertApproved(review);must(now()>=at&&now()-at<30000,'REQUEST_EXECUTION_WINDOW');
      phase='PERMANENT_CLAIM';claimAttempted=true;await claimPermanent({slot:d.target.requestSlot,basisSha256:basis.basisSha256,manifestSha256:approved,newJobId:d.target.newJobId});
      await record('request-intent',{at,basisSha256:basis.basisSha256,manifestSha256:approved,newJobId:d.target.newJobId,stateSha256:basis.stateSha256});
      await assertApproved(review);phase='INSERT';must((await client.query(p.text,p.values)).rowCount===1,'REQUEST_INSERT_RESULT');
      phase='IN_TRANSACTION_READBACK';await verifyRecoveryRequestReadback(basis,await readState(client),at);
      await assertApproved(review);must(now()-at>=0&&now()-at<30000,'REQUEST_EXECUTION_WINDOW');phase='COMMIT';commitSubmitted=true;
      await client.query('COMMIT');return {outcome:'RECOVERY_HELD_REQUEST_COMMITTED_REQUIRES_INDEPENDENT_READBACK',at,newJobId:d.target.newJobId,
        oldTaskUpdates:0,committed:true,cloudExecutionAuthorized:false,retryAllowed:false};
    }catch{
      if(started&&!commitSubmitted)try{await client.query('ROLLBACK');}catch{/* no automatic retry */}
      return {outcome:commitSubmitted?'RECOVERY_REQUEST_COMMIT_UNKNOWN_REQUIRES_READBACK':'RECOVERY_REQUEST_STOPPED_REQUIRES_READBACK',phase,at,
        claimAttempted,commitSubmissionAttempted:commitSubmitted,retryAllowed:false,detailsWithheld:true};
    }
  };
}
