// Complete projected business/ledger verification; no writer or private ports.
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {compilePlatformInitializedClaimV4,compilePlatformInitializedCompleteV4} from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import {recoveryData} from '../platform-recovery-v1/basis-core.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {A604_JOB} from '../platform-a604-cloud-v1/profile.mjs';
import {assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {must,same} from './policy.mjs';
import {D} from './scope.mjs';
export function completedBusiness(basis,input){
  const s=normalizedState(input),before=recoveryData(basis,basis.createdAt).state,j=s.jobs.find(j=>j.id===A604_JOB),r=s.deployment.outputs.expressInitializedWorkerRunsV2?.[A604_JOB];
  must(j?.status==='succeeded'&&j.attempts===1&&j.max_attempts===1&&['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null)&&
    Number.isSafeInteger(j.completed_at)&&Number.isSafeInteger(j.updated_at)&&Number.isSafeInteger(j.available_at)&&j.available_at<=j.completed_at&&
    j.updated_at>=j.completed_at&&j.updated_at-j.completed_at<30000&&r?.jobId===A604_JOB&&r.initializedVerified===true&&r.effectiveConfigurationVerified===true,'COMPLETED_JOB');
  must(same(s.jobs.filter(j=>j.id!==A604_JOB),before.jobs)&&same(s.protection,before.protection),'PRESERVED_OLD_JOBS_PROTECTION');
  const d=structuredClone(s.deployment);must(same(d.admissionSnapshot.predecessorJob,j),'LATEST_PROOF_JOB');
  delete d.outputs.expressInitializedWorkerRunsV2[A604_JOB];d.admissionSnapshot.predecessorJob=before.deployment.admissionSnapshot.predecessorJob;
  must(same(d,before.deployment),'PRESERVED_BUSINESS');return {state:s,job:j,receipt:r,before};
}
export async function verifyRunOnceBaseline({basis,snapshot,entry,binding}){
  const {state:s,before}=completedBusiness(basis,snapshot),p=entry.plan;assertA604PlanScope(p,binding);
  const valid=await validatePlan(p,binding.release,p.preparedAt);
  must(valid.planSha256===entry.planSha256&&valid.actionSha256===entry.actionSha256&&entry.riskSha256===p.riskSha256,'RUN_PLAN_HASHES');
  must(p.mode==='RunOnce'&&entry.attempt?.state==='ACKNOWLEDGED'&&entry.attempt.status==null&&entry.attempt.conclusion==null&&entry.attempt.proofSha256===null,'RUN_ACK');
  const plans=s.ledger.plans.filter(p=>p.job_id===A604_JOB),ids=new Set(plans.map(p=>p.plan_sha));
  must(plans.length===2&&ids.size===2&&ids.has(entry.planSha256)&&ids.has(p.predecessor.planSha256),'EXACT_TWO_PLANS');
  for(const row of plans){const v=await validatePlan(row.body,binding.release,row.body.preparedAt);assertA604PlanScope(v.plan,binding);
    must(v.planSha256===row.plan_sha&&v.actionSha256===row.action_sha&&row.risk_sha===row.body.riskSha256&&row.mode===row.body.mode,'PLAN_ROWS');}
  const approvals=s.ledger.approvals.filter(a=>ids.has(a.plan_sha)),attempts=s.ledger.attempts.filter(a=>a.job_id===A604_JOB),run=attempts.find(a=>a.plan_sha===entry.planSha256),
    review=attempts.find(a=>a.plan_sha===p.predecessor.planSha256),parent=plans.find(a=>a.plan_sha===p.predecessor.planSha256);
  must(approvals.length===2&&new Set(approvals.map(a=>a.plan_sha)).size===2&&approvals.every(a=>a.admin_id===D.admin)&&attempts.length===2&&
    parent.mode==='Review'&&parent.body.predecessor===null&&review?.mode==='Review'&&review.state==='OBSERVED'&&review.run_status==='completed'&&review.conclusion==='success'&&
    review.proof_sha===p.predecessor.proofSha256&&review.run_id===p.predecessor.runId&&run?.mode==='RunOnce'&&run.state==='ACKNOWLEDGED'&&
    run.run_id===entry.attempt.runId&&run.proof_sha===null&&run.run_status===null&&run.conclusion===null&&same(plans.find(r=>r.plan_sha===entry.planSha256).body,p),'ACTUAL_TWO_ATTEMPTS');
  const old={plans:s.ledger.plans.filter(p=>!ids.has(p.plan_sha)),approvals:s.ledger.approvals.filter(a=>!ids.has(a.plan_sha)),attempts:s.ledger.attempts.filter(a=>a.job_id!==A604_JOB)};
  must(same(old,before.ledger),'PRESERVED_OLD_CONTROL');return s;
}
export async function verifyCompletionContent(snapshot,proposal){
  const s=normalizedState(snapshot),j=s.jobs.find(j=>j.id===A604_JOB),r=s.deployment.outputs.expressInitializedWorkerRunsV2[A604_JOB],
    inner=proposal.verifiedEnvelope.innerManifest,report=proposal.verifiedRunReport,token='lease_'+'0'.repeat(32);
  must(inner.jobPlan.jobId===A604_JOB&&r.jobPlanSha256===inner.jobPlan.planSha256&&r.completedBy==='express-initialized-single-job-v2'&&
    r.workloadExpiresAt===inner.workload.workloadExpiresAt&&await sha256Hex(r)===report.result.receiptSha256,'COMPLETION_REPORT_RECEIPT');
  const claim=await compilePlatformInitializedClaimV4({plan:inner.jobPlan,queuedJob:inner.queue.row,approvedPlanSha256:inner.jobPlan.planSha256,leaseToken:token});
  const {jobPlanSha256,completedBy,...publicProof}=r;must(jobPlanSha256&&completedBy,'RECEIPT_SHAPE');
  const complete=await compilePlatformInitializedCompleteV4({plan:inner.jobPlan,queuedJob:inner.queue.row,lease:claim.lease,
    proof:{...publicProof,leaseToken:token},now:j.completed_at});
  const expected={...inner.queue.row,status:'succeeded',payload:JSON.parse(claim.statements[3].values[2]),attempts:1,
    available_at:j.available_at,completed_at:j.completed_at,updated_at:j.updated_at};
  must(j.available_at>=inner.jobPlan.preparedAt&&j.available_at<inner.jobPlan.claimBy&&same(expected,j)&&
    canonicalJson(s.deployment.outputs)===complete.outputs&&complete.receiptSha256===report.result.receiptSha256,'EXACT_COMPLETION');return true;
}
