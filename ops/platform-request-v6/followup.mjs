// W8i: preparation/request-only continuation. No capability discovery on import.
import {neon} from '@neondatabase/serverless';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6,makeReviewedRequestWindowV6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {createExpressInitializedJobNeonV2} from '../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import {REQUEST_STATE_SQL_V6,projectRequestStateV6} from './state.mjs';
import {requestEnvironmentV6} from './plan.mjs';
import {L} from '../platform-local-v6/plan.mjs';

export const F=Object.freeze({
  readinessFile:'F:/ChatGPT_workshop/techlong-platform-w8i-readiness-readonly-20261023.json',
  readinessSha256:'a6a784064085443be8a0a507e86ba0ddaafe1d8905b31ba5cd9599b48872a310',
  runtimeSourceCommit:'f3cea2da7d26dfc09726c4cbc52cab40217340c6',
  predecessorJobId:'job_c6cb047ac3ff30ed51ba9f34',cancelledJobId:'job_fc0309dabebc09367f64153f',
  clientRequestId:'c78f3b80-4c6b-4af1-8b05-4feabb89e7de',jobId:'job_6e2e115c80301595512f11fb',
  requestId:'c99ca0cb30620d6f3ccc47dee1d6287ee3c9489531fd750db41d127182be7730',
  slot:'F:/ChatGPT_workshop/techlong-w8i-held-request.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8i-held-request-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8i-held-request-review.md',
});
export const must=(ok,code)=>{if(!ok)throw Error('FOLLOWUP_REQUEST_'+code);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);

export function assertFollowupBaseline(state,expected=state){
  must(state.adminId===REQUEST_ADMIN_V6&&state.view.supported&&state.view.state==='expired'&&state.view.canRequest&&
    state.view.latestJobId===F.predecessorJobId&&state.target===null&&state.snapshotRows.length===9&&state.oldJobs.length===6&&
    new Set(state.snapshotRows.map(r=>r.name)).size===9&&new Set(state.oldJobs.map(j=>j.id)).size===6&&
    state.oldJobs.filter(j=>j.id===F.cancelledJobId&&j.status==='canceled').length===1&&
    state.oldJobs.every(j=>!j.leasePresent&&j.status===(j.id===F.cancelledJobId?'canceled':'succeeded')),'BASELINE');
  must(same(state.view,expected.view)&&same(state.snapshotRows,expected.snapshotRows)&&same(state.oldJobs,expected.oldJobs),'BASELINE_DRIFT');
}

export async function readFollowupState(authUrl,target){
  const signal=AbortSignal.timeout(30000),repository=createExpressInitializedJobNeonV2(authUrl);
  const before=await repository.readSnapshot({deploymentId:S.deploymentId,predecessorJobId:F.predecessorJobId,newJobId:target.jobId},signal);
  const sql=neon(authUrl,{fullResults:true}),[r]=await sql.transaction(tx=>[tx.query(REQUEST_STATE_SQL_V6,[S.deploymentId,REQUEST_ADMIN_V6])],
    {isolationLevel:'RepeatableRead',readOnly:true,fetchOptions:{signal,redirect:'error'}});
  must(r.rowCount===1&&Array.isArray(r.rows[0].jobs),'READ_STATE');
  return projectRequestStateV6(before.snapshot,r.rows[0].jobs,r.rows[0].admin,target,Date.now());
}

