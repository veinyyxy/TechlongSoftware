// Public immutable plan metadata only. No credentials or business row values.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {cloudRootFixtureV5} from './cloud-worker-root-v5.mjs';
import {R,makeRefreshReview} from '../../ops/platform-review-v6/refresh.mjs';
import {J} from '../../ops/platform-review-v6/followup.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
export function oldReviewFixture(){return {plan:{deploymentId:'dep_7c99bd249470184852f0dc74',expiresAt:1792811111885,
  inputs:{execution:'',installation:canonicalJson({key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json',
    sha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae',versionId:'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV'}),
    job:R.jobId,lineage:canonicalJson({key:J.lineageKey,sha256:J.lineageSha256,versionId:R.lineageVersion}),manifest:'',manifestSha:'',mode:'Review'},
  instanceId:'app_e897a4377bce498b9c5ee9e64509dcad',jobId:R.jobId,mode:'Review',predecessor:null,preparedAt:1792803911885,
  releaseSha256:'268efbd9674824f79cb453e82a05bd09b5d7fd3c01c3c277f6506f850ae79d40',riskSha256:B.platform.riskSha256,
  schema:'techlong/platform-controller-plan/v6',sourceCommit:R.oldSource},planSha256:R.oldPlanSha256,actionSha256:R.oldActionSha256};}
export async function refreshFixture(at=Date.parse('2026-10-24T05:00:00Z')){
  const f=await cloudRootFixtureV5(at),job=structuredClone(f.observed.job),admin='usr_4dcd0a09821fde2bb1801f58',requestId='c99ca0cb30620d6f3ccc47dee1d6287ee3c9489531fd750db41d127182be7730';
  job.id=R.jobId;job.dedupe_key='express-initialized-v2:'+requestId;job.payload=canonicalJson({...JSON.parse(job.payload),requestId,requestedByUserId:admin});
  const old=Array.from({length:6},(_,i)=>({...structuredClone(f.observed.jobs[1]),id:i===0?J.priorJobId:'job_'+String(i).repeat(24)}));
  const observed={snapshot:f.observed.snapshot,job,jobs:[...old,structuredClone(job)],requester:{id:admin,status:'active',is_platform_admin:1},checkedAt:at};
  const safe=j=>({...Object.fromEntries(['id','deployment_id','job_type','status','attempts','max_attempts','available_at','created_at','updated_at','completed_at'].map(k=>[k,j[k]])),
    payload:typeof j.payload==='string'?JSON.parse(j.payload):j.payload,leasePresent:j.lease_token!==null||j.lease_owner!==null||j.lease_expires_at!==null});
  const baseline={adminId:admin,snapshotRows:await Promise.all(Object.entries({...observed.snapshot,predecessorJob:old[0]}).sort(([a],[b])=>a.localeCompare(b)).map(async([name,v])=>({name,sha256:await sha256Hex(v)}))),
    oldJobs:await Promise.all(old.sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>({id:j.id,status:j.status,leasePresent:false,rowSha256:await sha256Hex(safe(j))}))),
    target:{id:R.jobId,status:'pending',attempts:0,leasePresent:false,cloudExecutionAuthorized:false,rowSha256:await sha256Hex(safe(job))}};
  const oldPlan=oldReviewFixture(),sourceCommit='a'.repeat(40),m=await makeRefreshReview({sourceCommit,oldPlan,baseline,
    references:{installation:JSON.parse(oldPlan.plan.inputs.installation),lineage:JSON.parse(oldPlan.plan.inputs.lineage)},
    pins:Array.from({length:25},(_,i)=>({file:'fixture-'+i,sha256:'b'.repeat(64)})),ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    auth:{contentRead:false,length:300,aclSha256:'c'.repeat(64)},parents:Array.from({length:7},(_,i)=>({path:'fixture-'+i,rawSha256:'d'.repeat(64)})),
    readOnly:{state:'EXACT_OLD_REVIEW_AND_HELD_JOB_READ_ONLY_VERIFIED',jobId:R.jobId,oldPlan:{planSha256:R.oldPlanSha256,bodyExactlyUnchanged:true,expired:true},
      controlCounts:{plans:1,approvals:0,attempts:0},planHashes:[R.oldPlanSha256],target:baseline.target,snapshotRows:baseline.snapshotRows,oldJobRows:baseline.oldJobs,
      nineSnapshotRowsAndSixOldJobsUnchanged:true,checkedAt:at-1000},createdAt:at,
    compatibility:{executionSourceCommit:sourceCommit,imageSourceCommit:J.imageSourceCommit,protectedRuntimeCodeUnchanged:true,cloudClosureSha256:B.platform.closureSha256}});
  return {m,observed,at};
}
export function newReviewFixture(m,at){return {...structuredClone(m.oldPlan.plan),sourceCommit:m.sourceCommit,preparedAt:at,expiresAt:at+7200000};}
export function ledgerFixture(m,next=null){const plans=[m.oldPlan,...(next?[next]:[])];return {counts:{plans:plans.length,approvals:0,attempts:0},
  entries:plans.map(v=>({plan:v.plan,planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:v.plan.riskSha256,attempt:null}))};}
