// HOSTED orchestration only: no credentials, polling client, server or dispatch.
// Human page readiness is not approval; platform and environment approvals stay manual.
import {CONTROL_SCOPE,releaseReady,validatePlan,commit} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {readinessDeadlines,abortableDelay,waitForLeaseAck,waitForLeaseRun} from '../platform-operations-v6/window.mjs';
import {assertScope,must,same} from '../platform-operations-v6/contract.mjs';
import {K,P} from '../platform-hosted-window-v6/contract.mjs';
import {assertHostedHandoffLease,createHostedHandoff} from './hosted-handoff.mjs';
import {recordedFailureError} from './operator-failure.mjs';
const before=(signal,deadline,now)=>{signal.throwIfAborted();must(now()<deadline,'HOSTED_DRIVER_DEADLINE');};
export async function hostedReadyReceipt({manifestSha256,scope,lease,release,hosting,checkedAt,humanReadyUntil}){
  assertScope(scope);await assertHostedHandoffLease(lease,release,scope,checkedAt);
  must(/^[a-f0-9]{64}$/.test(manifestSha256)&&hosting?.stackId===K.stackId&&Object.keys(hosting).sort().join(',')==='stackId,taskDefinition'&&
    new RegExp(`^arn:aws:ecs:ca-central-1:402010193138:task-definition/${P.family}:[1-9][0-9]*$`).test(hosting.taskDefinition)&&
    checkedAt<readinessDeadlines(lease).pageReadyBy&&Number.isSafeInteger(humanReadyUntil)&&humanReadyUntil>checkedAt+15*60000&&humanReadyUntil<=lease.expiresAt,'HOSTED_PAGE_RECEIPT');
  return {schema:'techlong/hosted-human-page-ready/v6',manifestSha256,...scope,...hosting,leaseSha256:await sha256Hex(lease),
    checkedAt,humanReadyUntil,pageOpened:true,viewOnly:true};
}
export async function waitForHostedReady({expected,lease,release,loadReady,signal,now=Date.now,sleep=abortableDelay}){
  const deadline=readinessDeadlines(lease).pageReadyBy;
  for(let poll=0;poll<481;poll++){
    before(signal,deadline,now);const r=await loadReady();before(signal,deadline,now);
    if(r){const exact=await hostedReadyReceipt({...expected,lease,release,checkedAt:r.checkedAt,humanReadyUntil:r.humanReadyUntil});
      must(same(r,exact)&&r.checkedAt<=now()&&now()-r.checkedAt<60000,'HOSTED_PAGE_DRIFT');return r;}
    await sleep(Math.min(1000,deadline-now()),signal);
  }throw Error('PLATFORM_OPERATIONS_HOSTED_PAGE_POLL_BUDGET');
}
export function createHostedCycleDriver({scope:rawScope,release:rawRelease,frozenSourceCommit,manifestSha256,live,loadReady,
  publishReview,probePage,record,preconfirmedReadiness=null,bridgeFactory=createHostedHandoff,now=Date.now,sleep=abortableDelay}){
  const scope=assertScope(rawScope),release=structuredClone(rawRelease);
  must(releaseReady(release)&&commit(frozenSourceCommit)&&/^[a-f0-9]{64}$/.test(manifestSha256)&&
    [loadReady,publishReview,probePage,record,bridgeFactory].every(f=>typeof f==='function')&&
    (preconfirmedReadiness===null||typeof preconfirmedReadiness==='function'),'HOSTED_DRIVER_PORTS');let used=false;
  return async({lease:rawLease,hosting:rawHosting,signal})=>{
    must(!used,'HOSTED_DRIVER_MEMORY_ONCE');used=true;const lease=structuredClone(rawLease),hosting=structuredClone(rawHosting);
    await assertHostedHandoffLease(lease,release,scope,now());const d=readinessDeadlines(lease);
    signal.throwIfAborted();await probePage();before(signal,d.pageReadyBy,now);
    let ready;
    if(preconfirmedReadiness){
      // A fixed reviewed entry may bind a distinct PRE-window human statement.
      // Never label this as an authenticated page view after the update.
      ready=await preconfirmedReadiness({manifestSha256,scope,lease,release,hosting,checkedAt:now()});
      before(signal,d.pageReadyBy,now);await record('preconfirmed-page-readiness-verified',ready);
    }else{
      await record('awaiting-hosted-page',{jobId:scope.jobId,url:'https://'+P.domain+'/admin/instances/'+CONTROL_SCOPE.instanceId,
        manifestSha256,hosting,leaseSha256:await sha256Hex(lease),deadline:d.pageReadyBy,viewOnly:true});
      ready=await waitForHostedReady({expected:{manifestSha256,scope,hosting},lease,release,loadReady,signal,now,sleep});
    }
    before(signal,d.reviewCompleteBy,now);const review=await publishReview({lease,ready});
    const v=await validatePlan(review.plan,release,now());
    must(v.planSha256===review.planSha256&&v.actionSha256===review.actionSha256&&v.plan.mode==='Review'&&v.plan.jobId===scope.jobId&&
      v.plan.sourceCommit===scope.sourceCommit&&v.plan.preparedAt>=ready.checkedAt,'HOSTED_REVIEW_BINDING');
    before(signal,d.reviewCompleteBy,now);
    await record('awaiting-human-review-plan',{jobId:scope.jobId,planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:release.riskSha256,
      deadline:d.reviewCompleteBy,reloadPageOnceToShowNewPlan:true,noRepeatOnError:true});
    const first=await waitForLeaseAck({loadPlan:live.loadPlan,planSha256:v.planSha256,scope,mode:'Review',release,
      deadline:d.reviewCompleteBy,signal,now,sleep}),runId=first.attempt.runId;
    await waitForLeaseRun({readRun:live.readRun,runId,scope,release,deadline:d.reviewCompleteBy,signal,record,stage:'awaiting-human-review-environment',now,sleep});
    const refs=await live.discover(runId);before(signal,d.reviewCompleteBy,now);
    const prepared=await bridgeFactory({scope,release,frozenSourceCommit,lease,ports:live.ports,now}).once({planSha256:v.planSha256,runId,...refs});
    if(prepared.outcome!=='RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL')throw recordedFailureError(prepared.failure,'HOSTED_DRIVER','HANDOFF_STOPPED');
    await record('awaiting-human-runonce-plan',{...prepared,reloadPageOnceToShowNewPlan:true,noRepeatOnError:true});
    const next=await waitForLeaseAck({loadPlan:live.loadPlan,planSha256:prepared.planSha256,scope,mode:'RunOnce',release,
      deadline:prepared.expiresAt,signal,now,sleep});
    await waitForLeaseRun({readRun:live.readRun,runId:next.attempt.runId,scope,release,deadline:d.runCompleteBy,signal,record,stage:'awaiting-human-runonce-environment',now,sleep});
    return {outcome:'RUNONCE_TERMINAL_REQUIRES_SEPARATE_INDEPENDENT_INSPECT',jobId:scope.jobId,reviewRunId:runId,runOnceRunId:next.attempt.runId,
      workflowDispatchesByParent:0,deploymentAccepted:false,retryAllowed:false};
  };
}
