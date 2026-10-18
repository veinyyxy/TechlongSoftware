// One existing inline-policy Resource correction. No runtime/workflow changes.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {activationTemplateV5} from './activation/release-v5.mjs';
import {ECS_JOB_DISPATCH_V5 as JOB} from './ecs-job-dispatch-v5.mjs';
import {ECS_ABSENCE_PUBLICATION_V5 as PUB} from './ecs-absence-publication-v5.mjs';
import {requireActivationV5 as must,safeActivationFailureV5} from './activation/errors-v5.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const TASK_DEFINITION_PERMISSION_V5=Object.freeze({
  roleName:PUB.roleName,roleId:PUB.roleId,stackId:PUB.stackId,runtime:JOB.runtime,reusable:JOB.reusable,closureSha256:JOB.closureSha256,
  oldTemplateSha256:'b9dc0f524b2aeafb8e7986b2a6f0fb985392ce0b9f956c2ba10e4d9206342a41',
  oldResource:'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:*',
  slot:'F:/ChatGPT_workshop/techlong-cloud-worker-v5-task-definition-read-correction-v1.permanent-slot.json',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5p-task-definition-read.md',
});
const V=TASK_DEFINITION_PERMISSION_V5;
export function taskDefinitionPermissionChangeV5(capsule){
  const oldTemplate=activationTemplateV5(capsule,V.reusable),template=structuredClone(oldTemplate),policies=template.Resources.WorkerRole.Properties.Policies;
  must(policies.length===1&&policies[0].PolicyName==='ExactSandboxWorkerV5','TASKDEF_EXACT_INLINE');
  const statements=policies[0].PolicyDocument.Statement,found=statements.map((s,i)=>({s,i})).filter(({s})=>[s.Action].flat().includes('ecs:DescribeTaskDefinition'));
  must(found.length===1&&same(found[0].s,{Effect:'Allow',Action:'ecs:DescribeTaskDefinition',Resource:V.oldResource,
    Condition:{StringEquals:{'aws:RequestedRegion':'ca-central-1'}}}),'TASKDEF_OLD_SINGLE_STATEMENT');
  const index=found[0].i;statements[index].Resource='*';
  const copy=structuredClone(template);copy.Resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement[index].Resource=V.oldResource;
  must(same(copy,oldTemplate),'TASKDEF_ONLY_RESOURCE_CHANGE');
  return {oldTemplate,template,onlyChange:{resource:'WorkerRole',policy:'ExactSandboxWorkerV5',statementIndex:index,
    action:'ecs:DescribeTaskDefinition',oldResource:V.oldResource,newResource:'*',region:'ca-central-1',
    broaderRegionalTaskDefinitionRead:true,notTenantFilteredByIam:true}};
}
export async function prepareTaskDefinitionPermissionV5({source,history,prestate:p,capsule,now}){
  must(Number.isSafeInteger(now)&&now>0&&/^[a-f0-9]{40}$/.test(source.commit)&&source.files.length>=164&&
    source.runtimeClosureSha256===V.closureSha256&&history.permissionFailureEvidenceVerified===true&&history.failedReviewSourcePinsVerified===159&&
    history.oldReviewSlotsPreserved===true&&p.main===source.commit&&p.sourceCiConfirmed===true&&p.unfinishedRuns===0&&
    p.runtimeCommit===V.runtime&&p.reusableCommit===V.reusable&&p.roleId===V.roleId&&p.layout?.state==='old'&&
    p.layout.main===source.commit&&p.layout.stackStatus==='UPDATE_COMPLETE'&&p.layout.roleId===V.roleId&&p.layout.boundaryDefaultVersion==='v1'&&
    p.layout.templateSha256===V.oldTemplateSha256,'TASKDEF_SOURCE_AND_PRESTATE');
  const change=taskDefinitionPermissionChangeV5(capsule),text=canonicalJson(change.template);
  must(await sha256Hex(change.oldTemplate)===V.oldTemplateSha256&&Buffer.byteLength(text)<=51200,'TASKDEF_TEMPLATE_BASELINE');
  const create={StackName:V.stackId,ChangeSetName:'taskdef-read-v5-'+source.commit.slice(0,24),ChangeSetType:'UPDATE',TemplateBody:text,
    Capabilities:['CAPABILITY_NAMED_IAM'],Description:'Only ecs DescribeTaskDefinition Resource compatibility; ca-central-1 retained'};
  create.ClientToken='taskdef-read-v5-'+(await sha256Hex({create,preparedAt:now})).slice(0,40);
  const body={schema:'techlong/cloud-worker-task-definition-permission-review/v5',preparedAt:now,expiresAt:now+7200000,
    source,history,prestate:p,runtimeCommit:V.runtime,reusableCommit:V.reusable,permanentSlot:V.slot,riskFile:V.riskFile,
    actions:{create,templateSha256:await sha256Hex(change.template),inlinePolicySha256:await sha256Hex(change.template.Resources.WorkerRole.Properties.Policies[0].PolicyDocument),onlyChange:change.onlyChange,
      execute:{StackName:V.stackId,ChangeSetName:'ONLY_EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,
        ClientRequestToken:'taskdef-read-execute-v5-'+(await sha256Hex(create)).slice(0,40)}},
    effects:{foundationChangeSetCreate:1,foundationChangeSetExecute:1,existingInlineResourceExpansion:1,persistentPermissionChange:true,
      trustChanges:0,boundaryChanges:0,newIamResources:0,gitPublication:0,workflowChanges:0,workflowDispatches:0,
      secretValueReads:0,neonWrites:0,s3Writes:0,jobClaims:0,workloadCreates:0,automaticWriteRetries:0},
    risks:{nonAtomic:true,noCrossServiceCas:true,disableFailureRollback:true,regionalTaskDefinitionsMayContainSensitiveConfiguration:true,
      broadReadCannotBeRestrictedToOneTenantByThisIamAction:true,existingSessionsMayGainReadAccess:true,propagationNotGuaranteed:true,
      automaticRollback:false,automaticRevocation:false,automaticCleanup:false,slotReset:false,hardMonthlyCostCap:false},
    preparationIsNotExecutionApproval:true,independentNewProcessInspectRequired:true,
    inspectScope:'Exact CFN/IAM/five-resource identity and frozen Git main; Secret/catalog/job facts are preflight-only, not a post-update health claim'};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertTaskDefinitionPermissionApprovalV5(m,approved,c,now){
  must(/^[a-f0-9]{64}$/.test(approved)&&approved===m.manifestSha256&&now>=m.preparedAt&&now<m.expiresAt&&
    same(m,await prepareTaskDefinitionPermissionV5({...c,now:m.preparedAt})),'TASKDEF_FRESH_EXACT_APPROVAL');
}
export function verifyTaskDefinitionPermissionChangeSetV5(d,m,id,template){
  const r=d.Changes?.[0]?.ResourceChange;
  must(/^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/taskdef-read-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(id)&&
    id.split('/')[1]===m.actions.create.ChangeSetName&&d.ChangeSetId===id&&d.StackId===V.stackId&&d.Status==='CREATE_COMPLETE'&&
    d.ExecutionStatus==='AVAILABLE'&&!d.NextToken&&d.Changes?.length===1&&r?.Action==='Modify'&&r.LogicalResourceId==='WorkerRole'&&
    r.PhysicalResourceId===V.roleName&&r.ResourceType==='AWS::IAM::Role'&&r.Replacement==='False'&&same(r.Scope,['Properties'])&&
    r.Details?.length>=1&&r.Details.every(x=>x.Target?.Attribute==='Properties'&&x.Target.Name==='Policies'&&x.Target.RequiresRecreation==='Never'&&
      x.ChangeSource==='DirectModification'&&x.Evaluation==='Static')&&same(template,JSON.parse(m.actions.create.TemplateBody)),'TASKDEF_EXACT_POLICY_ONLY_CHANGESET');
  return {changeSetId:id,stackId:V.stackId,changedLogicalId:'WorkerRole',changedProperty:'Policies',replacement:false};
}
export function assertTaskDefinitionLayoutV5(actual,m,state){
  must(['old','new'].includes(state)&&actual.state===state&&actual.templateSha256===(state==='old'?m.prestate.layout.templateSha256:m.actions.templateSha256)&&
    actual.inlinePolicySha256===(state==='old'?m.prestate.layout.inlinePolicySha256:m.actions.inlinePolicySha256),'TASKDEF_LAYOUT_STATE_AND_POLICY');
  const normalized=structuredClone(actual);
  if(state==='new'){
    normalized.state='old';normalized.templateSha256=m.prestate.layout.templateSha256;normalized.inlinePolicySha256=m.prestate.layout.inlinePolicySha256;
  }
  must(same(normalized,m.prestate.layout),'TASKDEF_REMAINING_LAYOUT_UNCHANGED');return actual;
}
export async function applyTaskDefinitionPermissionV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=()=>assertTaskDefinitionPermissionApprovalV5(m,approved,context,now());
  await approve();const start=now(),prestate=await io.preflight();
  must(same(prestate,m.prestate)&&now()-start<180000,'TASKDEF_FRESH_PREFLIGHT');await approve();
  await io.consumeSlot({manifestSha256:m.manifestSha256,at:now(),retryAllowed:false,oldSlotsPreserved:true});
  let phase='SlotConsumed';const guard=async()=>{await approve();must(now()-start<1200000,'TASKDEF_EXECUTION_WINDOW');await io.assertLocalSource(m);};
  try{
    phase='CreatePolicyOnlyChangeSet';await guard();await io.record('create.intent',{manifestSha256:m.manifestSha256,at:now()});
    const ref=await io.createChangeSet(m.actions.create,guard);await io.record('create.ack',ref);
    phase='VerifyExactPolicyOnlyChangeSet';await io.record('changeset-verified',await io.waitChangeSet(ref,m,guard));
    phase='VerifyOldLayoutBeforeExecute';assertTaskDefinitionLayoutV5(await io.readLayout('old'),m,'old');
    phase='ExecutePolicyOnlyChangeSet';await guard();await io.record('execute.intent',{manifestSha256:m.manifestSha256,changeSetId:ref.changeSetId,at:now()});
    await io.record('execute.ack',await io.executeChangeSet(ref,m,guard));
    phase='WaitFoundation';await io.waitFoundation(guard);
    phase='FinalSameProcessReadback';const proof=assertTaskDefinitionLayoutV5(await io.readLayout('new'),m,'new');await io.record('final-layout',proof);
    const result={outcome:'TASK_DEFINITION_READ_CORRECTED_REQUIRES_INDEPENDENT_INSPECT',manifestSha256:m.manifestSha256,changeSetId:ref.changeSetId,
      proof,counts:io.counts(),independentInspectRequired:true,workflowDispatched:false,retryAllowed:false};await io.record('result',result);return result;
  }catch(e){const result={outcome:'TASK_DEFINITION_PERMISSION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',manifestSha256:m.manifestSha256,phase,
    failure:safeActivationFailureV5(e),counts:io.counts(),independentInspectRequired:true,retryAllowed:false};await io.record('stopped',result);return result;}
}
