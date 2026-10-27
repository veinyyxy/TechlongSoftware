// Fixed next-request compiler only. No connection, SQL executor or activation.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {RECOVERY_SCOPE as OLD} from '../platform-recovery-v1/profile.mjs';
import {compileHeldTransferProgram} from '../platform-request-v6/transfer.mjs';
import {normalizedState,assertAdmissionSnapshot} from '../platform-request-v6/state-contract.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {exactRunV6} from '../platform-cloud-v6/contract.mjs';
import {createPublisherOperations,must} from './operation.mjs';
export const NEXT_CLIENT_REQUEST_ID='17004827-71da-4e61-9bb3-26cbf6fbb1ba';
const EXPECTED={sourceCommit:'ab5fa1790879063cad110907bbee83e07fe21b09',runId:'40453693112',
  planSha256:'45fdaf3400e08cc7b1b1a99c7254d682246161f0f7e38b9a75a3791115f80ebb',
  resultSha256:'2bd63c5783b2b5cef1b66d8c1afa8926bcdad857fc5eaac7e68349d4032ae463',
  manifestSha256:'fc145aab9d3903e1e12f814754fd24e27e676abe5d75b43e10282f5a51dbfb71',
  resultVersionId:'thbe_TYJhMY6JgqjHKPNaXG0ysdCidPj',manifestVersionId:'TSCc1KLUuYU5BddFZHaEHz8ikHfTvZa2'};
export async function nextRequestTarget(){
  const requestId=await sha256Hex({purpose:'platform-initialized-request/v1',clientRequestId:NEXT_CLIENT_REQUEST_ID,adminUserId:ADMIN,scope:S});
  return {oldJobId:OLD.newJobId,oldRequestId:OLD.requestId,clientRequestId:NEXT_CLIENT_REQUEST_ID,requestId,
    newJobId:'job_'+(await sha256Hex({purpose:'express-initialized-job/v2',deploymentId:S.deploymentId,materialSha256:S.materialSha256,requestId})).slice(0,24),runMs:30000};
}
// Explicit source capability for fixtures, never selected by material or CLI.
export function createRequestHandoffCompiler({expected=EXPECTED,historicalPlanShas}={}){
  const verifier=createPublisherOperations(historicalPlanShas?{historicalPlanShas}:{});
  return async function proposeRequestHandoff({binding,basis,snapshot,entry,requestEvidence,run,resultObject,manifestObject,observedAt,at}){
    must(Number.isSafeInteger(at)&&Number.isSafeInteger(observedAt)&&at>=observedAt&&at-observedAt<30000,'FRESH_HANDOFF_SNAPSHOT');
    must(entry.planSha256===expected.planSha256&&entry.plan.sourceCommit===expected.sourceCommit&&entry.attempt?.runId===expected.runId,'EXACT_OLD_REVIEW');
    exactRunV6(run,{runId:expected.runId,sourceCommit:expected.sourceCommit,workflowId:binding.release.workflowId,reusableCommit:binding.release.reusableCommit});
    const checked=await verifier.verifyBaseline({basis,snapshot,entry,requestEvidence,binding}),target=await nextRequestTarget();
    assertAdmissionSnapshot(checked.deployment,at);
    for(const [object,sha] of [[resultObject,expected.resultSha256],[manifestObject,expected.manifestSha256]])
      must(object?.encryption==='AES256'&&object.contentLength>0&&object.contentLength<=1000000&&typeof object.versionId==='string'&&
        await sha256Hex(object.value)===sha,'EXPIRED_EVIDENCE_HASH');
    const result=resultObject.value,envelope=manifestObject.value,inner=envelope.innerManifest;
    must(resultObject.versionId===expected.resultVersionId&&manifestObject.versionId===expected.manifestVersionId&&
      result.jobId===target.oldJobId&&result.mode==='Review'&&result.run?.runId===expected.runId&&result.run.commitSha===expected.sourceCommit&&
      result.outcome==='RECOVERY_REVIEW_PREPARED_NOT_APPROVED'&&result.executionReference===null&&result.basisSha256===basis.basisSha256&&
      result.cloudReportReference.sha256===expected.manifestSha256&&result.cloudReportReference.versionId===manifestObject.versionId&&
      envelope.recoveryReviewSha256===result.manifestSha256&&inner.jobPlan.jobId===target.oldJobId&&
      inner.jobPlan.claimBy===inner.jobPlan.preparedAt+900000&&at>=inner.jobPlan.claimBy&&at>=inner.workload.workloadExpiresAt&&
      entry.plan.expiresAt<=at,'OLD_REVIEW_EXPIRED');
    must(checked.jobs.filter(j=>['pending','running','retry_wait'].includes(j.status)).length===1&&
      checked.jobs.every(j=>['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null))&&
      !checked.jobs.some(j=>j.id===target.newJobId||j.dedupe_key==='express-initialized-v2:'+target.requestId),'HANDOFF_JOB_SET');
    const program=await compileHeldTransferProgram(checked,at,target);
    const proposal={schema:'techlong/delegated-request-handoff-proposal/v1',outcome:'REQUEST_HANDOFF_PROPOSED_REQUIRES_NEW_BINDING',
      target,observedAt,at,baselineSha256:await sha256Hex(normalizedState(checked)),program,
      effects:{oldJobUpdates:1,newHeldJobs:1,controlHistoryWrites:0,deploymentUpdates:0,cloudCalls:0,dispatches:0},
      compatibility:{frozenRuntimeJobId:OLD.newJobId,candidateJobId:target.newJobId,runtimeCompatible:false,bindingPublicationRequired:true},
      preparationIsNotApproval:true,physicalWrites:0,executionReady:false,retryAllowed:false};
    assertEvidenceSafeV5(proposal);return proposal;
  };
}
export const proposeRequestHandoff=createRequestHandoffCompiler();
