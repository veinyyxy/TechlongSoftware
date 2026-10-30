// Synthetic integration of the original compilers/root/bridge, never private
// archives, credentials, live endpoints or a newly registered production job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cycleCloudClosure} from '../ops/platform-reviewed-cycle-v1/closure.mjs';
import {BUYER_SOURCE,BUYER_ORIGINS,BUYER_CAPSULE_SHA256,BUYER_TASK_HASHES,bindBuyerTaskHashes,prepareBuyerCompatibility,runBuyerCompatibility} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {cloudTaskProjectionV5} from '../ops/cloud-worker/aws-initialized-workload-v5.mjs';
import {assertCloudManifestV5,createCloudWorkerRootV5} from '../ops/cloud-worker/cloud-worker-root-v5.mjs';
import {prepareCloudContextV5} from '../ops/cloud-worker/cloud-context-v5.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';

import {buyerFixture as fixture} from './fixtures/buyer-compatibility-v1.mjs';

// Synthetic full task projections, not archived business/runtime/secret values.
async function hashPhaseFixture(){
  const before={family:'synthetic-buyer-task',futureField:{retain:true},containerDefinitions:[{
    name:'app',image:'fixture@sha256:'+ 'a'.repeat(64),environment:[{name:'CORS_ALLOWED_ORIGINS',value:'https://old.example'},
      {name:'UNCHANGED',value:'fixture'}],secrets:[{name:'FIXTURE_SECRET',valueFrom:'arn:fixture-reference-only'}]}]},
    after=structuredClone(before);after.containerDefinitions[0].environment[0].value='https://old.example,https://buyer.example';
  const hashes={predecessor:await sha256Hex(cloudTaskProjectionV5(before)),created:await sha256Hex(cloudTaskProjectionV5(after))},
    base={expectedTaskSha256:hashes.predecessor,keep:{unchanged:true}},events=[],state={before,after,saveFailure:null,pause:null};
  let entered=false,created=0,disposed=0,constructed=0,scoped;
  const check=async(definition)=>{const actual=await sha256Hex(cloudTaskProjectionV5(definition));
    events.push(scoped.expectedTaskSha256);assert.equal(actual,scoped.expectedTaskSha256,'full projection mismatch');return actual;};
  const provider=bindBuyerTaskHashes(base,hashes,b=>{scoped=b;constructed++;return {
    readCell:async()=>({unchanged:true}),inspectBefore:()=>check(state.before),inspectAfter:()=>check(state.after),
    bindOnce(_w,_p,consume,save){return {async executeOnce(){
      assert.equal(entered,false,'one execution only');entered=true;await check(state.before);
      await save('provider-before.json',{});await consume('create_workload','fixture');created++;
      await save('create-ack.json',{stackId:'fixture-stack'});if(state.pause)await state.pause;
      await check(state.after);await save('provider-after.json',{});return {stackId:'fixture-stack'};
    }};},counts:()=>({createCalls:created}),dispose:()=>{disposed++;},
  };});
  const save=async(name)=>{events.push(name);if(state.saveFailure===name)throw Error('fixture save failed');};
  return {provider,base,hashes,state,events,scoped:()=>scoped,constructed:()=>constructed,disposed:()=>disposed,
    bind:()=>provider.bindOnce({}, {},async()=>events.push('consume'),save)};
}

test('buyer task pins are explicit source-bound old/new projections, historical capsule remains unchanged',async()=>{
  const f=await fixture();assert.equal(f.compat.context.base.expectedTaskSha256,BUYER_TASK_HASHES.predecessor);
  assert.notEqual(BUYER_TASK_HASHES.predecessor,BUYER_TASK_HASHES.created);
  assert(Object.isFrozen(BUYER_TASK_HASHES));assert.deepEqual(f.events,[]);
});

test('same frozen provider checks old before create and new after persisted ACK; no extra executor or read',async()=>{
  const f=await hashPhaseFixture(),original=canonicalJson(f.base),binding=f.bind();
  assert.equal(f.constructed(),1);assert.equal(f.provider.counts().createCalls,0);
  await binding.executeOnce({});
  assert.deepEqual(f.events,[f.hashes.predecessor,'provider-before.json','consume','create-ack.json',f.hashes.created,'provider-after.json']);
  assert.equal(f.provider.counts().createCalls,1);assert.equal(canonicalJson(f.base),original);
  assert.throws(()=>f.scoped().expectedTaskSha256,/TASK_HASH_PHASE_REQUIRED/);
  await assert.rejects(binding.executeOnce({}),/one execution only/);
  assert.throws(()=>f.bind(),/TASK_HASH_BIND_ONCE/);f.provider.dispose();assert.equal(f.disposed(),1);
});

