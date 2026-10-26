// Exact App workflow/trust publication review. No clients or credential reads.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {appTrustOnlyTemplateV6,FROZEN_V6 as F} from '../platform-activation-v6/publication.mjs';
import {verifyActivationChangeSetV5} from '../cloud-worker/activation/plan-v5.mjs';
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
export const U=Object.freeze({slot:'F:/ChatGPT_workshop/techlong-w6i-app-publication.intent.json',validMs:48*3600000,
  riskFile:'docs/aws-auto-deployment-platform-w6i-app-publication-review.md',roleName:'TechlongSandboxGitHubDeploymentWorkerRole',
  sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',sourceUserId:'AIDAV3GNMXTZEO7SHLC2X',
  caller:'.github/workflows/'+S.workflowFile,reusable:'.github/workflows/'+C.reusableWorkflow});
export const must=(v,c)=>{if(!v)throw Error('APP_PUBLICATION_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validatePublicationSourceV6(p){
  must(p.source?.Account==='402010193138'&&p.source.Arn===U.sourceArn&&p.source.UserId===U.sourceUserId&&
    p.foundation?.stackId===F.stackId&&p.foundation.status==='UPDATE_COMPLETE'&&p.foundation.roleArn===null&&
    same(p.foundation.parameters,[])&&Object.keys(p.foundation.template.Parameters??{}).length===0&&
    p.foundation.resources?.length===5&&p.iam?.roleId===C.roleId&&p.iam.arn===C.roleArn&&p.iam.name===U.roleName&&
    p.iam.inline?.length===1&&p.iam.inline[0].name==='ExactSandboxWorkerV5'&&same(p.iam.attached,[])&&
    digest(p.iam.boundary?.documentSha256)&&p.environment?.environmentId===24613410405&&p.environment.adminBypass===false&&
    p.environment.requiredReviewerId===14145707&&p.environment.mainBranchOnly===true&&p.unfinishedDeploymentRuns===0&&
    p.oidc?.use_default===true&&p.oidc.use_immutable_subject===true&&
    p.oidc.sub_claim_prefix==='repo:veinyyxy@14145707/TechlongSoftware@1323312747','PRESTATE');
}
export function validatePublicationObjectsV6(parent,o){
  must(sha(parent)&&o?.reusable?.parent===parent&&o.caller?.parent===o.reusable.commit&&
    o.reusable.file===U.reusable&&o.caller.file===U.caller,'OBJECT_CHAIN');
  const texts=cloudWorkflowsV6({...F,reusableCommit:o.reusable.commit});
  for(const [x,text] of [[o.reusable,texts.reusable],[o.caller,texts.caller]])
    must(['commit','tree','blob'].every(k=>sha(x[k]))&&digest(x.normalizedLfSha256)&&text.length>100,'OBJECT_FIELDS');
  return texts;
}
export async function makeAppPublicationReviewV6({parent,objects,pins,ci,prestate,createdAt}){
  validatePublicationSourceV6(prestate);validatePublicationObjectsV6(parent,objects);
  must(prestate.main===parent&&Number.isSafeInteger(createdAt)&&pins.length>=10&&new Set(pins.map(x=>x.file)).size===pins.length&&
    pins.every(x=>digest(x.sha256))&&ci?.sourceCommit===parent&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success','SOURCE_CI');
  const change=appTrustOnlyTemplateV6(prestate.foundation.template,objects.reusable.commit);
  must(same(prestate.iam.trust,prestate.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument),'LIVE_TRUST');
  const texts=validatePublicationObjectsV6(parent,objects);
  for(const [x,text] of [[objects.reusable,texts.reusable],[objects.caller,texts.caller]])must(await sha256Hex(text)===x.normalizedLfSha256,'WORKFLOW_HASH');
  const create={StackName:F.stackId,ChangeSetName:'platform-app-v6-'+objects.caller.commit.slice(0,24),ChangeSetType:'UPDATE',
    TemplateBody:canonicalJson(change.template),Capabilities:['CAPABILITY_NAMED_IAM'],
    Description:'App actor and pinned V6 reusable trust only; '+objects.reusable.commit};
  must(Buffer.byteLength(create.TemplateBody)<=51200,'INLINE_TEMPLATE_SIZE');
  create.ClientToken='platform-app-create-v6-'+(await sha256Hex(create)).slice(0,40);
  const body={schema:'techlong/platform-app-publication-review/v6',parent,objects,pins,ci,prestate,createdAt,expiresAt:createdAt+U.validMs,
    frozen:F,permanentSlot:U.slot,riskFile:U.riskFile,
    actions:{push:{remote:'github',refspec:objects.caller.commit+':refs/heads/main',force:false},create,
      execute:{StackName:F.stackId,ChangeSetName:'EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,
        ClientRequestToken:'platform-app-execute-v6-'+(await sha256Hex(create)).slice(0,40)},
      trustChanges:change.changes,localFastForward:objects.caller.commit},
    effects:{gitPushAttempts:1,newManualWorkflowFiles:2,createChangeSetAttempts:1,executeChangeSetAttempts:1,localMainFastForwards:1,
      existingWorkerTrustUpdates:1,iamPermissionExpansion:0,newIamResources:0,environmentWrites:0,secretValueReads:0,appKeyReads:0,
      appTokens:0,dispatches:0,neonConnections:0,workloadCreates:0,automaticWriteRetries:0},
    risks:{crossServiceNonAtomic:true,oldPersonalWorkerLosesRoleAccess:true,disableFailureRollback:true,concurrentChangesNotCas:true,
      partialPublishedWorkflowsOrTrustMayRemain:true,noAutomaticRollbackDeleteOrReplay:true,sourceLoginMayExpire:true},
    preparationIsNotExecutionApproval:true,platformAndPublisherRemainUnpublished:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateAppPublicationApprovalV6(m,approved,now,inspect=false){
  must(same(m,await makeAppPublicationReviewV6(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export function verifyAppChangeSetV6(d,m,id,template){
  const name=m.actions.create.ChangeSetName;
  must(typeof id==='string'&&new RegExp('^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+name+'/[a-f0-9-]{36}$').test(id)&&
    d.ChangeSetId===id&&d.ChangeSetName===name&&d.Description===m.actions.create.Description&&same(d.Capabilities,['CAPABILITY_NAMED_IAM'])&&
    !(d.Parameters??[]).length&&!d.ParentChangeSetId&&!d.RootChangeSetId&&(d.RoleARN??null)===null&&
    same(template,JSON.parse(m.actions.create.TemplateBody)),'CHANGE_SET_BINDING');
  return verifyActivationChangeSetV5(d,F.stackId,U.roleName);
}
export function reconcilePublicationLayoutV6(actual,m,state){
  must(['old','new'].includes(state),'LAYOUT_STATE');const p=structuredClone(actual),old=m.prestate;
  must(p.main===m.objects.caller.commit&&same(p.foundation.template,state==='old'?old.foundation.template:JSON.parse(m.actions.create.TemplateBody))&&
    same(p.iam.trust,p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument),'LAYOUT_TRUST_OR_MAIN');
  p.main=old.main;p.foundation.template=structuredClone(old.foundation.template);p.iam.trust=structuredClone(old.iam.trust);
  must(same(p,old),'NON_TRUST_LAYOUT_DRIFT');return {state,remainingLayoutUnchanged:true,roleId:p.iam.roleId};
}
export async function publishAppOnceV6({manifest:m,approved,io,now=Date.now,profile}){
  // Optional profiles are code capabilities, never selected by manifest fields.
  const approve=()=>profile?profile.validateApproval(m,approved,now()):validateAppPublicationApprovalV6(m,approved,now());
  const reconcile=(actual,state,p)=>profile?profile.reconcile(actual,m,state,p):reconcilePublicationLayoutV6(actual,m,state);
  await approve();await io.assertLocal(m);
  const start=now(),p=await io.preflight(m.parent);
  must(now()-start<180000,'FRESH_PRESTATE');if(profile)await profile.validatePreflight(p,m);else must(same(p,m.prestate),'FRESH_PRESTATE');
  await approve();if(profile)await io.record('execution-preflight',p);
  await io.consume({manifestSha256:m.manifestSha256,parent:m.parent,caller:m.objects.caller.commit,consumedAt:now(),retryAllowed:false,
    ...(profile?{preflightSha256:await sha256Hex(p)}:{})});
  let phase='SLOT_CONSUMED';
  const guard=async()=>{await approve();must(now()-start<1200000,'EXECUTION_WINDOW');await io.assertLocal(m);};
  try{
    phase='PUSH_WORKFLOWS';await guard();await io.push(m,guard);await io.record('push-ack',{caller:m.objects.caller.commit});
    await io.record('published-workflows',await io.verifyWorkflows(m));
    phase='PRE_CREATE_LAYOUT';reconcile(await io.layout(),'old',p);
    phase='CREATE_CHANGE_SET';await guard();const ref=await io.create(m,guard);await io.record('create-ack',ref);
    phase='VERIFY_CHANGE_SET';await io.waitChangeSet(m,ref,guard);
    phase='PRE_EXECUTE_LAYOUT';reconcile(await io.layout(),'old',p);
    phase='EXECUTE_CHANGE_SET';await guard();await io.execute(m,ref,guard);await io.record('execute-ack',ref);
    phase='WAIT_FOUNDATION';await io.waitFoundation(guard);
    phase='FINAL_LAYOUT';const proof=reconcile(await io.layout(),'new',p);await io.record('post-layout',proof);
    const workflows=await io.verifyWorkflows(m);await io.record('final-workflows',workflows);
    phase='LOCAL_FAST_FORWARD';await guard();await io.fastForward(m,guard);await io.record('local-main-ack',{head:m.objects.caller.commit});
    return {outcome:'APP_WORKFLOWS_AND_TRUST_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',changeSetId:ref.id,workflows,
      runtimeEnabled:false,workflowDispatched:false,retryAllowed:false};
  }catch{return {outcome:'APP_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',phase,runtimeEnabled:false,workflowDispatched:false,retryAllowed:false};}
}
