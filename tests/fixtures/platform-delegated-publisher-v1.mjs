import {recoveryControlFixture} from './platform-recovery-control-v1.mjs';
import {compileRecoveryRequest} from '../../ops/platform-recovery-v1/request.mjs';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ORIGINAL_REQUEST} from '../../ops/platform-recovery-launch-v1/request-evidence.mjs';
import {createPublisherOperations} from '../../ops/platform-delegated-publisher-v1/operation.mjs';
import {resultKeyV6} from '../../ops/platform-cloud-v6/contract.mjs';
export async function delegatedPublisherFixture(){
  const f=await recoveryControlFixture(),q=f.writes.find(q=>q.text.includes('publish_plan')&&JSON.parse(q.values[3]).mode==='Review');
  const seed=await validatePlan(JSON.parse(q.values[3]),f.release,f.at),runId='123456797';
  const entry={...seed,riskSha256:seed.plan.riskSha256,attempt:{state:'ACKNOWLEDGED',runId,status:null,conclusion:null,proofSha256:null}};
  const old=await validatePlan({...seed.plan,sourceCommit:'9'.repeat(40),preparedAt:f.at-7200000,expiresAt:f.at-1},f.release,f.at-7200000);
  const state=f.makeAfter(await compileRecoveryRequest(f.basis,f.at)),effects=[],records=[],entries=new Map([[seed.planSha256,entry]]);
  const row=v=>({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,job_id:v.plan.jobId,mode:v.plan.mode,
    body:structuredClone(v.plan),expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(v.plan.preparedAt).toISOString()});
  state.ledger.plans.push(row(old),row(seed));state.ledger.approvals.push({plan_sha:seed.planSha256,admin_id:ADMIN,approved_at:new Date(f.at).toISOString()});
  state.ledger.attempts.push({plan_sha:seed.planSha256,job_id:seed.plan.jobId,mode:'Review',state:'ACKNOWLEDGED',run_id:runId,
    run_status:null,conclusion:null,proof_sha:null,started_at:new Date(f.at).toISOString(),observed_at:null});
  const api=createPublisherOperations({historicalPlanShas:[old.planSha256]});
  const requestEvidence={schema:'techlong/original-recovery-request-evidence/v1',...ORIGINAL_REQUEST,transactionAt:f.at,basisSha256:f.basis.basisSha256,artifactsVerified:12};
  const key=resultKeyV6(seed.plan.jobId,f.envelope.recoveryReviewSha256,runId),object=f.objects.get(key);
  const ref={key,versionId:object.versionId,sha256:await sha256Hex(object.value)};
  const readback=()=>state.ledger.attempts.find(a=>a.plan_sha===seed.planSha256);
  const db={snapshot:async()=>structuredClone(state),loadPlan:async sha=>structuredClone(entries.get(sha)),
    observe:async()=>{effects.push('observe');Object.assign(entry.attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
      Object.assign(readback(),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(f.at).toISOString()});},
    writeOwner:async query=>{if(query.text.includes('attest_evidence')){effects.push('proof');entry.attempt.proofSha256=query.values[1];readback().proof_sha=query.values[1];}
      else{effects.push('publish');const v=await validatePlan(JSON.parse(query.values[3]),f.release,f.now());
        entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});state.ledger.plans.push(row(v));}},close:async()=>effects.push('db-close')};
  const io={assertSource:async()=>{},verifyCi:async()=>effects.push('ci'),verifySourceIdentity:async()=>effects.push('sts'),
    open:async()=>{effects.push('open');return db;},claim:async()=>effects.push('claim'),record:async(name,value)=>records.push({name,value}),
    readObject:f.ports.readObject,readRun:async id=>f.rawRun(id),close:async()=>effects.push('io-close')};
  const prepare=()=>api.makeReview({binding:f.binding,basis:f.basis,baseline:structuredClone(state),reviewEntry:structuredClone(entry),requestEvidence,
    action:{operation:'AdvanceReview',planSha256:seed.planSha256,runId,resultReference:ref},
    timing:{preparedAt:f.envelope.innerManifest.jobPlan.preparedAt,claimBy:f.envelope.innerManifest.jobPlan.claimBy,workloadExpiresAt:f.envelope.innerManifest.workload.workloadExpiresAt},
    pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'1'.repeat(64)})),
    ci:{runId:'123',jobId:'456',sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    auth:{length:100,aclSha256:'2'.repeat(64),contentRead:false},createdAt:f.now()});
  return {...f,api,prepare,io,db,state,entry,old,ref,object,runId,requestEvidence,effects,records,entries,
    run:async(overrides={})=>{const manifest=await prepare();return api.runReviewed({manifest,basis:f.basis,approved:manifest.manifestSha256,io,now:f.now,rebuildPackage:f.rebuild,...overrides});},
    cloneState:()=>JSON.parse(canonicalJson(state))};
}
