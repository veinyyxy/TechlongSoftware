import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {delegatedPublisherFixture} from './fixtures/platform-delegated-publisher-v1.mjs';
import {parseArgs} from '../ops/platform-delegated-publisher-v1/local.mjs';
test('approved no-Web publication observes, proves, publishes and independently preserves all older rows',async()=>{
  const f=await delegatedPublisherFixture(),before=f.cloneState(),r=await f.run();
  assert.equal(r.outcome,'DELEGATED_RUNONCE_PUBLISHED_REQUIRES_SEPARATE_DISPATCH',JSON.stringify(r));assert.equal(r.submissions,3);
  assert.equal(r.dispatches,0);assert.equal(r.executionApproved,false);assert.equal(r.webLeaseUsed,false);assert.equal(r.independentReadbackVerified,true);
  assert.deepEqual(f.state.ledger.plans.find(p=>p.plan_sha===f.old.planSha256),before.ledger.plans.find(p=>p.plan_sha===f.old.planSha256));
  assert.deepEqual(f.effects.filter(x=>['observe','proof','publish'].includes(x)),['observe','proof','publish']);assert.equal(f.effects.at(-1),'io-close');
});
for(const fault of ['sha','expired','late-start','history-profile','budget'])test('invalid '+fault+' approval acquires no I/O',async()=>{
  const f=await delegatedPublisherFixture(),manifest=await f.prepare(),x=structuredClone(manifest);let approved=manifest.manifestSha256,now=f.now;
  if(fault==='sha')approved='0'.repeat(64);if(fault==='expired')now=()=>manifest.expiresAt;if(fault==='late-start')now=()=>manifest.latestStartAt;
  if(fault==='history-profile')x.protectedHistoricalPlanShas=[];if(fault==='budget')x.effects.planWritesMax=2;
  await assert.rejects(f.api.runReviewed({manifest:x,basis:f.basis,approved,io:f.io,now,rebuildPackage:f.rebuild}));assert.deepEqual(f.effects,[]);
});
for(const fault of ['history','business','source','identity','result','run','claim'])test('preflight '+fault+' never submits SQL',async()=>{
  const f=await delegatedPublisherFixture(),manifest=await f.prepare();
  if(fault==='history')f.state.ledger.plans=f.state.ledger.plans.filter(p=>p.plan_sha!==f.old.planSha256);
  if(fault==='business')f.state.jobs[0].status='changed';
  if(fault==='source')f.io.assertSource=async()=>{throw Error('SOURCE_DRIFT');};
  if(fault==='identity')f.io.verifySourceIdentity=async()=>{throw Error('SOURCE_IDENTITY');};
  if(fault==='result')f.io.readObject=async r=>{const o=await f.ports.readObject(r);if(r.key===f.ref.key)o.value.basisSha256='0'.repeat(64);return o;};
  if(fault==='run')f.io.readRun=async id=>({...f.rawRun(id),conclusion:'failure'});
  if(fault==='claim')f.io.claim=async()=>{throw Error('OCCUPIED');};
  const r=await f.api.runReviewed({manifest,basis:f.basis,approved:manifest.manifestSha256,io:f.io,now:f.now,rebuildPackage:f.rebuild});
  assert(r.outcome.includes('STOPPED'));assert.equal(r.submissions,0);assert(!f.effects.some(x=>['observe','proof','publish'].includes(x)));
});
for(const fault of ['observe','proof','publish','readback'])test('unknown '+fault+' stops at most once without retry or compensation',async()=>{
  const f=await delegatedPublisherFixture();
  if(fault==='observe')f.db.observe=async()=>{f.effects.push('observe');throw Error('ACK_UNKNOWN');};
  if(['proof','publish'].includes(fault)){const write=f.db.writeOwner;f.db.writeOwner=async q=>{if(q.text.includes(fault==='proof'?'attest_evidence':'publish_plan')){
    f.effects.push(fault);throw Error('ACK_UNKNOWN');}return write(q);};}
  if(fault==='readback'){const write=f.db.writeOwner;f.db.writeOwner=async q=>{await write(q);if(q.text.includes('publish_plan'))f.state.ledger.plans.find(p=>p.plan_sha===f.old.planSha256).body.sourceCommit='0'.repeat(40);};}
  const r=await f.run();assert(r.outcome.includes('STOPPED'));assert.equal(r.submissions,{observe:1,proof:2,publish:3,readback:3}[fault]);
  for(const x of ['observe','proof','publish'])assert(f.effects.filter(v=>v===x).length<=1);
  assert.equal(r.retryAllowed,false);assert.equal(f.effects.at(-1),'io-close');
});
test('clock crossing operation/window limits after slot claim submits no SQL',async()=>{
  const f=await delegatedPublisherFixture();f.io.claim=async()=>{f.effects.push('claim');f.tick(3*60000);};
  const r=await f.run();assert(r.outcome.includes('STOPPED'));assert.equal(r.claimed,true);assert.equal(r.submissions,0);
});
test('proof readback run drift prevents publishing a successor',async()=>{
  const f=await delegatedPublisherFixture(),write=f.db.writeOwner;
  f.db.writeOwner=async q=>{await write(q);if(q.text.includes('attest_evidence'))f.entry.attempt.runId='999999999';};
  const r=await f.run();assert(r.outcome.includes('STOPPED'));assert.equal(r.phase,'PROOF');assert.equal(r.submissions,2);assert(!f.effects.includes('publish'));
});
test('CLI has no ready-time, profile, endpoint, arbitrary SQL or dispatch override',()=>{
  assert.equal(parseArgs(['--check']).mode,'Check');
  for(const args of [[],['--mode','RunOnce'],['--mode','RunReviewed','--manifest','x','--approved-sha','a'.repeat(64)],
    ['--mode','RunReviewed','--manifest','F:/ChatGPT_workshop/techlong-delegated-publisher-prepare-a/manifest.json','--approved-sha','a'.repeat(64),'--ready-at','now']])assert.throws(()=>parseArgs(args));
});
test('check imports no credential, private file, database or network capability',()=>{
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-delegated-publisher-v1/local.mjs','--check'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.privateReads+v.awsCalls+v.sqlConnections+v.dispatches,0);assert.equal(v.executionAuthorized,false);
});
