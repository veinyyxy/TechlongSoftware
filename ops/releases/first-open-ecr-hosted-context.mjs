import { P as hostedPublisher } from '../platform-image-publication-v2/plan.mjs';

const workflowPath = value => typeof value === 'string' && /^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.ya?ml$/.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const runIdValue = value => typeof value === 'string' && /^[1-9][0-9]{5,19}$/.test(value);
const ownSide = side => side === 'publisher' || side === 'reader';
const fields = ['callerPath', 'callerCommit', 'reusablePath', 'reusableCommit'];
const ambientOverride = /^(?:AWS_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$|NODE_USE_ENV_PROXY$|NODE_TLS_REJECT_UNAUTHORIZED$|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$)/i;
const tokenChunk = /^[A-Za-z0-9_-]+$/;
const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'sts.amazonaws.com';
const maximumBody = 24_000;

export const t42HostedEcrAuthorityMode = 'private-s3';
export const t42HostedEcrReadEnvironment = 'techlong-sandbox-ecr-read';

function requireHosted(condition, code) {
  if (!condition) throw Error('T42_ECR_HOSTED_' + code);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function t42HostedEcrEnvironmentFor(side, authorityMode = 'legacy') {
  requireHosted(ownSide(side) && ['legacy', t42HostedEcrAuthorityMode].includes(authorityMode), 'AUTHORITY_MODE');
  if (side === 'reader' && authorityMode === t42HostedEcrAuthorityMode) {
    const environment = t42HostedEcrReadEnvironment;
    return { environment, subject: hostedPublisher.subject.replace(
      `:environment:${hostedPublisher.environment}`, `:environment:${environment}`,
    ) };
  }
  return { environment: hostedPublisher.environment, subject: hostedPublisher.subject };
}

export function validateT42EcrHostedWorkflows(workflows) {
  requireHosted(record(workflows) && Object.keys(workflows).length === 2 &&
    Object.hasOwn(workflows, 'publisher') && Object.hasOwn(workflows, 'reader'), 'WORKFLOWS');
  const paths = [];
  for (const workflow of [workflows.publisher, workflows.reader]) {
    requireHosted(record(workflow) && Object.keys(workflow).length === fields.length &&
      fields.every(field => Object.hasOwn(workflow, field)) &&
      workflowPath(workflow.callerPath) && workflowPath(workflow.reusablePath) &&
      commit(workflow.callerCommit) && commit(workflow.reusableCommit), 'WORKFLOWS');
    paths.push(workflow.callerPath, workflow.reusablePath);
  }
  requireHosted(new Set(paths).size === paths.length, 'WORKFLOW_SEPARATION');
  return workflows;
}

function checkRuntime({ side, workflows, approvedSha256, peerRunId, startsAtMs, expiresAtMs, env, authorityMode }, now, requirePeer = true) {
  validateT42EcrHostedWorkflows(workflows);
  requireHosted(ownSide(side) && digest(approvedSha256), 'APPROVAL');
  requireHosted([now, startsAtMs, expiresAtMs].every(Number.isSafeInteger) &&
    startsAtMs <= now && now < expiresAtMs && expiresAtMs - startsAtMs <= 3_600_000, 'WINDOW');

  const { repository, repositoryId, actorId, ownerId } = hostedPublisher;
  const { environment, subject } = t42HostedEcrEnvironmentFor(side, authorityMode);
  const { callerPath, callerCommit, reusablePath, reusableCommit } = workflows[side];
  const callerRef = `${repository}/${callerPath}@refs/heads/main`;
  const expectedEnv = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: String(repositoryId),
    GITHUB_REPOSITORY_OWNER_ID: ownerId,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: callerCommit,
    GITHUB_ACTOR_ID: actorId,
    GITHUB_WORKFLOW_REF: callerRef,
    TECHLONG_T42_ECR_APPROVAL_SHA: approvedSha256,
  };
  requireHosted(record(env) && Object.entries(expectedEnv).every(([key, value]) => env[key] === value), 'RUN_CONTEXT');
  requireHosted(!Object.entries(env).some(([key, value]) => value && ambientOverride.test(key)), 'AMBIENT_OVERRIDE');
  const runId = env.GITHUB_RUN_ID;
  const peerSupplied = peerRunId !== undefined;
  requireHosted(runIdValue(runId) && (peerSupplied ? runIdValue(peerRunId) && runId !== peerRunId : !requirePeer), 'RUN_PAIR');
  const expectedClaims = {
    iss: issuer, aud: audience, sub: subject,
    repository, repository_id: String(repositoryId), repository_owner_id: ownerId, actor_id: actorId,
    ref: 'refs/heads/main', event_name: 'workflow_dispatch', environment, run_id: runId, run_attempt: '1',
    sha: callerCommit, workflow_ref: callerRef,
    job_workflow_ref: `${repository}/${reusablePath}@${reusableCommit}`, job_workflow_sha: reusableCommit,
  };
  return { expectedClaims, binding: { runId, ...(peerSupplied && { peerRunId }) } };
}

