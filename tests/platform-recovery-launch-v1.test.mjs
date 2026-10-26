import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {recoveryControlFixture} from './fixtures/platform-recovery-control-v1.mjs';
import {compileRecoveryRequest} from '../ops/platform-recovery-v1/request.mjs';
import {recoveryCloudResult} from '../ops/platform-recovery-v1/package.mjs';
import {makeReview,runReviewed,slotFor,verifyBaseline} from '../ops/platform-recovery-launch-v1/operation.mjs';
import {parseArgs} from '../ops/platform-recovery-launch-v1/local.mjs';
import {sqlGate,readLaunchSnapshot} from '../ops/platform-recovery-launch-v1/io.mjs';
import {ORIGINAL_REQUEST,loadOriginalRequestEvidence} from '../ops/platform-recovery-launch-v1/request-evidence.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {resultKeyV6} from '../ops/platform-cloud-v6/contract.mjs';
async function fixture(){
  const f=await recoveryControlFixture(),program=await compileRecoveryRequest(f.basis,f.at),state=f.makeAfter(program),plans=new Map(),effects=[],records=[];
  const observed=structuredClone(f.observed),job=state.jobs.find(j=>j.id===f.profile.newJobId);
  observed.job={...job,payload:canonicalJson(job.payload)};observed.jobs=[...f.state.jobs,structuredClone(observed.job)];
  observed.requester={id:ADMIN,status:'active',is_platform_admin:1};observed.checkedAt=f.at;
  const snapshot=()=>{
    const s=structuredClone(state);for(const [sha,e] of plans){
      s.ledger.plans.push({plan_sha:sha,action_sha:e.actionSha256,risk_sha:e.riskSha256,job_id:e.plan.jobId,mode:e.plan.mode,body:e.plan,
        expires_at:new Date(e.plan.expiresAt).toISOString(),created_at:new Date(e.plan.preparedAt).toISOString()});
      if(e.attempt){s.ledger.approvals.push({plan_sha:sha,admin_id:ADMIN,approved_at:new Date(f.at).toISOString()});s.ledger.attempts.push({plan_sha:sha,job_id:e.plan.jobId,...e.attempt});}
    }return s;
  };
  const db={snapshot:async()=>snapshot(),readHeldJob:async()=>observed,loadPlan:async sha=>structuredClone(plans.get(sha)),
    writeOwner:async q=>{effects.push('write');if(q.text.includes('attest_evidence'))plans.get(q.values[0]).attempt.proofSha256=q.values[1];
      else plans.set(q.values[0],{planSha256:q.values[0],actionSha256:q.values[1],riskSha256:q.values[2],plan:JSON.parse(q.values[3]),attempt:null});},
    observe:async(sha,id)=>{effects.push('observe');Object.assign(plans.get(sha).attempt,{runId:id,state:'OBSERVED',status:'completed',conclusion:'success'});},close:async()=>effects.push('db-close')};
  const io={assertSource:async()=>{},verifyCi:async()=>effects.push('ci'),verifySourceIdentity:async()=>effects.push('sts'),
    open:async()=>{effects.push('open');return db;},claim:async()=>effects.push('claim'),installationReference:async()=>f.installationReference,
    readObject:f.ports.readObject,readRun:async id=>f.rawRun(id),record:async(n,v)=>records.push({n,v}),close:async()=>effects.push('io-close')};
  const lease={schema:'techlong/platform-hosted-runtime-lease/v6',releaseSha256:await sha256Hex(f.release),
    origin:'https://console.sandbox.techlong.cloud',sourceCommit:f.sourceCommit,issuedAt:f.at,expiresAt:f.at+30*60000};
  const requestEvidence={schema:'techlong/original-recovery-request-evidence/v1',...ORIGINAL_REQUEST,transactionAt:f.at,basisSha256:f.basis.basisSha256,artifactsVerified:12};
  const review=action=>makeReview({binding:f.binding,basis:f.basis,sourceCommit:f.sourceCommit,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'1'.repeat(64)})),requestEvidence,
    ci:{runId:'123',jobId:'456',sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    auth:{length:100,aclSha256:'2'.repeat(64),contentRead:false},hostingManifestSha256:'3'.repeat(64),
    hostingIntentFile:'F:/ChatGPT_workshop/techlong-w9p-recovery-hosting-test/update-intent.json',action,createdAt:f.at});
  const run=async(action,overrides={})=>{const manifest=await review(action);return runReviewed({manifest,basis:f.basis,approved:manifest.manifestSha256,
    lease,readyAt:f.at,io,now:f.now,rebuildPackage:f.rebuild,...overrides});};
  async function advanceMaterial(){
    const published=await run({operation:'PublishReview'});assert.equal(published.outcome,'REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL',JSON.stringify(published));
    const id='123456797',e=plans.get(published.planSha256);
    e.attempt={state:'ACKNOWLEDGED',runId:id,status:null,conclusion:null,proofSha256:null};
    const value=await recoveryCloudResult({plan:e.plan,run:f.run(id),release:f.release,frozenSourceCommit:f.frozenSourceCommit,
      envelope:{review:f.envelope,report:null},cloudReportReference:f.manifestRef});
    const ref=await f.store(resultKeyV6(e.plan.jobId,f.envelope.recoveryReviewSha256,id),value);
    effects.length=0;return {operation:'AdvanceReview',planSha256:published.planSha256,runId:id,resultReference:ref};
  }
  return {...f,review,run,lease,io,db,effects,records,plans,snapshot,advanceMaterial,requestEvidence,state};
}
test('real recovery publisher composition appends one Review without dispatch or execution',async()=>{
  const f=await fixture(),r=await f.run({operation:'PublishReview'});
  assert.equal(r.outcome,'REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL',JSON.stringify(r));assert.equal(r.plan.mode,'Review');assert.equal(r.dispatches,0);
  assert.equal(f.effects.filter(v=>v==='write').length,1);assert(f.effects.indexOf('claim')<f.effects.indexOf('write'));
  assert.equal(r.plan.inputs.lineage,canonicalJson(f.binding.packageReference));assert.equal(f.effects.at(-1),'io-close');
});
test('successful Review validates outer/inner envelopes then observes, attests and publishes reserved RunOnce',async()=>{
  const f=await fixture(),a=await f.advanceMaterial(),r=await f.run(a);
  assert.equal(r.outcome,'RUNONCE_PUBLISHED_REQUIRES_HUMAN_APPROVAL');assert.equal(r.plan.mode,'RunOnce');assert.equal(r.submissions,3);
  assert.equal(r.plan.inputs.manifestSha,f.envelope.recoveryReviewSha256);assert.notEqual(r.plan.inputs.manifestSha,f.envelope.innerManifest.manifestSha256);
  assert(r.plan.expiresAt<=r.cloudClaimBy-8*60000);assert(r.plan.expiresAt<=f.lease.expiresAt-8*60000);
  assert.equal(f.effects.filter(v=>v==='observe').length,1);assert.equal(f.effects.filter(v=>v==='write').length,2);assert.equal(r.executionApproved,false);
});
for(const fault of ['sha','expired','lease','readiness','source','identity','old-state','slot'])test('reject '+fault+' before owner mutation',async()=>{
  const f=await fixture(),a={operation:'PublishReview'},overrides={};
  if(fault==='sha')overrides.approved='0'.repeat(64);
  if(fault==='expired')overrides.now=()=>f.basis.expiresAt;
  if(fault==='lease')overrides.lease={...f.lease,sourceCommit:'0'.repeat(40)};
  if(fault==='readiness')overrides.readyAt=f.at-180000;
  if(fault==='source')f.io.assertSource=async()=>{throw Error('SOURCE_DRIFT');};
  if(fault==='identity')f.io.verifySourceIdentity=async()=>{throw Error('SOURCE_EXPIRED');};
  if(fault==='old-state')f.db.snapshot=async()=>{const s=f.snapshot();s.jobs[0].status='changed';return s;};
  if(fault==='slot')f.io.claim=async()=>{throw Error('SLOT_OCCUPIED');};
  if(['sha','expired'].includes(fault)){await assert.rejects(f.run(a,overrides));assert.deepEqual(f.effects,[]);}
  else{const r=await f.run(a,overrides);assert(r.outcome.includes('STOPPED'));assert(!f.effects.includes('write'));assert(!f.effects.includes('observe'));}
});
for(const fault of ['result','run','proof','window','observe-ack','sql-ack'])test('advance failure '+fault+' never dispatches or retries',async()=>{
  const f=await fixture(),a=await f.advanceMaterial();
  if(fault==='result')f.io.readObject=async r=>{const v=await f.ports.readObject(r);if(r.key===a.resultReference.key)v.value.basisSha256='0'.repeat(64);return v;};
  if(fault==='run')f.io.readRun=async id=>({...f.rawRun(id),conclusion:'failure'});
  if(fault==='proof')f.plans.get(a.planSha256).attempt.proofSha256='0'.repeat(64);
  if(fault==='window')f.lease.expiresAt=f.at+7*60000;
  if(fault==='observe-ack')f.db.observe=async()=>{f.effects.push('observe');throw Error('OBSERVE_UNKNOWN');};
  if(fault==='sql-ack')f.db.writeOwner=async()=>{f.effects.push('write');throw Error('COMMIT_UNKNOWN');};
  const r=await f.run(a);assert(r.outcome.includes('STOPPED'));assert.equal(r.dispatches,undefined);
  assert.equal(f.effects.filter(v=>v==='write').length,fault==='sql-ack'?1:0);
  assert.equal(f.effects.filter(v=>v==='observe').length,['observe-ack','sql-ack'].includes(fault)?1:0);
});
test('late publication or unknown publication ACK never opens a new Review slot automatically',async()=>{
  const f=await fixture(),late=await f.run({operation:'PublishReview'},{lease:{...f.lease,expiresAt:f.at+15*60000}});
  assert(late.outcome.includes('STOPPED'));assert(!f.effects.includes('open'));assert(!f.effects.includes('claim'));
  f.db.writeOwner=async()=>{f.effects.push('write');throw Error('ACK_UNKNOWN');};
  const failed=await f.run({operation:'PublishReview'});assert.equal(failed.submissions,1);assert.equal(failed.claimed,true);
  assert.equal(f.effects.filter(v=>v==='write').length,1);
});
test('same held job cannot receive another Review after first publication',async()=>{
  const f=await fixture();await f.run({operation:'PublishReview'});f.effects.length=0;
  const r=await f.run({operation:'PublishReview'});assert(r.outcome.includes('STOPPED'));assert(!f.effects.includes('claim'));
  await assert.rejects(verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,f.requestEvidence));
});
test('legitimate 3036ms insert delay uses the sealed transaction time, never row creation time',async()=>{
  const f=await fixture(),j=f.state.jobs.find(v=>v.id===f.profile.newJobId);j.created_at+=3036;j.updated_at+=3036;
  await verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,f.requestEvidence);
  await assert.rejects(verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,{...f.requestEvidence,transactionAt:j.created_at}));
  j.updated_at=f.at+30001;await assert.rejects(verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,f.requestEvidence));
});
test('request provenance or payload tampering cannot use the corrected timestamp to bypass checks',async()=>{
  const f=await fixture();
  for(const e of [{...f.requestEvidence,transactionAt:f.at-1},{...f.requestEvidence,sealSha256:'0'.repeat(64)},null])
    await assert.rejects(verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,e));
  f.state.jobs.find(v=>v.id===f.profile.newJobId).payload={changed:true};
  await assert.rejects(verifyBaseline(f.basis,f.snapshot(),'PublishReview',f.binding,f.requestEvidence));
  await assert.rejects(loadOriginalRequestEvidence(f.basis,{read:async()=>'{"tampered":true}'}),/SEAL_HASH/);
});
test('operation slots are fixed, distinct and cannot be replaced by arbitrary action input',()=>{
  assert.notEqual(slotFor('PublishReview'),slotFor('AdvanceReview'));assert.throws(()=>slotFor('RunOnce'));
});
test('SQL read client rejects all three ledger write capabilities; unknown mutation is rejected',()=>{
  for(const q of ['SELECT deployment_control_v6.publish_plan($1,$2,$3,$4::jsonb)','SELECT deployment_control_v6.attest_evidence($1,$2)',
    'SELECT deployment_control_v6.observe_run($1,$2,$3,$4)'])assert.throws(()=>sqlGate('AdvanceReview').check(q,true));
  assert.throws(()=>sqlGate('PublishReview').check('UPDATE public.deployment_jobs SET status=$1',false));
  const g=sqlGate('AdvanceReview');g.check('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',false);
  assert.throws(()=>g.check('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',false));
});
test('production snapshot sets the original transaction-local catalog path before fingerprinting, without changing returned state',async()=>{
  const calls=[],state={protection:{catalogSha256:'original-catalog',triggersSha256:'original-trigger'}},contract={synthetic:true};
  let catalogPath=false;
  const reader={query:async sql=>{calls.push(sql);if(sql==='SET LOCAL search_path=pg_catalog')catalogPath=true;}};
  const actual=await readLaunchSnapshot(reader,{contract,readState:async(c,options)=>{
    assert.equal(c,reader);assert.equal(options.contract,contract);assert.equal(catalogPath,true);
    calls.push('READ_REVIEWED_STATE');return state;
  }});
  assert.equal(actual,state);assert.deepEqual(state.protection,{catalogSha256:'original-catalog',triggersSha256:'original-trigger'});
  assert.deepEqual(calls,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL search_path=pg_catalog','READ_REVIEWED_STATE','COMMIT']);
});
for(const failAt of ['path','read'])test('snapshot '+failAt+' failure rolls back once without fingerprint fallback or retry',async()=>{
  const calls=[];let reads=0;const failure=Error('SYNTHETIC_READ_FAILURE');
  const reader={query:async sql=>{calls.push(sql);if(failAt==='path'&&sql==='SET LOCAL search_path=pg_catalog')throw failure;}};
  await assert.rejects(readLaunchSnapshot(reader,{contract:{synthetic:true},readState:async()=>{reads++;throw failure;}}),e=>e===failure);
  assert.equal(reads,failAt==='path'?0:1);assert.equal(calls.filter(v=>v==='ROLLBACK').length,1);assert(!calls.includes('COMMIT'));
});
test('CLI rejects unknown modes, AWS profile/endpoint overrides and arbitrary output paths',()=>{
  assert.equal(parseArgs(['--check']).mode,'Check');
  for(const args of [[],['--mode','RunOnce'],['--mode','PrepareSaved','--material','x','--ci-run','123','--output','C:/tmp'],
    ['--mode','PrepareSaved','--material','x','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-recovery-launch-test','--profile','admin']])assert.throws(()=>parseArgs(args));
});
test('--check validates published binding without credential, database or private material access',()=>{
  const p=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-recovery-launch-v1/local.mjs','--check'],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.privateReads+r.awsCalls+r.sqlConnections+r.dispatches,0);assert.equal(r.executionAuthorized,false);
});
