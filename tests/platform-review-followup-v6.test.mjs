import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cloudRootFixtureV5} from './fixtures/cloud-worker-root-v5.mjs';
import {J,makeFollowupPublication,verifyFollowupPublication,assertFollowupHeld,reconstructFollowupLineage,validateFollowupPlan,publishFollowupOnce} from '../ops/platform-review-v6/followup.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
const at=Date.parse('2026-10-23T23:45:00Z'),admin='usr_4dcd0a09821fde2bb1801f58';
async function fixture(){const f=await cloudRootFixtureV5(at),job=structuredClone(f.observed.job),requestId='c99ca0cb30620d6f3ccc47dee1d6287ee3c9489531fd750db41d127182be7730';
  job.id=J.jobId;job.dedupe_key='express-initialized-v2:'+requestId;
  job.payload=canonicalJson({...JSON.parse(job.payload),requestId,requestedByUserId:admin});
  const old=Array.from({length:6},(_,i)=>({...structuredClone(f.observed.jobs[1]),id:i===0?J.priorJobId:'job_'+String(i).repeat(24)}));
  const o={snapshot:f.observed.snapshot,job,jobs:[...old,structuredClone(job)],requester:{id:admin,status:'active',is_platform_admin:1},checkedAt:at};
  const safe=j=>({...Object.fromEntries(['id','deployment_id','job_type','status','attempts','max_attempts','available_at','created_at','updated_at','completed_at'].map(k=>[k,j[k]])),
    payload:typeof j.payload==='string'?JSON.parse(j.payload):j.payload,leasePresent:j.lease_token!==null||j.lease_owner!==null||j.lease_expires_at!==null});
  const baseline={adminId:admin,snapshotRows:await Promise.all(Object.entries({...o.snapshot,predecessorJob:old[0]}).sort(([a],[b])=>a.localeCompare(b)).map(async([name,v])=>({name,sha256:await sha256Hex(v)}))),
    oldJobs:await Promise.all(old.sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>({id:j.id,status:j.status,leasePresent:false,rowSha256:await sha256Hex(safe(j))}))),
    target:{id:J.jobId,status:'pending',attempts:0,leasePresent:false,cloudExecutionAuthorized:false,rowSha256:await sha256Hex(safe(job))}};
  const ref=(key,sha='b'.repeat(64))=>({key:'worker-v5/'+S.appInstanceId+'/'+key,versionId:'fixture-version',sha256:sha});
  const references={installation:ref('installation/'+B.platform.installationSha256+'.json'),manifest:ref('fixture/manifest.json'),
    priorLineage:ref('lineage/fixture.json'),provider:ref('fixture/provider-after.json'),inspect:ref('fixture/inspect.json')};
  const sourceCommit='a'.repeat(40),m=await makeFollowupPublication({sourceCommit,pins:Array.from({length:16},(_,i)=>({file:'fixture-'+i,sha256:'b'.repeat(64)})),
    ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},auth:{contentRead:false,length:300,aclSha256:'c'.repeat(64)},baseline,references,
    receipts:Array.from({length:3},(_,i)=>({path:'fixture-'+i,rawSha256:'d'.repeat(64)})),createdAt:at,
    compatibility:{executionSourceCommit:sourceCommit,imageSourceCommit:J.imageSourceCommit,protectedRuntimeCodeUnchanged:true,cloudClosureSha256:B.platform.closureSha256}});
  return {m,o,f,reference:{key:J.lineageKey,sha256:J.lineageSha256,versionId:'fixture-version'}};
}
async function plan(m,reference){return {schema:'techlong/platform-controller-plan/v6',instanceId:S.appInstanceId,deploymentId:S.deploymentId,
  jobId:J.jobId,mode:'Review',sourceCommit:m.runtimeSourceCommit,releaseSha256:await sha256Hex(B.platform),riskSha256:B.platform.riskSha256,
  preparedAt:at,expiresAt:at+7200000,predecessor:null,inputs:{mode:'Review',job:J.jobId,installation:canonicalJson(m.references.installation),
    lineage:canonicalJson(reference),manifest:'',manifestSha:'',execution:''}};}
