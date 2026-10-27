import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {delegatedPublisherFixture} from './fixtures/platform-delegated-publisher-v1.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {createTransferTransaction} from '../ops/platform-request-v6/transfer.mjs';
import {makeOperatorReview,runOperatorMode} from '../ops/platform-request-v6/transfer-entry.mjs';
import {createHandoffProfile,FACTS,ENTRY} from '../ops/platform-a604-handoff-v1/profile.mjs';
import {TARGET,SUCCESSFUL_PREDECESSOR,CLOUD_CANDIDATE,assertPublishedCandidate} from '../ops/platform-a604-handoff-v1/coordinates.mjs';
import {createBindingPlanner} from '../ops/platform-a604-handoff-v1/binding-candidate.mjs';
import {parseArgs,readSavedBaseline,readCandidateSnapshot} from '../ops/platform-a604-handoff-v1/local.mjs';
async function fixture(){
  const f=await delegatedPublisherFixture();f.tick(3*3600000);
  // The shared synthetic recovery fixture deliberately uses a fictitious
  // predecessor. This exact-profile test names the real fixed coordinate;
  // no production facts, hashes or profile guard are weakened for fixtures.
  f.state.jobs.find(j=>j.id===f.profile.oldJobId).id=SUCCESSFUL_PREDECESSOR;
  const history=f.state.deployment.outputs.expressInitializedWorkerRunsV2,receipt=history[f.profile.oldJobId];
  delete history[f.profile.oldJobId];history[SUCCESSFUL_PREDECESSOR]={...receipt,jobId:SUCCESSFUL_PREDECESSOR};
  f.state.deployment.admissionSnapshot.predecessorJob.id=SUCCESSFUL_PREDECESSOR;
  const before=normalizedState(f.state),at=f.now();
  const facts={...FACTS,sourceCommit:f.sourceCommit,observedAt:at-5000,checkedAt:at,databaseCheckedAt:at-4000,expiresAt:at+3600000,
    jobCount:before.jobs.length,baselineSha256:await sha256Hex(before),ledgerSha256:await sha256Hex(before.ledger),
    protection:before.protection,reviewPlanSha256:f.entry.planSha256,reviewRunId:f.runId,historicalPlanSha256:f.old.planSha256};
  const profile=createHandoffProfile(facts),calls=[],records=[];let state=structuredClone(before),failCommit=false;
  const client={query:async(text,values)=>{calls.push(text);
    if(text.includes('clock_timestamp()')&&text.startsWith('SELECT floor'))return {rows:[{at}],rowCount:1};
    if(text.startsWith('SELECT id FROM public.deployment_jobs'))return {rows:state.jobs.map(j=>({id:j.id})),rowCount:state.jobs.length};
    if(text.startsWith('UPDATE public.deployment_jobs')){const j=state.jobs.find(j=>j.id===TARGET.oldJobId);Object.assign(j,{status:'canceled',updated_at:at,completed_at:at});return {rows:[{id:j.id}],rowCount:1};}
    if(text.includes('INSERT INTO public.deployment_jobs')){state.jobs.push({id:TARGET.newJobId,deployment_id:state.deployment.id,job_type:'reconcile',
      dedupe_key:'express-initialized-v2:'+TARGET.requestId,status:'pending',payload:JSON.parse(values[3]),attempts:0,max_attempts:1,available_at:Number.MAX_SAFE_INTEGER,
      lease_owner:null,lease_token:null,lease_expires_at:null,completed_at:null,created_at:at,updated_at:at,last_error_code:null,last_error_message:null});return {rowCount:1};}
    if(text==='COMMIT'&&failCommit)throw Error('SYNTHETIC_COMMIT_UNKNOWN');
    if(text==='ROLLBACK')state=structuredClone(before);return {rows:[],rowCount:1};}};
  const transaction=createTransferTransaction({client,readState:async()=>structuredClone(state),profile,now:()=>at,record:async(name,value)=>records.push({name,value})});
  const review=()=>makeOperatorReview({baseline:before,sourceCommit:f.sourceCommit,pins:Array.from({length:12},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),
    ci:{runId:'123',jobId:'456',sourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},auth:{contentRead:false,length:100,aclSha256:'b'.repeat(64)},createdAt:at},profile);
  return {...f,at,before,facts,profile,calls,records,client,transaction,review,getAfter:()=>normalizedState(state),failCommit:()=>{failCommit=true;}};
}
test('fixed profile preserves predecessor and does not reset expiry or reuse historical slots',async()=>{
  const f=await fixture();await f.profile.assertState(f.before,f.at);
  assert.equal(TARGET.newJobId,'job_a60423b885fef3e4326213f7');assert.equal(SUCCESSFUL_PREDECESSOR,'job_9db8466fd95cef0c23ad6bfc');
  assert.equal(FACTS.expiresAt,1793126877695);assert.notEqual(ENTRY.slot,ENTRY.inspectSlot);assert(!ENTRY.slot.includes('w8y'));
  assert(Object.isFrozen(f.profile.facts.protection));assert.equal((await f.review()).core.cloudRuntimeCompatible,false);
});
for(const fault of ['history','attempt','job','protection','candidate','expiry'])test('fixed profile rejects '+fault+' before SQL compilation',async()=>{
  const f=await fixture(),s=structuredClone(f.before);let at=f.at;
  if(fault==='history')s.ledger.plans.shift();if(fault==='attempt')s.ledger.attempts.at(-1).proof_sha='a'.repeat(64);
  if(fault==='job')s.jobs.find(j=>j.id===TARGET.oldJobId).attempts=1;if(fault==='protection')s.protection.catalogSha256='a'.repeat(64);
  if(fault==='candidate')s.jobs.push({...s.jobs[0],id:TARGET.newJobId});if(fault==='expiry')at=f.facts.expiresAt;
  await assert.rejects(f.profile.compile(s,at));assert.deepEqual(f.calls,[]);
});
test('shared serializable transaction changes exactly old held row and inserts a held candidate',async()=>{
  const f=await fixture(),r=await f.transaction({baseline:f.before,assertApproved:async()=>{}});
  assert.equal(r.outcome,'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK',JSON.stringify(r));
  await f.profile.verifyReadback(f.before,f.getAfter(),f.at);
  assert(f.calls.includes('BEGIN ISOLATION LEVEL SERIALIZABLE'));assert(f.calls.some(q=>q.startsWith('LOCK TABLE deployment_control_v6.plans')));
  assert.equal(f.calls.filter(q=>q.startsWith('UPDATE public.deployment_jobs')).length,1);
  assert.equal(f.calls.filter(q=>q.includes('INSERT INTO public.deployment_jobs')).length,1);
  assert.deepEqual(f.getAfter().ledger,f.before.ledger);assert.equal(f.getAfter().jobs.find(j=>j.id===TARGET.newJobId).available_at,Number.MAX_SAFE_INTEGER);
});
test('unknown commit is not rolled back or retried and can be independently read back',async()=>{
  const f=await fixture();f.failCommit();const r=await f.transaction({baseline:f.before,assertApproved:async()=>{}});
  assert.equal(r.outcome,'TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK');assert(!f.calls.includes('ROLLBACK'));
  assert.equal(f.calls.filter(q=>q==='COMMIT').length,1);await f.profile.verifyReadback(f.before,f.getAfter(),f.at);
});
test('writer and independent inspector use separate opens and keep candidate execution unapproved',async()=>{
  const f=await fixture(),m=await f.review();let opens=0,closes=0,claim,inspectClaims=0;
  const io={assertSource:async()=>{},verifyCi:async()=>{},authMetadata:async()=>m.auth,record:async(name,value)=>f.records.push({name,value}),
    open:async()=>{opens++;return {readOnly:async()=>f.getAfter(),transaction:f.transaction,close:async()=>{closes++;}};},
    claimWrite:async value=>{claim=value;},claimInspect:async()=>{inspectClaims++;},writerReceipt:async()=>({claim,intent:f.records.find(r=>r.name==='transfer-intent').value})};
  const writer=await runOperatorMode({mode:'RunReviewed',manifest:m,approved:m.manifestSha256,io,now:()=>f.at,profile:f.profile});
  assert.equal(writer.committed,true,JSON.stringify(writer));
  const inspect=await runOperatorMode({mode:'Inspect',manifest:m,approved:m.manifestSha256,io,now:()=>f.at,profile:f.profile});
  assert.equal(inspect.outcome,'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY',JSON.stringify(inspect));assert.equal(inspect.executionApproved,false);
  assert.equal(opens,2);assert.equal(closes,2);assert.equal(inspectClaims,1);
});
test('binding candidate requires real after-state/inspection and never promotes the unexecuted9b request',async()=>{
  const f=await fixture(),m=await f.review();await f.transaction({baseline:f.before,assertApproved:async()=>{}});
  const plan=createBindingPlanner(f.profile),intent=f.records.find(r=>r.name==='transfer-intent').value;
  const input={review:m,approved:m.manifestSha256,intent,after:f.getAfter(),databaseObservedAt:f.at+1000,
    inspection:{outcome:'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY',oldJobId:TARGET.oldJobId,newJobId:TARGET.newJobId}};
  const r=await plan(input);assert.equal(r.state,'UNPUBLISHED');assert.equal(r.proposedProfile.oldJobId,SUCCESSFUL_PREDECESSOR);
  assert.equal(r.proposedProfile.newJobId,TARGET.newJobId);assert.equal(r.handoff.projectionIsDatabaseSnapshot,false);assert.equal(r.executionAuthorized,false);
  assert.equal(r.requiresNewFactsWindowApproval,true);assert.equal(r.originalBasisExpiry,f.facts.expiresAt);
  for(const mutate of [x=>x.after.jobs.find(j=>j.id===TARGET.oldJobId).status='succeeded',x=>x.inspection.outcome='SUMMARY_ONLY',x=>x.databaseObservedAt=f.at-1]){
    const x=structuredClone(input);mutate(x);await assert.rejects(plan(x));}
  assert.throws(()=>assertPublishedCandidate({...CLOUD_CANDIDATE,state:'PUBLISHED'}),/NOT_PUBLISHED/);
});
test('saved baseline needs the exact seal and every raw artifact, not a hand-edited summary',async()=>{
  const f=await fixture(),snapshot={observedAt:f.facts.observedAt,checkedAt:f.facts.checkedAt,databaseCheckedAt:f.facts.databaseCheckedAt,sourceCommit:f.facts.sourceCommit,state:f.before};
  const files=new Map();const inventory=[];
  for(let n=0;n<10;n++){const name=n===0?'snapshot.json':'proof-'+n+'.json',raw=JSON.stringify(n===0?snapshot:{synthetic:n});files.set(f.facts.evidenceRoot+'/'+name,raw);inventory.push({file:name,rawSha256:await sha256Hex(raw)});}
  const seal=JSON.stringify({outcome:'FRESH_BASELINE_AND_FIXED_HANDOFF_PROPOSAL_VERIFIED_NOT_EXECUTABLE',sourceCommit:f.facts.sourceCommit,
    baselineSha256:f.facts.baselineSha256,checkedAt:f.facts.checkedAt,candidateJobId:TARGET.newJobId,candidateExists:false,
    actualCounts:{configurationContentReads:1,verifiedTlsReadonlyConnections:1,databaseWrites:0},rawInventory:inventory});
  const facts={...f.facts,sealRawSha256:await sha256Hex(seal)},profile=createHandoffProfile(facts);files.set(facts.sealFile,seal);
  assert.deepEqual(await readSavedBaseline(async file=>files.get(file),profile),f.before);
  files.set(f.facts.evidenceRoot+'/snapshot.json','{}');await assert.rejects(readSavedBaseline(async file=>files.get(file),profile));
});

