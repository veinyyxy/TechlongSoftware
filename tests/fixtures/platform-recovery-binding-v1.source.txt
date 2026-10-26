// Only an independently reviewed source publication may replace this binding.
// No environment flag or input manifest can activate it.
import {releaseReady,commit,digest} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
export const requireRecoveryControl=(ok,code)=>{if(!ok)throw Error('RECOVERY_V1_'+code);};
const must=requireRecoveryControl;
const recoveryPackageKey=sha=>`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-${sha}.json`;
export const RECOVERY_RISK='docs/aws-auto-deployment-w9h-recovery-control-followup.md';
export const RECOVERY_RUNTIME_CLOSURE='30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374';
export const RECOVERY_CONTROL_BINDING=Object.freeze({schema:'techlong/recovery-control-binding/v1',state:'CANDIDATE',
  protocol:'recovery-envelope/v1',sourceCommit:null,frozenSourceCommit:null,release:null,activation:null,
  controllerCodeCommit:null,basisSha256:null,packageReference:null,riskFile:RECOVERY_RISK});
function commonReady(b){return b?.schema==='techlong/recovery-control-binding/v1'&&b.state==='PUBLISHED'&&b.protocol==='recovery-envelope/v1'&&
  commit(b.frozenSourceCommit)&&!!b.release&&releaseReady(b.release)&&digest(b.basisSha256)&&b.riskFile===RECOVERY_RISK;}
export function recoveryBindingReady(b){
  return commonReady(b)&&commit(b.sourceCommit);
}
export function recoveryPublicationReady(b){return commonReady(b)&&b.sourceCommit===null&&commit(b.controllerCodeCommit)&&b.activation?.sourceCommit===null;}
async function assertCommon(b){
  must(b.release.closureSha256===RECOVERY_RUNTIME_CLOSURE,'CONTROL_RUNTIME_PROTOCOL_CLOSURE');
  assertReferenceV6(b.packageReference,recoveryPackageKey(b.basisSha256));
  must(b.activation?.schema==='techlong/recovery-bridge-activation/v1'&&b.activation.state==='PUBLISHED'&&
    b.activation.protocol===b.protocol&&b.activation.frozenSourceCommit===b.frozenSourceCommit&&
    b.activation.releaseSha256===await sha256Hex(b.release),'CONTROL_ACTIVATION_BINDING');
}
export async function assertRecoveryBinding(b){
  must(recoveryBindingReady(b),'CONTROL_BINDING_NOT_PUBLISHED');
  await assertCommon(b);must(b.activation.sourceCommit===b.sourceCommit,'CONTROL_ACTIVATION_SOURCE');return b;
}
export async function assertRecoveryPublication(b){
  must(recoveryPublicationReady(b),'CONTROL_PUBLICATION_NOT_PUBLISHED');await assertCommon(b);return b;
}
export async function bindRecoveryPublication(publication,sourceCommit){
  await assertRecoveryPublication(publication);must(commit(sourceCommit),'CONTROL_SOURCE_COMMIT');
  const value={...publication,sourceCommit,activation:{...publication.activation,sourceCommit}};
  return assertRecoveryBinding(value);
}
export function assertRecoveryPlanScope(plan,b){
  must(plan?.jobId==='job_9b57b43a6b88f37202b29170'&&plan.sourceCommit===b.sourceCommit&&
    plan.riskSha256===b.release.riskSha256&&plan.inputs.lineage===canonicalJson(b.packageReference),'CONTROL_EXACT_PLAN_SCOPE');
}
