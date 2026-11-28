import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  openT42HostedEcrLedger, renderT42HostedEcrLedgerBucketGuard, renderT42HostedEcrLedgerPolicy, t42HostedEcrLedgerScope,
} from '../ops/releases/first-open-ecr-hosted-ledger.mjs';
import { projectT42ProtectedEcrEvent } from '../ops/releases/first-open-ecr-protected-ledger.mjs';
import { t42RawEcrTargets } from '../ops/releases/first-open-ecr-raw-artifacts.mjs';

const approvedSha256 = 'a'.repeat(64);
const sourceBindingSha256 = 'b'.repeat(64);
const approval = { approvedSha256, sourceBindingSha256 };
const reviewSchema = 'techlong/t42-raw-ecr-publication-review/v1';
const scope = t42HostedEcrLedgerScope;
const absenceProof = { observedAt: '2026-11-27T21:30:00.000Z', readbackSha256: 'c'.repeat(64) };
const publisherPrincipalArn = `arn:aws:iam::${scope.owner}:role/FixturePublisher`;
const readerPrincipalArn = `arn:aws:iam::${scope.owner}:role/FixtureReader`;

function fakeSession() {
  return { accessKeyId: 'ASIA' + 'A' + '0'.repeat(15), secretAccessKey: 'fixture-not-a-secret',
    sessionToken: 'fixture-not-a-token', expiration: new Date(Date.now() + 120_000) };
}

function open(stage, extra) {
  return openT42HostedEcrLedger({ stage, ...approval, expiresAtMs: Date.now() + 60_000, credentials: fakeSession(), ...extra });
}

function event(state, fields = {}) {
  return { schema: reviewSchema, approvedSha256, state, at: new Date().toISOString(), ...fields };
}

function reply(statusCode, headers = {}, body = '') {
  return { response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) } };
}

function writeAck(headers = {}) {
  return reply(200, { 'x-amz-version-id': 'fixture-version', 'x-amz-server-side-encryption': 'AES256', ...headers });
}

function errorReply(status, code) {
  return reply(status, { 'content-type': 'application/xml' }, `<Error><Code>${code}</Code><Message>Synthetic only</Message></Error>`);
}

function wire(t, responder) {
  const requests = [];
  t.mock.method(NodeHttpHandler.prototype, 'handle', async (request, options) => {
    const key = decodeURIComponent(request.path).slice(1);
    const bytes = Buffer.from(request.body);
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const body = JSON.parse(bytes);
    assert.equal(request.method, 'PUT');
    assert.equal(request.protocol, 'https:');
    assert.equal(request.hostname, `${scope.bucket}.s3.${scope.region}.amazonaws.com`);
    assert.equal(request.headers['x-amz-expected-bucket-owner'], scope.owner);
    assert.equal(request.headers['x-amz-acl'], undefined);
    assert.equal(request.headers['if-none-match'], '*');
    assert.equal(request.headers['x-amz-server-side-encryption'], 'AES256');
    assert.equal(request.headers['x-amz-checksum-sha256'], checksum);
    assert.equal(request.headers['content-type'], 'application/json');
    assert.match(request.headers.authorization, /\/ca-central-1\/s3\/aws4_request/);
    assert.equal(request.headers['x-amz-security-token'], 'fixture-not-a-token');
    assert.ok(options.abortSignal instanceof AbortSignal && !options.abortSignal.aborted);
    assert.ok(bytes.length <= 2048);
    assert.deepEqual(Object.keys(request.query ?? {}), ['x-id']);
    assert.equal(request.query['x-id'], 'PutObject');
    assert.ok(key.startsWith(`${scope.prefix}/${body.stage}/`));
    assert.equal(body.releaseKey, scope.releaseKey);
    requests.push({ key, body });
    return responder(key, body, checksum);
  });
  return requests;
}

