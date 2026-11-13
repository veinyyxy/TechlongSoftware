import assert from 'node:assert/strict';
let text = '';
for await (const part of process.stdin) text += part.toString('utf8');
const packet = JSON.parse(text);
for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'GITHUB_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'DATABASE_URL', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS']) {
  assert.equal(process.env[key], undefined, key);
}
assert.equal(packet.credentials.accessKeyId, 'synthetic-verifier');
assert.deepEqual(Object.keys(packet).sort(), ['credentials', 'input', 'job']);
process.stdout.write(JSON.stringify({bucket:'synthetic-private',key:'releases/proof',versionId:'fixed-version',sha256:'a'.repeat(64)}));
