import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson } from '../../lib/deployments/execution/hash.ts';
import { firstOpenArtifactIo } from '../aws-sandbox/first-open-github-handoff.ts';
import { decodeFirstOpenHandoffArchive } from '../aws-sandbox/first-open-oidc-offline.ts';
import { P as hostedPublisher } from '../platform-image-publication-v2/plan.mjs';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const exec = promisify(execFile);
const schema = 'techlong/t42-ecr-hosted-handoff/v1';
const member = 'handoff.json';
const [platform, tenant] = t42RawEcrTargets;
const stages = [
  { kind: 'reader-ready', sender: 'reader' },
  { kind: 'platform-digest-request', sender: 'publisher', target: platform },
  { kind: 'platform-digest-response', sender: 'reader', target: platform },
  { kind: 'tenant-digest-request', sender: 'publisher', target: tenant },
  { kind: 'tenant-digest-response', sender: 'reader', target: tenant },
];
const account = '402010193138';
const api = `https://api.github.com/repos/${hostedPublisher.repository}/actions`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const apiId = value => Number.isSafeInteger(value) && value > 0 ? String(value) : value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function check(condition, code) {
  if (!condition) throw Error(`T42_ECR_HOSTED_HANDOFF_${code}`);
}

function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  const canonical = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical ? parsed : NaN;
}

function review(input, lane) {
  const binding = structuredClone(input);
  check(lane === 'publisher' || lane === 'reader', 'LANE');
  check(exact(binding, ['repositoryId', 'approvedSha256', 'sourceBindingSha256', 'publisher', 'reader',
    'startsAt', 'expiresAt', 'phaseCutoffs']) && binding.repositoryId === String(hostedPublisher.repositoryId) &&
    sha(binding.approvedSha256) && sha(binding.sourceBindingSha256), 'BINDING');
  const { publisher, reader } = binding;
  check([publisher, reader].every(run => exact(run, ['runId', 'workflowPath', 'headSha']) && id(run.runId) &&
    /^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.yml$/.test(run.workflowPath) && typeof run.workflowPath === 'string' &&
    typeof run.headSha === 'string' && /^[a-f0-9]{40}$/.test(run.headSha)) && publisher.runId !== reader.runId, 'RUN_BINDING');
  const start = time(binding.startsAt), expiry = time(binding.expiresAt);
  const cutoffs = Array.isArray(binding.phaseCutoffs) ? binding.phaseCutoffs.map(time) : [];
  check(cutoffs.length === stages.length && cutoffs.every((until, index) =>
    until > (index === 0 ? start : cutoffs[index - 1]) && until <= expiry), 'WINDOW');
  return { binding, start, cutoffs, namePrefix: `t42-ecr-${hash(canonicalJson(binding))}` };
}

function requireRun(run, expected, repositoryId) {
  check(apiId(run?.id) === expected.runId && run.path === expected.workflowPath && run.head_sha === expected.headSha &&
    run.head_branch === 'main' && run.event === 'workflow_dispatch' && run.run_attempt === 1 &&
    run.status === 'in_progress' && run.conclusion === null && apiId(run.actor?.id) === hostedPublisher.actorId &&
    apiId(run.triggering_actor?.id) === hostedPublisher.actorId && run.repository?.full_name === hostedPublisher.repository &&
    apiId(run.repository?.owner?.id) === hostedPublisher.ownerId && apiId(run.repository?.id) === repositoryId &&
    apiId(run.head_repository?.id) === repositoryId, 'RUN_ORIGIN');
}

function validatePayload(payload, stage, start, produced) {
  if (stage.kind === 'reader-ready') {
    check(exact(payload, ['identity', 'absence']) && exact(payload.identity, ['Account', 'Arn', 'UserId']) &&
      payload.identity.Account === account && typeof payload.identity.Arn === 'string' &&
      /^arn:aws:(?:iam|sts)::402010193138:(?:user|assumed-role)\/[A-Za-z0-9_+=,.@/-]{1,240}$/.test(payload.identity.Arn) &&
      typeof payload.identity.UserId === 'string' && /^[A-Za-z0-9_+=,.@:-]{1,110}$/.test(payload.identity.UserId) &&
      Array.isArray(payload.absence) && payload.absence.length === t42RawEcrTargets.length &&
      t42RawEcrTargets.every((target, index) => {
        const row = payload.absence[index];
        return exact(row, ['repositoryName', 'imageDigest', 'imageTag', 'digestCode', 'tagCode', 'observedAt', 'readbackSha256']) &&
          row.repositoryName === target.repositoryName && row.imageTag === target.imageTag && row.imageDigest === target.manifest &&
          row.digestCode === 'ImageNotFoundException' && row.tagCode === 'ImageNotFoundException' &&
          time(row.observedAt) >= start && time(row.observedAt) <= produced && sha(row.readbackSha256);
      }), 'READY_PAYLOAD');
    return;
  }
  const target = stage.target;
  const matchTarget = payload?.repositoryName === target.repositoryName && payload.imageDigest === target.manifest;
  if (stage.sender === 'publisher') {
    check(exact(payload, ['repositoryName', 'imageDigest']) && matchTarget, 'REQUEST_PAYLOAD');
    return;
  }
  check(exact(payload, ['registryId', 'repositoryName', 'imageDigest', 'imageConfigDigest', 'manifestMediaType']) && matchTarget &&
    payload.registryId === account && payload.imageConfigDigest === target.config &&
    payload.manifestMediaType === target.manifestMediaType, 'RESPONSE_PAYLOAD');
}

