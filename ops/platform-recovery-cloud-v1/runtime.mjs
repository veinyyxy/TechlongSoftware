// One cloud mode per invocation. Injected ports exercise the production bridge.
import {validateCloudRunV6,externalInputsV6,assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {rebuildRecoveryPackage,recoveryPackageKey,recoveryEnvelopeKey,recoveryCloudResult} from '../platform-recovery-v1/package.mjs';
import {recoveryEnvelope} from '../platform-recovery-v1/worker.mjs';
import {RECOVERY_SCOPE} from '../platform-recovery-v1/profile.mjs';
import {must,same} from '../platform-recovery-v1/basis-core.mjs';

export function recoveryCloudInput(env,binding,closure){
  const run=validateCloudRunV6(env,binding,closure);
  must(env.TECHLONG_RECOVERY_PROTOCOL==='recovery-envelope/v1'&&
    closure.previousPlatformClosureSha256==='828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a','CLOUD_PROTOCOL_OR_BASE_CLOSURE');
  const input=externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage']
    .map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
  must(input.job===RECOVERY_SCOPE.newJobId&&input.lineage!=='','CLOUD_EXACT_JOB_AND_PACKAGE');
  return {run,input};
}
export async function runRecoveryCloud({env,binding,closure,ports,rebuild=rebuildRecoveryPackage,now=Date.now}){
  const {run,input}=recoveryCloudInput(env,binding,closure);
  const packageRef=JSON.parse(input.lineage),basis=await rebuild(await ports.read(packageRef));
  assertReferenceV6(packageRef,recoveryPackageKey(basis.basisSha256));
  const installation=await ports.read(JSON.parse(input.installation));
  let review=null,execution=null;
  if(input.mode!=='Review'){
    review=await ports.read(JSON.parse(input.manifest));
    must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&review.recoveryReviewSha256===input.manifestSha&&
      review.innerManifest.code.commitSha===run.commitSha&&review.innerManifest.code.closureSha256===closure.closureSha256&&
      now()>=review.createdAt&&now()<review.expiresAt,'CLOUD_RECOVERY_ENVELOPE');
    if(input.mode==='Inspect'){
      execution=await ports.read(JSON.parse(input.execution));const previous=execution?.executionRun;
      must(same(Object.keys(execution).sort(),['executionReportReference','executionRun','recoveryBasisSha256','recoveryReviewSha256'])&&
        previous?.repository===S.repository&&previous.commitSha===run.commitSha&&previous.runAttempt===1&&previous.runId!==run.runId&&
        /^[1-9][0-9]{0,15}$/.test(previous.runId)&&execution.recoveryBasisSha256===basis.basisSha256&&
        execution.recoveryReviewSha256===review.recoveryReviewSha256,'CLOUD_RECOVERY_EXECUTION');
      assertReferenceV6(JSON.parse(input.execution),`worker-v5/${S.instanceId}/${input.job}/${input.manifestSha}/execution-reference-${previous.runId}-v1.json`);
      assertReferenceV6(execution.executionReportReference,`worker-v5/${S.instanceId}/${input.job}/${review.innerManifest.manifestSha256}/run-${previous.runId}-1/run.json`);
    }
  }
  const app=await ports.open({basis,installation,run,code:{commitSha:run.commitSha,closureSha256:closure.closureSha256},
    mode:input.mode,approvedRecoveryReviewSha256:input.mode==='Review'?null:input.manifestSha});
  try{
    let report={},reportReference;
    if(input.mode==='Review'){
      const r=await app.review({jobId:input.job,signal:ports.signal});review=r.review;
      must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&review.innerManifest.code.commitSha===run.commitSha&&
        review.innerManifest.code.closureSha256===closure.closureSha256,'CLOUD_REVIEW_OUTPUT');
      reportReference=await ports.put(recoveryEnvelopeKey(input.job,review.recoveryReviewSha256),review);
    }else{
      const args={review,approvedRecoveryReviewSha256:input.manifestSha,signal:ports.signal};
      const r=input.mode==='RunOnce'?await app.runOnce(args):await app.inspect({...args,
        executionRun:execution.executionRun,executionReportReference:execution.executionReportReference});
      report=r.report;reportReference=r.saved;
      assertReferenceV6(reportReference,`worker-v5/${S.instanceId}/${input.job}/${review.innerManifest.manifestSha256}/run-${run.runId}-1/${input.mode==='RunOnce'?'run':'inspect'}.json`);
    }
    const outer=review.recoveryReviewSha256;
    const executionReference=input.mode==='RunOnce'?await ports.put(`worker-v5/${S.instanceId}/${input.job}/${outer}/execution-reference-${run.runId}-v1.json`,
      {executionRun:run,executionReportReference:reportReference,recoveryReviewSha256:outer,recoveryBasisSha256:basis.basisSha256}):null;
    const value=await recoveryCloudResult({plan:{mode:input.mode,jobId:input.job,inputs:input},run,
      release:{closureSha256:closure.closureSha256,installationSha256:binding.installationSha256},frozenSourceCommit:binding.sourceCommit,
      envelope:{review,report},cloudReportReference:reportReference,executionReference});
    const saved=await ports.put(resultKeyV6(input.job,outer,run.runId),value);
    return {mode:input.mode,jobId:input.job,manifestSha256:outer,innerManifestSha256:review.innerManifest.manifestSha256,
      outcome:value.outcome,saved,retryAllowed:false};
  }finally{await app.dispose();}
}
