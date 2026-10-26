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
export const RECOVERY_CONTROL_BINDING=Object.freeze({
  "schema": "techlong/recovery-control-binding/v1",
  "state": "PUBLISHED",
  "protocol": "recovery-envelope/v1",
  "sourceCommit": null,
  "frozenSourceCommit": "0494b2be7b0f559ac991533137dfb1b0388ac7a9",
  "release": {
    "state": "PUBLISHED",
    "workflowId": "390829326",
    "actorId": "344813947",
    "reusableCommit": "4c09548ab9852a4f3e948f0686f8c81251cda73b",
    "closureSha256": "30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374",
    "identityProofSha256": "1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca",
    "installationSha256": "0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1",
    "riskSha256": "09eab6e5c56119faed3c3f7eb3f952ad99a7a9d6b08f535b6e5e9280f4dc115b"
  },
  "activation": {
    "schema": "techlong/recovery-bridge-activation/v1",
    "state": "PUBLISHED",
    "protocol": "recovery-envelope/v1",
    "sourceCommit": null,
    "frozenSourceCommit": "0494b2be7b0f559ac991533137dfb1b0388ac7a9",
    "releaseSha256": "95ecceab51c79e580153cdeb0cec5e96ac092f30c3ea09c4d9edc030e21ce9b6"
  },
  "controllerCodeCommit": "655cc62e8557cc387d73b1e969498c8aee879b20",
  "basisSha256": "c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0",
  "packageReference": {
    "key": "worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0.json",
    "versionId": "Zz5fH5Javs900ZrmMrgi3QhBzFbCNkPm",
    "sha256": "07d9d9475033b35cc6a38597946c40a8389ccd4409c177122878590e94975ce7"
  },
  "riskFile": "docs/aws-auto-deployment-w9h-recovery-control-followup.md"
});
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