test('snapshot includes candidate ledger so a racing new plan cannot evade independent verification',async()=>{
  const f=await fixture();await f.transaction({baseline:f.before,assertApproved:async()=>{}});
  const clocks=[],extra={...f.before.ledger.plans[0],job_id:TARGET.newJobId},calls=[];
  const client={query:async(text,values)=>{calls.push({text,values});return {rows:text.startsWith('SELECT floor')?[{at:f.at+1000}]:
    [{foreign_candidate:false,plans:[extra],approvals:[],attempts:[]}]};}};
  const s=await readCandidateSnapshot(client,{},clocks,async()=>structuredClone(f.getAfter()));
  assert.equal(s.ledger.plans.length,f.before.ledger.plans.length+1);assert.deepEqual(clocks,[f.at+1000]);
  assert.deepEqual(calls[1].values,[TARGET.newJobId,s.deployment.id,'express-initialized-v2:'+TARGET.requestId]);
  await assert.rejects(f.profile.verifyReadback(f.before,s,f.at),/PRESERVED_ROWS/);
});

test('snapshot rejects foreign candidate/dedupe occupancy and unbounded candidate history',async()=>{
  const f=await fixture();
  for(const row of [{foreign_candidate:true,plans:[],approvals:[],attempts:[]},
    {foreign_candidate:false,plans:Array(9).fill({}),approvals:[],attempts:[]}]){
    const c={query:async text=>({rows:text.startsWith('SELECT floor')?[{at:f.at}]:[row]})};
    await assert.rejects(readCandidateSnapshot(c,{},[],async()=>structuredClone(f.before)));
  }
});
test('CLI has no selectable job, profile, facts, expiry or runtime bypass',()=>{
  assert.equal(parseArgs(['--check']).mode,'Check');
  for(const args of [[],['--mode','Prepare'],['--mode','PrepareSaved','--ci-run','1','--output','x'],
    ['--mode','PrepareSaved','--ci-run','1','--output','F:/ChatGPT_workshop/techlong-a604-handoff-a','--profile','new']])assert.throws(()=>parseArgs(args));
});
test('check reports unpublished candidate with no private, SQL, AWS or dispatch side effect',()=>{
  const p=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-a604-handoff-v1/local.mjs','--check'],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.privateReads+r.sqlConnections+r.awsCalls+r.dispatches,0);assert.equal(r.runtimeCompatible,false);
});
