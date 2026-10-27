// Local-only operator scope. Not imported by either frozen cloud closure.
import {D as OLD} from '../platform-delegated-approval-v1/policy.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {A604_JOB,A604_PROFILE} from '../platform-a604-cloud-v1/profile.mjs';
import {bindA604WorkflowPublication,assertA604Publication} from '../platform-a604-cloud-v1/contract.mjs';
export const RISK='docs/aws-auto-deployment-a604-operator-v1.md';
export const D=freeze({...OLD,schema:'techlong/a604-delegated-approval/v1',jobId:A604_JOB,riskFile:RISK,
  slotPrefix:'F:/ChatGPT_workshop/techlong-a604-delegation-v1-',basisExpiresAt:A604_PROFILE.factsAt+A604_PROFILE.validMs});
export const PUBLISH_SLOT='F:/ChatGPT_workshop/techlong-a604-publisher-advance-v1.intent.json';
export const INSPECT_PUBLISH_SLOT='F:/ChatGPT_workshop/techlong-a604-inspect-publisher-v1.intent.json';
// Publication requires a later specifically reviewed SOURCE change. It cannot
// be supplied in the grant/material, via an env var or a CLI override.
export const LOCAL_PUBLICATION=freeze({"state":"PUBLISHED","template":{"schema":"techlong/a604-protocol-publication/v1","state":"PUBLISHED","protocol":"recovery-envelope/v1","sourceCommit":null,"frozenSourceCommit":"72a29559f914768a8df57c8e3e6b4ed940697e54","release":{"state":"PUBLISHED","workflowId":"390829326","actorId":"344813947","reusableCommit":null,"closureSha256":"f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269","identityProofSha256":"1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca","installationSha256":"0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1","riskSha256":"e017491cc8e8ae88d914f7a82371196fc996f0874c5ca9549b0e1215c7131849"},"basisSha256":"61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40","packageReference":{"key":"worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40.json","versionId":"WKWNfTsDXkQ5lZuqQRIG7YZw.4PERCEt","sha256":"03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e"},"profileSha256":"cfebd33eaf335e16801d0836efcf2f02b06b62eac4134ffed62d4e8c9e5202b7","factsApproval":{"state":"APPROVED","manifestSha256":"af800cdbe26b61f96a8454522a8c0e94f215aa72b0834c22bc83101fbf79ebce","profileSha256":"cfebd33eaf335e16801d0836efcf2f02b06b62eac4134ffed62d4e8c9e5202b7","factsAt":1793109984483,"databaseCheckedAt":1793109995619,"observedBy":1793109995619,"expiresAt":1793282784483,"originalBasisExtended":false},"activation":{"schema":"techlong/recovery-bridge-activation/v1","state":"PUBLISHED","protocol":"recovery-envelope/v1","sourceCommit":null,"frozenSourceCommit":"72a29559f914768a8df57c8e3e6b4ed940697e54","releaseSha256":null},"riskFile":"docs/aws-auto-deployment-a604-cloud-compatibility.md"},"reusableCommit":"e658f7b88ab50b4ff3c5653d46866b859fbadfe1"});
export async function publicationAt(sourceCommit,at){
  if(LOCAL_PUBLICATION.state!=='PUBLISHED')throw Error('A604_OPERATOR_PUBLICATION_NOT_PUBLISHED');
  const p=await bindA604WorkflowPublication(LOCAL_PUBLICATION.template,sourceCommit,LOCAL_PUBLICATION.reusableCommit);
  return assertA604Publication(p,A604_PROFILE,at);
}
