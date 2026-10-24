// Replacement-compatible successor. Legacy requests and consumed slots stay intact.
import {K,H,P,hash,canonical,same,windowLease,windowTemplate,policy,verifyWindowMetadata,assertExtra} from './contract.mjs';
import {compatibleUpdateDraft} from './recovery.mjs';
import {N,R} from '../platform-review-v6/resume.mjs';
export {K,H,P,hash,canonical,same};
export const W=Object.freeze({recoveryFile:N.recoveryFile,recoverySha:N.recoverySha,
  slot:'F:/ChatGPT_workshop/techlong-platform-hosted-compatible-window-v6.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-platform-hosted-compatible-window-v6-inspect.intent.json',
  recoveryEvent:'5b3a5080-cfb3-11f1-bd9d-06fff5ad0437',riskFile:N.riskFile,validMs:48*3600000,runMs:20*60000});
export const must=(ok,c)=>{if(!ok)throw Error('COMPATIBLE_WINDOW_'+c);};
const sorted=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
export function rootEvent(raw){
  const roots=raw.events.StackEvents.filter(e=>e.ResourceType==='AWS::CloudFormation::Stack'&&e.PhysicalResourceId===K.stackId)
    .sort((a,b)=>Date.parse(b.Timestamp)-Date.parse(a.Timestamp));must(roots.length>0,'ROOT_EVENT');return roots[0];
}
export function normalizeRecoveredSuccess(raw){
  const s=raw.stack.Stacks?.[0],rows=raw.resources.StackResourceSummaries;
  must(s?.StackId===K.stackId&&s.StackStatus==='UPDATE_ROLLBACK_COMPLETE'&&rows?.length===11&&rows.every(x=>
    ['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(x.ResourceStatus)||x.LogicalResourceId==='TaskDefinition'&&x.ResourceStatus==='UPDATE_ROLLBACK_COMPLETE'),
  'RECOVERED_SUCCESS_ONLY');
  const copy=structuredClone(raw);copy.stack.Stacks[0].StackStatus='CREATE_COMPLETE';
  for(const row of copy.resources.StackResourceSummaries)row.ResourceStatus='CREATE_COMPLETE';return copy;
}
export function recoveredBaseline(raw,extra,recovery){
  const s=raw.stack.Stacks?.[0],rows=raw.resources.StackResourceSummaries,root=rootEvent(raw),v=recovery.verified;
  must(recovery.outcome==='HOSTED_RECOVERY_INDEPENDENTLY_VERIFIED_NO_NEW_WINDOW'&&v.stackId===K.stackId&&
    s?.StackStatus==='UPDATE_ROLLBACK_COMPLETE'&&s.DisableRollback===true&&root.EventId===W.recoveryEvent&&
    root.ResourceStatus==='UPDATE_ROLLBACK_COMPLETE'&&v.latestEventId===root.EventId&&rows?.length===11&&
    rows.every(x=>['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(x.ResourceStatus)||
      x.LogicalResourceId==='TaskDefinition'&&x.ResourceStatus==='UPDATE_ROLLBACK_COMPLETE'),'RECOVERED_STATE');
  const params=Object.fromEntries(s.Parameters.map(p=>[p.ParameterKey,p.ParameterValue])),oldLease=JSON.parse(params.ControllerLease);
  const copy=normalizeRecoveredSuccess(raw);
  const proof=verifyWindowMetadata(copy,oldLease,v.ids,false,H.imageSource);assertExtra(extra,v.ids,false);
  must(proof.taskDefinition===K.originalDefinition&&proof.taskArn===v.taskArn&&oldLease.expiresAt<Date.now()&&
    params.HostingExpiresAt===K.originalHostingExpiresAt&&hash(canonical(windowTemplate(H.imageSource)))===v.templateSha256,'RECOVERED_BASELINE');
  return {stackId:K.stackId,stackStatus:s.StackStatus,rootEventId:root.EventId,ids:v.ids,oldLease,hostingExpiresAt:K.originalHostingExpiresAt,
    templateSha256:v.templateSha256,tags:sorted(s.Tags??[]),stackPolicy:null,taskArn:proof.taskArn,healthy:true,imageDigest:H.imageDigest};
}
export function verifyUpdated(raw,extra,controlLease,ids,sourceCommit,token,intentAt){
  const root=rootEvent(raw);must(raw.stack.Stacks[0].DisableRollback===false&&root.ResourceStatus==='UPDATE_COMPLETE'&&
    root.ClientRequestToken===token&&Date.parse(root.Timestamp)>=intentAt,'UPDATE_EVENT');
  const proof=verifyWindowMetadata(raw,controlLease,ids,true,sourceCommit),nextIds=Object.fromEntries(proof.resources.map(x=>[x.id,x.physicalId]));
  assertExtra(extra,nextIds,true);return {...proof,normalFailureRollbackEnabled:true,rootEventId:root.EventId};
}
export function compatibleInput(m,at){return {...compatibleUpdateDraft(m.sourceCommit,m.nonce,at),
  ClientRequestToken:'platform-window-compatible-'+m.nonce};}
export function validateIntent(m,intent){must(intent.manifestSha256===m.manifestSha256&&Number.isSafeInteger(intent.intentAt)&&
  same(intent.request,compatibleInput(m,intent.intentAt))&&same(intent.controlLease,windowLease(intent.intentAt,m.sourceCommit)),'INTENT_BINDING');return intent;}
export function makeWindowReview({sourceCommit,pins,ci,baseline,publication,parents,nonce,createdAt,compatibility}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    pins.length>=10&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&parents.length>=2&&
    parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&Number.isSafeInteger(createdAt)&&/^[a-f0-9]{32}$/.test(nonce)&&
    baseline.stackId===K.stackId&&baseline.stackStatus==='UPDATE_ROLLBACK_COMPLETE'&&baseline.rootEventId===W.recoveryEvent&&
    baseline.ids.TaskDefinition===K.originalDefinition&&baseline.imageDigest===H.imageDigest&&baseline.healthy===true&&baseline.stackPolicy===null&&
    baseline.templateSha256===hash(canonical(windowTemplate(H.imageSource)))&&publication.kind==='ReviewResume'&&
    publication.sourceCommit===sourceCommit&&publication.jobId===K.jobId&&/^[a-f0-9]{64}$/.test(publication.manifestSha256)&&
    /^[a-f0-9]{64}$/.test(publication.rawSha256)&&same(publication.preservedPlanHashes,[R.oldPlanSha256,N.priorPlanSha].sort())&&
    compatibility?.executionSourceCommit===sourceCommit&&compatibility.imageSourceCommit===H.imageSource&&compatibility.protectedRuntimeCodeUnchanged===true,'REVIEW_INPUT');
  const b={schema:'techlong/platform-hosted-compatible-window-review/v6',sourceCommit,pins,ci,baseline,publication,parents,nonce,createdAt,compatibility,
    expiresAt:createdAt+W.validMs,latestStartAt:createdAt+W.validMs-W.runMs,riskFile:W.riskFile,temporaryStackPolicy:policy(),
    scope:{updateStackMax:1,logicalUpdates:['TaskDefinition','Service'],normalFailureRollback:true,operatorAdditionalRollback:0,
      newIam:0,explicitDeleteStack:0,privateReads:0,sqlConnections:0,workflowDispatches:0,controlMinutes:30,automaticCleanup:false,
      managedReplacementAndOldRevisionCleanup:true,managedSecretReinjection:true},
    prerequisites:'Exact independent old+old+new three-plan Review, no approvals/attempts, same main; >=40 minutes remaining, inspected <80 minutes ago',
    risks:{normalCloudFormationFailureRollbackMayRevertAndDeleteReplacements:true,serviceDowntime:true,nonCas:true,sourceExpiryOrRefreshFailure:true,
      unknownSubmissionMayPersist:true,feesContinue:true,noAutomaticOperatorRetryRollbackResetDelete:true},
    originalHostingTagKept:true,controlLeaseClock:'Actual UpdateStack intent time only; fixed30min; no renewal',preparationIsNotApproval:true};
  return {...b,manifestSha256:hash(canonical(b))};
}
export function validateWindow(m,sha,now,audit=false){must(same(m,makeWindowReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  if(!audit)must(now>=m.createdAt&&now<m.latestStartAt,'EXPIRED');return m;}
export function readyResume(v,m,now){
  must(v.outcome==='REVIEW_RESUME_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED'&&v.jobId===K.jobId&&v.runtimeSourceCommit===m.sourceCommit&&
    v.oldPlansUnchangedAndExpired===true&&same(v.preservedPlanHashes,m.publication.preservedPlanHashes)&&
    same(v.planHashes,[...m.publication.preservedPlanHashes,v.planSha256].sort())&&same(v.controlCounts,{plans:3,approvals:0,attempts:0})&&
    v.heldJobUnchanged===true&&v.executionApproved===false&&Number.isSafeInteger(v.checkedAt)&&now>=v.checkedAt&&now-v.checkedAt<80*60000&&
    v.planExpiresAt-now>=40*60000&&/^[a-f0-9]{64}$/.test(v.planSha256),'REVIEW_NOT_READY');return v;
}
export async function runCompatibleOnce({manifest:m,approved,io,now=Date.now}){
  const guard=async()=>{validateWindow(m,approved,now());await io.assertSource();};await guard();
  const ready=readyResume(await io.reviewReady(),m,now());await io.record('review-prerequisite',ready);
  const fresh=await io.snapshot();must(same(fresh.baseline,m.baseline),'BASELINE_DRIFT');await io.record('preflight',fresh);
  await guard();readyResume(ready,m,now());await io.claim();
  const start=now();let phase='SLOT_CONSUMED',intent;
  try{await guard();must(now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'PRECHECK_STALE');readyResume(ready,m,now());
    phase='UPDATE_INTENT';const at=now(),request=compatibleInput(m,at);intent={manifestSha256:m.manifestSha256,intentAt:at,request,
      controlLease:windowLease(at,m.sourceCommit),additionalHostingIntentUtc:new Date(at+3600000).toISOString()};await io.record('update-intent',intent);
    await guard();must(now()>=at&&now()-at<30000,'INTENT_STALE');phase='UPDATE_SUBMISSION';await io.enableWrite(start+W.runMs);const ack=await io.update(request);
    must(ack.StackId===K.stackId,'ACK');await io.record('update-ack',ack);phase='WAIT_UPDATE';let done=false,seen=false;
    for(let n=0;n<60;n++){
      await guard();must(now()-start<W.runMs,'RUN_DEADLINE');const s=await io.stack();await io.record('stack-'+n,s);must(s.StackId===K.stackId,'STACK_ID');
      if(s.StackStatus==='UPDATE_COMPLETE'){done=true;break;}
      if(!seen&&s.StackStatus==='UPDATE_ROLLBACK_COMPLETE'&&now()-start<30000){await io.wait();continue;}
      must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'UPDATE_OR_AUTO_ROLLBACK_STOP');seen=true;await io.wait();
    }
    must(done,'UPDATE_NOT_COMPLETE');phase='VERIFY_RUNTIME';const observed=await io.observe(intent);await io.record('observed',observed);
    const result={outcome:'COMPATIBLE_WINDOW_METADATA_VERIFIED_ACCEPTANCE_PENDING',controlLease:intent.controlLease,observed,
      normalFailureRollback:true,controlAcceptancePassed:false,workflowDispatched:false,retryAllowed:false};await io.record('result',result);return result;
  }catch{const result={outcome:'COMPATIBLE_WINDOW_REQUIRES_INSPECT_NO_RETRY',phase,controlLease:intent?.controlLease??null,
    normalFailureRollback:true,controlAcceptancePassed:false,workflowDispatched:false,retryAllowed:false};await io.record('result',result);return result;}
}
