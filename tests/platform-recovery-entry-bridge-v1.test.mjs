import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {recoveryFixture} from './fixtures/platform-recovery-v1.mjs';
import {makeRequestOperatorReview,runRequestOperator} from '../ops/platform-recovery-v1/request-entry.mjs';
import {compileRecoveryRequest} from '../ops/platform-recovery-v1/request.mjs';
import {parseRequestArgs} from '../ops/platform-recovery-v1/request-local.mjs';
import {recoveryData} from '../ops/platform-recovery-v1/basis.mjs';
import {prepareRecoveryPublication} from '../ops/platform-recovery-v1/publication.mjs';
import {createRecoveryWorker} from '../ops/platform-recovery-v1/worker.mjs';
import {createRecoveryPublisher,makeRecoveryPackage,rebuildRecoveryPackage,recoveryPackageKey,recoveryEnvelopeKey,recoveryCloudResult} from '../ops/platform-recovery-v1/bridge.mjs';
import {loadNeonContractV5} from '../ops/cloud-worker/neon-contract-v5.mjs';
import {resultKeyV6} from '../ops/platform-cloud-v6/contract.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';

async function entryFixture(){
  const f=await recoveryFixture(),calls=[],records=[],auth={contentRead:false,length:2000,aclSha256:'1'.repeat(64)},pins=Array.from({length:20},(_,n)=>({file:'synthetic/'+n+'.mjs',sha256:'2'.repeat(64)}));
  const ci={sourceCommit:f.sourceCommit,runId:'12345',jobId:'67890',attempt:1,status:'completed',conclusion:'success'};
  const m=await makeRequestOperatorReview({basis:f.basis,sourceCommit:f.sourceCommit,pins,ci,auth,createdAt:f.at});
  let state=structuredClone(f.state),claim=null,intent=null;
  const io={assertSource:async()=>{calls.push('source');},verifyCi:async()=>{calls.push('ci');},authMetadata:async()=>auth,
    record:async(name,value)=>{records.push({name,value});},claimWrite:async v=>{calls.push('claimWrite');claim=v;},
    claimInspect:async()=>{calls.push('claimInspect');},writerReceipt:async()=>({claim,intent}),
    open:async(a,options)=>{calls.push(options.inspect?'openRO':'openRW');assert.deepEqual(a,auth);return {
      readOnly:async()=>structuredClone(state),close:async()=>{calls.push('close');},transaction:options.inspect?undefined:async()=>{
        const p=await compileRecoveryRequest(f.basis,f.at);await options.assertApproved();await options.claimPermanent({slot:m.writeSlot,
          basisSha256:f.basis.basisSha256,manifestSha256:m.core.manifestSha256,newJobId:f.profile.newJobId});
        intent={at:f.at,manifestSha256:m.core.manifestSha256,basisSha256:f.basis.basisSha256,newJobId:f.profile.newJobId,stateSha256:f.basis.stateSha256};
        state=f.makeAfter(p);return {outcome:'RECOVERY_HELD_REQUEST_COMMITTED_REQUIRES_INDEPENDENT_READBACK',committed:true};
      }};}};
  return {...f,m,auth,calls,records,io,setState:v=>{state=v;},getState:()=>state,getClaim:()=>claim,setIntent:v=>{intent=v;}};
}
const runEntry=(f,mode='RunReviewed',extra={})=>runRequestOperator({mode,manifest:f.m,basis:f.basis,approved:f.m.manifestSha256,io:f.io,now:()=>f.at,...extra});
test('reviewed request entry preserves precise one-row scope, source/CI/auth checks and separate readback',async()=>{
  const f=await entryFixture(),r=await runEntry(f);assert.equal(r.committed,true);assert.equal(f.calls.filter(v=>v==='claimWrite').length,1);
  assert(f.calls.indexOf('ci')<f.calls.indexOf('openRW'));assert.equal(f.getClaim().manifestSha256,f.m.manifestSha256);
  const after=await runEntry(f,'Inspect');assert.equal(after.outcome,'RECOVERY_HELD_REQUEST_INDEPENDENTLY_VERIFIED');
  assert.equal(after.executionAuthorized,false);assert.equal(f.calls.filter(v=>v==='claimInspect').length,1);assert(f.calls.includes('openRO'));
});
for(const fault of ['sha','source','ci','auth','state'])test('request entry rejects '+fault+' before permanent claim',async()=>{
  const f=await entryFixture();if(fault==='sha'){await assert.rejects(runEntry(f,'RunReviewed',{approved:'0'.repeat(64)}));assert.deepEqual(f.calls,[]);return;}
  if(fault==='source')f.io.assertSource=async()=>{throw Error('synthetic source failure');};
  if(fault==='ci')f.io.verifyCi=async()=>{throw Error('synthetic ci failure');};
  if(fault==='auth')f.io.authMetadata=async()=>({...f.auth,length:1});
  if(fault==='state'){const v=structuredClone(f.state);v.jobs[0].status='pending';f.setState(v);}
  const r=await runEntry(f);assert.equal(r.executionAuthorized,false);assert(!f.calls.includes('claimWrite'));
  if(fault==='state')assert.equal(f.calls.at(-1),'close');else assert(!f.calls.includes('openRW'));
});
test('missing writer claim prevents private config/DB open; missing intent may only prove no write',async()=>{
  const f=await entryFixture(),r=await runEntry(f,'Inspect');assert.equal(r.executionAuthorized,false);assert(!f.calls.includes('openRO'));
  await runEntry(f);f.setIntent(null);f.setState(structuredClone(f.state));
  const absent=await runEntry(f,'Inspect');assert.equal(absent.outcome,'RECOVERY_REQUEST_ABSENT_INDEPENDENTLY_OBSERVED');
});
test('inspect never invokes transaction and refuses changed rows without an exact writer intent',async()=>{
  const f=await entryFixture();await runEntry(f);f.setIntent(null);
  const r=await runEntry(f,'Inspect');assert.equal(r.outcome,'RECOVERY_REQUEST_OPERATOR_STOPPED_REQUIRES_READBACK');assert.equal(r.code,'RECOVERY_V1_REQUEST_WRITER_INTENT_REQUIRED_FOR_CHANGED_STATE');
});
test('request CLI rejects endpoint/profile/path/scope overrides before acquiring capabilities',()=>{
  for(const a of [[],['--mode','RunReviewed','--manifest','C:/private.json','--approved-sha','a'.repeat(64),'--output','F:/ChatGPT_workshop/techlong-w9f-request-test'],
    ['--mode','PrepareSaved','--ci-run','x','--output','F:/ChatGPT_workshop/techlong-w9f-request-test'],
    ['--mode','PrepareSaved','--ci-run','123','--output','x','--profile','owner']])assert.throws(()=>parseRequestArgs(a));
});

