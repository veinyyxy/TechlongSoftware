import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NEXT,NEXT_ENTRY,NEXT_FACTS,NEXT_PROFILE} from '../ops/platform-request-v6/transfer-next.mjs';
import {parseNextArgs,readNextSavedBaseline} from '../ops/platform-request-v6/transfer-next-local.mjs';
import {makeOperatorReview,verifyOperatorReview,runOperatorMode} from '../ops/platform-request-v6/transfer-entry.mjs';
import {createTransferTransaction,TRANSFER} from '../ops/platform-request-v6/transfer.mjs';
import {nextFixture,nextAfter,NEXT_AT as AT} from './fixtures/platform-task-transfer-next-v6.mjs';
const sourceCommit='e'.repeat(40),ci={sourceCommit,runId:'123456789',jobId:'123456790',attempt:1,status:'completed',conclusion:'success'},
  pins=Array.from({length:12},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),auth={length:1234,aclSha256:'b'.repeat(64),contentRead:false};
const review=f=>makeOperatorReview({baseline:f.before,sourceCommit,ci,pins,auth,createdAt:AT},f.profile);
test('fixed production profile advances only 6a to new held ID; no legacy slot or data-driven override',()=>{
  assert.equal(NEXT.oldJobId,TRANSFER.newJobId);assert.notEqual(NEXT.newJobId,TRANSFER.oldJobId);
  assert.equal(NEXT_PROFILE.target,NEXT);assert.notEqual(NEXT_ENTRY.slot,NEXT_ENTRY.inspectSlot);
  assert.equal(parseNextArgs(['--mode','PrepareSaved','--ci-run','123','--output','x']).mode,'PrepareSaved');
  for(const flags of [['--mode','Prepare'],['--mode','PrepareSaved','--ci-run','1','--output','x','--profile','test'],
    ['--mode','RunReviewed','--manifest','x','--approved-sha','x','--output','x','--old-job','other']])assert.throws(()=>parseNextArgs(flags));
});
test('both generations full four/two/two ledger must remain byte-equivalent after normalization',async()=>{
  const f=await nextFixture();await f.profile.assertState(f.before,AT);
  for(const change of [s=>s.ledger.plans.shift(),s=>{s.ledger.attempts[0].state='OBSERVED';},s=>{s.ledger.attempts[1].proof_sha='a'.repeat(64);},
    s=>{s.jobs.find(j=>j.id===TRANSFER.oldJobId).payload.extra=true;},s=>{s.protection.catalogSha256='f'.repeat(64);},
    s=>{s.jobs.find(j=>j.id===NEXT.oldJobId).attempts=1;},s=>{s.jobs.find(j=>j.id===NEXT.oldJobId).lease_owner='other';}]){
    const s=structuredClone(f.before);change(s);await assert.rejects(f.profile.assertState(s,AT));}
  await assert.rejects(NEXT_PROFILE.assertState(f.before,AT));
});
test('reuse original admission SQL with new deterministic request; no schema/controller/business writes',async()=>{
  const f=await nextFixture(),p=await f.profile.compile(f.before,AT);
  assert.equal(p.insert.jobId,NEXT.newJobId);assert.equal(p.insert.payload.requestId,NEXT.requestId);
  assert.equal(p.insert.values[4],Number.MAX_SAFE_INTEGER);assert.equal(p.insert.payload.cloudExecutionAuthorized,false);
  assert.deepEqual(p.cancel.values.slice(0,2),[NEXT.oldJobId,f.before.deployment.id]);
  assert.match(p.cancel.text,/to_jsonb\(j\)/);assert.match(p.insert.text,/FOR UPDATE OF d,a,w,sub,e,r,o,proof_job,u/);
  assert.doesNotMatch(p.cancel.text+p.insert.text,/DELETE FROM|UPDATE deployment_control|ALTER |GRANT /);
});
test('48h horizon is clipped to original facts, never reset by later preparation',async()=>{
  const f=await nextFixture(),m=await review(f);assert.equal(m.expiresAt,f.facts.factsAt+48*3600000);
  const later=await makeOperatorReview({baseline:f.before,sourceCommit,ci,pins,auth,createdAt:AT+3600000},f.profile);
  assert.equal(later.expiresAt,m.expiresAt);await verifyOperatorReview(m,m.manifestSha256,AT,false,f.profile);
  await assert.rejects(verifyOperatorReview(m,m.manifestSha256,m.latestStartAt,false,f.profile));
  await assert.rejects(verifyOperatorReview({...m,entry:{...m.entry,slot:'other'}},m.manifestSha256,AT,false,f.profile));
  await verifyOperatorReview(m,m.manifestSha256,m.expiresAt+1000,true,f.profile);
  assert.equal(NEXT_FACTS.factsAt+48*3600000,Date.parse('2026-10-27T13:19:12.436Z'));
});
test('exact independent readback preserves both histories and every old row including old payload',async()=>{
  const f=await nextFixture(),after=nextAfter(f.before,AT),r=await f.profile.verifyReadback(f.before,after,AT);
  assert.equal(r.newJobId,NEXT.newJobId);assert.equal(r.controlHistoryPreserved,true);assert.equal(r.executionApproved,false);
  for(const mutate of [s=>{s.jobs.find(j=>j.id===NEXT.oldJobId).payload.extra=true;},s=>{s.ledger.approvals.pop();},
    s=>{s.jobs.find(j=>j.id===NEXT.newJobId).payload.cloudExecutionAuthorized=true;},s=>{s.deployment.status='failed';}]){
    const s=structuredClone(after);mutate(s);await assert.rejects(f.profile.verifyReadback(f.before,s,AT));}
});
test('same SERIALIZABLE core commits once, rolls back all precommit failures, never replays lost COMMIT',async()=>{
  for(const fail of [null,'cancel','insert','readback','commit']){
    const f=await nextFixture();let state=structuredClone(f.before),reads=0;const events=[];
    const client={query:async text=>{events.push(text);if(text.startsWith('SELECT floor'))return {rows:[{at:AT}]};
      if(text.startsWith('WITH locked')&&!text.includes('INSERT INTO'))return {rowCount:1};
      if(text.startsWith('SELECT id FROM'))return {rows:state.jobs.map(j=>({id:j.id}))};
      if(text.startsWith('UPDATE public.deployment_jobs')){if(fail==='cancel')return {rowCount:0};Object.assign(state.jobs.find(j=>j.id===NEXT.oldJobId),{status:'canceled',updated_at:AT,completed_at:AT});return {rowCount:1};}
      if(text.includes('INSERT INTO public.deployment_jobs')){if(fail==='insert')throw Error('PRIVATE');state=nextAfter(f.before,AT);return {rowCount:1};}
      if(text==='COMMIT'&&fail==='commit')throw Error('PRIVATE');if(text==='ROLLBACK')state=structuredClone(f.before);return {};}};
    const run=createTransferTransaction({client,profile:f.profile,now:()=>AT,readState:async()=>{reads++;const s=structuredClone(state);if(reads===3&&fail==='readback')s.ledger.attempts.pop();return s;}});
    const r=await run({baseline:f.before,assertApproved:async()=>{}});assert.equal(r.retryAllowed,false);
    assert.ok(events.findIndex(e=>e.startsWith('LOCK TABLE'))<events.findIndex(e=>e.startsWith('SELECT floor')));
    if(fail==='commit'){assert.equal(r.commitSubmissionAttempted,true);assert.equal(events.includes('ROLLBACK'),false);await f.profile.verifyReadback(f.before,state,AT);}
    else if(fail){assert.deepEqual(state,f.before);assert.equal(events.filter(e=>e==='ROLLBACK').length,1);}
    else{assert.equal(r.committed,true);assert.equal(events.filter(e=>e==='COMMIT').length,1);await f.profile.verifyReadback(f.before,state,AT);}
    await assert.rejects(run({baseline:f.before,assertApproved:async()=>{}}));assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  }
});
test('production mode uses code-selected profile for claims, writer and separate readonly inspect',async()=>{
  const f=await nextFixture(),m=await review(f),events=[];let after=f.before;
  const io={assertSource:async()=>{},verifyCi:async()=>ci,authMetadata:async()=>auth,record:async()=>{},
    claimWrite:async v=>{assert.equal(v.oldJobId,NEXT.oldJobId);assert.equal(v.newJobId,NEXT.newJobId);events.push('claim');},claimInspect:async()=>events.push('inspect'),
    writerReceipt:async()=>({claim:{manifestSha256:m.manifestSha256,sourceCommit,oldJobId:NEXT.oldJobId,newJobId:NEXT.newJobId},
      intent:{at:AT,oldJobId:NEXT.oldJobId,newJobId:NEXT.newJobId,baselineSha256:m.core.baselineSha256}}),
    open:async()=>({readOnly:async()=>after,close:async()=>events.push('close'),transaction:async()=>{events.push('write');return {outcome:'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK'};}})};
  const run=mode=>runOperatorMode({mode,manifest:m,approved:m.manifestSha256,profile:f.profile,io,now:()=>AT});
  assert.equal((await run('RunReviewed')).outcome,'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK');
  assert.ok(events.indexOf('claim')<events.indexOf('write'));after=nextAfter(f.before,AT);
  assert.equal((await run('Inspect')).outcome,'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY');assert.equal(events.filter(v=>v==='write').length,1);
  after=structuredClone(f.before);after.jobs[0].updated_at++;assert.equal((await run('RunReviewed')).phase,'PREFLIGHT_OPEN');
  assert.equal(events.filter(v=>v==='write').length,1);
});
test('saved preparation rejects altered parent before following files; entry has no live Prepare reads',async()=>{
  let n=0;await assert.rejects(readNextSavedBaseline(async()=>{n++;return '{}';}));assert.equal(n,1);
  const text=await readFile(new URL('../ops/platform-request-v6/transfer-next-local.mjs',import.meta.url),'utf8');
  const prepare=text.slice(text.indexOf("if(mode==='PrepareSaved'){"),text.indexOf('}else{\n    const contract='));
  assert.match(prepare,/readNextSavedBaseline/);assert.doesNotMatch(prepare,/openTransferDatabase|readAuthV6|readOnly\(|GetSecret|\.connect\(/);
  assert.doesNotMatch(text,/--profile|--old-job|--new-job|--database|--slot|GetSecretValue|CreateStack|UpdateStack/);
});
