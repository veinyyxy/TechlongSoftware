import { createHash } from 'node:crypto';
import { Agent } from 'node:https';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { projectT42ProtectedEcrEvent } from './first-open-ecr-protected-ledger.mjs';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const schema = 'techlong/t42-ecr-hosted-ledger/v1';
const owner = '402010193138';
const region = 'ca-central-1';
const bucket = 'techlong-sandbox-cloud-worker-evidence-402010193138';
const releaseKey = '1cd968541550efb68b15ea1cb047db3df6c906d9b5b3bf0f392c1859750be3a8';
const prefix = `first-open/t42-ecr/${releaseKey}`;
const encryption = 'AES256';
const requestMs = 20_000;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const stages = Object.freeze({
  publisher: Object.freeze({ claimKey: `${prefix}/publisher/claim.json`, eventPrefix: `${prefix}/publisher/events/`, eventCap: 784 }),
  reader: Object.freeze({ claimKey: `${prefix}/reader/claim.json`, eventPrefix: `${prefix}/reader/events/`, eventCap: 22 }),
});

export const t42HostedEcrLedgerScope = Object.freeze({ owner, region, bucket, prefix, releaseKey, stages });

function requireLedger(condition, code) {
  if (!condition) throw Error('T42_HOSTED_ECR_LEDGER_' + code);
}

function scopeForStage(stage) {
  requireLedger(stage === 'publisher' || stage === 'reader', 'STAGE');
  return stages[stage];
}

function stageResources(stage) {
  const scope = scopeForStage(stage);
  return [scope.claimKey, `${scope.eventPrefix}???.json`].map(key => `arn:aws:s3:::${bucket}/${key}`);
}

/** The three-digit object suffix is bounded by the adapter. IAM glob syntax
 * cannot express decimal ranges, and enumerating all objects exceeds the limit. */
export function renderT42HostedEcrLedgerPolicy(stage) {
  return {
    Version: '2012-10-17',
    Statement: [{
      Sid: 'CreateOnlyFixedT42CustodyObjects', Effect: 'Allow', Action: 's3:PutObject',
      Resource: stageResources(stage),
      Condition: { StringEquals: { 'aws:RequestedRegion': region, 's3:if-none-match': '*', 's3:x-amz-server-side-encryption': encryption } },
    }],
  };
}

/** Proposed statements to merge with the existing bucket policy after review.
 * Lifecycle configuration is a separate prerequisite for permanent objects. */
export function renderT42HostedEcrLedgerBucketGuard({ publisherPrincipalArn, readerPrincipalArn } = {}) {
  const principal = new RegExp(`^arn:aws:iam::${owner}:(?:role|user)/(?:[A-Za-z0-9+=,.@_-]+/)*[A-Za-z0-9+=,.@_-]+$`);
  requireLedger(principal.test(publisherPrincipalArn) && principal.test(readerPrincipalArn) &&
    publisherPrincipalArn !== readerPrincipalArn, 'POLICY_PRINCIPALS');
  const Resource = [...stageResources('publisher'), ...stageResources('reader')];
  const denyPut = { Effect: 'Deny', Principal: '*', Action: 's3:PutObject' };
  return {
    Version: '2012-10-17',
    Statement: [
      { ...denyPut, Sid: 'RequireFixedT42Publisher', Resource: stageResources('publisher'),
        Condition: { ArnNotEquals: { 'aws:PrincipalArn': publisherPrincipalArn } } },
      { ...denyPut, Sid: 'RequireFixedT42Reader', Resource: stageResources('reader'),
        Condition: { ArnNotEquals: { 'aws:PrincipalArn': readerPrincipalArn } } },
      { ...denyPut, Sid: 'RequireConditionalT42Creates', Resource,
        Condition: { StringNotEquals: { 's3:if-none-match': '*' } } },
      { ...denyPut, Sid: 'RequireT42LedgerEncryption', Resource,
        Condition: { StringNotEquals: { 's3:x-amz-server-side-encryption': encryption } } },
      { Sid: 'ProtectT42ClaimsAndEvents', Effect: 'Deny', Principal: '*', Resource,
        Action: ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:ReplicateDelete'] },
    ],
  };
}

function makeClient(credentials, expiresAtMs) {
  requireLedger(credentials && typeof credentials.accessKeyId === 'string' && /^ASIA[A-Z0-9]{16,124}$/.test(credentials.accessKeyId) &&
    typeof credentials.secretAccessKey === 'string' && credentials.secretAccessKey.length > 0 &&
    typeof credentials.sessionToken === 'string' && credentials.sessionToken.length > 0 &&
    credentials.expiration instanceof Date && credentials.expiration.getTime() > expiresAtMs, 'SESSION_COVERAGE');
  requireLedger(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.NODE_EXTRA_CA_CERTS &&
    !process.env.NODE_USE_ENV_PROXY, 'TLS_OVERRIDE');
  const httpsAgent = new Agent({ keepAlive: false, maxSockets: 1 });
  return new S3Client({ region, endpoint: `https://s3.${region}.amazonaws.com`, maxAttempts: 1, followRegionRedirects: false,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken, expiration: new Date(credentials.expiration) },
    requestHandler: new NodeHttpHandler({ httpsAgent, connectionTimeout: 5_000, requestTimeout: requestMs }),
  });
}

