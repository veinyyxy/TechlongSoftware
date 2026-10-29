// Targeted regression for native buyer publication through the EXISTING whole
// flow. Cloud reports/ports are synthetic; compilers, verifiers and publishers
// are real. No local archives, production credentials, network or live writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerFixture} from './fixtures/buyer-compatibility-v1.mjs';
import {createReviewedCycle,RISK} from '../ops/platform-reviewed-cycle-v1/cycle.mjs';
import {createCycleComposition,projectHistory} from '../ops/platform-reviewed-cycle-v1/composition.mjs';
import {archivedControlHistory} from '../ops/platform-reviewed-cycle-v1/package.mjs';
import {createWholeCycleFlow} from '../ops/platform-reviewed-cycle-v1/whole.mjs';
import {createBuyerPublisher,bindBuyerWorkflowSource,prepareBuyerFromSource} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {createDispatchOperation} from '../ops/platform-delegated-approval-v1/operation.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
import {INSTALLATION} from '../ops/platform-a604-operator-v1/policy.mjs';
import {environmentProof} from '../ops/platform-delegated-approval-v1/policy.mjs';
import {runPlatformCloudV6} from '../ops/platform-cloud-v6/runtime.mjs';
import {runBuyerCompatibility} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {compilePlatformInitializedClaimV4,compilePlatformInitializedCompleteV4} from '../lib/deployments/execution/express-platform-claim-v4.ts';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';

