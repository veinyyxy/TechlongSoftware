import { S3Client, HeadBucketCommand, GetPublicAccessBlockCommand, GetBucketEncryptionCommand,
  GetBucketOwnershipControlsCommand, GetBucketVersioningCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { assertCloudSessionV5, requireCloudV5 as must } from './cloud-session-v5.mjs';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../lib/deployments/initialized-platform-request-v1.ts';
export const EVIDENCE_V5 = Object.freeze({ bucket: 'techlong-sandbox-cloud-worker-evidence-402010193138', owner: '402010193138', region: 'ca-central-1' });
const kinds = ['manifest.json','provider-before.json','create-ack.json','provider-after.json','run.json','inspect.json'];
export function assertEvidenceSafeV5(value) {
  const walk = (v, key = '') => {
    if (v === null || v === undefined) return;
    if (/^(?:lease_?token|databaseurl|password|secretaccesskey|sessiontoken|accesskeyid|signingprivatekeypem|clientprivatekeypem)$/i.test(key))
      must(key === 'lease_token' && v === null, 'EVIDENCE_CAPABILITY_FIELD');
    if (typeof v === 'string') must(!/postgres(?:ql)?:\/\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bASIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(v) &&
      !/lease_(?!0{32}\b)[a-f0-9]{32}/.test(v), 'EVIDENCE_SECRET_VALUE');
    if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(value); must(Buffer.byteLength(canonicalJson(value)) <= 1000000, 'EVIDENCE_SIZE'); return value;
}
export function evidenceKeyV5(kind, ref) {
  must(kinds.includes(kind) && /^job_[a-f0-9]{24}$/.test(ref.jobId) && /^[a-f0-9]{64}$/.test(ref.manifestSha256), 'EVIDENCE_REFERENCE');
  let key = `worker-v5/${S.appInstanceId}/${ref.jobId}/${ref.manifestSha256}/`;
  if (kind !== 'manifest.json') { must(/^[1-9][0-9]{0,19}$/.test(ref.run?.runId) && Number.isSafeInteger(ref.run.runAttempt) && ref.run.runAttempt > 0, 'EVIDENCE_RUN');
    key += `run-${ref.run.runId}-${ref.run.runAttempt}/`; }
  return key + kind;
}
export function createEvidencePortV5(send) {
  let verified = false, halted = false;
  const C = EVIDENCE_V5, base = { Bucket: C.bucket, ExpectedBucketOwner: C.owner };
  async function call(command, signal) {
    must(!halted, 'EVIDENCE_HALTED'); signal.throwIfAborted();
    try { return await send(command, signal); } catch { halted = true; throw Error('EVIDENCE_REQUIRES_INSPECT_NO_RETRY'); }
  }
  return Object.freeze({
    async verify(signal) {
      must(!verified, 'EVIDENCE_VERIFY_ONCE');
      const h = await call(new HeadBucketCommand(base), signal);
      const p = await call(new GetPublicAccessBlockCommand(base), signal), e = await call(new GetBucketEncryptionCommand(base), signal),
        o = await call(new GetBucketOwnershipControlsCommand(base), signal), v = await call(new GetBucketVersioningCommand(base), signal);
      const b = p.PublicAccessBlockConfiguration;
      must(h.BucketRegion === C.region && b && ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].every(k => b[k] === true) &&
        v.Status === 'Enabled' && e.ServerSideEncryptionConfiguration?.Rules?.length === 1 &&
        e.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm === 'AES256' &&
        o.OwnershipControls?.Rules?.length === 1 && o.OwnershipControls.Rules[0].ObjectOwnership === 'BucketOwnerEnforced', 'EVIDENCE_BUCKET_LAYOUT');
      verified = true; return { bucket: C.bucket, region: C.region, privateVersionedConditionalWrites: true };
    },
    async put(kind, ref, value, signal) {
      must(verified, 'EVIDENCE_PREFLIGHT'); assertEvidenceSafeV5(value);
      const Key = evidenceKeyV5(kind, ref), Body = canonicalJson(value), digest = await sha256Hex(value);
      const r = await call(new PutObjectCommand({ ...base, Key, Body, IfNoneMatch: '*', ServerSideEncryption: 'AES256',
        ContentType: 'application/json', ChecksumSHA256: Buffer.from(digest, 'hex').toString('base64') }), signal);
      must(r.VersionId && r.ServerSideEncryption === 'AES256', 'EVIDENCE_WRITE_ACK');
      return { key: Key, versionId: r.VersionId, sha256: digest };
    },
    async get(kind, ref, expected, signal) {
      must(verified && expected?.versionId && /^[a-f0-9]{64}$/.test(expected.sha256), 'EVIDENCE_READ_BINDING');
      const r = await call(new GetObjectCommand({ ...base, Key: evidenceKeyV5(kind, ref), VersionId: expected.versionId }), signal);
      must(r.VersionId === expected.versionId && r.ServerSideEncryption === 'AES256' && r.ContentLength > 0 && r.ContentLength <= 1000000, 'EVIDENCE_READ_METADATA');
      const value = JSON.parse(await r.Body.transformToString()); assertEvidenceSafeV5(value);
      must(await sha256Hex(value) === expected.sha256, 'EVIDENCE_READ_HASH'); return value;
    },
  });
}
export function createCloudEvidenceV5(session) {
  assertCloudSessionV5(session);
  const client = new S3Client({ ...session.clientConfig(), endpoint: `https://s3.${EVIDENCE_V5.region}.amazonaws.com`, forcePathStyle: false });
  const port = createEvidencePortV5((command, signal) => client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }));
  return Object.freeze({ ...port, dispose() { client.destroy(); } });
}
