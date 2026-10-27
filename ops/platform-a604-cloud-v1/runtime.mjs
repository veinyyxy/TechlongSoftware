// Same recovery wire format, exact new job, explicit code-selected publication.
// Frozen9b runtime is unchanged. Default production composition is closed.
import {validateCloudRunV6,externalInputsV6,assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {recoveryBasisCompiler,recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {rebuildRecoveryPackage,recoveryEnvelopeKey,recoveryCloudResult} from '../platform-recovery-v1/package.mjs';
import {recoveryEnvelope} from '../platform-recovery-v1/worker.mjs';
import {A604_JOB,A604_PROFILE,A604_PUBLICATION} from './profile.mjs';
import {assertA604Publication,must,same} from './contract.mjs';
export function createA604Runtime({publication=A604_PUBLICATION,profile=A604_PROFILE,now=Date.now}={}){
  // Factory overrides are source/test capabilities, never external inputs.
  const p=freeze(structuredClone(publication)),target=freeze(structuredClone(profile)),compile=recoveryBasisCompiler(target);
  let used=false;
  const guard=()=>assertA604Publication(p,target,now());
  const rebuild=async value=>{await guard();const basis=await rebuildRecoveryPackage(value,compile);
    must(basis.basisSha256===p.basisSha256&&same(recoveryData(basis,now()).target,target),'PACKAGE_SCOPE');return basis;};
  async function input(env,closure){
    await guard();must(closure.schema==='techlong/a604-cloud-closure/v1'&&closure.previousRecoveryClosureSha256===
      '30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374','CLOSURE_BASE');
    const cloudRelease={...p.release,sourceCommit:p.frozenSourceCommit};
    const execution=validateCloudRunV6(env,cloudRelease,closure);
    must(execution.commitSha===p.sourceCommit&&env.TECHLONG_RECOVERY_PROTOCOL===p.protocol,'SOURCE_PROTOCOL');
    const input=externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage']
      .map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
    must(input.job===A604_JOB&&input.lineage!==''&&same(JSON.parse(input.lineage),p.packageReference),'EXACT_JOB_AND_PACKAGE');
    return {execution,input};
  }
  async function run({env,closure,ports}){
    const {execution,input:request}=await input(env,closure);
    return runValidated(execution,request,closure,ports);
  }
  async function runValidated(execution,input,closure,ports){
    must(!used,'MEMORY_ONCE');used=true;let reads=0,puts=0;
    const read=async ref=>{await guard();must(++reads<=4,'READ_BUDGET');return ports.read(ref);};
    const put=async(key,value)=>{await guard();must(++puts<=2,'PUT_BUDGET');return ports.put(key,value);};
    const basis=await rebuild(await read(p.packageReference)),installation=await read(JSON.parse(input.installation));
    let review=null,prior=null;
    if(input.mode!=='Review'){
      review=await read(JSON.parse(input.manifest));
      must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&review.recoveryReviewSha256===input.manifestSha&&
        review.innerManifest.code.commitSha===execution.commitSha&&review.innerManifest.code.closureSha256===closure.closureSha256&&
        now()>=review.createdAt&&now()<review.expiresAt,'ENVELOPE');
      if(input.mode==='Inspect'){
        prior=await read(JSON.parse(input.execution));const r=prior?.executionRun;
        must(same(Object.keys(prior).sort(),['executionReportReference','executionRun','recoveryBasisSha256','recoveryReviewSha256'])&&
          r?.repository===S.repository&&r.commitSha===execution.commitSha&&r.runAttempt===1&&r.runId!==execution.runId&&
          /^[1-9][0-9]{0,15}$/.test(r.runId)&&prior.recoveryBasisSha256===basis.basisSha256&&
          prior.recoveryReviewSha256===review.recoveryReviewSha256,'INDEPENDENT_EXECUTION');
        assertReferenceV6(JSON.parse(input.execution),`worker-v5/${S.instanceId}/${A604_JOB}/${input.manifestSha}/execution-reference-${r.runId}-v1.json`);
        assertReferenceV6(prior.executionReportReference,`worker-v5/${S.instanceId}/${A604_JOB}/${review.innerManifest.manifestSha256}/run-${r.runId}-1/run.json`);
      }
    }
    await guard();const app=await ports.open({basis,installation,run:execution,code:{commitSha:execution.commitSha,closureSha256:closure.closureSha256},
      mode:input.mode,approvedRecoveryReviewSha256:input.mode==='Review'?null:input.manifestSha});
    try{
      let report={},ref;
      if(input.mode==='Review'){
        const r=await app.review({jobId:A604_JOB,signal:ports.signal});review=r.review;
        must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&
          review.innerManifest.code.commitSha===execution.commitSha&&review.innerManifest.code.closureSha256===closure.closureSha256,'REVIEW_OUTPUT');
        ref=await put(recoveryEnvelopeKey(A604_JOB,review.recoveryReviewSha256),review);
      }else{
        const args={review,approvedRecoveryReviewSha256:input.manifestSha,signal:ports.signal};
        const r=input.mode==='RunOnce'?await app.runOnce(args):await app.inspect({...args,
          executionRun:prior.executionRun,executionReportReference:prior.executionReportReference});
        report=r.report;ref=r.saved;assertReferenceV6(ref,`worker-v5/${S.instanceId}/${A604_JOB}/${review.innerManifest.manifestSha256}/run-${execution.runId}-1/${input.mode==='RunOnce'?'run':'inspect'}.json`);
      }
      const outer=review.recoveryReviewSha256,executionReference=input.mode==='RunOnce'?await put(
        `worker-v5/${S.instanceId}/${A604_JOB}/${outer}/execution-reference-${execution.runId}-v1.json`,
        {executionRun:execution,executionReportReference:ref,recoveryReviewSha256:outer,recoveryBasisSha256:basis.basisSha256}):null;
      const value=await recoveryCloudResult({plan:{mode:input.mode,jobId:A604_JOB,inputs:input},run:execution,
        release:p.release,frozenSourceCommit:p.frozenSourceCommit,envelope:{review,report},cloudReportReference:ref,executionReference});
      const saved=await put(resultKeyV6(A604_JOB,outer,execution.runId),value);
      return {mode:input.mode,jobId:A604_JOB,manifestSha256:outer,innerManifestSha256:review.innerManifest.manifestSha256,
        outcome:value.outcome,saved,retryAllowed:false};
    }finally{await app.dispose();}
  }
  return Object.freeze({guard,input,rebuild,run,runtimeEnabled:false,productionEntryInstalled:false});
}
export const A604_RUNTIME=createA604Runtime();