async function fixture(fault){
  const f=await buyerFixture(),now=f.options.now,at=now(),job=f.source.request.jobId,store=f.f.store,readObject=f.f.readObject,
    events=[],writes=[],records=[],entries=new Map(),results=new Map();
  let state=normalizedState({...f.state,jobs:[...f.state.jobs,f.observed.job]});
  const profile={...f.f.profile,newJobId:job,clientRequestId:f.source.request.clientRequestId,requestId:f.source.request.requestId,
    stateSha256:await sha256Hex(f.state),databaseCheckedAt:at,observedBy:at};
  const history=archivedControlHistory(f.state,at),source={schema:'techlong/reviewed-cycle-source/v1',profile,
    historicalJobIds:f.state.jobs.map(j=>j.id),historicalPlanCount:history.length,
    requestEvidence:{schema:'techlong/reviewed-cycle-request-evidence/v1',jobId:job,requestId:profile.requestId,
      transactionAt:at,independentObservedAt:at,afterSha256:await sha256Hex(state),sealRawSha256:'1'.repeat(64)}};
  source.historySha256=await sha256Hex(projectHistory(history,source.historicalJobIds));
  const bundle={schema:'techlong/buyer-context-bundle/v1',originalPackage:f.f.pkg,baseline:f.state,capsule:f.capsule,links:f.links},
    bundleSha=await sha256Hex(bundle),bundleRef=await store(`worker-v5/${S.appInstanceId}/lineage/buyer-context-v1-${bundleSha}.json`,bundle);
  const selected=await createReviewedCycle(source,{anchor:f.f.profile}),profileSha256=await sha256Hex(profile),
    expiresAt=Math.min(f.f.basis.expiresAt,profile.factsAt+profile.validMs);
  const p={...structuredClone(f.f.publication),schema:'techlong/buyer-context-publication/v1',protocol:'platform-v6/buyer-context',
    cycleId:selected.cycleId,riskFile:RISK,profileSha256,buyerContextSha256:await sha256Hex(f.source),packageReference:bundleRef,
    factsApproval:{state:'APPROVED',manifestSha256:'7'.repeat(64),profileSha256,factsAt:profile.factsAt,
      databaseCheckedAt:at,observedBy:at,expiresAt,originalBasisExtended:false},
    activation:{schema:'techlong/buyer-context-activation/v1',state:'PUBLISHED',protocol:'platform-v6/buyer-context',
      sourceCommit:f.source.code.commitSha,frozenSourceCommit:f.f.sourceCommit,releaseSha256:await sha256Hex(f.f.release)}};
  source.publication=p;
  const c=await createCycleComposition(source,{now,anchor:f.f.profile,buyer:f.compat,buyerBundle:bundle});
  f.f.objects.set(INSTALLATION.key,{...(await readObject(f.f.installationReference)),versionId:INSTALLATION.versionId});
  const grant=await c.policy.grant({sourceCommit:p.sourceCommit,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'a'.repeat(64)})),
    ci:{sourceCommit:p.sourceCommit,testedSourceCommit:p.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    environment:environmentProof({name:c.definition.environment,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:14145707}}]}],can_admins_bypass:false}),
    history:c.capability.history(history),key:{length:2000,contentRead:false,protectionSha256:'c'.repeat(64)},
    auth:{length:100,contentRead:false,aclSha256:'e'.repeat(64)},issuedAt:at});
  const loadPlan=async sha=>structuredClone(entries.get(sha)??null);
  const writeOwner=async q=>{
    const proof=q.text.includes('attest_evidence');writes.push(proof?'proof':'publish');
    if(fault==='proof'&&proof&&events.includes('dispatch-RunOnce'))throw Error('SYNTHETIC_UNKNOWN_WRITE');
    if(proof){entries.get(q.values[0]).attempt.proofSha256=q.values[1];state.ledger.attempts.find(a=>a.plan_sha===q.values[0]).proof_sha=q.values[1];}
    else{const v=await validatePlan(JSON.parse(q.values[3]),p.release,now());entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});
      state.ledger.plans.push({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,body:v.plan,job_id:job,mode:v.plan.mode,
        expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(now()).toISOString()});}
  };
  const initial=createBuyerPublisher({compat:f.compat,publication:p,now,ports:{guard:c.runtime.guard,readObject,
    readHeldJob:async()=>f.observed,loadPlan,readRun:async id=>f.f.rawRun(id),writeOwner}});
  const seed=await initial.publishReview({installationReference:INSTALLATION});assert.equal(seed.planSha256,grant.seed.planSha256);writes.length=0;
  const dispatchOperation=createDispatchOperation({definition:c.definition,approve:c.policy.approve,target:c.policy.target,
    history:c.capability.history,key:c.capability.auditKey,historyModes:c.definition.modes});
  const dispatch=async(mode,plan)=>{
    events.push('dispatch-'+mode);const id={Review:'123456801',RunOnce:'123456802',Inspect:'123456803'}[mode];
    return dispatchOperation({grant,approved:grant.grantSha256,mode,planSha256:plan.planSha256,now,io:{
      assertSource:async()=>{},verifyCi:async()=>{},environment:async()=>grant.environment,preflight:async()=>{},status:async()=>history,loadPlan,
      claim:async()=>events.push('slot-'+mode),record:async()=>{},persistAudit:async()=>{},publishSeed:async()=>{throw Error('SEED_REPLAY');},
      begin:async()=>{entries.get(plan.planSha256).attempt={state:'DISPATCHING',runId:null,status:null,conclusion:null,proofSha256:null};
        state.ledger.approvals.push({plan_sha:plan.planSha256,admin_id:c.definition.admin,approved_at:new Date(now()).toISOString()});
        state.ledger.attempts.push({plan_sha:plan.planSha256,job_id:job,mode,state:'DISPATCHING',run_id:null,run_status:null,conclusion:null,proof_sha:null,observed_at:null});},
      assertLive:async()=>{},dispatch:async(_p,before,onAck)=>{await before();if(fault==='unknown-'+mode)throw Error('SYNTHETIC_UNKNOWN_ACK');
        await onAck({runId:id,url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+id});},
      acknowledge:async(sha,ack)=>{Object.assign(entries.get(sha).attempt,{state:'ACKNOWLEDGED',runId:ack.runId});
        Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'ACKNOWLEDGED',run_id:ack.runId});},
      markUnknown:async()=>events.push('unknown-'+mode),close:async()=>{}}});
  };
  const publisherIo=()=>({assertSource:async()=>{},verifyCi:async()=>{},verifySourceIdentity:async()=>{},claim:async()=>events.push('publisher-slot'),
    record:async()=>{},readRun:async id=>f.f.rawRun(id),readObject,close:async()=>{},open:async()=>({loadPlan,snapshot:async()=>structuredClone(state),writeOwner,
      close:async()=>{},observe:async sha=>{writes.push('observe');Object.assign(entries.get(sha).attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
        Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(now()).toISOString()});}})});
  async function wait(ack){
    events.push('human-approval-'+ack.mode);const plan=entries.get(ack.planSha256).plan,input={...f.env,GITHUB_RUN_ID:ack.runId,
      TECHLONG_INPUT_INSTALLATION:canonicalJson(INSTALLATION),...Object.fromEntries(Object.entries(plan.inputs).map(([k,v])=>['TECHLONG_INPUT_'+k.toUpperCase(),v]))};
    const ports={...f.ports,read:async ref=>(await readObject(ref)).value,
      writeResult:(key,value)=>store(key,fault==='recovery-result-Review'&&ack.mode==='Review'?{...value,schema:'techlong/recovery-cloud-result/v1'}:value),writeExecution:store};
    let result;
    if(ack.mode==='Review')result=await runBuyerCompatibility({...f.options,env:input,binding:f.binding,closure:f.closure,ports,dependencies:f.dependencies});
    else{
      const manifest=(await readObject(JSON.parse(plan.inputs.manifest))).value;let report;
      if(ack.mode==='RunOnce'){
        const done=now()+1000,claim=await compilePlatformInitializedClaimV4({plan:manifest.jobPlan,queuedJob:manifest.queue.row,
          approvedPlanSha256:manifest.jobPlan.planSha256,leaseToken:'lease_'+'0'.repeat(32)}),
          proof={...f.f.proof,jobId:job,leaseToken:claim.lease.leaseToken,workloadExpiresAt:manifest.workload.workloadExpiresAt,
            controlCheckedAt:done-1,authorityCheckedAt:done-1,providerCheckedAt:done-1};
        const complete=await compilePlatformInitializedCompleteV4({plan:manifest.jobPlan,queuedJob:manifest.queue.row,lease:claim.lease,proof,now:done});
        const completed={...manifest.queue.row,status:'succeeded',payload:JSON.parse(claim.statements[3].values[2]),attempts:1,
          available_at:manifest.jobPlan.preparedAt+100,completed_at:done,updated_at:done};
        state.jobs=state.jobs.map(j=>j.id===job?completed:j);state.deployment.outputs=JSON.parse(complete.outputs);
        state.deployment.admissionSnapshot.predecessorJob=completed;
        report={schema:'techlong/cloud-worker-run/v5',manifestSha256:manifest.manifestSha256,jobId:job,run:f.f.run(ack.runId),
          result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',receiptSha256:complete.receiptSha256},journal:{state:'ALL_SLOTS_CONSUMED'},retryAllowed:false,independentInspectRequired:true};
      }else{
        const receipt=state.deployment.outputs.expressInitializedWorkerRunsV2[job],body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',
          jobId:job,manifestSha256:manifest.manifestSha256,receiptSha256:await sha256Hex(receipt),providerObservationSha256:receipt.providerObservationSha256,
          run:f.f.run(ack.runId),executionRun:f.f.run('123456802'),journal:{state:'ALL_SLOTS_CONSUMED'},checkedAt:now(),
          retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
        if(fault==='receipt-Inspect')body.receiptSha256='9'.repeat(64);report={...body,inspectSha256:await sha256Hex(body)};
      }
      const saved=await store(`worker-v5/${plan.instanceId}/${job}/${manifest.manifestSha256}/run-${ack.runId}-1/${ack.mode==='RunOnce'?'run':'inspect'}.json`,report);
      result=await runPlatformCloudV6({env:input,binding:f.binding,closure:f.closure,ports:{...ports,open:async()=>({
        runOnce:async()=>({report,saved}),inspect:async()=>({report,saved}),dispose(){}})}});
    }
    results.set(ack.mode,result);f.advance(fault==='late-Review'&&ack.mode==='Review'?12*60000:2000);return f.f.rawRun(ack.runId);
  }
  async function capture(ack){
    const entry=await loadPlan(ack.planSha256),reference=results.get(ack.mode).saved,result=(await readObject(reference)).value,
      refs=[reference,ack.mode==='Review'?result.cloudReportReference:JSON.parse(entry.plan.inputs.manifest)];
    if(ack.mode!=='Review')refs.push(result.cloudReportReference);if(ack.mode==='RunOnce')refs.push(result.executionReference);refs.push(bundleRef,INSTALLATION);
    const objects=[];for(const reference of refs)objects.push({reference,object:await readObject(reference)});
    const snapshot=structuredClone(state);if(fault==='business-'+ack.mode)snapshot.deployment.admissionSnapshot.subscription.status='paused';
    return {entry,objects,resultReference:reference,snapshot};
  }
  const flow=createWholeCycleFlow(c,{now}),outer=await flow.makeReview({grant,createdAt:now()});
  const continuousIo={record:async(n,v)=>records.push({n,v}),assertSource:async()=>{},verifyCi:async()=>{},assertUnused:async()=>{},
    claim:async()=>{},dispatchReview:async()=>dispatch('Review',grant.seed),waitReview:wait,capture,publisherIo:async()=>publisherIo(),close:async()=>{}};
  const io={record:async(n,v)=>records.push({n,v}),assertSource:async()=>{},verifyCi:async()=>{},assertUnused:async()=>{},claim:async()=>{},
    continuousIo:async()=>continuousIo,dispatch,wait,capture,publisherIo:async()=>publisherIo(),close:async()=>{}};
  return {f,c,source,bundle,flow,outer,io,events,writes,records};
}

