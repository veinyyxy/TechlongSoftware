// Explicit approved orchestration; no live ports are imported or constructed here.
import {H,must,same,validate,lease,request,verifyInspection,errorCode} from './plan.mjs';
import {beginSession,assertSession,attachIntent,authorizeReview} from './session.mjs';
import {makeReview} from '../platform-recovery-launch-v1/operation.mjs';
export async function deriveReview(m,basis,binding,intent,inspection,at){verifyInspection(m,intent,inspection);
  return makeReview({binding,basis,sourceCommit:m.sourceCommit,pins:m.reviewPins,ci:m.ci,auth:m.auth,requestEvidence:m.requestEvidence,
    hostingManifestSha256:m.manifestSha256,hostingIntentFile:m.outputs.run+'/update-intent.json',action:{operation:'PublishReview'},createdAt:at});}
export async function runOnce({manifest:m,approved,readyAt,basis,binding,io,now=Date.now,derive=deriveReview}){
  validate(m,approved,now());const ticket=beginSession(m,approved,readyAt,now());let phase='PREFLIGHT',claimed=false,claimAttempted=false,updates=0,intent;
  const guard=async()=>{assertSession(ticket,now());await io.assertSource();};
  try{
    await guard();await io.verifyCi();must(now()>=m.before.oldLease.expiresAt,'OLD_LEASE_ACTIVE');
    const fresh=await io.cloud.snapshot();must(same(fresh.baseline,m.before),'BASELINE_DRIFT');await io.record('preflight',fresh);
    const n=await io.confirmNeon();must(n.neonReadinessVerified===true&&n.writes===0&&Number.isSafeInteger(n.queries)&&n.queries>0&&n.queries<=45&&
      Number.isSafeInteger(n.checkedAt)&&n.checkedAt<=now()&&now()-n.checkedAt<120000,'NEON_READINESS');await io.record('neon-readiness',n);
    await guard();assertSession(ticket,now(),{beforeUpdate:true});must(now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'STALE');
    phase='CLAIM';claimAttempted=true;await io.claim();claimed=true;
    await guard();assertSession(ticket,now(),{beforeUpdate:true});must(now()-fresh.checkedAt<120000&&now()-n.checkedAt<120000,'STALE');
    const at=now();intent={manifestSha256:m.manifestSha256,intentAt:at,request:request(m,at),controlLease:lease(at,m.sourceCommit)};
    attachIntent(ticket,intent,at);await io.record('update-intent',intent);await guard();assertSession(ticket,now(),{beforeUpdate:true});must(now()-at<30000,'INTENT_STALE');
    must(now()-fresh.checkedAt<120000&&now()-n.checkedAt<120000,'STALE');
    phase='UPDATE';updates++;const ack=await io.cloud.update(intent.request);must(ack.StackId===H.stackId,'ACK');await io.record('update-ack',ack);
    phase='WAIT';let done=false,seen=false;for(let k=0;k<60;k++){
      await guard();must(now()-at<H.updateWaitMs,'UPDATE_DEADLINE');const v=await io.cloud.stack();await io.record('stack-'+k,v);must(v.StackId===H.stackId,'STACK');
      if(v.StackStatus==='UPDATE_COMPLETE'&&(seen||new Date(v.LastUpdatedTime).getTime()>=at)){done=true;break;}
      must(['UPDATE_COMPLETE','UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(v.StackStatus),'STACK_STATE');
      if(v.StackStatus!=='UPDATE_COMPLETE')seen=true;await io.wait();
    }
    must(done,'NOT_COMPLETE');phase='VERIFY_HOSTING';await guard();await io.record('observed',await io.cloud.observe(intent));
    phase='INDEPENDENT_INSPECT';const inspection=await io.inspect(intent);await guard();verifyInspection(m,intent,inspection);
    phase='DERIVE_REVIEW';const derived=await derive(m,basis,binding,intent,inspection,now());
    authorizeReview(ticket,derived,intent,inspection,now());await io.record('derived-review',{outerApprovalSha256:approved,review:derived,independentInspection:inspection});
    await guard();phase='PUBLISH_REVIEW';const r=await io.publish(derived,ticket,guard);
    must(r.outcome==='REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL'&&r.submissions===1&&r.dispatches===0,'PUBLISH_RESULT');await guard();
    const result={outcome:'HANDOFF_REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL',outerApprovalSha256:approved,updates,review:r,
      controlLease:intent.controlLease,businessDeploymentAccepted:false,workflowDispatched:false,retryAllowed:false};await io.record('result',result);return result;
  }catch(e){const r={outcome:'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY',phase,claimAttempted,claimed,updates,controlLease:intent?.controlLease??null,
    code:errorCode(e),retryAllowed:false};await io.record('result',r);return r;
  }finally{await io.close();}
}
