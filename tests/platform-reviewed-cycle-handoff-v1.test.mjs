import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {createA604Policy} from '../ops/platform-a604-operator-v1/policy.mjs';
import {createHandoffProfile} from '../ops/platform-a604-handoff-v1/profile.mjs';
import {TARGET as LEGACY_TARGET} from '../ops/platform-a604-handoff-v1/coordinates.mjs';
import {REQUEST_SOURCE as R,REQUEST_ENTRY,assertSourceBridgeFiles} from '../ops/platform-reviewed-cycle-v1/request-source.mjs';
import {parseArgs} from '../ops/platform-reviewed-cycle-v1/request-local.mjs';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {createTransferTransaction} from '../ops/platform-request-v6/transfer.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {RETIREMENT_FIELDS,RETIREMENT_RULE_GUARD_SQL,assertRetirementBefore,compileRetirementUpdate,
  createRetirementTransaction,verifyRetirementReadback} from '../ops/platform-reviewed-cycle-v1/retirement.mjs';
async function fixture(){
  const f=await a604Fixture(),at=f.at+3*3600000,seed=await createA604Policy({publication:f.publication,profile:f.profile}).seed(f.at),
    before=normalizedState({...f.projection,jobs:f.observed.jobs});
  before.ledger.plans.push({plan_sha:seed.planSha256,action_sha:seed.actionSha256,risk_sha:seed.plan.riskSha256,body:seed.plan,job_id:R.target.oldJobId,mode:'Review',expires_at:new Date(seed.plan.expiresAt).toISOString()});
  before.ledger.approvals.push({plan_sha:seed.planSha256,admin_id:ADMIN});
  before.ledger.attempts.push({plan_sha:seed.planSha256,job_id:R.target.oldJobId,mode:'Review',state:'ACKNOWLEDGED',run_id:'123456797',run_status:null,conclusion:null,proof_sha:null});
  const normalized=normalizedState(before),facts={...R.facts,sourceCommit:f.sourceCommit,checkedAt:at-1,expiresAt:at+3600000,jobCount:before.jobs.length,baselineSha256:await sha256Hex(normalized),
    ledgerSha256:await sha256Hex(normalized.ledger),protection:before.protection,reviewPlanSha256:seed.planSha256,reviewRunId:'123456797'},
    profile=createHandoffProfile(facts,{target:R.target,entry:REQUEST_ENTRY,successfulPredecessor:f.profile.oldJobId});
  return {f,at,before:normalized,profile};
}
test('SOURCE coordinates replace only held a604, not legacy9b; preparation expiry is the original observed cutoff',()=>{
  assert.equal(LEGACY_TARGET.oldJobId,'job_9b57b43a6b88f37202b29170');assert.equal(LEGACY_TARGET.newJobId,R.target.oldJobId);
  assert.equal(R.target.newJobId,'job_a00fc18c13a5d6c6616c8039');assert.equal(R.facts.expiresAt,1793212938110);
  assert.notEqual(REQUEST_ENTRY.slot,REQUEST_ENTRY.inspectSlot);assert(!REQUEST_ENTRY.slot.includes('a604-request'));
});
test('shared profile accepts one expired Review and binds the entire real-shaped history, not a two-plan legacy subset',async()=>{
  const f=await fixture(),p=await f.profile.compile(f.before,f.at);
  assert.equal(p.cancel.values[0],R.target.oldJobId);assert.equal(p.insert.values[0],R.target.newJobId);
  assert.equal(p.insert.payload.reviewRequired,true);assert.equal(p.insert.payload.cloudExecutionAuthorized,false);
  assert.equal(p.insert.values[4],Number.MAX_SAFE_INTEGER);assert(p.cancel.text.includes('clock_timestamp()'));assert(p.lockAdmission.text.includes('FOR UPDATE'));
});
test('history, protection, lease, new candidate and expiry changes fail before a SQL program can be accepted',async()=>{
  const f=await fixture();for(const fault of ['history','protection','lease','candidate','expiry']){
    const s=structuredClone(f.before);let at=f.at;
    if(fault==='history')s.ledger.plans.shift();if(fault==='protection')s.protection.catalogSha256='a'.repeat(64);
    if(fault==='lease')s.jobs.find(j=>j.id===R.target.oldJobId).lease_owner='synthetic';if(fault==='candidate')s.jobs.push({...s.jobs[0],id:R.target.newJobId});
    if(fault==='expiry')at=f.profile.facts.expiresAt;await assert.rejects(f.profile.compile(s,at));
  }
});
test('original serializable transaction changes exactly two rows and independently preserves full ledger and business',async()=>{
  const f=await fixture(),calls=[];let state=structuredClone(f.before);
  const client={async query(text,values){calls.push(text);
    if(text.startsWith('SELECT floor'))return {rows:[{at:f.at}],rowCount:1};
    if(text.startsWith('SELECT id FROM public.deployment_jobs'))return {rows:state.jobs.map(j=>({id:j.id})),rowCount:state.jobs.length};
    if(text.startsWith('UPDATE public.deployment_jobs')){Object.assign(state.jobs.find(j=>j.id===R.target.oldJobId),{status:'canceled',completed_at:f.at,updated_at:f.at});return {rowCount:1};}
    if(text.includes('INSERT INTO public.deployment_jobs')){state.jobs.push({id:R.target.newJobId,deployment_id:state.deployment.id,job_type:'reconcile',dedupe_key:'express-initialized-v2:'+R.target.requestId,
      status:'pending',payload:JSON.parse(values[3]),attempts:0,max_attempts:1,available_at:Number.MAX_SAFE_INTEGER,completed_at:null,created_at:f.at,updated_at:f.at,
      lease_owner:null,lease_token:null,lease_expires_at:null,last_error_code:null,last_error_message:null});return {rowCount:1};}
    return {rows:[],rowCount:1};}};
  const run=createTransferTransaction({client,readState:async()=>structuredClone(state),profile:f.profile,now:()=>f.at});
  assert.equal((await run({baseline:f.before,assertApproved:async()=>{}})).outcome,'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK');
  await f.profile.verifyReadback(f.before,state,f.at);assert.deepEqual(state.ledger,f.before.ledger);assert.deepEqual(state.deployment,f.before.deployment);
  assert.equal(calls.filter(q=>q.startsWith('UPDATE public.deployment_jobs')).length,1);assert.equal(calls.filter(q=>q.includes('INSERT INTO public.deployment_jobs')).length,1);
  await assert.rejects(run({baseline:f.before,assertApproved:async()=>{}}),/ONCE/);
});
test('source bridge accepts only this local composition; compiler/SQL/cloud/role changes are never metadata-only',()=>{
  assert.doesNotThrow(()=>assertSourceBridgeFiles(['ops/platform-reviewed-cycle-v1/request-source.mjs','ops/platform-reviewed-cycle-v1/request-local.mjs']));
  for(const f of ['ops/platform-request-v6/transfer.mjs','ops/platform-request-v6/transfer-state.mjs','ops/platform-reviewed-cycle-v1/cloud.mjs','lib/deployments/controller-v6/ledger.ts','.env.local'])
    assert.throws(()=>assertSourceBridgeFiles([f]),/SOURCE_BRIDGE_DIFF/);
});
test('check is zero-I/O and no CLI argument selects target/profile/source or clears a slot',()=>{
  for(const flag of ['--job','--profile','--source','--resume','--reset-slot'])assert.throws(()=>parseArgs(['--mode','RunReviewed','--manifest','x','--approved-sha','a'.repeat(64),flag,'override']));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-reviewed-cycle-v1/request-local.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.productionReads+v.configContentReads+v.sqlConnections+v.awsCalls+v.dispatches,0);assert.equal(v.executionApproved,false);
});

