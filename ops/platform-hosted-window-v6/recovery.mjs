// W8m: recover this one known failed stack, not another window or deployment.
import {K,H,P,hash,canonical,same,updateInput,windowTemplate} from './contract.mjs';
export {K,H,P,hash,canonical,same};
export const M=Object.freeze({
  failureSha:'f7d7dfdc6650795b80c2db7c76e6268764a90a474220672d7ae725bee4d784d4',
  closureFile:'F:/ChatGPT_workshop/techlong-platform-w8k-window-failed-closed-20261024-c.json',
  closureSha:'cf9aeb13e68448393889983d1cd25f2379324600f7a47c622c0fb8a494e5563b',
  failedEvent:'85327af0-cf74-11f1-be5e-02452f6c634b',stableEvent:'56682f40-cf14-11f1-b123-06fff904f861',
  slot:'F:/ChatGPT_workshop/techlong-platform-hosted-window-recovery-v6.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-platform-hosted-window-recovery-v6-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8m-stack-recovery-review.md',
  validMs:48*3600000,runMs:20*60000,freshMs:120000,
});
export const must=(ok,code)=>{if(!ok)throw Error('HOSTED_RECOVERY_'+code);};
const sort=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
const body=v=>typeof v==='string'?JSON.parse(v):v;
export function permission(v){
  must(v?.truncated===false&&v.evaluations?.length===1,'PERMISSION_RESULT');const e=v.evaluations[0];
  must(e.action==='cloudformation:RollbackStack'&&e.resource===K.stackId&&e.decision==='allowed'&&
    same(e.missingContext,[]),'PERMISSION_NOT_ALLOWED');return e;
}
const serviceFields=['serviceArn','serviceName','clusterArn','taskDefinition','deploymentController','deploymentConfiguration',
  'networkConfiguration','loadBalancers','enableExecuteCommand','launchType','platformVersion','schedulingStrategy','desiredCount'];
