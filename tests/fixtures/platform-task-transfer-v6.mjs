// Synthetic rows; no archive, credentials, service or production database access.
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as admin} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {TRANSFER as T} from '../../ops/platform-request-v6/transfer.mjs';
export const AT=Date.parse('2026-10-25T12:00:00Z'),PROOF='job_'+'a'.repeat(24);
export async function transferFixture(at=AT){
  const receipt={jobId:PROOF,materialSha256:S.materialSha256,configurationHash:S.configurationHash,imageUri:S.artifactRef,
    existingDefaultStoreId:S.existingDefaultStoreId,epoch:S.epoch,operationHash:S.operationHash,completedBy:'express-initialized-single-job-v2',
    initializedVerified:true,effectiveConfigurationVerified:true,jobPlanSha256:'1'.repeat(64),controlObservationSha256:'2'.repeat(64),
    providerObservationSha256:'3'.repeat(64),authorityObservationSha256:'4'.repeat(64),controlCheckedAt:at-7200000,workloadExpiresAt:at-60000,
    stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/12345678-1234-1234-1234-123456789012'};
  const row=(id,status,payload)=>({id,deployment_id:S.deploymentId,job_type:'reconcile',dedupe_key:'fixture:'+id,status,payload,attempts:status==='succeeded'?1:0,
    max_attempts:1,available_at:status==='pending'?Number.MAX_SAFE_INTEGER:at-7200000,lease_owner:null,lease_token:null,lease_expires_at:null,
    last_error_code:null,last_error_message:null,created_at:at-7200000,updated_at:at-3600000,completed_at:status==='pending'?null:at-3600000});
  const old=row(T.oldJobId,'pending',{kind:'express_initialized_request_v4',requestId:T.oldRequestId,requestedByUserId:admin,requestedAt:at-7200000,
    scope:structuredClone(S),reviewRequired:true,cloudExecutionAuthorized:false});old.dedupe_key='express-initialized-v2:'+T.oldRequestId;
  const proof=row(PROOF,'succeeded',{kind:'express_initialized_workload_v2',planSha256:receipt.jobPlanSha256,materialSha256:S.materialSha256});
  const canceled=row('job_'+'b'.repeat(24),'canceled',{kind:'express_initialized_request_v4'}),plans=[];
  for(let i=0;i<3;i++){
    const p={schema:'techlong/platform-controller-plan/v6',instanceId:S.appInstanceId,deploymentId:S.deploymentId,jobId:T.oldJobId,mode:'Review',
      sourceCommit:i===2?T.oldSource:String(i+1).repeat(40),releaseSha256:await sha256Hex(B.platform),riskSha256:B.platform.riskSha256,
      preparedAt:at-4*3600000+i*1000,expiresAt:at-2*3600000+i*1000,predecessor:null,
      inputs:{mode:'Review',job:T.oldJobId,installation:JSON.stringify({key:'worker-v5/'+S.appInstanceId+'/installation/'+B.platform.installationSha256+'.json',sha256:'a'.repeat(64),versionId:'synthetic-version'}),
        manifest:'',manifestSha:'',execution:'',lineage:''}};
    const v=await validatePlan(p,B.platform,p.preparedAt);plans.push({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:p.riskSha256,job_id:T.oldJobId,
      mode:'Review',body:p,expires_at:new Date(p.expiresAt).toISOString(),created_at:new Date(p.preparedAt).toISOString()});
  }
  const last=plans[2];return {deployment:{id:S.deploymentId,appInstanceId:S.appInstanceId,environmentId:S.environmentId,mode:'aws_sandbox',status:'ready',
    planHash:S.planHash,configurationHash:S.configurationHash,artifactRef:S.artifactRef,outputs:{expressInitializedWorkerRunsV2:{[PROOF]:receipt}}},
    jobs:[old,proof,canceled],ledger:{plans,approvals:[{plan_sha:last.plan_sha,admin_id:admin,approved_at:new Date(at-3600000).toISOString()}],
      attempts:[{plan_sha:last.plan_sha,job_id:T.oldJobId,mode:'Review',state:'ACKNOWLEDGED',run_id:T.oldReviewRunId,run_status:null,conclusion:null,
        proof_sha:null,started_at:new Date(at-3600000).toISOString(),observed_at:null}]},protection:{catalogSha256:'c'.repeat(64),triggersSha256:'d'.repeat(64)}};
}
export function expectedAfter(state,at){
  const after=structuredClone(state),old=after.jobs.find(j=>j.id===T.oldJobId);Object.assign(old,{status:'canceled',updated_at:at,completed_at:at});
  after.jobs.push({...structuredClone(old),id:T.newJobId,dedupe_key:'express-initialized-v2:'+T.requestId,status:'pending',attempts:0,created_at:at,updated_at:at,completed_at:null,
    payload:{kind:'express_initialized_request_v4',requestId:T.requestId,requestedByUserId:admin,requestedAt:at,scope:S,reviewRequired:true,cloudExecutionAuthorized:false}});
  return after;
}