// Deliberately synthetic server-hash responses, not SQL execution or cloud proof.
function retirementFixture(){
  const at=1800000000000,jobId='job_'+'1'.repeat(24),deploymentId='dep_'+'2'.repeat(24),appInstanceId='app_'+'3'.repeat(32),h=n=>String(n).repeat(64);
  const binding={jobId,deploymentId,appInstanceId,originalDeadline:at-60000,expiresAt:at+3600000};
  const baseline={facts:{deployment_id:deploymentId,app_instance_id:appInstanceId,job_id:jobId,database_now_ms:String(at-1000),read_only:'on',timezone:'UTC',
    status:'running',attempts:1,max_attempts:1,updated_at:String(at-120000),completed_at:null,lease_expires_at:String(at-60000),
    lease_owner_present:true,lease_token_present:true,lease_owner_matches_review:true,payload_matches_review:true,dedupe_matches_review:true,
    job_row_sha256:h(1),job_unchanged_fields_sha256:h(2),deployment_row_sha256:h(3),outputs_sha256:h(4),job_success_receipt_present:false,
    job_count:2,job_ids:[jobId,'job_'+'4'.repeat(24)],other_nonterminal_count:0,other_leased_count:0,other_jobs_sha256:h(5)},
    ledger:{ledger_sha256:h(6),plan_count:3,approval_count:2,attempt_count:2,exact_job_states:[
      {mode:'Review',runId:'123456789',state:'OBSERVED',proofPresent:true},{mode:'RunOnce',runId:'123456790',state:'ACKNOWLEDGED',proofPresent:false}]},
    controlCatalogSha256:h(7),businessCatalogSha256:h(8),protectionSha256:h(9),controlFunctionsVerified:9,leaseTokenOrBusinessBodiesReturned:false};
  const after=structuredClone(baseline);Object.assign(after.facts,{status:'canceled',lease_owner_present:false,lease_token_present:false,
    lease_owner_matches_review:null,lease_expires_at:null,updated_at:String(at),completed_at:String(at),job_row_sha256:'a'.repeat(64)});
  return {at,binding,baseline,after};
}
function retirementHarness({fault,clockAdvance=0,elapsedAdvance=clockAdvance,wallSkew=0,wallJump=0,stopAdvance=0}={}){
  const f=retirementFixture(),calls=[],records=[];let state=structuredClone(f.baseline),clock=f.at+wallSkew,elapsedClock=0;
  const client={async query(text){calls.push(text);
    if(text.startsWith('SELECT floor'))return {rows:[{at:fault==='db-expired'?f.binding.expiresAt:f.at}],rowCount:1};
    if(text===RETIREMENT_RULE_GUARD_SQL)return {rows:[{unsafe_update_rule_count:fault==='rules'?1:0}],rowCount:1};
    if(text.startsWith('WITH stamp')){
      if(fault==='cas')return {rows:[],rowCount:0};
      const retiredAt=Number(state.facts.database_now_ms);state=structuredClone(f.after);
      state.facts.updated_at=state.facts.completed_at=String(retiredAt);state.facts.database_now_ms=String(retiredAt+clockAdvance);
      clock+=clockAdvance+wallJump;elapsedClock+=elapsedAdvance;
      if(fault==='after-clock-back')state.facts.database_now_ms=String(retiredAt-1);
      if(fault==='post-drift')state.facts.other_jobs_sha256='f'.repeat(64);
      return {rowCount:1,rows:[{id:f.binding.jobId,retired_at:state.facts.updated_at,job_row_sha256:f.after.facts.job_row_sha256}]};
    }
    if(text==='COMMIT'&&fault==='commit')throw Error('synthetic lost ACK');
    if(text==='ROLLBACK'&&fault==='rollback')throw Error('synthetic lost rollback ACK');
    return {rows:[],rowCount:0};}};
  let approvalCount=0;
  const run=createRetirementTransaction({client,now:()=>clock,elapsedNow:()=>elapsedClock,readState:async()=>{
    if(state.facts.status==='running'){
      state.facts.database_now_ms=String(f.at+(fault==='fresh-clock'?1:fault==='snapshot-back'?-1:fault==='snapshot-late'?30000:0));
      if(fault==='fresh-clock')clock=f.at+1+wallSkew;
    }
    if(fault==='pre-drift')state.facts.job_row_sha256='f'.repeat(64);
    return structuredClone(state);},
    assertStopped:async()=>{calls.push('EXACT_ABSENCE_CHECK');clock+=stopAdvance;elapsedClock+=stopAdvance;if(fault==='live')throw Error('synthetic live workload');},
    assertApproved:async()=>{calls.push('APPROVAL');if(fault==='approval'||(fault==='late-approval'&&++approvalCount>1))throw Error('synthetic denied');},
    record:async(kind,value)=>{records.push({kind,value});if(fault==='record')throw Error('synthetic evidence failure');}});
  return {...f,calls,records,run,read:()=>state};
}
test('retirement SQL is exactly one full-row CAS update of six fields; no transfer/receipt/lease takeover',()=>{
  const f=retirementFixture(),p=compileRetirementUpdate(f.binding,f.baseline,f.at);
  assert.deepEqual(RETIREMENT_FIELDS,['status','lease_owner','lease_token','lease_expires_at','updated_at','completed_at']);
  const assignments=p.text.split(' SET ')[1].split(' FROM stamp')[0].split(',').map(v=>v.trim().split('=')[0]).sort();
  assert.deepEqual(assignments,[...RETIREMENT_FIELDS].sort());assert.equal((p.text.match(/UPDATE public\.deployment_jobs/g)||[]).length,1);
  assert(!/\b(?:INSERT|DELETE|CREATE|ALTER|DROP)\b/.test(p.text));assert(!p.text.includes('succeeded'));
  assert(p.text.includes('clock_timestamp()')&&p.text.includes('pg_catalog.sha256')&&p.text.includes('MATERIALIZED'));
  assert(p.text.includes('expressInitializedWorkerRunsV2')&&p.text.includes('j.lease_expires_at<stamp.at'));
  assert.deepEqual(p.values,[f.binding.jobId,f.binding.deploymentId,f.binding.appInstanceId,f.baseline.facts.job_row_sha256,f.at,f.binding.expiresAt]);
  assert(!JSON.stringify(p).includes('lease_000'));
});
test('retirement rejects changed identity, active lease, completed/receipted state and unsafe history before compiling',()=>{
  const f=retirementFixture();for(const [key,value] of [['job_id','job_'+'0'.repeat(24)],['status','pending'],['attempts',2],['max_attempts',2],
    ['completed_at',String(f.at)],['lease_expires_at',String(f.at)],['lease_owner_present',false],['lease_token_present',false],
    ['payload_matches_review',false],['dedupe_matches_review',false],['job_success_receipt_present',true],
    ['other_nonterminal_count',1],['other_leased_count',1],['job_row_sha256','not a server hash'],['job_ids',[]],['timezone','local']]){
    const s=structuredClone(f.baseline);s.facts[key]=value;assert.throws(()=>compileRetirementUpdate(f.binding,s,f.at),/TASK_RETIREMENT_/);
  }
  for(const mutate of [s=>s.ledger.exact_job_states.pop(),s=>s.controlFunctionsVerified--,s=>s.protectionSha256='',s=>s.leaseTokenOrBusinessBodiesReturned=true]){
    const s=structuredClone(f.baseline);mutate(s);assert.throws(()=>assertRetirementBefore(f.binding,s,f.at));
  }
});
test('retirement five-hour facts and separately approved window never extend the old completion deadline',()=>{
  const f=retirementFixture();assert.doesNotThrow(()=>assertRetirementBefore(f.binding,f.baseline,f.at));
  for(const at of [f.binding.originalDeadline-1,f.binding.expiresAt,f.at+5*3600000,NaN])
    assert.throws(()=>assertRetirementBefore(f.binding,f.baseline,at));
  assert.throws(()=>assertRetirementBefore({...f.binding,expiresAt:f.at+5*3600000},f.baseline,f.at),/FACT_TIME/);
  assert.throws(()=>assertRetirementBefore(f.binding,{...f.baseline,facts:{...f.baseline.facts,database_now_ms:String(f.at+1)}},f.at),/FACT_TIME/);
});
test('retirement uses one serializable commit, pg_catalog/UTC, explicit locks and in-transaction checks; still needs independent TLS readback',async()=>{
  const f=retirementHarness(),r=await f.run({binding:f.binding,baseline:f.baseline});
  assert.equal(r.outcome,'RETIREMENT_COMMITTED_REQUIRES_INDEPENDENT_READBACK');assert.equal(r.independentReadbackRequired,true);
  assert.equal(r.retryAllowed,false);assert.equal(f.calls.filter(q=>q.startsWith('WITH stamp')).length,1);
  assert.equal(f.calls.filter(q=>q==='COMMIT').length,1);assert(!f.calls.includes('ROLLBACK'));
  assert(f.calls.indexOf("SET LOCAL TimeZone='UTC'")<f.calls.findIndex(q=>q.startsWith('SELECT floor')));
  assert(f.calls.some(q=>q.includes('IN SHARE ROW EXCLUSIVE MODE')));assert.equal(f.calls.filter(q=>q===RETIREMENT_RULE_GUARD_SQL).length,2);
  assert.deepEqual(f.records.map(r=>r.kind),['retirement-intent','retirement-precommit']);
  const checked=verifyRetirementReadback(f.binding,f.baseline,f.read(),r.retiredAt,r.jobRowSha256);
  assert.equal(checked.successReceiptWritten,false);assert.equal(checked.newTaskCreated,false);
  await assert.rejects(f.run({binding:f.binding,baseline:f.baseline}),/ONCE/);
});
test('retirement accepts a later genuine database snapshot clock without restamping the baseline or restarting the time budget',async()=>{
  const f=retirementHarness({fault:'fresh-clock'}),r=await f.run({binding:f.binding,baseline:f.baseline});
  assert.equal(r.outcome,'RETIREMENT_COMMITTED_REQUIRES_INDEPENDENT_READBACK');assert.equal(r.retiredAt,String(f.at+1));
  assert.equal(f.baseline.facts.database_now_ms,String(f.at-1000));
  verifyRetirementReadback(f.binding,f.baseline,f.read(),r.retiredAt,r.jobRowSha256);
});
test('retirement accepts either sign of local/DB wall-clock skew, keeping actual DB row epochs unchanged',async()=>{
  for(const wallSkew of [-220,220]){
    const f=retirementHarness({wallSkew,fault:'fresh-clock'});f.baseline.facts.database_now_ms=String(f.at-100);
    const r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.outcome,'RETIREMENT_COMMITTED_REQUIRES_INDEPENDENT_READBACK');assert.equal(r.retiredAt,String(f.at+1));
    assert.equal(f.baseline.facts.database_now_ms,String(f.at-100));assert.equal(f.read().facts.updated_at,String(f.at+1));
    verifyRetirementReadback(f.binding,f.baseline,f.read(),r.retiredAt,r.jobRowSha256);
  }
});
test('local wall-clock jumps never shift database retirement timestamps or reset elapsed timing',async()=>{
  for(const wallJump of [-60000,60000]){
    const f=retirementHarness({wallJump}),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.outcome,'RETIREMENT_COMMITTED_REQUIRES_INDEPENDENT_READBACK');assert.equal(r.retiredAt,String(f.at));
    assert.equal(f.read().facts.database_now_ms,String(f.at));assert.equal(f.calls.filter(q=>q.startsWith('WITH stamp')).length,1);
  }
});
test('monotonic 30-second limit includes resource checks and cannot be bypassed by rewinding local UTC',async()=>{
  for(const options of [{stopAdvance:30000},{elapsedAdvance:30000,wallJump:-60000},{elapsedAdvance:-1}]){
    const f=retirementHarness(options),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.committed,false);assert(!f.calls.includes('COMMIT'));assert(f.calls.includes('ROLLBACK'));
    if(options.stopAdvance)assert(!f.calls.some(q=>q.startsWith('WITH stamp')));
  }
});
test('database epochs independently reject backwards/late snapshots, expired write windows and backwards readback',async()=>{
  for(const fault of ['snapshot-back','snapshot-late','db-expired','after-clock-back']){
    const f=retirementHarness({fault}),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.committed,false);assert(!f.calls.includes('COMMIT'));assert(f.calls.includes('ROLLBACK'));
    if(fault!=='after-clock-back')assert(!f.calls.some(q=>q.startsWith('WITH stamp')));
  }
});
test('retirement refuses missing explicit capability ports; live resources or denied approval cause zero SQL writes',async()=>{
  assert.throws(()=>createRetirementTransaction({client:{}}),/EXPLICIT_PORTS/);
  for(const fault of ['approval','live']){const f=retirementHarness({fault}),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.committed,false);assert(!f.calls.some(q=>q.startsWith('BEGIN')||q.startsWith('WITH stamp')));}
});
test('retirement rejects unsafe rules, locked baseline drift, revoked approval and unsaved intent before update',async()=>{
  for(const fault of ['rules','pre-drift','late-approval','record']){const f=retirementHarness({fault}),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.outcome,'RETIREMENT_STOPPED_REQUIRES_READBACK');assert(!f.calls.some(q=>q.startsWith('WITH stamp')));
    assert.equal(f.calls.filter(q=>q==='ROLLBACK').length,1);assert(!f.calls.includes('COMMIT'));}
});
test('retirement zero-row CAS or changed post-state abort without committing or retrying the update',async()=>{
  for(const fault of ['cas','post-drift']){const f=retirementHarness({fault}),r=await f.run({binding:f.binding,baseline:f.baseline});
    assert.equal(r.committed,false);assert.equal(r.commitSubmissionAttempted,false);assert.equal(f.calls.filter(q=>q.startsWith('WITH stamp')).length,1);
    assert(f.calls.includes('ROLLBACK'));assert(!f.calls.includes('COMMIT'));}
});
test('retirement lost COMMIT ACK is unknown and never rolled back/replayed; independent read is mandatory',async()=>{
  const f=retirementHarness({fault:'commit'}),r=await f.run({binding:f.binding,baseline:f.baseline});
  assert.equal(r.outcome,'RETIREMENT_COMMIT_UNKNOWN_REQUIRES_READBACK');assert.equal(r.commitSubmissionAttempted,true);
  assert.equal(r.committed,false);assert.equal(r.independentReadbackRequired,true);assert(!f.calls.includes('ROLLBACK'));
  assert.equal(verifyRetirementReadback(f.binding,f.baseline,f.read(),String(f.at),f.after.facts.job_row_sha256).retryAllowed,false);
  await assert.rejects(f.run({binding:f.binding,baseline:f.baseline}),/ONCE/);
});
test('retirement 30-second transaction limit stops late completion; no automatic cleanup or retry',async()=>{
  const f=retirementHarness({clockAdvance:30000}),r=await f.run({binding:f.binding,baseline:f.baseline});
  assert.equal(r.committed,false);assert.equal(r.phase,'IN_TRANSACTION_READBACK');assert(f.calls.includes('ROLLBACK'));assert(!f.calls.includes('COMMIT'));
});
test('independent retirement readback rejects any protected drift or a fabricated successful task',()=>{
  const f=retirementFixture();for(const mutate of [s=>s.facts.status='succeeded',s=>s.facts.completed_at=String(f.at-1),
    s=>s.facts.lease_token_present=true,s=>s.facts.payload_matches_review=false,s=>s.facts.job_unchanged_fields_sha256='f'.repeat(64),
    s=>s.facts.deployment_row_sha256='f'.repeat(64),s=>s.facts.outputs_sha256='f'.repeat(64),s=>s.facts.other_jobs_sha256='f'.repeat(64),
    s=>s.ledger.ledger_sha256='f'.repeat(64),s=>s.businessCatalogSha256='f'.repeat(64),s=>s.facts.job_row_sha256='f'.repeat(64)]){
    const after=structuredClone(f.after);mutate(after);assert.throws(()=>verifyRetirementReadback(f.binding,f.baseline,after,String(f.at),f.after.facts.job_row_sha256));
  }
});