const config=s=>Object.fromEntries(serviceFields.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));
export function observe(v,h,{recovered=false,token=null,intentAt=0,checkPermission=false}={}){
  const r=v.raw,s=r.stack.Stacks?.[0],rows=r.resources.StackResourceSummaries;
  must(r.stack.Stacks?.length===1&&s.StackId===K.stackId&&s.StackStatus===(recovered?'UPDATE_ROLLBACK_COMPLETE':'UPDATE_FAILED')&&
    !s.RoleARN&&s.CreationTime===h.original.stack.Stacks[0].CreationTime&&
    (recovered||s.DisableRollback===true),'STACK_STATE');
  must(!r.resources.NextToken&&rows?.length===11&&new Set(rows.map(x=>x.LogicalResourceId)).size===11,'RESOURCES');
  const expected=windowTemplate(H.imageSource).Resources;
  for(const x of rows)must(x.PhysicalResourceId===h.baseline.ids[x.LogicalResourceId]&&x.ResourceType===expected[x.LogicalResourceId]?.Type&&
    (recovered?['CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE'].includes(x.ResourceStatus):
      x.ResourceStatus===(x.LogicalResourceId==='TaskDefinition'?'UPDATE_ROLLBACK_COMPLETE':'CREATE_COMPLETE')),'RESOURCE_DRIFT');
  must(same(sort(s.Tags??[]),h.baseline.tags)&&same(body(r.template.TemplateBody),recovered?body(h.original.template.TemplateBody):h.failedTemplate)&&
    same(sort(s.Parameters),sort(recovered?h.original.stack.Stacks[0].Parameters:[
      {ParameterKey:'HostingExpiresAt',ParameterValue:K.originalHostingExpiresAt},
      {ParameterKey:'ControllerLease',ParameterValue:canonical(h.failedLease)}])),'TEMPLATE_OR_PARAMETER_DRIFT');
  must(same(r.policy,{})&&!r.changeSets.NextToken&&same(r.changeSets.Summaries,[]),'POLICY_OR_CHANGESET');
  must(r.eventHistory.complete===true&&r.eventHistory.events.every(e=>e.StackId===K.stackId),'EVENT_HISTORY');
  const roots=r.eventHistory.events.filter(e=>e.ResourceType==='AWS::CloudFormation::Stack'&&e.PhysicalResourceId===K.stackId)
    .sort((a,b)=>Date.parse(b.Timestamp)-Date.parse(a.Timestamp));
  const oldStable=roots.find(e=>e.EventId===M.stableEvent),failed=roots.find(e=>e.EventId===M.failedEvent),last=roots[0];
  must(oldStable?.ResourceStatus==='CREATE_COMPLETE'&&oldStable.ClientRequestToken==='platform-hosted-'+K.originalNonce&&
    failed?.ResourceStatus==='UPDATE_FAILED'&&failed.ClientRequestToken===h.failedToken&&
    Date.parse(oldStable.Timestamp)<Date.parse(failed.Timestamp),'KNOWN_PRIOR_STABLE_STATE');
  const complete=roots.filter(e=>e.ResourceStatus.endsWith('_COMPLETE'));
  if(recovered)must(token&&last.ResourceStatus==='UPDATE_ROLLBACK_COMPLETE'&&last.ClientRequestToken===token&&
    Date.parse(last.Timestamp)>=intentAt&&same(complete.map(e=>e.EventId),[last.EventId,M.stableEvent]),'RECOVERY_EVENT');
  else must(last.EventId===M.failedEvent&&same(complete.map(e=>e.EventId),[M.stableEvent]),'LATEST_FAILURE_CHANGED');
  const svc=r.service.services?.[0],tasks=r.tasks.tasks,task=tasks?.[0],def=r.definition.taskDefinition;
  must(r.service.services?.length===1&&!r.service.failures?.length&&svc.status==='ACTIVE'&&svc.runningCount===1&&svc.pendingCount===0&&
    same(config(svc),config(h.original.service.services[0]))&&svc.taskDefinition===K.originalDefinition&&
    svc.deployments?.length===1&&svc.deployments[0].status==='PRIMARY'&&svc.deployments[0].taskDefinition===K.originalDefinition&&
    svc.deployments[0].rolloutState==='COMPLETED'&&svc.deployments[0].runningCount===1&&svc.deployments[0].pendingCount===0,'SERVICE');
  must(!r.running.nextToken&&r.running.taskArns?.length===1&&tasks?.length===1&&!r.tasks.failures?.length&&
    task.taskArn===r.running.taskArns[0]&&task.taskDefinitionArn===K.originalDefinition&&task.lastStatus==='RUNNING'&&task.healthStatus==='HEALTHY'&&
    task.containers?.length===1&&task.containers[0].healthStatus==='HEALTHY'&&task.containers[0].imageDigest===H.imageDigest&&
    same(def,h.original.definition.taskDefinition),'OLD_RUNTIME');
  const targets=r.targets.TargetHealthDescriptions;
  must(targets?.length===1&&targets[0].TargetHealth.State==='healthy'&&targets[0].Target.Port===3000,'TARGET_HEALTH');
  must(same(Object.keys(r.definitions).sort(),['ACTIVE','DELETE_IN_PROGRESS','INACTIVE']),'DEFINITION_STATUSES');
  for(const [status,x]of Object.entries(r.definitions))must(!x.nextToken&&same(x.taskDefinitionArns,
    status==='ACTIVE'?[K.originalDefinition]:status==='INACTIVE'?[...H.retiredTaskDefinitions]:[]),'DEFINITION_DRIFT');
  if(checkPermission)permission(r.permission);
  const controlLease=JSON.parse(def.containerDefinitions[0].environment.find(e=>e.name==='TECHLONG_PLATFORM_CONTROLLER_LEASE').value);
  must(same(controlLease,h.baseline.oldLease)&&controlLease.expiresAt<v.observedAt,'OLD_EXPIRED_LEASE');
  return {stackId:K.stackId,stackStatus:s.StackStatus,disableRollback:s.DisableRollback,ids:h.baseline.ids,
    stableEventId:M.stableEvent,latestEventId:last.EventId,taskDefinition:K.originalDefinition,taskArn:task.taskArn,
    healthy:true,imageDigest:H.imageDigest,controlLeaseUnchangedAndExpired:true,templateSha256:hash(canonical(body(r.template.TemplateBody))),
    sourceCommitStillImageProducer:H.imageSource,permanentStackPolicy:null,checkPermission};
}
export function rollbackInput(nonce){must(/^[a-f0-9]{32}$/.test(nonce),'NONCE');return {
  StackName:K.stackId,ClientRequestToken:'platform-window-recovery-'+nonce};}