async function bridgeFixture(){
  const f=await recoveryFixture(),d=recoveryData(f.basis,f.at),writes=[],plans=new Map(),calls=[];
  const objects=[...f.objects.entries()].map(([key,object])=>({reference:{key,versionId:object.versionId,sha256:null},object:structuredClone(object)}));
  for(const v of objects)v.reference.sha256=await sha256Hex(v.object.value);
  const pkg=await makeRecoveryPackage({basis:f.basis,inputs:f.input,objects}),pkgRef=await f.store(recoveryPackageKey(f.basis.basisSha256),pkg);
  const rebuilt=await rebuildRecoveryPackage(pkg,f.compile);assert.equal(rebuilt.basisSha256,f.basis.basisSha256);
  const p=await compileRecoveryRequest(f.basis,f.at),newState=f.makeAfter(p),observed=structuredClone(f.observed);
  observed.job={...newState.jobs.find(j=>j.id===p.jobId),payload:canonicalJson(p.payload)};observed.jobs=[...f.state.jobs,structuredClone(observed.job)];
  observed.requester={id:ADMIN,status:'active',is_platform_admin:1};observed.checkedAt=f.at;
  const deps={code:{commitSha:f.sourceCommit,closureSha256:f.release.closureSha256},installation:f.installation,contract:await loadNeonContractV5(),run:f.run('123456797'),
    openDatabase:async()=>({verify:async()=>{},read:async()=>structuredClone(observed)}),evidence:{verify:async()=>{},put:async()=>({synthetic:true})},
    provider:{readCell:async()=>({stackId:d.context.base.compute.stackId,outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,d.context.base.compute.outputs[k]])),
      parentTagExpiresAt:d.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
      inspectBefore:async()=>({namespacesAbsent:true,retiredPredecessor:d.context.predecessor.stackId,cloudWrites:0})}};
  const envelope=(await createRecoveryWorker({basis:f.basis,dependencies:deps,authorize:async()=>{},observeRetirement:async()=>({retirement:f.retirement,observedAt:f.at}),now:()=>f.at})
    .review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(20000)})).review;
  const outerRef=await f.store(recoveryEnvelopeKey(f.profile.newJobId,envelope.recoveryReviewSha256),envelope);
  const ports={guard:async()=>{calls.push('guard');},readHeldJob:async id=>{assert.equal(id,f.profile.newJobId);return structuredClone(observed);},
    readObject:async ref=>{calls.push('object');return f.ports.readObject(ref);},readRun:async id=>f.rawRun(id),loadPlan:async sha=>structuredClone(plans.get(sha)),
    writeOwner:async q=>{writes.push(q);if(q.text.includes('attest_evidence'))plans.get(q.values[0]).attempt.proofSha256=q.values[1];
      else {const plan=JSON.parse(q.values[3]);plans.set(q.values[0],{plan,planSha256:q.values[0],actionSha256:q.values[1],riskSha256:q.values[2],attempt:null});}}};
  const activation={schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',
    sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,releaseSha256:await sha256Hex(f.release)};
  const options={basis:f.basis,release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,activation,ports,now:()=>f.at,
    rebuildPackage:v=>rebuildRecoveryPackage(v,f.compile)},publisher=createRecoveryPublisher(options);
  const observe=(v,id)=>{plans.get(v.planSha256).attempt={state:'OBSERVED',runId:id,status:'completed',conclusion:'success',proofSha256:null};};
  const result=async(valid,id,report)=>{
    const mode=valid.plan.mode,run=f.run(id),inner=envelope.innerManifest;
    let reportRef=outerRef,execution=null;
    if(mode!=='Review')reportRef=await f.store(`worker-v5/${SInstance()}/${f.profile.newJobId}/${inner.manifestSha256}/run-${id}-1/${mode==='RunOnce'?'run':'inspect'}.json`,report);
    if(mode==='RunOnce')execution=await f.store(`worker-v5/${SInstance()}/${f.profile.newJobId}/${envelope.recoveryReviewSha256}/execution-reference-${id}-v1.json`,
      {executionRun:run,executionReportReference:reportRef,recoveryReviewSha256:envelope.recoveryReviewSha256,recoveryBasisSha256:f.basis.basisSha256});
    const value=await recoveryCloudResult({plan:valid.plan,run,release:f.release,frozenSourceCommit:f.frozenSourceCommit,
      envelope:{review:envelope,report},cloudReportReference:reportRef,executionReference:execution});
    return f.store(resultKeyV6(f.profile.newJobId,envelope.recoveryReviewSha256,id),value);
  };
  return {...f,pkg,pkgRef,envelope,outerRef,writes,plans,calls,ports,options,publisher,observe,result};
}
const SInstance=()=> 'app_e897a4377bce498b9c5ee9e64509dcad';
test('publication bridge uses unchanged V6 plan/owner SQL and binds recovery through Review -> RunOnce -> Inspect',async()=>{
  const f=await bridgeFixture();
  const review=await f.publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef});
  assert.equal(review.plan.schema,'techlong/platform-controller-plan/v6');assert.equal(review.executionApproved,false);
  const reviewRef=await f.result(review,'123456797');f.observe(review,'123456797');await f.publisher.attestResult(review.planSha256,reviewRef);
  const run=await f.publisher.publishSuccessor(review.planSha256,reviewRef);assert.equal(run.plan.mode,'RunOnce');assert.equal(run.plan.inputs.manifestSha,f.envelope.recoveryReviewSha256);
  const report={schema:'techlong/cloud-worker-run/v5',jobId:f.profile.newJobId,manifestSha256:f.envelope.innerManifest.manifestSha256,run:f.run('123456798'),
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const runRef=await f.result(run,'123456798',report);f.observe(run,'123456798');await f.publisher.attestResult(run.planSha256,runRef);
  const inspect=await f.publisher.publishSuccessor(run.planSha256,runRef);assert.equal(inspect.plan.mode,'Inspect');assert.equal(inspect.plan.predecessor.runId,'123456798');
  const body={schema:'techlong/cloud-worker-independent-inspect/v5',jobId:f.profile.newJobId,manifestSha256:f.envelope.innerManifest.manifestSha256,
    run:f.run('123456799'),executionRun:f.run('123456798'),outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',journal:{state:'ALL_SLOTS_CONSUMED'},
    receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),checkedAt:f.at,cloudWrites:0,databaseWrites:0,privateControlReads:0,retryAllowed:false};
  const inspectRef=await f.result(inspect,'123456799',{...body,inspectSha256:await sha256Hex(body)});f.observe(inspect,'123456799');
  const accepted=await f.publisher.attestResult(inspect.planSha256,inspectRef);assert.equal(accepted.outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');
  assert.equal(accepted.basisSha256,f.basis.basisSha256);await assert.rejects(f.publisher.publishSuccessor(inspect.planSha256,inspectRef));
  assert.equal(f.writes.length,6);assert(f.writes.every(q=>/^SELECT deployment_control_v6\.(?:publish_plan|attest_evidence)\(/.test(q.text)));
});
test('unpublished recovery release and unapproved actual ledger cannot trigger owner writes',async()=>{
  const f=await bridgeFixture(),bad=createRecoveryPublisher({...f.options,release:{...f.release,state:'CANDIDATE'}});
  await assert.rejects(bad.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef}));assert.equal(f.writes.length,0);
  const v=await f.publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef}),ref=await f.result(v,'123456797');
  await assert.rejects(f.publisher.attestResult(v.planSha256,ref));assert.equal(f.writes.length,1);
});

