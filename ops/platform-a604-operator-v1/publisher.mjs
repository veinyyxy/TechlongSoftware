import {createPublisherOperations} from '../platform-delegated-publisher-v1/operation.mjs';
import {proposeReviewSuccessor} from '../platform-delegated-publisher-v1/successor.mjs';
import {recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertA604Publication,assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {A604_JOB,A604_PROFILE,HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {createA604Runtime} from '../platform-a604-cloud-v1/runtime.mjs';
import {must,same} from './policy.mjs';
import {RISK,PUBLISH_SLOT} from './scope.mjs';
export const REQUEST_EVIDENCE=Object.freeze({schema:'techlong/a604-handoff-evidence/v1',transactionAt:A604_PROFILE.factsAt,
  independentObservedAt:A604_PROFILE.databaseCheckedAt,sealRawSha256:HANDOFF.sealRawSha256,afterSha256:HANDOFF.actualAfterSha256});
export function createA604PublisherOperations({publication:raw,profile:rawProfile=A604_PROFILE,requestEvidence:rawEvidence=REQUEST_EVIDENCE,now=Date.now}={}){
  const publication=freeze(structuredClone(raw)),profile=freeze(structuredClone(rawProfile)),requestEvidence=freeze(structuredClone(rawEvidence));
  const check=async p=>{must(same(p,publication),'SOURCE_PUBLICATION');return assertA604Publication(p,profile,now());};
  const runtime=createA604Runtime({publication,profile,now});
  const capability={schema:'techlong/a604-publisher-review/v1',assertBinding:check,assertScope:assertA604PlanScope,slot:PUBLISH_SLOT,riskFile:RISK,allowEmptyHistory:true,
    validateRequestEvidence:async e=>must(same(e,requestEvidence),'HANDOFF_EVIDENCE'),
    verifyRequestReadback:async(basis,input,at)=>{
      // The held row predates the new basis: do not recompile it at a fabricated
      // later timestamp. Compare its REAL complete after-state and projection.
      const s=normalizedState(input),d=recoveryData(basis,basis.createdAt),j=s.jobs.find(j=>j.id===A604_JOB);
      must(at===requestEvidence.transactionAt&&j?.status==='pending'&&j.attempts===0&&j.max_attempts===1&&j.payload.requestedAt===at&&
        j.available_at===Number.MAX_SAFE_INTEGER&&j.payload.cloudExecutionAuthorized===false&&
        await sha256Hex(s)===requestEvidence.afterSha256&&same(normalizedState({...s,jobs:s.jobs.filter(j=>j.id!==A604_JOB)}),d.state),'REAL_HELD_BASELINE');
    },
    propose:args=>proposeReviewSuccessor({...args,rebuildPackage:runtime.rebuild},{assertBinding:check,assertScope:assertA604PlanScope})};
  return createPublisherOperations({historicalPlanShas:[],capability});
}
