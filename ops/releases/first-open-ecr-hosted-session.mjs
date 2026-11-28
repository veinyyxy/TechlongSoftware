import { AssumeRoleWithWebIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { firstOpenArtifactIo } from '../aws-sandbox/first-open-github-handoff.ts';
import { P as hostedPublisher } from '../platform-image-publication-v2/plan.mjs';
import { t42HostedEcrAuthorityScope, validateT42HostedEcrRoleSession } from './first-open-ecr-hosted-authority.mjs';
import { t42HostedEcrAuthorityMode, verifyT42EcrHostedPeerRun, withT42EcrHostedOidcToken } from './first-open-ecr-hosted-context.mjs';
import { t42HostedEcrReviewSchema } from './first-open-ecr-raw-publication.mjs';

const { account, region, roles } = t42HostedEcrAuthorityScope;
const privateSourceSchema = 'techlong/t42-hosted-ecr-source/v2';
const api = `https://api.github.com/repos/${hostedPublisher.repository}/actions`;
const listLimit = 6;
const requestMs = 15_000;
const minDurationSeconds = 900;
const maxDurationSeconds = 3_600;
const coverageSkewSeconds = 5;
const publishRoles = {
  platform: { name: hostedPublisher.role, id: hostedPublisher.roleId },
  tenant: { name: 'TechlongSandboxInstanceReleasePublisherRole', id: 'AROAV3GNMXTZA2DT2FTQA' },
};
const waitStates = ['queued', 'waiting', 'requested', 'pending'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const t42HostedSessionCaps = Object.freeze({
  githubPeerListsPerLane: listLimit, githubDirectPeerReadsPerLane: 1, githubOidcPerLane: 1,
  stsWebIdentityPublisher: 3, stsWebIdentityReader: 1, minDurationSeconds, maxDurationSeconds,
});

function check(condition, code) {
  if (!condition) throw Error('T42_ECR_HOSTED_SESSION_' + code);
}

function sessionDuration(now, expiresAtMs) {
  return Math.max(minDurationSeconds, Math.ceil((expiresAtMs - now) / 1000) + coverageSkewSeconds);
}

function sessionFor(lane, side, expected) {
  const role = side === 'reader' || side === 'custody' ? roles[side] : publishRoles[side];
  const prefix = `arn:aws:sts::${account}:assumed-role/${role.name}/`;
  if (side === 'reader' || side === 'custody') validateT42HostedEcrRoleSession(side, expected);
  const session = typeof expected?.arn === 'string' && expected.arn.startsWith(prefix) && expected.arn.slice(prefix.length);
  check(typeof session === 'string' && /^[A-Za-z0-9+=,.@_-]{2,64}$/.test(session) &&
    (lane === 'publisher' ? side !== 'reader' : side === 'reader') &&
    (!role.id || expected.userId === `${role.id}:${session}`), 'ROLE_BINDING');
  return { side, roleArn: role.arn ?? `arn:aws:iam::${account}:role/${role.name}`,
    session, arn: expected.arn, userId: expected.userId };
}

function preparations({ side, source, review, approvedSha256, env }, now) {
  check((side === 'publisher' || side === 'reader') && source?.schema === privateSourceSchema &&
    source.repositoryId === hostedPublisher.repositoryId && review?.schema === t42HostedEcrReviewSchema &&
    digest(approvedSha256) && digest(review.sourceBindingSha256), 'SOURCE_REVIEW');
  const { startsAtMs, expiresAtMs } = review;
  const firstCutoff = source.phaseCutoffs?.[0];
  const deadline = typeof firstCutoff === 'string' ? Date.parse(firstCutoff) : NaN;
  check([now, startsAtMs, expiresAtMs, deadline].every(Number.isSafeInteger) &&
    new Date(deadline).toISOString() === firstCutoff && startsAtMs <= now && now < deadline &&
    deadline < expiresAtMs && expiresAtMs - startsAtMs <= maxDurationSeconds * 1000 &&
    sessionDuration(now, expiresAtMs) <= maxDurationSeconds, 'WINDOW');
  const desired = side === 'publisher'
    ? [sessionFor(side, 'platform', review.identities?.platform), sessionFor(side, 'tenant', review.identities?.tenant),
      sessionFor(side, 'custody', source.custodyIdentity)]
    : [sessionFor(side, 'reader', review.identities?.reader)];
  const context = { side, workflows: source.workflows, approvedSha256, startsAtMs, expiresAtMs: deadline,
    env, authorityMode: t42HostedEcrAuthorityMode };
  return { context, deadline, expiresAtMs, desired };
}

async function discoverPeer(context, ownRunId, github, deadline) {
  const peerSide = context.side === 'publisher' ? 'reader' : 'publisher';
  const workflow = context.workflows[peerSide];
  const file = workflow.callerPath.slice('.github/workflows/'.length);
  const title = `t42-ecr-${peerSide}-${context.approvedSha256}`;
  const query = new URLSearchParams({ branch: 'main', event: 'workflow_dispatch', head_sha: workflow.callerCommit,
    created: '>=' + new Date(context.startsAtMs).toISOString().replace(/\.\d{3}Z$/, 'Z'), per_page: '2' });
  const url = `${api}/workflows/${file}/runs?${query}`;
  const timeLeft = deadline - github.now();
  check(timeLeft > 0, 'PEER_WINDOW');
  const signal = AbortSignal.timeout(timeLeft);
  const fresh = run => {
    const created = Date.parse(run?.created_at);
    return Number.isSafeInteger(created) && created >= Math.floor(context.startsAtMs / 1000) * 1000 && created <= github.now();
  };
  for (let tryNumber = 1; tryNumber <= listLimit; tryNumber++) {
    check(github.now() < deadline, 'PEER_WINDOW');
    const listed = await github.json(url, signal);
    const runs = listed.workflow_runs;
    check(Array.isArray(runs) && runs.length <= 2 && Number.isSafeInteger(listed.total_count) &&
      listed.total_count === runs.length, 'PEER_PAGE');
    const matching = runs.filter(row => row?.display_title === title);
    check(matching.length <= 1, 'PEER_DUPLICATE');
    if (matching.length === 1) {
      const [candidate] = matching;
      check(Number.isSafeInteger(candidate.id) && candidate.id > 0 && String(candidate.id) !== ownRunId && fresh(candidate) &&
        candidate.run_attempt === 1 && candidate.path === workflow.callerPath && candidate.head_sha === workflow.callerCommit &&
        candidate.head_branch === 'main' && candidate.event === 'workflow_dispatch', 'PEER_LIST_IDENTITY');
      if (candidate.status === 'in_progress') {
        const peerRunId = String(candidate.id);
        check(github.now() < deadline, 'PEER_WINDOW');
        const peerRun = await github.json(`${api}/runs/${peerRunId}`, signal);
        check(github.now() < deadline && fresh(peerRun), 'PEER_WINDOW');
        verifyT42EcrHostedPeerRun({ side: context.side, workflows: context.workflows, approvedSha256: context.approvedSha256,
          runId: ownRunId, peerRunId, peerRun });
        return peerRunId;
      }
      check(waitStates.includes(candidate.status), 'PEER_NOT_RUNNING');
    }
    if (tryNumber < listLimit) {
      check(github.now() < deadline, 'PEER_WINDOW');
      await github.pause(Math.min(10_000, deadline - github.now()), signal);
    }
  }
  throw Error('T42_ECR_HOSTED_SESSION_PEER_NOT_FOUND');
}

function stsClient(requestHandler) {
  return new STSClient({
    region, endpoint: `https://sts.${region}.amazonaws.com`, maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
    credentials: async () => { throw Error('T42_ECR_HOSTED_SESSION_NO_SIGNING_CREDENTIALS'); },
    requestHandler: requestHandler ?? new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: requestMs }),
  });
}

