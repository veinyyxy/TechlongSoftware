import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { loadT42HostedEntryInputs } from '../ops/releases/first-open-ecr-hosted-entry.mjs';
import { parseT42HostedEcrSource, serveT42HostedEcrReader, t42HostedEcrReaderPort,
  t42PrivateHostedEcrSourceSchema } from '../ops/releases/first-open-ecr-hosted-job.mjs';
import { t42HostedEcrLedgerScope } from '../ops/releases/first-open-ecr-hosted-ledger.mjs';
import { t42PrivateEcrArtifactScope } from '../ops/releases/first-open-ecr-private-artifacts.mjs';
import { t42RawEcrTargets } from '../ops/releases/first-open-ecr-raw-artifacts.mjs';
import { openT42RawEcrIndependentReader, parseT42RawEcrReview, publishT42RawEcr,
  t42HostedEcrReviewSchema } from '../ops/releases/first-open-ecr-raw-publication.mjs';

const account = '402010193138';
const region = 'ca-central-1';
const hash = value => createHash('sha256').update(value).digest('hex');
const time = offset => new Date(Date.now() + offset).toISOString();
const replies = kind => ({
  reader: ['FixtureTrustedReader', 'AROAXXXXXXXXXXXXXXXXX'],
  platform: ['TechlongSandboxPlatformImagePublisherV2', 'AROAV3GNMXTZID6CJJBA2'],
  tenant: ['TechlongSandboxInstanceReleasePublisherRole', 'AROAV3GNMXTZA2DT2FTQA'],
})[kind];

function setup() {
  const { bucket, prefix } = t42HostedEcrLedgerScope;
  const workflows = Object.fromEntries(['publisher', 'reader'].map((lane, i) => [lane, {
    callerPath: `.github/workflows/t42-${lane}.yml`, callerCommit: String(i + 1).repeat(40),
    reusablePath: `.github/workflows/t42-${lane}-job.yml`, reusableCommit: String(i + 3).repeat(40),
  }]));
  const artifacts = Object.fromEntries(t42RawEcrTargets.map((row, index) => [row.short, {
    runId: 900011 + index, artifactId: 800011 + index, headSha: '5'.repeat(40), artifactDigest: `sha256:${'6'.repeat(64)}`,
  }]));
  const source = { schema: 'techlong/t42-hosted-ecr-source/v1', repositoryId: 1323312747, workflows, artifacts,
    ledger: { bucket, prefix }, phaseCutoffs: [60_000, 120_000, 180_000, 240_000, 300_000].map(time), uploadBundleSha256: '7'.repeat(64) };
  const sourceBindingText = JSON.stringify(source);
  const sourceBindingSha256 = hash(sourceBindingText);
  const identities = {};
  const credentials = {};
  for (const [i, side] of ['reader', 'platform', 'tenant'].entries()) {
    const [role, id] = replies(side);
    identities[side] = { arn: `arn:aws:sts::${account}:assumed-role/${role}/local-${side}`, userId: `${id}:local-${side}` };
    credentials[side] = { accessKeyId: 'ASIA' + String(i + 1).repeat(16), secretAccessKey: 'local-fixture-only',
      sessionToken: 'local-fixture-only', expiration: new Date(time(720_000)) };
  }
  const review = { schema: t42HostedEcrReviewSchema, sourceBindingSha256, startsAt: time(-2_000), expiresAt: time(360_000), identities,
    targets: t42RawEcrTargets.map(({ short, repositoryName, imageTag, archiveSHA, manifest, config, manifestMediaType, requestCap }) =>
      ({ short, repositoryName, imageTag, archiveSHA, manifest, config, manifestMediaType, requestCap })) };
  const reviewText = JSON.stringify(review);
  return { source, sourceBindingText, sourceBindingSha256, reviewText, approvedSha256: hash(reviewText), identities, credentials };
}

