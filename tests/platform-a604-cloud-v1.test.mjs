import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {load} from 'js-yaml';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {createA604Runtime,A604_RUNTIME} from '../ops/platform-a604-cloud-v1/runtime.mjs';
import {createA604Publisher} from '../ops/platform-a604-cloud-v1/control.mjs';
import {a604Runtime} from '../ops/platform-a604-cloud-v1/live.mjs';
import {a604CloudClosure} from '../ops/platform-a604-cloud-v1/closure.mjs';
import {a604CloudWorkflows} from '../ops/platform-a604-cloud-v1/workflows.mjs';
import {A604_PUBLICATION,A604_PROFILE,A604_JOB,HANDOFF} from '../ops/platform-a604-cloud-v1/profile.mjs';
import {assertA604PlanScope,bindA604WorkflowPublication} from '../ops/platform-a604-cloud-v1/contract.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {recoveryData} from '../ops/platform-recovery-v1/basis-core.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
const runtime=f=>createA604Runtime({publication:f.publication,profile:f.profile,now:f.now});

test('production profile records true post-facts without approving a new window or promoting9b',()=>{
  assert.equal(A604_PROFILE.newJobId,A604_JOB);assert.equal(A604_PROFILE.oldJobId,'job_9db8466fd95cef0c23ad6bfc');
  assert.equal(A604_PROFILE.factsAt,1793109984483);assert.equal(A604_PROFILE.databaseCheckedAt,1793109995619);
  assert.equal(HANDOFF.originalBasisExpiresAt,1793126877695);assert.equal(HANDOFF.projectionIsDatabaseSnapshot,false);
  assert.equal(A604_PUBLICATION.state,'UNPUBLISHED');assert.equal(A604_PUBLICATION.factsApproval,null);assert(Object.isFrozen(A604_PROFILE));
});

for(const fault of ['unpublished','facts','profile','oldPackage','job','personalActor','rerun','closure','expired'])
test('cloud '+fault+' refuses before credential/application/evidence ports',async()=>{
  const f=await a604Fixture(),publication=structuredClone(f.publication),env={...f.env},closure={...f.closure};let now=f.at;
  if(fault==='unpublished')publication.state='UNPUBLISHED';if(fault==='facts')publication.factsApproval=null;
  if(fault==='profile')publication.profileSha256='0'.repeat(64);if(fault==='oldPackage')env.TECHLONG_INPUT_LINEAGE=canonicalJson(f.profile.resultReference);
  if(fault==='job')env.TECHLONG_INPUT_JOB='job_9b57b43a6b88f37202b29170';if(fault==='personalActor')env.GITHUB_ACTOR_ID='14145707';
  if(fault==='rerun')env.GITHUB_RUN_ATTEMPT='2';if(fault==='closure')closure.previousRecoveryClosureSha256='0'.repeat(64);
  if(fault==='expired')now=f.profile.factsAt+f.profile.validMs;
  const r=createA604Runtime({publication,profile:f.profile,now:()=>now});
  await assert.rejects(r.run({env,closure,ports:f.ports}));assert.deepEqual(f.events,[]);assert.deepEqual(f.puts,[]);
});

test('serialized basis edits cannot replace complete original execution/retirement reconstruction',async()=>{
  const f=await a604Fixture(),pkg=structuredClone(f.pkg);pkg.basis.disposition.independentAcceptance=true;
  await assert.rejects(runtime(f).run({env:f.env,closure:f.closure,ports:{...f.ports,read:async ref=>
    ref.key===f.pkgRef.key?pkg:f.ports.read(ref)}}));assert(!f.events.includes('open'));
  const g=await a604Fixture(),bad=structuredClone(g.pkg);bad.inputs.state.jobs.find(j=>j.id==='job_9b57b43a6b88f37202b29170').status='succeeded';
  await assert.rejects(runtime(g).rebuild(bad));assert.deepEqual(g.events,[]);
});

test('a604 Review uses the existing admission/root; separate outer evidence and exactly one entry',async()=>{
  const f=await a604Fixture(),r=runtime(f),result=await r.run({env:f.env,closure:f.closure,ports:f.ports});
  assert.equal(result.jobId,A604_JOB);assert.equal(result.outcome,'RECOVERY_REVIEW_PREPARED_NOT_APPROVED');
  assert.notEqual(result.manifestSha256,result.innerManifestSha256);assert.equal(f.puts.length,2);
  assert.equal(f.events.filter(x=>x==='open').length,1);assert.equal(f.events.at(-1),'dispose');
  assert.equal(f.puts[0].value.innerManifest.jobPlan.jobId,A604_JOB);
  assert.equal(f.puts[0].value.basis.execution.jobId,f.profile.oldJobId);
  assert.equal(f.puts[0].value.basis.disposition.acceptedLineageAppend,false);
  await assert.rejects(r.run({env:f.env,closure:f.closure,ports:f.ports}),/MEMORY_ONCE/);assert.equal(f.events.filter(x=>x==='open').length,1);
});

