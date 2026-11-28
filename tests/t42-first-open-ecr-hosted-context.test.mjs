import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bootstrapT42EcrHostedContext, validateT42EcrHostedWorkflows, verifyT42EcrHostedContext, verifyT42EcrHostedPeerRun,
  t42HostedEcrAuthorityMode, t42HostedEcrReadEnvironment,
} from '../ops/releases/first-open-ecr-hosted-context.mjs';

const repository = 'veinyyxy/TechlongSoftware';
const repositoryId = 1323312747;
const actorId = '14145707';
const environment = 'techlong-sandbox-deploy';
const approvedSha256 = 'd'.repeat(64);
const now = Date.parse('2026-11-27T21:45:00.000Z');
const ids = { publisher: '1234567890', reader: '1234567891' };
const choices = {
  publisher: { callerPath: '.github/workflows/t42-publish.yml', callerCommit: '1'.repeat(40),
    reusablePath: '.github/workflows/t42-publish-job.yml', reusableCommit: '2'.repeat(40) },
  reader: { callerPath: '.github/workflows/t42-read.yml', callerCommit: '3'.repeat(40),
    reusablePath: '.github/workflows/t42-read-job.yml', reusableCommit: '4'.repeat(40) },
};

function source(side = 'publisher') {
  const workflows = structuredClone(choices);
  const { callerPath, callerCommit, reusablePath, reusableCommit } = workflows[side];
  const callerRef = `${repository}/${callerPath}@refs/heads/main`;
  const runId = ids[side];
  const peerRunId = ids[side === 'publisher' ? 'reader' : 'publisher'];
  const env = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: String(repositoryId),
    GITHUB_REPOSITORY_OWNER_ID: actorId, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: callerCommit, GITHUB_ACTOR_ID: actorId, GITHUB_WORKFLOW_REF: callerRef,
    TECHLONG_T42_ECR_APPROVAL_SHA: approvedSha256, GITHUB_RUN_ID: runId,
  };
  const verifiedClaims = {
    iss: 'https://token.actions.githubusercontent.com', aud: 'sts.amazonaws.com',
    sub: 'repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy',
    repository, repository_id: String(repositoryId), repository_owner_id: actorId, actor_id: actorId,
    ref: 'refs/heads/main', event_name: 'workflow_dispatch', environment, run_id: runId, run_attempt: '1',
    sha: callerCommit, workflow_ref: callerRef, job_workflow_ref: `${repository}/${reusablePath}@${reusableCommit}`,
    job_workflow_sha: reusableCommit, iat: now / 1000 - 1, exp: now / 1000 + 60,
  };
  return { side, workflows, approvedSha256, startsAtMs: now - 500, expiresAtMs: now + 15_000, peerRunId, env, verifiedClaims };
}

function observedRun(side) {
  const { callerPath, callerCommit, reusablePath, reusableCommit } = choices[side];
  const repo = { id: repositoryId, full_name: repository };
  return {
    id: Number(ids[side]), event: 'workflow_dispatch', status: 'in_progress', run_attempt: 1, head_branch: 'main',
    head_sha: callerCommit, path: callerPath, display_title: `t42-ecr-${side}-${approvedSha256}`,
    actor: { id: Number(actorId) }, triggering_actor: { id: Number(actorId) }, repository: repo, head_repository: repo,
    referenced_workflows: [{ path: `${repository}/${reusablePath}@${reusableCommit}`, sha: reusableCommit }],
  };
}

test('requires distinct immutable caller and reusable bindings for the independently authenticated roles', () => {
  assert.deepEqual(validateT42EcrHostedWorkflows(choices), choices);
  for (const side of ['publisher', 'reader']) {
    const input = source(side);
    assert.deepEqual(verifyT42EcrHostedContext(input, now), { runId: ids[side], peerRunId: input.peerRunId });
    assert.throws(() => verifyT42EcrHostedContext({ ...input, side: side === 'publisher' ? 'reader' : 'publisher' }, now), /RUN_CONTEXT/);
  }
  const duplicate = structuredClone(choices);
  duplicate.reader.reusablePath = duplicate.publisher.reusablePath;
  assert.throws(() => validateT42EcrHostedWorkflows(duplicate), /WORKFLOW_SEPARATION/);
  assert.throws(() => validateT42EcrHostedWorkflows({
    ...choices, reader: { ...choices.reader, reusableCommit: 'refs/heads/main' },
  }), /WORKFLOWS/);
});

test('rejects wrong review, caller, run attempt, absolute slot and ambient credential or proxy overrides', () => {
  for (const change of [
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_ACTOR_ID: '42' }, { GITHUB_REPOSITORY_OWNER_ID: '42' },
    { TECHLONG_T42_ECR_APPROVAL_SHA: '0'.repeat(64) }, { GITHUB_REF: 'refs/heads/other' },
  ]) {
    const input = source();
    Object.assign(input.env, change);
    assert.throws(() => verifyT42EcrHostedContext(input, now), /RUN_CONTEXT/);
  }
  for (const key of ['AWS_PROFILE', 'aws_endpoint_url', 'HTTPS_PROXY', 'NODE_OPTIONS']) {
    const input = source('reader');
    input.env[key] = 'replacement';
    assert.throws(() => verifyT42EcrHostedContext(input, now), /AMBIENT_OVERRIDE/);
  }
  const input = source();
  assert.throws(() => verifyT42EcrHostedContext(input, input.startsAtMs - 1), /WINDOW/);
  assert.throws(() => verifyT42EcrHostedContext(input, input.expiresAtMs), /WINDOW/);
  assert.throws(() => verifyT42EcrHostedContext({ ...input, peerRunId: ids.publisher }, now), /RUN_PAIR/);
});

