// Local controller only. The installed runtime and both pinned workflows stay unchanged.
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { validateWorkflowInputV5 } from './workflow-input-v5.mjs';
import { assertEvidenceSafeV5, evidenceKeyV5 } from './cloud-evidence-v5.mjs';
import { CLOUD_EFFECTS_V5 } from './cloud-worker-root-v5.mjs';
import { requireActivationV5 } from './activation/errors-v5.mjs';
const must = (v, code) => requireActivationV5(v,'JOB_DISPATCH_'+code);
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
export const JOB_DISPATCH_V5 = Object.freeze({
  jobId:'job_ecbf09030d3da7286ea3ef93', requestId:'682ec635d9d066cd547b1e060cefa9052d49ac425328047f8fb85e8289a4a07e',
  requesterId:'usr_4dcd0a09821fde2bb1801f58', workflowId:388188162, environmentId:24613410405,
  runtime:'ac75c4bcbb856babc67d88b6e06212e981a25d90', reusable:'7c02d9db3a39fc2f926848a593eb804b642bd1e5',
  closureSha256:'110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84',
  jobRowSha256:'30f48db98e3c04f11f8fcffc8452e407f42c07c8dc9cebdf63811d43f8f0a647',
  snapshotSha256:'6da48ad69f4f4f9482feadb78db4366f9abcf6fdcabb4b6efd1777e78a83f948',
  installationSha256:'0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1',
  publication:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json',
    versionId:'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV',sha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae'},
  apiVersion:'2026-03-10', riskFile:'docs/aws-auto-deployment-cloud-worker-w5i-job-dispatch.md',
});
const V=JOB_DISPATCH_V5;
export function assertJobReferenceV5(r,key) {
  must(r && Object.keys(r).sort().join(',')==='key,sha256,versionId' && r.key===key && /^[a-f0-9]{64}$/.test(r.sha256) &&
    typeof r.versionId==='string' && /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId),'EXACT_OBJECT_REFERENCE'); return r;
}
export function jobDispatchBodyV5(mode,cloud=null,execution=null) {
  must(['Review','RunOnce','Inspect'].includes(mode),'MODE');
  const inputs={mode,job:V.jobId,installation:canonicalJson(V.publication),installationSha:V.installationSha256,
    manifest:'',manifestSha:'',execution:'',lineage:''};
  if(mode==='Review') must(cloud===null && execution===null,'REVIEW_HAS_NO_EXECUTION');
  else {
    must(cloud?.jobId===V.jobId && /^[a-f0-9]{64}$/.test(cloud.manifestSha256),'EXACT_CLOUD_JOB');
    assertJobReferenceV5(cloud.reference,evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256}));
    inputs.manifest=canonicalJson(cloud.reference); inputs.manifestSha=cloud.manifestSha256;
    if(mode==='Inspect') { must(execution,'EXECUTION_REQUIRED'); inputs.execution=canonicalJson(execution); }
    else must(execution===null,'RUN_HAS_NO_EXECUTION_REFERENCE');
  }
  validateWorkflowInputV5(inputs); return {ref:'main',return_run_details:true,inputs};
}
export function executionObjectV5(cloud,run) {
  must(run?.jobId===V.jobId && run.manifestSha256===cloud?.manifestSha256 &&
    run.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED' && /^[1-9][0-9]{0,19}$/.test(run.executionRun?.runId) &&
    run.executionRun.runAttempt===1 && run.executionRun.repository==='veinyyxy/TechlongSoftware' &&
    run.executionRun.commitSha===cloud.code.commitSha,'SUCCESSFUL_EXECUTION_REQUIRED');
  assertJobReferenceV5(run.reference,evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:run.executionRun}));
  return {key:cloud.reference.key.replace(/manifest\.json$/,'execution-reference-'+run.executionRun.runId+'-v1.json'),
    body:{executionRun:run.executionRun,executionReportReference:run.reference}};
}
export async function prepareJobDispatchV5({mode,source,history,prestate,cloud=null,execution=null,now}) {
  must(Number.isSafeInteger(now) && now>0 && /^[a-f0-9]{40}$/.test(source.commit) && source.files.length>=121 &&
    prestate.main===source.commit && prestate.workflowId===V.workflowId && prestate.environmentId===V.environmentId &&
    prestate.metadataVerified===true && prestate.unfinishedRuns===0 && prestate.jobId===V.jobId,'PRESTATE');
  let object=null;
  if(mode!=='Review') must(cloud?.code.commitSha===source.commit && cloud.code.closureSha256===V.closureSha256,'FROZEN_CALLER_MAIN');
  if(mode==='Inspect') object=executionObjectV5(cloud,execution);
  else must(execution===null,'NO_EXTRA_EXECUTION');
  if(mode!=='Inspect') must(prestate.jobRowSha256===V.jobRowSha256 && prestate.snapshotSha256===V.snapshotSha256 && prestate.activeJobs===1,'HELD_JOB_DRIFT');
  const reference=object ? {key:object.key,versionId:'ACK_BOUND_VERSION',sha256:await sha256Hex(object.body)} : null;
  const request={method:'POST',path:'repos/veinyyxy/TechlongSoftware/actions/workflows/'+V.workflowId+'/dispatches',
    apiVersion:V.apiVersion,body:jobDispatchBodyV5(mode,cloud,reference)};
  const effects=mode==='Review' ? {fixedDatabaseSecretValueReads:1,readOnlyDatabase:true,privateManifestConditionalPuts:1,
    snapshotAndQueueStoredPrivately:true,jobClaims:0,controlSecretReads:0,createStackCalls:0,applicationGets:0,dynamoDbWrites:0} :
    mode==='RunOnce' ? CLOUD_EFFECTS_V5 : {fixedDatabaseSecretValueReads:1,readOnlyDatabase:true,privateControlReads:0,
      sourceExecutionReferenceConditionalPuts:1,workerInspectReportConditionalPuts:1,jobClaims:0,createStackCalls:0,applicationGets:0,dynamoDbWrites:0};
  const expiresAt=mode==='RunOnce'?Math.min(now+7200000,cloud.claimBy):now+7200000;
  must(Number.isSafeInteger(expiresAt) && expiresAt>now,'CLOUD_WINDOW_EXPIRED');
  const body={schema:'techlong/cloud-worker-job-dispatch-review/v5',mode,jobId:V.jobId,preparedAt:now,expiresAt,
    source,history,prestate,cloud,execution,executionObject:object,request,riskFile:V.riskFile,
    runtimeCommit:V.runtime,reusableCommit:V.reusable,effects,
    workflowDispatches:1,humanEnvironmentApprovalRequired:true,automaticReruns:0,controllerAutomaticRollback:false,
    approvalWindowOnlyControlsDispatchNotLaterHumanReview:true,
    executionVersionRule:object?'Only the VersionId returned by this exact conditional Put ACK, independently read and hash verified':'No execution object write'};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertJobDispatchApprovalV5(m,approved,context,now) {
  must(approved===m.manifestSha256 && /^[a-f0-9]{64}$/.test(approved) && now>=m.preparedAt && now<m.expiresAt,'FRESH_APPROVAL');
  must(same(m,await prepareJobDispatchV5({...context,now:m.preparedAt})),'APPROVAL_BINDING');
}
export async function dispatchJobV5({manifest:m,approved,context,io,now=Date.now}) {
  await assertJobDispatchApprovalV5(m,approved,{...context,prestate:m.prestate},now());
  const started=now(),prestate=await io.preflight(m.mode);
  await assertJobDispatchApprovalV5(m,approved,{...context,prestate},now());
  must(now()-started<180000,'PREFLIGHT_WINDOW');
  await io.consumeSlot(m.mode,{manifestSha256:m.manifestSha256,at:now(),retryAllowed:false});
  await io.record('dispatch-intent',{mode:m.mode,manifestSha256:m.manifestSha256,main:m.source.commit,at:now()});
  const guard=async()=>{await assertJobDispatchApprovalV5(m,approved,{...context,prestate},now());must(now()-started<240000,'SUBMISSION_WINDOW');await io.assertCloudWindow(m.mode);};
  let request=m.request;
  if(m.executionObject) {
    await guard(); const ref=await io.putExecutionReference(m.executionObject); await io.record('execution-reference-ack',ref);
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
export function jobProofFromLogsV5(log,mode) {
  must(typeof log==='string' && Buffer.byteLength(log)<3000000,'LOG_SIZE');const found=[];
  const lines=log.split(/\r?\n/).map(l=>l.replace(/^\d{4}-\d{2}-\d{2}T\S+\s/,''));
  for(let a=0;a<lines.length;a++)if(lines[a].trim()==='{')for(let b=a+1;b<Math.min(a+100,lines.length);b++)if(lines[b].trim()==='}'){
    try{const p=JSON.parse(lines.slice(a,b+1).join('\n'));if(p.mode===mode)found.push(p);}catch{/* Not a complete JSON block. */}
  }
  must(found.length===1,'UNIQUE_MODE_PROOF');const p=found[0];assertEvidenceSafeV5(p);
  must(Object.keys(p).sort().join(',')===(mode==='Review'?'executionApproved,manifestSha256,mode,saved':'mode,outcome,retryAllowed,saved'),'PROOF_SHAPE');
  must(mode==='Review'?p.executionApproved===false && /^[a-f0-9]{64}$/.test(p.manifestSha256):p.retryAllowed===false,'PROOF_APPROVAL');return p;
}
