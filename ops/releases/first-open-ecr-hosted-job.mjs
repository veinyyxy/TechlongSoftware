import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { firstOpenArtifactIo } from '../aws-sandbox/first-open-github-handoff.ts';
import { resolveT42RawEcrHandoff } from './first-open-ecr-protected-handoff.mjs';
import { parseT42PrivateEcrArtifactsBinding, resolveT42PrivateEcrArtifacts } from './first-open-ecr-private-artifacts.mjs';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';
import { observeT42EcrCustodySession, openT42RawEcrIndependentReader, parseT42RawEcrReview, projectT42IndependentEcrReadback,
  publishT42RawEcr, t42HostedEcrReviewSchema } from './first-open-ecr-raw-publication.mjs';
import { openT42HostedEcrLedger, t42HostedEcrLedgerScope } from './first-open-ecr-hosted-ledger.mjs';
import { createT42HostedEcrUploader, openT42HostedEcrTransport } from './first-open-ecr-hosted-transport.mjs';
import { t42HostedEcrAuthorityMode, validateT42EcrHostedWorkflows, verifyT42EcrHostedContext, verifyT42EcrHostedPeerRun } from './first-open-ecr-hosted-context.mjs';
import { projectT42HostedEcrRoleSession, validateT42HostedEcrRoleSession } from './first-open-ecr-hosted-authority.mjs';

const repositoryId = 1323312747;
const account = '402010193138';
const sourceSchema = 'techlong/t42-hosted-ecr-source/v1';
export const t42PrivateHostedEcrSourceSchema = 'techlong/t42-hosted-ecr-source/v2';
const eventSchema = 'techlong/t42-raw-ecr-publication-review/v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function check(condition, code) {
  if (!condition) throw Error(`T42_ECR_HOSTED_JOB_${code}`);
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function iso(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : NaN;
}

export function parseT42HostedEcrSource(sourceBindingText, sourceBindingSha256, review) {
  check(typeof sourceBindingText === 'string' && sourceBindingText.length < 16_384 && digest(sourceBindingSha256) &&
    hash(sourceBindingText) === sourceBindingSha256 && review?.schema === t42HostedEcrReviewSchema &&
    review.sourceBindingSha256 === sourceBindingSha256, 'SOURCE_DIGEST');
  const source = JSON.parse(sourceBindingText);
  const privateSource = source?.schema === t42PrivateHostedEcrSourceSchema;
  const artifactFields = privateSource ? ['privateArtifacts', 'custodyIdentity'] : ['artifacts'];
  check(exact(source, ['schema', 'repositoryId', 'workflows', 'ledger', 'phaseCutoffs', 'uploadBundleSha256', ...artifactFields]) &&
    (source.schema === sourceSchema || privateSource) && source.repositoryId === repositoryId && digest(source.uploadBundleSha256) &&
    exact(source.ledger, ['bucket', 'prefix']) && source.ledger.bucket === t42HostedEcrLedgerScope.bucket &&
    source.ledger.prefix === t42HostedEcrLedgerScope.prefix, 'SOURCE_SCOPE');
  validateT42EcrHostedWorkflows(source.workflows);
  if (privateSource) {
    parseT42PrivateEcrArtifactsBinding(source.privateArtifacts);
    validateT42HostedEcrRoleSession('custody', source.custodyIdentity);
    validateT42HostedEcrRoleSession('reader', review.identities.reader);
  } else check(exact(source.artifacts, ['platform', 'tenant']) && Object.values(source.artifacts).every(artifact =>
    exact(artifact, ['runId', 'artifactId', 'headSha', 'artifactDigest']) &&
    [artifact.runId, artifact.artifactId].every(id => Number.isSafeInteger(id) && id > 0) &&
    typeof artifact.headSha === 'string' && /^[a-f0-9]{40}$/.test(artifact.headSha) &&
    typeof artifact.artifactDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.artifactDigest)) &&
    source.artifacts.platform.artifactId !== source.artifacts.tenant.artifactId, 'ARTIFACTS');
  check(Array.isArray(source.phaseCutoffs) && source.phaseCutoffs.length === 5 && source.phaseCutoffs.every((cutoff, index, all) =>
    iso(cutoff) > (index === 0 ? review.startsAtMs : iso(all[index - 1])) && iso(cutoff) < review.expiresAtMs), 'PHASES');
  return source;
}