test('buyer context reaches the existing full three-mode flow and both exact three-write publishers',async()=>{
  const f=await fixture(),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'WHOLE_CYCLE_INDEPENDENTLY_VERIFIED',JSON.stringify(r));
  assert.deepEqual(f.writes,['observe','proof','publish','observe','proof','publish']);
  for(const mode of ['Review','RunOnce','Inspect']){
    assert.equal(f.events.filter(e=>e==='dispatch-'+mode).length,1);assert(f.events.includes('human-approval-'+mode));}
  assert.equal(r.wholeProductAccepted,false);assert.equal(r.finalLedgerProofImported,false);
  assert.equal(f.outer.policy.approveGithubEnvironment,false);
  assert.equal(f.c.publication.protocol,'platform-v6/buyer-context');
  assert.equal(f.outer.limits.appDispatchesMax,3);assert.equal(f.outer.cloud.createStackMax,1);
});
for(const fault of ['unknown-RunOnce','proof','receipt-Inspect','business-RunOnce','recovery-result-Review','late-Review'])
  test('buyer full-flow fails closed without retry or another mode after '+fault,async()=>{
    const f=await fixture(fault),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
    assert.equal(r.outcome,'WHOLE_CYCLE_STOPPED_REQUIRES_READBACK');
    assert.equal(r.retryAllowed,false);assert(f.events.filter(e=>e==='dispatch-RunOnce').length<=1);
    if(fault!=='receipt-Inspect')assert(!f.events.includes('dispatch-Inspect'));
  });
