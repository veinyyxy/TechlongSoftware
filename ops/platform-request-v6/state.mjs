// Exactly the existing nine-row scope plus safe job/admin projection. READ ONLY.
import {neon} from '@neondatabase/serverless';
import {createExpressInitializedJobNeonV2} from '../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import {INITIALIZED_PLATFORM_SCOPE as S,projectInitializedDeployment} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {must,same} from './plan.mjs';
export const REQUEST_STATE_SQL_V6=`SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',j.id,'deployment_id',j.deployment_id,'job_type',j.job_type,'status',j.status,'payload',j.payload::jsonb,
  'attempts',j.attempts,'max_attempts',j.max_attempts,'available_at',j.available_at,'created_at',j.created_at,
  'updated_at',j.updated_at,'completed_at',j.completed_at,
  'leasePresent',(j.lease_token IS NOT NULL OR j.lease_owner IS NOT NULL OR j.lease_expires_at IS NOT NULL)) ORDER BY j.id),'[]'::jsonb) AS jobs,
  (SELECT jsonb_build_object('id',u.id,'email',u.email,'status',u.status,'platformAdmin',u.is_platform_admin)
    FROM public.users u WHERE u.id=$2) AS admin
  FROM public.deployment_jobs j WHERE j.deployment_id=$1`;
export async function projectRequestStateV6(snapshot,jobs,admin,target,now){
  must(admin?.id===REQUEST_ADMIN_V6&&admin.email==='veinyang@gmail.com'&&admin.status==='active'&&admin.platformAdmin===1,'ADMIN');
  const d=snapshot.deployment,view=projectInitializedDeployment({deployment:{id:d.id,appInstanceId:d.app_instance_id,environmentId:d.environment_id,
    mode:d.mode,status:d.status,planHash:d.plan_hash,configurationHash:d.configuration_hash,artifactRef:d.artifact_ref,outputs:typeof d.outputs==='string'?JSON.parse(d.outputs):d.outputs},jobs,gateEnabled:true,now}).view;
  const current=jobs.find(j=>j.id===target.jobId),p=current?.payload;
  return {schema:'techlong/held-request-state/v6',checkedAt:now,adminId:admin.id,view:{supported:view.supported,state:view.state,canRequest:view.canRequest,latestJobId:view.latest?.jobId??null},
    snapshotRows:await Promise.all(Object.entries(snapshot).sort(([a],[b])=>a.localeCompare(b)).map(async([name,value])=>({name,sha256:await sha256Hex(value)}))),
    oldJobs:await Promise.all(jobs.filter(j=>j.id!==target.jobId).sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>({id:j.id,status:j.status,leasePresent:j.leasePresent,rowSha256:await sha256Hex(j)}))),
    target:current?{id:current.id,deploymentId:current.deployment_id,jobType:current.job_type,status:current.status,attempts:current.attempts,
      maxAttempts:current.max_attempts,availableAt:current.available_at,createdAt:current.created_at,completedAt:current.completed_at,leasePresent:current.leasePresent,
      kind:p?.kind,requestId:p?.requestId,requestedBy:p?.requestedByUserId,requestedAt:p?.requestedAt,reviewRequired:p?.reviewRequired,
      cloudExecutionAuthorized:p?.cloudExecutionAuthorized,scopeSha256:await sha256Hex(p?.scope??null),rowSha256:await sha256Hex(current)}:null};
}
export async function readRequestStateV6(authUrl,target){
  const repository=createExpressInitializedJobNeonV2(authUrl),signal=AbortSignal.timeout(30000);
  const before=await repository.readSnapshot({deploymentId:S.deploymentId,predecessorJobId:'job_ecbf09030d3da7286ea3ef93',newJobId:target.jobId},signal);
  const sql=neon(authUrl,{fullResults:true}),[r]=await sql.transaction(tx=>[tx.query(REQUEST_STATE_SQL_V6,[S.deploymentId,REQUEST_ADMIN_V6])],
    {isolationLevel:'RepeatableRead',readOnly:true,fetchOptions:{signal,redirect:'error'}});
  must(r.rowCount===1&&Array.isArray(r.rows[0].jobs),'READ_STATE');
  return projectRequestStateV6(before.snapshot,r.rows[0].jobs,r.rows[0].admin,target,Date.now());
}
export function assertRequestBaselineV6(state){
  must(state.view.supported&&state.view.state==='expired'&&state.view.canRequest&&state.view.latestJobId==='job_ecbf09030d3da7286ea3ef93'&&
    state.snapshotRows.length===9&&state.oldJobs.length>=4&&state.oldJobs.every(j=>j.status==='succeeded'&&!j.leasePresent)&&state.target===null,'BASELINE');
}
export async function verifyRequestReadbackV6(before,after,target,window){
  assertRequestBaselineV6(before);must(same(before.snapshotRows,after.snapshotRows)&&same(before.oldJobs,after.oldJobs),'OLD_ROWS_CHANGED');
  if(after.target===null)return {outcome:'NEW_REQUEST_ABSENT_INDEPENDENTLY_OBSERVED',created:false,retryAllowed:false};
  const j=after.target;must(j.id===target.jobId&&j.deploymentId===S.deploymentId&&j.jobType==='reconcile'&&j.status==='pending'&&j.attempts===0&&
    j.maxAttempts===1&&j.availableAt===Number.MAX_SAFE_INTEGER&&j.completedAt===null&&!j.leasePresent&&j.kind==='express_initialized_request_v4'&&
    j.requestId===target.requestId&&j.requestedBy===target.adminUserId&&j.reviewRequired===true&&j.cloudExecutionAuthorized===false&&
    j.scopeSha256===await sha256Hex(S)&&Number.isSafeInteger(j.requestedAt)&&j.requestedAt>=window.lease.issuedAt-5000&&j.requestedAt<window.lease.expiresAt,'NEW_ROW');
  return {outcome:'NEW_EXACT_HELD_REQUEST_INDEPENDENTLY_VERIFIED',created:true,jobId:j.id,requestId:j.requestId,
    oldRowsPreserved:before.snapshotRows.length,oldJobsPreserved:before.oldJobs.length,cloudExecutionAuthorized:false,retryAllowed:false};
}
