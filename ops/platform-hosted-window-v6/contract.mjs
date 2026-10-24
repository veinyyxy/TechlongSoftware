// Existing-stack update only. Import grants no AWS capability.
import {H,P,hash,canonical,same,lease,template} from '../platform-hosted-deploy-v6/contract.mjs';
import {verifyMetadata} from '../platform-hosted-deploy-v6/inspect-defaults.mjs';
export {H,P,hash,canonical,same,lease};
export const K=Object.freeze({stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7',
  originalNonce:'1e710b176bd5e31bcddae438ace7d772',originalDefinition:'arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-platform-web-v1:3',
  originalHostingExpiresAt:'2026-10-23T20:58:42.592Z',jobId:'job_6e2e115c80301595512f11fb',
  slot:'F:/ChatGPT_workshop/techlong-platform-hosted-window-v6.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-platform-hosted-window-v6-inspect.intent.json',
  inventoryFile:'F:/ChatGPT_workshop/techlong-hosted-deploy-defaults-inspect-1e710b176bd5e31bcddae438ace7d772-1792799780116.json',
  inventorySha256:'32bb754487bdad0b033fa63caf7ce0790023ba9c3c9536eed425f06f53605e70',
  extraFile:'F:/ChatGPT_workshop/techlong-platform-w8k-window-inventory-extra-20261023.json',
  extraSha256:'b8fc2d8670b8e8861b960f097812d9b48f4d0f9e6137e7da277dfc8536b30a2d',
  riskFile:'docs/aws-auto-deployment-platform-w8k-hosted-window-review.md',runMs:20*60000,validMs:48*3600000});
