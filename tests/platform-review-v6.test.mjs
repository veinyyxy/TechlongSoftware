import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {R,makeReviewPublicationV6,verifyReviewPublicationV6,publishReviewOnceV6,assertHeldObservationV6,rebuildLineageV6} from '../ops/platform-review-v6/plan.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
const at=Date.parse('2026-10-20T21:00:00Z');
async function review(){return makeReviewPublicationV6({sourceCommit:'f'.repeat(40),createdAt:at,
  ci:{sourceCommit:'f'.repeat(40),attempt:1,status:'completed',conclusion:'success'},
  pins:Array.from({length:18},(_,i)=>({file:'synthetic-'+i,sha256:'b'.repeat(64)})),
  auth:{contentRead:false,length:500,aclSha256:'c'.repeat(64)},receipts:Array.from({length:3},(_,i)=>({path:'synthetic-'+i,rawSha256:'d'.repeat(64)}))});}
test('48-hour operator approval binds one exact held job and immutable historical references, never a dispatch',async()=>{
  const m=await review();await verifyReviewPublicationV6(m,m.manifestSha256,at);assert.equal(m.expiresAt-at,48*3600000);
  assert.equal(m.scope.jobId,R.jobId);assert.equal(m.effects.ownerPlanWritesMax,1);assert.equal(m.effects.conditionalLineagePutsMax,1);
  for(const k of ['appPrivateKeyReads','secretValueReads','appTokens','dispatches','jobClaims','workloadCreates'])assert.equal(m.effects[k],0);
  for(const patch of [{sourceCommit:'a'.repeat(40)},{scope:{...R,jobId:R.priorJobId}},{effects:{...m.effects,dispatches:1}},
    {auth:{...m.auth,contentRead:true}},{extra:true}])await assert.rejects(verifyReviewPublicationV6({...m,...patch},m.manifestSha256,at));
  await assert.rejects(verifyReviewPublicationV6(m,'wrong',at));await assert.rejects(verifyReviewPublicationV6(m,m.manifestSha256,m.expiresAt));
  await assert.rejects(verifyReviewPublicationV6(m,m.manifestSha256,at-1));
});
async function runner(){const m=await review(),f=await platformFixtureV6(),events=[],records=new Map();let used=false,fail,clock=at;
  const job=structuredClone(f.observed.job),payload=JSON.parse(job.payload);payload.requestId='95ac9490ecf4698d001cb05acea3b11219116c65e7375b6b6b190b5eae2bd2f6';
  job.id=R.jobId;job.dedupe_key='express-initialized-v2:'+payload.requestId;job.payload=canonicalJson(payload);
  const observed={...f.observed,job,jobs:[...f.observed.jobs.filter(j=>j.id!==f.observed.job.id),structuredClone(job)],checkedAt:at};
  // The underlying existing publisher still performs real public context and
  // job admission here; no production I/O is involved.
  job.created_at=at-2000;job.updated_at=at-2000;payload.requestedAt=at-3000;job.payload=canonicalJson(payload);
  observed.jobs[observed.jobs.length-1]=structuredClone(job);observed.snapshot.subscription.current_period_end=at+86400000;
  const ref={key:R.lineageKey,versionId:'synthetic-version',sha256:await sha256Hex([])};
  const step=n=>{events.push(n);if(fail===n)throw Error('SENSITIVE_PROVIDER_DETAIL');};
  const db={assertEmpty:async()=>step('empty'),readHeldJob:async()=>{step('held');return structuredClone(observed);},
    writeOwner:async q=>{step('sql');f.writes.push(q);},dispose:async()=>step('db-close')};
  const io={assertSource:async()=>step('source'),preflight:async()=>step('identity'),claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    readAuth:async()=>{step('auth');return 'synthetic-owner';},open:async()=>{step('open');return db;},assertHeld:async()=>step('held-check'),
    lineage:async()=>{step('lineage-verify');return [];},putLineage:async()=>{step('put');return ref;},
    readObject:async r=>{step('get');return {value:r.key===ref.key?[]:f.installation,versionId:r.versionId,encryption:'AES256',contentLength:100};},
    record:async(n,v)=>{step(n);records.set(n,v);},dispose:async()=>step('close')};
  return {m,f,io,events,records,run:()=>publishReviewOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock}),
    fail:n=>{fail=n;},tick:n=>{clock+=n;}};
}
test('existing publisher reconstructs one Review plan: slot before owner read, verified lineage before conditional put, one SQL after put',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'REVIEW_PLAN_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('auth'));assert.ok(f.events.indexOf('lineage-verify')<f.events.indexOf('put'));
  assert.ok(f.events.indexOf('put')<f.events.indexOf('sql'));assert.equal(f.f.writes.length,1);
  assert.equal(f.f.writes[0].text,'SELECT deployment_control_v6.publish_plan($1,$2,$3,$4::jsonb)');
  assert.equal(r.dispatches,0);assert.equal(r.executionApproved,false);assert.equal(f.records.get('proposed-plan').plan.mode,'Review');
  assert.equal(f.records.get('proposed-plan').plan.expiresAt-at,7200000);await assert.rejects(f.run());assert.equal(f.f.writes.length,1);
});
test('every private/read/write failure preserves the permanent attempt and never retries, compensates or prints provider detail',async()=>{
  for(const phase of ['auth','open','empty','held-check','lineage-verify','put','lineage-reference','get','proposed-plan','sql']){
    const f=await runner();f.fail(phase);const r=await f.run();assert.equal(r.outcome,'REVIEW_PUBLICATION_PARTIAL_OR_UNKNOWN_NO_RETRY',phase);
    assert.doesNotMatch(JSON.stringify(r),/SENSITIVE_PROVIDER_DETAIL/);assert.equal(f.events.filter(x=>x==='auth').length,1);
    assert.ok(f.events.filter(x=>x==='put').length<=1);assert.ok(f.events.filter(x=>x==='sql').length<=1);
    assert.ok(f.events.includes('close'));await assert.rejects(f.run());
  }
});
test('expired or wrong approval stops before credential discovery; stale publication never restamps an old plan',async()=>{
  const f=await runner();await assert.rejects(publishReviewOnceV6({manifest:f.m,approved:'wrong',io:f.io,now:()=>at}));assert.equal(f.events.length,0);
  f.tick(48*3600000);await assert.rejects(f.run());assert.equal(f.events.length,0);
  const q=await runner();q.io.putLineage=async()=>{q.tick(120001);return {key:R.lineageKey,versionId:'synthetic',sha256:'e'.repeat(64)};};
  assert.equal((await q.run()).outcome,'REVIEW_PUBLICATION_PARTIAL_OR_UNKNOWN_NO_RETRY');assert.equal(q.f.writes.length,0);
});
test('missing or changed historical receipt cannot become a new trusted predecessor',async()=>{
  const f=await platformFixtureV6();await assert.rejects(rebuildLineageV6({observed:f.observed,manifest:f.manifest,provider:{},inspect:{},capsule:f.capsule}));
});
test('safe row fence compares canonical W6l digests, permits no held-row/old-job/administrator drift',async()=>{
  const f=await runner(),o=await f.io.open().then(db=>db.readHeldJob(R.jobId));
  const prior={...o.jobs[0],id:R.priorJobId};o.jobs.push(prior);const safe=j=>({...Object.fromEntries(['id','deployment_id','job_type','status','attempts','max_attempts','available_at','created_at','updated_at','completed_at'].map(k=>[k,j[k]])),
    payload:typeof j.payload==='string'?JSON.parse(j.payload):j.payload,leasePresent:j.lease_token!==null||j.lease_owner!==null||j.lease_expires_at!==null});
  const snap={...o.snapshot,predecessorJob:prior};const b={adminId:o.requester.id,
    snapshotRows:await Promise.all(Object.entries(snap).sort(([a],[b])=>a.localeCompare(b)).map(async([name,v])=>({name,sha256:await sha256Hex(v)}))),
    oldJobs:await Promise.all(o.jobs.filter(j=>j.id!==R.jobId).sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>({id:j.id,status:j.status,leasePresent:safe(j).leasePresent,rowSha256:await sha256Hex(safe(j))}))),
    target:{rowSha256:await sha256Hex(safe(o.job))}};
  await assertHeldObservationV6(o,b);
  for(const mutate of [x=>{x.job.attempts=1;},x=>{x.jobs[0].status='running';},x=>{x.requester.status='disabled';},x=>{x.snapshot.deployment.status='changed';},x=>{x.job.lease_token='synthetic-non-null';}]){
    const v=structuredClone(o);mutate(v);await assert.rejects(assertHeldObservationV6(v,b));}
});
test('operator entry has no App key/Secret/dispatch/workload commands, only conditional lineage Put and original owner publisher',async()=>{
  const t=await readFile(new URL('../ops/platform-review-v6/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(t,/GetSecretValueCommand|createPrivateKey|CreateStackCommand|workflow_dispatch|approve_and_dispatch/);
  assert.match(t,/IfNoneMatch:'\*'/);assert.match(t,/read_only|READ ONLY/);assert.match(t,/ignoreConfiguredEndpointUrls:true/);
});
