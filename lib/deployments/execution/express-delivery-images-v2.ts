/** C5i actual published registry manifests, not a re-tag/build instruction.
 * V1 is historical and deliberately unchanged. Existence/scans still need a
 * fresh provider check at execution admission; this catalog is not authority. */
const repository = '402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast';
export const EXPRESS_DELIVERY_IMAGES_V2 = Object.freeze({
  sourceCommit: '10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2',
  buildRunId: 38803364109,
  publicationRunId: 38807901068,
  app: `${repository}@sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`,
  lifecycle: `${repository}@sha256:34ba02327b5e7ed311e6c706790c16c5d97c5d1419584cc47df98a4d7b09714e`,
});