function occupied(error) {
  return error?.name === 'PreconditionFailed' && error.$metadata?.httpStatusCode === 412;
}

/** Opens the approved fixed S3 carrier for the caller's own stage. An
 * unconfirmed write freezes the port and never permits a replacement key. */
export function openT42HostedEcrLedger({ stage, approvedSha256, sourceBindingSha256, credentials, expiresAtMs } = {}) {
  const scope = scopeForStage(stage);
  const boundReleaseKey = createHash('sha256').update(JSON.stringify(t42RawEcrTargets.map(({ repositoryName, imageTag, manifest }) =>
    [owner, region, repositoryName, imageTag, manifest]))).digest('hex');
  requireLedger(boundReleaseKey === releaseKey && digest(approvedSha256) && digest(sourceBindingSha256) &&
    Number.isSafeInteger(expiresAtMs), 'BINDING');
  const checkWindow = () => requireLedger(Date.now() + requestMs < expiresAtMs, 'WINDOW');
  checkWindow();
  const client = makeClient(credentials, expiresAtMs);
  let state = 'new';
  let sequence = 0;

  async function createObject(key, event) {
    checkWindow();
    const Body = Buffer.from(JSON.stringify({ schema, releaseKey, stage, approvedSha256, sourceBindingSha256, sequence, ...event }));
    requireLedger(Body.length <= 2048, 'EVENT_SIZE');
    const ChecksumSHA256 = createHash('sha256').update(Body).digest('base64');
    const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body, ContentType: 'application/json',
      ExpectedBucketOwner: owner, ServerSideEncryption: encryption, IfNoneMatch: '*', ChecksumSHA256,
    }), { abortSignal: AbortSignal.timeout(requestMs) });
    requireLedger(result?.$metadata?.httpStatusCode === 200 && typeof result.VersionId === 'string' &&
      result.VersionId.length > 0 && result.VersionId.length <= 1024 && !/\s/.test(result.VersionId) && result.VersionId !== 'null' &&
      result.ServerSideEncryption === encryption && (result.ChecksumSHA256 === undefined || result.ChecksumSHA256 === ChecksumSHA256),
    'ACK');
  }

  return Object.freeze({
    async claimOnce(binding) {
      requireLedger(binding && Object.keys(binding).length === 2 && binding.approvedSha256 === approvedSha256 &&
        binding.sourceBindingSha256 === sourceBindingSha256, 'CLAIM_BINDING');
      if (state !== 'new') return false;
      state = 'claiming';
      try {
        await createObject(scope.claimKey, { state: 'CLAIMED', atUtc: new Date().toISOString() });
        state = 'active';
        return true;
      } catch (cause) {
        if (occupied(cause)) {
          state = 'occupied';
          return false;
        }
        state = 'failed';
        throw Error('T42_HOSTED_ECR_LEDGER_CLAIM_UNCONFIRMED', { cause });
      }
    },
    async appendEvidence(event) {
      requireLedger(state === 'active' && sequence < scope.eventCap, 'APPEND_STATE');
      state = 'recording';
      try {
        const projected = projectT42ProtectedEcrEvent(event, stage, approvedSha256, { hosted: true });
        sequence++;
        await createObject(`${scope.eventPrefix}${String(sequence).padStart(3, '0')}.json`, projected);
        state = projected.state === 'STOP_NO_RETRY' ? 'stopped' : 'active';
      } catch (cause) {
        state = 'failed';
        throw Error('T42_HOSTED_ECR_LEDGER_EVENT_UNCONFIRMED', { cause });
      }
    },
    close() {
      requireLedger(state !== 'claiming' && state !== 'recording', 'CLOSE_STATE');
      if (state === 'closed') return;
      state = 'closed';
      client.destroy();
    },
  });
}