function prepareLane(lane, input) {
  const { reviewText, approvedSha256, sourceBindingText, sourceBindingSha256, runtime } = input;
  const review = parseT42RawEcrReview(reviewText, approvedSha256, sourceBindingSha256);
  const source = parseT42HostedEcrSource(sourceBindingText, sourceBindingSha256, review);
  const privateSource = source.schema === t42PrivateHostedEcrSourceSchema;
  const { runId, peerRunId } = verifyT42EcrHostedContext({ side: lane, workflows: source.workflows, approvedSha256,
    peerRunId: runtime.peerRunId, startsAtMs: review.startsAtMs, expiresAtMs: review.expiresAtMs,
    ...(privateSource && { authorityMode: t42HostedEcrAuthorityMode }),
    env: runtime.env, verifiedClaims: runtime.verifiedClaims });
  const binding = { repositoryId: String(source.repositoryId), approvedSha256, sourceBindingSha256,
    startsAt: review.startsAt, expiresAt: review.expiresAt, phaseCutoffs: source.phaseCutoffs };
  for (const role of ['publisher', 'reader']) {
    const workflow = source.workflows[role];
    binding[role] = { runId: role === lane ? runId : peerRunId, workflowPath: workflow.callerPath, headSha: workflow.callerCommit };
  }
  return { review, source, binding, runId, peerRunId, privateSource };
}

async function attachLane(lane, input, prepared, credentials) {
  const { approvedSha256, sourceBindingSha256, runtime } = input;
  const { source, review, binding, runId, peerRunId } = prepared;
  const artifactIo = firstOpenArtifactIo({ token: runtime.githubToken });
  const uploadOwn = createT42HostedEcrUploader({ binding, lane, env: runtime.env, nodePath: runtime.artifactNodePath ?? process.execPath,
    bundlePath: runtime.uploadBundlePath, bundleSha256: source.uploadBundleSha256 });
  const transport = openT42HostedEcrTransport({ binding, lane, uploadOwn, artifactIo });
  const remaining = iso(binding.phaseCutoffs[0]) - Date.now();
  check(remaining > 0, 'PEER_WINDOW');
  const peerRun = await artifactIo.json(`https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/${peerRunId}`,
    AbortSignal.timeout(remaining));
  verifyT42EcrHostedPeerRun({ side: lane, workflows: source.workflows, approvedSha256, runId, peerRunId, peerRun });
  const ledger = openT42HostedEcrLedger({ stage: lane, approvedSha256, sourceBindingSha256, credentials,
    expiresAtMs: review.expiresAtMs });
  return { transport, ledger };
}

/** Reader identity and absence proof travel in one authenticated artifact. Each existing write waits for its own reply. */
export function t42HostedEcrReaderPort(transport, approvedSha256) {
  let ready;
  return { approvedSha256,
    async identity() {
      ready = await transport.take('reader-ready');
      return ready.identity;
    },
    prepublicationAbsence() {
      check(ready, 'READER_READY');
      return ready.absence;
    },
    async read(input) {
      const target = t42RawEcrTargets.find(item => item.repositoryName === input.repositoryName);
      check(ready && target && exact(input, ['registryId', 'repositoryName', 'imageIds']) &&
        input.registryId === account && input.imageIds?.length === 1 && exact(input.imageIds[0], ['imageDigest']) &&
        input.imageIds[0].imageDigest === target.manifest, 'READ_SCOPE');
      await transport.emit(`${target.short}-digest-request`, { repositoryName: target.repositoryName, imageDigest: target.manifest });
      return transport.take(`${target.short}-digest-response`);
    },
  };
}

