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
