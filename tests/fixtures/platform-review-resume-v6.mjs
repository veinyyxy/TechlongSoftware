// Golden public historical plan bodies only; no production connections or private values.
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {N,makeResumeReview} from '../../ops/platform-review-v6/resume.mjs';
import {refreshFixture} from './platform-review-refresh-v6.mjs';
export async function resumeFixture(at=Math.max(Date.now(),1792827529846)){
  const f=await refreshFixture(at),old=f.m.oldPlan,second=await validatePlan({...structuredClone(old.plan),sourceCommit:N.priorSource,
    preparedAt:1792820329845,expiresAt:1792827529845},B.platform,1792820329845),oldPlans=[old,second];
  const readOnly={state:'EXACT_TWO_EXPIRED_REVIEWS_AND_HELD_JOB_READ_ONLY_VERIFIED',jobId:N.jobId,checkedAt:at-1000,
    authMetadata:structuredClone(f.m.auth),controlCounts:{plans:2,approvals:0,attempts:0},planHashes:oldPlans.map(p=>p.planSha256).sort(),
    oldPlans:oldPlans.map(p=>({planSha256:p.planSha256,bodyExactlyUnchanged:true,expired:true,sourceCommit:p.plan.sourceCommit,expiresAt:p.plan.expiresAt})),
    target:structuredClone(f.m.baseline.target),snapshotRows:structuredClone(f.m.baseline.snapshotRows),
    oldJobRows:structuredClone(f.m.baseline.oldJobs),nineSnapshotRowsAndSixOldJobsUnchanged:true};
  const m=await makeResumeReview({...f.m,oldPlans,readOnly,parents:Array.from({length:12},(_,i)=>({path:'fixture-'+i,rawSha256:'d'.repeat(64)})),createdAt:at});
  return {...f,m,at};
}
export function resumedPlan(m,at){return {...structuredClone(m.oldPlans[0].plan),sourceCommit:m.sourceCommit,preparedAt:at,expiresAt:at+7200000};}
export function resumedLedger(m,next=null){const a=[...m.oldPlans,...(next?[next]:[])];return {counts:{plans:a.length,approvals:0,attempts:0},
  entries:a.map(v=>({plan:v.plan,planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:v.plan.riskSha256,attempt:null}))};}