test('hosted source holds both run definitions, the exact ledger partition and immutable artifact coordinates', () => {
  const f = setup();
  const review = parseT42RawEcrReview(f.reviewText, f.approvedSha256, f.sourceBindingSha256);
  assert.deepEqual(parseT42HostedEcrSource(f.sourceBindingText, f.sourceBindingSha256, review), f.source);
  assert.throws(() => parseT42HostedEcrSource(f.sourceBindingText, '0'.repeat(64), review), /SOURCE_DIGEST/);
  const outside = JSON.stringify({ ...f.source, ledger: { ...f.source.ledger, prefix: f.source.ledger.prefix + '-wrong' } });
  const changed = hash(outside);
  assert.throws(() => parseT42HostedEcrSource(outside, changed, { ...review, sourceBindingSha256: changed }), /SOURCE_SCOPE/);
  assert.throws(() => parseT42HostedEcrSource(f.sourceBindingText, f.sourceBindingSha256,
    { ...review, schema: 'techlong/t42-raw-ecr-publication-review/v1' }), /SOURCE_DIGEST/);
});

test('the private hosted source binds the two object versions, separate custody session and exact independent reader', () => {
  const f = setup();
  const { artifacts: oldHandoff, ...oldHandoffFields } = f.source;
  assert.ok(oldHandoff.platform);
  const { owner, region, bucket, prefix } = t42PrivateEcrArtifactScope;
  const custody = `arn:aws:sts::${account}:assumed-role/TechlongSandboxT42EcrPublicationCustodyRole/private-custody`;
  const reader = `arn:aws:sts::${account}:assumed-role/TechlongSandboxT42EcrIndependentReaderRole/private-reader`;
  const source = { ...oldHandoffFields, schema: t42PrivateHostedEcrSourceSchema,
    privateArtifacts: { owner, region, bucket, prefix, versions: { platform: 'platform-version', tenant: 'tenant-version' } },
    custodyIdentity: { arn: custody, userId: 'AROA11111111111111111:private-custody' } };
  function parse(actual, readerArn = reader) {
    const text = JSON.stringify(actual);
    const pin = hash(text);
    const reviewText = JSON.stringify({ ...JSON.parse(f.reviewText), sourceBindingSha256: pin, identities: { ...f.identities,
      reader: { arn: readerArn, userId: 'AROA22222222222222222:private-reader' } } });
    const review = parseT42RawEcrReview(reviewText, hash(reviewText), pin);
    const parsed = parseT42HostedEcrSource(text, pin, review);
    return { parsed, env: { TECHLONG_T42_ECR_REVIEW_TEXT: reviewText, TECHLONG_T42_ECR_APPROVAL_SHA: hash(reviewText),
      TECHLONG_T42_ECR_SOURCE_TEXT: text, TECHLONG_T42_ECR_SOURCE_SHA: pin,
      TECHLONG_T42_ECR_RUNTIME_COMMIT: source.workflows.reader.reusableCommit, GH_TOKEN: 'SyntheticGitHubTokenOnly',
      TECHLONG_T42_ECR_UPLOAD_BUNDLE_PATH: resolve('fixture-artifact-bundle.js'), TECHLONG_T42_ECR_ARTIFACT_NODE: process.execPath } };
  }
  const valid = parse(source);
  assert.deepEqual(valid.parsed, source);
  assert.deepEqual(loadT42HostedEntryInputs('reader', valid.env).source, source);
  assert.throws(() => loadT42HostedEntryInputs('publisher', valid.env), /FROZEN_INPUT/);
  assert.throws(() => loadT42HostedEntryInputs('reader', { ...valid.env, TECHLONG_T42_ECR_REVIEW_TEXT: valid.env.TECHLONG_T42_ECR_REVIEW_TEXT + ' ' }), /REVIEW_DIGEST/);
  assert.throws(() => parse(source, reader.replace('TechlongSandboxT42EcrIndependentReaderRole', 'FixtureWrongReader')));
  assert.throws(() => parse({ ...source, custodyIdentity: { ...source.custodyIdentity, arn: reader } }));
  assert.throws(() => parse({ ...source, privateArtifacts: { ...source.privateArtifacts, prefix: t42HostedEcrLedgerScope.prefix } }));
  assert.throws(() => parse({ ...source, artifacts: oldHandoff }));
});

function temporaryLedger() {
  const rows = [];
  let claimed = false;
  return { rows,
    async claimOnce() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    async appendEvidence(row) { rows.push(row); },
  };
}

