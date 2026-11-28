import { createHash } from 'node:crypto';
import { Agent } from 'node:https';
import * as ecr from '@aws-sdk/client-ecr';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { prepareT42RawEcrArtifacts, t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';
import { preflightT42RawImage, readT42RawImage, uploadT42RawImage } from './first-open-ecr-raw-transfer.mjs';

const account = '402010193138';
const region = 'ca-central-1';
const maxCalls = 382;
const requestMs = 20_000;
const scanExpiresAt = Date.parse('2026-11-29T13:04:37.454Z');
const approvalSchema = 'techlong/t42-raw-ecr-publication-review/v1';
export const t42HostedEcrReviewSchema = 'techlong/t42-raw-ecr-publication-review/v2';
const writers = ['platform', 'tenant'];
const stages = ['platform', 'tenant', 'reader'];
const publisherRoles = {
  platform: { name: 'TechlongSandboxPlatformImagePublisherV2', id: 'AROAV3GNMXTZID6CJJBA2' },
  tenant: { name: 'TechlongSandboxInstanceReleasePublisherRole', id: 'AROAV3GNMXTZA2DT2FTQA' },
};
const allowedWrite = new Set(['DescribeRepositories', 'BatchGetImage', 'BatchCheckLayerAvailability',
  'InitiateLayerUpload', 'UploadLayerPart', 'CompleteLayerUpload', 'PutImage']);
const hash = text => createHash('sha256').update(text).digest('hex');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function requireScope(value, code) {
  if (!value) throw Error('T42_RAW_ECR_' + code);
}

function hasKeys(object, keys) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
}

function checkPrincipal(side, identity) {
  requireScope(hasKeys(identity, ['arn', 'userId']), 'PRINCIPAL_FIELDS');
  const { arn, userId } = identity;
  requireScope(typeof arn === 'string' && typeof userId === 'string', 'PRINCIPAL_FIELDS');
  if (side === 'reader') {
    const role = new RegExp(`^arn:aws:sts::${account}:assumed-role/([A-Za-z0-9+=,.@_-]{1,64})/([A-Za-z0-9+=,.@_-]{2,64})$`).exec(arn);
    const user = new RegExp(`^arn:aws:iam::${account}:user/(?:[A-Za-z0-9+=,.@_-]+/)*[A-Za-z0-9+=,.@_-]+$`).test(arn);
    const knownWriters = Object.values(publisherRoles);
    const distinctRole = role && !knownWriters.some(writer => writer.name === role[1]) &&
      /^[A-Z0-9]+:[A-Za-z0-9+=,.@_-]{2,64}$/.test(userId) && userId.endsWith(':' + role[2]) &&
      !knownWriters.some(writer => userId.startsWith(writer.id + ':'));
    requireScope(distinctRole || (user && /^[A-Z0-9]{16,32}$/.test(userId)), 'INDEPENDENT_READER');
    return;
  }
  const writer = publisherRoles[side];
  const prefix = `arn:aws:sts::${account}:assumed-role/${writer.name}/`;
  const session = typeof arn === 'string' && arn.startsWith(prefix) ? arn.slice(prefix.length) : '';
  requireScope(/^[A-Za-z0-9+=,.@_-]{2,64}$/.test(session) && userId === `${writer.id}:${session}`, 'WRITER_PRINCIPAL');
}

