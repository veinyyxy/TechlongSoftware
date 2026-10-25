import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cycleFixture} from './fixtures/platform-cycle-v6.mjs';
import {CYCLE,CYCLE_SCOPE,validateCycleReview,cycleUpdateRequest} from '../ops/platform-review-v6/cycle-plan.mjs';
import {NEXT_CYCLE,NEXT_BASE,NEXT_SLOTS,makeNextCycleReview,validateNextCycleReview,parseNextArgs,assertNextOnline,assertNextAvailable} from '../ops/platform-review-v6/cycle-next.mjs';
import {createCycleRun} from '../ops/platform-review-v6/cycle-run.mjs';
async function fixture(){
  const f=await cycleFixture(),p=structuredClone(f.m.preparation);
  Object.assign(p,{factsAt:f.at,parentClosureSha256:NEXT_BASE.closureSha256});
  Object.assign(p.baseline,{rootEventId:NEXT_BASE.rootEventId});p.baseline.ids.TaskDefinition=NEXT_BASE.definition;
  return {...f,m:await makeNextCycleReview({...f.m,preparation:p})};
}
test('successor uses four independent slots, exact revision5 and root; old scope cannot authorize it',async()=>{
  const {m,at}=await fixture();await validateNextCycleReview(m,m.manifestSha256,at);
  assert.equal(m.preparation.baseline.ids.TaskDefinition,NEXT_BASE.definition);assert.notEqual(NEXT_CYCLE.slot,CYCLE.slot);
  assert.equal(new Set([NEXT_CYCLE.slot,NEXT_CYCLE.inspectSlot,...Object.values(NEXT_SLOTS)]).size,4);
  for(const [k,v] of Object.entries(CYCLE_SCOPE))assert.deepEqual(m.scope[k],v);
  await assert.rejects(validateCycleReview(m,m.manifestSha256,at));
  const legacy=await cycleFixture();await validateCycleReview(legacy.m,legacy.m.manifestSha256,legacy.at);
  await assert.rejects(validateNextCycleReview(legacy.m,legacy.m.manifestSha256,legacy.at));
});
for(const [label,change] of Object.entries({root:x=>{x.preparation.baseline.rootEventId='old';},
  revision:x=>{x.preparation.baseline.ids.TaskDefinition=NEXT_BASE.definition.replace(':5',':4');},
  closure:x=>{x.preparation.parentClosureSha256='0'.repeat(64);},expiry:x=>{x.preparation.expiresAt++;},
  retired:x=>{x.executionProfile.additionalRetiredDefinitions.push('unreviewed');},
  slot:x=>{x.executionProfile.slot=CYCLE.slot;},scope:x=>{x.scope.parentTenantCreates=1;}}))test('successor rejects '+label+' drift',async()=>{
  const {m,at}=await fixture(),v=structuredClone(m);change(v);await assert.rejects(validateNextCycleReview(v,v.manifestSha256,at));
});
test('successor expiry uses actual saved facts, never the new packaging time',async()=>{
  const {m,at}=await fixture(),later=await makeNextCycleReview({...m,createdAt:at+3600000});assert.equal(later.expiresAt,m.expiresAt);
  await assert.rejects(validateNextCycleReview(m,m.manifestSha256,m.latestStartAt));
  await validateNextCycleReview(m,m.manifestSha256,m.latestStartAt,{running:true});
  await assert.rejects(validateNextCycleReview(m,m.manifestSha256,m.expiresAt,{running:true}));
  await validateNextCycleReview(m,m.manifestSha256,m.expiresAt+1,{inspect:true});
});
test('RunReviewed alone requires one online timestamp; other modes reject it and no retry flag exists',()=>{
  const run=['--mode','RunReviewed','--manifest','f','--approved-sha','s','--output','o'],online=['--human-online-at-ms','1792891000000'];
  assert.equal(parseNextArgs([...run,...online])['--human-online-at-ms'],online[1]);assert.throws(()=>parseNextArgs(run));
  for(const mode of ['Prepare','Inspect','ConfirmPage']){
    const args=mode==='Prepare'?['--mode',mode,'--ci-run','123','--output','o']:mode==='ConfirmPage'?
      ['--mode',mode,'--manifest','f','--approved-sha','s','--ready-through-lease','yes']:run.map(v=>v==='RunReviewed'?mode:v);
    assert.equal(parseNextArgs(args)['--mode'],mode);assert.throws(()=>parseNextArgs([...args,...online]));
  }
  for(const extra of [[...online,...online],['--human-online-at-ms','now'],[...online,'--retry','yes']])assert.throws(()=>parseNextArgs([...run,...extra]));
});
test('online confirmation is not plan approval, cannot be future or stale and never extends',async()=>{
  const {m,at}=await fixture(),arg={'--human-online-at-ms':String(at)},r=assertNextOnline(arg,m,at+90000);
  assert.equal(r.notPlanApproval,true);assert.equal(r.humanReadyUntil,at+40*60000);
  assert.throws(()=>assertNextOnline(arg,m,at-1));assert.throws(()=>assertNextOnline(arg,m,at+90001));
  assertNextAvailable(r,at+40*60000,at+5*60000);assert.throws(()=>assertNextAvailable(r,at+40*60000+1,at));
  assert.throws(()=>assertNextAvailable({...r,humanReadyUntil:r.humanReadyUntil+1},r.humanReadyUntil,at));
});
test('next intent retains normal rollback and exact two-resource policy with distinct token',async()=>{
  const {m,at}=await fixture(),r=cycleUpdateRequest(m,at);assert.equal(r.ClientRequestToken,'platform-next-cycle-'+m.nonce);
  assert.equal(r.DisableRollback,false);assert(!('RoleARN'in r));assert(!('Capabilities'in r));
  assert.deepEqual(JSON.parse(r.StackPolicyDuringUpdateBody).Statement.map(v=>v.Resource),['LogicalResourceId/TaskDefinition','LogicalResourceId/Service']);
});
test('expired availability stops before slot and update through actual orchestration',async()=>{
  const {m,at}=await fixture(),online=assertNextOnline({'--human-online-at-ms':String(at)},m,at),clock=at+10*60000;
  let claimed=0,updated=0,closed=0;
  const run=createCycleRun({manifest:m,approved:m.manifestSha256,cycle:NEXT_CYCLE,validateReview:validateNextCycleReview,now:()=>clock,io:{
    guard:async()=>{},preflight:async()=>({checkedAt:clock,lastUpdatedTime:new Date(at).toISOString()}),
    claim:async()=>{assertNextAvailable(online,clock+31*60000,clock);claimed++;},update:async()=>{updated++;},record:async()=>{},
    counts:()=>({claimed,updated}),close:async()=>{closed++;}}});
  const result=await run();assert.equal(result.phase,'PERMANENT_CLAIM');assert.equal(claimed,0);assert.equal(updated,0);assert.equal(closed,1);
});
test('successor profile is fixed in entry and online check precedes private and cloud clients',async()=>{
  const local=await readFile(new URL('../ops/platform-review-v6/cycle-local.mjs',import.meta.url),'utf8');
  assert(local.indexOf('cfg.assertOnline(a,m,Date.now())')<local.indexOf('cloud=await cycleCloud('));
  assert(local.includes('cfg.assertAvailable(online,intent.controlLease.expiresAt,Date.now())'));
  const entry=await readFile(new URL('../ops/platform-review-v6/cycle-next-local.mjs',import.meta.url),'utf8');
  assert(entry.includes('executeCycleMain(args,PROTOCOL)'));assert.doesNotMatch(entry,/process.env|JSON.parse/);
  const saved=await readFile(new URL('../ops/platform-review-v6/cycle-next-preparation.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(saved,/readFile|GetSecretValue|new .*Client|\.connect\(|fetch\(/);
});