test('S3 conditional claims use fixed, distinct keys and permanent evidence across reviews', async t => {
  const claimedKeys = new Set();
  const requests = wire(t, (key, _, checksum) => {
    if (claimedKeys.has(key)) return errorReply(412, 'PreconditionFailed');
    claimedKeys.add(key);
    return writeAck({ 'x-amz-checksum-sha256': checksum });
  });
  const duplicateApproval = { approvedSha256: 'c'.repeat(64), sourceBindingSha256: 'd'.repeat(64) };
  const first = open('publisher');
  const duplicate = open('publisher', duplicateApproval);
  const reader = open('reader');
  try {
    const claimResults = await Promise.all([first.claimOnce(approval), duplicate.claimOnce(duplicateApproval)]);
    assert.deepEqual([...claimResults].sort(), [false, true]);
    const winner = claimResults[0] ? first : duplicate;
    const winnerApproval = winner === first ? approval : duplicateApproval;
    assert.equal(await first.claimOnce(approval), false);
    assert.equal(await duplicate.claimOnce(duplicateApproval), false);
    assert.equal(await reader.claimOnce(approval), true);
    await winner.appendEvidence(event('IDENTITY_CONFIRMED', { approvedSha256: winnerApproval.approvedSha256,
      side: 'platform', arn: `arn:aws:sts::${scope.owner}:assumed-role/FixturePublisher/publisher`, userId: 'AROAFIXTUREONLY:publisher' }));
    const tenant = t42RawEcrTargets[1];
    await reader.appendEvidence(event('ECR_ABSENCE_VERIFIED', { side: 'tenant', repositoryName: tenant.repositoryName,
      selector: 'imageDigest', value: tenant.manifest, ...absenceProof }));
    assert.deepEqual(requests.map(({ key }) => key), [scope.stages.publisher.claimKey, scope.stages.publisher.claimKey,
      scope.stages.reader.claimKey, scope.stages.publisher.eventPrefix + '001.json', scope.stages.reader.eventPrefix + '001.json']);
    assert.deepEqual(new Set(requests.slice(0, 2).map(({ body }) => body.approvedSha256)),
      new Set([approvedSha256, duplicateApproval.approvedSha256]));
    assert.equal(requests[3].body.sequence, 1);
    assert.match(requests[3].body.identitySha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(requests[3].body, 'arn'), false);
    assert.equal(Object.hasOwn(requests[3].body, 'userId'), false);
    assert.equal(requests[4].body.value, tenant.manifest);
  } finally { first.close(); duplicate.close(); reader.close(); }
});

test('a provider error, conflicting conditional request, or invalid version ACK stops the port without a second request', async t => {
  for (const [name, response] of [
    ['provider 500', () => errorReply(500, 'InternalError')],
    ['lost response', () => { throw new Error('synthetic socket loss'); }],
    ['conditional conflict', () => errorReply(409, 'ConditionalRequestConflict')],
    ['wrong result type for status 412', () => errorReply(412, 'UnexpectedConditionFailure')],
    ['no object versioning', () => writeAck({ 'x-amz-version-id': 'null' })],
    ['wrong encryption', () => writeAck({ 'x-amz-server-side-encryption': 'aws:kms' })],
    ['wrong checksum', () => writeAck({ 'x-amz-checksum-sha256': 'fixture-inconsistent-checksum' })],
  ]) {
    await t.test(name, async subtest => {
      const requests = wire(subtest, response);
      const ledger = open('publisher');
      try {
        await assert.rejects(ledger.claimOnce(approval), /CLAIM_UNCONFIRMED/);
        assert.equal(await ledger.claimOnce(approval), false);
        await assert.rejects(ledger.appendEvidence(event('ATTEMPT', { side: 'platform', operation: 'GetCallerIdentity', call: 1 })), /APPEND_STATE/);
        assert.equal(requests.length, 1);
      } finally { ledger.close(); }
    });
  }
});

test('event collision freezes evidence without overwriting, advancing, or resubmitting it', async t => {
  const requests = wire(t, key => key.endsWith('claim.json') ? writeAck() : errorReply(412, 'PreconditionFailed'));
  const ledger = open('reader');
  const record = event('ATTEMPT', { side: 'reader', operation: 'GetCallerIdentity', call: 1 });
  try {
    assert.equal(await ledger.claimOnce(approval), true);
    await assert.rejects(ledger.appendEvidence(record), /EVENT_UNCONFIRMED/);
    await assert.rejects(ledger.appendEvidence(record), /APPEND_STATE/);
    assert.deepEqual(requests.map(({ key }) => key), [scope.stages.reader.claimKey, scope.stages.reader.eventPrefix + '001.json']);
  } finally { ledger.close(); }
});

