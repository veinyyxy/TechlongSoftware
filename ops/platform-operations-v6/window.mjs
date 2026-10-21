// Reviewed orchestration with injected capabilities only. Never dispatches,
// discovers credentials, reads a ready file, starts a server or opens a DB.
import {CONTROL_SCOPE,releaseReady,validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {CONTROL_ORIGIN_V6,verifiedRuntimeLeaseV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {exactRunV6} from '../platform-cloud-v6/contract.mjs';
import {assertScope,must,same} from './contract.mjs';

export function readinessDeadlines(lease){
  must(Number.isSafeInteger(lease?.issuedAt)&&lease.issuedAt>0&&Number.isSafeInteger(lease.expiresAt)&&
    lease.expiresAt-lease.issuedAt===1800000,'LEASE');
  return {pageReadyBy:lease.expiresAt-22*60000,reviewCompleteBy:lease.expiresAt-16*60000,runCompleteBy:lease.expiresAt-30000};
}
export function pageReadyReceipt({manifestSha256,childPid,lease,scope,checkedAt}){
  assertScope(scope);const deadlines=readinessDeadlines(lease);
  must(/^[a-f0-9]{64}$/.test(manifestSha256)&&Number.isSafeInteger(childPid)&&childPid>0&&lease.sourceCommit===scope.sourceCommit&&
    Number.isSafeInteger(checkedAt)&&checkedAt>=lease.issuedAt&&checkedAt<deadlines.pageReadyBy,'RECEIPT_SCOPE');
  return {schema:'techlong/human-page-open-confirmation/v6',manifestSha256,sourceCommit:scope.sourceCommit,jobId:scope.jobId,childPid,
    leaseIssuedAt:lease.issuedAt,leaseExpiresAt:lease.expiresAt,pageOpened:true,checkedAt};
}
export function assertRecoveryControl(control,retainedReview,{scope,riskSha256}){
  assertScope(scope);
  must(retainedReview?.plan?.mode==='Review'&&retainedReview.plan.jobId===scope.jobId&&retainedReview.plan.sourceCommit===scope.sourceCommit&&
    retainedReview.plan.riskSha256===riskSha256&&/^[a-f0-9]{64}$/.test(retainedReview.planSha256)&&/^[a-f0-9]{64}$/.test(retainedReview.actionSha256),'RETAINED_REVIEW');
  must(Array.isArray(control?.plans)&&control.plans.length===1&&Array.isArray(control.approvals)&&control.approvals.length===0&&
    Array.isArray(control.attempts)&&control.attempts.length===0,'PRIOR_ATTEMPT_OR_APPROVAL_NO_NEW_DISPATCH');
  const p=control.plans[0];
  must(p.plan_sha===retainedReview.planSha256&&p.action_sha===retainedReview.actionSha256&&p.risk_sha===riskSha256&&p.job_id===scope.jobId&&
    p.mode==='Review'&&same(p.body,retainedReview.plan)&&Date.parse(p.expires_at)===retainedReview.plan.expiresAt,'KNOWN_REVIEW_DRIFT');
  return {retainedPlanSha256:p.plan_sha,noPriorApprovalOrAttempt:true};
}
export function abortableDelay(ms,signal){
  must(Number.isFinite(ms)&&ms>=0&&signal,'DELAY');
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}let timer;
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});
  });
}
function beforeDeadline(signal,deadline,now){signal.throwIfAborted();must(Number.isSafeInteger(deadline)&&now()<deadline,'WAIT_WINDOW_EXPIRED');}
export async function waitForPageReady({loadReady,expected,lease,deadline,signal,now=Date.now,sleep=abortableDelay}){
  must(deadline<=readinessDeadlines(lease).pageReadyBy,'PAGE_DEADLINE_EXTENSION');
  for(let polls=0;polls<481;polls++){
    beforeDeadline(signal,deadline,now);const r=await loadReady();beforeDeadline(signal,deadline,now);
    if(r){const exact=pageReadyReceipt({...expected,lease,checkedAt:r.checkedAt});must(same(r,exact)&&r.checkedAt<=now(),'READY_RECEIPT_MISMATCH');return r;}
    await sleep(Math.min(1000,deadline-now()),signal);
  }throw Error('PLATFORM_OPERATIONS_PAGE_POLL_BUDGET');
}
export async function waitForLeaseAck({loadPlan,planSha256,scope,mode,release,deadline,signal,now=Date.now,sleep=abortableDelay}){
  assertScope(scope);must(releaseReady(release)&&['Review','RunOnce','Inspect'].includes(mode),'ACK_SCOPE');
  for(let polls=0;polls<90;polls++){
    beforeDeadline(signal,deadline,now);const e=await loadPlan(planSha256);beforeDeadline(signal,deadline,now);
    const v=await validatePlan(e.plan,release,now());beforeDeadline(signal,deadline,now);
    must(v.planSha256===planSha256&&e.planSha256===planSha256&&e.actionSha256===v.actionSha256&&e.riskSha256===release.riskSha256&&
      e.plan.jobId===scope.jobId&&e.plan.sourceCommit===scope.sourceCommit&&e.plan.mode===mode&&deadline<=e.plan.expiresAt,'ACK_PLAN_BINDING');
    if(e.attempt?.runId&&['ACKNOWLEDGED','OBSERVED'].includes(e.attempt.state)){
      must(/^[1-9][0-9]{0,15}$/.test(e.attempt.runId),'ACK_RUN_ID');return e;
    }
    must(e.attempt===null||e.attempt?.state==='SUBMISSION_STARTED','UNKNOWN_ATTEMPT_NO_RETRY');
    await sleep(Math.min(15000,deadline-now()),signal);
  }throw Error('PLATFORM_OPERATIONS_ACK_POLL_BUDGET');
}
export async function waitForLeaseRun({readRun,runId,scope,release,deadline,signal,record,stage,now=Date.now,sleep=abortableDelay}){
  assertScope(scope);must(releaseReady(release),'RUN_RELEASE');let announced=false;
  for(let polls=0;polls<90;polls++){
    beforeDeadline(signal,deadline,now);const raw=await readRun(runId);beforeDeadline(signal,deadline,now);
    exactRunV6({...raw,status:'completed',conclusion:'success'},{runId,sourceCommit:scope.sourceCommit,workflowId:release.workflowId,reusableCommit:release.reusableCommit});
    must(['queued','requested','waiting','pending','in_progress','completed'].includes(raw.status)&&
      (raw.status==='completed'||raw.conclusion===null),'RUN_STATUS');
    if(raw.status==='completed'){must(raw.conclusion==='success','RUN_FAILED_NO_RETRY');return raw;}
    if(!announced){await record(stage,{runId,url:`https://github.com/${CONTROL_SCOPE.repository}/actions/runs/${runId}`,deadline});announced=true;}
    await sleep(Math.min(25000,deadline-now()),signal);
  }throw Error('PLATFORM_OPERATIONS_RUN_POLL_BUDGET');
}
export function createReadyGatedDriver({live,scope:rawScope,release:rawRelease,frozenSourceCommit,manifestSha256,loadReady,publishReview,probeLogin,record,
  bridgeFactory,now=Date.now,sleep=abortableDelay}){
  const scope=assertScope(rawScope),release=structuredClone(rawRelease);
  must(releaseReady(release)&&typeof bridgeFactory==='function','EXPLICIT_DRIVER_PORTS');let entered=false;
  return async({lease,child,signal})=>{
    must(!entered,'DRIVER_MEMORY_ONCE');entered=true;
    must(await verifiedRuntimeLeaseV6(JSON.stringify(lease),release,now())&&lease.sourceCommit===scope.sourceCommit,'DRIVER_LEASE');
    const d=readinessDeadlines(lease);signal.throwIfAborted();await probeLogin();beforeDeadline(signal,d.pageReadyBy,now);
    await record('awaiting-page-open',{jobId:scope.jobId,childPid:child.childPid,deadline:d.pageReadyBy,reviewCompleteBy:d.reviewCompleteBy,
      url:CONTROL_ORIGIN_V6+'/admin/instances/'+CONTROL_SCOPE.instanceId,viewOnly:true});
    await waitForPageReady({loadReady,expected:{manifestSha256,childPid:child.childPid,scope},lease,deadline:d.pageReadyBy,signal,now,sleep});
    beforeDeadline(signal,d.reviewCompleteBy,now);const review=await publishReview(lease);
    await record('awaiting-human-review-plan',{jobId:scope.jobId,planSha256:review.planSha256,actionSha256:review.actionSha256,
      riskSha256:release.riskSha256,deadline:d.reviewCompleteBy,reloadPageOnceToShowNewPlan:true,noRepeatOnError:true});
    const first=await waitForLeaseAck({loadPlan:live.loadServicePlan,planSha256:review.planSha256,scope,mode:'Review',release,
      deadline:d.reviewCompleteBy,signal,now,sleep}),runId=first.attempt.runId;
    await waitForLeaseRun({readRun:live.readRun,runId,scope,release,deadline:d.reviewCompleteBy,signal,record,stage:'awaiting-human-review-environment',now,sleep});
    signal.throwIfAborted();const refs=await live.discover(runId);
    const bridge=bridgeFactory({scope,release,frozenSourceCommit,lease,ports:live.ports,now});
    const prepared=await bridge.once({planSha256:review.planSha256,runId,...refs});
    must(prepared.outcome==='RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL','BRIDGE_STOPPED_NO_RETRY');
    await record('awaiting-human-runonce-plan',{...prepared,reloadPageOnceToShowNewPlan:true,noRepeatOnError:true});
    const next=await waitForLeaseAck({loadPlan:live.loadServicePlan,planSha256:prepared.planSha256,scope,mode:'RunOnce',release,
      deadline:prepared.expiresAt,signal,now,sleep});
    await waitForLeaseRun({readRun:live.readRun,runId:next.attempt.runId,scope,release,deadline:d.runCompleteBy,signal,record,stage:'awaiting-human-runonce-environment',now,sleep});
    return {outcome:'RUNONCE_TERMINAL_REQUIRES_SEPARATE_INDEPENDENT_INSPECT',jobId:scope.jobId,reviewRunId:runId,runOnceRunId:next.attempt.runId,
      workflowDispatchesByParent:0,deploymentAccepted:false,retryAllowed:false};
  };
}
