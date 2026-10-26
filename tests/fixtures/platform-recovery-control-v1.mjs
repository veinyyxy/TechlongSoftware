import path from 'node:path';
import {tmpdir} from 'node:os';
import {recoveryFixture} from './platform-recovery-v1.mjs';
import {compileRecoveryRequest} from '../../ops/platform-recovery-v1/request.mjs';
import {createRecoveryWorker} from '../../ops/platform-recovery-v1/worker.mjs';
import {recoveryData} from '../../ops/platform-recovery-v1/basis.mjs';
import {createRecoveryPublisher,rebuildRecoveryPackage,makeRecoveryPackage,recoveryPackageKey,recoveryEnvelopeKey,recoveryCloudResult} from '../../ops/platform-recovery-v1/bridge.mjs';
import {loadNeonContractV5} from '../../ops/cloud-worker/neon-contract-v5.mjs';
import {resultKeyV6,S} from '../../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {RECOVERY_RISK,RECOVERY_RUNTIME_CLOSURE} from '../../ops/platform-recovery-control-v1/binding.mjs';
import {makeRecoveryFollowupReview} from '../../ops/platform-recovery-control-v1/followup.mjs';
export async function recoveryControlFixture(){
  const f=await recoveryFixture(),d=recoveryData(f.basis,f.at),release={...f.release,closureSha256:RECOVERY_RUNTIME_CLOSURE,riskSha256:'e'.repeat(64)};
  const objects=[...f.objects.entries()].map(([key,object])=>({reference:{key,versionId:object.versionId,sha256:null},object:structuredClone(object)}));
  for(const v of objects)v.reference.sha256=await sha256Hex(v.object.value);
  const pkg=await makeRecoveryPackage({basis:f.basis,inputs:f.input,objects}),pkgRef=await f.store(recoveryPackageKey(f.basis.basisSha256),pkg);
  const binding={schema:'techlong/recovery-control-binding/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,release,basisSha256:f.basis.basisSha256,packageReference:pkgRef,riskFile:RECOVERY_RISK,
    activation:{schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',sourceCommit:f.sourceCommit,
      frozenSourceCommit:f.frozenSourceCommit,releaseSha256:await sha256Hex(release)}};
  const p=await compileRecoveryRequest(f.basis,f.at),observed=structuredClone(f.observed);
  observed.job={...f.makeAfter(p).jobs.find(j=>j.id===p.jobId),payload:canonicalJson(p.payload)};observed.jobs=[...f.state.jobs,observed.job];
  observed.requester={id:ADMIN,status:'active',is_platform_admin:1};observed.checkedAt=f.at;
  const worker=createRecoveryWorker({basis:f.basis,authorize:async()=>{},observeRetirement:async()=>({retirement:f.retirement,observedAt:f.at}),now:()=>f.at,
    dependencies:{installation:f.installation,contract:await loadNeonContractV5(),code:{commitSha:f.sourceCommit,closureSha256:release.closureSha256},run:f.run('123456797'),
      openDatabase:async()=>({verify:async()=>{},read:async()=>structuredClone(observed)}),evidence:{verify:async()=>{},put:async()=>({synthetic:true})},
      provider:{readCell:async()=>({stackId:d.context.base.compute.stackId,outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,d.context.base.compute.outputs[k]])),
        parentTagExpiresAt:d.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
        inspectBefore:async()=>({namespacesAbsent:true,retiredPredecessor:d.context.predecessor.stackId,cloudWrites:0})}}});
  const envelope=(await worker.review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(20000)})).review;
  const manifestRef=await f.store(recoveryEnvelopeKey(f.profile.newJobId,envelope.recoveryReviewSha256),envelope),plans=new Map(),writes=[];
  const rebuild=v=>rebuildRecoveryPackage(v,f.compile),publisher=createRecoveryPublisher({basis:f.basis,release,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,activation:binding.activation,rebuildPackage:rebuild,now:()=>f.at,ports:{guard:async()=>{},readObject:f.ports.readObject,
      readRun:async id=>f.rawRun(id),readHeldJob:async()=>observed,loadPlan:async sha=>plans.get(sha),writeOwner:async q=>{writes.push(q);
        if(q.text.includes('attest_evidence'))plans.get(q.values[0]).attempt.proofSha256=q.values[1];
        else plans.set(q.values[0],{plan:JSON.parse(q.values[3]),actionSha256:q.values[1],attempt:null});}}});
  async function result(plan,id,report=null){
    let reportRef=manifestRef,execution=null;
    if(plan.mode!=='Review')reportRef=await f.store(`worker-v5/${S.instanceId}/${f.profile.newJobId}/${envelope.innerManifest.manifestSha256}/run-${id}-1/${plan.mode==='RunOnce'?'run':'inspect'}.json`,report);
    if(plan.mode==='RunOnce')execution=await f.store(`worker-v5/${S.instanceId}/${f.profile.newJobId}/${envelope.recoveryReviewSha256}/execution-reference-${id}-v1.json`,
      {executionRun:f.run(id),executionReportReference:reportRef,recoveryReviewSha256:envelope.recoveryReviewSha256,recoveryBasisSha256:f.basis.basisSha256});
    return f.store(resultKeyV6(plan.jobId,envelope.recoveryReviewSha256,id),await recoveryCloudResult({plan,run:f.run(id),release,
      frozenSourceCommit:f.frozenSourceCommit,envelope:{review:envelope,report},cloudReportReference:reportRef,executionReference:execution}));
  }
  const review=await publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:pkgRef}),reviewRef=await result(review.plan,'123456797');
  plans.get(review.planSha256).attempt={state:'OBSERVED',runId:'123456797',status:'completed',conclusion:'success',proofSha256:null};
  await publisher.attestResult(review.planSha256,reviewRef);const runPlan=await publisher.publishSuccessor(review.planSha256,reviewRef),runId='123456798',inspectId='123456799';
  const report={schema:'techlong/cloud-worker-run/v5',jobId:f.profile.newJobId,manifestSha256:envelope.innerManifest.manifestSha256,
    run:f.run(runId),result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const ref=await result(runPlan.plan,runId,report);let at=f.at,inspectRef;
  const input={schema:'techlong/recovery-followup-input/v1',plan:runPlan.plan,runId,innerManifestSha256:envelope.innerManifest.manifestSha256,
    workloadExpiresAt:envelope.innerManifest.workload.workloadExpiresAt,keyPath:path.resolve(tmpdir(),'synthetic-recovery-key.pem'),evidenceRoot:path.resolve(tmpdir(),'synthetic-recovery-evidence')};
  const m=await makeRecoveryFollowupReview({input,binding,basis:f.basis,operatorSourceCommit:f.sourceCommit,createdAt:at,
    pins:Array.from({length:20},(_,n)=>({file:'synthetic/'+n+'.mjs',sha256:'0'.repeat(64)})),
    key:{length:2000,mtimeMs:1,ctimeMs:1,identity:'synthetic',protectionSha256:'1'.repeat(64),contentRead:false}});
  const records=[],effects=[];
  const finish=async plan=>{const body={schema:'techlong/cloud-worker-independent-inspect/v5',jobId:f.profile.newJobId,
    manifestSha256:envelope.innerManifest.manifestSha256,run:f.run(inspectId),executionRun:f.run(runId),outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',
    journal:{state:'ALL_SLOTS_CONSUMED'},receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),checkedAt:at,
    cloudWrites:0,databaseWrites:0,privateControlReads:0,retryAllowed:false};
    inspectRef=await result(plan,inspectId,{...body,inspectSha256:await sha256Hex(body)});
    return {runId:inspectId,url:`https://github.com/${S.repository}/actions/runs/${inspectId}`};};
  const io={deadline:at+35*60000,guard:async()=>{},preflight:async()=>{effects.push('preflight');},claim:async()=>{effects.push('claim');},
    record:async(name,value)=>{records.push({name,value});},readRun:async id=>{effects.push('run:'+id);return f.rawRun(id);},readObject:f.ports.readObject,
    discoverExecutionResult:async()=>ref,discoverResult:async()=>inspectRef,dispatch:async plan=>{effects.push('dispatch');return finish(plan);},close:async()=>{effects.push('close');}};
  return {...f,binding,release,pkgRef,envelope,manifestRef,runPlan,input,m,io,ref,inspectId,records,effects,finish,writes,
    rebuild,now:()=>at,tick:ms=>{at+=ms;},getInspectRef:()=>inspectRef};
}
