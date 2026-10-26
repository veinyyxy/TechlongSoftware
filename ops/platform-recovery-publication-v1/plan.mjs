// Local publication profile. JSON cannot select a capability, endpoint or slot.
import {createHash} from 'node:crypto';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {U as OLD,must,same,validatePublicationSourceV6,reconcilePublicationLayoutV6} from '../platform-publication-v6/plan.mjs';
import {FROZEN_V6} from '../platform-activation-v6/publication.mjs';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';

export const R=Object.freeze({...FROZEN_V6,sourceCommit:'0494b2be7b0f559ac991533137dfb1b0388ac7a9',
  closureSha256:'30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374',
  oldReusable:'4588febb7b33378ccf2aa1a2b552a18660be8292'});
export const Q=Object.freeze({...OLD,slot:'F:/ChatGPT_workshop/techlong-w9k-recovery-publication.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w9k-recovery-publication.inspect.intent.json',validMs:24*3600000,
  riskFile:'docs/aws-auto-deployment-w9k-recovery-publication-review.md',awsMetadataMax:180,githubGetsMax:160});
export const PROOFS=Object.freeze([
  {file:'F:/ChatGPT_workshop/techlong-w9i-metadata-read-completed-verified-20261025-a.json',rawSha256:'e5d762b5cff75795e7000ef33e61fa2b08e67766d6b2b71d1cb0d4429df8aa34'},
  {file:'F:/ChatGPT_workshop/techlong-w9j-template-branch-read-completed-verified-20261025-a.json',rawSha256:'a16d4f7f32caadf0376c1e951cf6797ec73ab2d72325cc2ab76f1e6ea84570f2'}]);