function message(binding, kind, previousBodySha256, producedAtUtc, payload) {
  return { schema, kind, approvedSha256: binding.approvedSha256, sourceBindingSha256: binding.sourceBindingSha256,
    publisherRunId: binding.publisher.runId, readerRunId: binding.reader.runId, previousBodySha256, producedAtUtc, payload };
}

/** Each lane exchanges only the five reviewed messages. The hosting job must authenticate
 * the fixed workflow source and independently persist its AWS claims before using this transport. */
export function openT42HostedEcrTransport({ binding: input, lane, uploadOwn, artifactIo, token, now = Date.now } = {}) {
  const { binding, start, cutoffs, namePrefix } = review(input, lane);
  check(typeof uploadOwn === 'function', 'UPLOAD_PORT');
  const io = artifactIo ?? firstOpenArtifactIo({ token, now });
  let index = 0;
  let previousBodySha256 = null;
  let previousTime = start;
  let inFlight = false;
  let stopped = false;
  const usedIds = new Set();

  async function bothRunning(signal) {
    for (const location of [binding.publisher, binding.reader]) {
      requireRun(await io.json(`${api}/runs/${location.runId}`, signal), location, binding.repositoryId);
    }
  }

  async function exchange(mode, kind, payload) {
    const stage = stages[index], until = cutoffs[index];
    try {
      check(!stopped && !inFlight && stage?.kind === kind && (stage.sender === lane) === (mode === 'emit'), 'SEQUENCE');
      check(now() >= previousTime && now() < until, 'WINDOW');
      inFlight = true;
      const location = binding[stage.sender], name = `${namePrefix}-${stage.kind}`;
      const signal = AbortSignal.timeout(Math.max(1, until - now()));
      const compose = (producedAtUtc, values) => message(binding, kind, previousBodySha256, producedAtUtc, values);
      let ownId, sent;
      let bytes;
      if (mode === 'emit') {
        const produced = now();
        validatePayload(payload, stage, start, produced);
        bytes = Buffer.from(canonicalJson(compose(new Date(produced).toISOString(), payload)));
        sent = hash(bytes);
      }
      await bothRunning(signal);
      check(!stopped && now() < until && !signal.aborted, 'WINDOW');
      if (bytes) {
        ownId = (await uploadOwn({ name, member, bytes, signal }))?.artifactId;
        check(id(ownId), 'UPLOAD_ACK');
      }
      const listed = await io.readListed(`${api}/runs/${location.runId}/artifacts?name=${name}&per_page=2`, name, until, signal);
      check(listed?.total_count === 1 && Array.isArray(listed.artifacts) && listed.artifacts.length === 1, 'ARTIFACT_COUNT');
      const artifact = listed.artifacts[0], artifactId = apiId(artifact?.id), origin = artifact?.workflow_run;
      const created = time(artifact?.created_at);
      check(id(artifactId) && !usedIds.has(artifactId) && (ownId === undefined || artifactId === ownId) &&
        artifact.name === name && artifact.expired === false && time(artifact.expires_at) > now() &&
        created >= Math.floor(previousTime / 1000) * 1000 && created <= now() && created < until &&
        Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 65_536 &&
        artifact.archive_download_url === `${api}/artifacts/${artifactId}/zip` && typeof artifact.digest === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(artifact.digest) && apiId(origin?.id) === location.runId &&
        apiId(origin?.repository_id) === binding.repositoryId && apiId(origin?.head_repository_id) === binding.repositoryId &&
        origin?.head_sha === location.headSha && origin?.head_branch === 'main', 'ARTIFACT_ORIGIN');
      const zip = await io.archive(artifactId, signal);
      check(zip.length === artifact.size_in_bytes, 'ARTIFACT_SIZE');
      const { body, bodySha256 } = decodeFirstOpenHandoffArchive(zip, artifact.digest.slice(7));
      const produced = time(body.producedAtUtc);
      check(produced >= previousTime && produced <= now() && produced < until &&
        created >= Math.floor(produced / 1000) * 1000 &&
        canonicalJson(body) === canonicalJson(compose(body.producedAtUtc, body.payload)) &&
        (sent === undefined || sent === bodySha256), 'MESSAGE_BINDING');
      validatePayload(body.payload, stage, start, produced);
      await bothRunning(signal);
      check(!stopped && now() < until && !signal.aborted, 'WINDOW');
      usedIds.add(artifactId);
      previousTime = produced;
      previousBodySha256 = bodySha256;
      index++;
      return body.payload;
    } catch {
      stopped = true;
      throw Error('T42_ECR_HOSTED_HANDOFF_STOP_NO_RETRY');
    } finally {
      inFlight = false;
    }
  }

  return Object.freeze({ emit: (kind, payload) => exchange('emit', kind, payload), take: kind => exchange('take', kind) });
}