test('old generic published release alone cannot activate the recovery bridge',async()=>{
  const f=await bridgeFixture();for(const activation of [undefined,{...f.options.activation,state:'CANDIDATE'},
    {...f.options.activation,sourceCommit:'0'.repeat(40)},{...f.options.activation,releaseSha256:'0'.repeat(64)}]){
    await assert.rejects(createRecoveryPublisher({...f.options,activation}).publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef}));
  }assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
});

test('publication draft reconstructs originals but grants no PUT, SQL, activation or dispatch authority',async()=>{
  const f=await bridgeFixture(),pins=Array.from({length:20},(_,n)=>({file:'synthetic/'+n+'.mjs',sha256:'2'.repeat(64)}));
  const v=await prepareRecoveryPublication({basis:f.basis,inputs:f.input,objects:f.pkg.objects,sourceCommit:f.sourceCommit,pins,
    ci:{sourceCommit:f.sourceCommit,conclusion:'success'},requestOperatorSha256:'1'.repeat(64),createdAt:f.at},v=>rebuildRecoveryPackage(v,f.compile));
  assert.deepEqual(v.package,f.pkg);assert.equal(v.draft.proposedReleaseState,'CANDIDATE');assert.equal(v.draft.recoveryActivation,null);
  assert.equal(v.draft.proposedPackage.versionId,null);assert.equal(v.draft.proposedPackage.published,false);assert.equal(v.draft.executionAuthorized,false);
  for(const k of ['awsWritesAuthorized','githubWorkflowPublicationsAuthorized','iamChangesAuthorized','sqlWritesAuthorized','dispatchesAuthorized'])assert.equal(v.draft[k],0);
  const {draftSha256,...body}=v.draft;assert.equal(await sha256Hex(body),draftSha256);assert.deepEqual(f.writes,[]);
});
for(const fault of ['package','envelope','run','outcome'])test('bridge rejects '+fault+' drift without proof/successor writes',async()=>{
  const f=await bridgeFixture(),v=await f.publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef}),ref=await f.result(v,'123456797');
  f.observe(v,'123456797');
  if(fault==='run')f.ports.readRun=async id=>({...f.rawRun(id),run_attempt:2});
  else f.ports.readObject=async r=>{const o=f.objects.get(r.key);
    const copy=structuredClone(o);if(fault==='package'&&r.key===f.pkgRef.key)copy.value.basis.disposition.independentAcceptance=true;
    if(fault==='envelope'&&r.key===f.outerRef.key)copy.value.disposition.historicalIndependentAcceptance=true;
    if(fault==='outcome'&&r.key===ref.key)copy.value.outcome='SUCCEEDED_INDEPENDENTLY_VERIFIED';return copy;};
  // A fresh bridge has no earlier cached bytes to mask this injected mutation.
  await assert.rejects(createRecoveryPublisher(f.options).attestResult(v.planSha256,ref));assert.equal(f.writes.length,1);
});
test('No-AWS CI covers entry/bridge and the existing 81-file cloud release is unchanged',async()=>{
  const c=await platformClosureV6();assert.equal(c.closureSha256,B.platform.closureSha256);assert.equal(c.pinCount,81);
  const ci=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(ci.permissions,{contents:'read'});assert(ci.jobs.candidate.steps.some(s=>s.run?.includes('tests/platform-recovery-entry-bridge-v1.test.mjs')));
});