export function parseT42RawEcrReview(text, approvedSha256, sourceBindingSha256) {
  requireScope(typeof text === 'string' && text.length < 16_384 && digest(approvedSha256) &&
    hash(text) === approvedSha256, 'REVIEW_DIGEST');
  const review = JSON.parse(text);
  requireScope(hasKeys(review, ['schema', 'sourceBindingSha256', 'startsAt', 'expiresAt', 'targets', 'identities']) &&
    (review.schema === approvalSchema || review.schema === t42HostedEcrReviewSchema) &&
    digest(sourceBindingSha256) && review.sourceBindingSha256 === sourceBindingSha256 &&
    hasKeys(review.identities, stages), 'REVIEW_BINDING');
  const startsAt = Date.parse(review.startsAt);
  const expiresAt = Date.parse(review.expiresAt);
  requireScope(Number.isFinite(startsAt) && Number.isFinite(expiresAt) &&
    new Date(startsAt).toISOString() === review.startsAt && new Date(expiresAt).toISOString() === review.expiresAt &&
    expiresAt > startsAt && expiresAt - startsAt <= 3_600_000 && expiresAt <= scanExpiresAt, 'REVIEW_WINDOW');
  requireScope(Array.isArray(review.targets) && review.targets.length === t42RawEcrTargets.length &&
    review.targets.every((target, i) => {
      const expected = t42RawEcrTargets[i];
      const keys = ['short', 'repositoryName', 'imageTag', 'archiveSHA', 'manifest', 'config', 'manifestMediaType', 'requestCap'];
      return hasKeys(target, keys) && keys.every(key => target[key] === expected[key]);
    }), 'TARGET_BINDING');
  for (const side of stages) checkPrincipal(side, review.identities[side]);
  return { ...review, startsAtMs: startsAt, expiresAtMs: expiresAt };
}

function room(review) {
  const now = Date.now();
  requireScope(now >= review.startsAtMs && now + requestMs < review.expiresAtMs, 'OUTSIDE_REVIEW_WINDOW');
}

function checkTlsSettings() {
  requireScope(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.NODE_EXTRA_CA_CERTS &&
    !process.env.NODE_USE_ENV_PROXY, 'TLS_OVERRIDE');
}

function connectSdk(credentials, expiresAt) {
  requireScope(typeof credentials?.accessKeyId === 'string' && /^ASIA[A-Z0-9]{16,124}$/.test(credentials.accessKeyId) &&
    typeof credentials.secretAccessKey === 'string' && credentials.secretAccessKey.length > 0 &&
    typeof credentials.sessionToken === 'string' && credentials.sessionToken.length > 0 &&
    credentials.expiration instanceof Date && credentials.expiration.getTime() > expiresAt, 'SESSION_COVERAGE');
  const agent = new Agent({ keepAlive: false, maxSockets: 1 });
  const requestHandler = new NodeHttpHandler({ httpsAgent: agent, connectionTimeout: 5_000, requestTimeout: requestMs });
  const config = { region, credentials, requestHandler, maxAttempts: 1 };
  const imageClient = new ecr.ECRClient({ ...config, endpoint: `https://api.ecr.${region}.amazonaws.com` });
  const identityClient = new STSClient({ ...config, endpoint: `https://sts.${region}.amazonaws.com` });
  return {
    identity: () => identityClient.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(requestMs) }),
    send(operation, input) {
      const Command = ecr[operation + 'Command'];
      return imageClient.send(new Command(input), { abortSignal: AbortSignal.timeout(requestMs) });
    },
    close() { imageClient.destroy(); identityClient.destroy(); agent.destroy(); },
  };
}

function identityMatches(actual, expected) {
  return actual?.Account === account && actual.Arn === expected.arn && actual.UserId === expected.userId;
}

/** The private staging lane verifies its separate session before creating its claim. */
export async function observeT42EcrCustodySession(credentials, review) {
  checkTlsSettings();
  room(review);
  const client = connectSdk(credentials, review.expiresAtMs);
  try { return await client.identity(); }
  finally { client.close(); }
}

const notFound = 'ImageNotFoundException';
const absenceKeys = ['repositoryName', 'imageDigest', 'imageTag', 'digestCode', 'tagCode', 'observedAt', 'readbackSha256'];

function absenceScope(input, target, selector) {
  return hasKeys(input, ['registryId', 'repositoryName', 'imageIds']) && input.registryId === account &&
    input.repositoryName === target.repositoryName && Array.isArray(input.imageIds) && input.imageIds.length === 1 &&
    hasKeys(input.imageIds[0], [selector]) && input.imageIds[0][selector] === (selector === 'imageTag' ? target.imageTag : target.manifest);
}

