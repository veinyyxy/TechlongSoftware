// Local-only continuation of W5k. The published cloud runtime/workflows are NOT modified here.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {JOB_DISPATCH_V5 as OLD,jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5,
  assertInstalledJobWorkflowV5,jobProofFromLogsV5} from './job-dispatch-v5.mjs';
import {assertEvidenceSafeV5} from './cloud-evidence-v5.mjs';
import {CLOUD_EFFECTS_V5} from './cloud-worker-root-v5.mjs';
import {requireActivationV5} from './activation/errors-v5.mjs';
export {jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5,jobProofFromLogsV5};
const must=(v,c)=>requireActivationV5(v,'DNS_JOB_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const DNS_JOB_DISPATCH_V5=Object.freeze({...OLD,
  runtime:'e55367c370ca5aa883d8a7e1342514fc3f34c442',reusable:'46312fff06d60e9e4ca96be6bb8d82ce1ce3d109',
  publishedCaller:'d25c97fb0ca88fbb4ea3c1ea72ad4517b6ab7a0a',
  publicationRecordCommit:'f6d56a84fa14274f5de1c2ed7aa6b608c9397784',
  closureSha256:'e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5l-review-continuation.md',
});
const V=DNS_JOB_DISPATCH_V5;
export function dnsJobDispatchSlotV5(mode){
  must(['Review','RunOnce','Inspect'].includes(mode),'SLOT_MODE');
  return 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-'+V.jobId+'-'+mode.toLowerCase()+'-v'+(mode==='Review'?'3':'2')+'.permanent-slot.json';
}
export function assertInstalledDnsJobWorkflowV5(workflow,body=jobDispatchBodyV5('Review')){
  must(workflow?.jobs?.reviewed?.uses==='veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@'+V.reusable,'PUBLISHED_REUSABLE');
  // Reuse the unchanged seven-input contract, ONLY after checking the new exact reusable.
  const prior=structuredClone(workflow);prior.jobs.reviewed.uses='veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@'+OLD.reusable;
  assertInstalledJobWorkflowV5(prior,body);
}
export async function prepareDnsJobDispatchV5({mode,source,history,prestate,cloud=null,execution=null,now}){
  must(['Review','RunOnce','Inspect'].includes(mode) && Number.isSafeInteger(now) && now>0 && /^[a-f0-9]{40}$/.test(source.commit) &&
    source.files.length>=140 && source.runtimeClosureSha256===V.closureSha256 && history.publicationEvidenceVerified===true &&
    history.publicationSourcePinsVerified===134 && history.oldReviewSlotsPreserved===true &&
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
  const body={schema:'techlong/cloud-worker-dns-job-dispatch-review/v5',mode,jobId:V.jobId,preparedAt:now,expiresAt,
    source,history,prestate,cloud,execution,executionObject:object,request,riskFile:V.riskFile,
    runtimeCommit:V.runtime,reusableCommit:V.reusable,effects,localPermanentSlot:dnsJobDispatchSlotV5(mode),workflowDispatches:1,
    humanEnvironmentApprovalRequired:true,automaticReruns:0,controllerAutomaticRollback:false,
    approvalWindowOnlyControlsDispatchNotLaterHumanReview:true,
    executionVersionRule:object?'Only the VersionId returned by this exact conditional Put ACK, independently read and hash verified':'No execution object write'};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertDnsJobDispatchApprovalV5(m,approved,context,now){
  must(approved===m.manifestSha256 && /^[a-f0-9]{64}$/.test(approved) && now>=m.preparedAt && now<m.expiresAt &&
    same(m,await prepareDnsJobDispatchV5({...context,now:m.preparedAt})),'FRESH_EXACT_APPROVAL');
}
export async function dispatchDnsJobV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=p=>assertDnsJobDispatchApprovalV5(m,approved,{...context,prestate:p},now());
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
