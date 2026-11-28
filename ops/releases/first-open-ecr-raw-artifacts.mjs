import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const stagePrefix = 't42-ecr-artifacts-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export const t42RawEcrTargets = Object.freeze([
  Object.freeze({
    short: 'platform', repositoryName: 'techlong-sandbox-platform-web', imageTag: 't42-sandbox-0d24d19746776be3',
    archiveBytes: 313338460, archiveSHA: 'c74367f697ff1aa239b7a2be733f4d4d40d274a70ccca5d1d9766231ca894e6e',
    manifest: 'sha256:0d24d19746776be396a881c977f1f5539d560811a114496cc2849619690a0ff3',
    config: 'sha256:24a635d6d5a44138a9554cd1a80e981a09ffaa687f9b0372304b38ec91ec60e8',
    manifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    configMediaType: 'application/vnd.docker.container.image.v1+json',
    layerMediaType: 'application/vnd.docker.image.rootfs.diff.tar', layerCount: 7, requestCap: 216,
  }),
  Object.freeze({
    short: 'tenant', repositoryName: 'techlong-sandbox-speedfeast', imageTag: 't42-sandbox-a9fdabdca32e263d',
    archiveBytes: 65226217, archiveSHA: '43e3d3c30eb4483cf1a7f272ed0380aed797217be331af6d56e775a792bc60bd',
    manifest: 'sha256:a9fdabdca32e263d058602e126c321229478faaf9194e9aadfdb6ec07bfddc3f',
    config: 'sha256:e5742b61e177e862ef1e9986aa20265366e841e5caa83f24c5ae3946a7cf0579',
    manifestMediaType: 'application/vnd.oci.image.manifest.v1+json',
    configMediaType: 'application/vnd.oci.image.config.v1+json',
    layerMediaType: 'application/vnd.oci.image.layer.v1.tar', layerCount: 39, requestCap: 161,
  }),
]);

function requireArtifact(condition, code) {
  if (!condition) throw Error(`T42_ECR_ARTIFACT_${code}`);
}

async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function member(reference) {
  requireArtifact(digestPattern.test(reference), 'MEMBER_DIGEST');
  return `blobs/sha256/${reference.slice(7)}`;
}

async function tar(args, work) {
  const windows = process.platform === 'win32';
  const command = windows ? 'C:/Windows/System32/tar.exe' : '/usr/bin/tar';
  const env = windows ? { SystemRoot: 'C:\\Windows', TEMP: work, TMP: work } : { PATH: '/usr/bin:/bin', LANG: 'C' };
  try {
    const { stdout } = await runFile(command, args, { env, cwd: work, encoding: 'buffer',
      windowsHide: true, timeout: 160_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (cause) {
    throw Error('T42_ECR_ARTIFACT_TAR', { cause });
  }
}

async function prepareTarget(target, source, stage) {
  requireArtifact(typeof source === 'string' && source.length > 0, 'ARCHIVE_PATH');
  const localSource = resolve(source);
  if (process.platform === 'win32') {
    const { root } = parse(localSource);
    requireArtifact(/^[A-Za-z]:\\$/.test(root) && !localSource.slice(root.length).includes(':'), 'ARCHIVE_PATH');
  }
  const original = await lstat(localSource, { bigint: true });
  requireArtifact(original.isFile() && original.size === BigInt(target.archiveBytes), 'ARCHIVE_FILE');
  const work = join(stage, target.short);
  await mkdir(work, { mode: 0o700 });

  // Verify the private snapshot that tar will read. The supplied archive path
  // is never passed to tar and cannot replace bytes after this digest check.
  const archive = join(work, 'sealed.tar.gz');
  const handle = await open(localSource, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    requireArtifact(opened.isFile() && opened.dev === original.dev && opened.ino === original.ino &&
      opened.size === original.size, 'ARCHIVE_FILE');
    const sourceBytes = handle.createReadStream({ start: 0, end: target.archiveBytes - 1, autoClose: false });
    await pipeline(sourceBytes, createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
  } finally {
    await handle.close();
  }
  requireArtifact(await fileDigest(archive) === target.archiveSHA, 'ARCHIVE_DIGEST');

  const raw = await tar(['-xOzf', archive, '--', member(target.manifest)], work);
  requireArtifact(`sha256:${digest(raw)}` === target.manifest, 'MANIFEST_DIGEST');
  const wire = raw.toString('utf8');
  requireArtifact(Buffer.from(wire, 'utf8').equals(raw), 'MANIFEST_UTF8');
  const imageManifest = JSON.parse(wire);
  requireArtifact(imageManifest?.schemaVersion === 2 && imageManifest.mediaType === target.manifestMediaType &&
    imageManifest.config?.digest === target.config && imageManifest.config.mediaType === target.configMediaType &&
    Array.isArray(imageManifest.layers) && imageManifest.layers.length === target.layerCount &&
    imageManifest.layers.every(layer => layer?.mediaType === target.layerMediaType), 'MANIFEST_SHAPE');

  const descriptors = [imageManifest.config, ...imageManifest.layers];
  requireArtifact(descriptors.every(row => Number.isSafeInteger(row.size) && row.size > 0), 'BLOB_SIZE');
  const members = descriptors.map(row => member(row.digest));
  requireArtifact(new Set(members).size === members.length, 'DUPLICATE_MEMBER');
  await tar(['-xzf', archive, '-C', work, '--', ...members], work);

  const blobs = [];
  for (const [index, { digest: expected, size }] of descriptors.entries()) {
    const file = join(work, members[index]);
    const stat = await lstat(file);
    requireArtifact(stat.isFile() && stat.nlink === 1 && stat.size === size && await realpath(file) === file, 'BLOB_FILE');
    requireArtifact(`sha256:${await fileDigest(file)}` === expected, 'BLOB_DIGEST');
    blobs.push(Object.freeze({ digest: expected, size, file }));
  }
  const config = JSON.parse(await readFile(blobs[0].file, 'utf8'));
  requireArtifact(config?.os === 'linux' && config.architecture === 'amd64' &&
    Array.isArray(config.rootfs?.diff_ids) && config.rootfs.diff_ids.length === imageManifest.layers.length &&
    config.rootfs.diff_ids.every((id, index) => id === imageManifest.layers[index].digest), 'CONFIG_SHAPE');
  await rm(archive);
  return Object.freeze({ ...target, wire, blobs: Object.freeze(blobs) });
}

export async function prepareT42RawEcrArtifacts({ platformArchive, tenantArchive } = {}) {
  const parent = await realpath(tmpdir());
  const stage = await mkdtemp(join(parent, stagePrefix));
  const stageIdentity = await lstat(stage, { bigint: true });
  let disposal;
  const dispose = () => disposal ??= (async () => {
    const current = await lstat(stage, { bigint: true });
    requireArtifact(dirname(stage) === parent && basename(stage).startsWith(stagePrefix) &&
      current.isDirectory() && !current.isSymbolicLink() && await realpath(stage) === stage &&
      current.dev === stageIdentity.dev && current.ino === stageIdentity.ino, 'STAGING_PATH');
    await rm(stage, { recursive: true });
  })();

  try {
    const [platform, tenant] = t42RawEcrTargets;
    const targets = await Promise.allSettled([
      prepareTarget(platform, platformArchive, stage), prepareTarget(tenant, tenantArchive, stage),
    ]);
    const failed = targets.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return Object.freeze({ targets: Object.freeze(targets.map(result => result.value)), dispose });
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'T42_ECR_ARTIFACT_PREPARE'); }
    throw error;
  }
}
