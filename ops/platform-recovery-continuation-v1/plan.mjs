// One fixed continuation of the independently verified revision9, not a retry.
import {T,P,BEFORE,hash,same,canonical,nextTemplate,lease,verifyObserved as oldVerify} from '../platform-recovery-hosting-v1/plan.mjs';
import {policy} from '../platform-hosted-window-v6/contract.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../platform-recovery-control-v1/binding.mjs';
import {ORIGINAL_REQUEST,validateRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
export const W=Object.freeze({...T,schema:'techlong/recovery-hosting-continuation-review/v1',
  slot:'F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-v1.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-v1.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-recovery-continuation-review.md',
  priorSource:'806bc2e2e17d6e4097805bae39f3fa1a4ac72bab',priorDefinition:BEFORE.ids.TaskDefinition.replace(/:8$/,':9'),
  priorAt:1793043459259,priorToken:'recovery-hosting-70b07619236eac11e5dc84d01fe34f3b'});
export {P,hash,same,canonical,lease};
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_CONTINUATION_'+c);};
export const errorCode=e=>/^RECOVERY_(?:CONTINUATION|HOSTING|LAUNCH|REQUEST_EVIDENCE|V1)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:null;
const priorLease=()=>lease(W.priorAt,W.priorSource),priorIds=()=>({...BEFORE.ids,TaskDefinition:W.priorDefinition});
const priorInactive=()=>Array.from({length:8},(_,n)=>W.priorDefinition.replace(/:9$/,':'+(n+1)));
export async function verifyObserved(v,extra,{source,controlLease,updated=false,intentAt,token},shared){
  const definition=v.resources?.StackResourceSummaries?.find(r=>r.LogicalResourceId==='TaskDefinition')?.PhysicalResourceId;
  const suffix=typeof definition==='string'?definition.slice(W.priorDefinition.length-1):'';
  must(updated?typeof definition==='string'&&definition.startsWith(W.priorDefinition.slice(0,-1))&&/^[1-9][0-9]*$/.test(suffix)&&Number.isSafeInteger(Number(suffix))&&Number(suffix)>9:
    definition===W.priorDefinition,'DEFINITION');
  return oldVerify(v,extra,updated?{source,controlLease,updated:true,intentAt,token,priorInactive:priorInactive(),priorDefinition:W.priorDefinition}:
    {source:W.priorSource,controlLease:priorLease(),updated:true,intentAt:W.priorAt,token:W.priorToken,
      priorInactive:priorInactive().slice(0,7),priorDefinition:BEFORE.ids.TaskDefinition},shared);
}
export function baseline(v,extra,proof){return {stackId:W.stackId,ids:priorIds(),oldLease:priorLease(),
  templateSha256:hash(nextTemplate(W.priorSource)),taskArn:proof.taskArn,inactive:[...extra.definitions.INACTIVE].sort(),
  tags:[...(v.stack.Stacks[0].Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),supplySha256:hash(v.supply),healthy:true};}
export function review({sourceCommit,pins,ci,before,parents,compatibility,requestEvidence,auth,nonce,issuedAt}){
  validateRequestEvidence(requestEvidence,{basisSha256:B.basisSha256,createdAt:ORIGINAL_REQUEST.transactionAt,expiresAt:W.basisExpiresAt});
  must(requestEvidence.transactionAt===ORIGINAL_REQUEST.transactionAt,'ORIGINAL_REQUEST_TIME');
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&sourceCommit!==W.priorSource&&ci?.sourceCommit===sourceCommit&&ci.status==='completed'&&
    ci.conclusion==='success'&&ci.attempt===1&&before?.stackId===W.stackId&&before.healthy===true&&same(before.ids,priorIds())&&
    same(before.oldLease,priorLease())&&before.templateSha256===hash(nextTemplate(W.priorSource))&&typeof before.taskArn==='string'&&before.taskArn.length>0&&
    Array.isArray(before.tags)&&Array.isArray(before.inactive)&&before.inactive.every(d=>priorInactive().includes(d))&&/^[a-f0-9]{64}$/.test(before.supplySha256)&&
    compatibility?.sourceCommit===sourceCommit&&compatibility.imageSource===W.imageSource&&compatibility.protectedCodeUnchanged===true&&
    Array.isArray(pins)&&pins.length>=20&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length&&
    parents?.length>=3&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&/^[a-f0-9]{32}$/.test(nonce)&&Number.isSafeInteger(issuedAt)&&
    auth?.contentRead===false&&Number.isSafeInteger(auth.length)&&auth.length>0&&auth.length<=131072&&/^[a-f0-9]{64}$/.test(auth.aclSha256),'REVIEW');
  const expiresAt=Math.min(issuedAt+W.validMs,W.basisExpiresAt),body={schema:W.schema,sourceCommit,pins,ci,before,parents,compatibility,requestEvidence,auth,nonce,issuedAt,
    expiresAt,latestStartAt:Math.min(expiresAt-W.runMs,W.basisExpiresAt-35*60000),riskFile:W.riskFile,templateSha256:hash(nextTemplate(sourceCommit)),
    scope:{updateStackMax:1,logicalUpdates:['TaskDefinition','Service'],imageUnchanged:true,normalCfnFailureRollback:true,managedSecretReinjection:true,
      managedOldRevisionCleanup:true,neonReadonlyPreflight:true,configReadsMax:1,tlsConnectionsMax:1,sqlQueriesMax:45,databaseWrites:0,
      newIam:0,secretWrites:0,secretValueReads:0,pemReads:0,dispatches:0,deleteStack:0,controlMinutes:30,automaticCleanup:false},
    slot:W.slot,inspectSlot:W.inspectSlot,temporaryStackPolicy:policy(),requiresFreshHumanReadiness:true,retryAllowed:false};
  return {...body,manifestSha256:hash(body)};
}
export function validate(m,sha,at,audit=false){must(same(m,review(m))&&m.manifestSha256===sha,'APPROVAL_SHA');
  if(!audit)must(Number.isSafeInteger(at)&&at>=m.issuedAt&&at<m.latestStartAt,'EXPIRED');return m;}
export function request(m,at){return {StackName:W.stackId,TemplateBody:canonical(nextTemplate(m.sourceCommit)),
  Parameters:[{ParameterKey:'HostingExpiresAt',UsePreviousValue:true},{ParameterKey:'ControllerLease',ParameterValue:canonical(lease(at,m.sourceCommit))}],
  DisableRollback:false,StackPolicyDuringUpdateBody:canonical(policy()),ClientRequestToken:'recovery-continuation-'+m.nonce};}
export async function runOnce({manifest:m,approved,io,now=Date.now}){
  validate(m,approved,now());let phase='PREFLIGHT',claimAttempted=false,claimed=false,updateAttempts=0,intent;
  const guard=async()=>{validate(m,approved,now());await io.assertSource();};
  try{
    await guard();await io.assertHumanReady();const fresh=await io.snapshot();must(same(fresh.baseline,m.before),'BASELINE_DRIFT');await io.record('preflight',fresh);
    const n=await io.confirmNeon();must(n.neonReadinessVerified===true&&n.writes===0&&Number.isSafeInteger(n.queries)&&n.queries>0&&n.queries<=45&&
      Number.isSafeInteger(n.checkedAt)&&n.checkedAt<=now()&&now()-n.checkedAt<120000,'NEON_READINESS');
    await io.record('neon-readiness',n);await guard();await io.assertHumanReady();
    phase='CLAIM';claimAttempted=true;await io.claim();claimed=true;const start=now();await guard();must(now()>=fresh.checkedAt&&now()-fresh.checkedAt<120000,'STALE');
    const at=now();intent={manifestSha256:m.manifestSha256,intentAt:at,request:request(m,at),controlLease:lease(at,m.sourceCommit)};
    await io.record('update-intent',intent);await guard();await io.assertHumanReady();must(now()>=at&&now()-at<30000,'INTENT_STALE');
    phase='UPDATE';updateAttempts++;const ack=await io.update(intent.request);must(ack.StackId===W.stackId,'ACK');await io.record('update-ack',ack);
    phase='WAIT';let done=false,seen=false;for(let i=0;i<100;i++){
      await guard();must(now()-start<W.runMs,'DEADLINE');const s=await io.stack();await io.record('stack-'+i,s);must(s.StackId===W.stackId,'STACK_ID');
      if(s.StackStatus==='UPDATE_COMPLETE'&&(seen||new Date(s.LastUpdatedTime).getTime()>=at)){done=true;break;}
      must(['UPDATE_COMPLETE','UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'STACK_STATE');
      if(s.StackStatus!=='UPDATE_COMPLETE')seen=true;await io.wait();
    }
    must(done,'NOT_COMPLETE');phase='VERIFY';const o=await io.observe(intent);await io.record('observed',o);
    const r={outcome:'RECOVERY_CONTINUATION_METADATA_VERIFIED_ACCEPTANCE_PENDING',controlLease:intent.controlLease,proof:o.proof,counts:o.counts,
      updateAttempts,controlAcceptancePassed:false,businessDeploymentAccepted:false,workflowDispatched:false,retryAllowed:false};await io.record('result',r);return r;
  }catch(e){const r={outcome:'RECOVERY_CONTINUATION_STOPPED_REQUIRES_INSPECT_NO_RETRY',phase,claimAttempted,claimed,updateAttempts,controlLease:intent?.controlLease??null,
    code:errorCode(e),retryAllowed:false};await io.record('result',r);return r;}
}
