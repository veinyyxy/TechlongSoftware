// Local/source capability composition; never part of the cloud closure.
// Ports are explicit. No credentials, connections, writer or dispatch on import.
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {assertA604Publication,assertA604PlanScope,must,same} from './contract.mjs';
import {A604_PROFILE,A604_PUBLICATION} from './profile.mjs';
import {createA604Runtime} from './runtime.mjs';
export async function createA604Publisher({basis,ports,publication:raw=A604_PUBLICATION,profile:rawProfile=A604_PROFILE,now=Date.now}){
  const publication=freeze(structuredClone(raw)),profile=freeze(structuredClone(rawProfile));
  await assertA604Publication(publication,profile,now());
  must(basis.basisSha256===publication.basisSha256&&same(recoveryData(basis,now()).target,profile),'PUBLISHER_BASIS');
  const runtime=createA604Runtime({publication,profile,now}),guard=async()=>{
    await assertA604Publication(publication,profile,now());await ports.guard(publication.activation);};
  const publisher=createRecoveryPublisher({basis,release:publication.release,sourceCommit:publication.sourceCommit,
    frozenSourceCommit:publication.frozenSourceCommit,activation:publication.activation,now,rebuildPackage:runtime.rebuild,
    ports:{...ports,guard,loadPlan:async sha=>{const e=await ports.loadPlan(sha);assertA604PlanScope(e?.plan,publication);return e;}}});
  return Object.freeze({
    async publishReview(options){await guard();const r=await publisher.publishReview(options);assertA604PlanScope(r.plan,publication);return r;},
    attestResult:(...args)=>publisher.attestResult(...args),
    async publishSuccessor(...args){const r=await publisher.publishSuccessor(...args);assertA604PlanScope(r.plan,publication);return r;},
    webLeaseRequired:false,githubEnvironmentApproval:'human-owner-required',dispatches:0});
}