test('unknown outer PUT does not retry Review or fall through to RunOnce',async()=>{
  const f=await a604Fixture();let puts=0;
  await assert.rejects(runtime(f).run({env:f.env,closure:f.closure,ports:{...f.ports,put:async()=>{puts++;throw Error('SYNTHETIC_UNKNOWN_ACK');}}}));
  assert.equal(puts,1);assert.equal(f.events.filter(x=>x==='open').length,1);assert.equal(f.events.at(-1),'dispose');
});

test('source capability rebuilds package and publisher connects Review to RunOnce and independent Inspect content',async()=>{
  const f=await a604Fixture(),entries=new Map(),writes=[],results=[];
  const ports={guard:async()=>{},readObject:f.readObject,readRun:async id=>f.rawRun(id),
    readHeldJob:async()=>structuredClone(f.observed),loadPlan:async sha=>structuredClone(entries.get(sha)),
    writeOwner:async q=>{writes.push(q);if(q.text.includes('attest_evidence'))entries.get(q.values[0]).attempt.proofSha256=q.values[1];
      else{const v=await validatePlan(JSON.parse(q.values[3]),f.release,f.at);entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});}}};
  // The original fixture's readObject retains version, length and SHA metadata.
  const publisher=await createA604Publisher({basis:await runtime(f).rebuild(f.pkg),ports,publication:f.publication,profile:f.profile,now:f.now});
  let plan=await publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef});
  for(const [mode,id] of [['Review','123456797'],['RunOnce','123456798'],['Inspect','123456799']]){
    assert.equal(plan.plan.mode,mode);const env={...f.env,GITHUB_RUN_ID:id,...Object.fromEntries(Object.entries(plan.plan.inputs).map(([k,v])=>['TECHLONG_INPUT_'+k.toUpperCase(),v]))};
    let cloudPorts=f.ports;
    if(mode!=='Review')cloudPorts={...f.ports,open:async()=>({
      runOnce:async({review})=>{const report={schema:'techlong/cloud-worker-run/v5',jobId:A604_JOB,manifestSha256:review.innerManifest.manifestSha256,
        run:f.run(id),result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
        return {report,saved:await f.store(`worker-v5/${plan.plan.instanceId}/${A604_JOB}/${report.manifestSha256}/run-${id}-1/run.json`,report)};},
      inspect:async({review,executionRun})=>{const body={schema:'techlong/cloud-worker-independent-inspect/v5',jobId:A604_JOB,
        manifestSha256:review.innerManifest.manifestSha256,run:f.run(id),executionRun,outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',
        journal:{state:'ALL_SLOTS_CONSUMED'},receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),checkedAt:f.at,
        cloudWrites:0,databaseWrites:0,privateControlReads:0,retryAllowed:false};
        const report={...body,inspectSha256:await sha256Hex(body)};
        return {report,saved:await f.store(`worker-v5/${plan.plan.instanceId}/${A604_JOB}/${body.manifestSha256}/run-${id}-1/inspect.json`,report)};},
      dispose:async()=>{}})};
    const result=await runtime(f).run({env,closure:f.closure,ports:cloudPorts});results.push(result);
    entries.get(plan.planSha256).attempt={state:'OBSERVED',runId:id,status:'completed',conclusion:'success',proofSha256:null};
    const proof=await publisher.attestResult(plan.planSha256,result.saved);assert.equal(proof.jobId,A604_JOB);
    if(mode!=='Inspect')plan=await publisher.publishSuccessor(plan.planSha256,result.saved);
  }
  assert.deepEqual(results.map(r=>r.mode),['Review','RunOnce','Inspect']);assert.equal(results.at(-1).outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');
  assert.equal(writes.length,6);assert.equal(publisher.webLeaseRequired,false);assert.equal(publisher.githubEnvironmentApproval,'human-owner-required');
  assert.equal(publisher.dispatches,0);assert.equal(recoveryData(f.basis,f.at).state.jobs.find(j=>j.id==='job_9b57b43a6b88f37202b29170').status,'canceled');
});

