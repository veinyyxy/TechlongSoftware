// Local continuation only; the cloud C/R and all job/effect contracts stay fixed.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ECS_JOB_DISPATCH_V5 as OLD,prepareEcsJobDispatchV5,jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5} from './ecs-job-dispatch-v5.mjs';
import {assertEvidenceSafeV5} from './cloud-evidence-v5.mjs';
import {requireActivationV5} from './activation/errors-v5.mjs';
export {jobDispatchBodyV5,executionObjectV5,assertJobReferenceV5};
const must=(v,c)=>requireActivationV5(v,'CORRECTED_JOB_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const CORRECTED_JOB_DISPATCH_V5=Object.freeze({...OLD,
  correctionRecordCommit:'591326c8a0b1cb2b8d5dd32626de70008637f21d',
  correctionRecordFile:'ops/aws-sandbox/reviews/cloud-worker-w5p-task-definition-read.executed.json',
  correctionRecordNormalizedLfSha256:'aaaa6c3aa7c3a420645f6e6e7eb5ba6e8bb6c5f41173bed480aff8363103ef13',
  correctionManifestSha256:'b212b017b3580fdc9429a4e59c5548892c95780f3c51ff60fe95927e14f63236',
  templateSha256:'1658cd87bd15fd469cd24f1dab7105f29ca2d02e2963fed882b0941bdf36dd3b',
  inlinePolicySha256:'ef09a5c638b600914cf0a29873a705432a5f96ffb9cdc20c6fa16aeaaa157bfd',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5q-corrected-review.md',
});
const V=CORRECTED_JOB_DISPATCH_V5;
export function correctedJobDispatchSlotV5(mode){
  must(['Review','RunOnce','Inspect'].includes(mode),'SLOT_MODE');
  return 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-'+V.jobId+'-'+mode.toLowerCase()+'-v'+(mode==='Review'?'5':'4')+'.permanent-slot.json';
}
export function assertCorrectedJobLayoutV5(actual,anchor,main){
  must(anchor?.state==='new'&&anchor.templateSha256===V.templateSha256&&anchor.inlinePolicySha256===V.inlinePolicySha256&&
    anchor.boundaryDefaultVersion==='v1'&&anchor.roleId==='AROAV3GNMXTZK5O45RG24'&&/^[a-f0-9]{40}$/.test(main)&&
    same(actual,{...anchor,main}),'EXACT_CORRECTED_LAYOUT');return actual;
}
export async function prepareCorrectedJobDispatchV5(context){
  const {source,history,prestate}=context;
  must(source.files.length>=172&&history.permissionCorrectionEvidenceVerified===true&&history.permissionCorrectionOriginalsVerified===31&&
    history.permissionCorrectionSourcePinsVerified===164&&history.permissionCorrectionRecordCommit===V.correctionRecordCommit&&
    history.permissionCorrectionManifestSha256===V.correctionManifestSha256&&history.failedReviewV4Preserved===true,'CORRECTION_HISTORY');
  assertCorrectedJobLayoutV5(prestate.correctedLayout,history.correctedLayoutAnchor,source.commit);
  // Retain the entire original job, cloud-window, effects and workflow-input plan.
  const prior=await prepareEcsJobDispatchV5(context),{manifestSha256:discarded,...body}=prior;
  void discarded;
  const result={...body,schema:'techlong/cloud-worker-corrected-job-dispatch-review/v5',riskFile:V.riskFile,
    localPermanentSlot:correctedJobDispatchSlotV5(context.mode),persistentRegionalReadPreviouslyInstalled:true};
  assertEvidenceSafeV5(result);return {...result,manifestSha256:await sha256Hex(result)};
}
export async function assertCorrectedJobApprovalV5(m,approved,context,now){
  must(/^[a-f0-9]{64}$/.test(approved)&&approved===m.manifestSha256&&now>=m.preparedAt&&now<m.expiresAt&&
    same(m,await prepareCorrectedJobDispatchV5({...context,now:m.preparedAt})),'FRESH_EXACT_APPROVAL');
}
export async function dispatchCorrectedJobV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=p=>assertCorrectedJobApprovalV5(m,approved,{...context,prestate:p},now());
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
  must(Number.isSafeInteger(ack.workflow_run_id)&&ack.workflow_run_id>0&&
    ack.html_url==='https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id&&
    ack.run_url==='https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id,'EXACT_RUN_ACK');
  const result={outcome:'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL',mode:m.mode,manifestSha256:m.manifestSha256,
    jobId:V.jobId,runId:String(ack.workflow_run_id),url:ack.html_url,environmentApprovedByController:false,retryAllowed:false};
  await io.record('dispatch-result',result);return result;
}