/** The hosted job supplies the path and SHA of the frozen upload-artifact bundle.
 * Give the child only the GitHub artifact runtime environment, never AWS credentials. */
export function createT42HostedEcrUploader({ binding: input, lane, bundlePath, bundleSha256, nodePath, env = process.env } = {}) {
  const { binding, start, cutoffs, namePrefix } = review(input, lane);
  const { ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL, ACTIONS_RUNTIME_URL, RUNNER_TEMP, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = env;
  check(GITHUB_RUN_ID === binding[lane].runId && GITHUB_RUN_ATTEMPT === '1' && typeof ACTIONS_RUNTIME_TOKEN === 'string' &&
    ACTIONS_RUNTIME_TOKEN.length > 0 && typeof ACTIONS_RESULTS_URL === 'string' &&
    [bundlePath, nodePath, RUNNER_TEMP].every(path => typeof path === 'string' && isAbsolute(path)) && sha(bundleSha256), 'UPLOAD_ENV');
  for (const value of [ACTIONS_RESULTS_URL, ...(ACTIONS_RUNTIME_URL ? [ACTIONS_RUNTIME_URL] : [])]) {
    const url = typeof value === 'string' ? URL.parse(value) : null;
    check(url?.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.hostname.endsWith('.actions.githubusercontent.com'), 'UPLOAD_ENDPOINT');
  }
  const allowed = new Map(stages.flatMap((stage, index) => stage.sender === lane ? [[`${namePrefix}-${stage.kind}`, index]] : []));
  return async function uploadOwn({ name, member: filename, bytes, signal }) {
    let directory;
    try {
      signal.throwIfAborted();
      const index = allowed.get(name);
      check(allowed.delete(name) && filename === member && bytes instanceof Uint8Array && bytes.length > 0 &&
        bytes.length <= 16_384, 'UPLOAD_SCOPE');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const body = JSON.parse(source), stage = stages[index], produced = time(body.producedAtUtc);
      check((index === 0 ? body.previousBodySha256 === null : sha(body.previousBodySha256)) &&
        produced >= start && produced < cutoffs[index] && source === canonicalJson(message(binding, stage.kind,
          body.previousBodySha256, body.producedAtUtc, body.payload)), 'UPLOAD_MESSAGE');
      validatePayload(body.payload, stage, start, produced);
      check(await realpath(bundlePath) === bundlePath && hash(await readFile(bundlePath)) === bundleSha256, 'UPLOAD_BUNDLE');
      directory = await mkdtemp(join(RUNNER_TEMP, 't42-ecr-handoff-'));
      const inputFile = join(directory, member), outputFile = join(directory, 'outputs');
      await writeFile(inputFile, bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(outputFile, '', { flag: 'wx', mode: 0o600 });
      await exec(nodePath, [bundlePath], { cwd: directory, signal, timeout: 20_000, maxBuffer: 128_000, env: {
        NODE_ENV: 'production', PATH: '/usr/bin:/bin', ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL,
        ...(ACTIONS_RUNTIME_URL ? { ACTIONS_RUNTIME_URL } : {}), GITHUB_RUN_ID, GITHUB_WORKSPACE: directory,
        GITHUB_OUTPUT: outputFile, GITHUB_ACTIONS: 'true', INPUT_NAME: name, INPUT_PATH: inputFile,
        'INPUT_IF-NO-FILES-FOUND': 'error', 'INPUT_RETENTION-DAYS': '1', 'INPUT_COMPRESSION-LEVEL': '0',
        INPUT_OVERWRITE: 'false', 'INPUT_INCLUDE-HIDDEN-FILES': 'false',
      } });
      signal.throwIfAborted();
      const outputs = await readFile(outputFile, 'utf8');
      const ids = [...outputs.matchAll(/^artifact-id<<(ghadelimiter_[a-f0-9-]+)\r?\n([1-9][0-9]{0,19})\r?\n\1\r?$/gm)];
      check(ids.length === 1, 'UPLOAD_ACK');
      return { artifactId: ids[0][2] };
    } catch {
      throw Error('T42_ECR_HOSTED_HANDOFF_UPLOAD_UNCONFIRMED');
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {
        throw Error('T42_ECR_HOSTED_HANDOFF_UPLOAD_CLEANUP_UNCONFIRMED');
      });
    }
  };
}