function checkedClaims(actual, expected, now) {
  requireHosted(record(actual) && Object.entries(expected).every(([key, value]) => actual[key] === value) &&
    Number.isSafeInteger(actual.iat) && Number.isSafeInteger(actual.exp) && actual.iat * 1000 <= now + 300_000 &&
    actual.exp > actual.iat && actual.exp * 1000 > now, 'OIDC_CLAIMS');
  return { ...expected, iat: actual.iat, exp: actual.exp };
}

/** Validate claims supplied by the trusted protected job or by bootstrapT42EcrHostedContext. */
export function verifyT42EcrHostedContext(input, now = Date.now()) {
  const { expectedClaims, binding } = checkRuntime(input, now);
  checkedClaims(input.verifiedClaims, expectedClaims, now);
  return binding;
}

/** The caller supplies the peer run returned by the approved GitHub API transport. */
export function verifyT42EcrHostedPeerRun({ side, workflows, approvedSha256, runId, peerRunId, peerRun }) {
  validateT42EcrHostedWorkflows(workflows);
  requireHosted(ownSide(side) && digest(approvedSha256) && runIdValue(runId) && runIdValue(peerRunId) &&
    runId !== peerRunId, 'RUN_PAIR');
  const peerSide = side === 'publisher' ? 'reader' : 'publisher';
  const peer = workflows[peerSide];
  const { repository, repositoryId, actorId } = hostedPublisher;
  const ownRepo = candidate => candidate?.id === repositoryId && candidate.full_name === repository;
  requireHosted(Number.isSafeInteger(peerRun?.id) && String(peerRun.id) === peerRunId &&
    peerRun.event === 'workflow_dispatch' && peerRun.status === 'in_progress' && peerRun.run_attempt === 1 &&
    peerRun.head_branch === 'main' && peerRun.head_sha === peer.callerCommit && peerRun.path === peer.callerPath &&
    peerRun.display_title === `t42-ecr-${peerSide}-${approvedSha256}` &&
    String(peerRun.actor?.id) === actorId && String(peerRun.triggering_actor?.id) === actorId &&
    ownRepo(peerRun.repository) && ownRepo(peerRun.head_repository), 'PEER_RUN');
  const referenced = peerRun.referenced_workflows;
  requireHosted(Array.isArray(referenced) && referenced.length === 1 &&
    referenced[0]?.path === `${repository}/${peer.reusablePath}@${peer.reusableCommit}` &&
    referenced[0].sha === peer.reusableCommit, 'PEER_REUSABLE');
  return { runId: peerRunId };
}

function oidcUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw Error('T42_ECR_HOSTED_OIDC_ENDPOINT'); }
  requireHosted(url.protocol === 'https:' && url.hostname.endsWith('.actions.githubusercontent.com') &&
    !url.username && !url.password && !url.port && !url.hash && url.pathname.endsWith('/oidctoken'), 'OIDC_ENDPOINT');
  url.searchParams.set('audience', audience);
  return url;
}

function tokenFromResponse(value) {
  requireHosted(typeof value === 'string' && value.length <= maximumBody, 'OIDC_RESPONSE');
  const token = JSON.parse(value).value;
  requireHosted(typeof token === 'string' && token.length <= 20_000, 'OIDC_RESPONSE');
  const parts = token.split('.');
  requireHosted(parts.length === 3 && parts.every(part => tokenChunk.test(part)), 'OIDC_RESPONSE');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  requireHosted(header?.alg === 'RS256' && typeof header.kid === 'string' && header.kid.length > 0, 'OIDC_RESPONSE');
  return { token, claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) };
}

async function requestT42HostedIdentity(input, { fetchImpl = globalThis.fetch, clock = Date.now } = {}, requirePeer) {
  const before = clock();
  const { expectedClaims, binding } = checkRuntime(input, before, requirePeer);
  const { ACTIONS_ID_TOKEN_REQUEST_URL: rawUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = input.env;
  requireHosted(typeof bearer === 'string' && /^[A-Za-z0-9._~+/=-]{1,16000}$/.test(bearer), 'OIDC_BEARER');
  const url = oidcUrl(rawUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: 'Bearer ' + bearer },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(15_000, input.expiresAtMs - before)),
    });
  } catch {
    throw Error('T42_ECR_HOSTED_OIDC_REQUEST');
  }
  requireHosted(response?.ok === true && Number(response.headers?.get('content-length')) <= maximumBody, 'OIDC_RESPONSE');
  let wire;
  try { wire = tokenFromResponse(await response.text()); }
  catch { throw Error('T42_ECR_HOSTED_OIDC_RESPONSE'); }
  const now = clock();
  checkRuntime(input, now, requirePeer);
  return { identity: { ...binding, verifiedClaims: checkedClaims(wire.claims, expectedClaims, now) }, token: wire.token };
}

/** Obtain identity from GitHub's protected runner endpoint over TLS. Return only selected claims. */
export async function bootstrapT42EcrHostedContext(input, options) {
  return (await requestT42HostedIdentity(input, options, true)).identity;
}

/** Give the protected session supplier one verified token in memory. Never return it or the consumer's result. */
export async function withT42EcrHostedOidcToken(input, consume, options) {
  requireHosted(typeof consume === 'function', 'OIDC_CONSUMER');
  const { identity, token } = await requestT42HostedIdentity(input, options, false);
  await consume(token, identity);
  return identity;
}
