import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {R,oldReview,makeRefreshReview,verifyRefreshReview,refreshedPlan,assertRefreshLedger,publishRefreshOnce} from '../ops/platform-review-v6/refresh.mjs';
import {refreshFixture,oldReviewFixture,newReviewFixture,ledgerFixture} from './fixtures/platform-review-refresh-v6.mjs';
import {ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
import {makeReview as windowReview,readyReview} from '../ops/platform-hosted-window-v6/contract.mjs';

async function runner(){const f=await refreshFixture(),events=[],records={};let time=f.at,used=false,fail=null;
  const step=n=>{events.push(n);if(fail===n)throw Error('PRIVATE_PROVIDER_DETAIL');};
  const db={ledger:async()=>{step('ledger');return ledgerFixture(f.m);},readHeldJob:async()=>{step('held');return f.observed;},dispose:async()=>step('db-close')};
  const io={assertSource:async()=>step('source'),preflight:async()=>step('preflight'),claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    readAuth:async()=>{step('auth');return 'SYNTHETIC_OWNER_CAPABILITY';},open:async()=>{step('open');return db;},
    publishReview:async({guard,notBefore})=>{step('publisher');const v=await refreshedPlan(newReviewFixture(f.m,time),f.m,notBefore,time);
      await guard();await assertRefreshLedger(await db.ledger(),f.m,time);step('sql');records.query=ownerQueryV6('plan',v);return v;},
    record:async(n,v)=>{step('record-'+n);records[n]=v;assert.doesNotMatch(canonicalJson(v),/PRIVATE_PROVIDER_DETAIL|SYNTHETIC_OWNER_CAPABILITY/);},dispose:async()=>step('close')};
  return {...f,io,db,events,records,tick:n=>{time+=n;},fail:n=>{fail=n;},run:()=>publishRefreshOnce({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>time})};
}

test('exact old plan hashes are independently recomputed; old source, references and expiry cannot be silently replaced',async()=>{
  const old=oldReviewFixture();assert.deepEqual(await oldReview(old),old);
  for(const patch of [{planSha256:'b'.repeat(64)},{plan:{...old.plan,expiresAt:old.plan.expiresAt+1}},
    {plan:{...old.plan,sourceCommit:'b'.repeat(40)}}])await assert.rejects(oldReview({...old,...patch}));
});
test('48h refresh approval has one new plan SQL, zero S3 puts/jobs/permissions/dispatches and exact cached read proof',async()=>{
  const {m,at}=await refreshFixture();await verifyRefreshReview(m,m.manifestSha256,at);assert.equal(m.expiresAt-at,48*3600000);
  assert.equal(m.effects.ownerPlanSqlMax,1);assert.equal(m.effects.s3Puts,0);assert.equal(m.effects.dispatches,0);assert.equal(m.effects.newJobs,0);
  assert.equal(m.references.lineage.versionId,R.lineageVersion);
  for(const change of [x=>{x.readOnly.controlCounts.attempts=1;},x=>{x.readOnly.target.rowSha256='bad';},
    x=>{x.references.lineage.versionId='changed';},x=>{x.effects.oldPlanUpdatesOrDeletes=1;},x=>{x.runtimeSourceCommit=R.oldSource;}]){
    const v=structuredClone(m);change(v);await assert.rejects(verifyRefreshReview(v,m.manifestSha256,at));}
  await assert.rejects(verifyRefreshReview(m,'wrong',at));await assert.rejects(verifyRefreshReview(m,m.manifestSha256,m.latestStartAt));
});
test('ledger requires exactly one preserved old plan before SQL and exactly old+new after, never any plan-count wildcard',async()=>{
  const {m,at}=await refreshFixture(),v=await refreshedPlan(newReviewFixture(m,at),m,at,at);
  await assertRefreshLedger(ledgerFixture(m),m,at);await assertRefreshLedger(ledgerFixture(m,v),m,at,v);
  for(const change of [x=>{x.counts.plans=3;},x=>{x.counts.approvals=1;},x=>{x.counts.attempts=1;},
    x=>{x.entries[0].plan.sourceCommit='b'.repeat(40);},x=>{x.entries[0].attempt={state:'UNKNOWN'};},
    x=>{x.entries[0].riskSha256='b'.repeat(64);},x=>{x.entries.push(x.entries[0]);}]){
    const bad=structuredClone(ledgerFixture(m));change(bad);await assert.rejects(assertRefreshLedger(bad,m,at));}
  await assert.rejects(assertRefreshLedger(ledgerFixture(m,v),m,at));await assert.rejects(assertRefreshLedger(ledgerFixture(m),m,m.oldPlan.plan.expiresAt-1));
});
test('new plan is Review on final main and same exact references; cannot extend the old plan or authorize RunOnce',async()=>{
  const {m,at}=await refreshFixture(),p=newReviewFixture(m,at);await refreshedPlan(p,m,at,at);
  for(const patch of [{sourceCommit:R.oldSource},{mode:'RunOnce'},{preparedAt:at-1},{expiresAt:at+7200001}])
    await assert.rejects(refreshedPlan({...p,...patch},m,at,at));
});
test('slot precedes owner read; old ledger and held hashes precede exactly one existing publisher SQL; no dispatch',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'REVIEW_REFRESH_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('auth'));assert.ok(f.events.indexOf('ledger')<f.events.indexOf('sql'));
  assert.equal(f.events.filter(n=>n==='sql').length,1);assert.match(f.records.query.text,/SELECT deployment_control_v6\.publish_plan/);
  assert.equal(r.preservedOldPlanSha256,R.oldPlanSha256);assert.equal(r.dispatches,0);assert.equal(r.executionApproved,false);
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='sql').length,1);
});
test('any partial or unknown publication failure preserves intent, closes ports, and never retries or exposes private/provider details',async()=>{
  for(const name of ['auth','open','ledger','held','publisher','sql']){
    const f=await runner();f.fail(name);const r=await f.run();assert.equal(r.outcome,'REVIEW_REFRESH_PARTIAL_OR_UNKNOWN_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert.doesNotMatch(canonicalJson(r),/PRIVATE_PROVIDER_DETAIL|SYNTHETIC_OWNER_CAPABILITY/);
    assert.ok(f.events.filter(n=>n==='sql').length<=1);assert.ok(f.events.includes('close'));}
  const f=await runner();f.fail('record-result');assert.equal((await f.run()).outcome,'REVIEW_REFRESH_PARTIAL_OR_UNKNOWN_NO_RETRY');
  assert.equal(f.events.filter(n=>n==='record-result').length,1);assert.equal(f.events.filter(n=>n==='sql').length,1);assert.ok(f.events.includes('close'));
});
test('changed old state and operation expiry prevent SQL; no old plan restamping or new business task',async()=>{
  const f=await runner();f.db.ledger=async()=>({...ledgerFixture(f.m),counts:{plans:1,approvals:0,attempts:1}});
  assert.equal((await f.run()).outcome,'REVIEW_REFRESH_PARTIAL_OR_UNKNOWN_NO_RETRY');assert.equal(f.events.includes('sql'),false);
  const stale=await runner();stale.io.readAuth=async()=>{stale.tick(R.runMs+1);return 'SYNTHETIC_OWNER_CAPABILITY';};
  assert.equal((await stale.run()).outcome,'REVIEW_REFRESH_PARTIAL_OR_UNKNOWN_NO_RETRY');assert.equal(stale.events.includes('sql'),false);
});
test('production entry only reads fixed S3 versions and uses existing publisher SQL, never puts/deletes resources or dispatches',async()=>{
  const s=await readFile(new URL('../ops/platform-review-v6/refresh-local.mjs',import.meta.url),'utf8');
  assert.match(s,/createTrustedPublisherV6/);assert.match(s,/ownerQueryV6\('plan',v\)/);assert.match(s,/assertRefreshLedger\(await db\.ledger\(\),m,Date\.now\(\)\)/);
  assert.match(s,/maxWrites:1/);assert.match(s,/maxAttempts:1/);
  assert.doesNotMatch(s,/PutObjectCommand|DeleteObjectCommand|GetSecretValueCommand|CreateStackCommand|UpdateStackCommand|createPrivateKey|workflow_dispatch|begin_dispatch/);
});
test('paired window accepts exactly the refreshed two-plan independent proof, not legacy/foreign/missing old evidence',async()=>{
  const {m,at}=await refreshFixture();
  // Reuse the already-tested window constructor input shape, changing only the explicit publication discriminator.
  const window=await import('../ops/platform-hosted-window-v6/contract.mjs'),oldTemplate=await import('../ops/platform-hosted-deploy-v6/contract.mjs');
  const pub={sourceCommit:m.sourceCommit,runtimeSourceCommit:m.sourceCommit,jobId:R.jobId,manifestSha256:m.manifestSha256,rawSha256:'b'.repeat(64),
    kind:'ReviewRefresh',preservedOldPlanSha256:R.oldPlanSha256};
  const w=windowReview({sourceCommit:m.sourceCommit,pins:m.pins,ci:m.ci,baseline:{stackId:window.K.stackId,ids:{TaskDefinition:window.K.originalDefinition},
    imageDigest:window.H.imageDigest,healthy:true,templateSha256:window.hash(window.canonical(oldTemplate.template(window.K.originalNonce))),
    hostingExpiresAt:window.K.originalHostingExpiresAt,stackPolicy:null},publication:pub,parents:m.parents.slice(0,2),nonce:'f'.repeat(32),createdAt:at,compatibility:m.compatibility});
  const next=await refreshedPlan(newReviewFixture(m,at),m,at,at),v={outcome:'REVIEW_REFRESH_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:R.jobId,
    runtimeSourceCommit:m.sourceCommit,planSha256:next.planSha256,preservedOldPlanSha256:R.oldPlanSha256,oldPlanUnchanged:true,oldPlanExpired:true,
    planHashes:[R.oldPlanSha256,next.planSha256].sort(),controlCounts:{plans:2,approvals:0,attempts:0},heldJobUnchanged:true,executionApproved:false,checkedAt:at,planExpiresAt:at+7200000};
  assert.equal(readyReview(v,w,at),v);
  for(const patch of [{controlCounts:{plans:1,approvals:0,attempts:0}},{oldPlanUnchanged:false},{oldPlanExpired:false},{planHashes:[next.planSha256]},
    {preservedOldPlanSha256:'a'.repeat(64)},{outcome:'FOLLOWUP_REVIEW_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED'}])assert.throws(()=>readyReview({...v,...patch},w,at));
  assert.throws(()=>windowReview({...w,publication:{...pub,preservedOldPlanSha256:'a'.repeat(64)}}));
  await makeRefreshReview(m); // New publication remains self-consistent after window construction.
});