/** Trusted workflow caller supplies verified context and the two explicit ECR writer sessions. */
export async function runT42HostedEcrPublisher(input) {
  const { reviewText, approvedSha256, sourceBindingSha256, writerCredentials, reviewedDirectory, artifactMetadata } = input;
  const prepared = prepareLane('publisher', input);
  const { source } = prepared;
  check(exact(writerCredentials, ['platform', 'tenant']), 'PUBLISHER_SESSIONS');
  if (prepared.privateSource) return runPrivatePublisher(input, prepared);
  const archives = await resolveT42RawEcrHandoff({ reviewedDirectory,
    approval: { repositoryId, artifacts: source.artifacts }, artifacts: artifactMetadata });
  const { transport, ledger } = await attachLane('publisher', input, prepared, writerCredentials.platform);
  try {
    const result = await publishT42RawEcr({ reviewText, approvedSha256, sourceBindingSha256, archives, writerCredentials,
      readerPort: t42HostedEcrReaderPort(transport, approvedSha256), claimOnce: ledger.claimOnce, appendEvidence: ledger.appendEvidence });
    return { ...result, protectedRunId: prepared.runId, independentRunId: prepared.peerRunId };
  } finally { await ledger.close(); }
}

async function runPrivatePublisher(input, prepared) {
  const { reviewText, approvedSha256, sourceBindingSha256, writerCredentials, custodyCredentials } = input;
  const { review, source } = prepared;
  check(custodyCredentials?.accessKeyId !== writerCredentials.platform?.accessKeyId &&
    custodyCredentials?.accessKeyId !== writerCredentials.tenant?.accessKeyId, 'CUSTODY_SESSION_SEPARATION');
  const { transport, ledger } = await attachLane('publisher', input, prepared, custodyCredentials);
  let archives;
  try {
    const identity = projectT42HostedEcrRoleSession('custody', source.custodyIdentity,
      await observeT42EcrCustodySession(custodyCredentials, review));
    const scope = { approvedSha256, sourceBindingSha256 };
    check(await ledger.claimOnce(scope) === true, 'PUBLISHER_ALREADY_CLAIMED');
    await ledger.appendEvidence({ schema: eventSchema, approvedSha256, state: 'IDENTITY_CONFIRMED', at: new Date().toISOString(),
      side: 'custody', arn: identity.arn, userId: identity.userId });
    archives = await resolveT42PrivateEcrArtifacts({ binding: source.privateArtifacts, credentials: custodyCredentials,
      expiresAtMs: review.expiresAtMs });
    let forwarded = false;
    const claimOnce = async binding => {
      check(!forwarded && binding.approvedSha256 === approvedSha256 && binding.sourceBindingSha256 === sourceBindingSha256, 'CUSTODY_CLAIM');
      forwarded = true;
      return true;
    };
    const result = await publishT42RawEcr({ reviewText, approvedSha256, sourceBindingSha256, archives, writerCredentials,
      readerPort: t42HostedEcrReaderPort(transport, approvedSha256), claimOnce, appendEvidence: ledger.appendEvidence });
    return { ...result, custodyIdentityCalls: 1, privateArchiveReads: 2,
      protectedRunId: prepared.runId, independentRunId: prepared.peerRunId };
  } finally {
    try { await archives?.dispose(); } finally { await ledger.close(); }
  }
}

function absenceDigest(binding, target, tag, manifest) {
  return hash(JSON.stringify([binding.sourceBindingSha256, binding.reader.runId, target.repositoryName, target.imageTag,
    target.manifest, tag.code, tag.requestId, tag.observedAt, manifest.code, manifest.requestId, manifest.observedAt]));
}

