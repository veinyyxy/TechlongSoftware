import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const schema = 'techlong/t42-raw-ecr-protected-ledger/v1';
const reviewSchema = 'techlong/t42-raw-ecr-publication-review/v1';
const account = '402010193138';
const hash = value => createHash('sha256').update(value).digest('hex');
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const releaseKey = hash(JSON.stringify(t42RawEcrTargets.map(({ repositoryName, imageTag, manifest }) =>
  [account, 'ca-central-1', repositoryName, imageTag, manifest])));
const ops = new Set(['GetCallerIdentity', 'DescribeRepositories', 'BatchGetImage', 'BatchCheckLayerAvailability',
  'InitiateLayerUpload', 'UploadLayerPart', 'CompleteLayerUpload', 'PutImage']);
const readOps = new Set(['GetCallerIdentity', 'BatchGetImage']);

function requireBound(condition, code) {
  if (!condition) throw Error('T42_ECR_LEDGER_' + code);
}

function exact(object, keys) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
}

function canonicalUtc(value) {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

const normalized = file => process.platform === 'win32' ? file.toLowerCase() : file;
const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino;

async function inspectDirectory(directory) {
  const original = await lstat(directory, { bigint: true });
  for (let at = directory; ; at = dirname(at)) {
    const entry = at === directory ? original : await lstat(at, { bigint: true });
    requireBound(entry.isDirectory() && !entry.isSymbolicLink(), 'CARRIER_PATH');
    if (dirname(at) === at) break;
  }
  requireBound(normalized(await realpath(directory)) === normalized(directory), 'CARRIER_PATH');
  return original;
}

async function syncDirectory(directory, expected) {
  // Windows cannot open directories through Node's fs.open. The pre-approved
  // Windows carrier must provide its own persistent metadata guarantee.
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    requireBound(sameNode(await handle.stat({ bigint: true }), expected), 'CARRIER_CHANGED');
    await handle.sync();
  } finally { await handle.close(); }
}

export function projectT42ProtectedEcrEvent(event, stage, approvedSha256, { hosted = false } = {}) {
  const base = ['schema', 'approvedSha256', 'state', 'at'];
  requireBound((stage === 'publisher' || stage === 'reader') && event?.schema === reviewSchema &&
    event.approvedSha256 === approvedSha256 && canonicalUtc(event.at), 'EVENT_BINDING');
  const { state, at, side } = event;
  const readerCap = hosted ? 7 : 3;
  const publisherCap = hosted ? 386 : 382;
  if (state === 'ATTEMPT' || state === 'RESPONSE_RECEIVED') {
    const { operation, call } = event;
    const readerOperation = readOps.has(operation) || (hosted && operation === 'DescribeImages');
    requireBound(exact(event, [...base, 'side', 'operation', 'call']) && Number.isSafeInteger(call) && call > 0 &&
      (stage === 'reader'
        ? side === 'reader' && readerOperation && call <= readerCap
        : ['platform', 'tenant', 'reader'].includes(side) && call <= publisherCap &&
          (side === 'reader' ? readerOperation : ops.has(operation))), 'EVENT_OPERATION');
    return { state, atUtc: at, side, operation, call };
  }
  if (state === 'IDENTITY_CONFIRMED') {
    const { arn, userId } = event;
    requireBound(exact(event, [...base, 'side', 'arn', 'userId']) &&
      (stage === 'reader' ? side === 'reader' : ['platform', 'tenant', 'reader'].includes(side) || hosted && side === 'custody') &&
      typeof arn === 'string' && /^arn:aws:(?:iam|sts)::402010193138:(?:user|assumed-role)\/[a-zA-Z0-9_+=,.@/-]{1,240}$/.test(arn) &&
      typeof userId === 'string' && /^[a-zA-Z0-9_+=,.@:-]{1,110}$/.test(userId), 'EVENT_IDENTITY');
    return { state, atUtc: at, side, identitySha256: hash(JSON.stringify([arn, userId])) };
  }
  if (state === 'PUBLISH_ACK_VERIFIED' || state === 'INDEPENDENT_READBACK_VERIFIED') {
    const target = t42RawEcrTargets.find(candidate => candidate.short === side);
    const proofKey = state === 'PUBLISH_ACK_VERIFIED' ? 'ackSha256' : 'readbackSha256';
    requireBound(exact(event, [...base, 'side', 'repositoryName', 'digest', ...(hosted ? [proofKey] : [])]) && target &&
      target.repositoryName === event.repositoryName && target.manifest === event.digest &&
      (!hosted || isSha(event[proofKey])) &&
      (state === 'INDEPENDENT_READBACK_VERIFIED' || stage === 'publisher'), 'EVENT_RESULT');
    return { state, atUtc: at, side, repositoryName: target.repositoryName, digest: target.manifest,
      ...(hosted && { [proofKey]: event[proofKey] }) };
  }
  if (hosted && state === 'ECR_ABSENCE_VERIFIED') {
    const target = t42RawEcrTargets.find(candidate => candidate.short === side);
    const { repositoryName, selector, value, observedAt, readbackSha256 } = event;
    const selected = { imageTag: target?.imageTag, imageDigest: target?.manifest };
    requireBound(exact(event, [...base, 'side', 'repositoryName', 'selector', 'value', 'observedAt', 'readbackSha256']) &&
      target && repositoryName === target.repositoryName && typeof selector === 'string' &&
      isSha(readbackSha256) && canonicalUtc(observedAt) && observedAt <= at &&
      Object.hasOwn(selected, selector) && value === selected[selector], 'EVENT_ABSENCE');
    return { state, atUtc: at, side, repositoryName, selector, value, observedAt, readbackSha256 };
  }
  const { code, calls, writerCalls } = event;
  requireBound(state === 'STOP_NO_RETRY' && exact(event, [...base, 'code', 'calls', 'writerCalls']) &&
    typeof code === 'string' && /^(?:(?:T42_RAW_ECR_|STOP_)[A-Z0-9_]{1,100}|ECR_RESULT_UNCONFIRMED)$/.test(code) &&
    Number.isSafeInteger(calls) && calls >= 0 && calls <= (stage === 'reader' ? readerCap : publisherCap) &&
    exact(writerCalls, ['platform', 'tenant']) && t42RawEcrTargets.every(target =>
      Number.isSafeInteger(writerCalls[target.short]) && writerCalls[target.short] >= 0 &&
      writerCalls[target.short] <= (stage === 'reader' ? 0 : target.requestCap)), 'EVENT_STOP');
  return { state, atUtc: at, code, calls, writerCalls: { platform: writerCalls.platform, tenant: writerCalls.tenant } };
}

