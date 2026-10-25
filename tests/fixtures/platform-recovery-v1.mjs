// Synthetic, self-contained execution+retirement evidence; never local archives.
import {platformFixtureV6} from './platform-cloud-v6.mjs';
import {nextFixture} from './platform-task-transfer-next-v6.mjs';
import {createTrustedPublisherV6} from '../../ops/platform-cloud-v6/publisher.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {prepareInitializedPlatformRequest} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {normalizedState} from '../../ops/platform-request-v6/transfer.mjs';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {RECOVERY,recoveryBasisCompiler} from '../../ops/platform-recovery-v1/basis.mjs';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
export async function recoveryFixture(){
  const f=await platformFixtureV6({installed:true,now:Date.now()-3*3600000}),pub=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
  const first=await f.observedPlan(f.basePlan,'123456789'),firstRef=await f.resultFor(first.plan,'123456789');
  await pub.attestResult(first.planSha256,firstRef);const plan=(await pub.publishSuccessor(first.planSha256,firstRef)).plan,runId='123456790';
  const at=f.at+3*3600000,stackId=f.proof.stackId;
  const physical=Object.fromEntries(f.manifest.workload.resourceInventory.map(e=>[e.logicalId,'synthetic-'+e.logicalId]));
  physical.TenantTaskDefinition=f.context.predecessor.taskDefinitionArn.replace(':5',':8');
  const provider={stackId,physical,taskArn:'synthetic-task',imageUri:S.artifactRef,checkedAt:f.at+1000};
  const receipt={...f.proof,jobId:plan.jobId,stackId,jobPlanSha256:f.manifest.jobPlan.planSha256,completedBy:'express-initialized-single-job-v2',
    workloadExpiresAt:f.manifest.workload.workloadExpiresAt,
    controlCheckedAt:f.at+1000,authorityCheckedAt:f.at+1000,providerCheckedAt:provider.checkedAt,
    providerObservationSha256:await sha256Hex(provider)};delete receipt.leaseToken;
  const providerRef=await f.store(`worker-v5/${S.appInstanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${runId}-1/provider-after.json`,provider);
  const report={schema:'techlong/cloud-worker-run/v5',jobId:plan.jobId,manifestSha256:f.manifest.manifestSha256,run:f.run(runId),
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',receiptSha256:await sha256Hex(receipt)},retryAllowed:false,
    independentInspectRequired:true,journal:{state:'ALL_SLOTS_CONSUMED'},savedEvidence:{'provider-after.json':providerRef}};
  const reportRef=await f.store(`worker-v5/${S.appInstanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${runId}-1/run.json`,report);
  const executionRef=await f.store(`worker-v5/${S.appInstanceId}/${plan.jobId}/${f.manifest.manifestSha256}/execution-reference-${runId}-v1.json`,
    {executionRun:f.run(runId),executionReportReference:reportRef});
  const resultRef=await f.resultFor(plan,runId,{outcome:report.result.outcome,cloudReportReference:reportRef,executionReference:executionRef});
  const before=(await nextFixture(at)).before;
  for(const j of before.jobs)if(j.status==='pending'){j.status='canceled';j.completed_at=at-2000;}
  const oldJob={...before.jobs[0],id:plan.jobId,status:'succeeded',attempts:1,completed_at:f.at+2000,
    payload:{kind:'express_initialized_workload_v2',planSha256:receipt.jobPlanSha256,materialSha256:S.materialSha256},
    lease_owner:null,lease_token:null,lease_expires_at:null};
  before.jobs=before.jobs.filter(j=>j.id!==oldJob.id);before.jobs.push(oldJob);
  before.deployment.outputs={fixtureOnly:true,expressInitializedWorkerRunsV2:{[f.context.predecessor.jobId]:f.capsule.lineage.receipt,[oldJob.id]:receipt}};
  before.deployment.admissionSnapshot.predecessorJob=oldJob;
  const valid=await validatePlan(plan,f.release,plan.preparedAt);
  before.ledger.plans.push({plan_sha:valid.planSha256,action_sha:valid.actionSha256,risk_sha:plan.riskSha256,job_id:oldJob.id,mode:'RunOnce',body:plan,
    expires_at:new Date(plan.expiresAt).toISOString(),created_at:new Date(plan.preparedAt).toISOString()});
  before.ledger.approvals.push({plan_sha:valid.planSha256,admin_id:ADMIN,approved_at:new Date(f.at).toISOString()});
  before.ledger.attempts.push({plan_sha:valid.planSha256,job_id:oldJob.id,mode:'RunOnce',run_id:runId,state:'ACKNOWLEDGED',
    run_status:null,conclusion:null,proof_sha:null,started_at:new Date(f.at).toISOString(),observed_at:null});
  const state=normalizedState(before);
  const retirement={stackId,status:'DELETE_COMPLETE',deletionTime:new Date(f.at+7201000).toISOString(),
    resources:f.manifest.workload.resourceInventory.map(e=>({LogicalResourceId:e.logicalId,ResourceType:e.type,ResourceStatus:'DELETE_COMPLETE',PhysicalResourceId:physical[e.logicalId]}))};
  const candidate=await prepareInitializedPlatformRequest({deployment:state.deployment,jobs:state.jobs,gateEnabled:true,
    body:{clientRequestId:RECOVERY.clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},adminUserId:ADMIN,now:at});
  const profile={...RECOVERY,oldJobId:oldJob.id,runId,sourceCommit:f.sourceCommit,manifestSha:f.manifest.manifestSha256,stackId,
    taskDefinitionArn:physical.TenantTaskDefinition,receiptSha256:await sha256Hex(receipt),stateSha256:await sha256Hex(state),
    retirementSha256:await sha256Hex(retirement),factsAt:at-30000,databaseCheckedAt:at-10000,observedBy:at-1000,
    newJobId:candidate.program.jobId,requestId:candidate.requestId,resultReference:resultRef};
  const input={capsule:f.capsule,state,retirement,execution:{plan,runId,run:f.rawRun(runId),resultReference:resultRef},readObject:f.ports.readObject,createdAt:at};
  const compile=recoveryBasisCompiler(profile),basis=await compile(input);
  const makeAfter=(p,t=at)=>normalizedState({...state,jobs:[...state.jobs,{id:p.jobId,deployment_id:S.deploymentId,job_type:'reconcile',
    dedupe_key:'express-initialized-v2:'+profile.requestId,status:'pending',payload:p.payload,attempts:0,max_attempts:1,available_at:Number.MAX_SAFE_INTEGER,
    lease_owner:null,lease_token:null,lease_expires_at:null,completed_at:null,created_at:t,updated_at:t,last_error_code:null,last_error_message:null}]});
  const observed=structuredClone(f.observed);observed.snapshot.deployment.outputs=canonicalJson(state.deployment.outputs);
  return {...f,at,profile,input,compile,basis,state,retirement,provider,receipt,oldJob,makeAfter,observed};
}
