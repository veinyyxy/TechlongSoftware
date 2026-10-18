// Local-only continuation of the independently verified W5n publication.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {JOB_DISPATCH_V5 as OLD,jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5,
  assertInstalledJobWorkflowV5,jobProofFromLogsV5} from './job-dispatch-v5.mjs';
import {assertEvidenceSafeV5} from './cloud-evidence-v5.mjs';
import {CLOUD_EFFECTS_V5} from './cloud-worker-root-v5.mjs';
import {requireActivationV5} from './activation/errors-v5.mjs';
export {jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5,jobProofFromLogsV5};
const must=(v,c)=>requireActivationV5(v,'ECS_JOB_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const ECS_JOB_DISPATCH_V5=Object.freeze({...OLD,
  runtime:'d8cb99693231770de6a5d73e02dda42b87035714',reusable:'7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c',
  publishedCaller:'68a476b5edc514456b6aca3a9cbb0aa26232be24',
  publicationRecordCommit:'840ac3df900b04b62b7e01097bc9473962ad1e8f',
  closureSha256:'70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5o-review-continuation.md',
});
const V=ECS_JOB_DISPATCH_V5;
export function ecsJobDispatchSlotV5(mode){
  must(['Review','RunOnce','Inspect'].includes(mode),'SLOT_MODE');
  return 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-'+V.jobId+'-'+mode.toLowerCase()+'-v'+(mode==='Review'?'4':'3')+'.permanent-slot.json';
}
export function assertInstalledEcsJobWorkflowV5(workflow,body=jobDispatchBodyV5('Review')){
  must(workflow?.jobs?.reviewed?.uses==='veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@'+V.reusable,'PUBLISHED_REUSABLE');
  const prior=structuredClone(workflow);prior.jobs.reviewed.uses='veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@'+OLD.reusable;
  assertInstalledJobWorkflowV5(prior,body);
}
export async function prepareEcsJobDispatchV5({mode,source,history,prestate,cloud=null,execution=null,now}){
  must(['Review','RunOnce','Inspect'].includes(mode) && Number.isSafeInteger(now) && now>0 && /^[a-f0-9]{40}$/.test(source.commit) &&
    source.files.length>=159 && source.runtimeClosureSha256===V.closureSha256 && history.publicationEvidenceVerified===true &&
    history.publicationSourcePinsVerified===152 && history.publicationEvidenceFilesVerified===27 &&
    history.failedReviewV3Verified===true && history.ecsFixEvidenceVerified===true && history.oldReviewSlotsPreserved===true &&
    prestate.main===source.commit && prestate.workflowId===V.workflowId && prestate.environmentId===V.environmentId &&
    prestate.runtimeCommit===V.runtime && prestate.reusableCommit===V.reusable && prestate.sourceCiConfirmed===true &&
    /^[a-f0-9]{64}$/.test(prestate.metadataSha256) && prestate.metadataVerified===true && prestate.unfinishedRuns===0 && prestate.jobId===V.jobId,'PRESTATE');
  let object=null;
  if(mode!=='Review')must(cloud?.code.commitSha===source.commit && cloud.code.closureSha256===V.closureSha256,'FROZEN_CALLER_MAIN');
  if(mode==='Inspect')object=executionObjectV5(cloud,execution);else must(execution===null,'NO_EXTRA_EXECUTION');
  if(mode!=='Inspect')must(prestate.jobRowSha256===V.jobRowSha256 && prestate.snapshotSha256===V.snapshotSha256 && prestate.activeJobs===1,'HELD_JOB_DRIFT');
  const ref=object?{key:object.key,versionId:'ACK_BOUND_VERSION',sha256:await sha256Hex(object.body)}:null;
  const request={method:'POST',path:'repos/veinyyxy/TechlongSoftware/actions/workflows/'+V.workflowId+'/dispatches',
    apiVersion:V.apiVersion,body:jobDispatchBodyV5(mode,cloud,ref)};
  const effects=mode==='Review'?{fixedDatabaseSecretValueReads:1,readOnlyDatabase:true,privateManifestConditionalPuts:1,
    snapshotAndQueueStoredPrivately:true,jobClaims:0,controlSecretReads:0,createStackCalls:0,applicationGets:0,dynamoDbWrites:0}:
    mode==='RunOnce'?CLOUD_EFFECTS_V5:{fixedDatabaseSecretValueReads:1,readOnlyDatabase:true,privateControlReads:0,
      sourceExecutionReferenceConditionalPuts:1,workerInspectReportConditionalPuts:1,jobClaims:0,createStackCalls:0,applicationGets:0,dynamoDbWrites:0};
  const expiresAt=mode==='RunOnce'?Math.min(now+7200000,cloud.claimBy):now+7200000;
  must(Number.isSafeInteger(expiresAt) && expiresAt>now,'CLOUD_WINDOW_EXPIRED');
  const body={schema:'techlong/cloud-worker-ecs-job-dispatch-review/v5',mode,jobId:V.jobId,preparedAt:now,expiresAt,
    source,history,prestate,cloud,execution,executionObject:object,request,riskFile:V.riskFile,
    runtimeCommit:V.runtime,reusableCommit:V.reusable,effects,localPermanentSlot:ecsJobDispatchSlotV5(mode),workflowDispatches:1,
    humanEnvironmentApprovalRequired:true,automaticReruns:0,controllerAutomaticRollback:false,
    approvalWindowOnlyControlsDispatchNotLaterHumanReview:true,
    executionVersionRule:object?'Only the VersionId returned by this exact conditional Put ACK, independently read and hash verified':'No execution object write'};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertEcsJobDispatchApprovalV5(m,approved,context,now){
  must(approved===m.manifestSha256 && /^[a-f0-9]{64}$/.test(approved) && now>=m.preparedAt && now<m.expiresAt &&
    same(m,await prepareEcsJobDispatchV5({...context,now:m.preparedAt})),'FRESH_EXACT_APPROVAL');
}
export async function dispatchEcsJobV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=p=>assertEcsJobDispatchApprovalV5(m,approved,{...context,prestate:p},now());
  await approve(m.prestate);const start=now(),prestate=await io.preflight(m.mode);await approve(prestate);
  must(now()-start<180000,'PREFLIGHT_WINDOW');
  await io.consumeSlot(m.mode,{manifestSha256:m.manifestSha256,at:now(),retryAllowed:false});
  await io.record('dispatch-intent',{mode:m.mode,manifestSha256:m.manifestSha256,main:m.source.commit,at:now()});
  const guard=async()=>{await approve(prestate);must(now()-start<240000,'SUBMISSION_WINDOW');
    await io.assertLocalSource(m);await io.assertCloudWindow(m.mode);};
  let request=m.request;
  if(m.executionObject){
    await guard();const ref=await io.putExecutionReference(m.executionObject);await io.record('execution-reference-ack',ref);
    assertJobReferenceV5(ref,m.executionObject.key);must(ref.sha256===await sha256Hex(m.executionObject.body),'EXECUTION_ACK_DIGEST');
    request={...request,body:jobDispatchBodyV5(m.mode,m.cloud,ref)};
  }
  const ack=await io.dispatch(request,guard);await io.record('dispatch-api-ack',ack);
  must(Number.isSafeInteger(ack.workflow_run_id) && ack.workflow_run_id>0 &&
    ack.html_url==='https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id &&
    ack.run_url==='https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id,'EXACT_RUN_ACK');
  const result={outcome:'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL',mode:m.mode,manifestSha256:m.manifestSha256,
    jobId:V.jobId,runId:String(ack.workflow_run_id),url:ack.html_url,environmentApprovedByController:false,retryAllowed:false};
  await io.record('dispatch-result',result);return result;
}