async function assume(client, { roleArn, session, arn, userId }, token, claims, { deadline, startsAtMs, expiresAtMs, clock }) {
  const before = clock();
  const availableUntil = Math.min(deadline, claims.exp * 1000);
  const durationSeconds = sessionDuration(before, expiresAtMs);
  check(before >= startsAtMs && before < availableUntil && durationSeconds <= maxDurationSeconds, 'STS_WINDOW');
  let reply;
  try {
    reply = await client.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: roleArn, RoleSessionName: session, WebIdentityToken: token, DurationSeconds: durationSeconds,
    }), { abortSignal: AbortSignal.timeout(Math.min(requestMs, availableUntil - before)) });
  } catch {
    throw Error('T42_ECR_HOSTED_SESSION_STS_REQUEST');
  }
  const now = clock();
  check(now >= before && now < deadline && reply?.$metadata?.httpStatusCode === 200 &&
    reply.AssumedRoleUser?.Arn === arn && reply.AssumedRoleUser.AssumedRoleId === userId, 'STS_IDENTITY');
  const issued = reply.Credentials;
  check(typeof issued?.AccessKeyId === 'string' && /^ASIA[A-Z0-9]{16,124}$/.test(issued.AccessKeyId) &&
    typeof issued.SecretAccessKey === 'string' && issued.SecretAccessKey.length > 0 &&
    typeof issued.SessionToken === 'string' && issued.SessionToken.length > 0 &&
    issued.Expiration instanceof Date && issued.Expiration.getTime() > expiresAtMs &&
    issued.Expiration.getTime() <= now + (durationSeconds + coverageSkewSeconds) * 1000, 'STS_COVERAGE');
  return { accessKeyId: issued.AccessKeyId, secretAccessKey: issued.SecretAccessKey,
    sessionToken: issued.SessionToken, expiration: new Date(issued.Expiration) };
}

/** Source and review are the protected starter's digest-validated objects.
 * Credentials are passed in process memory only. Never serialize this result. */
export async function openT42HostedSessionContext(input, { fetchImpl, stsRequestHandler, clock = Date.now, wait } = {}) {
  const { context, deadline, expiresAtMs, desired } = preparations(input, clock());
  const github = firstOpenArtifactIo({ token: input.githubToken, now: clock, fetch: fetchImpl, pause: wait });
  let peerRunId;
  const responses = {};
  const { verifiedClaims } = await withT42EcrHostedOidcToken(context, async (token, identity) => {
    peerRunId = await discoverPeer(context, identity.runId, github, deadline);
    const client = stsClient(stsRequestHandler);
    const accessKeys = new Set();
    try {
      for (const role of desired) {
        const credentials = await assume(client, role, token, identity.verifiedClaims,
          { deadline, startsAtMs: context.startsAtMs, expiresAtMs, clock });
        check(!accessKeys.has(credentials.accessKeyId), 'STS_SEPARATION');
        accessKeys.add(credentials.accessKeyId);
        responses[role.side] = credentials;
      }
    } finally {
      client.destroy();
    }
  }, { fetchImpl, clock });
  if (input.side === 'reader') return { peerRunId, verifiedClaims, credentials: responses.reader };
  return { peerRunId, verifiedClaims, writerCredentials: { platform: responses.platform, tenant: responses.tenant },
    custodyCredentials: responses.custody };
}
