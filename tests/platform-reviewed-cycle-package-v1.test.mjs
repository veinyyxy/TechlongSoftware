import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {createA604Policy} from '../ops/platform-a604-operator-v1/policy.mjs';
import {createHandoffProfile} from '../ops/platform-a604-handoff-v1/profile.mjs';
import {makeOperatorReview} from '../ops/platform-request-v6/transfer-entry.mjs';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {REQUEST_SOURCE as R,REQUEST_ENTRY} from '../ops/platform-reviewed-cycle-v1/request-source.mjs';
import {createCyclePackagePlanner,archivedControlHistory} from '../ops/platform-reviewed-cycle-v1/package.mjs';
import {parsePackageSavedArgs} from '../ops/platform-reviewed-cycle-v1/package-saved.mjs';
import {createReviewedCycle,assertPublication} from '../ops/platform-reviewed-cycle-v1/cycle.mjs';
import {recoveryBasisCompiler} from '../ops/platform-recovery-v1/basis-core.mjs';
import {rebuildRecoveryPackage} from '../ops/platform-recovery-v1/package.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
async function fixture(){
  const f=await a604Fixture(),at=f.at+3*3600000,seed=await createA604Policy({publication:f.publication,profile:f.profile}).seed(f.at),
    before=normalizedState({...f.projection,jobs:f.observed.jobs});
  before.ledger.plans.push({plan_sha:seed.planSha256,action_sha:seed.actionSha256,risk_sha:seed.plan.riskSha256,body:seed.plan,job_id:R.target.oldJobId,mode:'Review'});
  before.ledger.approvals.push({plan_sha:seed.planSha256,admin_id:ADMIN});
  before.ledger.attempts.push({plan_sha:seed.planSha256,job_id:R.target.oldJobId,mode:'Review',state:'ACKNOWLEDGED',run_id:'123456797',run_status:null,conclusion:null,proof_sha:null});
  const state=normalizedState(before),facts={...R.facts,checkedAt:at-1,expiresAt:at+5*3600000,jobCount:state.jobs.length,
    baselineSha256:await sha256Hex(state),ledgerSha256:await sha256Hex(state.ledger),protection:state.protection,reviewPlanSha256:seed.planSha256,reviewRunId:'123456797'},
    p=createHandoffProfile(facts,{target:R.target,entry:REQUEST_ENTRY,successfulPredecessor:f.profile.oldJobId}),program=await p.compile(state,at),
    after=structuredClone(state),old=after.jobs.find(j=>j.id===R.target.oldJobId);
  Object.assign(old,{status:'canceled',completed_at:at,updated_at:at});
  after.jobs.push({...old,id:R.target.newJobId,dedupe_key:'express-initialized-v2:'+R.target.requestId,status:'pending',payload:program.insert.payload,
    created_at:at,updated_at:at,completed_at:null,last_error_code:null,last_error_message:null});
  const review=await makeOperatorReview({baseline:state,sourceCommit:f.sourceCommit,createdAt:at,
    pins:Array.from({length:12},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),
    ci:{sourceCommit:f.sourceCommit,runId:'123',jobId:'456',attempt:1,status:'completed',conclusion:'success'},auth:{contentRead:false,length:100,aclSha256:'b'.repeat(64)}},p),
    inspection={...await p.verifyReadback(state,after,at),outcome:'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'},
    input={originalPackage:f.pkg,sealRawSha256:'c'.repeat(64),createdAt:at+2000,handoff:{review,approved:review.manifestSha256,
      intent:{at,oldJobId:R.target.oldJobId,newJobId:R.target.newJobId,baselineSha256:facts.baselineSha256},after,inspection,databaseObservedAt:at+1000}},
    plan=createCyclePackagePlanner({requestProfile:p,anchor:f.profile,originalSha256:await sha256Hex(f.pkg)});
  return {f,p,at,input,plan};
}
test('real-shaped handoff rebuilds the original evidence chain while preserving every old row and anchor',async()=>{
  const {f,at,input,plan}=await fixture(),r=await plan(input),p=r.sourceCandidate.profile;
  assert.equal(p.oldJobId,f.profile.oldJobId);assert.equal(p.newJobId,R.target.newJobId);assert.equal(p.factsAt,at);
  assert.equal(p.databaseCheckedAt,at+1000);assert.equal(p.observedBy,at+1000);assert.equal(r.proposedNewExpiresAt,at+48*3600000);
  assert.equal(r.originalPackageBasisExpiresAt,f.pkg.basis.expiresAt);assert.equal(r.newFactsWindowApproved,false);
  assert.equal(r.packageValue.inputs.state.jobs.find(j=>j.id===R.target.oldJobId).status,'canceled');
  assert(!r.packageValue.inputs.state.jobs.some(j=>j.id===R.target.newJobId));
  assert.deepEqual(r.packageValue.inputs.state.ledger,input.handoff.after.ledger);
  assert.deepEqual(await rebuildRecoveryPackage(r.packageValue,recoveryBasisCompiler(p)),r.packageValue.basis);
  assert.equal(r.sourceCandidate.requestEvidence.afterSha256,await sha256Hex(normalizedState(input.handoff.after)));
  assert.equal(r.executionAuthorized,false);assert.equal(r.approvedForUpload,false);assert.equal(r.sourceCandidate.publication.packageReference,null);
  const cycle=await createReviewedCycle(r.sourceCandidate,{anchor:f.profile});
  await assert.rejects(assertPublication(cycle,r.sourceCandidate.publication,at+2000),/PUBLICATION/);
});
for(const fault of ['old-row','inspection','object','clock','preparation-expired'])test(fault+' cannot be normalized into an upload candidate',async()=>{
  const {p,input,plan}=await fixture(),v=structuredClone(input);
  if(fault==='old-row')v.handoff.after.jobs.find(j=>j.id===R.target.oldJobId).status='succeeded';
  if(fault==='inspection')v.handoff.inspection.outcome='SUMMARY_ONLY';
  if(fault==='object')v.originalPackage.objects[0].object.value={forged:true};
  if(fault==='clock')v.handoff.databaseObservedAt=v.handoff.intent.at-1;
  if(fault==='preparation-expired')v.createdAt=p.facts.expiresAt;
  await assert.rejects(plan(v));
});
test('archived history keeps more than twelve plans with exact slot precedence and run status',()=>{
  const plans=Array.from({length:14},(_,i)=>({plan_sha:String(i),job_id:'job-history',mode:'Review',body:{sourceCommit:'a'.repeat(40),expiresAt:1}})),
    state={ledger:{plans,attempts:[{plan_sha:'0',job_id:'job-history',mode:'Review',state:'OBSERVED',run_id:'123',run_status:'completed',conclusion:'success',proof_sha:'b'.repeat(64)}]}};
  const r=archivedControlHistory(state,2);assert.equal(r.length,14);assert.equal(r[0].runStatus,'completed');
  assert.equal(r[0].state,'OBSERVED');assert.equal(r[13].state,'SLOT_OCCUPIED');assert.equal(r[13].proofSha256,null);
});
test('local preparation entry accepts no mutation, arbitrary target, secret or source flags',()=>{
  for(const flag of ['--mode','--job','--profile','--manifest','--approved-sha','--reset-slot'])assert.throws(()=>parsePackageSavedArgs([flag,'x']));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-reviewed-cycle-v1/package-saved.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.productionReads+v.configurationContentReads+v.sqlConnections+v.awsCalls+v.uploads+v.dispatches,0);
});
