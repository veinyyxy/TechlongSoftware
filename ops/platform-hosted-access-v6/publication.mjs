// W8b adapter for the existing publisher protocol. No download, OIDC or dispatch.
import {P as LEGACY,must,same,publicationProtocol} from '../platform-image-publication-v2/plan.mjs';
import {verifyReceipt} from '../platform-hosting-v1/image-artifact.mjs';
import {runPublisher} from '../platform-image-publication-v2/publish.mjs';
export const PRODUCER=Object.freeze({sourceCommit:'f3cea2da7d26dfc09726c4cbc52cab40217340c6',runId:39960583333,artifactId:12503974340,
  artifactBytes:307773703,artifactDigest:'sha256:12f027cccd21d955c5a0c4db9b6f536606749028c0a1fdcc8d09f95279265723',
  artifactExpiresAt:'2026-10-26T13:24:09Z'});
export const RETAINED_IMAGE=Object.freeze({digest:'sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612',
  tag:'platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1'});
export function bindCandidate({receipt,verifiedArchive,zipDigest,zipBytes}){
  must(zipDigest===PRODUCER.artifactDigest&&zipBytes===PRODUCER.artifactBytes&&
    verifiedArchive?.outcome==='IMAGE_ARCHIVE_BYTES_VERIFIED_NOT_ECR'&&verifiedArchive.sourceCommit===PRODUCER.sourceCommit&&
    verifiedArchive.runId===String(PRODUCER.runId),'HOSTED_ARCHIVE_EVIDENCE');
  const proof=verifyReceipt(receipt,{bytes:receipt.archiveBytes,sha256:verifiedArchive.archiveSha256},
    {sourceCommit:PRODUCER.sourceCommit,runId:String(PRODUCER.runId)});
  must(same(proof,verifiedArchive),'HOSTED_ARCHIVE_BINDING');
  return Object.freeze({...LEGACY,...PRODUCER,artifactName:`platform-web-image-${PRODUCER.sourceCommit}-${PRODUCER.runId}`,
    imageConfigDigest:proof.imageConfigDigest,archiveSha256:proof.archiveSha256,
    targetTag:`platform-sha${PRODUCER.sourceCommit}-r${PRODUCER.runId}-a1`,
    reusableFile:'platform-image-hosted-publish-job-v2.yml',callerFile:'platform-image-hosted-publish-v2.yml'});
}
export function hostedProtocol(candidate){
  must(Object.entries(PRODUCER).every(([k,v])=>candidate?.[k]===v),'HOSTED_PRODUCER');const base=publicationProtocol(candidate),target=base.P;
  return Object.freeze({...base,verifyInventory(v){
    must(!v.nextToken&&v.imageDetails?.length===1,'HOSTED_REFERENCE_IMAGES');const i=v.imageDetails[0];
    must(i.registryId===target.account&&i.repositoryName===target.ecrRepository&&i.imageDigest===RETAINED_IMAGE.digest&&
      same(i.imageTags,[RETAINED_IMAGE.tag]),'HOSTED_REFERENCE_IMAGE_DRIFT');return true;
  }});
}
export function runHostedPublisher(input,candidate){return runPublisher({...input,protocol:hostedProtocol(candidate)});}
// Candidate hashes here must come from independently checked artifact bytes.
// A caller-supplied object is not proof of those bytes or execution authority.
// Protected workflow/source orchestration still needs its own reviewed binding.
