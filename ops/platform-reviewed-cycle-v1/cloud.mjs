// Recovery wire adapter only. The actual claim/CreateStack/completion/Inspect
// executor remains the frozen createRecoveryApplication/worker implementation.
import {validateCloudRunV6,externalInputsV6,assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {recoveryBasisCompiler,recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {rebuildRecoveryPackage,recoveryEnvelopeKey,recoveryCloudResult} from '../platform-recovery-v1/package.mjs';
import {recoveryEnvelope} from '../platform-recovery-v1/worker.mjs';
import {assertCycle,assertPublication,must,same} from './cycle.mjs';
export function createCycleRuntime({cycle,publication:raw,now=Date.now}){
  assertCycle(cycle);const p=freeze(structuredClone(raw)),job=cycle.profile.newJobId,compile=recoveryBasisCompiler(cycle.profile);let used=false;
  const guard=()=>assertPublication(cycle,p,now());
  const rebuild=async value=>{await guard();const basis=await rebuildRecoveryPackage(value,compile);
    must(basis.basisSha256===p.basisSha256&&same(recoveryData(basis,now()).target,cycle.profile),'PACKAGE_SCOPE');return basis;};
  async function input(env,closure){
    await guard();must(closure.schema==='techlong/reviewed-cycle-cloud-closure/v1'&&closure.previousA604ClosureSha256===
      'f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269'&&closure.closureSha256===p.release.closureSha256,'FROZEN_CLOSURE');
    const execution=validateCloudRunV6(env,{...p.release,sourceCommit:p.frozenSourceCommit},closure);
    must(execution.commitSha===p.sourceCommit&&env.TECHLONG_RECOVERY_PROTOCOL===p.protocol,'SOURCE_PROTOCOL');
    const request=externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage']
      .map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
    must(request.job===job&&same(JSON.parse(request.lineage),p.packageReference),'EXACT_JOB_AND_PACKAGE');return {execution,request};
  }
  async function run({env,closure,ports}){
    const {execution,request:r}=await input(env,closure);must(!used,'MEMORY_ONCE');used=true;let reads=0,puts=0;
    const read=async ref=>{await guard();must(++reads<=4,'CLOUD_READ_BUDGET');return ports.read(ref);};
    const put=async(key,value)=>{await guard();must(++puts<=2,'CLOUD_PUT_BUDGET');return ports.put(key,value);};
    const basis=await rebuild(await read(p.packageReference)),installation=await read(JSON.parse(r.installation));let review=null,prior=null;
    if(r.mode!=='Review'){
      review=await read(JSON.parse(r.manifest));
      must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&review.recoveryReviewSha256===r.manifestSha&&
        review.innerManifest.code.commitSha===execution.commitSha&&review.innerManifest.code.closureSha256===closure.closureSha256&&
        now()>=review.createdAt&&now()<review.expiresAt,'ENVELOPE');
      if(r.mode==='Inspect'){
        prior=await read(JSON.parse(r.execution));const previous=prior?.executionRun;
        must(same(Object.keys(prior).sort(),['executionReportReference','executionRun','recoveryBasisSha256','recoveryReviewSha256'])&&
          previous?.repository===S.repository&&previous.commitSha===execution.commitSha&&previous.runAttempt===1&&previous.runId!==execution.runId&&
          /^[1-9][0-9]{0,15}$/.test(previous.runId)&&prior.recoveryBasisSha256===basis.basisSha256&&prior.recoveryReviewSha256===review.recoveryReviewSha256,'INDEPENDENT_EXECUTION');
        assertReferenceV6(JSON.parse(r.execution),`worker-v5/${S.instanceId}/${job}/${r.manifestSha}/execution-reference-${previous.runId}-v1.json`);
        assertReferenceV6(prior.executionReportReference,`worker-v5/${S.instanceId}/${job}/${review.innerManifest.manifestSha256}/run-${previous.runId}-1/run.json`);
      }
    }
    await guard();const app=await ports.open({basis,installation,run:execution,code:{commitSha:execution.commitSha,closureSha256:closure.closureSha256},
      mode:r.mode,approvedRecoveryReviewSha256:r.mode==='Review'?null:r.manifestSha});
    try{
      let report={},ref;
      if(r.mode==='Review'){
        const v=await app.review({jobId:job,signal:ports.signal});review=v.review;
        must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&review.innerManifest.code.commitSha===execution.commitSha&&
          review.innerManifest.code.closureSha256===closure.closureSha256,'REVIEW_OUTPUT');ref=await put(recoveryEnvelopeKey(job,review.recoveryReviewSha256),review);
      }else{
        const args={review,approvedRecoveryReviewSha256:r.manifestSha,signal:ports.signal};
        const v=r.mode==='RunOnce'?await app.runOnce(args):await app.inspect({...args,executionRun:prior.executionRun,executionReportReference:prior.executionReportReference});
        report=v.report;ref=v.saved;assertReferenceV6(ref,`worker-v5/${S.instanceId}/${job}/${review.innerManifest.manifestSha256}/run-${execution.runId}-1/${r.mode==='RunOnce'?'run':'inspect'}.json`);
      }
      const outer=review.recoveryReviewSha256,executionReference=r.mode==='RunOnce'?await put(`worker-v5/${S.instanceId}/${job}/${outer}/execution-reference-${execution.runId}-v1.json`,
        {executionRun:execution,executionReportReference:ref,recoveryReviewSha256:outer,recoveryBasisSha256:basis.basisSha256}):null;
      const value=await recoveryCloudResult({plan:{mode:r.mode,jobId:job,inputs:r},run:execution,release:p.release,frozenSourceCommit:p.frozenSourceCommit,
        envelope:{review,report},cloudReportReference:ref,executionReference});
      return {mode:r.mode,jobId:job,manifestSha256:outer,innerManifestSha256:review.innerManifest.manifestSha256,outcome:value.outcome,
        saved:await put(resultKeyV6(job,outer,execution.runId),value),retryAllowed:false};
    }finally{await app.dispose();}
  }
  return Object.freeze({guard,rebuild,input,run,runtimeEnabled:false});
}
