/** Actual registry manifests published by run 38682952254. These are NOT
 * image-config digests. Existence/scans must be rechecked before deployment.
 * Legacy FIRST_ACCEPTANCE_APP_IMAGE deliberately remains unchanged. */
const repository = '402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast';
export const EXPRESS_DELIVERY_IMAGES_V1 = Object.freeze({
  sourceCommit: '8753546772476b018d33b96ab66db4837abde186',
  publicationRunId: 38682952254,
  app: `${repository}@sha256:5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004`,
  lifecycle: `${repository}@sha256:c5ef6cf02f78fc61a4eff9a3c314a70ecf882f4189173464971c730ca3e2c759`,
});
