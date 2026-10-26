// Existing-stack update only; shared metadata verifier checks all unchanged layout.
import {createHash} from 'node:crypto';
import {BEFORE} from './basis.mjs';
import {H as OLD,P,template as oldTemplate} from '../platform-hosted-deploy-v6/contract.mjs';
import {K,checkIdentities,policy} from '../platform-hosted-window-v6/contract.mjs';
import {verifyMetadata} from '../platform-hosted-deploy-v6/inspect-defaults.mjs';
import {RECOVERY_CONTROL_BINDING as B,assertRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
export {P,BEFORE};
export const T=Object.freeze({stackId:K.stackId,nonce:K.originalNonce,
  imageDigest:'sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a',
  configDigest:'sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90',
  imageSource:'5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc',basisExpiresAt:1793126877695,
  slot:'F:/ChatGPT_workshop/techlong-recovery-hosting-v1.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-recovery-hosting-v1.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-w9p-recovery-hosting-update-review.md',
  ciFile:'platform-recovery-hosting-candidate.yml',validMs:24*3600000,runMs:20*60000,leaseMs:30*60000});
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_HOSTING_'+c);};
export const canonical=v=>JSON.stringify(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
export const hash=v=>createHash('sha256').update(typeof v==='string'||v instanceof Uint8Array?v:canonical(v)).digest('hex');
export const same=(a,b)=>canonical(a)===canonical(b);
export const IMAGE=`${P.account}.dkr.ecr.${P.region}.amazonaws.com/${P.repository}@${T.imageDigest}`;
export function assertReadiness(at,now){must(Number.isSafeInteger(at)&&Number.isSafeInteger(now)&&now>=at&&now-at<3*60000,'HUMAN_READINESS');}
export function assertSnapshotTime(at,now,audit=false){must(Number.isSafeInteger(at)&&Number.isSafeInteger(now)&&now>=at&&
  (audit||now-at<2*3600000),'SNAPSHOT');}
export function beforeTemplate(){const t=oldTemplate(T.nonce);t.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Environment
  .find(e=>e.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').Value=BEFORE.source;return t;}
export function nextTemplate(source){must(/^[a-f0-9]{40}$/.test(source),'SOURCE');const t=beforeTemplate(),c=t.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  c.Image=IMAGE;c.Environment.find(e=>e.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').Value=source;
  Object.assign(t.Metadata,{ReviewPhase:'W9p',ImageSource:T.imageSource,ImageConfigDigest:T.configDigest,ReleaseSha256:hash(B.release),ExecutionSource:source});return t;}
export function lease(at,source){must(Number.isSafeInteger(at)&&at>0&&at+T.leaseMs<=T.basisExpiresAt&&/^[a-f0-9]{40}$/.test(source),'LEASE');
  return {schema:'techlong/platform-hosted-runtime-lease/v6',releaseSha256:hash(B.release),origin:'https://'+P.domain,
    sourceCommit:source,issuedAt:at,expiresAt:at+T.leaseMs};}
export async function verifyObserved(v,extra,{source,controlLease,updated=false,intentAt,token,priorInactive=[]},shared=verifyMetadata){
  await assertRecoveryPublication(B);const st=v.stack?.Stacks?.[0],rs=v.resources?.StackResourceSummaries,doc=typeof v.template?.TemplateBody==='string'?JSON.parse(v.template.TemplateBody):v.template?.TemplateBody;
  must(v.stack?.Stacks?.length===1&&st.StackId===T.stackId&&st.StackStatus==='UPDATE_COMPLETE'&&!st.RoleARN&&st.DisableRollback===false&&
    rs?.length===11&&!v.resources.NextToken&&rs.every(r=>['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(r.ResourceStatus)),'STABLE_STACK');
  checkIdentities(rs,BEFORE.ids,updated);must(same(doc,updated?nextTemplate(source):beforeTemplate()),'EXACT_TEMPLATE');
  must(same(controlLease,updated?lease(controlLease.issuedAt,source):BEFORE.oldLease),'EXACT_LEASE');
  const c=v.definition?.taskDefinition?.containerDefinitions?.[0],task=v.tasks?.tasks?.[0],deployment=v.service?.services?.[0]?.deploymentConfiguration;
  must(c?.image===(updated?IMAGE:`${P.account}.dkr.ecr.${P.region}.amazonaws.com/${P.repository}@${OLD.imageDigest}`)&&
    c.environment?.find(e=>e.name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT')?.value===(updated?source:BEFORE.source)&&
    task?.containers?.[0]?.imageDigest===(updated?T.imageDigest:OLD.imageDigest),'ACTUAL_IMAGE_SOURCE');
  must(deployment?.maximumPercent===100&&deployment.minimumHealthyPercent===0&&deployment.deploymentCircuitBreaker?.enable===true&&
    deployment.deploymentCircuitBreaker.rollback===false&&deployment.strategy==='ROLLING'&&deployment.bakeTimeInMinutes===0,'DEPLOYMENT_POLICY');
  const ids=Object.fromEntries(rs.map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
  must(extra.stackPolicy===null&&extra.changeSets.length===0&&same(extra.definitions.ACTIVE,[ids.TaskDefinition])&&
    extra.definitions.INACTIVE.every(a=>(updated?[...priorInactive,BEFORE.ids.TaskDefinition]:Array.from({length:7},(_,n)=>BEFORE.ids.TaskDefinition.replace(/:8$/,':'+(n+1)))).includes(a))&&
    extra.definitions.DELETE_IN_PROGRESS.every(a=>updated&&a===BEFORE.ids.TaskDefinition),'EXTRA_LAYOUT');
  if(updated){const roots=v.events?.StackEvents?.filter(e=>e.ResourceType==='AWS::CloudFormation::Stack'&&e.PhysicalResourceId===T.stackId)
    .sort((a,b)=>Date.parse(b.Timestamp)-Date.parse(a.Timestamp));must(roots?.[0]?.ResourceStatus==='UPDATE_COMPLETE'&&roots[0].ClientRequestToken===token&&Date.parse(roots[0].Timestamp)>=intentAt,'UPDATE_EVENT');}
  // Compare actual values first; normalize ONLY verified substitutions on a clone.
  const copy=structuredClone(v);copy.stack.Stacks[0].StackStatus='CREATE_COMPLETE';for(const r of copy.resources.StackResourceSummaries)r.ResourceStatus='CREATE_COMPLETE';
  copy.template.TemplateBody=oldTemplate(T.nonce);copy.definition.taskDefinition.containerDefinitions[0].image=`${P.account}.dkr.ecr.${P.region}.amazonaws.com/${P.repository}@${OLD.imageDigest}`;
  copy.definition.taskDefinition.containerDefinitions[0].environment.find(e=>e.name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').value=OLD.imageSource;
  copy.tasks.tasks[0].containers[0].imageDigest=OLD.imageDigest;
  const proof=shared(copy,{nonce:T.nonce},{stackId:T.stackId,controlLease,hostingExpiresAt:BEFORE.oldHostingExpiry});
  return {...proof,stackStatus:st.StackStatus,resources:rs.map(r=>({id:r.LogicalResourceId,type:r.ResourceType,status:r.ResourceStatus,physicalId:r.PhysicalResourceId})),
    imageDigest:updated?T.imageDigest:OLD.imageDigest,executionSource:updated?source:BEFORE.source,sharedVerifiedSubstitutionOnly:true};
}
export function baseline(v,extra,proof){return {stackId:T.stackId,ids:BEFORE.ids,templateSha256:hash(beforeTemplate()),
  oldLease:BEFORE.oldLease,tags:[...(v.stack.Stacks[0].Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),
  taskArn:proof.taskArn,inactive:[...extra.definitions.INACTIVE].sort(),supplySha256:hash(v.supply),healthy:true};}
export function review({sourceCommit,pins,ci,before,parents,compatibility,nonce,issuedAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&
    before?.stackId===T.stackId&&before.healthy===true&&same(before.ids,BEFORE.ids)&&before.templateSha256===hash(beforeTemplate())&&same(before.oldLease,BEFORE.oldLease)&&
    compatibility?.sourceCommit===sourceCommit&&compatibility.imageSource===T.imageSource&&compatibility.protectedCodeUnchanged===true&&
    pins?.length>=10&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length&&
    parents?.length>=2&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&/^[a-f0-9]{32}$/.test(nonce)&&Number.isSafeInteger(issuedAt),'REVIEW');
  const expiresAt=Math.min(issuedAt+T.validMs,T.basisExpiresAt),body={schema:'techlong/recovery-hosting-review/v1',sourceCommit,pins,ci,before,parents,compatibility,nonce,issuedAt,
    expiresAt,latestStartAt:Math.min(expiresAt-T.runMs,T.basisExpiresAt-35*60000),riskFile:T.riskFile,templateSha256:hash(nextTemplate(sourceCommit)),
    scope:{updateStackMax:1,logicalUpdates:['TaskDefinition','Service'],normalCfnFailureRollback:true,managedReplacementAndOldRevisionCleanup:true,managedSecretReinjection:true,
      newIam:0,secretWrites:0,directPrivateReads:0,sql:0,dispatch:0,deleteStack:0,controlMinutes:30,automaticCleanup:false},
    temporaryStackPolicy:policy(),originalHostingTagKept:true,requiresFreshHumanReadiness:true,retryAllowed:false};return {...body,manifestSha256:hash(body)};
}
export function validate(m,sha,now,audit=false){must(same(m,review(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  if(!audit)must(Number.isSafeInteger(now)&&now>=m.issuedAt&&now<m.latestStartAt,'EXPIRED');return m;}
export function request(m,at){return {StackName:T.stackId,TemplateBody:canonical(nextTemplate(m.sourceCommit)),
  Parameters:[{ParameterKey:'HostingExpiresAt',UsePreviousValue:true},{ParameterKey:'ControllerLease',ParameterValue:canonical(lease(at,m.sourceCommit))}],
  DisableRollback:false,StackPolicyDuringUpdateBody:canonical(policy()),ClientRequestToken:'recovery-hosting-'+m.nonce};}
export async function runOnce({manifest:m,approved,io,now=Date.now}){
  const guard=async()=>{validate(m,approved,now());await io.assertSource();};await guard();await io.assertHumanReady();const fresh=await io.snapshot();
  must(same(fresh.baseline,m.before),'BASELINE_DRIFT');await io.record('preflight',fresh);await guard();await io.assertHumanReady();await io.claim();const start=now();let phase='SLOT_CONSUMED',intent;
  try{await guard();must(now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'STALE');const at=now();intent={manifestSha256:m.manifestSha256,intentAt:at,
      request:request(m,at),controlLease:lease(at,m.sourceCommit)};await io.record('update-intent',intent);await guard();
    must(now()>=at&&now()-at<30000,'INTENT_STALE');await io.assertHumanReady();phase='UPDATE';const ack=await io.update(intent.request);must(ack.StackId===T.stackId,'ACK');await io.record('update-ack',ack);
    phase='WAIT';let done=false,seen=false;for(let n=0;n<100;n++){await guard();must(now()-start<T.runMs,'DEADLINE');const st=await io.stack();await io.record('stack-'+n,st);
      must(st.StackId===T.stackId,'STACK_ID');if(st.StackStatus==='UPDATE_COMPLETE'&&(seen||Date.parse(st.LastUpdatedTime)>=at)){done=true;break;}
      must(['UPDATE_COMPLETE','UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(st.StackStatus),'UPDATE_OR_ROLLBACK_STOP');
      if(st.StackStatus!=='UPDATE_COMPLETE')seen=true;await io.wait();}
    must(done,'NOT_COMPLETE');phase='VERIFY';const observed=await io.observe(intent);await io.record('observed',observed);
    const r={outcome:'RECOVERY_HOSTING_METADATA_VERIFIED_ACCEPTANCE_PENDING',controlLease:intent.controlLease,observed,controlAcceptancePassed:false,
      businessDeploymentAccepted:false,workflowDispatched:false,retryAllowed:false};await io.record('result',r);return r;
  }catch{const r={outcome:'RECOVERY_HOSTING_REQUIRES_INSPECT_NO_RETRY',phase,controlLease:intent?.controlLease??null,retryAllowed:false};await io.record('result',r);return r;}
}