export async function makeFollowupReview({sourceCommit,pins,ci,metadata,baseline,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&
    ci.conclusion==='success'&&pins.length>=15&&new Set(pins.map(p=>p.file)).size===pins.length&&
    pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&Number.isSafeInteger(createdAt)&&createdAt>0,'SOURCE_CI');
  must(metadata.auth?.contentRead===false&&metadata.auth.length>0&&/^[a-f0-9]{64}$/.test(metadata.auth.aclSha256)&&metadata.portFree===true,'METADATA');
  assertFollowupBaseline(baseline);must(B.state==='PUBLISHED','BINDING');
  const request=await makeReviewedRequestWindowV6({sourceCommit,clientRequestId:F.clientRequestId,issuedAt:createdAt,expiresAt:createdAt+1800000});
  must(request.jobId===F.jobId&&request.requestId===F.requestId,'FIXED_TARGET');
  const body={schema:'techlong/platform-followup-held-request-review/v6',sourceCommit,runtimeSourceCommit:F.runtimeSourceCommit,
    pins,ci,metadata,baseline,createdAt,expiresAt:createdAt+48*3600000,binding:B,origin:'http://127.0.0.1:3100',runMs:1800000,
    clientRequestId:F.clientRequestId,authFile:L.authFile,riskFile:F.riskFile,permanentSlot:F.slot,independentReadbackSlot:F.inspectSlot,
    readinessReceipt:{path:F.readinessFile,rawSha256:F.readinessSha256},
    target:{appInstanceId:S.appInstanceId,deploymentId:S.deploymentId,adminUserId:REQUEST_ADMIN_V6,clientRequestId:F.clientRequestId,
      requestId:F.requestId,jobId:F.jobId},
    effects:{authFileReadsMax:2,childStartsMax:1,humanNewHeldJobsMax:1,explicitReadOnlyTransactionsMax:4,
      privateKeyReads:0,awsSecretReads:0,awsCalls:0,appTokens:0,workflowDispatches:0,controllerEnabled:false,workerEnabled:false,awsApplyEnabled:false},
    risks:{wholeAuthFileReadTwice:true,ownerCredentialMemoryAndProviderExposure:true,normalLoginWrites:true,legacyUiWritesStillPossible:true,
      memoryFenceNotDistributedDurableCas:true,sqlDedupeNotHttpAttemptLimit:true,partialOrUnknownCommit:true,readSnapshotsNotCrossServiceCas:true,
      partialResourcesRemainBillable:true,noAutomaticRetryRollbackResetDelete:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyFollowupReview(m,approved,now,inspect=false){
  must(same(m,await makeFollowupReview(m))&&approved===m.manifestSha256&&now>=m.createdAt&&
    (inspect?now:now+1800000)<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export async function verifyFollowupWindow(m,window){
  const at=window?.lease?.issuedAt;must(Number.isSafeInteger(at)&&at>=m.createdAt&&at+1800000<m.expiresAt,'WINDOW_TIME');
  const expected=await requestEnvironmentV6(m,'',at);
  must(same(window,{lease:expected.lease,request:expected.request}),'WINDOW');
}
export async function verifyFollowupReadback(before,after,target,window){
  assertFollowupBaseline(before);must(same(before.snapshotRows,after.snapshotRows)&&same(before.oldJobs,after.oldJobs)&&after.adminId===before.adminId,'OLD_ROWS_CHANGED');
  if(after.target===null)return {outcome:'FOLLOWUP_REQUEST_ABSENT_INDEPENDENTLY_OBSERVED',created:false,retryAllowed:false};
  const j=after.target;
  must(j.id===F.jobId&&target.jobId===F.jobId&&j.deploymentId===S.deploymentId&&j.jobType==='reconcile'&&j.status==='pending'&&
    j.attempts===0&&j.maxAttempts===1&&j.availableAt===Number.MAX_SAFE_INTEGER&&j.completedAt===null&&!j.leasePresent&&
    j.kind==='express_initialized_request_v4'&&j.requestId===F.requestId&&j.requestedBy===REQUEST_ADMIN_V6&&
    j.reviewRequired===true&&j.cloudExecutionAuthorized===false&&j.scopeSha256===await sha256Hex(S)&&
    Number.isSafeInteger(j.requestedAt)&&j.requestedAt>=window.lease.issuedAt&&j.requestedAt<window.lease.expiresAt&&
    Number.isSafeInteger(j.createdAt)&&j.createdAt>=window.lease.issuedAt&&j.createdAt<window.lease.expiresAt,'NEW_HELD_ROW');
  return {outcome:'FOLLOWUP_HELD_REQUEST_INDEPENDENTLY_VERIFIED',created:true,jobId:j.id,oldRowsPreserved:9,oldJobsPreserved:6,
    runtimeSourceCommit:F.runtimeSourceCommit,cloudExecutionAuthorized:false,executionApproved:false,retryAllowed:false};
}
export async function startFollowupOnce({manifest:m,approved,io,now=Date.now}){
  const approve=()=>verifyFollowupReview(m,approved,now());await approve();await io.assertSource(m);
  const at=now(),meta=await io.metadata();must(now()-at<120000&&same(meta,m.metadata),'METADATA_CHANGED');await approve();
  await io.claim({manifestSha256:m.manifestSha256,target:m.target,sourceCommit:m.sourceCommit,consumedAt:now(),retryAllowed:false});
  let phase='SLOT_CONSUMED';
  try{
    await approve();await io.assertSource(m);phase='AUTH_READ';const authUrl=await io.readAuth(m.metadata.auth);
    phase='BASELINE';const baseline=await io.readState(authUrl,m.target);assertFollowupBaseline(baseline,m.baseline);await io.record('baseline',baseline);
    must(now()-at<120000,'STARTUP_WINDOW');await approve();await io.assertSource(m);phase='REQUEST_WINDOW';
    const p=await requestEnvironmentV6(m,authUrl,now());await io.record('window',{lease:p.lease,request:p.request});
    const stopped=await io.serve(p.environment,p.lease,ready=>io.record('started',{...ready,target:m.target}));
    must(stopped.childExited&&stopped.portFree&&stopped.cleanClose,'STOP_UNCONFIRMED');
    const result={outcome:'FOLLOWUP_WINDOW_CLOSED_REQUIRES_INDEPENDENT_READBACK',target:m.target,portFree:true,retryAllowed:false};
    await io.record('result',result);return result;
  }catch{
    const result={outcome:'FOLLOWUP_WINDOW_STOPPED_OR_UNKNOWN_NO_RETRY',phase,target:m.target,retryAllowed:false};
    await io.record('result',result);return result;
  }
}
