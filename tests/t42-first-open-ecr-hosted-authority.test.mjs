import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  projectT42HostedEcrRoleSession, renderT42HostedEcrAuthority, t42HostedEcrAuthorityScope, validateT42HostedEcrRoleSession,
} from '../ops/releases/first-open-ecr-hosted-authority.mjs';
import { renderT42HostedEcrLedgerPolicy } from '../ops/releases/first-open-ecr-hosted-ledger.mjs';
import { t42PrivateEcrArtifactScope } from '../ops/releases/first-open-ecr-private-artifacts.mjs';

const fixture = {
  workflows: {
    publisher: { callerPath: '.github/workflows/t42-publish.yml', callerCommit: '1'.repeat(40),
      reusablePath: '.github/workflows/t42-publish-job.yml', reusableCommit: '2'.repeat(40) },
    reader: { callerPath: '.github/workflows/t42-read.yml', callerCommit: '3'.repeat(40),
      reusablePath: '.github/workflows/t42-read-job.yml', reusableCommit: '4'.repeat(40) },
  },
  archiveVersions: { platform: 'platform-proof-version', tenant: 'tenant-proof-version' },
  startsAt: '2026-11-28T17:00:00.000Z',
  expiresAt: '2026-11-28T17:15:00.000Z',
};
const { account, region, roles, providerArn, bucket, archiveKeys } = t42HostedEcrAuthorityScope;
const roleId = `AROA${'Z'.repeat(17)}`;
const provider = 'token.actions.githubusercontent.com';
const repository = 'veinyyxy/TechlongSoftware';

test('uses unchanged immutable subject template and exact separate environment and reusable trust', () => {
  const candidate = renderT42HostedEcrAuthority(fixture);
  for (const lane of ['reader', 'custody']) {
    const role = candidate[lane];
    const side = lane === 'reader' ? 'reader' : 'publisher';
    const workflow = fixture.workflows[side];
    const environment = lane === 'reader' ? 'techlong-sandbox-ecr-read' : 'techlong-sandbox-deploy';
    assert.deepEqual(role.role, roles[lane]);
    assert.deepEqual(role.trustPolicy.Statement, [{
      Effect: 'Allow', Principal: { Federated: providerArn }, Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          [`${provider}:aud`]: 'sts.amazonaws.com',
          [`${provider}:sub`]: `repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:${environment}`,
          [`${provider}:repository_id`]: '1323312747',
          [`${provider}:repository_owner_id`]: '14145707',
          [`${provider}:actor_id`]: '14145707',
          [`${provider}:ref`]: 'refs/heads/main',
          [`${provider}:environment`]: environment,
          [`${provider}:job_workflow_ref`]: `${repository}/${workflow.reusablePath}@${workflow.reusableCommit}`,
        },
        DateGreaterThanEquals: { 'aws:CurrentTime': fixture.startsAt },
        DateLessThan: { 'aws:CurrentTime': fixture.expiresAt },
      },
    }]);
  }
});

test('reader policy only reads the two ECR repositories and conditionally creates its ledger objects', () => {
  const { reader } = renderT42HostedEcrAuthority(fixture);
  const [ledger, read, extra] = reader.permissionsPolicy.Statement;
  assert.equal(extra, undefined);
  const existing = renderT42HostedEcrLedgerPolicy('reader').Statement[0];
  assert.equal(ledger.Action, 's3:PutObject');
  assert.deepEqual(ledger.Resource, existing.Resource);
  assert.deepEqual(ledger.Condition.StringEquals, existing.Condition.StringEquals);
  assert.deepEqual(read.Action, ['ecr:DescribeImages', 'ecr:BatchGetImage']);
  assert.deepEqual(read.Resource, [
    `arn:aws:ecr:${region}:${account}:repository/techlong-sandbox-platform-web`,
    `arn:aws:ecr:${region}:${account}:repository/techlong-sandbox-speedfeast`,
  ]);
  assert.deepEqual(read.Condition.StringEquals, { 'aws:RequestedRegion': region });
  assert.ok(reader.permissionsPolicy.Statement.every(s => s.Condition.DateLessThan['aws:CurrentTime'] === fixture.expiresAt));
});

test('custody policy conditionally creates only publisher ledger objects and reads each specified archive version', () => {
  const { custody } = renderT42HostedEcrAuthority(fixture);
  const [ledger, ...reads] = custody.permissionsPolicy.Statement;
  const existing = renderT42HostedEcrLedgerPolicy('publisher').Statement[0];
  assert.deepEqual(ledger.Resource, existing.Resource);
  assert.deepEqual(ledger.Condition.StringEquals, existing.Condition.StringEquals);
  assert.deepEqual(archiveKeys, t42PrivateEcrArtifactScope.keys);
  assert.equal(reads.length, 2);
  for (const [index, side] of ['platform', 'tenant'].entries()) {
    assert.equal(reads[index].Action, 's3:GetObjectVersion');
    assert.equal(reads[index].Resource, `arn:aws:s3:::${bucket}/${archiveKeys[side]}`);
    assert.deepEqual(reads[index].Condition.StringEquals, {
      'aws:RequestedRegion': region, 's3:VersionId': fixture.archiveVersions[side],
    });
  }
  assert.deepEqual(custody.permissionsPolicy.Statement.map(s => s.Action), ['s3:PutObject', 's3:GetObjectVersion', 's3:GetObjectVersion']);
});

test('does not render trust or access for a wide window, an unsafe policy variable, or an absent archive version', () => {
  assert.throws(() => renderT42HostedEcrAuthority({ ...fixture, expiresAt: '2026-11-28T18:00:01.000Z' }), /WINDOW/);
  for (const version of [undefined, 'null', '${aws:userid}']) {
    assert.throws(() => renderT42HostedEcrAuthority({
      ...fixture, archiveVersions: { ...fixture.archiveVersions, tenant: version },
    }), /BINDING|ARCHIVE_POLICY_VARIABLE/);
  }
});

test('role identity checking requires the exact approved lane, account, role ID, and session', () => {
  for (const lane of ['reader', 'custody']) {
    const session = `t42-${lane}-fixture`;
    const expected = { arn: `arn:aws:sts::${account}:assumed-role/${roles[lane].name}/${session}`, userId: `${roleId}:${session}` };
    const actual = { Account: account, Arn: expected.arn, UserId: expected.userId };
    assert.deepEqual(validateT42HostedEcrRoleSession(lane, expected), expected);
    assert.deepEqual(projectT42HostedEcrRoleSession(lane, expected, actual), expected);
    assert.throws(() => validateT42HostedEcrRoleSession(lane === 'reader' ? 'custody' : 'reader', expected), /SESSION/);
    assert.throws(() => validateT42HostedEcrRoleSession(lane, { ...expected, userId: `${roleId}:unapproved` }), /SESSION/);
    assert.throws(() => projectT42HostedEcrRoleSession(lane, expected, { ...actual, Account: '000000000000' }), /CALLER/);
    assert.throws(() => projectT42HostedEcrRoleSession(lane, expected, { ...actual, UserId: 'other' }), /CALLER/);
  }
});
