import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { Agent } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { t42HostedEcrLedgerScope } from './first-open-ecr-hosted-ledger.mjs';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const { owner, region, bucket, releaseKey } = t42HostedEcrLedgerScope;
const prefix = `first-open/t42-ecr-input/${releaseKey}`;
const fileNames = Object.freeze({ platform: 'platform.oci.tar.gz', tenant: 'candidate.oci.tar.gz' });
const keys = Object.freeze({ platform: `${prefix}/${fileNames.platform}`, tenant: `${prefix}/${fileNames.tenant}` });
const encryption = 'AES256';

export const t42PrivateEcrArtifactScope = Object.freeze({ owner, region, bucket, prefix, releaseKey, keys, encryption });

class PrivateArtifactError extends Error {
  constructor(code) { super(`T42_ECR_PRIVATE_ARTIFACT_${code}`); }
}

function requireArtifact(condition, code) {
  if (!condition) throw new PrivateArtifactError(code);
}

const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const version = value => typeof value === 'string' && value !== 'null' && value.length > 0 &&
  Buffer.byteLength(value) <= 1024 && !/[\s\p{C}]/u.test(value);

export function parseT42PrivateEcrArtifactsBinding(binding) {
  requireArtifact(exact(binding, ['owner', 'region', 'bucket', 'prefix', 'versions']) &&
    binding.owner === owner && binding.region === region && binding.bucket === bucket && binding.prefix === prefix &&
    exact(binding.versions, ['platform', 'tenant']) && Object.values(binding.versions).every(version), 'BINDING');
  return Object.freeze({ owner, region, bucket, prefix,
    versions: Object.freeze({ platform: binding.versions.platform, tenant: binding.versions.tenant }) });
}

function sessionFor(credentials, expiresAtMs) {
  requireArtifact(credentials && typeof credentials.accessKeyId === 'string' && /^ASIA[A-Z0-9]{16,124}$/.test(credentials.accessKeyId) &&
    typeof credentials.secretAccessKey === 'string' && credentials.secretAccessKey.length > 0 &&
    typeof credentials.sessionToken === 'string' && credentials.sessionToken.length > 0 && credentials.expiration instanceof Date &&
    credentials.expiration.getTime() > expiresAtMs, 'SESSION_COVERAGE');
  requireArtifact(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.NODE_EXTRA_CA_CERTS &&
    !process.env.NODE_USE_ENV_PROXY, 'TLS_OVERRIDE');
  return { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken, expiration: new Date(credentials.expiration) };
}

function beforeDeadline(expiresAtMs) {
  const remaining = expiresAtMs - Date.now();
  requireArtifact(Number.isSafeInteger(expiresAtMs) && remaining > 0 && remaining <= 2 ** 32 - 1, 'WINDOW');
  return remaining;
}

async function openScratch(scratchRoot) {
  requireArtifact(typeof scratchRoot === 'string' && isAbsolute(scratchRoot), 'SCRATCH_ROOT');
  const root = await realpath(scratchRoot);
  const path = await mkdtemp(join(root, 't42-private-ecr-'));
  const original = await lstat(path, { bigint: true });
  requireArtifact(dirname(path) === root && original.isDirectory() && await realpath(path) === path, 'SCRATCH_DIRECTORY');
  let disposed = false;
  return { path, async dispose() {
    if (disposed) return;
    try {
      const current = await lstat(path, { bigint: true });
      requireArtifact(current.isDirectory() && current.dev === original.dev && current.ino === original.ino &&
        await realpath(path) === path, 'SCRATCH_CHANGED');
      await rm(path, { recursive: true, force: true });
      disposed = true;
    } catch (error) {
      if (error?.code === 'ENOENT') { disposed = true; return; }
      throw new PrivateArtifactError('SCRATCH_CLEANUP_UNCONFIRMED');
    }
  } };
}

async function receiveArchive(client, target, binding, directory, expiresAtMs) {
  const VersionId = binding.versions[target.short];
  const signal = AbortSignal.timeout(beforeDeadline(expiresAtMs));
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keys[target.short], VersionId,
    ExpectedBucketOwner: owner }), { abortSignal: signal });
  const body = result?.Body;
  try {
    requireArtifact(result?.$metadata?.httpStatusCode === 200 && result.VersionId === VersionId &&
      result.ServerSideEncryption === encryption && result.SSEKMSKeyId === undefined && result.ContentEncoding === undefined &&
      result.ContentRange === undefined && result.DeleteMarker !== true && result.ContentLength === target.archiveBytes &&
      body instanceof Readable, 'OBJECT_METADATA');
    const archive = join(directory, fileNames[target.short]);
    const hash = createHash('sha256');
    let received = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > target.archiveBytes) { callback(new PrivateArtifactError('ARCHIVE_LENGTH')); return; }
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(body, meter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
    beforeDeadline(expiresAtMs);
    requireArtifact(received === target.archiveBytes, 'ARCHIVE_LENGTH');
    requireArtifact(hash.digest('hex') === target.archiveSHA, 'ARCHIVE_DIGEST');
    return archive;
  } finally {
    if (body instanceof Readable) body.destroy();
  }
}

/** Read the approved immutable S3 versions once each; no listing, default credential
 * chain, retry, fallback version, upload, or deletion of remote objects. */
export async function resolveT42PrivateEcrArtifacts({ binding: source, credentials, expiresAtMs,
  scratchRoot = tmpdir(), requestHandler } = {}) {
  const binding = parseT42PrivateEcrArtifactsBinding(source);
  beforeDeadline(expiresAtMs);
  const session = sessionFor(credentials, expiresAtMs);
  const client = new S3Client({ region, endpoint: `https://s3.${region}.amazonaws.com`, forcePathStyle: true,
    maxAttempts: 1, followRegionRedirects: false, credentials: session,
    requestHandler: requestHandler ?? new NodeHttpHandler({ httpsAgent: new Agent({ keepAlive: false, maxSockets: 1 }),
      connectionTimeout: 5000, requestTimeout: 20_000 }),
  });
  let scratch;
  try {
    scratch = await openScratch(scratchRoot);
    const [platform, tenant] = t42RawEcrTargets;
    const platformArchive = await receiveArchive(client, platform, binding, scratch.path, expiresAtMs);
    const tenantArchive = await receiveArchive(client, tenant, binding, scratch.path, expiresAtMs);
    return Object.freeze({ platformArchive, tenantArchive, dispose: scratch.dispose });
  } catch (error) {
    await scratch?.dispose();
    throw error instanceof PrivateArtifactError ? error : new PrivateArtifactError('READ_UNCONFIRMED');
  } finally {
    client.destroy();
  }
}