function checkedAbsence(review, absence) {
  requireScope(Array.isArray(absence) && absence.length === t42RawEcrTargets.length, 'PREPUBLICATION_ABSENCE');
  for (const [index, target] of t42RawEcrTargets.entries()) {
    const row = absence[index];
    const time = Date.parse(row?.observedAt);
    requireScope(hasKeys(row, absenceKeys) && row.repositoryName === target.repositoryName && row.imageDigest === target.manifest &&
      row.imageTag === target.imageTag && row.digestCode === notFound && row.tagCode === notFound && digest(row.readbackSha256) &&
      time >= review.startsAtMs && time < review.expiresAtMs && time <= Date.now() && new Date(time).toISOString() === row.observedAt,
    'PREPUBLICATION_ABSENCE');
  }
}

export function projectT42IndependentEcrReadback(target, result) {
  const image = result?.images?.[0];
  requireScope(Array.isArray(result?.images) && result.images.length === 1 &&
    (result.failures === undefined || Array.isArray(result.failures) && result.failures.length === 0) &&
    image?.registryId === account && image.repositoryName === target.repositoryName && image.imageId?.imageDigest === target.manifest &&
    typeof image.imageManifest === 'string' && 'sha256:' + hash(image.imageManifest) === target.manifest &&
    JSON.parse(image.imageManifest).config?.digest === target.config &&
    (image.imageManifestMediaType === undefined || image.imageManifestMediaType === target.manifestMediaType), 'INDEPENDENT_READBACK');
  return { registryId: account, repositoryName: target.repositoryName, imageDigest: target.manifest,
    imageConfigDigest: target.config, manifestMediaType: target.manifestMediaType };
}

function checkedReadback(target, result) {
  const expected = { registryId: account, repositoryName: target.repositoryName, imageDigest: target.manifest,
    imageConfigDigest: target.config, manifestMediaType: target.manifestMediaType };
  requireScope(hasKeys(result, Object.keys(expected)) && Object.entries(expected).every(([key, value]) => result[key] === value),
    'INDEPENDENT_READBACK');
  return expected;
}

function checkRequest(side, target, operation, input) {
  requireScope(input?.registryId === account, 'REGISTRY_BINDING');
  if (side === 'reader') {
    requireScope(operation === 'BatchGetImage' && input.repositoryName === target.repositoryName &&
      input.imageIds?.length === 1 && hasKeys(input.imageIds[0], ['imageDigest']) && input.imageIds[0].imageDigest === target.manifest &&
      input.acceptedMediaTypes === undefined, 'READER_OPERATION');
    return;
  }
  requireScope(side === target.short && allowedWrite.has(operation), 'WRITER_OPERATION');
  requireScope(operation === 'DescribeRepositories' ? input.repositoryNames?.length === 1 &&
    input.repositoryNames[0] === target.repositoryName : input.repositoryName === target.repositoryName, 'REPOSITORY_BINDING');
  if (operation === 'BatchGetImage') {
    requireScope(input.imageIds?.length === 1 && hasKeys(input.imageIds[0], ['imageTag']) &&
      input.imageIds[0].imageTag === target.imageTag, 'WRITER_TAG');
  }
  if (operation === 'PutImage') {
    requireScope(input.imageTag === target.imageTag && input.imageDigest === target.manifest &&
      input.imageManifestMediaType === target.manifestMediaType && input.imageManifest === target.wire, 'WRITE_BINDING');
  }
}

function recordableStop(error) {
  const code = error?.message;
  return typeof code === 'string' && /^(?:T42_RAW_ECR_|STOP_)[A-Z0-9_]{1,100}$/.test(code) ? code : 'ECR_RESULT_UNCONFIRMED';
}