export const TEMPLATE_SHA='b222efec1e29013c7c9ab1c4c9120c40eacb484cd6b7d9f39c8b0a12e62c6187';
export const INLINE_SHA='ef09a5c638b600914cf0a29873a705432a5f96ffb9cdc20c6fa16aeaaa157bfd';
export const BOUNDARY_SHA='0551f01ec4398abd89e52997f3a63b35ba84f2b5e68a2d29df09dfc7065a91d6';
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
export const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonicalJson(v)).digest('hex');
const claim='token.actions.githubusercontent.com:job_workflow_ref';
export const workflowRef=r=>S.repository+'/'+Q.reusable+'@'+r;
export function trustOnlyRecoveryTemplate(template,reusable){
  must(sha(reusable)&&hash(template)===TEMPLATE_SHA,'RECOVERY_ORIGINAL_TEMPLATE');
  const t=structuredClone(template),trust=t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;
  must(trust.Statement.length===1&&trust.Statement[0].Condition.StringEquals[claim]===workflowRef(R.oldReusable)&&
    trust.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:actor_id']===S.candidateBotId,'RECOVERY_OLD_TRUST');
  trust.Statement[0].Condition.StringEquals[claim]=workflowRef(reusable);
  const restore=structuredClone(t);restore.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim]=workflowRef(R.oldReusable);
  must(same(restore,template),'RECOVERY_TRUST_ONLY');
  return {template:t,changes:[{claim:'job_workflow_ref',before:workflowRef(R.oldReusable),after:workflowRef(reusable)}]};
}
export function validateBaseline(b){
  must(same(b.proofs,PROOFS)&&b.observedAt===1792975829334&&b.supplementalAt===1792976533569&&hash(b.template)===TEMPLATE_SHA&&
    same(b.source,{Account:'402010193138',Arn:Q.sourceArn,UserId:Q.sourceUserId})&&b.resources.length===5&&
    b.iam.roleId===C.roleId&&b.iam.arn===C.roleArn&&b.iam.name===Q.roleName&&same(b.iam.attached,[])&&
    b.iam.inline.length===1&&b.iam.inline[0].name==='ExactSandboxWorkerV5'&&hash(b.iam.inline[0].document)===INLINE_SHA&&
    b.iam.boundary.policyId==='ANPAV3GNMXTZK24FGAXCF'&&b.iam.boundary.defaultVersion==='v1'&&hash(b.iam.boundary.document)===BOUNDARY_SHA&&
    b.iam.boundary.documentSha256===BOUNDARY_SHA&&same(b.iam.trust,b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument)&&
    b.branchRule.id===63436866&&b.branchRule.name==='main'&&b.branchRule.type==='branch'&&
    same(b.workflowIds,{caller:'390829326',reusable:'390829324'}),'RECOVERY_SAVED_BASELINE');
  trustOnlyRecoveryTemplate(b.template,R.sourceCommit);
}
export function validateRecoveryPreflight(p,m){
  validatePublicationSourceV6(p);validateBaseline(m.baseline);const b=m.baseline;
  must(p.main===m.parent&&same(p.source,b.source)&&same(p.foundation.template,b.template)&&same(p.foundation.resources,b.resources)&&
    same(p.iam.trust,b.iam.trust)&&same(p.iam.inline,b.iam.inline)&&same(p.iam.attached,b.iam.attached)&&
    same(p.iam.boundary,b.iam.boundary)&&p.iam.roleId===b.iam.roleId&&p.iam.arn===b.iam.arn&&p.iam.name===b.iam.name,'RECOVERY_FRESH_BASELINE');
}
export function reconcileRecoveryLayout(actual,m,state,executionPrestate){
  validateRecoveryPreflight(executionPrestate,m);
  return reconcilePublicationLayoutV6(actual,{...m,prestate:executionPrestate},state);
}
export function validateRecoveryObjects(parent,objects){
  must(sha(parent)&&objects?.reusable.parent===parent&&objects.caller?.parent===objects.reusable.commit&&
    objects.reusable.file===Q.reusable&&objects.caller.file===Q.caller,'RECOVERY_OBJECT_CHAIN');
  const texts=recoveryCloudWorkflows({...R,reusableCommit:objects.reusable.commit});
  for(const [o,text] of [[objects.reusable,texts.reusable],[objects.caller,texts.caller]])
    must(['commit','tree','blob'].every(k=>sha(o[k]))&&o.normalizedLfSha256===hash(text),'RECOVERY_OBJECT_BYTES');
  return texts;
}
export async function makeRecoveryPublicationReview({parent,objects,previousTargets,pins,ci,baseline,createdAt}){
  validateBaseline(baseline);validateRecoveryObjects(parent,objects);
  must(Number.isSafeInteger(createdAt)&&createdAt>=baseline.supplementalAt&&createdAt<baseline.observedAt+Q.validMs&&
    pins.length>=15&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>digest(p.sha256))&&
    ci?.sourceCommit===parent&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&/^[1-9][0-9]{0,15}$/.test(ci.jobId)&&
    previousTargets?.length===2&&same(previousTargets.map(t=>t.file),[Q.reusable,Q.caller])&&
    previousTargets.every(t=>sha(t.blob)&&digest(t.normalizedLfSha256)),'RECOVERY_REVIEW_INPUT');
  const change=trustOnlyRecoveryTemplate(baseline.template,objects.reusable.commit);
  const create={StackName:R.stackId,ChangeSetName:'recovery-app-v1-'+objects.caller.commit.slice(0,24),ChangeSetType:'UPDATE',
    TemplateBody:canonicalJson(change.template),Capabilities:['CAPABILITY_NAMED_IAM'],
    Description:'Recovery V1 pinned reusable trust only; '+objects.reusable.commit};
  must(Buffer.byteLength(create.TemplateBody)<=51200,'RECOVERY_TEMPLATE_SIZE');
  create.ClientToken='recovery-app-create-v1-'+(await sha256Hex(create)).slice(0,40);
  const body={schema:'techlong/recovery-publication-review/v1',parent,objects,previousTargets,pins,ci,baseline,createdAt,
    expiresAt:Math.min(createdAt+Q.validMs,baseline.observedAt+Q.validMs),frozen:R,permanentSlot:Q.slot,inspectSlot:Q.inspectSlot,riskFile:Q.riskFile,
    requiredExecutionChecks:{notPreviouslyObserved:true,stackStatus:'UPDATE_COMPLETE',stackRoleArn:null,stackParameters:[],
      environmentId:24613410405,adminBypass:false,requiredReviewerId:14145707,mainOnly:true,immutableOidcSubject:true,
      unfinishedDeploymentRuns:0,remoteMain:parent,unchangedSavedBaseline:true,preflightMaxMs:180000,executionMaxMs:1200000,
      awsMetadataMax:Q.awsMetadataMax,githubGetsMax:Q.githubGetsMax},
    actions:{push:{remote:'github',refspec:objects.caller.commit+':refs/heads/main',force:false},create,
      execute:{StackName:R.stackId,ChangeSetName:'EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,
        ClientRequestToken:'recovery-app-execute-v1-'+(await sha256Hex(create)).slice(0,40)},trustChanges:change.changes,localFastForward:objects.caller.commit},
    effects:{gitPushAttempts:1,existingWorkflowUpdates:2,newWorkflowFiles:0,createChangeSetAttempts:1,executeChangeSetAttempts:1,
      existingWorkerTrustUpdates:1,localMainFastForwards:1,independentInspectAttempts:1,iamPermissionExpansion:0,newIamResources:0,
      environmentWrites:0,secretValueReads:0,appKeyReads:0,dispatches:0,sqlConnections:0,packageUploads:0,controllerActivations:0,workloadCreates:0,automaticWriteRetries:0},
    risks:{crossServiceNonAtomic:true,concurrentChangesNotCas:true,disableFailureRollback:true,oldWorkflowPinLosesRoleAccess:true,
      partialPublishedWorkflowsOrTrustMayRemain:true,sourceLoginMayExpire:true,noAutomaticRollbackDeleteOrReplay:true,
      permanentSlotsNeverReset:true,lowCostNotZero:true},preparationIsNotExecutionApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateRecoveryApproval(m,approved,now,inspect=false){
  must(same(m,await makeRecoveryPublicationReview(m)),'RECOVERY_MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'RECOVERY_APPROVAL_OR_EXPIRED');
}
