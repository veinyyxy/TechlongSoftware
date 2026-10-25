import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cycleFixture} from './fixtures/platform-cycle-v6.mjs';
import {operationsFixtureV6} from './fixtures/platform-operations-v6.mjs';
import {CYCLE_SCOPE,cycleUpdateRequest} from '../ops/platform-review-v6/cycle-plan.mjs';
import {NEXT_CYCLE,validateNextCycleReview} from '../ops/platform-review-v6/cycle-next.mjs';
import {LAUNCH,LAUNCH_BASE,LAUNCH_SLOTS,makeLaunchReview,validateLaunchReview,parseLaunchArgs,assertLaunchOnline,preconfirmedReadiness} from '../ops/platform-review-v6/cycle-launch.mjs';
import {createHostedCycleDriver} from '../ops/platform-review-v6/hosted-driver.mjs';
import {windowLease,K} from '../ops/platform-hosted-window-v6/contract.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
async function fixture(){
  const f=await cycleFixture(),p=structuredClone(f.m.preparation);
  Object.assign(p,{factsAt:f.at,parentClosureSha256:LAUNCH_BASE.closureSha256});
  p.baseline.rootEventId=LAUNCH_BASE.rootEventId;p.baseline.ids.TaskDefinition=LAUNCH_BASE.definition;
  return {...f,m:await makeLaunchReview({...f.m,preparation:p})};
}
test('preconfirmed review binds revision6/root and four new slots without adding side-effect authority',async()=>{
  const {m,at}=await fixture();await validateLaunchReview(m,m.manifestSha256,at);
  for(const [k,v] of Object.entries(CYCLE_SCOPE))assert.deepEqual(m.scope[k],v);
  assert.equal(m.scope.authenticatedPageRecheckedAfterUpdate,false);assert.equal(m.scope.pageConfirmationBeforeWindow,true);
  assert.notEqual(LAUNCH.slot,NEXT_CYCLE.slot);assert.equal(new Set([LAUNCH.slot,LAUNCH.inspectSlot,...Object.values(LAUNCH_SLOTS)]).size,4);
  await assert.rejects(validateNextCycleReview(m,m.manifestSha256,at));
  assert.equal(cycleUpdateRequest(m,at).ClientRequestToken,'platform-preconfirmed-'+m.nonce);
});
for(const [label,change] of Object.entries({root:v=>{v.preparation.baseline.rootEventId='wrong';},
  revision:v=>{v.preparation.baseline.ids.TaskDefinition+='0';},closure:v=>{v.preparation.parentClosureSha256='0'.repeat(64);},
  expiry:v=>{v.preparation.expiresAt++;},retired:v=>{v.executionProfile.additionalRetiredDefinitions.push('unreviewed');},
  before:v=>{v.notBeforeAt--;},scope:v=>{v.scope.parentWorkflowDispatches=1;}}))test('launch rejects '+label+' drift',async()=>{
  const {m,at}=await fixture(),v=structuredClone(m);change(v);await assert.rejects(validateLaunchReview(v,v.manifestSha256,at));
});
test('preparing during old lease is honest; actual Run cannot overlap it or extend audit expiry',async()=>{
  const f=await fixture(),p=structuredClone(f.m.preparation);p.baseline.oldLease.expiresAt=f.at+60000;
  const m=await makeLaunchReview({...f.m,preparation:p});assert.equal(m.notBeforeAt,f.at+60000);
  await assert.rejects(validateLaunchReview(m,m.manifestSha256,f.at));await validateLaunchReview(m,m.manifestSha256,f.at,{inspect:true});
  await validateLaunchReview(m,m.manifestSha256,m.notBeforeAt);await assert.rejects(validateLaunchReview(m,m.manifestSha256,m.latestStartAt));
  const later=await makeLaunchReview({...m,createdAt:f.at+120000});assert.equal(later.expiresAt,m.expiresAt);
});
test('CLI requires fresh online plus explicit pre-window page argument; ConfirmPage and retry cannot run',()=>{
  const run=['--mode','RunReviewed','--manifest','m','--approved-sha','s','--output','o','--human-online-at-ms','1792903000000'];
  assert.equal(parseLaunchArgs([...run,'--page-viewed-before-window','yes'])['--page-viewed-before-window'],'yes');
  for(const args of [run,[...run,'--page-viewed-before-window','no'],[...run,'--page-viewed-before-window','yes','--retry','yes'],
    [...run,'--page-viewed-before-window','yes','--page-viewed-before-window','yes'],
    ['--mode','ConfirmPage','--manifest','m','--approved-sha','s','--ready-through-lease','yes']])assert.throws(()=>parseLaunchArgs(args));
  assert.equal(parseLaunchArgs(['--mode','Prepare','--ci-run','123','--output','o'])['--mode'],'Prepare');
});
async function readyFixture(){
  const {m,at}=await fixture(),online=assertLaunchOnline({'--human-online-at-ms':String(at),'--page-viewed-before-window':'yes'},m,at);
  return {manifest:m,online,manifestSha256:m.manifestSha256,scope:{sourceCommit:m.sourceCommit,jobId:LAUNCH.jobId},
    lease:windowLease(at,m.sourceCommit),release:m.binding.platform,hosting:{stackId:K.stackId,taskDefinition:LAUNCH_BASE.definition.replace(':6',':7')},checkedAt:at+300000};
}
test('readiness truthfully separates pre-window human view from post-update public probe',async()=>{
  const f=await readyFixture(),r=await preconfirmedReadiness(f);assert.equal(r.schema,'techlong/hosted-preconfirmed-readiness/v6');
  assert.equal(r.pageViewedBeforeWindow,true);assert.equal(r.authenticatedPageRecheckedAfterUpdate,false);assert(!('pageOpened'in r));
  assert.equal(r.notPlanApproval,true);assert.equal(r.humanReadyUntil,f.lease.expiresAt);
  assert.throws(()=>assertLaunchOnline({'--human-online-at-ms':String(f.online.confirmedAt)},f.manifest,f.online.confirmedAt));
});
for(const [label,change] of Object.entries({page:f=>{f.online.pageViewedBeforeWindow=false;},manifest:f=>{f.online.manifestSha256='0'.repeat(64);},
  source:f=>{f.scope.sourceCommit='0'.repeat(40);},release:f=>{f.release={...f.release,actorId:'1'};},
  availability:f=>{f.online.humanReadyUntil=f.lease.expiresAt-1;},future:f=>{f.online.confirmedAt=f.lease.issuedAt+1;},
  late:f=>{f.checkedAt=f.lease.issuedAt+480000;},hosting:f=>{f.hosting.stackId='wrong';}}))test('preconfirmed readiness rejects '+label,async()=>{
  const f=await readyFixture();change(f);await assert.rejects(preconfirmedReadiness(f));
});
test('actual driver probes first, publishes without second page wait, and still waits for both manual approvals',async()=>{
  const f=await operationsFixtureV6(),stages=[],scope={sourceCommit:f.sourceCommit,jobId:LAUNCH.jobId},lease=windowLease(f.at,f.sourceCommit);
  // Synthetic release is bound honestly into its own lease, never a live port.
  const {sha256Hex}=await import('../lib/deployments/execution/hash.ts');lease.releaseSha256=await sha256Hex(f.release);
  const m={manifestSha256:'a'.repeat(64),sourceCommit:f.sourceCommit,binding:{platform:f.release}},online=assertLaunchOnline({
    '--human-online-at-ms':String(f.at),'--page-viewed-before-window':'yes'},m,f.at),hosting={stackId:K.stackId,taskDefinition:LAUNCH_BASE.definition};
  let probe=false,readyLoads=0,review,next,publishedAt,runAt;
  const live={ports:{},readRun:f.ports.readRun,discover:async()=>({}),loadPlan:async sha=>{const p=sha===review.planSha256?review:next,
    at=sha===review.planSha256?publishedAt:runAt;return {...p,riskSha256:f.release.riskSha256,
      attempt:f.now()<at+120000?null:{state:'ACKNOWLEDGED',runId:sha===review.planSha256?'123456789':'123456790'}};}};
  const driver=createHostedCycleDriver({...f,scope,manifestSha256:m.manifestSha256,live,loadReady:async()=>{readyLoads++;throw Error('NO_SECOND_PAGE_WAIT');},
    probePage:async()=>{probe=true;},preconfirmedReadiness:async input=>{assert(probe);return preconfirmedReadiness({...input,manifest:m,online});},
    record:async(n,v)=>stages.push({n,v}),sleep:async ms=>f.tick(ms),
    publishReview:async()=>{publishedAt=f.now();review=await validatePlan({...f.basePlan,jobId:LAUNCH.jobId,inputs:{...f.basePlan.inputs,job:LAUNCH.jobId},
      preparedAt:f.now(),expiresAt:f.now()+7200000},f.release,f.now());return review;},
    bridgeFactory:()=>({async once(){runAt=f.now();const p={...structuredClone(review.plan),mode:'RunOnce',preparedAt:f.now(),expiresAt:f.now()+420000,
      predecessor:{planSha256:review.planSha256,runId:'123456789',proofSha256:'a'.repeat(64)}};
      p.inputs.mode='RunOnce';p.inputs.manifest=canonicalJson({...f.manifestReference,key:f.manifestReference.key.replace(f.basePlan.jobId,LAUNCH.jobId)});p.inputs.manifestSha=f.manifest.manifestSha256;
      next=await validatePlan(p,f.release,f.now());return {outcome:'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL',planSha256:next.planSha256,expiresAt:p.expiresAt};}})});
  const out=await driver({lease,hosting,signal:new AbortController().signal});assert.equal(readyLoads,0);assert.equal(publishedAt,f.at);
  assert.equal(runAt,f.at+120000);assert.equal(f.now(),f.at+240000);assert.equal(out.workflowDispatchesByParent,0);assert.equal(out.deploymentAccepted,false);
  assert.deepEqual(stages.map(v=>v.n),['preconfirmed-page-readiness-verified','awaiting-human-review-plan','awaiting-human-runonce-plan']);
});
test('probe failure cannot invoke preconfirmation or publication',async()=>{
  const f=await operationsFixtureV6();let reads=0,writes=0;
  const d=createHostedCycleDriver({...f,manifestSha256:'a'.repeat(64),live:{},loadReady:async()=>null,record:async()=>{},
    probePage:async()=>{throw Error('probe_failed');},preconfirmedReadiness:async()=>{reads++;},publishReview:async()=>{writes++;}});
  const lease=windowLease(f.at,f.sourceCommit);const {sha256Hex}=await import('../lib/deployments/execution/hash.ts');lease.releaseSha256=await sha256Hex(f.release);
  await assert.rejects(d({lease,hosting:{},signal:new AbortController().signal}));assert.equal(reads,0);assert.equal(writes,0);
});
test('production entry fixes new strategy in code, not manifest flags, and rejects ConfirmPage',async()=>{
  const entry=await readFile(new URL('../ops/platform-review-v6/cycle-launch-local.mjs',import.meta.url),'utf8');
  assert(entry.includes('executeCycleMain(args,PROTOCOL)'));assert.doesNotMatch(entry,/process.env|JSON.parse/);
  const driver=await readFile(new URL('../ops/platform-review-v6/hosted-driver.mjs',import.meta.url),'utf8');
  assert(driver.indexOf('await probePage()')<driver.indexOf('ready=await preconfirmedReadiness('));
});
