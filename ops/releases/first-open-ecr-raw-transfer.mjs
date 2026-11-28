import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';

const account = '402010193138';
const region = 'ca-central-1';
const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
const repositoryBySide = new Map([
  ['platform', 'techlong-sandbox-platform-web'],
  ['tenant', 'techlong-sandbox-speedfeast'],
]);
const manifestTypes = new Set([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
]);
const partMin = 5 * 1024 * 1024;
const partMax = 20 * 1024 * 1024;
const manifestMax = 1024 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function requireMatch(condition, reason) {
  if (!condition) throw new Error(reason);
}

const digestOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const emptyArray = value => value === undefined || (Array.isArray(value) && value.length === 0);

function verifiedManifest(target) {
  requireMatch(repositoryBySide.get(target?.short) === target?.repositoryName &&
    Boolean(target?.repositoryName) && digestPattern.test(target.manifest) &&
    target.imageTag === `t42-sandbox-${target.manifest.slice(7, 23)}`, 'STOP_TARGET_SCOPE');
  requireMatch(manifestTypes.has(target.manifestMediaType) && typeof target.wire === 'string' &&
    Buffer.byteLength(target.wire) <= manifestMax && digestOf(target.wire) === target.manifest, 'STOP_LOCAL_MANIFEST_BYTES');
  let manifest;
  try {
    manifest = JSON.parse(target.wire);
  } catch {
    throw new Error('STOP_LOCAL_MANIFEST_SHAPE');
  }
  requireMatch(manifest?.schemaVersion === 2 && manifest.mediaType === target.manifestMediaType &&
    manifest.manifests === undefined && Array.isArray(manifest.layers) && manifest.layers.length > 0 &&
    digestPattern.test(target.config) && manifest.config?.digest === target.config, 'STOP_LOCAL_MANIFEST_SHAPE');
  const descriptors = [manifest.config, ...manifest.layers];
  requireMatch(descriptors.every(blob => digestPattern.test(blob?.digest) && Number.isSafeInteger(blob.size) && blob.size > 0) &&
    new Set(descriptors.map(blob => blob.digest)).size === descriptors.length, 'STOP_LOCAL_DESCRIPTOR_SCOPE');
  return descriptors;
}

function verifiedBlobs(target) {
  const descriptors = verifiedManifest(target);
  const { blobs } = target;
  requireMatch(Array.isArray(blobs) && blobs.length === descriptors.length &&
    descriptors.every(({ digest, size }, index) => {
      const blob = blobs[index];
      return blob?.digest === digest && blob.size === size && typeof blob.file === 'string' && blob.file.length > 0;
    }), 'STOP_LOCAL_BLOB_SCOPE');
  return blobs;
}

const repositoryScope = target => ({ registryId: account, repositoryName: target.repositoryName });

function checkRepository(response, scope) {
  const repositories = response?.repositories;
  const repository = repositories?.[0];
  requireMatch(Array.isArray(repositories) && repositories.length === 1 && !response.nextToken &&
    repository?.registryId === scope.registryId && repository.repositoryName === scope.repositoryName &&
    repository.repositoryArn === `arn:aws:ecr:${region}:${account}:repository/${scope.repositoryName}` &&
    repository.repositoryUri === `${registry}/${scope.repositoryName}`, 'STOP_REPOSITORY_SCOPE');
  requireMatch(repository.imageTagMutability === 'IMMUTABLE' && emptyArray(repository.imageTagMutabilityExclusionFilters),
    'STOP_REPOSITORY_MUTABILITY');
}

/** Check that the exact immutable tag is unoccupied and determine which sealed blobs ECR lacks. */
export async function preflightT42RawImage(target, send) {
  const blobs = verifiedBlobs(target);
  const scope = repositoryScope(target);
  checkRepository(await send('DescribeRepositories', { registryId: account, repositoryNames: [scope.repositoryName] }), scope);

  const tag = await send('BatchGetImage', { ...scope, imageIds: [{ imageTag: target.imageTag }] });
  requireMatch(emptyArray(tag?.images) && Array.isArray(tag?.failures) && tag.failures.length === 1 &&
    tag.failures[0]?.failureCode === 'ImageNotFound' && tag.failures[0].imageId?.imageTag === target.imageTag,
    'STOP_TAG_NOT_PROVEN_FREE');

  const layerDigests = blobs.map(blob => blob.digest);
  const availability = await send('BatchCheckLayerAvailability', { ...scope, layerDigests });
  requireMatch(emptyArray(availability?.failures) && Array.isArray(availability?.layers) &&
    availability.layers.length === layerDigests.length, 'STOP_BLOB_CHECK_FAILURES');
  const unconfirmed = new Set(layerDigests);
  const missing = new Set();
  for (const layer of availability.layers) {
    requireMatch(unconfirmed.delete(layer?.layerDigest) &&
      (layer.layerAvailability === 'AVAILABLE' || layer.layerAvailability === 'UNAVAILABLE'), 'STOP_BLOB_CHECK_SCOPE');
    if (layer.layerAvailability === 'UNAVAILABLE') missing.add(layer.layerDigest);
  }
  return blobs.filter(blob => missing.has(blob.digest));
}

