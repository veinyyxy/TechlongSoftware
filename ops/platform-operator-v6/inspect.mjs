// Ordered one-shot protocol; importing does not acquire any live capability.
import {verifyCloudResultContent} from '../platform-operations-v6/evidence.mjs';
import {exactRunV6} from '../platform-cloud-v6/contract.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {LIMITS,must,verifyReview} from './review.mjs';

export function assertPolledRun(raw,runId,sourceCommit){
  must(['queued','requested','waiting','pending','in_progress','completed'].includes(raw?.status)&&
    (raw.status==='completed'?['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(raw.conclusion):raw.conclusion===null),'RUN_STATUS');
  exactRunV6({...raw,status:'completed',conclusion:'success'},{runId,sourceCommit,workflowId:B.platform.workflowId,reusableCommit:B.platform.reusableCommit});
  if(raw.status==='completed')must(raw.conclusion==='success','RUN_FAILED_NO_RETRY');
  return raw.status==='completed';
}
export async function inspectOnce({manifest:m,approved,io,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  // Invalid/expired approval must not even call a supplied port.
  await verifyReview(m,approved,now(),true);
  let phase='PREFLIGHT',ack=null,claimAttempted=false,claimed=false;
  const input=m.input,content=(plan,runId,run,resultReference,deriveInspectPlan=false)=>verifyCloudResultContent({plan,runId,run,resultReference,
    release:B.platform,sourceCommit:input.plan.sourceCommit,frozenSourceCommit:B.publisher.frozenSourceCommit,readObject:io.readObject,deriveInspectPlan,now});
  try{
    await io.guard();await io.preflight();await io.guard();phase='PERMANENT_SLOT';claimAttempted=true;await io.claim();claimed=true;
    phase='ORIGINAL_CONTENT';const original=await io.readRun(input.runId),prior=await content(input.plan,input.runId,original,input.resultReference,true);
    await io.record('original-content',prior);const plan=prior.derivedInspectPlan.plan;
    await io.record('inspect-plan',prior.derivedInspectPlan);await io.guard();phase='INSPECT_DISPATCH';ack=await io.dispatch(plan);
    must(ack.runId!==input.runId,'INDEPENDENT_RUN');phase='HUMAN_ENVIRONMENT';
    // The live recorder both durably saves and immediately prints this safe URL.
    await io.record('awaiting-human-environment',{...ack,mode:'Inspect',deadline:io.deadline,noRerun:true,requiresHumanApproval:true});
    let terminal;
    for(let n=0;n<LIMITS.maxPolls;n++){
      await io.guard();const run=await io.readRun(ack.runId);
      if(assertPolledRun(run,ack.runId,plan.sourceCommit)){terminal=run;break;}
      if(n+1<LIMITS.maxPolls)await sleep(25000);
    }
    must(terminal,'OBSERVATION_WINDOW_EXPIRED');await io.record('inspect-terminal',terminal);phase='INDEPENDENT_CONTENT';
    const ref=await io.discoverResult(ack.runId),verified=await content(plan,ack.runId,terminal,ref);
    must(verified.independentCloudAcceptanceVerified,'INDEPENDENT_ACCEPTANCE_NOT_PROVED');await io.record('independent-content',verified);
    if(io.bundle)await io.record('bundle',await io.bundle(plan,ack.runId,terminal,ref));
    const result={outcome:'INDEPENDENT_CLOUD_INSPECT_VERIFIED_NOT_IMPORTED',jobId:plan.jobId,executionRunId:input.runId,inspectRunId:ack.runId,
      sourceCommit:plan.sourceCommit,manifestSha256:m.manifestSha256,checkedAt:now(),independentCloudAcceptanceVerified:true,
      platformLedgerVerified:false,platformLedgerWrites:0,proofImported:false,platformAcceptanceFlagChanged:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch(e){
    const result={outcome:'INSPECT_UNCONFIRMED_NO_RETRY',phase,ack:ack??io.knownAck?.()??null,claimAttempted,claimed,
      safeCode:/^(?:PLATFORM_OPERATOR_|PLATFORM_OPERATIONS_|CONTROL_)[A-Z0-9_]+$/.test(e?.message)?e.message:null,
      detailsWithheld:true,independentCloudAcceptanceVerified:false,retryAllowed:false};
    await io.record('result',result);return result;
  }finally{await io.close();}
}
