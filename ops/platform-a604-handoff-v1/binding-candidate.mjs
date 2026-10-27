// Post-transaction planning only; never a cloud/runtime activation capability.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {RECOVERY_SCOPE as ORIGINAL} from '../platform-recovery-v1/profile.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {verifyOperatorReview} from '../platform-request-v6/transfer-entry.mjs';
import {PROFILE,must} from './profile.mjs';
import {TARGET,SUCCESSFUL_PREDECESSOR,CLOUD_CANDIDATE} from './coordinates.mjs';
export function createBindingPlanner(profile=PROFILE){
  return async({review,approved,intent,after,inspection,databaseObservedAt})=>{
    must(intent?.oldJobId===TARGET.oldJobId&&intent.newJobId===TARGET.newJobId&&intent.baselineSha256===review.core.baselineSha256,'INTENT');
    await verifyOperatorReview(review,approved,review.createdAt,true,profile);
    must(Number.isSafeInteger(intent.at)&&intent.at>=review.createdAt&&intent.at<review.expiresAt&&
      Number.isSafeInteger(databaseObservedAt)&&databaseObservedAt>=intent.at,'REAL_DATABASE_TIMES');
    must(inspection?.outcome==='TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'&&inspection.oldJobId===TARGET.oldJobId&&inspection.newJobId===TARGET.newJobId,'INDEPENDENT_INSPECTION');
    await profile.verifyReadback(review.core.baseline,after,intent.at);
    const observed=normalizedState(after),projection=normalizedState({...observed,jobs:observed.jobs.filter(j=>j.id!==TARGET.newJobId)});
    must(projection.jobs.find(j=>j.id===TARGET.oldJobId)?.status==='canceled'&&projection.jobs.find(j=>j.id===SUCCESSFUL_PREDECESSOR)?.status==='succeeded','PREDECESSOR_NOT_PROMOTED');
    return {schema:'techlong/a604-binding-material-candidate/v1',state:'UNPUBLISHED',coordinates:CLOUD_CANDIDATE,
      handoff:{operatorSha256:approved,transactionAt:intent.at,independentDatabaseObservedAt:databaseObservedAt,
        actualAfterSha256:await sha256Hex(observed),projectionSha256:await sha256Hex(projection),projectionIsDatabaseSnapshot:false,
        projectionMeaning:'Exclude only the independently verified new held row; keep canceled9b and every original historical row.'},
      proposedProfile:{...ORIGINAL,newJobId:TARGET.newJobId,clientRequestId:TARGET.clientRequestId,requestId:TARGET.requestId,
        stateSha256:await sha256Hex(projection),factsAt:intent.at,databaseCheckedAt:databaseObservedAt,observedBy:databaseObservedAt},
      oldHeldRequestIsSuccessfulPredecessor:false,originalBasisExpiry:profile.facts.expiresAt,
      requiresNewFactsWindowApproval:true,requiresPinnedPublication:true,runtimeCompatible:false,activationInstalled:false,executionAuthorized:false};
  };
}
export const planBindingCandidate=createBindingPlanner();
