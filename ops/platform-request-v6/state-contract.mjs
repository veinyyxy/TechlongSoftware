// Pure state/admission contract shared by local and cloud verification. No I/O.
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
const clone=v=>JSON.parse(JSON.stringify(v)),payload=j=>typeof j.payload==='string'?JSON.parse(j.payload):j.payload;
const transferMust=(ok,c)=>{if(!ok)throw Error('TASK_TRANSFER_'+c);};
const admissionMust=(ok,c)=>{if(!ok)throw Error('TRANSFER_STATE_'+c);};
export function normalizedState(input){
  const s=clone(input);transferMust(Object.keys(s).sort().join(',')==='deployment,jobs,ledger,protection','STATE_FIELDS');
  transferMust(Array.isArray(s.jobs)&&s.jobs.length>1&&s.jobs.length<21,'JOBS');
  s.jobs=s.jobs.map(j=>{const row={...j,payload:payload(j)};
    for(const k of ['available_at','created_at','updated_at','completed_at','lease_expires_at'])if(typeof row[k]==='string'){
      transferMust(/^\d+$/.test(row[k])&&Number.isSafeInteger(Number(row[k])),'INTEGER');row[k]=Number(row[k]);}return row;
  }).sort((a,b)=>a.id.localeCompare(b.id));
  for(const k of ['plans','approvals','attempts']){transferMust(Array.isArray(s.ledger[k]),'LEDGER');s.ledger[k].sort((a,b)=>a.plan_sha.localeCompare(b.plan_sha));}
  return s;
}
export function assertAdmissionSnapshot(d,at){
  const s=d.admissionSnapshot;admissionMust(s&&Object.keys(s).sort().join(',')==='admin,app,environment,operation,predecessorJob,resource,subscription,templateVersion,workspace','FULL_ADMISSION');
  admissionMust(d.id===S.deploymentId&&d.appInstanceId===S.appInstanceId&&d.environmentId===S.environmentId&&d.mode==='aws_sandbox'&&d.status==='ready'&&
    d.planHash===S.planHash&&d.configurationHash===S.configurationHash&&d.artifactRef===S.artifactRef,'DEPLOYMENT');
  admissionMust(s.app.id===S.appInstanceId&&s.app.workspace_id===S.workspaceId&&s.app.product_id===S.productId&&s.app.status==='active'&&
    s.workspace.id===S.workspaceId&&s.workspace.status==='active'&&s.subscription.id===s.app.subscription_id&&s.subscription.status==='active'&&
    Number(s.subscription.current_period_end)>at&&s.templateVersion.id===s.app.template_version_id,'BUSINESS');
  const e=s.environment,r=s.resource,o=s.operation;
  admissionMust(e.id===S.environmentId&&e.status==='active'&&e.apply_enabled===0&&e.admission_state==='open'&&e.admission_epoch===0&&
    e.admission_stack_id===null&&e.kind==='aws_sandbox'&&e.expected_account_id==='402010193138'&&e.region==='ca-central-1'&&e.cell_key===S.cellKey,'ENVIRONMENT');
  admissionMust(r.app_instance_id===S.appInstanceId&&r.owner_deployment_id===S.deploymentId&&r.created_by_deployment_id===S.deploymentId&&
    r.lifecycle_status==='verified'&&r.destroyed_at===null&&r.generation===1&&r.external_operation_epoch===1&&
    o.app_instance_id===S.appInstanceId&&o.generation===1&&o.epoch===1&&o.owner_deployment_id===S.deploymentId&&o.state==='active'&&o.intent==='provision'&&o.operation_hash===S.operationHash,'OWNERSHIP');
  admissionMust(s.admin.id===ADMIN&&s.admin.status==='active'&&s.admin.platformAdmin===1&&s.admin.email==='veinyang@gmail.com'&&
    s.predecessorJob.status==='succeeded'&&['lease_token','lease_owner','lease_expires_at'].every(k=>s.predecessorJob[k]===null),'ADMIN_OR_PROOF');
}
