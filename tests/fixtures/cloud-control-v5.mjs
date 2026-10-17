// Owned disposable test keys only; never opens the real acceptance bundle.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { CLOUD_CONTROL_V5 as C } from '../../ops/cloud-worker/cloud-control-v5.mjs';
let cached;
export function controlFixtureV5() { return cached ??= build(); }
async function build() {
  let openssl = 'openssl';
  if (process.platform === 'win32') {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
    openssl = path.resolve(path.dirname(git), '../usr/bin/openssl.exe');
  }
  const folder = await mkdtemp(path.join(tmpdir(), 'techlong-control-fixture-'));
  const run = args => {
    try { return execFileSync(openssl, args, { cwd: folder, windowsHide: true, stdio: 'pipe', timeout: 30000 }); }
    catch { throw Error('OWNED_TEST_OPENSSL_FAILED'); }
  };
  try {
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=cloud-test-ca',
      '-days', '3', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=cloud-test-client']);
    run(['x509', '-req', '-in', 'client.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'client.pem', '-days', '2',
      '-extfile', fileURLToPath(new URL('./cloud-control-client.cnf', import.meta.url))]);
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const payload = { schema: C.schema, appInstanceId: C.appInstanceId, signingPrivateKeyPem: keys.privateKey, signingPublicKeyPem: keys.publicKey,
      clientCertificatePem: await readFile(path.join(folder, 'client.pem'), 'utf8'), clientPrivateKeyPem: await readFile(path.join(folder, 'client.key'), 'utf8'),
      clientCaPem: await readFile(path.join(folder, 'ca.pem'), 'utf8') };
    return { payload, expected: { publicKeySha256: await sha256Hex(payload.signingPublicKeyPem),
      clientCertificateSha256: await sha256Hex(payload.clientCertificatePem), clientCaSha256: await sha256Hex(payload.clientCaPem) } };
  } finally {
    const resolved = path.resolve(folder), parent = path.resolve(tmpdir());
    if (!resolved.startsWith(parent + path.sep) || !path.basename(resolved).startsWith('techlong-control-fixture-')) throw Error('Test cleanup target rejected');
    await rm(resolved, { recursive: true, force: false });
  }
}