test('serialized buyer capability cannot select the new composition; default old protocol guard stays in force',async()=>{
  const f=await fixture();
  await assert.rejects(createCycleComposition(f.source,{now:f.f.options.now,anchor:f.f.f.profile,buyer:{...f.f.compat},buyerBundle:f.bundle}),/SOURCE_CAPABILITY_REQUIRED/);
  await assert.rejects(createCycleComposition(f.source,{now:f.f.options.now,anchor:f.f.f.profile}),/PUBLICATION/);
});
test('publication cannot extend the genuine historical basis or accept changed bundle material',async()=>{
  const f=await fixture(),changed=structuredClone(f.source);changed.publication.factsApproval.expiresAt++;
  await assert.rejects(createCycleComposition(changed,{now:f.f.options.now,anchor:f.f.f.profile,buyer:f.f.compat,buyerBundle:f.bundle}),/BUYER_FACTS_APPROVAL/);
  const bundle=structuredClone(f.bundle);bundle.capsule.publicParameters.CorsAllowedOrigins='*';
  await assert.rejects(f.c.runtime.rebuild(bundle),/BUYER_BUNDLE_SHA/);
});
test('SOURCE binding derives only the four original and two buyer self references',async()=>{
  const f=await fixture(),template=structuredClone(f.source),p=template.publication;
  template.buyer={schema:'techlong/buyer-context-selection/v1',source:structuredClone(f.f.source),originalProfile:f.f.f.profile,
    bundleFile:'F:/ChatGPT_workshop/techlong-synthetic-buyer-bundle.json'};
  p.sourceCommit=null;p.release.reusableCommit=null;p.activation.sourceCommit=null;p.activation.releaseSha256=null;
  p.buyerContextSha256=null;template.buyer.source.code.commitSha=null;
  const bound=await bindBuyerWorkflowSource(template,'1'.repeat(40),'2'.repeat(40));
  assert.equal(bound.publication.sourceCommit,'1'.repeat(40));assert.equal(bound.publication.release.reusableCommit,'2'.repeat(40));
  assert.equal(bound.publication.activation.sourceCommit,'1'.repeat(40));
  assert.equal(bound.publication.activation.releaseSha256,await sha256Hex(bound.publication.release));
  assert.equal(bound.buyer.source.code.commitSha,'1'.repeat(40));
  assert.equal(bound.publication.buyerContextSha256,await sha256Hex(bound.buyer.source));
  assert.deepEqual(bound.profile,template.profile);assert.deepEqual(bound.requestEvidence,template.requestEvidence);
  assert.deepEqual(bound.buyer.originalProfile,template.buyer.originalProfile);
  assert.deepEqual(bound.publication.packageReference,template.publication.packageReference);
  const compat=await prepareBuyerFromSource(bound,f.bundle,{now:f.f.options.now});
  assert.equal(compat.source.code.commitSha,'1'.repeat(40));
  await assert.rejects(bindBuyerWorkflowSource(bound,'3'.repeat(40),'4'.repeat(40)),/WORKFLOW_SOURCE_TEMPLATE/);
});
test('SOURCE bundle loader rejects changed code binding, proof bytes and fabricated historical profile',async()=>{
  const f=await fixture(),source={...f.source,buyer:{schema:'techlong/buyer-context-selection/v1',source:f.f.source,originalProfile:f.f.f.profile}};
  const compat=await prepareBuyerFromSource(source,f.bundle,{now:f.f.options.now});assert.equal(compat.source.request.jobId,f.c.definition.jobId);
  await assert.rejects(prepareBuyerFromSource({...source,publication:{...source.publication,sourceCommit:'0'.repeat(40)}},f.bundle,{now:f.f.options.now}),/SELECTED_SOURCE_BINDING/);
  const bundle=structuredClone(f.bundle);bundle.baseline.protection.catalogSha256='0'.repeat(64);
  await assert.rejects(prepareBuyerFromSource(source,bundle,{now:f.f.options.now}),/SELECTED_BUNDLE/);
  await assert.rejects(prepareBuyerFromSource({...source,buyer:{...source.buyer,originalProfile:{...source.buyer.originalProfile,receiptSha256:'0'.repeat(64)}}},f.bundle,{now:f.f.options.now}));
});
