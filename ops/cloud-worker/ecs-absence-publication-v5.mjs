// One reviewed version transition only; no network or credential discovery here.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {DNS_RELEASE_V5 as A} from './dns-release-v5.mjs';
import {activationTemplateV5} from './activation/release-v5.mjs';
import {verifyActivationChangeSetV5} from './activation/plan-v5.mjs';
import {requireActivationV5 as must,safeActivationFailureV5} from './activation/errors-v5.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const ECS_ABSENCE_PUBLICATION_V5=Object.freeze({
  roleName:A.roleName,roleId:A.roleId,stackId:A.stackId,caller:A.caller,reusable:A.reusable,
  oldRuntime:'e55367c370ca5aa883d8a7e1342514fc3f34c442',oldReusable:'46312fff06d60e9e4ca96be6bb8d82ce1ce3d109',
  oldClosure:'e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299',
  candidateClosure:'70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac',
  slot:'F:/ChatGPT_workshop/techlong-cloud-worker-v5-ecs-absence-release-v1.permanent-slot.json',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5n-ecs-publication.md',
  workflowId:388188162,environmentId:24613410405,tableId:'ea69c69e-1c48-481a-83f0-36393c196d9f',
});
const V=ECS_ABSENCE_PUBLICATION_V5;
export function ecsAbsenceTrustChangeV5(capsule,reusable){
  must(/^[a-f0-9]{40}$/.test(reusable)&&reusable!==V.oldReusable,'ECS_ABSENCE_NEW_REUSABLE');
  const oldTemplate=activationTemplateV5(capsule,V.oldReusable),template=activationTemplateV5(capsule,reusable),copy=structuredClone(template),
    key='token.actions.githubusercontent.com:job_workflow_ref',get=t=>t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals,
    oldValue=get(oldTemplate)[key],newValue=get(template)[key];
  get(copy)[key]=oldValue;must(same(copy,oldTemplate),'ECS_ABSENCE_TRUST_ONLY');
  return {oldTemplate,template,onlyChange:{resource:'WorkerRole',property:'AssumeRolePolicyDocument.Statement[0].Condition.StringEquals',key,oldValue,newValue}};
}
export async function prepareEcsAbsencePublicationV5({source,history,release,prestate:p,capsule,now}){
  must(Number.isSafeInteger(now)&&now>0&&source.commit===release.sourceCommit&&source.commit===release.runtimeCommit&&
    /^[a-f0-9]{40}$/.test(source.commit)&&release.reusable.parent===source.commit&&release.caller.parent===release.reusable.commit&&
    source.runtimeClosureSha256===V.candidateClosure&&source.files.length>=147&&history.ecsFixVerified===true&&
    history.historicalSourcePinsVerified===142&&history.oldRecordsAndSlotsPreserved===true&&history.failedReviewRunId==='39149802733'&&
    p.main===source.commit&&p.roleId===V.roleId&&p.tableId===V.tableId&&p.templateMatchesOld===true&&p.installedReusable===V.oldReusable&&
    p.environment?.environmentId===V.environmentId&&p.environment.requiredReviewerId===14145707&&p.environment.adminBypass===false&&
    p.environment.mainBranchOnly===true&&p.unfinishedDeploymentRuns===0&&p.sourceCiConfirmed===true&&/^[a-f0-9]{64}$/.test(p.metadataSha256),
  'ECS_ABSENCE_SOURCE_AND_PRESTATE');
  const change=ecsAbsenceTrustChangeV5(capsule,release.reusable.commit),text=canonicalJson(change.template);
  must(Buffer.byteLength(text)<=51200,'ECS_ABSENCE_INLINE_TEMPLATE_SIZE');
  const create={StackName:V.stackId,ChangeSetName:'ecs-absence-v5-'+release.caller.commit.slice(0,24),ChangeSetType:'UPDATE',TemplateBody:text,
    Capabilities:['CAPABILITY_NAMED_IAM'],Description:'Strict ECS absence fix; exact reusable '+release.reusable.commit};
  create.ClientToken='ecs-absence-v5-'+(await sha256Hex(create)).slice(0,40);
  const body={schema:'techlong/cloud-worker-ecs-absence-publication-review/v5',preparedAt:now,expiresAt:now+7200000,
    source,history,release,prestate:p,permanentSlot:V.slot,riskFile:V.riskFile,
    actions:{publish:{remote:'github',refspec:release.caller.commit+':refs/heads/main',force:false,onlyFiles:[V.caller,V.reusable]},
      foundation:{create,templateSha256:await sha256Hex(change.template),onlyChange:change.onlyChange,
        execute:{StackName:V.stackId,ChangeSetName:'ONLY_EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,
          ClientRequestToken:'ecs-absence-execute-v5-'+(await sha256Hex(create)).slice(0,40)},
        exactTemplateAndTrustOnlyChangeMustBeIndependentlyVerifiedBeforeExecute:true}},
    effects:{preparedMainFastForward:1,foundationChangeSetCreate:1,foundationChangeSetExecute:1,existingRoleTrustReplacement:1,
      localMainFastForward:1,permanentLocalSlot:1,permissionExpansion:0,newIamResources:0,environmentWrites:0,s3Writes:0,secretValueReads:0,
      neonWrites:0,workflowDispatches:0,automaticWorkflowDispatch:0,jobClaims:0,workloadCreates:0,automaticWriteRetries:0},
    risks:{nonAtomic:true,branchUnprotected:true,temporaryOidcDenialBetweenPublishAndTrustUpdate:true,disableFailureRollback:true,
      oldCAndRRetained:true,automaticRetry:false,automaticCompensation:false,guaranteedCleanup:false,hardMonthlyCap:false},
    preparationIsNotExecutionApproval:true,executableEntryAvailable:true,
    dynamicChangeSetRule:'Execute only this Create ACK ARN after exact full template and single non-replacing trust property verification',
    independentNewProcessInspectRequired:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertEcsAbsencePublicationApprovalV5(m,approved,context,now){
  must(/^[a-f0-9]{64}$/.test(approved)&&m.manifestSha256===approved&&now>=m.preparedAt&&now<m.expiresAt&&
    same(m,await prepareEcsAbsencePublicationV5({...context,now:m.preparedAt})),'ECS_ABSENCE_FRESH_EXACT_APPROVAL');
}
export function verifyEcsAbsencePublicationChangeSetV5(d,m,id,template){
  must(/^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/ecs-absence-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(id)&&
    id.split('/')[1]===m.actions.foundation.create.ChangeSetName&&d.ChangeSetId===id&&
    same(template,JSON.parse(m.actions.foundation.create.TemplateBody)),'ECS_ABSENCE_EXACT_CHANGE_SET');
  return verifyActivationChangeSetV5(d,V.stackId,V.roleName);
}
export async function publishEcsAbsenceV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=()=>assertEcsAbsencePublicationApprovalV5(m,approved,context,now());
  await approve();const start=now(),prestate=await io.preflight(m.source.commit);
  must(same(prestate,m.prestate)&&now()-start<180000,'ECS_ABSENCE_FRESH_PRESTATE');await approve();
  await io.consumeSlot({manifestSha256:m.manifestSha256,at:now(),retryAllowed:false,oldSlotsPreserved:true});
  let phase='SlotConsumed';
  const guard=async()=>{await approve();must(now()-start<1200000,'ECS_ABSENCE_EXECUTION_WINDOW');await io.assertLocalSource(m);};
  try{
    phase='PublishPreparedWorkflows';await io.record('publish.intent',{manifestSha256:m.manifestSha256,at:now()});
    await guard();const push=await io.publishRelease(m.release,guard);await io.record('publish.ack',push);
    phase='VerifyOldLayoutBeforeCreate';await io.verifyLayout(m,'old',m.release.caller.commit,'before-create');
    phase='CreateTrustOnlyChangeSet';await guard();await io.record('create.intent',{manifestSha256:m.manifestSha256,at:now()});
    const ref=await io.createChangeSet(m.actions.foundation.create,guard);await io.record('create.ack',ref);
    phase='VerifyExactChangeSet';await io.record('changeset-verified',await io.waitChangeSet(ref,m,guard));
    phase='VerifyOldLayoutBeforeExecute';await io.verifyLayout(m,'old',m.release.caller.commit,'before-execute');
    phase='ExecuteTrustOnlyChangeSet';await guard();await io.record('execute.intent',{manifestSha256:m.manifestSha256,changeSetId:ref.changeSetId,at:now()});
    await io.record('execute.ack',await io.executeChangeSet(ref,m,guard));
    phase='WaitFoundation';await io.waitFoundation(guard);
    phase='FinalSameProcessReadback';const proof=await io.verifyLayout(m,'new',m.release.caller.commit,'final-layout');
    phase='LocalMainFastForward';await guard();await io.syncLocalMain(m.release);
    const result={outcome:'ECS_ABSENCE_VERSION_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',manifestSha256:m.manifestSha256,
      runtimeCommit:m.release.runtimeCommit,reusableCommit:m.release.reusable.commit,callerCommit:m.release.caller.commit,
      changeSetId:ref.changeSetId,proof,counts:io.counts(),independentInspectRequired:true,workflowDispatched:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch(error){
    const result={outcome:'ECS_ABSENCE_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',manifestSha256:m.manifestSha256,phase,
      failure:safeActivationFailureV5(error),counts:io.counts(),independentInspectRequired:true,workflowDispatched:false,retryAllowed:false};
    await io.record('stopped',result);return result;
  }
}