test('refuses expired or cross-job GitHub identity claims', () => {
  for (const update of [
    { exp: now / 1000 }, { environment: 'other' }, { job_workflow_sha: choices.reader.reusableCommit },
    { run_id: ids.reader }, { sub: 'replacement' }, { workflow_ref: choices.reader.callerPath },
  ]) {
    const input = source();
    Object.assign(input.verifiedClaims, update);
    assert.throws(() => verifyT42EcrHostedContext(input, now), /OIDC_CLAIMS/);
  }
});

test('private S3 mode separates the independent reader environment and preserves publisher and legacy identities', () => {
  const legacyReader = source('reader');
  assert.doesNotThrow(() => verifyT42EcrHostedContext(legacyReader, now));
  assert.throws(() => verifyT42EcrHostedContext({ ...legacyReader, authorityMode: t42HostedEcrAuthorityMode }, now), /OIDC_CLAIMS/);
  const reader = { ...legacyReader, authorityMode: t42HostedEcrAuthorityMode,
    verifiedClaims: { ...legacyReader.verifiedClaims, environment: t42HostedEcrReadEnvironment,
      sub: legacyReader.verifiedClaims.sub.replace(environment, t42HostedEcrReadEnvironment) } };
  assert.doesNotThrow(() => verifyT42EcrHostedContext(reader, now));
  assert.throws(() => verifyT42EcrHostedContext({ ...reader, authorityMode: 'legacy' }, now), /OIDC_CLAIMS/);
  assert.throws(() => verifyT42EcrHostedContext({ ...reader, authorityMode: 'other' }, now), /AUTHORITY_MODE/);
  const publisher = { ...source(), authorityMode: t42HostedEcrAuthorityMode };
  assert.doesNotThrow(() => verifyT42EcrHostedContext(publisher, now));
  const wrongReaderWorkflow = { ...reader, verifiedClaims: {
    ...reader.verifiedClaims, job_workflow_ref: publisher.verifiedClaims.job_workflow_ref,
  } };
  assert.throws(() => verifyT42EcrHostedContext(wrongReaderWorkflow, now), /OIDC_CLAIMS/);
});

test('each role binds the other live workflow run and the same approval from official run metadata', () => {
  for (const side of ['publisher', 'reader']) {
    const peer = side === 'publisher' ? 'reader' : 'publisher';
    const input = { side, workflows: choices, approvedSha256, runId: ids[side], peerRunId: ids[peer], peerRun: observedRun(peer) };
    assert.deepEqual(verifyT42EcrHostedPeerRun(input), { runId: ids[peer] });
    for (const wrong of [
      { id: Number(ids[side]) }, { run_attempt: 2 }, { status: 'completed' },
      { head_sha: choices[side].callerCommit }, { display_title: `t42-ecr-${peer}-${'0'.repeat(64)}` },
      { triggering_actor: { id: 42 } }, { head_repository: { id: 42, full_name: repository } },
    ]) {
      assert.throws(() => verifyT42EcrHostedPeerRun({ ...input, peerRun: { ...input.peerRun, ...wrong } }), /PEER_RUN/);
    }
    const wrongReusable = { ...input.peerRun.referenced_workflows[0], sha: choices[side].reusableCommit };
    assert.throws(() => verifyT42EcrHostedPeerRun({
      ...input, peerRun: { ...input.peerRun, referenced_workflows: [wrongReusable] },
    }), /PEER_REUSABLE/);
  }
});

function bootstrapInput() {
  const input = source('reader');
  input.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://pipelines.actions.githubusercontent.com/runners/oidctoken?api-version=2.0';
  input.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'runtime-bearer-fixture';
  return input;
}

test('bootstrap requests one exact runtime identity, projects claims and keeps tokens out of the result', async () => {
  const input = bootstrapInput();
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    part({ alg: 'RS256', kid: 'fixture' }), part({ ...input.verifiedClaims, opaque: 'private' }), 'signature',
  ].join('.');
  let calls = 0;
  const result = await bootstrapT42EcrHostedContext(input, { clock: () => now, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url.href, 'https://pipelines.actions.githubusercontent.com/runners/oidctoken?api-version=2.0&audience=sts.amazonaws.com');
    assert.deepEqual(request.headers, { authorization: 'Bearer runtime-bearer-fixture' });
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ value: token }), { status: 200 });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { runId: ids.reader, peerRunId: ids.publisher, verifiedClaims: input.verifiedClaims });
  assert.ok(!JSON.stringify(result).includes(token) && !JSON.stringify(result).includes('runtime-bearer'));
});

test('bootstrap rejects unsafe identity endpoints without fetching and suppresses request failure details', async () => {
  const input = bootstrapInput();
  for (const url of [
    'https://actions.githubusercontent.com.evil.test/oidctoken', 'https://user@pipelines.actions.githubusercontent.com/oidctoken',
    'http://pipelines.actions.githubusercontent.com/oidctoken', 'https://pipelines.actions.githubusercontent.com/api',
  ]) {
    input.env.ACTIONS_ID_TOKEN_REQUEST_URL = url;
    let called = false;
    await assert.rejects(bootstrapT42EcrHostedContext(input, {
      clock: () => now, fetchImpl: () => { called = true; },
    }), /OIDC_ENDPOINT/);
    assert.equal(called, false);
  }
  await assert.rejects(bootstrapT42EcrHostedContext(bootstrapInput(), {
    clock: () => now, fetchImpl: () => { throw Error('sensitive-injected-transport-details'); },
  }), { message: 'T42_ECR_HOSTED_OIDC_REQUEST' });
});
