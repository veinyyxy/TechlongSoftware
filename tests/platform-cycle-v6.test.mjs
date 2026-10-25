import test from 'node:test';
import assert from 'node:assert/strict';
import {cycleFixture} from './fixtures/platform-cycle-v6.mjs';
import {CYCLE,CYCLE_SCOPE,makeCycleReview,validateCycleReview,cycleUpdateRequest} from '../ops/platform-review-v6/cycle-plan.mjs';
import {createCycleRun} from '../ops/platform-review-v6/cycle-run.mjs';
import {cycleSqlGate,OBSERVE_SQL} from '../ops/platform-review-v6/cycle-database.mjs';
import {ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {parseCycleArgs} from '../ops/platform-review-v6/cycle-local.mjs';
import {K,windowLease,windowTemplate} from '../ops/platform-hosted-window-v6/contract.mjs';

test('fresh approval is job-specific, bounded by original audit and binds exact write/read ceilings',async()=>{
  const {m,at}=await cycleFixture();await validateCycleReview(m,m.manifestSha256,at);
  assert.equal(m.expiresAt,m.preparation.expiresAt);assert.equal(m.latestStartAt,m.expiresAt-CYCLE.runMs);
  assert.equal(m.scope.updateStackMax,1);assert.equal(m.scope.ownerPlanSubmissionsMax,2);assert.equal(m.scope.parentWorkflowDispatches,0);
  for(const change of [v=>{v.scope.updateStackMax=2;},v=>{v.nonce='bad';},v=>{v.sourceCommit='main';},
    v=>{v.anchor.after.jobs[0].updated_at++;},v=>{v.preparation.newControlCounts.attempts=1;},v=>{v.preparation.baseline.ids.TaskDefinition+='0';}]){
    const bad=structuredClone(m);change(bad);await assert.rejects(validateCycleReview(bad,bad.manifestSha256,at));
  }
  await assert.rejects(validateCycleReview(m,'0'.repeat(64),at));
  await assert.rejects(validateCycleReview(m,m.manifestSha256,m.latestStartAt));
  await validateCycleReview(m,m.manifestSha256,m.latestStartAt,{running:true});
  await assert.rejects(validateCycleReview(m,m.manifestSha256,m.expiresAt,{running:true}));
  await validateCycleReview(m,m.manifestSha256,m.expiresAt+1,{inspect:true});
});
test('request derives lease only at intent, retains hosting parameter, normal rollback, no IAM/capabilities',async()=>{
  const {m,at}=await cycleFixture(),r=cycleUpdateRequest(m,at+12345);assert.equal(r.StackName,K.stackId);assert.equal(r.DisableRollback,false);
  assert.deepEqual(JSON.parse(r.TemplateBody),windowTemplate(m.sourceCommit));assert.deepEqual(r.Parameters[0],{ParameterKey:'HostingExpiresAt',UsePreviousValue:true});
  assert.deepEqual(JSON.parse(r.Parameters[1].ParameterValue),windowLease(at+12345,m.sourceCommit));
  assert.equal(r.ClientRequestToken,'platform-cycle-'+m.nonce);assert(!('RoleARN'in r));assert(!('Capabilities'in r));
});
test('public CLI accepts only precise modes; no direct dispatch, repair or retry flag',()=>{
  const prepare=['--mode','Prepare','--ci-run','12345','--output','out'];assert.equal(parseCycleArgs(prepare)['--mode'],'Prepare');
  const run=['--mode','RunReviewed','--manifest','file','--approved-sha','sha','--output','out'];assert.equal(parseCycleArgs(run)['--mode'],'RunReviewed');
  assert.equal(parseCycleArgs(['--mode','ConfirmPage','--manifest','file','--approved-sha','sha','--ready-through-lease','yes'])['--mode'],'ConfirmPage');
  for(const bad of [[...prepare,'--mode','Prepare'],[...run,'--retry','yes'],run.map(v=>v==='RunReviewed'?'Dispatch':v),
    ['--mode','ConfirmPage','--manifest','file','--approved-sha','sha','--ready-through-lease','no']])assert.throws(()=>parseCycleArgs(bad));
});
test('SQL gate blocks every mutation through independent reader and caps writes at two plans/one proof/one observation',()=>{
  const plan=ownerQueryV6('plan',{planSha256:'a',actionSha256:'b',plan:{riskSha256:'c'}}),proof=ownerQueryV6('proof',{planSha256:'a'.repeat(64),proofSha256:'b'.repeat(64)});
  for(const inspect of [false,true])for(const q of [plan,proof,{text:OBSERVE_SQL,values:[]}])assert.throws(()=>cycleSqlGate({inspect}).check(q.text,q.values,true));
  const g=cycleSqlGate();g.check(plan.text,plan.values,false);g.check(plan.text,plan.values,false);assert.throws(()=>g.check(plan.text,plan.values,false));
  for(const q of [proof,{text:OBSERVE_SQL,values:[]}]){const gate=cycleSqlGate();gate.check(q.text,q.values,false);assert.throws(()=>gate.check(q.text,q.values,false));}
  for(const sql of ['UPDATE public.deployment_jobs SET status=1','DELETE FROM deployment_control_v6.plans','BEGIN','SET ROLE x'])assert.throws(()=>cycleSqlGate().check(sql,[],false));
  const halted=cycleSqlGate();halted.halt();assert.throws(()=>halted.check('SELECT 1',[],true));halted.check('ROLLBACK',[],true);
});
async function harness(failure){
  const f=await cycleFixture(),events=[],records=[];let clock=f.at,updates=0,closed=0;
  const step=n=>{events.push(n);if(n===failure)throw Error('PRIVATE_DETAIL');};
  const io={guard:async()=>step('guard'),preflight:async()=>{step('preflight');return {checkedAt:clock,lastUpdatedTime:new Date(clock-3600000).toISOString()};},
    claim:async()=>step('claim'),record:async(n,v)=>{records.push({n,v});step('record-'+n);},update:async()=>{updates++;step('update');return {StackId:K.stackId};},
    stack:async()=>{step('stack');return {StackId:K.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(clock+1).toISOString()};},
    wait:async ms=>{clock+=ms;},windowSnapshot:async()=>{step('snapshot');return {};},
    drive:async()=>{step('drive');return {outcome:'RUNONCE_TERMINAL_REQUIRES_SEPARATE_INDEPENDENT_INSPECT',workflowDispatchesByParent:0};},
    counts:()=>({updates}),close:async()=>{closed++;}};
  const run=createCycleRun({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>clock,verifyWindow:()=>({taskDefinition:'synthetic-new'})});
  return {...f,io,run,events,records,getClosed:()=>closed};
}
test('owned flow consumes slot before exactly one update, verifies window before drive and cannot replay',async()=>{
  const f=await harness(),r=await f.run();assert.equal(r.outcome,'HOSTED_CYCLE_RUNONCE_TERMINAL_REQUIRES_INDEPENDENT_INSPECT');
  assert(f.events.indexOf('claim')<f.events.indexOf('update'));assert(f.events.indexOf('snapshot')<f.events.indexOf('drive'));
  assert.equal(r.counts.updates,1);assert.equal(f.getClosed(),1);await assert.rejects(f.run(),/MEMORY_ONCE/);
});
for(const fail of ['preflight','claim','record-window-intent','update','stack','snapshot','drive'])test('owned '+fail+' failure never retries or compensates',async()=>{
  const f=await harness(fail),r=await f.run();assert.equal(r.outcome,'HOSTED_CYCLE_STOPPED_REQUIRES_INDEPENDENT_INSPECT');assert.equal(r.retryAllowed,false);
  assert(r.counts.updates<=1);assert.equal(f.getClosed(),1);if(fail==='claim'){assert.equal(r.slotClaimAttempted,true);assert.equal(r.slotClaimed,false);}
  await assert.rejects(f.run(),/MEMORY_ONCE/);
});
test('stale preflight stops before slot; a submitted normal rollback is never mistaken for success',async()=>{
  const f=await harness();f.io.preflight=async()=>({checkedAt:f.at-120000,lastUpdatedTime:new Date(f.at-3600000).toISOString()});
  const r=await f.run();assert.equal(r.slotClaimAttempted,false);assert(!f.events.includes('update'));
  const g=await harness();g.io.stack=async()=>({StackId:K.stackId,StackStatus:'UPDATE_ROLLBACK_COMPLETE'});const stopped=await g.run();
  assert.equal(stopped.outcome,'HOSTED_CYCLE_STOPPED_REQUIRES_INDEPENDENT_INSPECT');assert(!g.events.includes('drive'));
});
test('an old UPDATE_COMPLETE response cannot open the human approval stage',async()=>{
  const f=await harness();f.io.stack=async()=>({StackId:K.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(f.at-3600000).toISOString()});
  const r=await f.run();assert.equal(r.outcome,'HOSTED_CYCLE_STOPPED_REQUIRES_INDEPENDENT_INSPECT');assert(!f.events.includes('drive'));
});
test('recompiling cannot extend the original audit expiry or add paid tenant creation authority',async()=>{
  const {m}=await cycleFixture(),later=await makeCycleReview({...m,createdAt:m.createdAt+60000});
  assert.equal(later.expiresAt,m.expiresAt);assert.equal(later.scope.parentTenantCreates,0);assert.deepEqual(later.scope,CYCLE_SCOPE);
});
