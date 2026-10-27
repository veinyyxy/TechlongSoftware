// Preparation only: serialised candidate, never a live publication capability.
// Original and after-state inputs remain private local artifacts, not Git data.
import {planBindingCandidate} from '../platform-a604-handoff-v1/binding-candidate.mjs';
import {A604_PROFILE,HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {recoveryBasisCompiler} from '../platform-recovery-v1/basis-core.mjs';
import {makeRecoveryPackage,rebuildRecoveryPackage,recoveryPackageKey} from '../platform-recovery-v1/package.mjs';
import {RECOVERY_CONTROL_BINDING as OLD} from '../platform-recovery-control-v1/binding.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {must,same} from './policy.mjs';
export function createPackageCandidateBuilder({derive=planBindingCandidate,profile=A604_PROFILE,originalSha256=OLD.packageReference.sha256}={}){
  return async function({originalPackage,handoff,createdAt}){
    must(await sha256Hex(originalPackage)===originalSha256,'ORIGINAL_PACKAGE_SHA');
    const candidate=await derive(handoff);must(same(candidate.proposedProfile,profile)&&Number.isSafeInteger(createdAt)&&
      createdAt>=profile.observedBy&&createdAt<profile.factsAt+profile.validMs,'CANDIDATE_PROFILE_TIME');
    const state=normalizedState({...handoff.after,jobs:handoff.after.jobs.filter(j=>j.id!==profile.newJobId)});
    must(await sha256Hex(state)===profile.stateSha256,'PROJECTION');
    const objects=originalPackage.objects,compile=recoveryBasisCompiler(profile),inputs={...originalPackage.inputs,state,createdAt};
    const cache=new Map(objects.map(o=>[canonicalJson(o.reference),o.object]));
    const basis=await compile({...inputs,readObject:async r=>{const v=cache.get(canonicalJson(r));must(v,'ORIGINAL_OBJECT');return structuredClone(v);}});
    const value=await makeRecoveryPackage({basis,inputs,objects});must(same(await rebuildRecoveryPackage(value,compile),basis),'PACKAGE_RECONSTRUCTION');
    return {schema:'techlong/a604-package-candidate/v1',state:'CANDIDATE_NOT_APPROVED',createdAt,profileSha256:await sha256Hex(profile),
      packageValue:value,packageSha256:await sha256Hex(value),packageKey:recoveryPackageKey(basis.basisSha256),basisSha256:basis.basisSha256,
      originalBasisExpiresAt:HANDOFF.originalBasisExpiresAt,proposedNewExpiresAt:basis.expiresAt,newFactsWindowApproved:false,
      realProjectionNotDatabaseSnapshot:true,approvedForUpload:false,approvedForRuntime:false,executionAuthorized:false};
  };
}
export const preparePackageCandidate=createPackageCandidateBuilder();
