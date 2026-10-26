// W9n's actual independently checked bytes. Not a registry publication.
import {P,publicationProtocol,must,same} from '../platform-image-publication-v2/plan.mjs';
export const C=Object.freeze({...P,sourceCommit:'5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc',runId:40340097784,
  artifactId:12658433499,artifactBytes:307800935,
  artifactName:'platform-web-image-5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc-40340097784',
  artifactDigest:'sha256:d16bc943e4ff7792f1782675717db3df8fd2e9a9c33532756fa60edaa7426745',
  artifactExpiresAt:'2026-10-29T14:32:46Z',
  imageConfigDigest:'sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90',
  archiveSha256:'e91fd462db78dd3bd28f5b0ae7d313db9f1604d33dc77c0619e6e10a6cce54bb',
  targetTag:'platform-sha5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc-r40340097784-a1',
  reusableFile:'platform-image-recovery-publish-job-v1.yml',callerFile:'platform-image-recovery-publish-v1.yml'});
export const RETAINED=Object.freeze([
  Object.freeze({digest:'sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612',
    tag:'platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1'}),
  Object.freeze({digest:'sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789',
    tag:'platform-shaf3cea2da7d26dfc09726c4cbc52cab40217340c6-r39960583333-a1'}),
]);
export function verifyRetained(v){
  must(!v.nextToken&&v.imageDetails?.length===RETAINED.length,'RECOVERY_RETAINED_COUNT');
  for(const old of RETAINED){const rows=v.imageDetails.filter(x=>x.imageDigest===old.digest);
    must(rows.length===1&&rows[0].registryId===C.account&&rows[0].repositoryName===C.ecrRepository&&
      same(rows[0].imageTags,[old.tag]),'RECOVERY_RETAINED_IMAGE');}
  return true;
}
export function verifyFinalInventory(v,digest){
  must(!v.nextToken&&v.imageDetails?.length===RETAINED.length+1&&/^sha256:[a-f0-9]{64}$/.test(digest??'')&&
    !RETAINED.some(x=>x.digest===digest),'RECOVERY_FINAL_COUNT');
  const fresh=v.imageDetails.filter(x=>x.imageDigest===digest);
  must(fresh.length===1&&fresh[0].registryId===C.account&&fresh[0].repositoryName===C.ecrRepository&&
    same(fresh[0].imageTags,[C.targetTag]),'RECOVERY_FINAL_IMAGE');
  verifyRetained({imageDetails:v.imageDetails.filter(x=>x.imageDigest!==digest)});return true;
}
export const protocol=Object.freeze({...publicationProtocol(C),verifyInventory:verifyRetained});
