import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TRANSFER as T,normalizedState,assertTransferState,prepareTransferReview,assertTransferReview,compileTransfer,
  verifyTransferReadback,createTransferTransaction,createReviewedTransfer} from '../ops/platform-request-v6/transfer.mjs';
import {transferFixture,expectedAfter,AT} from './fixtures/platform-task-transfer-v6.mjs';

async function harness(fail){
  const before=await transferFixture();let state=structuredClone(before),reads=0;const events=[];
  const client={async query(text){events.push(text);if(text.startsWith('SELECT floor'))return {rows:[{at:AT}]};
    if(text.startsWith('WITH locked')&&!text.includes('INSERT INTO'))return {rowCount:fail==='admission'?0:1};
    if(text.startsWith('SELECT id FROM'))return {rows:normalizedState(state).jobs.map(j=>({id:j.id}))};
    if(text.startsWith('UPDATE public.deployment_jobs')){
      if(fail==='cancel')return {rowCount:0};const old=state.jobs.find(j=>j.id===T.oldJobId);Object.assign(old,{status:'canceled',updated_at:AT,completed_at:AT});return {rowCount:1};}
    if(text.includes('INSERT INTO public.deployment_jobs')){if(fail==='insert')throw Error('PRIVATE_CONNECTION_DETAIL');
      if(fail==='insert0')return {rowCount:0};state=expectedAfter(before,AT);return {rowCount:1};}
    if(text==='ROLLBACK'){state=structuredClone(before);return {};}
    if(text==='COMMIT'&&fail==='commit')throw Error('PRIVATE_COMMIT_ACK');return {};}};
  const readState=async()=>{reads++;const v=structuredClone(state);if(fail==='drift'&&reads===1)v.protection.catalogSha256='e'.repeat(64);
    if(fail==='lockedDrift'&&reads===2)v.jobs[0].updated_at++;if(fail==='readback'&&reads===3)v.deployment.outputs.unexpected=true;return v;};
  const run=createTransferTransaction({client,readState,now:()=>AT,record:async()=>{if(fail==='record')throw Error('PRIVATE_EVIDENCE_ERROR');}});
  return {before,events,run:()=>run({baseline:before,assertApproved:async()=>{if(fail==='approval')throw Error('PRIVATE_APPROVAL_ERROR');}}),state:()=>state};
}
test('new deterministic request uses the unchanged original admission compiler and hold isolation',async()=>{
  const f=await transferFixture(),p=await compileTransfer(f,AT);
  assert.equal(p.insert.jobId,T.newJobId);assert.equal(p.insert.values[0],T.newJobId);assert.equal(p.insert.values[4],Number.MAX_SAFE_INTEGER);
  assert.equal(p.insert.payload.requestedAt,AT);assert.equal(p.insert.payload.cloudExecutionAuthorized,false);
  assert.match(p.insert.text,/sub.current_period_end/);assert.match(p.insert.text,/d.outputs::jsonb=\$16::jsonb/);
  assert.match(p.lockAdmission.text,/FOR UPDATE OF d,a,w,sub,e,r,o,proof_job,u/);
  for(const i of [1,3,4,5])assert.match(p.lockAdmission.text,new RegExp('\\$'+i+'::'));
  assert.doesNotMatch(p.cancel.text,/DELETE|ALTER|GRANT|payload\s*=/);assert.match(p.cancel.text,/to_jsonb\(j\)/);
  assert.equal((await assertTransferState(f,AT)).jobs.find(j=>j.id===T.oldJobId).status,'pending');
});
test('review binds exact snapshot, source and finite preparation period without starting any cloud clock',async()=>{
  const m=await prepareTransferReview({baseline:await transferFixture(),sourceCommit:'e'.repeat(40),createdAt:AT});
  await assertTransferReview(m,m.manifestSha256,AT);assert.equal(m.expiresAt-AT,48*3600000);
  assert.equal(m.scope.awsCalls,0);assert.equal(m.scope.controlWrites,0);
  for(const [v,sha,at]of [[m,'a'.repeat(64),AT],[m,m.manifestSha256,m.expiresAt],[{...m,sourceCommit:'f'.repeat(40)},m.manifestSha256,AT]])
    await assert.rejects(assertTransferReview(v,sha,at));
});
test('leased/changed old job, extra active job, occupied candidate and changed history fail closed',async()=>{
  const mutations=[f=>{f.jobs[0].status='running';},f=>{f.jobs[0].attempts=1;},f=>{f.jobs[0].lease_owner='synthetic';},
    f=>{f.jobs[0].payload.cloudExecutionAuthorized=true;},f=>{f.jobs[0].payload.scope.appInstanceId='other';},
    f=>{f.jobs[1].status='retry_wait';},f=>{f.jobs[1].id=T.newJobId;},f=>{f.ledger.attempts.push({...f.ledger.attempts[0],mode:'RunOnce'});},
    f=>{f.ledger.attempts[0].proof_sha='a'.repeat(64);},f=>{f.ledger.plans[0].action_sha='f'.repeat(64);},
    f=>{f.protection.catalogSha256='not-a-digest';},f=>{f.deployment.status='failed';},
    f=>{Object.values(f.deployment.outputs.expressInitializedWorkerRunsV2)[0].workloadExpiresAt=AT+1000;}];
  for(const mutate of mutations){const f=await transferFixture();mutate(f);await assert.rejects(compileTransfer(f,AT));}
  await assert.rejects(assertTransferState(await transferFixture(),T.claimBy-1));
});
test('PostgreSQL bigint representations normalize without rounding or accepting absent leases',async()=>{
  const f=await transferFixture();for(const j of f.jobs)j.available_at=String(j.available_at);
  assert.equal((await compileTransfer(f,AT)).cancel.values[3],AT);
  f.jobs[0].available_at='9007199254740993';await assert.rejects(compileTransfer(f,AT));
});
test('independent readback retains exact deployment, control history, payload and all other jobs',async()=>{
  const f=await transferFixture(),after=expectedAfter(f,AT),r=await verifyTransferReadback(f,after,AT);
  assert.equal(r.otherJobsPreserved,2);assert.equal(r.executionApproved,false);
  const mutations=[a=>{a.jobs.find(j=>j.id===T.oldJobId).payload.extra=true;},a=>{a.jobs.find(j=>j.id===T.newJobId).payload.extra=true;},
    a=>{a.ledger.attempts[0].state='OBSERVED';},a=>{a.protection.triggersSha256='f'.repeat(64);},a=>{a.jobs[1].last_error_code='changed';},
    a=>{a.jobs.pop();}];
  for(const mutate of mutations){const a=structuredClone(after);mutate(a);await assert.rejects(verifyTransferReadback(f,a,AT));}
});
test('one SERIALIZABLE commit; metadata locks before snapshot and admission before cancellation',async()=>{
  const f=await harness(),r=await f.run();assert.equal(r.committed,true);await verifyTransferReadback(f.before,f.state(),r.at);
  const pos=p=>f.events.findIndex(v=>v.startsWith(p));assert.equal(f.events[0],'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.ok(pos('LOCK TABLE')<pos('SELECT floor'));assert.ok(pos('WITH locked')<pos('UPDATE public.deployment_jobs'));
  assert.equal(f.events.filter(v=>v==='COMMIT').length,1);assert.equal(f.events.includes('ROLLBACK'),false);await assert.rejects(f.run());
});
test('every pre-commit failure rolls back both rows, has no automatic retry and sanitizes error details',async()=>{
  for(const fail of ['drift','lockedDrift','admission','cancel','insert','insert0','readback','approval','record']){
    const f=await harness(fail),r=await f.run();assert.equal(r.retryAllowed,false);assert.equal(r.committed,false);
    assert.equal(f.events.includes('COMMIT'),false);assert.equal(f.events.filter(v=>v==='ROLLBACK').length,1);
    assert.deepEqual(f.state(),f.before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);}
});
test('lost COMMIT acknowledgement is unknown, never rollback/replay; readback is independent',async()=>{
  const f=await harness('commit'),r=await f.run();assert.equal(r.outcome,'TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK');
  assert.equal(r.commitSubmissionAttempted,true);assert.equal(f.events.includes('ROLLBACK'),false);
  await verifyTransferReadback(f.before,f.state(),r.at);await assert.rejects(f.run());
});
test('exact approval/source/permanent claim precede transaction; unavailable gates cannot fall back',async()=>{
  const m=await prepareTransferReview({baseline:await transferFixture(),sourceCommit:'e'.repeat(40),createdAt:AT});
  for(const fail of ['approval','source','claim']){const events=[],run=createReviewedTransfer({review:m,approved:fail==='approval'?'0'.repeat(64):m.manifestSha256,now:()=>AT,
    io:{assertSource:async()=>{events.push('source');if(fail==='source')throw Error('PRIVATE_SOURCE');},
      claim:async()=>{events.push('claim');if(fail==='claim')throw Error('PRIVATE_SLOT');},transaction:async()=>{events.push('transaction');}}});
    const r=await run();assert.equal(r.retryAllowed,false);assert.equal(events.includes('transaction'),false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);await assert.rejects(run());}
  const events=[],run=createReviewedTransfer({review:m,approved:m.manifestSha256,now:()=>AT,io:{assertSource:async()=>events.push('source'),claim:async()=>events.push('claim'),
    transaction:async p=>{events.push('transaction');await p.assertApproved();return {ok:true};}}});
  assert.deepEqual(await run(),{ok:true});assert.deepEqual(events,['source','claim','transaction','source']);
});
test('module has no private discovery, production client, web route or automatic activation',async()=>{
  const s=await readFile(new URL('../ops/platform-request-v6/transfer.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/from ['"](?:pg|node:fs|@aws-sdk)|process\.env|GetSecretValue|CreateStack|UpdateStack|dispatchWorkflow|\.connect\(/);
  assert.doesNotMatch(s,/UPDATE deployment_control|DELETE FROM|ALTER TABLE|GRANT /);
});