test('independent created-task Inspect selects new hash with zero creates; predecessor still requires old',async()=>{
  const f=await hashPhaseFixture();assert.equal(await f.provider.inspectAfter(),f.hashes.created);
  assert.equal(await f.provider.inspectBefore(),f.hashes.predecessor);assert.equal(f.provider.counts().createCalls,0);
  f.state.before=structuredClone(f.state.after);await assert.rejects(f.provider.inspectBefore(),/full projection mismatch/);
});

test('buyer hash phases still reject image, env, secret reference, CORS and unknown-field drift',async()=>{
  const f=await hashPhaseFixture(),original=structuredClone(f.state.after);
  for(const mutate of [d=>{d.containerDefinitions[0].image='different';},d=>{d.containerDefinitions[0].environment[1].value='changed';},
    d=>{d.containerDefinitions[0].secrets[0].valueFrom='different-reference';},d=>{d.containerDefinitions[0].environment[0].value='https://attacker.example';},
    d=>{d.futureField.retain=false;},d=>{d.unknownAdditionalField=true;}]){
    f.state.after=structuredClone(original);mutate(f.state.after);await assert.rejects(f.provider.inspectAfter(),/full projection mismatch/);
  }
  f.state.after=original;assert.equal(await f.provider.inspectAfter(),f.hashes.created);
});

test('failed ACK persistence cannot advance task hash, authorize a retry or leak a phase',async()=>{
  const f=await hashPhaseFixture();f.state.saveFailure='create-ack.json';const binding=f.bind();
  await assert.rejects(binding.executeOnce({}),/fixture save failed/);
  assert(!f.events.includes(f.hashes.created));assert.throws(()=>f.scoped().expectedTaskSha256,/TASK_HASH_PHASE_REQUIRED/);
  await assert.rejects(binding.executeOnce({}),/one execution only/);assert.equal(f.provider.counts().createCalls,1);
});

test('concurrent observation cannot change the pin during a bound execution',async()=>{
  const f=await hashPhaseFixture();let release,acked;
  f.state.pause=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{acked=resolve;});
  const binding=f.provider.bindOnce({}, {},async()=>{},async name=>{if(name==='create-ack.json')acked();});
  const running=binding.executeOnce({});await ready;
  try{await assert.rejects(f.provider.inspectBefore(),/TASK_HASH_PHASE_REENTRY/);}
  finally{release();}await running;assert.equal(f.provider.counts().createCalls,1);
});

test('wrong predecessor pin or malformed phase binding fails before creating a provider',()=>{
  let creations=0;const create=()=>{creations++;};
  for(const hashes of [null,{}, {...BUYER_TASK_HASHES,extra:true},{...BUYER_TASK_HASHES,created:BUYER_TASK_HASHES.predecessor},
    {...BUYER_TASK_HASHES,created:'invalid'}])
    assert.throws(()=>bindBuyerTaskHashes({expectedTaskSha256:BUYER_TASK_HASHES.predecessor},hashes,create),/TASK_HASH_BINDING/);
  assert.throws(()=>bindBuyerTaskHashes({expectedTaskSha256:'0'.repeat(64)},BUYER_TASK_HASHES,create),/TASK_HASH_BINDING/);
  assert.equal(creations,0);
});

