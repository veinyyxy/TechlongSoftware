import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { openT42HostedSessionContext, t42HostedSessionCaps } from '../ops/releases/first-open-ecr-hosted-session.mjs';

const account = '402010193138';
const repository = 'veinyyxy/TechlongSoftware';
const repositoryId = 1323312747;
const actorId = '14145707';
const approvedSha256 = 'd'.repeat(64);
const now = Date.parse('2026-11-28T17:01:00.000Z');
const time = value => new Date(value).toISOString();
const api = `https://api.github.com/repos/${repository}/actions`;
const ids = { publisher: '1234567890', reader: '1234567891' };
const roles = {
  platform: ['TechlongSandboxPlatformImagePublisherV2', 'AROAV3GNMXTZID6CJJBA2'],
  tenant: ['TechlongSandboxInstanceReleasePublisherRole', 'AROAV3GNMXTZA2DT2FTQA'],
  custody: ['TechlongSandboxT42EcrPublicationCustodyRole', `AROA${'1'.repeat(17)}`],
  reader: ['TechlongSandboxT42EcrIndependentReaderRole', `AROA${'2'.repeat(17)}`],
};

function identity(side) {
  const [roleName, roleId] = roles[side];
  const session = `t42-${side}-fixture`;
  return { arn: `arn:aws:sts::${account}:assumed-role/${roleName}/${session}`, userId: `${roleId}:${session}` };
}

function fixture(side = 'publisher') {
  const workflows = {
    publisher: { callerPath: '.github/workflows/t42-publish.yml', callerCommit: '1'.repeat(40),
      reusablePath: '.github/workflows/t42-publish-job.yml', reusableCommit: '2'.repeat(40) },
    reader: { callerPath: '.github/workflows/t42-read.yml', callerCommit: '3'.repeat(40),
      reusablePath: '.github/workflows/t42-reader-job.yml', reusableCommit: '4'.repeat(40) },
  };
  const { callerPath, callerCommit, reusablePath, reusableCommit } = workflows[side];
  const callerRef = `${repository}/${callerPath}@refs/heads/main`;
  const environment = side === 'publisher' ? 'techlong-sandbox-deploy' : 'techlong-sandbox-ecr-read';
  const env = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: String(repositoryId),
    GITHUB_REPOSITORY_OWNER_ID: actorId, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: callerCommit, GITHUB_ACTOR_ID: actorId, GITHUB_WORKFLOW_REF: callerRef,
    TECHLONG_T42_ECR_APPROVAL_SHA: approvedSha256, GITHUB_RUN_ID: ids[side],
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/runners/oidctoken?api-version=2.0',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'internal-oidc-bearer-fixture',
  };
  const review = {
    schema: 'techlong/t42-raw-ecr-publication-review/v2', sourceBindingSha256: 'e'.repeat(64),
    startsAtMs: now - 60_000, expiresAtMs: now + 10 * 60_000,
    identities: { platform: identity('platform'), tenant: identity('tenant'), reader: identity('reader') },
  };
  const source = {
    schema: 'techlong/t42-hosted-ecr-source/v2', repositoryId, workflows, custodyIdentity: identity('custody'),
    phaseCutoffs: [120, 200, 300, 400, 500].map(seconds => time(now + seconds * 1000)),
  };
  const claims = {
    iss: 'https://token.actions.githubusercontent.com', aud: 'sts.amazonaws.com',
    sub: `repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:${environment}`,
    repository, repository_id: String(repositoryId), repository_owner_id: actorId, actor_id: actorId,
    ref: 'refs/heads/main', event_name: 'workflow_dispatch', environment, run_id: ids[side], run_attempt: '1',
    sha: callerCommit, workflow_ref: callerRef, job_workflow_ref: `${repository}/${reusablePath}@${reusableCommit}`,
    job_workflow_sha: reusableCommit, iat: now / 1000 - 1, exp: now / 1000 + 300,
  };
  const peerSide = side === 'publisher' ? 'reader' : 'publisher';
  const peerWorkflow = workflows[peerSide];
  const repo = { id: repositoryId, full_name: repository };
  const peer = {
    id: Number(ids[peerSide]), event: 'workflow_dispatch', status: 'in_progress', run_attempt: 1, head_branch: 'main',
    head_sha: peerWorkflow.callerCommit, path: peerWorkflow.callerPath, display_title: `t42-ecr-${peerSide}-${approvedSha256}`,
    created_at: time(now - 500), actor: { id: Number(actorId) }, triggering_actor: { id: Number(actorId) },
    repository: repo, head_repository: repo,
    referenced_workflows: [{ path: `${repository}/${peerWorkflow.reusablePath}@${peerWorkflow.reusableCommit}`,
      sha: peerWorkflow.reusableCommit }],
  };
  return { input: { side, source, review, approvedSha256, env, githubToken: 'github_actions_fixture' }, claims, peer };
}