test('default live adapter and publisher reject before all I/O despite publication-like environment strings',async()=>{
  let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('SHOULD_NOT_FETCH');};
  try{await assert.rejects(a604Runtime({TECHLONG_PLATFORM_RELEASE_STATE:'PUBLISHED'},{}),/NOT_PUBLISHED/);
    await assert.rejects(A604_RUNTIME.rebuild({state:'PUBLISHED'}),/NOT_PUBLISHED/);
    await assert.rejects(createA604Publisher({basis:{},ports:{guard:async()=>{calls++;}}}),/NOT_PUBLISHED/);assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});

test('plan scope rejects9b and modified package references',async()=>{
  const f=await a604Fixture(),plan={jobId:A604_JOB,sourceCommit:f.publication.sourceCommit,riskSha256:f.release.riskSha256,
    inputs:{lineage:canonicalJson(f.pkgRef)}};assert.doesNotThrow(()=>assertA604PlanScope(plan,f.publication));
  assert.throws(()=>assertA604PlanScope({...plan,jobId:'job_9b57b43a6b88f37202b29170'},f.publication));
  assert.throws(()=>assertA604PlanScope({...plan,inputs:{lineage:'{}'}},f.publication));
});

test('new closure preserves all97 frozen files and excludes local publisher/credentials',async()=>{
  const old=await recoveryCloudClosure(),c=await a604CloudClosure();assert(c.pinCount>97);assert.equal(c.previousRecoveryClosureSha256,old.closureSha256);
  for(const p of old.pins)assert.deepEqual(c.pins.find(q=>q.file===p.file),p);
  for(const file of ['ops/platform-a604-cloud-v1/control.mjs','ops/platform-a604-handoff-v1/local.mjs','ops/platform-recovery-v1/bridge.mjs'])
    assert(!c.pins.some(p=>p.file===file));
});

test('candidate workflows remain seven-input, commit pinned and human gated without publication',async()=>{
  const f=await a604Fixture(),w=a604CloudWorkflows({...f.release,sourceCommit:f.sourceCommit}),caller=load(w.caller),job=load(w.reusable);
  assert.equal(Object.keys(caller.on.workflow_dispatch.inputs).length,7);assert.equal(job.jobs.single.environment,'techlong-sandbox-deploy');
  assert.equal(caller.concurrency['cancel-in-progress'],false);assert(w.reusable.includes('ops/platform-a604-cloud-v1/live.mjs'));
  assert.equal(w.published,false);assert.equal(w.requiresSeparateFactsWindowApproval,true);
  const command=job.jobs.single.steps.find(s=>typeof s.run==='string'&&s.run.includes('A604_BOOTSTRAP')).run;
  assert(command.includes('"state":"UNPUBLISHED"'));assert(!command.includes('JSON.parse(process.env'));
  const js=command.trim().split('\n').slice(1,-1).join('\n');
  const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:js,encoding:'utf8',windowsHide:true});
  assert.equal(syntax.status,0,syntax.stderr);assert(command.includes('A604_CLOUD_STOPPED_REQUIRES_INSPECT_NO_RETRY'));
});

test('reviewed source descriptor binds only the caller/reusable self-reference slots, not facts, scope or state',async()=>{
  const f=await a604Fixture(),w=a604CloudWorkflows({...f.release,sourceCommit:f.sourceCommit},{publication:f.publication});
  const command=load(w.reusable).jobs.single.steps.find(s=>typeof s.run==='string'&&s.run.includes('A604_BOOTSTRAP')).run;
  const text=command.split('\n').find(l=>l.startsWith('const template = ')),template=JSON.parse(text.slice('const template = '.length,-1));
  assert.equal(template.sourceCommit,null);assert.equal(template.release.reusableCommit,null);assert.equal(template.activation.releaseSha256,null);
  const p=await bindA604WorkflowPublication(template,f.sourceCommit,f.release.reusableCommit);assert.deepEqual(p,f.publication);
  assert.deepEqual(p.factsApproval,f.publication.factsApproval);assert.equal(p.packageReference.key,f.pkgRef.key);
  await assert.rejects(bindA604WorkflowPublication(A604_PUBLICATION,f.sourceCommit,f.release.reusableCommit));
  assert(!command.includes(f.release.reusableCommit));assert(w.caller.includes(f.release.reusableCommit));
});

test('CLI check is closed and has no private/network/SQL side effects',()=>{
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-a604-cloud-v1/run.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.state,'UNPUBLISHED');assert.equal(v.jobId,A604_JOB);
  assert.equal(v.privateReads+v.awsCalls+v.sqlConnections,0);assert.equal(v.executionAuthorized,false);
});