test('hosted event limits and selectors are isolated from the historical file ledger', () => {
  const late = event('RESPONSE_RECEIVED', { side: 'reader', operation: 'DescribeImages', call: 386 });
  const target = t42RawEcrTargets[0];
  const absence = event('ECR_ABSENCE_VERIFIED', { side: 'platform', repositoryName: target.repositoryName,
    selector: 'imageTag', value: target.imageTag, ...absenceProof });
  const hosted = { hosted: true };
  assert.equal(projectT42ProtectedEcrEvent(late, 'publisher', approvedSha256, hosted).call, 386);
  assert.equal(projectT42ProtectedEcrEvent({ ...late, call: 7 }, 'reader', approvedSha256, hosted).call, 7);
  assert.equal(projectT42ProtectedEcrEvent(absence, 'reader', approvedSha256, hosted).value, target.imageTag);
  assert.equal(projectT42ProtectedEcrEvent(absence, 'reader', approvedSha256, hosted).readbackSha256, absenceProof.readbackSha256);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...late, call: 8 }, 'reader', approvedSha256, hosted), /EVENT_OPERATION/);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...late, call: 387 }, 'publisher', approvedSha256, hosted), /EVENT_OPERATION/);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...late, side: 'platform', call: 1 }, 'publisher', approvedSha256, hosted), /EVENT_OPERATION/);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...absence, value: target.manifest }, 'reader', approvedSha256, hosted), /EVENT_ABSENCE/);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...absence, call: 1 }, 'reader', approvedSha256, hosted), /EVENT_ABSENCE/);
  assert.throws(() => projectT42ProtectedEcrEvent(absence, 'reader', approvedSha256), /EVENT_STOP/);
  assert.throws(() => projectT42ProtectedEcrEvent({ ...late, call: 2 }, 'reader', approvedSha256), /EVENT_OPERATION/);
  assert.equal(projectT42ProtectedEcrEvent({ ...late, operation: 'BatchGetImage', call: 3 }, 'reader', approvedSha256).call, 3);
});

test('requires explicit temporary sessions, respects per-side cap and halts on STOP', async t => {
  const requests = wire(t, () => writeAck());
  assert.throws(() => open('reader', { credentials: undefined }), /SESSION_COVERAGE/);
  assert.throws(() => open('reader', { credentials: { ...fakeSession(), accessKeyId: 'AKIA' + 'A' + '0'.repeat(15) } }), /SESSION_COVERAGE/);
  assert.throws(() => open('reader', { credentials: { ...fakeSession(), expiration: new Date(Date.now() + 25_000) } }), /SESSION_COVERAGE/);
  assert.throws(() => open('reader', { expiresAtMs: Date.now() + 10_000 }), /WINDOW/);
  assert.throws(() => open('unexpected'), /STAGE/);
  const ledger = open('reader');
  const record = event('ATTEMPT', { side: 'reader', operation: 'GetCallerIdentity', call: 1 });
  try {
    await assert.rejects(ledger.claimOnce({ ...approval, otherKey: true }), /CLAIM_BINDING/);
    await assert.rejects(ledger.appendEvidence(record), /APPEND_STATE/);
    await ledger.claimOnce(approval);
    for (let index = 1; index < scope.stages.reader.eventCap; index++) await ledger.appendEvidence(record);
    await ledger.appendEvidence(event('STOP_NO_RETRY', { calls: 1, code: 'ECR_RESULT_UNCONFIRMED', writerCalls: { platform: 0, tenant: 0 } }));
    await assert.rejects(ledger.appendEvidence(record), /APPEND_STATE/);
    assert.equal(requests.length, 23);
    assert.equal(requests.at(-1).key, scope.stages.reader.eventPrefix + '022.json');
  } finally { ledger.close(); }
});

test('IAM preview is restricted to the approved claim and finite-width same-side audit selector', () => {
  assert.equal(scope.bucket, 'techlong-sandbox-cloud-worker-evidence-402010193138');
  assert.equal(scope.prefix, 'first-open/t42-ecr/1cd968541550efb68b15ea1cb047db3df6c906d9b5b3bf0f392c1859750be3a8');
  const objectArn = `arn:aws:s3:::${scope.bucket}/`;
  for (const stage of ['publisher', 'reader']) {
    assert.equal(scope.stages[stage].claimKey, `${scope.prefix}/${stage}/claim.json`);
    const { Statement } = renderT42HostedEcrLedgerPolicy(stage);
    assert.equal(Statement.length, 1);
    const [statement] = Statement;
    assert.equal(statement.Action, 's3:PutObject');
    assert.deepEqual(statement.Resource, [objectArn + scope.stages[stage].claimKey, objectArn + scope.stages[stage].eventPrefix + '???.json']);
    assert.deepEqual(statement.Condition.StringEquals, { 'aws:RequestedRegion': 'ca-central-1',
      's3:if-none-match': '*', 's3:x-amz-server-side-encryption': 'AES256' });
  }
  const { Statement } = renderT42HostedEcrLedgerBucketGuard({ publisherPrincipalArn, readerPrincipalArn });
  assert.ok(Statement.every(statement => statement.Effect === 'Deny'));
  assert.equal(Statement[0].Condition.ArnNotEquals['aws:PrincipalArn'], publisherPrincipalArn);
  assert.equal(Statement[1].Condition.ArnNotEquals['aws:PrincipalArn'], readerPrincipalArn);
  assert.deepEqual(Statement[4].Action, ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:ReplicateDelete']);
  assert.throws(() => renderT42HostedEcrLedgerBucketGuard({ publisherPrincipalArn, readerPrincipalArn: publisherPrincipalArn }), /POLICY_PRINCIPALS/);
});
