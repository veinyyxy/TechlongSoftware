// Targeted regression for native buyer publication through the EXISTING whole
// flow. Cloud reports/ports are synthetic; compilers, verifiers and publishers
// are real. No local archives, production credentials, network or live writes.
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {STSClient} from '@aws-sdk/client-sts';
import {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import {S3Client} from '@aws-sdk/client-s3';
import {CLOUD_V6} from '../ops/platform-cloud-v6/contract.mjs';
import {buyerFixture} from './fixtures/buyer-compatibility-v1.mjs';
import {createReviewedCycle,RISK} from '../ops/platform-reviewed-cycle-v1/cycle.mjs';
import {createCycleComposition,projectHistory} from '../ops/platform-reviewed-cycle-v1/composition.mjs';
import {archivedControlHistory} from '../ops/platform-reviewed-cycle-v1/package.mjs';
import {createWholeCycleFlow} from '../ops/platform-reviewed-cycle-v1/whole.mjs';
import {createBuyerPublisher,bindBuyerWorkflowSource,prepareBuyerFromSource,buyerCompatibilityData} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
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
import {createBuyerApplication,runBuyerLive,assertBuyerPublicationSource} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {createBuyerPublication,BUYER_PUBLICATION_SOURCE,hash} from '../ops/platform-reviewed-cycle-v1/publication.mjs';
import {selectPublication,profile as publicationProfile} from '../ops/platform-reviewed-cycle-v1/publication-local.mjs';
import {publishAppOnceV6} from '../ops/platform-publication-v6/plan.mjs';
import {rebuildRecoveryPackage} from '../ops/platform-recovery-v1/package.mjs';
import {recoveryBasisCompiler} from '../ops/platform-recovery-v1/basis-core.mjs';
import {prepareBuyerCompatibility} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';

async function fixture(fault,{accepted=false}={}){
  const f=await buyerFixture({accepted}),now=f.options.now,at=now(),job=f.source.request.jobId,store=f.f.store,readObject=f.f.readObject,
    events=[],writes=[],records=[],entries=new Map(),results=new Map();
  let state=normalizedState({...f.state,jobs:[...f.state.jobs,f.observed.job]});
  const profile={...f.f.profile,newJobId:job,clientRequestId:f.source.request.clientRequestId,requestId:f.source.request.requestId,
    stateSha256:await sha256Hex(f.state),databaseCheckedAt:at,observedBy:at,
    ...(accepted?{factsAt:f.source.acceptedContinuation.facts.factsAt}:{})};
  const history=archivedControlHistory(f.state,at),source={schema:'techlong/reviewed-cycle-source/v1',profile,
    historicalJobIds:f.state.jobs.map(j=>j.id),historicalPlanCount:history.length,
    requestEvidence:{schema:'techlong/reviewed-cycle-request-evidence/v1',jobId:job,requestId:profile.requestId,
      transactionAt:at,independentObservedAt:at,afterSha256:await sha256Hex(state),sealRawSha256:'1'.repeat(64)}};
  source.historySha256=await sha256Hex(projectHistory(history,source.historicalJobIds));
  const bundle={schema:'techlong/buyer-context-bundle/v1',originalPackage:f.f.pkg,baseline:f.state,capsule:f.capsule,links:f.links},
    bundleSha=await sha256Hex(bundle),bundleRef=await store(`worker-v5/${S.appInstanceId}/lineage/buyer-context-v1-${bundleSha}.json`,bundle);
  const selected=await createReviewedCycle(source,{anchor:f.f.profile}),profileSha256=await sha256Hex(profile),
    expiresAt=Math.min(accepted?f.source.acceptedContinuation.facts.expiresAt:f.f.basis.expiresAt,profile.factsAt+profile.validMs);
  const p={...structuredClone(f.f.publication),schema:'techlong/buyer-context-publication/v1',protocol:'platform-v6/buyer-context',
    basisSha256:buyerCompatibilityData(f.compat,at).authority.basisSha256,
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

test('buyer SDK application requires a genuine code capability before credentials and constructs without I/O',async()=>{
  const f=await buyerFixture();let credentials=0;
  const options={compat:f.compat,installation:f.dependencies.installation,code:f.source.code,run:f.dependencies.run,
    credentials:async()=>{credentials++;throw Error('NO_CREDENTIAL_DISCOVERY');},now:f.options.now};
  await assert.rejects(createBuyerApplication({...options,compat:{...f.compat}}),/SOURCE_CAPABILITY_REQUIRED/);
  await assert.rejects(createBuyerApplication({...options,code:{...f.source.code,commitSha:'0'.repeat(40)}}),/SDK_CODE_BINDING/);
  const app=await createBuyerApplication(options);assert.equal(credentials,0);assert.equal(typeof app.runOnce,'function');app.dispose();
});
for(const identity of ['exact','wrong'])test('real buyer SDK port gates its fixed DB Secret on '+identity+' role identity',async()=>{
  const f=await buyerFixture(),run=f.dependencies.run,events=[];
  const sts=mock.method(STSClient.prototype,'send',async()=>{events.push('identity');return {Account:'402010193138',
    UserId:(identity==='exact'?f.dependencies.installation.roleId:'AROAWRONG')+`:Deploy-${run.runId}-1`,
    Arn:`arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${run.runId}-1`};});
  const sm=mock.method(SecretsManagerClient.prototype,'send',async command=>{events.push('secret');
    assert.deepEqual(command.input,{SecretId:f.dependencies.installation.databaseSecret.arn,
      VersionId:f.dependencies.installation.databaseSecret.versionId,VersionStage:'AWSCURRENT'});throw Error('SYNTHETIC_FIXED_SECRET_STOP');});
  try{
    const app=await createBuyerApplication({compat:f.compat,installation:f.dependencies.installation,code:f.source.code,run,
      credentials:async()=>{throw Error('NO_REAL_CREDENTIALS');},now:f.options.now});
    assert.deepEqual(events,[]);
    try{await assert.rejects(app.review({jobId:f.source.request.jobId,signal:AbortSignal.timeout(10000)}),
      identity==='exact'?/SYNTHETIC_FIXED_SECRET_STOP/:/ASSUMED_ROLE_IDENTITY_MISMATCH/);
      assert.deepEqual(events,identity==='exact'?['identity','secret']:['identity']);
      await assert.rejects(app.review({jobId:f.source.request.jobId,signal:AbortSignal.timeout(10000)}),/ROOT_MODE_ONCE/);
    }finally{app.dispose();}
  }finally{sts.mock.restore();sm.mock.restore();}
});
test('new live/publication default selection rejects before OIDC, file or credentials',async()=>{
  let reads=0;const fetch=mock.method(globalThis,'fetch',async()=>{reads++;throw Error('NO_NETWORK');});
  try{
    await assert.rejects(runBuyerLive({},{}),/SOURCE_NOT_CONFIGURED/);
    assert.equal(await selectPublication({read:async()=>{reads++;throw Error('NO_FILE');}}),null);
    assert.equal(BUYER_PUBLICATION_SOURCE,null);assert.equal(reads,0);
  }finally{fetch.mock.restore();}
});
async function publicationFixture(fixtureOptions={}){
  const f=await fixture(undefined,fixtureOptions),s=structuredClone(f.source),now=f.f.options.now;
  // The older synthetic recovery fixture includes a LOCAL requestSlot. The
  // real cloud profile does not. Rebuild its genuine basis without that local
  // test coordinate rather than weakening the cloud-template path guard.
  const originalProfile={...f.f.f.profile};delete originalProfile.requestSlot;delete s.profile.requestSlot;
  const basis=await rebuildRecoveryPackage(f.bundle.originalPackage,recoveryBasisCompiler(originalProfile)),
    compat=await prepareBuyerCompatibility({...f.f.options,basis});
  const profileSha256=await sha256Hex(s.profile);s.publication.profileSha256=profileSha256;s.publication.factsApproval.profileSha256=profileSha256;
  s.publication.cycleId=(await createReviewedCycle(s,{anchor:originalProfile})).cycleId;
  s.buyer={schema:'techlong/buyer-context-selection/v1',source:f.f.source,originalProfile,
    bundleFile:'F:/ChatGPT_workshop/techlong-synthetic-buyer-bundle.json'};
  const b=JSON.parse(await readFile(new URL('./fixtures/platform-recovery-publication-v1.json',import.meta.url),'utf8')),
    pin='veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-platform-job-v6.yml@1120f5106079a006c5e1c455f7de4b70e9732e5b';
  b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']=pin;
  b.iam.trust=structuredClone(b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument);
  const baseline={source:b.source,main:s.publication.sourceCommit,foundation:{stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5',
    status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template:b.template,resources:b.resources},iam:b.iam,
    environment:{environmentId:24613410405,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},unfinishedDeploymentRuns:0};
  const operatorScopeSource='// Local operator binding only; never part of the frozen cloud closure.\nexport const SELECTED_CYCLE=Object.freeze({"previous":"synthetic-installed"});\n',
    requestSnapshot=normalizedState({...f.f.state,jobs:[...f.f.state.jobs,f.f.observed.job]}),
    options={compat,bundle:f.bundle,source:s,requestSnapshot,baseline,operatorScopeSource,now},p=await createBuyerPublication(options),
    parent=s.publication.sourceCommit,r='b'.repeat(40),objects={reusable:{file:p.Q.reusable,parent,commit:r,tree:'c'.repeat(40),blob:'d'.repeat(40)},
      caller:{file:p.Q.caller,parent:r,commit:'e'.repeat(40),tree:'f'.repeat(40),blob:'1'.repeat(40),operatorBinding:{file:p.Q.bindingFile,blob:'2'.repeat(40)}}},w=p.texts(r);
  objects.reusable.normalizedLfSha256=hash(w.reusable);objects.caller.normalizedLfSha256=hash(w.caller);
  objects.caller.operatorBinding.normalizedLfSha256=hash(p.bindingText(operatorScopeSource,r));
  const input={parent,objects,baseline,operatorScopeSource,previousTargets:[p.Q.reusable,p.Q.caller,p.Q.bindingFile].map(file=>({file,blob:'3'.repeat(40),
    normalizedLfSha256:file===p.Q.bindingFile?p.Q.bindingBeforeSha256:'4'.repeat(64)})),
    observedAt:now(),createdAt:now(),pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'5'.repeat(64)})),
    ci:{sourceCommit:parent,testedSourceCommit:parent,attempt:1,status:'completed',conclusion:'success'}};
  return {f,s,now,options,p,input,w,m:await p.makeReview(input)};
}
test('native publication renders existing workflows with six SOURCE bindings and no local cloud paths',async()=>{
  const {p,w,m}=await publicationFixture();assert(w.reusable.includes('runBuyerLive'));assert(!w.reusable.includes('runCycleLive'));
  assert(!w.reusable.includes('F:/'));assert(!w.reusable.includes('E:/'));assert(!w.reusable.includes(m.objects.reusable.commit));
  assert.equal(load(w.reusable).jobs.single.environment,'techlong-sandbox-deploy');
  assert.equal(Object.keys(load(w.caller).on.workflow_dispatch.inputs).length,7);
  assert.equal(m.source.buyer.source.code.commitSha,m.objects.caller.commit);
  assert.equal(m.source.publication.buyerContextSha256,await sha256Hex(m.source.buyer.source));
  assert.equal(p.closureCount,111);assert.equal(m.effects.iamPermissionExpansion,0);assert.equal(m.effects.dispatches,0);
  const native=publicationProfile(m,{publication:p,readOnly:true});assert.equal(native.closureCount,111);assert.equal(native.scope.oldReusable,'1120f5106079a006c5e1c455f7de4b70e9732e5b');
});
test('native publication uses exact installed prestate and changes only one trust claim',async()=>{
  const {p,m,options}=await publicationFixture(),next=JSON.parse(m.actions.create.TemplateBody),claim='token.actions.githubusercontent.com:job_workflow_ref';
  next.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim]=
    options.baseline.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim];
  assert.deepEqual(next,options.baseline.foundation.template);assert.equal(m.actions.trustChanges.length,1);
  await p.validateApproval(m,m.manifestSha256,m.createdAt);
  const changed=structuredClone(m);changed.effects.newIamResources=1;await assert.rejects(p.validateApproval(changed,m.manifestSha256,m.createdAt));
  assert.throws(()=>p.bindingText('export const SELECTED_CYCLE=null;','a'.repeat(40)),/OLD_BINDING/);
  const drift=structuredClone(options.baseline);drift.iam.boundary.defaultVersion='v9';assert.throws(()=>p.validatePreflight(drift,m),/FIXED_LAYOUT/);
  await assert.rejects(p.validateApproval(m,m.manifestSha256,m.expiresAt),/APPROVAL_OR_TOO_LATE/);
  await assert.rejects(p.validateApproval(m,m.manifestSha256,m.expiresAt-1200000,false,true),/APPROVAL_OR_TOO_LATE/);
  await p.validateApproval(m,null,m.expiresAt+1,true); // archived, read-only inspection only
});
test('native publication refuses missing or fabricated request and upload evidence without production ports',async()=>{
  const {options,s}=await publicationFixture();
  await assert.rejects(createBuyerPublication({...options,source:{...s,requestEvidence:null}}),/REAL_REQUEST_EVIDENCE/);
  const changed=structuredClone(options.requestSnapshot);changed.jobs.at(-1).dedupe_key='changed';
  await assert.rejects(createBuyerPublication({...options,requestSnapshot:changed}),/BUYER_REAL_SINGLE_INSERT/);
  const material={source:s,bundle:options.bundle,requestSnapshot:options.requestSnapshot,baseline:options.baseline,
    operatorScopeSource:options.operatorScopeSource,uploadProof:null},raw=JSON.stringify(material),selection={schema:'techlong/buyer-publication-selection/v1',
      file:'F:/ChatGPT_workshop/techlong-synthetic-material.json',rawSha256:hash(raw)};
  await assert.rejects(selectPublication({selection,read:async()=>raw}),/UPLOAD_RECEIPT/);
  material.uploadProof={outcome:'PACKAGE_UPLOADED_AND_INDEPENDENT_FIXED_VERSION_VERIFIED_NO_ACTIVATION',packageReference:s.publication.packageReference,
    factsApproval:s.publication.factsApproval,slots:{permanentlyConsumed:true},actualCounts:{conditionalPuts:1,fixedVersionGets:1},runtimeActivated:false};
  const full=JSON.stringify(material),p=await selectPublication({selection:{...selection,rawSha256:hash(full)},read:async()=>full});
  assert.equal(p.closureCount,111);
});
test('native source facts cannot extend historical basis or bypass the SDK source gate',async()=>{
  const f=await publicationFixture();await assertBuyerPublicationSource(f.s,f.now(),{anchor:f.options.source.buyer.originalProfile});
  const s=structuredClone(f.s);s.publication.factsApproval.expiresAt++;
  await assert.rejects(assertBuyerPublicationSource(s,f.now(),{anchor:s.buyer.originalProfile}),/LIVE_FACTS/);
  let calls=0;const fetch=mock.method(globalThis,'fetch',async()=>{calls++;throw Error('NO_OIDC');});
  try{await assert.rejects(runBuyerLive({},f.f.f.closure,{source:{}}));assert.equal(calls,0);}finally{fetch.mock.restore();}
});