export async function serveT42HostedEcrReader({ input, binding, transport, ledger, reader }) {
  const { approvedSha256 } = input;
  let calls = 0;
  let claimed = false;
  const note = (state, details) => ledger.appendEvidence({ schema: eventSchema, approvedSha256, state,
    at: new Date().toISOString(), ...details });
  const send = async (operation, call) => {
    await note('ATTEMPT', { side: 'reader', operation, call: ++calls });
    const result = await call();
    await note('RESPONSE_RECEIVED', { side: 'reader', operation, call: calls });
    return result;
  };
  try {
    check(await ledger.claimOnce({ approvedSha256, sourceBindingSha256: binding.sourceBindingSha256 }) === true, 'READER_CLAIMED');
    claimed = true;
    const identity = await send('GetCallerIdentity', () => reader.identity());
    await note('IDENTITY_CONFIRMED', { side: 'reader', arn: identity.Arn, userId: identity.UserId });
    const absence = [];
    for (const target of t42RawEcrTargets) {
      const { repositoryName, imageTag, manifest: imageDigest, short: side } = target;
      const scope = { registryId: account, repositoryName };
      const tag = await send('DescribeImages', () => reader.describeAbsence({ ...scope, imageIds: [{ imageTag }] }));
      const manifest = await send('DescribeImages', () => reader.describeAbsence({ ...scope, imageIds: [{ imageDigest }] }));
      const proof = { observedAt: manifest.observedAt, readbackSha256: absenceDigest(binding, target, tag, manifest) };
      await note('ECR_ABSENCE_VERIFIED', { side, repositoryName, ...proof, selector: 'imageTag', value: imageTag });
      await note('ECR_ABSENCE_VERIFIED', { side, repositoryName, ...proof, selector: 'imageDigest', value: imageDigest });
      absence.push({ repositoryName, imageTag, imageDigest, tagCode: tag.code, digestCode: manifest.code, ...proof });
    }
    await transport.emit('reader-ready', { identity, absence });
    for (const target of t42RawEcrTargets) {
      const { short: side, repositoryName, manifest } = target;
      const request = await transport.take(`${side}-digest-request`);
      check(exact(request, ['repositoryName', 'imageDigest']) && request.repositoryName === repositoryName &&
        request.imageDigest === manifest, 'READ_SCOPE');
      const result = await send('BatchGetImage', () => reader.read({ registryId: account, repositoryName,
        imageIds: [{ imageDigest: manifest }] }));
      const readback = projectT42IndependentEcrReadback(target, result);
      await note('INDEPENDENT_READBACK_VERIFIED', { side, repositoryName, digest: manifest, readbackSha256: hash(JSON.stringify(readback)) });
      await transport.emit(`${side}-digest-response`, readback);
    }
    return { status: 'INDEPENDENT_READBACK_COMPLETE', calls };
  } catch (error) {
    if (!claimed) throw error;
    const message = error?.message;
    const code = typeof message === 'string' && /^T42_RAW_ECR_[A-Z_]+$/.test(message) ? message : 'ECR_RESULT_UNCONFIRMED';
    await note('STOP_NO_RETRY', { code, calls, writerCalls: { platform: 0, tenant: 0 } });
    return { status: 'STOP_NO_RETRY', code, calls };
  }
}

/** Trusted workflow caller supplies only the separate ECR reader session. */
export async function runT42HostedEcrReader(input) {
  const { reviewText, approvedSha256, sourceBindingSha256, credentials } = input;
  const prepared = prepareLane('reader', input);
  const { ledger, transport } = await attachLane('reader', input, prepared, credentials);
  let reader;
  try {
    reader = openT42RawEcrIndependentReader({ reviewText, approvedSha256, sourceBindingSha256, credentials,
      claimOnce: async () => true });
    const result = await serveT42HostedEcrReader({ input, binding: prepared.binding, transport, ledger, reader });
    if (result.status === 'INDEPENDENT_READBACK_COMPLETE') {
      // The final receiver must still see this producer in progress on both sides of its ZIP download.
      const remaining = iso(prepared.binding.phaseCutoffs.at(-1)) - Date.now();
      if (remaining > 0) await sleep(remaining);
    }
    return { ...result,
      protectedRunId: prepared.runId, publisherRunId: prepared.peerRunId };
  } finally {
    try { reader?.close(); } finally { await ledger.close(); }
  }
}