// A draft only: this module and the recovery cloud entry never submit UpdateStack.
export function compatibleUpdateDraft(sourceCommit,nonce,intentAt){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&/^[a-f0-9]{32}$/.test(nonce),'UPDATE_DRAFT');
  return {...updateInput({sourceCommit,nonce},intentAt),DisableRollback:false};
}
export function makeReview({sourceCommit,pins,ci,parents,before,nonce,createdAt,compatibility}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    pins.length>=8&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    parents.length>=10&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&before.stackId===K.stackId&&before.stackStatus==='UPDATE_FAILED'&&
    before.stableEventId===M.stableEvent&&before.latestEventId===M.failedEvent&&before.taskDefinition===K.originalDefinition&&before.healthy===true&&
    before.controlLeaseUnchangedAndExpired===true&&before.checkPermission===true&&compatibility?.executionSourceCommit===sourceCommit&&
    compatibility.imageSourceCommit===H.imageSource&&compatibility.protectedRuntimeCodeUnchanged===true&&Number.isSafeInteger(createdAt),'REVIEW_INPUT');
  const b={schema:'techlong/platform-hosted-window-recovery-review/v6',sourceCommit,pins,ci,parents,before,nonce,createdAt,compatibility,
    expiresAt:createdAt+M.validMs,latestStartAt:createdAt+M.validMs-M.runMs,riskFile:M.riskFile,request:rollbackInput(nonce),
    scope:{rollbackStackMax:1,newUpdateStack:0,newIam:0,explicitDeleteStack:0,newLease:0,directPrivateReads:0,sqlConnections:0,
      workflowDispatches:0,managedRollbackMayModifyOrDeleteResources:true,independentInspect:true,automaticCleanup:false},
    risks:{priorStableProofIsNotCas:true,rollbackWithoutStableStateCanDeleteStack:true,managedReconciliationMayRestartTasks:true,
      managedSecretInjectionPossible:true,partialFailureAndSourceExpiry:true,feesMayContinue:true,noAutomaticRetryResetCompensationOrExtraRollback:true},
    preparationIsNotApproval:true};return {...b,manifestSha256:hash(canonical(b))};
}
export function validate(m,sha,now,audit=false){must(same(m,makeReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  if(!audit)must(now>=m.createdAt&&now<m.latestStartAt,'EXPIRED');return m;}
export async function recoverOnce({manifest:m,approved,history:h,io,now=Date.now}){
  const guard=async()=>{validate(m,approved,now());await io.assertSource();};await guard();
  const fresh=await io.snapshot(true),proof=observe(fresh,h,{checkPermission:true});
  must(same(proof,m.before)&&now()>=fresh.observedAt&&now()-fresh.observedAt<M.freshMs,'FRESH_BASELINE');
  await io.record('preflight',fresh);await guard();await io.claim();let phase='SLOT_CONSUMED';const started=now();
  try{
    await guard();must(now()>=fresh.observedAt&&now()-fresh.observedAt<M.freshMs,'PRECHECK_STALE');
    phase='ROLLBACK_INTENT';const intent={manifestSha256:m.manifestSha256,intentAt:now(),request:m.request};await io.record('rollback-intent',intent);
    await guard();must(now()>=intent.intentAt&&now()-intent.intentAt<30000,'INTENT_STALE');
    phase='ROLLBACK_SUBMISSION';const ack=await io.rollback(m.request);must(ack.StackId===K.stackId,'ROLLBACK_ACK');await io.record('rollback-ack',ack);
    phase='WAIT_ROLLBACK';let seen=false,done=false;
    for(let n=0;n<60;n++){
      await guard();must(now()-started<M.runMs,'RUN_DEADLINE');const s=await io.stack();await io.record('stack-'+n,s);
      must(s.StackId===K.stackId,'STACK_ID');if(s.StackStatus==='UPDATE_ROLLBACK_COMPLETE'){done=true;break;}
      if(!seen&&s.StackStatus==='UPDATE_FAILED'&&now()-started<30000){await io.wait();continue;}
      must(['UPDATE_ROLLBACK_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'ROLLBACK_STATUS');
      seen=true;await io.wait();
    }
    must(done,'ROLLBACK_NOT_COMPLETE');phase='VERIFY_STABLE';const snapshot=await io.snapshot(false);
    await io.record('observed',snapshot);const verified=observe(snapshot,h,{recovered:true,token:m.request.ClientRequestToken,intentAt:intent.intentAt});
    const result={outcome:'HOSTED_RECOVERY_STABLE_METADATA_VERIFIED_INSPECT_PENDING',verified,workflowDispatched:false,newLease:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch{const result={outcome:'HOSTED_RECOVERY_REQUIRES_INSPECT_NO_RETRY',phase,retryAllowed:false,workflowDispatched:false,newLease:false};
    await io.record('result',result);return result;}
}