export const must=(ok,code)=>{if(!ok)throw Error('HOSTED_WINDOW_'+code);};
export const policy=()=>({Statement:[
  {Effect:'Allow',Action:['Update:Modify','Update:Replace'],Principal:'*',Resource:'LogicalResourceId/TaskDefinition'},
  {Effect:'Allow',Action:'Update:Modify',Principal:'*',Resource:'LogicalResourceId/Service'},
]});
export function windowLease(at,executionSource){must(/^[a-f0-9]{40}$/.test(executionSource),'EXECUTION_SOURCE');return {...lease(at),sourceCommit:executionSource};}
export function windowTemplate(executionSource){
  must(/^[a-f0-9]{40}$/.test(executionSource),'EXECUTION_SOURCE');const t=template(K.originalNonce);
  t.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Environment.find(v=>v.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').Value=executionSource;return t;
}
const sorted=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
export function normalizeSuccess(v,expectedStatus){
  const copy=structuredClone(v),s=copy.stack?.Stacks?.[0],rs=copy.resources?.StackResourceSummaries;
  must(s?.StackId===K.stackId&&s.StackStatus===expectedStatus&&['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(expectedStatus)&&
    rs?.length===11&&rs.every(r=>['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(r.ResourceStatus)),'SUCCESS_STATUS');
  s.StackStatus='CREATE_COMPLETE';for(const r of rs)r.ResourceStatus='CREATE_COMPLETE';return copy;
}
export function checkIdentities(resources,ids,updated){
  must(resources.length===11&&new Set(resources.map(r=>r.LogicalResourceId)).size===11,'RESOURCE_COUNT');
  for(const r of resources){must(Object.hasOwn(ids,r.LogicalResourceId),'RESOURCE_ID');
    if(r.LogicalResourceId!=='TaskDefinition'||!updated)must(r.PhysicalResourceId===ids[r.LogicalResourceId],'UNCHANGED_RESOURCE');
    else must(r.PhysicalResourceId!==ids.TaskDefinition&&new RegExp('^arn:aws:ecs:ca-central-1:402010193138:task-definition/'+P.family+':[1-9][0-9]*$').test(r.PhysicalResourceId)&&
      Number(r.PhysicalResourceId.split(':').at(-1))>Number(ids.TaskDefinition.split(':').at(-1)),'NEW_DEFINITION');}
}
export function verifyWindowMetadata(raw,controlLease,ids,updated=false,executionSource=H.imageSource){
  const expectedStatus=updated?'UPDATE_COMPLETE':'CREATE_COMPLETE',rs=raw.resources.StackResourceSummaries;
  if(ids)checkIdentities(rs,ids,updated);
  must(same(controlLease,windowLease(controlLease?.issuedAt,executionSource)),'LEASE');
  const d=raw.service?.services?.[0]?.deploymentConfiguration;
  must(d?.maximumPercent===100&&d.minimumHealthyPercent===0&&d.deploymentCircuitBreaker?.enable===true&&d.deploymentCircuitBreaker.rollback===false&&
    d.strategy==='ROLLING'&&d.bakeTimeInMinutes===0,'DEPLOYMENT_POLICY');
  const actualTemplate=typeof raw.template.TemplateBody==='string'?JSON.parse(raw.template.TemplateBody):raw.template.TemplateBody;
  must(same(actualTemplate,windowTemplate(executionSource)),'EXACT_WINDOW_TEMPLATE');
  const copy=normalizeSuccess(raw,expectedStatus),e=copy.definition.taskDefinition.containerDefinitions[0].environment.find(v=>v.name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT');
  must(e?.value===executionSource,'ACTUAL_EXECUTION_SOURCE');
  // Actual values were checked above. Parameterize the old validator without
  // editing its approved source or changing the raw metadata receipt.
  e.value=H.imageSource;copy.template.TemplateBody=template(K.originalNonce);
  const proof=verifyMetadata(copy,{nonce:K.originalNonce},{stackId:K.stackId,controlLease,hostingExpiresAt:K.originalHostingExpiresAt});
  // Reuse validators, but never report normalized statuses as observed facts.
  return {...proof,stackStatus:expectedStatus,resources:rs.map(r=>({id:r.LogicalResourceId,type:r.ResourceType,status:r.ResourceStatus,physicalId:r.PhysicalResourceId})),
    successfulStatusCompatibilityOnly:true,imageSourceCommit:H.imageSource,executionSourceCommit:executionSource,
    executionSourceComparedExplicitlyBeforeSharedValidator:true};
}
export function assertExtra(extra,ids,updated=false){
  must(extra.stackId===K.stackId&&extra.stackPolicy===null&&extra.changeSets.length===0&&
    same(extra.definitions.ACTIVE,[ids.TaskDefinition])&&extra.definitions.INACTIVE.every(a=>[...H.retiredTaskDefinitions,...(updated?[K.originalDefinition]:[])].includes(a))&&
    extra.definitions.DELETE_IN_PROGRESS.every(a=>updated&&a===K.originalDefinition),'EXTRA_LAYOUT');
}
export function baseline(raw,extra){
  const params=Object.fromEntries(raw.stack.Stacks[0].Parameters.map(x=>[x.ParameterKey,x.ParameterValue])),oldLease=JSON.parse(params.ControllerLease);
  const v=verifyWindowMetadata(raw,oldLease),ids=Object.fromEntries(v.resources.map(r=>[r.id,r.physicalId]));
  must(v.taskDefinition===K.originalDefinition&&params.HostingExpiresAt===K.originalHostingExpiresAt,'BASELINE');assertExtra(extra,ids);
  return {stackId:K.stackId,ids,oldLease,hostingExpiresAt:K.originalHostingExpiresAt,templateSha256:hash(canonical(template(K.originalNonce))),
    tags:sorted(raw.stack.Stacks[0].Tags??[]),stackPolicy:null,healthy:true,imageDigest:H.imageDigest};
}
export function makeReview({sourceCommit,pins,ci,baseline:before,publication,parents,nonce,createdAt,compatibility}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    pins.length>=10&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    before.stackId===K.stackId&&before.ids.TaskDefinition===K.originalDefinition&&before.imageDigest===H.imageDigest&&before.healthy===true&&
    before.templateSha256===hash(canonical(template(K.originalNonce)))&&before.hostingExpiresAt===K.originalHostingExpiresAt&&before.stackPolicy===null&&
    publication.sourceCommit===sourceCommit&&publication.runtimeSourceCommit===sourceCommit&&publication.jobId===K.jobId&&
    compatibility?.executionSourceCommit===sourceCommit&&compatibility.imageSourceCommit===H.imageSource&&compatibility.protectedRuntimeCodeUnchanged===true&&
    /^[a-f0-9]{64}$/.test(publication.manifestSha256)&&/^[a-f0-9]{64}$/.test(publication.rawSha256)&&
    parents.length===2&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&/^[a-f0-9]{32}$/.test(nonce)&&Number.isSafeInteger(createdAt),'REVIEW_INPUT');
  const body={schema:'techlong/platform-hosted-window-review/v6',sourceCommit,pins,ci,baseline:before,publication,parents,nonce,createdAt,compatibility,
    expiresAt:createdAt+K.validMs,latestStartAt:createdAt+K.validMs-K.runMs,riskFile:K.riskFile,scope:{updateStackAttemptsMax:1,templateChanges:1,
      logicalUpdates:['TaskDefinition','Service'],newIam:0,directSecretReads:0,sqlConnections:0,appTokens:0,workflowDispatches:0,deleteStack:0,
      managedTaskDefinitionReplacement:true,managedOldRevisionCleanup:true,managedSecretInjection:true,managedTaskRestartsPossible:true,
      controlMinutes:30,additionalHostingIntentMinutes:60,automaticStopOrCleanup:false},temporaryStackPolicy:policy(),
    originalHostingTagKept:true,controlLeaseDerivation:'lease(actual UpdateStack intent time); no renewal',
    hostingAcceptanceDerivation:'intent time plus 60 minutes in the local receipt only; original historical cloud tag unchanged; not automatic stop',
    prerequisites:'Independently verified un-dispatched exact Review plan on same operator source, at least 40 minutes left; not approval to dispatch',
    risks:{nonAtomicMetadataNotCas:true,sourceMayExpire:true,serviceDowntime:true,asyncAwsUpdateMayOutliveLocalWait:true,disableFailureRollback:true,
      paidResourcesMayRemain:true,managedOldRevisionMayBeDeregistered:true,noAutomaticRetryRollbackDeleteOrReset:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:hash(canonical(body))};
}
export function validate(m,approved,now,audit=false){must(same(m,makeReview(m))&&approved===m.manifestSha256,'APPROVAL_SHA');
  if(!audit)must(now>=m.createdAt&&now<m.latestStartAt,'EXPIRED');return m;}
export function readyReview(v,m,now){
  must(v.outcome==='FOLLOWUP_REVIEW_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED'&&v.jobId===K.jobId&&v.runtimeSourceCommit===m.sourceCommit&&
    same(v.controlCounts,{plans:1,approvals:0,attempts:0})&&v.heldJobUnchanged===true&&v.executionApproved===false&&
    Number.isSafeInteger(v.checkedAt)&&now>=v.checkedAt&&now-v.checkedAt<80*60000&&v.planExpiresAt-now>=40*60000&&
    /^[a-f0-9]{64}$/.test(v.planSha256)&&m.publication.sourceCommit===m.sourceCommit,'REVIEW_NOT_READY');return v;
}
export function updateInput(m,intentAt){
  const controlLease=windowLease(intentAt,m.sourceCommit);return {StackName:K.stackId,TemplateBody:canonical(windowTemplate(m.sourceCommit)),
    Parameters:[{ParameterKey:'HostingExpiresAt',UsePreviousValue:true},{ParameterKey:'ControllerLease',ParameterValue:canonical(controlLease)}],
    DisableRollback:true,StackPolicyDuringUpdateBody:canonical(policy()),ClientRequestToken:'platform-window-'+m.nonce};
}
export async function runOnce({manifest:m,approved,io,now=Date.now}){
  const guard=async()=>{validate(m,approved,now());await io.assertSource();};await guard();
  const ready=readyReview(await io.reviewReady(),m,now());await io.record('review-prerequisite',ready);
  const fresh=await io.snapshot();must(same(fresh.baseline,m.baseline),'BASELINE_DRIFT');await guard();readyReview(ready,m,now());
  await io.claim();const start=now();let phase='SLOT_CONSUMED',intent;
  try{
    await guard();must(now()>=start&&now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'PRECHECK_STALE');readyReview(ready,m,now());
    phase='UPDATE_INTENT';const at=now(),request=updateInput(m,at);intent={manifestSha256:m.manifestSha256,stackId:K.stackId,
      controlLease:windowLease(at,m.sourceCommit),additionalHostingIntentUtc:new Date(at+3600000).toISOString(),request,intentAt:at};await io.record('update-intent',intent);
    await guard();must(now()>=at&&now()-at<30000,'INTENT_STALE');phase='UPDATE_SUBMISSION';await io.enableWrite(start+K.runMs);
    const ack=await io.update(request);must(ack.StackId===K.stackId,'UPDATE_ACK');await io.record('update-ack',ack);
    phase='WAIT_UPDATE';let completed=false,progressSeen=false;
    for(let i=0;i<60;i++){await guard();must(now()-start<K.runMs,'RUN_DEADLINE');const s=await io.stack();await io.record('stack-'+i,s);
      must(s.StackId===K.stackId,'STACK_ID');if(s.StackStatus==='UPDATE_COMPLETE'){completed=true;break;}
      if(s.StackStatus==='CREATE_COMPLETE'&&!progressSeen&&now()-start<60000){await io.wait();continue;}
      must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'UPDATE_STATUS');progressSeen=true;await io.wait();}
    must(completed,'UPDATE_NOT_COMPLETE');phase='VERIFY_RUNTIME';const observed=await io.observe(intent.controlLease,m.baseline.ids);
    await io.record('observed',observed);
    const result={outcome:'HOSTED_WINDOW_METADATA_VERIFIED_ACCEPTANCE_PENDING',stackId:K.stackId,controlLease:intent.controlLease,
      additionalHostingIntentUtc:intent.additionalHostingIntentUtc,observed,controlAcceptancePassed:false,workflowDispatched:false,
      automaticStopOrCleanup:false,retryAllowed:false};await io.record('result',result);return result;
  }catch{const result={outcome:'HOSTED_WINDOW_REQUIRES_INSPECT_NO_RETRY',phase,stackId:K.stackId,controlLease:intent?.controlLease??null,
    workflowDispatched:false,controlAcceptancePassed:false,retryAllowed:false};await io.record('result',result);return result;}
}
