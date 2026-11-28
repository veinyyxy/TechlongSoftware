import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseT42PrivateEcrArtifactsBinding, resolveT42PrivateEcrArtifacts, t42PrivateEcrArtifactScope as scope }
  from '../ops/releases/first-open-ecr-private-artifacts.mjs';
import { t42RawEcrTargets } from '../ops/releases/first-open-ecr-raw-artifacts.mjs';

const { owner, region, bucket, prefix, keys } = scope;
const binding = { owner, region, bucket, prefix, versions: { platform: 'platform.fixture+version', tenant: 'tenant.fixture+version' } };
const archiveFiles = {
  platform: fileURLToPath(new URL('../outputs/t42-platform-release-seal-20261127/platform.oci.tar.gz', import.meta.url)),
  tenant: fileURLToPath(new URL('../outputs/t42-tenant-os-remediation/sandbox-candidate-20261127/candidate.oci.tar.gz', import.meta.url)),
};
const realArchives = { skip: Object.values(archiveFiles).some(path => !existsSync(path)) && 'local sealed OCI archives are unavailable' };
const apiError = suffix => new RegExp(`^T42_ECR_PRIVATE_ARTIFACT_${suffix}$`);

async function fixture(t, options = {}) {
  const scratchRoot = await mkdtemp(join(tmpdir(), 't42-private-ecr-test-'));
  t.after(() => rm(scratchRoot, { recursive: true, force: true }));
  await writeFile(join(scratchRoot, 'unchanged'), 'other local material');
  const calls = [];
  let destroys = 0;
  return { scratchRoot, calls, destroyed: () => destroys,
    async read(extra = {}) {
      return resolveT42PrivateEcrArtifacts({ binding, credentials: { accessKeyId: 'ASIA' + '0'.repeat(16),
        secretAccessKey: 'fixture-secret', sessionToken: 'fixture-session', expiration: new Date(Date.now() + 120_000) },
      scratchRoot, expiresAtMs: Date.now() + 60_000,
      requestHandler: {
        destroy() { destroys++; },
        async handle(request, { abortSignal }) {
          calls.push(request);
          assert.equal(request.method, 'GET');
          assert.equal(request.protocol, 'https:');
          assert.equal(request.hostname, `s3.${region}.amazonaws.com`);
          assert.equal(request.headers['x-amz-expected-bucket-owner'], owner);
          assert.equal(request.headers['x-amz-security-token'], 'fixture-session');
          assert.equal(abortSignal.aborted, false);
          const target = t42RawEcrTargets[calls.length - 1];
          assert.equal(request.path, `/${bucket}/${keys[target.short]}`);
          assert.equal(request.query.versionId, binding.versions[target.short]);
          const statusCode = options.statusCode ?? 200;
          const headers = { 'content-length': String(target.archiveBytes), 'x-amz-version-id': binding.versions[target.short],
            'x-amz-server-side-encryption': 'AES256', ...options.headers?.(target) };
          if (options.error) throw Error('fixture provider raw response');
          const body = options.body ? options.body(target) : createReadStream(archiveFiles[target.short]);
          return { response: { statusCode, headers, body } };
        },
      }, ...extra });
    },
  };
}

test('private archive keys retain the reviewed prefix and both exact sealed filenames', () => {
  assert.equal(bucket, 'techlong-sandbox-cloud-worker-evidence-402010193138');
  assert.equal(prefix, 'first-open/t42-ecr-input/1cd968541550efb68b15ea1cb047db3df6c906d9b5b3bf0f392c1859750be3a8');
  assert.equal(keys.platform, `${prefix}/platform.oci.tar.gz`);
  assert.equal(keys.tenant, `${prefix}/candidate.oci.tar.gz`);
  assert.deepEqual(parseT42PrivateEcrArtifactsBinding(binding), binding);
  assert.ok(Object.isFrozen(parseT42PrivateEcrArtifactsBinding(binding).versions));
  for (const invalid of [{ ...binding, bucket: 'other' }, { ...binding, owner: '111111111111' },
    { ...binding, region: 'us-east-1' }, { ...binding, prefix: 'first-open/t42-ecr' },
    { ...binding, versions: { platform: 'null', tenant: 'a-version' } },
    { ...binding, versions: { platform: '', tenant: 'a-version' } }, { ...binding, key: 'other' }]) {
    assert.throws(() => parseT42PrivateEcrArtifactsBinding(invalid), { message: apiError('BINDING') });
  }
});

