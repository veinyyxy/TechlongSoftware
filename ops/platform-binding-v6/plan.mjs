// One public binding-file publication, never runtime provisioning or dispatch.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
import {FROZEN_V6 as F} from '../platform-activation-v6/publication.mjs';
export const J=Object.freeze({target:'lib/deployments/controller-v6/installed-binding.ts',slot:'F:/ChatGPT_workshop/techlong-w6j-binding-publication.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6j-runtime-binding-review.md',workflowId:'390829326',reusableId:'390829324',
  reusable:'4588febb7b33378ccf2aa1a2b552a18660be8292',templateSha256:'b222efec1e29013c7c9ab1c4c9120c40eacb484cd6b7d9f39c8b0a12e62c6187',
  boundarySha256:'0551f01ec4398abd89e52997f3a63b35ba84f2b5e68a2d29df09dfc7065a91d6',inlineSha256:'ef09a5c638b600914cf0a29873a705432a5f96ffb9cdc20c6fa16aeaaa157bfd',validMs:48*3600000});
export const must=(v,c)=>{if(!v)throw Error('BINDING_PUBLICATION_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),commit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const prefix=`// Only a separately reviewed Git publication may replace this public binding.
import type { ReleaseBinding } from './contract.ts';
export interface InstalledBindingV6 {
  state: 'UNPUBLISHED' | 'PUBLISHED';
  platform: ReleaseBinding;
  publisher: {state: 'UNPUBLISHED' | 'PUBLISHED'; releaseSha256: string | null; frozenSourceCommit: string | null};
}
const freeze = (value:InstalledBindingV6) => Object.freeze({...value,
  platform:Object.freeze(value.platform),publisher:Object.freeze(value.publisher)});
export const INSTALLED_BINDING_V6: Readonly<InstalledBindingV6> = freeze(`;
export async function bindingCandidateV6(riskSha256){
  must(digest(riskSha256),'RISK_SHA');
  const platform={state:'PUBLISHED',workflowId:J.workflowId,actorId:S.candidateBotId,reusableCommit:J.reusable,closureSha256:F.closureSha256,
    identityProofSha256:F.identityProofSha256,installationSha256:C.installationSha256,riskSha256};
  return {state:'PUBLISHED',platform,publisher:{state:'PUBLISHED',releaseSha256:await sha256Hex(platform),frozenSourceCommit:F.sourceCommit}};
}
export async function renderBindingV6(riskSha256){return prefix+JSON.stringify(await bindingCandidateV6(riskSha256),null,2)+');\n';}
export async function assertBindingPrestateV6(p,parent){
  const a=p.layout,eq=a?.iam?.trust?.Statement?.[0]?.Condition?.StringEquals;
  must(a?.main===parent&&a.source?.Account==='402010193138'&&a.source.Arn==='arn:aws:iam::402010193138:user/techlong-sandbox-dev'&&
    a.source.UserId==='AIDAV3GNMXTZEO7SHLC2X'&&a.foundation.stackId===F.stackId&&a.foundation.status==='UPDATE_COMPLETE'&&
    await sha256Hex(a.foundation.template)===J.templateSha256&&a.foundation.resources.length===5&&a.iam.roleId===C.roleId&&a.iam.arn===C.roleArn&&
    same(a.iam.trust,a.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument)&&eq['token.actions.githubusercontent.com:actor_id']===S.candidateBotId&&
    eq['token.actions.githubusercontent.com:job_workflow_ref']===`${S.repository}/.github/workflows/${C.reusableWorkflow}@${J.reusable}`&&
    a.iam.boundary.defaultVersion==='v1'&&a.iam.boundary.documentSha256===J.boundarySha256&&await sha256Hex(a.iam.inline[0].document)===J.inlineSha256&&
    a.environment.environmentId===24613410405&&a.environment.adminBypass===false&&a.environment.mainBranchOnly===true&&
    a.unfinishedDeploymentRuns===0&&p.newWorkflowUnfinishedRuns===0&&p.closureSha256===F.closureSha256,'PUBLISHED_PRESTATE');
  must(p.workflows?.length===2&&p.workflows[0].id===J.reusableId&&p.workflows[1].id===J.workflowId&&
    p.workflows.every(w=>w.state==='active'&&digest(w.sha256)),'WORKFLOW_IDENTITIES');
}
export async function makeBindingReviewV6({parent,object,pins,ci,prestate,riskSha256,createdAt}){
  must(commit(parent)&&object?.parent===parent&&object.file===J.target&&['commit','tree','blob'].every(k=>commit(object[k]))&&
    object.sha256===await sha256Hex(await renderBindingV6(riskSha256))&&Number.isSafeInteger(createdAt)&&pins.length>=15&&
    new Set(pins.map(x=>x.file)).size===pins.length&&pins.every(x=>digest(x.sha256))&&ci?.sourceCommit===parent&&ci.attempt===1&&
    ci.status==='completed'&&ci.conclusion==='success','SOURCE_OBJECT_CI');
  await assertBindingPrestateV6(prestate,parent);
  const body={schema:'techlong/platform-binding-publication-review/v6',parent,object,pins,ci,prestate,riskSha256,createdAt,expiresAt:createdAt+J.validMs,
    binding:await bindingCandidateV6(riskSha256),permanentSlot:J.slot,riskFile:J.riskFile,
    actions:{pushRefspec:object.commit+':refs/heads/main',force:false,localFastForward:object.commit},
    effects:{gitPushAttempts:1,changedPublicBindingFiles:1,localMainFastForwards:1,awsWrites:0,sqlConnections:0,secretValueReads:0,
      privateKeyReads:0,appTokens:0,workflowDispatches:0,serverStarts:0,businessWrites:0,automaticRetries:0},
    risks:{publishesPersistentCapabilityGate:true,runtimeProvisionStillSeparate:true,gitAndLocalMainNonAtomic:true,noAutomaticRollbackOrReplay:true},
    runtimeRequirements:{origin:'http://127.0.0.1:3100',maxLeaseMs:1800000,matchingReleaseAndSourceRequired:true,dedicatedDatabaseCredentialOnly:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyBindingApprovalV6(m,approved,now,inspect=false){must(same(m,await makeBindingReviewV6(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');}
export async function publishBindingOnceV6({manifest:m,approved,io,now=Date.now}){
  const approve=()=>verifyBindingApprovalV6(m,approved,now());await approve();await io.assertLocal(m);
  const start=now(),p=await io.preflight(m.parent);must(now()-start<180000&&same(p,m.prestate),'FRESH_PRESTATE');await approve();
  await io.claim({manifestSha256:m.manifestSha256,parent:m.parent,commit:m.object.commit,consumedAt:now(),retryAllowed:false});
  const guard=async()=>{await approve();must(now()-start<1200000,'EXECUTION_WINDOW');await io.assertLocal(m);};let phase='SLOT_CONSUMED';
  try{phase='PUSH_BINDING';await guard();await io.push(m,guard);await io.record('push-ack',{commit:m.object.commit});
    phase='VERIFY_REMOTE';const proof=await io.verifyRemote(m);await io.record('published-binding',proof);
    phase='LOCAL_FF';await guard();await io.fastForward(m,guard);await io.record('local-main-ack',{head:m.object.commit});
    return {outcome:'BINDING_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',proof,runtimeStarted:false,workflowDispatched:false,retryAllowed:false};
  }catch{return {outcome:'BINDING_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY',phase,runtimeStarted:false,workflowDispatched:false,retryAllowed:false};}
}
