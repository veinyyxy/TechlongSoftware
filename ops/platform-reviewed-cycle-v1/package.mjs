// Local material preparation only. Reuse the original recovery compiler; no I/O.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {verifyOperatorReview} from '../platform-request-v6/transfer-entry.mjs';
import {RECOVERY_SCOPE} from '../platform-recovery-v1/profile.mjs';
import {recoveryBasisCompiler} from '../platform-recovery-v1/basis-core.mjs';
import {makeRecoveryPackage,rebuildRecoveryPackage,recoveryPackageKey} from '../platform-recovery-v1/package.mjs';
import {REQUEST_PROFILE} from './request-source.mjs';
import {createReviewedCycle,must,RISK} from './cycle.mjs';
import {projectHistory} from './composition.mjs';
// Match the installed status RPC's fields/slot precedence, without its LIMIT 12.
// This is a projection of archived rows, not a fresh database observation.
export function archivedControlHistory(state,at){
  must(Number.isSafeInteger(at),'HISTORY_TIME');
  return state.ledger.plans.map(p=>{const a=state.ledger.attempts.find(a=>a.plan_sha===p.plan_sha),
    used=state.ledger.attempts.some(a=>a.job_id===p.job_id&&a.mode===p.mode);
    return {jobId:p.job_id,planSha256:p.plan_sha,actionSha256:p.action_sha,riskSha256:p.risk_sha,sourceCommit:p.body.sourceCommit,
      mode:p.mode,expiresAt:p.body.expiresAt,state:a?.state??(used?'SLOT_OCCUPIED':at>=p.body.expiresAt?'EXPIRED':'AWAITING_APPROVAL'),
      runId:a?.run_id??null,runStatus:a?.run_status??null,conclusion:a?.conclusion??null,proofSha256:a?.proof_sha??null};});
}
// Optional capabilities are for synthetic tests/code composition, never CLI/JSON.
export function createCyclePackagePlanner({requestProfile=REQUEST_PROFILE,anchor=RECOVERY_SCOPE,originalSha256}={}){
  return async({originalPackage,handoff,sealRawSha256,createdAt})=>{
    const {review,approved,intent,after,inspection,databaseObservedAt}=handoff,t=requestProfile.target;
    must(await sha256Hex(originalPackage)===originalSha256,'ORIGINAL_PACKAGE_HASH');
    await verifyOperatorReview(review,approved,review.createdAt,true,requestProfile);
    must(intent.oldJobId===t.oldJobId&&intent.newJobId===t.newJobId&&intent.baselineSha256===review.core.baselineSha256&&
      Number.isSafeInteger(intent.at)&&intent.at>=review.createdAt&&intent.at<review.expiresAt&&Number.isSafeInteger(databaseObservedAt)&&
      databaseObservedAt>=intent.at&&Number.isSafeInteger(createdAt)&&createdAt>=databaseObservedAt&&createdAt<requestProfile.facts.expiresAt,'ACTUAL_HANDOFF_AND_PREPARATION_TIME');
    const verified=await requestProfile.verifyReadback(review.core.baseline,after,intent.at);
    must(canonicalJson({...verified,outcome:'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'})===canonicalJson(inspection)&&/^[a-f0-9]{64}$/.test(sealRawSha256),'INDEPENDENT_REQUEST_PROOF');
    const observed=normalizedState(after),state=normalizedState({...observed,jobs:observed.jobs.filter(j=>j.id!==t.newJobId)});
    must(state.jobs.find(j=>j.id===t.oldJobId)?.status==='canceled'&&state.jobs.find(j=>j.id===anchor.oldJobId)?.status==='succeeded','PREDECESSOR_NOT_PROMOTED');
    const profile={...anchor,newJobId:t.newJobId,clientRequestId:t.clientRequestId,requestId:t.requestId,stateSha256:await sha256Hex(state),
      factsAt:intent.at,databaseCheckedAt:databaseObservedAt,observedBy:databaseObservedAt},compile=recoveryBasisCompiler(profile),
      inputs={...originalPackage.inputs,state,createdAt},cache=new Map(originalPackage.objects.map(o=>[canonicalJson(o.reference),o.object]));
    const basis=await compile({...inputs,readObject:async ref=>{const o=cache.get(canonicalJson(ref));must(o,'ORIGINAL_OBJECT');return structuredClone(o);}}),
      packageValue=await makeRecoveryPackage({basis,inputs,objects:originalPackage.objects});
    must(canonicalJson(await rebuildRecoveryPackage(packageValue,compile))===canonicalJson(basis),'PACKAGE_REBUILD');
    const historicalJobIds=state.jobs.map(j=>j.id),history=projectHistory(archivedControlHistory(observed,databaseObservedAt),historicalJobIds),
      sourceCandidate={schema:'techlong/reviewed-cycle-source/v1',profile,historicalJobIds,historicalPlanCount:history.length,historySha256:await sha256Hex(history),
        requestEvidence:{schema:'techlong/reviewed-cycle-request-evidence/v1',jobId:t.newJobId,requestId:t.requestId,transactionAt:intent.at,
          independentObservedAt:databaseObservedAt,afterSha256:await sha256Hex(observed),sealRawSha256},
        publication:{schema:'techlong/reviewed-cycle-publication/v1',state:'UNPUBLISHED',protocol:'recovery-envelope/v1',riskFile:RISK,
          sourceCommit:null,frozenSourceCommit:null,release:null,basisSha256:basis.basisSha256,packageReference:null,
          profileSha256:await sha256Hex(profile),factsApproval:null,activation:null}};
    const cycle=await createReviewedCycle(sourceCandidate,{anchor});sourceCandidate.publication.cycleId=cycle.cycleId;
    return {schema:'techlong/reviewed-cycle-package-candidate/v1',state:'CANDIDATE_NOT_APPROVED',createdAt,sourceCandidate,cycleId:cycle.cycleId,
      packageValue,packageSha256:await sha256Hex(packageValue),canonicalBytes:Buffer.byteLength(canonicalJson(packageValue)),
      basisSha256:basis.basisSha256,packageKey:recoveryPackageKey(basis.basisSha256),profileSha256:await sha256Hex(profile),
      projectionIsDatabaseSnapshot:false,projectionMeaning:'Exclude only the independently verified new held row; retain canceled a604 and all original history.',
      originalPackageBasisExpiresAt:originalPackage.basis.expiresAt,preparationExpiresAt:requestProfile.facts.expiresAt,proposedNewExpiresAt:basis.expiresAt,
      newFactsWindowApproved:false,approvedForUpload:false,sourceSelected:false,executionAuthorized:false};
  };
}
