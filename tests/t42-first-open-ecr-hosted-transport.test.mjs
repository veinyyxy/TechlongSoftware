import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { canonicalJson } from '../lib/deployments/execution/hash.ts';
import { createT42HostedEcrUploader, openT42HostedEcrTransport } from '../ops/releases/first-open-ecr-hosted-transport.mjs';
import { t42RawEcrTargets } from '../ops/releases/first-open-ecr-raw-artifacts.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = Date.parse('2026-11-27T22:00:00.000Z');
const iso = offset => new Date(base + offset).toISOString();
const binding = {
  repositoryId: '1323312747', approvedSha256: 'c'.repeat(64), sourceBindingSha256: 'd'.repeat(64),
  publisher: { runId: '456', workflowPath: '.github/workflows/t42-publish.yml', headSha: 'a'.repeat(40) },
  reader: { runId: '789', workflowPath: '.github/workflows/t42-readback.yml', headSha: 'b'.repeat(40) },
  startsAt: iso(0), expiresAt: iso(60_000), phaseCutoffs: [15_000, 25_000, 35_000, 45_000, 60_000].map(iso),
};
const [platform, tenant] = t42RawEcrTargets;
const account = '402010193138';
const ready = {
  identity: { Account: account, Arn: `arn:aws:iam::${account}:user/fixture-reader`, UserId: 'AIDATESTREADER' },
  absence: t42RawEcrTargets.map(target => ({ repositoryName: target.repositoryName, imageDigest: target.manifest,
    imageTag: target.imageTag, digestCode: 'ImageNotFoundException', tagCode: 'ImageNotFoundException',
    observedAt: iso(1_000), readbackSha256: '6'.repeat(64) })),
};
const request = target => ({ repositoryName: target.repositoryName, imageDigest: target.manifest });
const response = target => ({ ...request(target), registryId: account, imageConfigDigest: target.config,
  manifestMediaType: target.manifestMediaType });
const stop = /T42_ECR_HOSTED_HANDOFF_STOP_NO_RETRY/;

function fixture(controls = {}) {
  let clock = base + 2_000;
  const uploads = [], reads = [], files = new Map();
  const user = { id: 14145707 };
  const repository = { id: Number(binding.repositoryId), full_name: 'veinyyxy/TechlongSoftware', owner: user };
  const now = () => clock;
  function open(lane) {
    const uploadOwn = async ({ name, member, bytes }) => {
      const run = binding[lane], artifactId = String(10 + uploads.length);
      uploads.push({ lane, name });
      const zip = zipSync(controls.members?.(member, bytes) ?? { [member]: bytes });
      const artifact = { id: Number(artifactId), name, expired: false, expires_at: iso(60_000), created_at: iso(clock - base),
        size_in_bytes: zip.length, archive_download_url: `https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/artifacts/${artifactId}/zip`,
        digest: 'sha256:' + hash(zip), workflow_run: { id: Number(run.runId), repository_id: repository.id,
          head_repository_id: repository.id, head_sha: run.headSha, head_branch: 'main' } };
      files.set(artifactId, { artifact, zip });
      if (controls.unknownUpload) throw Error('private SDK body');
      return { artifactId };
    };
    const artifactIo = {
      async json(url) {
        const run = Object.values({ publisher: binding.publisher, reader: binding.reader }).find(row => url.endsWith(`/runs/${row.runId}`));
        assert.ok(run);
        reads.push(['run', run.runId]);
        return controls.run?.(run) ?? { id: Number(run.runId), path: run.workflowPath, head_sha: run.headSha, head_branch: 'main',
          event: 'workflow_dispatch', run_attempt: 1, status: 'in_progress', conclusion: null, actor: user,
          triggering_actor: user, repository, head_repository: repository };
      },
      async readListed(url, name) {
        reads.push(['list', name]);
        const entry = [...files.values()].find(value => value.artifact.name === name);
        assert.ok(entry);
        assert.ok(url.endsWith(`/runs/${entry.artifact.workflow_run.id}/artifacts?name=${name}&per_page=2`));
        return controls.list?.(entry.artifact) ?? { total_count: 1, artifacts: [entry.artifact] };
      },
      async archive(artifactId) {
        reads.push(['archive', artifactId]);
        const zip = files.get(artifactId).zip;
        return controls.archive?.(zip) ?? zip;
      },
    };
    return openT42HostedEcrTransport({ binding, lane, artifactIo, uploadOwn, now });
  }
  return { publisher: open('publisher'), reader: open('reader'), uploads, reads, files, at: offset => { clock = base + offset; } };
}

test('fixed hosted exchange pairs the two active runs and reads only the five hashed artifacts', async () => {
  const { reader, publisher, uploads, reads } = fixture();
  const chain = [
    [reader, publisher, 'reader-ready', ready],
    [publisher, reader, 'platform-digest-request', request(platform)],
    [reader, publisher, 'platform-digest-response', response(platform)],
    [publisher, reader, 'tenant-digest-request', request(tenant)],
    [reader, publisher, 'tenant-digest-response', response(tenant)],
  ];
  for (const [sender, receiver, kind, payload] of chain) {
    await sender.emit(kind, payload);
    assert.deepEqual(await receiver.take(kind), payload);
  }
  assert.deepEqual(uploads.map(item => item.lane), ['reader', 'publisher', 'reader', 'publisher', 'reader']);
  assert.equal(reads.filter(([type]) => type === 'archive').length, 10);
  assert.equal(reads.filter(([type]) => type === 'run').length, 40);
  await assert.rejects(() => publisher.take('tenant-digest-response'), stop);
  assert.equal(uploads.length, 5);
});

