// Synthetic completed workload from the ORIGINAL claim/completion compiler.
// Never production rows or AWS/Neon simulation clients.
import {a604Fixture} from './platform-a604-cloud-v1.mjs';
import {createA604Runtime} from '../../ops/platform-a604-cloud-v1/runtime.mjs';
import {createA604Publisher} from '../../ops/platform-a604-cloud-v1/control.mjs';
import {createA604InspectPublisherOperations,REQUEST_EVIDENCE} from '../../ops/platform-a604-operator-v1/publisher.mjs';
import {compilePlatformInitializedClaimV4,compilePlatformInitializedCompleteV4} from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {normalizedState} from '../../ops/platform-request-v6/state-contract.mjs';
import {D} from '../../ops/platform-a604-operator-v1/scope.mjs';
export async function inspectPublisherFixture(){
  const f=await a604Fixture(),entries=new Map(),writes=[],records=[];let state=normalizedState({...f.projection,jobs:f.observed.jobs}),failedAt=null,tracking=false,at=f.at;
  const row=v=>({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,job_id:D.jobId,mode:v.plan.mode,
    body:structuredClone(v.plan),expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(v.plan.preparedAt).toISOString()});
  const writeOwner=async q=>{const proof=q.text.includes('attest_evidence'),phase=proof?'proof':'publish';
    if(tracking){writes.push(phase);if(failedAt===phase)throw Error('SYNTHETIC_UNKNOWN_'+phase);}
    if(proof){entries.get(q.values[0]).attempt.proofSha256=q.values[1];state.ledger.attempts.find(a=>a.plan_sha===q.values[0]).proof_sha=q.values[1];}
    else{const v=await validatePlan(JSON.parse(q.values[3]),f.release,at);entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});state.ledger.plans.push(row(v));}};
  const loadPlan=async sha=>structuredClone(entries.get(sha));
  const publisher=await createA604Publisher({basis:f.basis,publication:f.publication,profile:f.profile,now:f.now,
    ports:{guard:async()=>{},readObject:f.readObject,readRun:async id=>f.rawRun(id),readHeldJob:async()=>f.observed,loadPlan,writeOwner}});
  function attempt(v,id,observed){
    entries.get(v.planSha256).attempt={state:observed?'OBSERVED':'ACKNOWLEDGED',runId:id,status:observed?'completed':null,conclusion:observed?'success':null,proofSha256:null};
    state.ledger.approvals.push({plan_sha:v.planSha256,admin_id:D.admin,approved_at:new Date(f.at).toISOString()});
    state.ledger.attempts.push({plan_sha:v.planSha256,job_id:D.jobId,mode:v.plan.mode,state:observed?'OBSERVED':'ACKNOWLEDGED',run_id:id,
      run_status:observed?'completed':null,conclusion:observed?'success':null,proof_sha:null,observed_at:observed?new Date(f.at).toISOString():null});
  }
  const seed=await publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef});
  const reviewed=await createA604Runtime({publication:f.publication,profile:f.profile,now:f.now}).run({env:f.env,closure:f.closure,ports:f.ports});
  const envelope=f.puts[0].value,inner=envelope.innerManifest;attempt(seed,'123456797',true);
  await publisher.attestResult(seed.planSha256,reviewed.saved);const runPlan=await publisher.publishSuccessor(seed.planSha256,reviewed.saved);
  const token='lease_'+'0'.repeat(32),doneAt=f.at+1000,claim=await compilePlatformInitializedClaimV4({plan:inner.jobPlan,queuedJob:inner.queue.row,
    approvedPlanSha256:inner.jobPlan.planSha256,leaseToken:token});
  const proof={materialSha256:inner.jobPlan.materialSha256,jobId:D.jobId,leaseToken:token,
    stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/22222222-3333-4444-8555-666666666666',
    workloadExpiresAt:inner.workload.workloadExpiresAt,imageUri:inner.jobPlan.material.images.app,configurationHash:inner.jobPlan.material.configurationSha256,
    existingDefaultStoreId:inner.jobPlan.material.existingDefaultStoreId,epoch:inner.jobPlan.externalFence.epoch,operationHash:inner.jobPlan.externalFence.operationHash,
    providerObservationSha256:'1'.repeat(64),providerCheckedAt:doneAt-1,authorityObservationSha256:'2'.repeat(64),authorityCheckedAt:doneAt-1,
    controlObservationSha256:'3'.repeat(64),controlCheckedAt:doneAt-1,initializedVerified:true,effectiveConfigurationVerified:true};
  const complete=await compilePlatformInitializedCompleteV4({plan:inner.jobPlan,queuedJob:inner.queue.row,lease:claim.lease,proof,now:doneAt});
  const job={...inner.queue.row,status:'succeeded',payload:JSON.parse(claim.statements[3].values[2]),attempts:1,
    available_at:f.at+100,completed_at:doneAt,updated_at:doneAt};
  state.jobs=state.jobs.map(j=>j.id===D.jobId?job:j);state.deployment.outputs=JSON.parse(complete.outputs);state.deployment.admissionSnapshot.predecessorJob=structuredClone(job);
  attempt(runPlan,'123456798',false);
  const report={schema:'techlong/cloud-worker-run/v5',jobId:D.jobId,manifestSha256:inner.manifestSha256,run:f.run('123456798'),
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',receiptSha256:complete.receiptSha256},independentInspectRequired:true,
    journal:{state:'ALL_SLOTS_CONSUMED'},retryAllowed:false};
  at=f.at+2000;const now=()=>at;
  const env={...f.env,GITHUB_RUN_ID:'123456798',...Object.fromEntries(Object.entries(runPlan.plan.inputs).map(([k,v])=>['TECHLONG_INPUT_'+k.toUpperCase(),v]))};
  const executed=await createA604Runtime({publication:f.publication,profile:f.profile,now}).run({env,closure:f.closure,ports:{...f.ports,
    open:async()=>({runOnce:async()=>({report,saved:await f.store(`worker-v5/${runPlan.plan.instanceId}/${D.jobId}/${inner.manifestSha256}/run-123456798-1/run.json`,report)}),dispose:async()=>{}})}});
  tracking=true;
  const db={snapshot:async()=>structuredClone(state),loadPlan,writeOwner,close:async()=>{},observe:async sha=>{
    writes.push('observe');if(failedAt==='observe')throw Error('SYNTHETIC_UNKNOWN_OBSERVE');
    Object.assign(entries.get(sha).attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
    Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(at).toISOString()});}};
  const ops=createA604InspectPublisherOperations({publication:f.publication,profile:f.profile,now}),effects=[];
  const io={assertSource:async()=>{},verifyCi:async()=>{},verifySourceIdentity:async()=>{},open:async()=>db,
    claim:async()=>effects.push('claim'),record:async(n,v)=>records.push({n,v}),readRun:async id=>f.rawRun(id),readObject:f.readObject,close:async()=>effects.push('close')};
  const prepare=()=>ops.makeReview({binding:f.publication,basis:f.basis,baseline:structuredClone(state),reviewEntry:structuredClone(entries.get(runPlan.planSha256)),
    requestEvidence:REQUEST_EVIDENCE,action:{operation:'AdvanceRunOnce',planSha256:runPlan.planSha256,runId:'123456798',resultReference:executed.saved},
    timing:{preparedAt:inner.jobPlan.preparedAt,claimBy:inner.jobPlan.claimBy,workloadExpiresAt:inner.workload.workloadExpiresAt},
    pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'a'.repeat(64)})),
    ci:{sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    auth:{contentRead:false,length:100,aclSha256:'b'.repeat(64)},createdAt:at});
  return {...f,now,inner,envelope,runPlan,executed,entries,report,ops,io,writes,effects,prepare,records,
    state:()=>state,advanceClock:ms=>{at+=ms;},failAt:phase=>{failedAt=phase;}};
}