async function writeBlob(scope, blob, send) {
  const pathname = await lstat(blob.file);
  requireMatch(pathname.isFile() && pathname.size === blob.size, 'STOP_LOCAL_BLOB_SIZE');
  const file = await open(blob.file, 'r');
  try {
    const opened = await file.stat();
    requireMatch(opened.isFile() && opened.size === blob.size && opened.dev === pathname.dev && opened.ino === pathname.ino,
      'STOP_LOCAL_BLOB_IDENTITY');

    const start = await send('InitiateLayerUpload', scope);
    const { uploadId, partSize } = start ?? {};
    requireMatch(Number.isSafeInteger(partSize) && partSize >= partMin && partSize <= partMax, 'STOP_UNREVIEWED_PART_SIZE');
    requireMatch(typeof uploadId === 'string' && uploadId.length > 0 && uploadId.length <= 128, 'STOP_UPLOAD_ID');
    const checksum = createHash('sha256');
    let offset = 0;
    for await (const layerPartBlob of file.createReadStream({ highWaterMark: partSize, autoClose: false })) {
      requireMatch(offset < blob.size && layerPartBlob.length === Math.min(partSize, blob.size - offset), 'STOP_LOCAL_PART_SIZE');
      checksum.update(layerPartBlob);
      const partLastByte = offset + layerPartBlob.length - 1;
      const ack = await send('UploadLayerPart', { ...scope, uploadId, partFirstByte: offset, partLastByte, layerPartBlob });
      requireMatch(ack?.registryId === scope.registryId && ack.repositoryName === scope.repositoryName &&
        ack.uploadId === uploadId && ack.lastByteReceived === partLastByte, 'STOP_PART_ACK');
      offset = partLastByte + 1;
    }
    requireMatch(offset === blob.size, 'STOP_LOCAL_BLOB_SIZE');
    requireMatch(`sha256:${checksum.digest('hex')}` === blob.digest, 'STOP_LOCAL_BLOB_DIGEST');
    const complete = await send('CompleteLayerUpload', { ...scope, uploadId, layerDigests: [blob.digest] });
    requireMatch(complete?.registryId === scope.registryId && complete.repositoryName === scope.repositoryName &&
      complete.uploadId === uploadId && complete.layerDigest === blob.digest, 'STOP_COMPLETE_ACK');
  } finally {
    await file.close();
  }
}

function checkImage(image, scope, target, requireTag) {
  requireMatch(image?.registryId === scope.registryId && image.repositoryName === scope.repositoryName &&
    image.imageId?.imageDigest === target.manifest && (!requireTag || image.imageId.imageTag === target.imageTag),
    requireTag ? 'STOP_PUT_ACK_SCOPE' : 'STOP_READBACK_SCOPE');
  requireMatch(image.imageManifest === target.wire &&
    (image.imageManifestMediaType === undefined || image.imageManifestMediaType === target.manifestMediaType),
    requireTag ? 'STOP_PUT_ACK_BYTES' : 'STOP_READBACK_BYTES');
}

/** Send one manifest write after uploading precisely the missing sealed blobs, without retries. */
export async function uploadT42RawImage(target, missing, send) {
  const blobs = verifiedBlobs(target);
  requireMatch(Array.isArray(missing) && new Set(missing).size === missing.length &&
    missing.every(blob => blobs.includes(blob)), 'STOP_PREFLIGHT_BLOB_SCOPE');
  const scope = repositoryScope(target);
  for (const blob of missing) await writeBlob(scope, blob, send);
  const response = await send('PutImage', { ...scope, imageTag: target.imageTag, imageManifest: target.wire,
    imageManifestMediaType: target.manifestMediaType, imageDigest: target.manifest });
  checkImage(response?.image, scope, target, true);
  return { ...scope, imageTag: target.imageTag, imageDigest: target.manifest };
}

/** Obtain precisely one original single-platform manifest by digest with the independent reader. */
export async function readT42RawImage(target, send) {
  verifiedManifest(target);
  const scope = repositoryScope(target);
  const result = await send('BatchGetImage', { ...scope, imageIds: [{ imageDigest: target.manifest }] });
  requireMatch(Array.isArray(result?.images) && result.images.length === 1 && emptyArray(result.failures),
    'STOP_READBACK_IMAGE_COUNT');
  checkImage(result.images[0], scope, target, false);
  return { ...scope, imageDigest: target.manifest, imageConfigDigest: target.config, manifestMediaType: target.manifestMediaType };
}
