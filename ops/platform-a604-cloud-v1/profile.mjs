// Public, source-selected coordinates derived from the verified handoff.
// These proposed fact times are NOT an approved new validity window.
import {RECOVERY_SCOPE as OLD} from '../platform-recovery-v1/profile.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
export const A604_JOB='job_a60423b885fef3e4326213f7';
export const REPLACED_HELD_JOB='job_9b57b43a6b88f37202b29170';
export const A604_PROFILE=freeze({...OLD,newJobId:A604_JOB,
  clientRequestId:'17004827-71da-4e61-9bb3-26cbf6fbb1ba',requestId:'3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9',
  stateSha256:'d049eeb3f589f78d90c33f09fa30ab5174a97915f34b87f897b06cfd0f9829c2',
  factsAt:1793109984483,databaseCheckedAt:1793109995619,observedBy:1793109995619});
export const HANDOFF=freeze({operatorSha256:'dee68024bddb7d468d1b44d64c1014b958a474822307a95055af493029940e2d',
  sealRawSha256:'864c2e510309320e8129f9372628bb473426e62119bc22227a92ae682f541f42',
  candidateSha256:'a649aadff64904b213bde74ed5e743773805ba2ee36c505d82d06386da6852b8',
  actualAfterSha256:'fc63f78250538658d0d193fe7eaaf69691c26a8e9aa79a6140270b7277563b88',
  originalBasisExpiresAt:1793126877695,projectionIsDatabaseSnapshot:false});
export const A604_RISK='docs/aws-auto-deployment-a604-cloud-compatibility.md';
export const A604_PUBLICATION=freeze({schema:'techlong/a604-protocol-publication/v1',state:'UNPUBLISHED',protocol:'recovery-envelope/v1',
  sourceCommit:null,frozenSourceCommit:null,release:null,basisSha256:null,packageReference:null,profileSha256:null,
  factsApproval:null,activation:null,riskFile:A604_RISK});