/** A caller supplies an independently reviewed persistent and access-controlled
 * carrier for its stage. This adapter never provisions, resets or relocates it. */
export async function openT42ProtectedEcrLedger({ directory, stage, approvedSha256, sourceBindingSha256 } = {}) {
  const validPath = typeof directory === 'string' && isAbsolute(directory) && !directory.includes('\0') &&
    (process.platform !== 'win32' || /^[a-zA-Z]:[\\/]/.test(directory));
  requireBound(validPath && (stage === 'publisher' || stage === 'reader') &&
    isSha(approvedSha256) && isSha(sourceBindingSha256), 'OPEN_BINDING');
  const carrier = resolve(directory);
  const carrierId = await inspectDirectory(carrier);
  const slotPath = join(carrier, `t42-ecr-${releaseKey}-${stage}.permanent.ndjson`);
  let file;
  let fileId;
  let state = 'new';
  let sequence = 0;

  const write = async row => {
    const record = { schema, releaseKey, stage, approvedSha256, sourceBindingSha256, sequence, ...row };
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    requireBound(bytes.length <= 2048, 'EVENT_SIZE');
    await file.writeFile(bytes);
    await file.sync();
    sequence++;
  };

  const sameCarrier = async () => requireBound(sameNode(await inspectDirectory(carrier), carrierId), 'CARRIER_CHANGED');
  const sameSlot = async () => {
    const current = await lstat(slotPath, { bigint: true });
    requireBound(current.isFile() && !current.isSymbolicLink() && sameNode(current, fileId), 'SLOT_CHANGED');
  };

  return Object.freeze({
    releaseKey,
    async claimOnce(binding) {
      requireBound(exact(binding, ['approvedSha256', 'sourceBindingSha256']) && binding.approvedSha256 === approvedSha256 &&
        binding.sourceBindingSha256 === sourceBindingSha256, 'CLAIM_BINDING');
      if (state !== 'new') return false;
      state = 'claiming';
      try {
        await sameCarrier();
        try { file = await open(slotPath, 'wx', 0o600); }
        catch (error) {
          if (error?.code === 'EEXIST') { state = 'occupied'; return false; }
          throw error;
        }
        fileId = await file.stat({ bigint: true });
        await sameCarrier();
        await sameSlot();
        await write({ state: 'CLAIMED', atUtc: new Date().toISOString() });
        await syncDirectory(carrier, carrierId);
        state = 'active';
        return true;
      } catch (cause) {
        state = 'failed';
        throw Error('T42_ECR_LEDGER_CLAIM_UNCONFIRMED', { cause });
      }
    },
    async appendEvidence(event) {
      const row = projectT42ProtectedEcrEvent(event, stage, approvedSha256);
      requireBound(state === 'active' && sequence <= (stage === 'reader' ? 12 : 776), 'APPEND_STATE');
      state = 'recording';
      try {
        await sameCarrier();
        await sameSlot();
        await write(row);
        state = 'active';
      } catch (cause) {
        state = 'failed';
        throw Error('T42_ECR_LEDGER_EVIDENCE_UNCONFIRMED', { cause });
      }
    },
    async close() {
      requireBound(state !== 'claiming' && state !== 'recording', 'CLOSE_STATE');
      state = 'closed';
      if (file) { const handle = file; file = undefined; await handle.close(); }
    },
  });
}
