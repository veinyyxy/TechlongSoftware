// Fixed revision10 handoff contract. No I/O, targets or approval policy overrides.
import {T,P,BEFORE,hash,same,canonical,nextTemplate,lease,verifyObserved as oldVerify} from '../platform-recovery-hosting-v1/plan.mjs';
import {policy} from '../platform-hosted-window-v6/contract.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../platform-recovery-control-v1/binding.mjs';
import {ORIGINAL_REQUEST,validateRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
export {P,hash,same,canonical,lease};
export const H=Object.freeze({...T,schema:'techlong/recovery-continuous-handoff-review/v1',
  riskFile:'docs/aws-auto-deployment-recovery-handoff-review.md',
  slot:'F:/ChatGPT_workshop/techlong-recovery-handoff-v1.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-recovery-handoff-v1.inspect.intent.json',
  publishSlot:'F:/ChatGPT_workshop/techlong-recovery-launch-v1-PublishReview.intent.json',
  priorSource:'d07516395ff7abbd15bff6bcb869ffd8916f2082',priorDefinition:BEFORE.ids.TaskDefinition.replace(/:8$/,':10'),
  priorAt:1793058846757,priorToken:'recovery-continuation-19f899a86a0f5d98b944ba36be63387e',
  parentFile:'F:/ChatGPT_workshop/techlong-recovery-continuation-executed-verified-20261026-a.json',
  parentSha256:'0ec69f56b0e940e1e4917f251c46ce037e6811a0fef7d26cfd06f8b82e37fbe8',
  chainMs:12*60000,updateWaitMs:10*60000,reviewStartMarginMs:17*60000});
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_HANDOFF_'+c);};
export const errorCode=e=>/^RECOVERY_(?:HANDOFF|HOSTING|LAUNCH|REQUEST_EVIDENCE|V1)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:null;
const ids=()=>({...BEFORE.ids,TaskDefinition:H.priorDefinition});
const inactive=()=>Array.from({length:9},(_,i)=>H.priorDefinition.replace(/:10$/,':'+(i+1)));
export async function verifyObserved(v,extra,{updated=false,source,controlLease,intentAt,token},shared){
  const d=v.resources?.StackResourceSummaries?.find(r=>r.LogicalResourceId==='TaskDefinition')?.PhysicalResourceId,
    prefix=H.priorDefinition.slice(0,-2),n=typeof d==='string'?d.slice(prefix.length):'';
  must(updated?typeof d==='string'&&d.startsWith(prefix)&&/^[1-9][0-9]*$/.test(n)&&Number.isSafeInteger(Number(n))&&Number(n)>10:d===H.priorDefinition,'DEFINITION');
  return oldVerify(v,extra,updated?{updated:true,source,controlLease,intentAt,token,priorInactive:inactive(),priorDefinition:H.priorDefinition}:
    {updated:true,source:H.priorSource,controlLease:lease(H.priorAt,H.priorSource),intentAt:H.priorAt,token:H.priorToken,
      priorInactive:inactive(),priorDefinition:BEFORE.ids.TaskDefinition.replace(/:8$/,':9')},shared);
}
export function baseline(v,extra,proof){return {stackId:H.stackId,ids:ids(),templateSha256:hash(nextTemplate(H.priorSource)),
  oldLease:lease(H.priorAt,H.priorSource),taskArn:proof.taskArn,inactive:[...extra.definitions.INACTIVE].sort(),
  tags:[...(v.stack.Stacks[0].Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),supplySha256:hash(v.supply),healthy:true};}
const digest=v=>/^[a-f0-9]{64}$/.test(v??'');
const pinSet=p=>Array.isArray(p)&&p.length>=20&&p.every(p=>typeof p.file==='string'&&digest(p.sha256))&&new Set(p.map(p=>p.file)).size===p.length;
export function review({sourceCommit,pins,reviewPins,ci,before,parents,requestEvidence,compatibility,auth,nonce,issuedAt}){
  validateRequestEvidence(requestEvidence,{basisSha256:B.basisSha256,createdAt:ORIGINAL_REQUEST.transactionAt,expiresAt:H.basisExpiresAt});
  must(requestEvidence.transactionAt===ORIGINAL_REQUEST.transactionAt,'REQUEST_TIME');
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&sourceCommit!==H.priorSource&&pinSet(pins)&&pinSet(reviewPins)&&
    reviewPins.every(p=>pins.some(q=>same(p,q)))&&ci?.sourceCommit===sourceCommit&&ci.testedSourceCommit===sourceCommit&&ci.attempt===1&&
    ci.status==='completed'&&ci.conclusion==='success'&&before?.stackId===H.stackId&&same(before.ids,ids())&&
    before.templateSha256===hash(nextTemplate(H.priorSource))&&same(before.oldLease,lease(H.priorAt,H.priorSource))&&before.healthy===true&&
    typeof before.taskArn==='string'&&before.taskArn.length>0&&Array.isArray(before.tags)&&digest(before.supplySha256)&&
    Array.isArray(before.inactive)&&before.inactive.every(d=>inactive().includes(d))&&
    parents?.length===3&&parents[0].file===H.parentFile&&parents[0].rawSha256===H.parentSha256&&parents.every(p=>digest(p.rawSha256))&&
    compatibility?.sourceCommit===sourceCommit&&compatibility.imageSource===H.imageSource&&compatibility.protectedCodeUnchanged===true&&
    auth?.contentRead===false&&Number.isSafeInteger(auth.length)&&auth.length>0&&auth.length<=131072&&digest(auth.aclSha256)&&
    /^[a-f0-9]{32}$/.test(nonce)&&Number.isSafeInteger(issuedAt),'REVIEW');
  const expiresAt=Math.min(issuedAt+H.validMs,H.basisExpiresAt),base='F:/ChatGPT_workshop/techlong-recovery-handoff-';
  const body={schema:H.schema,sourceCommit,pins,reviewPins,ci,before,parents,requestEvidence,compatibility,auth,nonce,issuedAt,expiresAt,
    latestStartAt:Math.min(expiresAt-H.chainMs,H.basisExpiresAt-35*60000),riskFile:H.riskFile,
    outputs:{run:base+'run-'+nonce,inspect:base+'inspect-'+nonce},slot:H.slot,inspectSlot:H.inspectSlot,publishSlot:H.publishSlot,
    templateSha256:hash(nextTemplate(sourceCommit)),temporaryStackPolicy:policy(),
    session:{mode:'one-real-reply-continuous-chain',freshMs:180000,availabilityMs:40*60000,chainMs:H.chainMs,
      updateWaitMs:H.updateWaitMs,reviewStartMarginMs:H.reviewStartMarginMs,reviewEveryGuardMarginMs:15*60000,reviewOperationMs:120000},
    derivedReview:{operation:'PublishReview',jobId:ORIGINAL_REQUEST.jobId,hostingManifest:'this-outer-manifest',intent:'this-run-real-intent',
      inspection:'this-run-independent-inspection',source:'this-source',ci:'this-ci',pins:'reviewPins',auth:'this-auth',
      requestEvidence:'this-original-request-evidence',createdAt:'actual-post-inspection-time',newHumanApproval:false},
    effects:{updateStackMax:1,publishPlanSubmissionsMax:1,stsMax:3,metadataMax:305,s3GetsMax:6,ciGetsMax:6,runGetsMax:2,
      configReadsMax:2,tlsConnectionsMax:3,sqlQueriesMax:145,newIam:0,secretWrites:0,directSecretValueReads:0,pemReads:0,
      businessClaims:0,dispatches:0,deleteStack:0,automaticCleanup:false},retryAllowed:false};
  return {...body,manifestSha256:hash(body)};
}
export function validate(m,sha,at,audit=false){must(same(m,review(m))&&m.manifestSha256===sha,'APPROVAL_SHA');
  if(!audit)must(Number.isSafeInteger(at)&&at>=m.issuedAt&&at<m.latestStartAt,'EXPIRED');return m;}
export function request(m,at){return {StackName:H.stackId,TemplateBody:canonical(nextTemplate(m.sourceCommit)),
  Parameters:[{ParameterKey:'HostingExpiresAt',UsePreviousValue:true},{ParameterKey:'ControllerLease',ParameterValue:canonical(lease(at,m.sourceCommit))}],
  DisableRollback:false,StackPolicyDuringUpdateBody:canonical(policy()),ClientRequestToken:'recovery-handoff-'+m.nonce};}
export function verifyIntent(m,i){must(i.manifestSha256===m.manifestSha256&&same(i.request,request(m,i.intentAt))&&same(i.controlLease,lease(i.intentAt,m.sourceCommit)),'INTENT');}
export function verifyInspection(m,i,x){verifyIntent(m,i);const p=x?.proof;
  must(x?.outcome==='RECOVERY_HANDOFF_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING'&&x.cloudWrites===0&&x.counts?.sts===1&&x.counts.metadata<=65&&
    p?.stackId===H.stackId&&p.stackStatus==='UPDATE_COMPLETE'&&p.healthy===true&&p.dnsAliasVerified===true&&p.executionSource===m.sourceCommit&&
    p.imageDigest===H.imageDigest&&same(p.controlLease,i.controlLease)&&x.counts.writes===0&&
    x.controlAcceptancePassed===false&&x.businessDeploymentAccepted===false,'INSPECTION');
  const rs=p.resources,doc=nextTemplate(m.sourceCommit),prefix=H.priorDefinition.slice(0,-2),d=p.taskDefinition,n=typeof d==='string'?d.slice(prefix.length):'';
  must(typeof d==='string'&&d.startsWith(prefix)&&/^[1-9][0-9]*$/.test(n)&&Number.isSafeInteger(Number(n))&&Number(n)>10&&
    Array.isArray(rs)&&rs.length===11&&new Set(rs.map(r=>r.id)).size===11&&rs.every(r=>Object.hasOwn(m.before.ids,r.id)&&
      r.type===doc.Resources[r.id].Type&&['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(r.status)&&
      r.physicalId===(r.id==='TaskDefinition'?d:m.before.ids[r.id])),'INSPECTION_IDENTITIES');
}
