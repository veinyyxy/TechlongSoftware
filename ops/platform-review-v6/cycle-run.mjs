// One owned orchestration; all privileged capabilities are separately bounded ports.
import {K,windowLease} from '../platform-hosted-window-v6/contract.mjs';
import {CYCLE,cycleUpdateRequest,validateCycleReview,verifyCycleWindow,must} from './cycle-plan.mjs';
export function createCycleRun({manifest:m,approved,io,verifyWindow=verifyCycleWindow,now=Date.now}){
  let used=false;return async()=>{
    must(!used,'MEMORY_ONCE');used=true;let phase='PRE_APPROVAL',claimAttempted=false,claimed=false,intent=null;
    try{
      await validateCycleReview(m,approved,now());await io.guard();
      phase='READONLY_PREFLIGHT';const fresh=await io.preflight();
      await validateCycleReview(m,approved,now());await io.guard();must(now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'PREFLIGHT_STALE');
      phase='PERMANENT_CLAIM';claimAttempted=true;await io.claim();claimed=true;
      phase='WINDOW_INTENT';const at=now();intent={manifestSha256:m.manifestSha256,intentAt:at,controlLease:windowLease(at,m.sourceCommit),request:cycleUpdateRequest(m,at)};
      await io.record('window-intent',intent);await io.guard();must(now()>=at&&now()-at<30000,'INTENT_STALE');
      phase='UPDATE_STACK_SUBMISSION';const ack=await io.update(intent);must(ack.StackId===K.stackId,'UPDATE_ACK');await io.record('window-ack',ack);
      phase='WAIT_WINDOW';let complete=false;
      for(let n=0;n<=30;n++){
        await io.guard();must(now()-at<CYCLE.updateWaitMs+1000,'UPDATE_WAIT_EXPIRED');const s=await io.stack();await io.record('window-stack-'+n,s);
        must(s.StackId===K.stackId,'STACK_ID');
        if(s.StackStatus==='UPDATE_COMPLETE'&&Date.parse(s.LastUpdatedTime)>Date.parse(fresh.lastUpdatedTime)){complete=true;break;}
        must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus)||
          s.StackStatus==='UPDATE_COMPLETE'&&now()-at<30000,'UPDATE_STATUS_STOPPED');await io.wait(10000);
      }
      must(complete,'WINDOW_NOT_COMPLETE');phase='INDEPENDENT_WINDOW_READBACK';
      const observed=await io.windowSnapshot();await io.record('window-inventory',observed);
      const verified=verifyWindow(observed,m,intent);await io.record('window-verified',{verified,controlLease:intent.controlLease,
        hosting:{stackId:K.stackId,taskDefinition:verified.taskDefinition},workloadAcceptanceVerified:false});
      phase='HOSTED_CONTINUOUS_APPROVAL';const result=await io.drive({lease:intent.controlLease,hosting:{stackId:K.stackId,taskDefinition:verified.taskDefinition}});
      must(result.outcome==='RUNONCE_TERMINAL_REQUIRES_SEPARATE_INDEPENDENT_INSPECT','DRIVER_STOPPED');
      const out={...result,outcome:'HOSTED_CYCLE_RUNONCE_TERMINAL_REQUIRES_INDEPENDENT_INSPECT',windowUpdateAttempts:1,executionApprovedByParent:false,counts:io.counts()};
      await io.record('result',out);return out;
    }catch{
      const out={outcome:'HOSTED_CYCLE_STOPPED_REQUIRES_INDEPENDENT_INSPECT',phase,slotClaimAttempted:claimAttempted,slotClaimed:claimed,windowIntentRecordAttempted:intent!==null,
        workflowDispatchesByParent:0,retryAllowed:false,counts:io.counts()};await io.record('result',out);return out;
    }finally{await io.close();}
  };
}