test('wrong lane, out-of-order, and elapsed phase stop before any hosted request', async () => {
  for (const use of [
    ({ publisher }) => publisher.emit('reader-ready', ready),
    ({ reader }) => reader.take('tenant-digest-request'),
    (state) => { state.at(15_000); return state.reader.emit('reader-ready', ready); },
    ({ reader }) => reader.emit('reader-ready', { ...ready, credentials: 'fixture' }),
  ]) {
    const state = fixture();
    await assert.rejects(() => use(state), stop);
    assert.deepEqual([state.uploads.length, state.reads.length], [0, 0]);
  }
});

test('unknown upload freezes the lane without reissuing the artifact or disclosing raw errors', async () => {
  const { reader, uploads, reads } = fixture({ unknownUpload: true });
  await assert.rejects(() => reader.emit('reader-ready', ready), { message: 'T42_ECR_HOSTED_HANDOFF_STOP_NO_RETRY' });
  const alreadyRead = reads.length;
  await assert.rejects(() => reader.emit('reader-ready', ready), stop);
  assert.equal(uploads.length, 1);
  assert.equal(reads.length, alreadyRead);
});

test('refuses wrong run metadata, duplicate or cross-run artifact, and unverified ZIP contents', async () => {
  for (const controls of [
    { run: run => ({ id: run.runId, run_attempt: 2 }) },
    { list: entry => ({ total_count: 2, artifacts: [entry, entry] }) },
    { list: entry => ({ total_count: 1, artifacts: [{ ...entry, workflow_run: { ...entry.workflow_run, id: 777 } }] }) },
    { archive: zip => Uint8Array.from(zip, (byte, index) => index ? byte : byte ^ 1) },
    { members: (name, bytes) => ({ [name]: bytes, 'extra.txt': new Uint8Array([1]) }) },
  ]) {
    const { reader } = fixture(controls);
    await assert.rejects(() => reader.emit('reader-ready', ready), stop);
  }
});

test('a valid canonical message with a substituted prior SHA is rejected', async () => {
  const state = fixture();
  await state.reader.emit('reader-ready', ready);
  await state.publisher.take('reader-ready');
  await state.publisher.emit('platform-digest-request', request(platform));
  const current = state.files.get('11');
  const body = JSON.parse(Buffer.from(unzipSync(current.zip)['handoff.json']).toString('utf8'));
  body.previousBodySha256 = '0'.repeat(64);
  const bytes = Buffer.from(canonicalJson(body));
  const zip = zipSync({ 'handoff.json': bytes });
  current.zip = zip;
  current.artifact.size_in_bytes = zip.length;
  current.artifact.digest = 'sha256:' + hash(zip);
  await assert.rejects(() => state.reader.take('platform-digest-request'), stop);
});

test('same-run uploader invokes the fixed bundle without AWS credentials and refuses repeats', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 't42-ecr-uploader-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = await realpath(temporary);
  const bundlePath = join(directory, 'artifact-upload.cjs');
  const contents = `const {readFileSync, appendFileSync} = require('node:fs');
    if (process.env.AWS_ACCESS_KEY_ID || process.env.GH_TOKEN || process.env.INPUT_OVERWRITE !== 'false' ||
        JSON.parse(readFileSync(process.env.INPUT_PATH, 'utf8')).kind !== 'reader-ready') process.exit(2);
    appendFileSync(process.env.GITHUB_OUTPUT, 'artifact-id<<ghadelimiter_a12\\n1234\\nghadelimiter_a12\\n');`;
  await writeFile(bundlePath, contents);
  const env = { RUNNER_TEMP: directory, GITHUB_RUN_ID: binding.reader.runId, GITHUB_RUN_ATTEMPT: '1',
    ACTIONS_RUNTIME_TOKEN: 'fixture', ACTIONS_RESULTS_URL: 'https://results.actions.githubusercontent.com/',
    AWS_ACCESS_KEY_ID: 'fixture-not-forwarded', GH_TOKEN: 'fixture-not-forwarded' };
  const options = { binding, lane: 'reader', bundlePath, bundleSha256: hash(contents), nodePath: process.execPath, env };
  const upload = createT42HostedEcrUploader(options);
  const source = canonicalJson({ schema: 'techlong/t42-ecr-hosted-handoff/v1', kind: 'reader-ready',
    approvedSha256: binding.approvedSha256, sourceBindingSha256: binding.sourceBindingSha256,
    publisherRunId: binding.publisher.runId, readerRunId: binding.reader.runId, previousBodySha256: null,
    producedAtUtc: iso(2_000), payload: ready });
  const input = { name: `t42-ecr-${hash(canonicalJson(binding))}-reader-ready`, member: 'handoff.json',
    bytes: Buffer.from(source), signal: new AbortController().signal };
  assert.deepEqual(await upload(input), { artifactId: '1234' });
  await assert.rejects(() => upload(input), /UPLOAD_UNCONFIRMED/);
  assert.throws(() => createT42HostedEcrUploader({ ...options,
    env: { ...env, ACTIONS_RESULTS_URL: 'https://githubusercontent.com/' } }), /UPLOAD_ENDPOINT/);
  const wrongBundle = createT42HostedEcrUploader({ ...options, bundleSha256: '7'.repeat(64) });
  await assert.rejects(() => wrongBundle(input), /UPLOAD_UNCONFIRMED/);
  const wrongPayload = createT42HostedEcrUploader(options);
  await assert.rejects(() => wrongPayload({ ...input, bytes: Buffer.from('{"credentials":"fixture"}') }), /UPLOAD_UNCONFIRMED/);
});