test('accepted continuation rebuilds the original bundle and exact publication after archival basis expiry',async()=>{
  const f=await publicationFixture({accepted:true}),before=canonicalJson(f.options.compat.source),at=f.now(),p=f.m.source.publication;
  assert(at>f.f.f.f.basis.expiresAt);assert(p.factsApproval.expiresAt>at);
  assert.equal(p.factsApproval.expiresAt,f.s.buyer.source.acceptedContinuation.facts.expiresAt);
  await assertBuyerPublicationSource(f.s,at,{anchor:f.s.buyer.originalProfile});
  const rebuilt=await prepareBuyerFromSource(f.s,f.options.bundle,{now:f.now});
  assert.equal(rebuilt.context.predecessor.jobId,f.options.compat.context.predecessor.jobId);
  assert.equal(canonicalJson(f.options.compat.source),before);assert.equal(f.m.effects.iamPermissionExpansion,0);
  assert.equal(f.m.effects.dispatches,0);assert.equal(f.m.actions.trustChanges.length,1);
  await f.p.validateApproval(f.m,f.m.manifestSha256,at);
  const changed=structuredClone(f.s);changed.publication.factsApproval.expiresAt++;
  await assert.rejects(assertBuyerPublicationSource(changed,at,{anchor:changed.buyer.originalProfile}),/LIVE_FACTS/);
  await assert.rejects(assertBuyerPublicationSource(f.s,p.factsApproval.expiresAt,{anchor:f.s.buyer.originalProfile}),/ACCEPTED_FACT_WINDOW/);
  const drift=structuredClone(f.s);drift.profile.factsAt++;
  await assert.rejects(assertBuyerPublicationSource(drift,at,{anchor:drift.buyer.originalProfile}),/ACCEPTED_PROFILE_FACTS/);
  const oldIdentity=structuredClone(f.s);oldIdentity.publication.basisSha256=f.f.f.f.basis.basisSha256;
  await assert.rejects(assertBuyerPublicationSource(oldIdentity,at,{anchor:oldIdentity.buyer.originalProfile}),/LIVE_SOURCE/);
});

