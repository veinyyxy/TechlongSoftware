// W8e: actual W8b ZIP/archive bytes checked on 2026-10-23. No execution authority.
import {P as LEGACY} from '../platform-image-publication-v2/plan.mjs';
import {PRODUCER,hostedProtocol} from '../platform-hosted-access-v6/publication.mjs';
export const C=Object.freeze({...LEGACY,...PRODUCER,
  artifactName:`platform-web-image-${PRODUCER.sourceCommit}-${PRODUCER.runId}`,
  imageConfigDigest:'sha256:c418fef9c5146ef1fcdb39f88cb28ffe2d50a8b89f64ce94f6c8f463f6924230',
  archiveSha256:'9c427ec8a2f5b4146ee578b0fd1f5f602f729cf09f65aa7bb5392b1c596a22f5',
  targetTag:`platform-sha${PRODUCER.sourceCommit}-r${PRODUCER.runId}-a1`,
  reusableFile:'platform-image-hosted-publish-job-v2.yml',callerFile:'platform-image-hosted-publish-v2.yml'});
export const protocol=hostedProtocol(C);
// Config digest is checked against the actual loaded image by the No-AWS job.
// Registry manifest digest is intentionally unknown until an approved publication.
