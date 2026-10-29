// Synthetic integration of the original compilers/root/bridge, never private
// archives, credentials, live endpoints or a newly registered production job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cycleCloudClosure} from '../ops/platform-reviewed-cycle-v1/closure.mjs';
import {BUYER_SOURCE,BUYER_ORIGINS,BUYER_CAPSULE_SHA256,prepareBuyerCompatibility,runBuyerCompatibility} from '../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {assertCloudManifestV5,createCloudWorkerRootV5} from '../ops/cloud-worker/cloud-worker-root-v5.mjs';
import {prepareCloudContextV5} from '../ops/cloud-worker/cloud-context-v5.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';

import {buyerFixture as fixture} from './fixtures/buyer-compatibility-v1.mjs';

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