test('accepted facts feed the SAME three-mode whole flow with three human gates and unchanged write limits',async()=>{
  const f=await fixture(undefined,{accepted:true}),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'WHOLE_CYCLE_INDEPENDENTLY_VERIFIED',JSON.stringify({r,events:f.events,
    records:f.records.map(({n,v})=>({n,outcome:v.outcome,phase:v.phase,code:v.code,error:v.error}))}));
  assert.deepEqual(f.writes,['observe','proof','publish','observe','proof','publish']);
  for(const mode of ['Review','RunOnce','Inspect']){
    assert.equal(f.events.filter(e=>e==='dispatch-'+mode).length,1);assert(f.events.includes('human-approval-'+mode));}
  assert.equal(f.outer.policy.approveGithubEnvironment,false);assert.equal(f.outer.limits.appDispatchesMax,3);
  assert.equal(f.outer.cloud.createStackMax,1);assert.equal(r.wholeProductAccepted,false);
});
test('native publication reuses original push/create/execute ordering and stops on unknown without retry',async()=>{
  for(const failure of [null,'create']){
    const {p,m,options,now}=await publicationFixture(),events=[];let layouts=0;
    const step=n=>{events.push(n);if(failure===n)throw Error('SYNTHETIC_UNKNOWN');};
    const layout=()=>{const s=structuredClone(options.baseline);s.main=m.objects.caller.commit;if(++layouts>=3){
      s.foundation.template=JSON.parse(m.actions.create.TemplateBody);s.iam.trust=s.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;}return s;};
    const io={assertLocal:async()=>{},preflight:async()=>options.baseline,consume:async()=>step('slot'),record:async()=>{},
      push:async()=>step('push'),verifyWorkflows:async()=>[],layout:async()=>layout(),create:async()=>{step('create');return {id:'synthetic'};},
      waitChangeSet:async()=>step('verify'),execute:async()=>step('execute'),waitFoundation:async()=>step('wait'),fastForward:async()=>step('ff')};
    const r=await publishAppOnceV6({manifest:m,approved:m.manifestSha256,io,now,profile:p});
    assert.deepEqual(events,failure?['slot','push','create']:['slot','push','create','verify','execute','wait','ff']);
    assert.equal(r.retryAllowed,false);assert.equal(r.workflowDispatched,false);
    assert.equal(r.outcome,failure?'APP_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY':'APP_WORKFLOWS_AND_TRUST_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  }
});
for(const accepted of [false,true])for(const wrongVersion of [false,true])test('production buyer bootstrap uses exact OIDC/SDK ports and fixed Secret guard (accepted='+accepted+', wrong version='+wrongVersion+')',async()=>{
  const f=await publicationFixture({accepted}),source=structuredClone(f.p.sourceTemplate()),p=f.s.publication,
    env={...f.f.f.env,GITHUB_SHA:p.sourceCommit,TECHLONG_FROZEN_SOURCE_COMMIT:p.frozenSourceCommit,
      TECHLONG_REUSABLE_COMMIT:p.release.reusableCommit,TECHLONG_PLATFORM_CLOSURE_SHA:p.release.closureSha256,
      TECHLONG_PLATFORM_RELEASE_STATE:'PUBLISHED',TECHLONG_APP_IDENTITY_PROOF_SHA:p.release.identityProofSha256,
      TECHLONG_INPUT_INSTALLATION:canonicalJson(INSTALLATION),
      ACTIONS_ID_TOKEN_REQUEST_URL:'https://test.actions.githubusercontent.com/id-token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic-oidc-request'},
    at=f.now(),events=[],runId=env.GITHUB_RUN_ID,
    who={Account:'402010193138',UserId:CLOUD_V6.roleId+`:Deploy-${runId}-1`,
      Arn:`arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${runId}-1`},
    claims={iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',sub:CLOUD_V6.oidcSubject,
      repository:env.GITHUB_REPOSITORY,repository_id:env.GITHUB_REPOSITORY_ID,repository_owner_id:env.GITHUB_REPOSITORY_OWNER_ID,
      actor_id:env.GITHUB_ACTOR_ID,actor:env.GITHUB_ACTOR,ref:'refs/heads/main',sha:env.GITHUB_SHA,workflow_ref:env.GITHUB_WORKFLOW_REF,
      workflow_sha:env.GITHUB_SHA,runner_environment:'github-hosted',event_name:'workflow_dispatch',run_id:runId,run_attempt:'1',
      environment:CLOUD_V6.environment,job_workflow_ref:`veinyyxy/TechlongSoftware/.github/workflows/${CLOUD_V6.reusableWorkflow}@${p.release.reusableCommit}`,
      job_workflow_sha:p.release.reusableCommit,exp:Math.floor(at/1000)+300,nbf:Math.floor(at/1000)-1};
  const date=mock.method(Date,'now',()=>at),fetch=mock.method(globalThis,'fetch',async url=>{
    assert.equal(new URL(url).hostname,'test.actions.githubusercontent.com');events.push('oidc');
    return new Response(JSON.stringify({value:'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic-signature'}),{status:200});}),
    sts=mock.method(STSClient.prototype,'send',async command=>{
      events.push(command.constructor.name);if(command.constructor.name==='AssumeRoleWithWebIdentityCommand'){
        assert.equal(command.input.RoleArn,CLOUD_V6.roleArn);return {Credentials:{AccessKeyId:'ASIA'+'A'.repeat(16),SecretAccessKey:'synthetic',
          SessionToken:'synthetic',Expiration:new Date(at+3600000)}};}return who;}),
    s3=mock.method(S3Client.prototype,'send',async command=>{
      assert.equal(command.constructor.name,'GetObjectCommand');events.push('get');const ref=command.input.Key===p.packageReference.key?p.packageReference:INSTALLATION;
      assert.equal(command.input.Key,ref.key);assert.equal(command.input.VersionId,ref.versionId);
      const value=ref===INSTALLATION?f.f.f.dependencies.installation:f.f.bundle,text=canonicalJson(value);
      return {VersionId:ref.versionId,ServerSideEncryption:'AES256',ContentLength:Buffer.byteLength(text),Body:{transformToWebStream:()=>new Response(text).body}};}),
    secret=mock.method(SecretsManagerClient.prototype,'send',async command=>{
      events.push('secret');assert.equal(command.input.VersionId,f.f.f.dependencies.installation.databaseSecret.versionId);
      if(wrongVersion)return {VersionId:'wrong'};throw Error('SYNTHETIC_END_TO_END_SECRET_STOP');});
  try{
    await assert.rejects(runBuyerLive(env,f.f.f.closure,{source,anchor:f.options.source.buyer.originalProfile}),
      wrongVersion?/DATABASE_SECRET_FIXED_VERSION/:/SYNTHETIC_END_TO_END_SECRET_STOP/);
    assert.deepEqual(events,['oidc','AssumeRoleWithWebIdentityCommand','GetCallerIdentityCommand','get','get','GetCallerIdentityCommand','secret']);
  }finally{secret.mock.restore();s3.mock.restore();sts.mock.restore();fetch.mock.restore();date.mock.restore();}
});