const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const json = value => new Response(JSON.stringify(value), { status: 200 });
const page = (...rows) => ({ total_count: rows.length, workflow_runs: rows });

function stubs({ input, claims, peer }, { lists, authReply, confirmedPeer, status = 200, duration = 900, duplicateSession } = {}) {
  const trace = [];
  const oidcToken = [encoded({ alg: 'RS256', kid: 'test', typ: 'JWT' }), encoded(claims), 'fixture-signature'].join('.');
  let reads = 0;
  const keys = {};
  const options = {
    clock: () => now,
    wait: async () => {},
    fetchImpl: async (rawUrl, request) => {
      const url = new URL(rawUrl);
      if (url.hostname === 'pipelines.actions.githubusercontent.com') {
        trace.push('oidc');
        assert.equal(url.searchParams.get('audience'), 'sts.amazonaws.com');
        assert.equal(request.headers.authorization, 'Bearer internal-oidc-bearer-fixture');
        assert.equal(request.redirect, 'error');
        return json({ value: oidcToken });
      }
      assert.equal(url.hostname, 'api.github.com');
      assert.equal(request.headers.Authorization, 'Bearer github_actions_fixture');
      assert.equal(request.method, 'GET');
      if (url.href.startsWith(api + '/workflows/')) {
        trace.push('list');
        assert.equal(url.pathname, new URL(`${api}/workflows/${peer.path.split('/').at(-1)}/runs`).pathname);
        assert.deepEqual(Object.fromEntries(url.searchParams), {
          branch: 'main', event: 'workflow_dispatch', head_sha: peer.head_sha, created: '>=2026-11-28T17:00:00Z', per_page: '2',
        });
        return json(lists ? lists[Math.min(reads++, lists.length - 1)] : page(peer));
      }
      assert.equal(url.href, `${api}/runs/${peer.id}`);
      trace.push('peer');
      return json(confirmedPeer ?? peer);
    },
    stsRequestHandler: {
      async handle(request) {
        const params = new URLSearchParams(Buffer.from(request.body).toString('utf8'));
        const roleArg = params.get('RoleArn');
        const side = Object.keys(roles).find(side => roleArg === `arn:aws:iam::${account}:role/${roles[side][0]}`);
        assert.ok(side);
        trace.push(side);
        assert.equal(request.protocol, 'https:');
        assert.equal(request.hostname, 'sts.ca-central-1.amazonaws.com');
        assert.equal(request.headers.authorization, undefined);
        assert.equal(params.get('Action'), 'AssumeRoleWithWebIdentity');
        assert.equal(params.get('RoleSessionName'), `t42-${side}-fixture`);
        assert.equal(params.get('DurationSeconds'), String(duration));
        assert.equal(params.get('WebIdentityToken'), oidcToken);
        const expected = identity(side);
        const id = (side.at(0) + side.at(-1)).toUpperCase().repeat(9);
        const key = duplicateSession && side === 'tenant' ? keys.platform : `ASIA${id}`;
        keys[side] = key;
        const ack = { arn: expected.arn, userId: expected.userId, expiration: time(now + duration * 1000), ...authReply };
        const xml = status === 200
          ? `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
             <AssumeRoleWithWebIdentityResult><AssumedRoleUser><Arn>${ack.arn}</Arn>
             <AssumedRoleId>${ack.userId}</AssumedRoleId></AssumedRoleUser>
             <Credentials><AccessKeyId>${key}</AccessKeyId><SecretAccessKey>secret-fixture</SecretAccessKey>
             <SessionToken>session-fixture</SessionToken><Expiration>${ack.expiration}</Expiration></Credentials>
             </AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`
          : '<ErrorResponse><Error><Code>InternalFailure</Code><Message>private-upstream-response-body</Message></Error></ErrorResponse>';
        return { response: { statusCode: status, headers: {}, body: Readable.from([Buffer.from(xml)]) } };
      },
      destroy() {},
    },
  };
  assert.equal(input.env.GITHUB_RUN_ID, ids[input.side]);
  return { trace, options, keys, oidcToken };
}

test('publisher waits for the exact directly verified peer, then uses one OIDC token to get three separate unsigned AWS sessions', async () => {
  const target = fixture();
  const { trace, options, keys, oidcToken } = stubs(target, { lists: [page(), page({ ...target.peer, status: 'waiting' }), page(target.peer)] });
  const result = await openT42HostedSessionContext(target.input, options);
  assert.deepEqual(trace, ['oidc', 'list', 'list', 'list', 'peer', 'platform', 'tenant', 'custody']);
  assert.equal(result.peerRunId, ids.reader);
  assert.deepEqual(result.verifiedClaims, target.claims);
  assert.equal(result.writerCredentials.platform.accessKeyId, keys.platform);
  assert.equal(result.writerCredentials.tenant.accessKeyId, keys.tenant);
  assert.equal(result.custodyCredentials.accessKeyId, keys.custody);
  assert.ok(!JSON.stringify(result).includes(oidcToken));
});

