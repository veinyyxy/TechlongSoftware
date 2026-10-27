// This replaces a Web click, not the GitHub deployment-environment decision.
import {D,validateGrant,validateTarget,must,same,safeCode,auditKey,historyProof} from './policy.mjs';
export async function dispatchOnce({grant:g,approved,mode,planSha256,io,now=Date.now}){
  await validateGrant(g,approved,now());must(D.modes.includes(mode),'MODE');let phase='PREFLIGHT',claimed=false,beginAttempted=false,dispatchAttempts=0,knownAck=null;
  if(mode==='Review')must(now()<g.reviewLatestStartAt,'REVIEW_WINDOW_EXPIRED');
  const guard=async()=>{await validateGrant(g,approved,now());await io.assertSource();};
  try{
    await guard();await io.verifyCi();must(same(await io.environment(),g.environment),'ENVIRONMENT_DRIFT');await io.preflight();
    if(mode==='Review')must(same(historyProof(await io.status(),g.seed.planSha256),g.history),'OLD_HISTORY_DRIFT');
    let entry=await io.loadPlan(planSha256);
    const publishSeed=mode==='Review'&&entry===null;
    if(publishSeed){must(planSha256===g.seed.planSha256,'SEED_SHA');entry={...g.seed,riskSha256:g.seed.plan.riskSha256,attempt:null};}
    const valid=await validateTarget(g,entry,io.loadPlan,now());must(valid.plan.mode===mode,'EXACT_MODE');await guard();
    phase='CLAIM';await io.claim(mode);claimed=true;
    const audit={schema:'techlong/delegated-approval-audit/v1',grantSha256:approved,sourceCommit:g.sourceCommit,delegatorAdminId:D.admin,
      actor:'local_delegated_operator',humanWebClick:false,githubEnvironmentApproval:'human-required',planSha256:valid.planSha256,
      actionSha256:valid.actionSha256,riskSha256:valid.plan.riskSha256,mode,jobId:D.jobId,publishSeed,approvedAt:now(),authorization:g,retryAllowed:false};
    await io.record('delegated-decision',audit);phase='DURABLE_AUDIT';await io.persistAudit(auditKey(approved,mode),audit);
    if(publishSeed){phase='PUBLISH_SEED';await io.record('seed-publication-intent',{grantSha256:approved,seed:g.seed});
      await guard();await io.publishSeed(g.seed);entry=await io.loadPlan(planSha256);await validateTarget(g,entry,io.loadPlan,now());}
    await guard();phase='LEDGER_BEGIN';beginAttempted=true;await io.begin(valid,D.admin);await io.record('ledger-begin-ack',{planSha256,delegatorAdminId:D.admin});
    phase='APP_DISPATCH';dispatchAttempts++;
    await io.dispatch(valid.plan,async()=>{await guard();await io.assertLive(planSha256);},async ack=>{
      knownAck=ack;await io.record('dispatch-api-ack',ack);await io.acknowledge(planSha256,ack);});
    must(knownAck&&/^[1-9][0-9]{0,15}$/.test(knownAck.runId),'ACK');
    const after=await io.loadPlan(planSha256);must(same(after.plan,valid.plan)&&after.attempt?.state==='ACKNOWLEDGED'&&after.attempt.runId===knownAck.runId,'READBACK');
    const r={outcome:'DELEGATED_DISPATCH_ACKNOWLEDGED_REQUIRES_USER_GITHUB_APPROVAL',...knownAck,planSha256,mode,
      githubEnvironment:D.environment,githubEnvironmentApprovalRequired:true,githubEnvironmentApprovedByAgent:false,dispatchAttempts,retryAllowed:false};
    await io.record('result',r);return r;
  }catch(e){
    // Preserve a known API ACK even if DB acknowledgement or token cleanup failed.
    if(beginAttempted&&!knownAck)try{await io.markUnknown(planSha256);}catch{/* no retry */}
    const r={outcome:'DELEGATED_DISPATCH_STOPPED_REQUIRES_READBACK',phase,claimed,beginAttempted,dispatchAttempts,knownAck,code:safeCode(e),retryAllowed:false};
    await io.record('result',r);return r;
  }finally{await io.close();}
}