test('two exact versioned GETs verify the real sealed bytes in private scratch and dispose that directory only', realArchives, async t => {
  const state = await fixture(t);
  const archives = await state.read();
  assert.equal(state.calls.length, 2);
  assert.equal(state.destroyed(), 1);
  assert.equal(basename(archives.platformArchive), 'platform.oci.tar.gz');
  assert.equal(basename(archives.tenantArchive), 'candidate.oci.tar.gz');
  assert.equal((await lstat(archives.platformArchive)).size, t42RawEcrTargets[0].archiveBytes);
  assert.equal((await lstat(archives.tenantArchive)).size, t42RawEcrTargets[1].archiveBytes);
  await archives.dispose();
  await archives.dispose();
  assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
});

test('stale session, closed absolute window and unapproved versions send zero requests', async t => {
  const state = await fixture(t);
  await assert.rejects(() => state.read({ expiresAtMs: Date.now() - 1 }), { message: apiError('WINDOW') });
  await assert.rejects(() => state.read({ credentials: { accessKeyId: 'ASIA' + '0'.repeat(16), secretAccessKey: 'fixture-secret',
    sessionToken: 'fixture-session', expiration: new Date(Date.now() + 1_000) } }), { message: apiError('SESSION_COVERAGE') });
  await assert.rejects(() => state.read({ binding: { ...binding, versions: {} } }), { message: apiError('BINDING') });
  assert.equal(state.calls.length, 0);
  assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
});

test('wrong version, range or encryption and SDK uncertainty stop before a second GET', async t => {
  const outcomes = [
    { headers: () => ({ 'x-amz-version-id': 'newer' }) },
    { headers: () => ({ 'x-amz-server-side-encryption': 'aws:kms' }) },
    { headers: () => ({ 'content-range': 'bytes 0-5/6' }) },
    { headers: () => ({ 'content-length': '1' }) },
    { error: true },
  ];
  for (const options of outcomes) {
    const body = Readable.from([Buffer.from('fixture')]);
    const state = await fixture(t, { ...options, body: () => body });
    await assert.rejects(() => state.read(), { message: apiError(options.error ? 'READ_UNCONFIRMED' : 'OBJECT_METADATA') });
    assert.equal(state.calls.length, 1);
    assert.equal(state.destroyed(), 1);
    if (!options.error) assert.equal(body.destroyed, true);
    assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
  }
});

test('a truncated body with the reviewed length header stops and removes private scratch', async t => {
  const state = await fixture(t, { body: () => Readable.from([Buffer.from('truncated fixture')]) });
  await assert.rejects(() => state.read(), { message: apiError('ARCHIVE_LENGTH') });
  assert.equal(state.calls.length, 1);
  assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
});

test('a truncated second stream removes the already verified first archive and leaves no scratch', realArchives, async t => {
  const state = await fixture(t, { body: target => target.short === 'platform' ? createReadStream(archiveFiles.platform) :
    Readable.from([Buffer.from('truncated fixture')]) });
  await assert.rejects(() => state.read(), { message: apiError('ARCHIVE_LENGTH') });
  assert.equal(state.calls.length, 2);
  assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
});

test('an extra byte or a full-length wrong digest stops without fetching the next object', realArchives, async t => {
  const tooLarge = await fixture(t, { body: () => Readable.from((async function* () {
    yield* createReadStream(archiveFiles.platform);
    yield Buffer.from('X');
  })()) });
  await assert.rejects(() => tooLarge.read(), { message: apiError('ARCHIVE_LENGTH') });
  const wrongDigest = await fixture(t, { body: () => Readable.from((async function* () {
    yield Buffer.from([0xff]);
    yield* createReadStream(archiveFiles.platform, { start: 1 });
  })()) });
  await assert.rejects(() => wrongDigest.read(), { message: apiError('ARCHIVE_DIGEST') });
  for (const state of [tooLarge, wrongDigest]) {
    assert.equal(state.calls.length, 1);
    assert.deepEqual(await readdir(state.scratchRoot), ['unchanged']);
  }
});
