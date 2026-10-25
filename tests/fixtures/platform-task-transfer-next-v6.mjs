// Independent synthetic history for W8y. No production archive or credentials.
import {transferFixture,expectedAfter,PROOF} from './platform-task-transfer-v6.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {normalizedState} from '../../ops/platform-request-v6/transfer.mjs';
import {NEXT,makeNextTransferProfile} from '../../ops/platform-request-v6/transfer-next.mjs';
export const NEXT_AT=Date.parse('2026-10-25T14:00:00Z');
export async function nextFixture(at=NEXT_AT){
  const s=expectedAfter(await transferFixture(at),at-60000),body=structuredClone(s.ledger.plans[2].body);
  Object.assign(body,{jobId:NEXT.oldJobId,sourceCommit:NEXT.oldSource});body.inputs.job=NEXT.oldJobId;
  const v=await validatePlan(body,B.platform,body.preparedAt);
  s.ledger.plans.push({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:body.riskSha256,job_id:NEXT.oldJobId,mode:'Review',body,
    expires_at:new Date(body.expiresAt).toISOString(),created_at:new Date(body.preparedAt).toISOString()});
  s.ledger.approvals.push({plan_sha:v.planSha256,admin_id:ADMIN,approved_at:new Date(at-3600000).toISOString()});
  s.ledger.attempts.push({...structuredClone(s.ledger.attempts[0]),plan_sha:v.planSha256,job_id:NEXT.oldJobId,run_id:NEXT.oldReviewRunId});
  const sub='sub_fixture',tv='template_fixture';
  s.deployment.admissionSnapshot={app:{id:S.appInstanceId,workspace_id:S.workspaceId,product_id:S.productId,subscription_id:sub,template_version_id:tv,status:'active'},
    workspace:{id:S.workspaceId,status:'active'},subscription:{id:sub,status:'active',current_period_end:at+86400000},
    environment:{id:S.environmentId,status:'active',apply_enabled:0,admission_state:'open',admission_epoch:0,admission_stack_id:null,kind:'aws_sandbox',expected_account_id:'402010193138',region:'ca-central-1',cell_key:S.cellKey},
    resource:{app_instance_id:S.appInstanceId,owner_deployment_id:S.deploymentId,created_by_deployment_id:S.deploymentId,lifecycle_status:'verified',destroyed_at:null,generation:1,external_operation_epoch:1},
    operation:{app_instance_id:S.appInstanceId,generation:1,epoch:1,owner_deployment_id:S.deploymentId,state:'active',intent:'provision',operation_hash:S.operationHash},
    templateVersion:{id:tv},predecessorJob:structuredClone(s.jobs.find(j=>j.id===PROOF)),admin:{id:ADMIN,email:'veinyang@gmail.com',status:'active',platformAdmin:1}};
  const before=normalizedState(s),facts={factsAt:at-30000,databaseCheckedAt:at-10000,jobCount:before.jobs.length,
    baselineSha256:await sha256Hex(before),ledgerSha256:await sha256Hex(before.ledger),protection:before.protection};
  return {before,facts,profile:makeNextTransferProfile(facts)};
}
export function nextAfter(before,at){
  const s=structuredClone(before),old=s.jobs.find(j=>j.id===NEXT.oldJobId);
  Object.assign(old,{status:'canceled',updated_at:at,completed_at:at});
  s.jobs.push({...structuredClone(old),id:NEXT.newJobId,dedupe_key:'express-initialized-v2:'+NEXT.requestId,status:'pending',attempts:0,created_at:at,updated_at:at,completed_at:null,
    payload:{kind:'express_initialized_request_v4',requestId:NEXT.requestId,requestedByUserId:ADMIN,requestedAt:at,scope:S,reviewRequired:true,cloudExecutionAuthorized:false}});
  return normalizedState(s);
}