/** Run this port in the separately authorized reader job. Its credentials stay there. */
export function openT42RawEcrIndependentReader({ reviewText, approvedSha256, sourceBindingSha256, credentials, claimOnce } = {}) {
  const review = parseT42RawEcrReview(reviewText, approvedSha256, sourceBindingSha256);
  requireScope(typeof claimOnce === 'function', 'READER_CLAIM_PORT');
  checkTlsSettings();
  const sdk = connectSdk(credentials, review.expiresAtMs);
  let identityAttempted = false;
  let confirmed = false;
  let absenceAttempted = 0;
  const requiresAbsence = review.schema === t42HostedEcrReviewSchema;
  let absenceComplete = !requiresAbsence;
  let stopped = false;
  const repositories = new Set();
  return {
    approvedSha256,
    async identity() {
      room(review);
      requireScope(!identityAttempted, 'READER_IDENTITY_CAP');
      identityAttempted = true;
      requireScope(await claimOnce({ approvedSha256, sourceBindingSha256 }) === true, 'READER_ALREADY_CLAIMED');
      room(review);
      const actual = await sdk.identity();
      confirmed = identityMatches(actual, review.identities.reader);
      requireScope(confirmed, 'LIVE_IDENTITY');
      return actual;
    },
    async describeAbsence(input) {
      room(review);
      const target = t42RawEcrTargets[Math.floor(absenceAttempted / 2)];
      const selector = absenceAttempted % 2 === 0 ? 'imageTag' : 'imageDigest';
      requireScope(confirmed && requiresAbsence && !stopped && target && absenceScope(input, target, selector), 'ABSENCE_SCOPE');
      absenceAttempted++;
      try {
        await sdk.send('DescribeImages', input);
      } catch (error) {
        if (error instanceof ecr.ImageNotFoundException && error.$metadata?.httpStatusCode === 400 &&
          typeof error.$metadata.requestId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(error.$metadata.requestId)) {
          absenceComplete = absenceAttempted === t42RawEcrTargets.length * 2;
          return { code: notFound, requestId: error.$metadata.requestId, observedAt: new Date().toISOString() };
        }
        stopped = true;
        throw Error('T42_RAW_ECR_ABSENCE_UNCONFIRMED');
      }
      stopped = true;
      throw Error('T42_RAW_ECR_PREEXISTING_IMAGE');
    },
    read(input) {
      room(review);
      const target = t42RawEcrTargets.find(row => row.repositoryName === input?.repositoryName);
      requireScope(confirmed && absenceComplete && !stopped && target && !repositories.has(target.short), 'READER_SCOPE');
      checkRequest('reader', target, 'BatchGetImage', input);
      repositories.add(target.short);
      return sdk.send('BatchGetImage', input);
    },
    close: sdk.close,
  };
}