test('independent reader receives only the approved role in the separate reader environment', async () => {
  const target = fixture('reader');
  const { trace, options, keys } = stubs(target);
  const result = await openT42HostedSessionContext(target.input, options);
  assert.deepEqual(trace, ['oidc', 'list', 'peer', 'reader']);
  assert.deepEqual(Object.keys(result), ['peerRunId', 'verifiedClaims', 'credentials']);
  assert.equal(result.credentials.accessKeyId, keys.reader);
  assert.equal(result.peerRunId, ids.publisher);
});

test('session duration covers a longer reviewed window without adding requests', async () => {
  const target = fixture('reader');
  target.input.review.expiresAtMs = now + 1200_000;
  const { trace, options } = stubs(target, { duration: 1205 });
  const result = await openT42HostedSessionContext(target.input, options);
  assert.deepEqual(trace, ['oidc', 'list', 'peer', 'reader']);
  assert.equal(result.credentials.expiration.getTime(), now + 1205_000);
});

test('wrong local review window, work source, caller, approval and role stop before either service', async () => {
  for (const wrong of [
    (input) => { input.review.startsAtMs = now + 1; },
    (input) => { input.review.startsAtMs = now; input.review.expiresAtMs = now + 3_600_000; },
    (input) => { input.source.schema = 'techlong/t42-hosted-ecr-source/v1'; },
    (input) => { input.env.GITHUB_SHA = 'a'.repeat(40); },
    (input) => { input.env.TECHLONG_T42_ECR_APPROVAL_SHA = 'a'.repeat(64); },
    (input) => { input.source.custodyIdentity = identity('reader'); },
    (input) => { input.review.identities.tenant = identity('platform'); },
  ]) {
    const target = fixture();
    const { trace, options } = stubs(target);
    wrong(target.input);
    await assert.rejects(openT42HostedSessionContext(target.input, options), /WINDOW|SOURCE_REVIEW|RUN_CONTEXT|SESSION|ROLE_BINDING/);
    assert.deepEqual(trace, []);
  }
});

test('wrong protected reader environment refuses peer and AWS requests', async () => {
  const target = fixture('reader');
  target.claims.environment = 'techlong-sandbox-deploy';
  const { trace, options } = stubs(target);
  await assert.rejects(openT42HostedSessionContext(target.input, options), /OIDC_CLAIMS/);
  assert.deepEqual(trace, ['oidc']);
});

test('stops on the six-list cap, an ambiguous exact run, or invalid peer confirmation', async () => {
  const target = fixture();
  for (const [stub, expected, lists] of [
    [{ lists: [page()] }, /PEER_NOT_FOUND/, t42HostedSessionCaps.githubPeerListsPerLane],
    [{ lists: [{ total_count: 3, workflow_runs: [target.peer, target.peer] }] }, /PEER_PAGE/, 1],
    [{ lists: [page(target.peer, target.peer)] }, /PEER_DUPLICATE/, 1],
    [{ confirmedPeer: { ...target.peer, referenced_workflows: [] } }, /PEER_REUSABLE/, 1],
  ]) {
    const { trace, options } = stubs(target, stub);
    await assert.rejects(openT42HostedSessionContext(target.input, options), expected);
    assert.equal(trace.filter(step => step === 'list').length, lists);
    assert.ok(!trace.some(step => Object.hasOwn(roles, step)));
  }
});

test('stops without retries or remaining credentials on wrong identity, expiration, or AWS failure', async () => {
  const target = fixture();
  for (const [stub, expected] of [
    [{ authReply: { userId: 'not-the-approved-role-session' } }, /STS_IDENTITY/],
    [{ authReply: { expiration: time(target.input.review.expiresAtMs) } }, /STS_COVERAGE/],
    [{ authReply: { expiration: time(now + 3_600_000) } }, /STS_COVERAGE/],
    [{ status: 500 }, { message: 'T42_ECR_HOSTED_SESSION_STS_REQUEST' }],
  ]) {
    const { trace, options } = stubs(target, stub);
    await assert.rejects(openT42HostedSessionContext(target.input, options), expected);
    assert.deepEqual(trace, ['oidc', 'list', 'peer', 'platform']);
  }
  const { trace, options } = stubs(target, { duplicateSession: true });
  await assert.rejects(openT42HostedSessionContext(target.input, options), /STS_SEPARATION/);
  assert.deepEqual(trace, ['oidc', 'list', 'peer', 'platform', 'tenant']);
});