test('default SOURCE is closed before basis, credentials, configuration or any port',async()=>{
  assert.equal(BUYER_SOURCE,null);
  await assert.rejects(prepareBuyerCompatibility({}),/SOURCE_NOT_CONFIGURED/);
  await assert.rejects(runBuyerCompatibility({}),/SOURCE_NOT_CONFIGURED/);
});
test('exact buyer adapter preserves the original material/root/control and accepted predecessor',async()=>{
  const f=await fixture(),original=await prepareCloudContextV5(f.f.capsule);
  assert.equal(f.compat.context.capsuleSha256,BUYER_CAPSULE_SHA256);
  assert.equal(f.compat.context.publicParameters.CorsAllowedOrigins,BUYER_ORIGINS);
  assert.deepEqual(f.compat.context.root.material,original.root.material);
  assert.deepEqual(f.compat.context.controlFingerprints,original.controlFingerprints);
  assert.deepEqual(f.compat.context.predecessor,f.source.predecessor);
  assert.equal(f.compat.context.executionAuthorized,false);
  await assert.rejects(prepareCloudContextV5(f.capsule),/PUBLIC_CAPSULE_HASH/);
});
test('same SOURCE compiles the original single INSERT with no old-row change or execution',async()=>{
  const f=await fixture(),before=canonicalJson(f.state),request=await f.compat.prepareRequest(f.state);
  assert.deepEqual(request,f.request);assert.equal(canonicalJson(f.state),before);
  assert.equal((request.program.text.match(/INSERT INTO/g)||[]).length,1);
  assert.doesNotMatch(request.program.text,/UPDATE public\.|DELETE|ALTER/);
  assert.equal(request.program.payload.cloudExecutionAuthorized,false);
  assert.equal(request.program.values[4],Number.MAX_SAFE_INTEGER);assert.deepEqual(f.events,[]);
});
test('actual V5 Review and full template reconstruction accept three origins with seven unchanged resource types',async()=>{
  const f=await fixture(),root=await f.compat.openRoot(f.dependencies),r=await root.review({jobId:f.source.request.jobId});
  await assertCloudManifestV5(r.manifest,{code:f.source.code,installation:f.f.installation,context:f.compat.context,contract:f.contract});
  assert.equal(r.manifest.publicCapsuleSha256,BUYER_CAPSULE_SHA256);
  assert.equal(r.manifest.workload.resourceInventory.length,7);
  const oldContext={...f.compat.context,capsuleSha256:f.f.capsule.capsuleSha256,publicParameters:f.f.context.publicParameters};
  const oldReview=await createCloudWorkerRootV5({...f.dependencies,context:oldContext,now:f.options.now}).review({jobId:f.source.request.jobId});
  const before=oldReview.manifest.workload,after=r.manifest.workload;
  assert.deepEqual(after.template,before.template);assert.deepEqual(after.resourceInventory,before.resourceInventory);
  const restored=structuredClone(after.parameters);restored.CorsAllowedOrigins=before.parameters.CorsAllowedOrigins;
  assert.deepEqual(restored,before.parameters);
  assert.notEqual(after.requestSha256,before.requestSha256);
  assert.match(canonicalJson(r.manifest.workload),/buyer\.sandbox\.techlong\.cloud/);
  assert.equal(r.cloudDeploymentCalls,0);assert.deepEqual(f.events,['database','manifest.json','database','manifest.json']);
  await assert.rejects(root.review({jobId:f.source.request.jobId}),/ROOT_MODE_ONCE/);
});
test('candidate cloud entry uses the SAME SOURCE and real V6 mode bridge, not another executor',async()=>{
  const f=await fixture(),r=await runBuyerCompatibility({...f.options,env:f.env,binding:f.binding,closure:f.closure,ports:f.ports,dependencies:f.dependencies});
  assert.equal(r.jobId,f.source.request.jobId);assert.equal(r.outcome,'REVIEW_PREPARED_NOT_APPROVED');
  assert.deepEqual(f.events,['database','manifest.json','result']);
});
test('forged basis, skipped/changed independent lineage, predecessor, CORS or other material fail closed',async()=>{
  const f=await fixture();
  await assert.rejects(prepareBuyerCompatibility({...f.options,basis:structuredClone(f.f.basis)}),/UNVERIFIED_OR_EXPIRED_BASIS/);
  for(const patch of [{links:[]},{links:[{...f.links[0],inspect:{...f.links[0].inspect,outcome:'NOT_ACCEPTED'}}]},
    {source:{...f.source,predecessor:{...f.source.predecessor,receiptSha256:'0'.repeat(64)}}}])
    await assert.rejects(prepareBuyerCompatibility({...f.options,...patch}));
  const changed=structuredClone(f.links),{inspectSha256:_old,...ib}=changed[0].inspect;void _old;ib.outcome='NOT_ACCEPTED';
  changed[0].inspect={...ib,inspectSha256:await sha256Hex(ib)};
  await assert.rejects(prepareBuyerCompatibility({...f.options,links:changed,source:{...f.source,linksSha256:await sha256Hex(changed)}}),/SUCCESSOR_LINEAGE_NOT_PROVED/);
  for(const mutate of [c=>{c.publicParameters.CorsAllowedOrigins+=' ,https://attacker.example';},
    c=>{c.controlFingerprints.publicKeySha256='0'.repeat(64);},c=>{c.publicParameters.StripeCancelUrl='https://other.techlong.cloud';}]){
    const capsule=structuredClone(f.capsule);mutate(capsule);const {capsuleSha256:_sha,...body}=capsule;void _sha;
    capsule.capsuleSha256=await sha256Hex(body);await assert.rejects(prepareBuyerCompatibility({...f.options,capsule}),/EXACT_BUYER_MATERIAL/);
  }
});
test('changed full history, used request, active job, approval/code/job override or expiry cannot open an execution path',async()=>{
  const f=await fixture(),changed=structuredClone(f.state);changed.ledger.plans[0].body.sourceCommit='0'.repeat(40);
  await assert.rejects(f.compat.prepareRequest(changed),/FULL_TERMINAL_BASELINE/);
  const root=await f.compat.openRoot(f.dependencies);
  assert.throws(()=>root.review({jobId:f.source.predecessor.jobId}),/EXACT_JOB/);
  assert.throws(()=>root.runOnce({manifest:{jobPlan:{jobId:f.source.predecessor.jobId}}}),/EXACT_JOB/);
  await assert.rejects(f.compat.openRoot({...f.dependencies,context:f.compat.context}),/CLOUD_SOURCE_BINDING/);
  for(const patch of [{GITHUB_SHA:'0'.repeat(40)},{TECHLONG_INPUT_JOB:f.source.predecessor.jobId},{TECHLONG_INPUT_LINEAGE:'{}'}])
    await assert.rejects(runBuyerCompatibility({...f.options,env:{...f.env,...patch},binding:f.binding,closure:f.closure,ports:f.ports,dependencies:f.dependencies}));
  assert.deepEqual(f.events,[]);f.advance(48*3600000);
  await assert.rejects(f.compat.prepareRequest(f.state),/UNVERIFIED_OR_EXPIRED_BASIS/);
});
test('candidate SOURCE cannot lie about request identity, installation, or additive code provenance',async()=>{
  const f=await fixture();
  await assert.rejects(prepareBuyerCompatibility({...f.options,source:{...f.source,request:{...f.source.request,requestId:'1'.repeat(64)}}}),/DETERMINISTIC_REQUEST_SCOPE/);
  await assert.rejects(prepareBuyerCompatibility({...f.options,source:{...f.source,request:{...f.source.request,clientRequestId:'not-a-uuid'}}}),/SOURCE_SCOPE/);
  await assert.rejects(f.compat.openRoot({...f.dependencies,installation:{...f.f.installation,installed:false}}),/INSTALLATION_BINDING_REQUIRED/);
  await assert.rejects(runBuyerCompatibility({...f.options,env:f.env,binding:f.binding,closure:await cycleCloudClosure(),ports:f.ports,dependencies:f.dependencies}),/CLOUD_ENTRY_BINDING/);
  assert.deepEqual(f.events,[]);assert.equal(f.closure.pinCount,111);
});
test('even a SOURCE-matching active row or previously used request cannot compile another INSERT',async()=>{
  const f=await fixture();
  const active=structuredClone(f.state);active.jobs[0].status='running';
  const a=await prepareBuyerCompatibility({...f.options,source:{...f.source,baselineSha256:await sha256Hex(active)}});
  await assert.rejects(a.prepareRequest(active),/FULL_TERMINAL_BASELINE/);
  const used=structuredClone(f.state);used.jobs.push({...used.jobs[0],id:f.source.request.jobId,status:'succeeded',
    payload:structuredClone(f.request.program.payload),dedupe_key:f.request.program.values[2]});
  const b=await prepareBuyerCompatibility({...f.options,source:{...f.source,baselineSha256:await sha256Hex(normalizedState(used))}});
  await assert.rejects(b.prepareRequest(used),/EXACT_SINGLE_INSERT_REQUEST/);assert.deepEqual(f.events,[]);
});
test('old frozen cloud closure remains exactly 110 files and original SHA',async()=>{
  const c=await cycleCloudClosure();assert.equal(c.pinCount,110);
  assert.equal(c.closureSha256,'0c6f119def3b10efe592f559b29d4d8f929893a28dbc77a065c2746052aa308d');
});