function pairedTransport() {
  const queue = new Map();
  function item(kind) {
    if (!queue.has(kind)) queue.set(kind, Promise.withResolvers());
    return queue.get(kind);
  }
  function side(name) {
    return { async take(kind) { return item(kind).promise; },
      async emit(kind, payload) {
        assert.equal(name, kind.endsWith('request') ? 'publisher' : 'reader');
        item(kind).resolve(payload);
      } };
  }
  return { publisher: side('publisher'), reader: side('reader') };
}

function reply(code, headers, payload) {
  return { response: { statusCode: code, headers, body: Readable.from([Buffer.from(payload)]) } };
}

const archives = {
  platformArchive: fileURLToPath(new URL('../outputs/t42-platform-release-seal-20261127/platform.oci.tar.gz', import.meta.url)),
  tenantArchive: fileURLToPath(new URL('../outputs/t42-tenant-os-remediation/sandbox-candidate-20261127/candidate.oci.tar.gz', import.meta.url)),
};
const missingArchives = Object.values(archives).some(path => !existsSync(path));

test('sealed archives reach one independent read after each PutImage, with four typed absence reads first',
  { timeout: 96_000, skip: missingArchives && 'local sealed OCI archives are unavailable' }, async t => {
  const f = setup();
  const before = NodeHttpHandler.prototype.handle;
  const observations = [];
  const stored = new Map();
  const json = body => reply(200, { 'content-type': 'application/x-amz-json-1.1' }, JSON.stringify(body));
  const channels = pairedTransport();
  const ledgers = { publisher: temporaryLedger(), reader: temporaryLedger() };
  NodeHttpHandler.prototype.handle = async request => {
    const side = Object.keys(f.credentials).find(name => request.headers.authorization?.includes(f.credentials[name].accessKeyId));
    assert.equal(request.protocol, 'https:');
    assert.equal(request.method, 'POST');
    assert.equal(request.path, '/');
    assert.ok(side);
    if (request.hostname === `sts.${region}.amazonaws.com`) {
      assert.equal(new URLSearchParams(Buffer.from(request.body).toString()).get('Action'), 'GetCallerIdentity');
      const { arn, userId } = f.identities[side];
      observations.push({ side, operation: 'GetCallerIdentity' });
      return reply(200, { 'content-type': 'text/xml' }, `<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>${arn}</Arn><UserId>${userId}</UserId><Account>${account}</Account></GetCallerIdentityResult></GetCallerIdentityResponse>`);
    }
    assert.equal(request.hostname, `api.ecr.${region}.amazonaws.com`);
    const operation = request.headers['x-amz-target'].split('.').at(-1);
    const input = JSON.parse(Buffer.from(request.body).toString());
    const target = t42RawEcrTargets.find(row => row.repositoryName === (input.repositoryName ?? input.repositoryNames?.[0]));
    const { repositoryName } = target;
    assert.equal(input.registryId, account);
    observations.push({ side, operation, repositoryName, ...(operation === 'DescribeImages' && { imageIds: input.imageIds }) });
    if (side === 'reader') {
      if (operation === 'DescribeImages') {
        return reply(400, { 'content-type': 'application/x-amz-json-1.1', 'x-amzn-errortype': 'ImageNotFoundException',
          'x-amzn-requestid': `typed-absence-${observations.length}` }, JSON.stringify({ __type: 'ImageNotFoundException' }));
      }
      assert.equal(operation, 'BatchGetImage');
      assert.deepEqual(input.imageIds, [{ imageDigest: target.manifest }]);
      assert.ok(stored.has(target.short));
      return json({ images: [stored.get(target.short)] });
    }
    assert.equal(side, target.short);
    const scope = { registryId: account, repositoryName };
    if (operation === 'DescribeRepositories') return json({ repositories: [{ ...scope,
      repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${repositoryName}`,
      repositoryUri: `${account}.dkr.ecr.${region}.amazonaws.com/${repositoryName}`, imageTagMutability: 'IMMUTABLE' }] });
    if (operation === 'BatchGetImage') return json({ images: [], failures: [{ failureCode: 'ImageNotFound', imageId: { imageTag: target.imageTag } }] });
    if (operation === 'BatchCheckLayerAvailability') return json({ layers: input.layerDigests.map(layerDigest => ({ layerDigest, layerAvailability: 'AVAILABLE' })) });
    assert.equal(operation, 'PutImage');
    assert.equal(input.imageTag, target.imageTag);
    assert.equal('sha256:' + hash(input.imageManifest), target.manifest);
    const image = { ...scope, imageId: { imageDigest: target.manifest, imageTag: target.imageTag }, imageManifest: input.imageManifest,
      imageManifestMediaType: target.manifestMediaType };
    stored.set(target.short, image);
    return json({ image });
  };
  const reader = openT42RawEcrIndependentReader({ ...f, credentials: f.credentials.reader, claimOnce: async () => true });
  t.after(() => { reader.close(); NodeHttpHandler.prototype.handle = before; });

  const binding = { reader: { runId: '900007' }, sourceBindingSha256: f.sourceBindingSha256 };
  const [readerResult, published] = await Promise.all([
    serveT42HostedEcrReader({ input: f, binding, transport: channels.reader, ledger: ledgers.reader, reader }),
    publishT42RawEcr({ ...f, archives, writerCredentials: { platform: f.credentials.platform, tenant: f.credentials.tenant },
      readerPort: t42HostedEcrReaderPort(channels.publisher, f.approvedSha256),
      claimOnce: ledgers.publisher.claimOnce, appendEvidence: ledgers.publisher.appendEvidence }),
  ]);
  assert.equal(readerResult.status, 'INDEPENDENT_READBACK_COMPLETE', readerResult.code);
  assert.equal(published.status, 'PUBLISHED_AND_INDEPENDENTLY_VERIFIED', published.code);
  assert.equal(published.calls, 17);
  assert.equal(observations.length, 17);
  assert.equal(readerResult.calls, 7);
  assert.deepEqual(observations.filter(item => item.operation === 'DescribeImages').flatMap(item => item.imageIds),
    t42RawEcrTargets.flatMap(row => [{ imageTag: row.imageTag }, { imageDigest: row.manifest }]));
  assert.ok(observations.slice(0, observations.findIndex(item => item.operation === 'PutImage'))
    .filter(item => item.operation === 'DescribeImages').length === 4);
  assert.deepEqual(observations.filter(item => item.operation === 'PutImage' || item.side === 'reader' && item.operation === 'BatchGetImage')
    .map(item => `${item.side}/${item.operation}`), ['platform/PutImage', 'reader/BatchGetImage', 'tenant/PutImage', 'reader/BatchGetImage']);
  assert.ok(published.absence.every(row => row.releaseBindingSha256 === f.sourceBindingSha256 && row.tagState === 'absent' && row.digestState === 'absent'));
  const readerHashes = ledgers.reader.rows.filter(row => row.state === 'INDEPENDENT_READBACK_VERIFIED').map(row => row.readbackSha256);
  assert.deepEqual(published.receipts.map(row => row.readbackSha256), readerHashes);
  assert.ok(published.receipts.every(row => /^[0-9a-f]{64}$/.test(row.ackSha256)));
  assert.equal(ledgers.reader.rows.filter(row => row.state === 'ECR_ABSENCE_VERIFIED').length, 4);
  assert.ok(ledgers.reader.rows.every(row => row.operation !== 'PutImage'));
});

test('an unconfirmed absence sends no reader-ready or later operation, and a second claim cannot start', async () => {
  const input = setup();
  const calls = [];
  const transport = { emit: (kind) => calls.push(kind) };
  const ledger = temporaryLedger();
  const reader = { identity: async () => ({ Arn: input.identities.reader.arn, UserId: input.identities.reader.userId }),
    async describeAbsence() { calls.push('DescribeImages'); throw Error('T42_RAW_ECR_ABSENCE_UNCONFIRMED'); } };
  const fixture = { input, binding: { sourceBindingSha256: input.sourceBindingSha256 }, transport, ledger, reader };
  assert.deepEqual(await serveT42HostedEcrReader(fixture), { status: 'STOP_NO_RETRY', code: 'T42_RAW_ECR_ABSENCE_UNCONFIRMED', calls: 2 });
  await assert.rejects(serveT42HostedEcrReader(fixture), /READER_CLAIMED/);
  assert.deepEqual(calls, ['DescribeImages']);
});