async function runner(){const f=await fixture(),events=[];let used=false,fail,clock=at;
  const step=n=>{events.push(n);if(fail===n)throw Error('SENSITIVE_PROVIDER_DETAILS');};
  const db={assertEmpty:async()=>step('empty'),readHeldJob:async()=>{step('held');return f.o;},dispose:async()=>step('db-close')};
  const io={assertSource:async()=>step('source'),preflight:async()=>step('preflight'),claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    readAuth:async()=>{step('auth');return 'SYNTHETIC_OWNER_URL';},open:async()=>{step('open');return db;},assertHeld:o=>assertFollowupHeld(o,f.m.baseline,clock),
    lineage:async()=>{step('lineage');return [];},putLineage:async()=>{step('put');return f.reference;},
    publishReview:async({reference,guard})=>{step('publisher');const v=await validateFollowupPlan(await plan(f.m,reference),f.m,reference);await guard();step('sql');return v;},
    record:async(n,v)=>{step('record-'+n);assert.doesNotMatch(JSON.stringify(v),/SYNTHETIC_OWNER_URL|SENSITIVE_PROVIDER_DETAILS/);},dispose:async()=>step('close')};
  return {...f,io,events,fail:n=>{fail=n;},tick:n=>{clock+=n;},run:()=>publishFollowupOnce({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>clock})};
}
test('48h review binds execution to main, with separate immutable image provenance and unchanged runtime proof',async()=>{
  const {m}=await fixture();await verifyFollowupPublication(m,m.manifestSha256,at);assert.equal(m.expiresAt-at,48*3600000);
  assert.equal(m.sourceCommit,m.runtimeSourceCommit);assert.notEqual(m.sourceCommit,m.imageSourceCommit);assert.equal(m.imageSourceCommit,J.imageSourceCommit);
  assert.equal(m.effects.s3GetMax,7);assert.equal(m.effects.ownerPlanWritesMax,1);assert.equal(m.effects.conditionalLineagePutsMax,1);
  for(const patch of [{runtimeSourceCommit:J.imageSourceCommit},{scope:{...J,jobId:J.priorJobId}},{effects:{...m.effects,dispatches:1}},{extra:true}])
    await assert.rejects(verifyFollowupPublication({...m,...patch},m.manifestSha256,at));
  await assert.rejects(verifyFollowupPublication(m,'wrong',at));await assert.rejects(verifyFollowupPublication(m,m.manifestSha256,m.latestStartAt));
});
test('held-row and all nine/six prior row hashes are fenced; old canceled history cannot silently change',async()=>{
  const {m,o}=await fixture();await assertFollowupHeld(o,m.baseline,at);
  for(const change of [x=>{x.job.attempts=1;},x=>{x.job.lease_token='not-null';},x=>{x.jobs[0].status='canceled';},
    x=>{x.snapshot.deployment.status='changed';},x=>{x.requester.status='disabled';}]){
    const changed=structuredClone(o);change(changed);await assert.rejects(assertFollowupHeld(changed,m.baseline,at));}
});
test('plan must use reviewed main, not image producer; exact lineage/version/install references remain required',async()=>{
  const {m,reference}=await fixture(),p=await plan(m,reference);await validateFollowupPlan(p,m,reference);
  for(const patch of [{sourceCommit:J.imageSourceCommit},{jobId:J.priorJobId},{mode:'RunOnce'}])await assert.rejects(validateFollowupPlan({...p,...patch},m,reference));
  await assert.rejects(validateFollowupPlan(p,m,{...reference,sha256:'e'.repeat(64)}));
});
test('slot precedes owner read; lineage conditional put precedes one publisher SQL; no dispatch capability',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'FOLLOWUP_REVIEW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('auth'));assert.ok(f.events.indexOf('lineage')<f.events.indexOf('put'));
  assert.ok(f.events.indexOf('put')<f.events.indexOf('sql'));assert.equal(r.runtimeSourceCommit,f.m.sourceCommit);assert.equal(r.dispatches,0);
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='sql').length,1);
});
test('partial/unknown actions never replay, reset or leak provider details',async()=>{
  for(const name of ['auth','open','empty','lineage','put','record-lineage-reference','publisher','sql']){
    const f=await runner();f.fail(name);const r=await f.run();assert.equal(r.outcome,'FOLLOWUP_REVIEW_PARTIAL_OR_UNKNOWN_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert.doesNotMatch(JSON.stringify(r),/SENSITIVE_PROVIDER_DETAILS/);
    assert.ok(f.events.filter(n=>n==='put').length<=1);assert.ok(f.events.filter(n=>n==='sql').length<=1);assert.ok(f.events.includes('close'));}
});
test('operation deadline prevents SQL after an acknowledged lineage write; old plans are not restamped',async()=>{
  const f=await runner();f.io.putLineage=async()=>{f.tick(120001);return f.reference;};
  assert.equal((await f.run()).outcome,'FOLLOWUP_REVIEW_PARTIAL_OR_UNKNOWN_NO_RETRY');assert.equal(f.events.includes('sql'),false);
  const expired=await runner();expired.tick(48*3600000);await assert.rejects(expired.run());assert.equal(expired.events.length,0);
});
test('missing latest receipt cannot become a new predecessor; concrete adapter retains original publisher and conditional put',async()=>{
  const {f}=await fixture();await assert.rejects(reconstructFollowupLineage({priorLinks:[],manifest:{},provider:{},inspect:{},receipt:{},capsule:f.capsule}));
  const s=await readFile(new URL('../ops/platform-review-v6/followup-local.mjs',import.meta.url),'utf8');
  assert.match(s,/createTrustedPublisherV6/);assert.match(s,/sourceCommit:m.runtimeSourceCommit/);assert.match(s,/IfNoneMatch:'\*'/);
  assert.ok(s.indexOf('validateFollowupPlan(JSON.parse(q.values[3])')<s.indexOf('await db.writeOwner(q)'));
  assert.doesNotMatch(s,/GetSecretValueCommand|createPrivateKey|CreateStackCommand|UpdateStackCommand|workflow_dispatch|approve_and_dispatch/);
});
