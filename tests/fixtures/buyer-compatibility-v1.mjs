// Shared synthetic accepted-successor fixture. No production files or I/O.
import {a604Fixture} from './platform-a604-cloud-v1.mjs';
import {buyerCompatibilityClosure,prepareBuyerCompatibility,BUYER_ORIGINS,BUYER_CAPSULE_SHA256} from '../../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
import {prepareInitializedPlatformRequest,INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {compilePlatformInitializedClaimV4,compilePlatformInitializedCompleteV4} from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import {loadNeonContractV5} from '../../ops/cloud-worker/neon-contract-v5.mjs';
import {recoveryData} from '../../ops/platform-recovery-v1/basis-core.mjs';
import {normalizedState} from '../../ops/platform-request-v6/state-contract.mjs';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';

let closure;
export async function buyerFixture(){
  closure??=await buyerCompatibilityClosure();const f=await a604Fixture({closure}),worker=await f.ports.open({basis:f.basis});
  const prior=(await worker.review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(10000)})).review.innerManifest;
  const done=f.at+1000,physical={...f.provider.physical,TenantTaskDefinition:f.provider.physical.TenantTaskDefinition.replace(':8',':9')},
    providerObservation={stackId:f.proof.stackId,physical,taskArn:'fixture-task',imageUri:S.artifactRef,checkedAt:done};
  const claim=await compilePlatformInitializedClaimV4({plan:prior.jobPlan,queuedJob:prior.queue.row,
    approvedPlanSha256:prior.jobPlan.planSha256,leaseToken:'lease_'+'0'.repeat(32)});
  const proof={...f.proof,jobId:prior.jobPlan.jobId,leaseToken:claim.lease.leaseToken,workloadExpiresAt:prior.workload.workloadExpiresAt,
    providerObservationSha256:await sha256Hex(providerObservation),providerCheckedAt:done,authorityCheckedAt:done,controlCheckedAt:done};
  const completion=await compilePlatformInitializedCompleteV4({plan:prior.jobPlan,queuedJob:prior.queue.row,lease:claim.lease,proof,now:done}),
    receipt=JSON.parse(completion.outputs).expressInitializedWorkerRunsV2[prior.jobPlan.jobId];
  const ib={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',jobId:receipt.jobId,
    manifestSha256:prior.manifestSha256,receiptSha256:await sha256Hex(receipt),providerObservationSha256:receipt.providerObservationSha256,
    run:f.run('123456798'),executionRun:f.run('123456797')};
  const links=[{manifest:prior,receipt,providerObservation,inspect:{...ib,inspectSha256:await sha256Hex(ib)}}];
  const completed={...f.observed.job,status:'succeeded',attempts:1,payload:JSON.parse(claim.statements[3].values[2]),
    completed_at:done,updated_at:done,lease_owner:null,lease_token:null,lease_expires_at:null};
  const state=normalizedState({...f.projection,jobs:f.projection.jobs.concat(completed)});
  state.deployment.outputs=JSON.parse(completion.outputs);state.deployment.admissionSnapshot.predecessorJob=completed;
  let at=prior.workload.workloadExpiresAt+1000;const now=()=>at,clientRequestId='11111111-2222-4333-8444-555555555555';
  const request=await prepareInitializedPlatformRequest({deployment:state.deployment,jobs:state.jobs,gateEnabled:true,
    body:{clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},adminUserId:ADMIN,now:at});
  const code={commitSha:f.sourceCommit,closureSha256:closure.closureSha256};
  const source={schema:'techlong/buyer-compatibility-source/v1',basisSha256:f.basis.basisSha256,linksSha256:await sha256Hex(links),
    predecessor:{jobId:receipt.jobId,stackId:receipt.stackId,taskDefinitionArn:physical.TenantTaskDefinition,receiptSha256:await sha256Hex(receipt)},
    baselineSha256:await sha256Hex(state),code,request:{jobId:request.program.jobId,requestId:request.requestId,clientRequestId,adminUserId:ADMIN}};
  const capsule=structuredClone(f.capsule);capsule.publicParameters.CorsAllowedOrigins=BUYER_ORIGINS;capsule.capsuleSha256=BUYER_CAPSULE_SHA256;
  const options={source,basis:f.basis,capsule,links,now},compat=await prepareBuyerCompatibility(options),events=[],contract=await loadNeonContractV5();
  const row={id:request.program.jobId,deployment_id:S.deploymentId,job_type:'reconcile',dedupe_key:request.program.values[2],status:'pending',
    payload:canonicalJson(request.program.payload),attempts:0,max_attempts:1,available_at:Number.MAX_SAFE_INTEGER,created_at:at,updated_at:at,
    completed_at:null,lease_owner:null,lease_token:null,lease_expires_at:null};
  const observed={...structuredClone(f.observed),snapshot:{...structuredClone(f.observed.snapshot),
    deployment:{...f.observed.snapshot.deployment,outputs:canonicalJson(state.deployment.outputs)}},job:row,jobs:[...state.jobs,row],checkedAt:at};
  const d=recoveryData(f.basis,at),dependencies={installation:f.installation,contract,code,run:f.run('123456799'),
    openDatabase:async()=>{events.push('database');return {verify:async()=>{},read:async()=>structuredClone(observed)};},
    provider:{readCell:async()=>({stackId:d.context.base.compute.stackId,outputs:Object.fromEntries(
      ['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,d.context.base.compute.outputs[k]])),
      parentTagExpiresAt:d.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
    inspectBefore:async()=>({namespacesAbsent:true,retiredPredecessor:source.predecessor.stackId,cloudWrites:0})},
    evidence:{verify:async()=>{},put:async(kind,ref,value)=>{events.push(kind);return f.store(`worker-v5/${S.appInstanceId}/${ref.jobId}/${ref.manifestSha256}/${kind}`,value);}},
    openJournal:async()=>{throw Error('REVIEW_MUST_NOT_OPEN_JOURNAL');},loadControl:async()=>{throw Error('REVIEW_MUST_NOT_READ_CONTROL');}};
  const binding={...f.binding,sourceCommit:f.sourceCommit,reusableCommit:f.release.reusableCommit,closureSha256:closure.closureSha256};
  const env={...f.env,GITHUB_RUN_ID:'123456799',TECHLONG_INPUT_JOB:row.id,TECHLONG_INPUT_LINEAGE:''};
  const ports={signal:AbortSignal.timeout(10000),read:async ref=>f.objects.get(ref.key).value,
    writeResult:async(key,value)=>{events.push('result');return f.store(key,value);},writeExecution:async()=>{throw Error('REVIEW_HAS_NO_EXECUTION_DESCRIPTOR');}};
  return {closure,f,options,compat,source,state,request,links,capsule,observed,dependencies,events,contract,binding,env,ports,advance:n=>{at+=n;}};
}