/** Called only by the approved release job. No credential discovery, IAM changes or standalone entrypoint. */
export async function publishT42RawEcr({ reviewText, approvedSha256, sourceBindingSha256, archives,
  writerCredentials, readerPort, claimOnce, appendEvidence } = {}) {
  const review = parseT42RawEcrReview(reviewText, approvedSha256, sourceBindingSha256);
  const hosted = review.schema === t42HostedEcrReviewSchema;
  requireScope(hasKeys(writerCredentials, writers) && typeof claimOnce === 'function' && typeof appendEvidence === 'function' &&
    readerPort?.approvedSha256 === approvedSha256 && typeof readerPort.identity === 'function' && typeof readerPort.read === 'function' &&
    (!hosted || typeof readerPort.prepublicationAbsence === 'function'),
  'PROTECTED_JOB_PORTS');
  checkTlsSettings();
  room(review);
  const prepared = await prepareT42RawEcrArtifacts(archives);
  const sdk = {};
  const writerCalls = { platform: 0, tenant: 0 };
  const readerRepositories = new Set();
  const absence = [];
  let calls = 0;
  let claimed = false;
  const note = (state, details = {}) => appendEvidence({ schema: approvalSchema, approvedSha256, state,
    at: new Date().toISOString(), ...details });
  const sendOnce = async (side, operation, execute) => {
    room(review);
    requireScope(calls < maxCalls + (hosted ? 4 : 0), 'CALL_CAP');
    const next = calls + 1;
    await note('ATTEMPT', { side, operation, call: next });
    room(review);
    calls = next;
    const response = await execute();
    await note('RESPONSE_RECEIVED', { side, operation, call: next });
    return response;
  };
  const sendFor = (side, target) => (operation, input) => {
    checkRequest(side, target, operation, input);
    if (side === 'reader') {
      requireScope(!readerRepositories.has(target.short), 'READBACK_CAP');
      readerRepositories.add(target.short);
    } else {
      requireScope(++writerCalls[side] <= target.requestCap, 'WRITER_CAP');
    }
    return sendOnce(side, operation, () => side === 'reader' ? readerPort.read(input) : sdk[side].send(operation, input));
  };
  try {
    room(review);
    for (const side of writers) sdk[side] = connectSdk(writerCredentials[side], review.expiresAtMs);
    requireScope(await claimOnce({ approvedSha256, sourceBindingSha256 }) === true, 'ALREADY_CLAIMED');
    claimed = true;
    for (const side of stages) {
      const actual = await sendOnce(side, 'GetCallerIdentity', () => side === 'reader' ? readerPort.identity() : sdk[side].identity());
      requireScope(identityMatches(actual, review.identities[side]), 'LIVE_IDENTITY');
      await note('IDENTITY_CONFIRMED', { side, arn: actual.Arn, userId: actual.UserId });
    }
    if (hosted) {
      const proof = await readerPort.prepublicationAbsence();
      checkedAbsence(review, proof);
      for (const [index, target] of t42RawEcrTargets.entries()) {
        const { short: side, repositoryName, imageTag, manifest } = target;
        const { observedAt, readbackSha256 } = proof[index];
        await note('ECR_ABSENCE_VERIFIED', { side, repositoryName, observedAt, readbackSha256, selector: 'imageTag', value: imageTag });
        await note('ECR_ABSENCE_VERIFIED', { side, repositoryName, observedAt, readbackSha256, selector: 'imageDigest', value: manifest });
        absence.push({ ...proof[index], digestState: 'absent', tagState: 'absent', code: notFound,
          operation: 'DescribeImages', releaseBindingSha256: sourceBindingSha256 });
      }
      calls += 4;
    }
    const ready = [];
    for (const target of prepared.targets) {
      ready.push({ target, missing: await preflightT42RawImage(target, sendFor(target.short, target)) });
    }
    const receipts = [];
    for (const { target, missing } of ready) {
      const ack = await uploadT42RawImage(target, missing, sendFor(target.short, target));
      const identity = { side: target.short, repositoryName: target.repositoryName, digest: target.manifest };
      const ackProof = hosted ? { ackSha256: hash(JSON.stringify(ack)) } : {};
      await note('PUBLISH_ACK_VERIFIED', { ...identity, ...ackProof });
      const send = sendFor('reader', target);
      const readback = hosted ? checkedReadback(target, await send('BatchGetImage', {
        registryId: account, repositoryName: target.repositoryName, imageIds: [{ imageDigest: target.manifest }],
      })) : await readT42RawImage(target, send);
      const readbackProof = hosted ? { readbackSha256: hash(JSON.stringify(readback)) } : {};
      await note('INDEPENDENT_READBACK_VERIFIED', { ...identity, ...readbackProof });
      receipts.push({ side: target.short, ack, readback, ...ackProof, ...readbackProof });
    }
    return { status: 'PUBLISHED_AND_INDEPENDENTLY_VERIFIED', calls, writerCalls, receipts, ...(hosted && { absence }) };
  } catch (error) {
    if (!claimed) throw error;
    const code = recordableStop(error);
    await note('STOP_NO_RETRY', { code, calls, writerCalls });
    return { status: 'STOP_NO_RETRY', code, calls, writerCalls };
  } finally {
    for (const client of Object.values(sdk)) client.close();
    await prepared.dispose();
  }
}
