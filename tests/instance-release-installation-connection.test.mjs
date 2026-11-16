import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { serialize } from 'pg-protocol';
import { installationConnectionOptions, installationTransactionSql } from '../ops/releases/installation-connection.mjs';

const fakeUrl = 'postgresql://offline_user:offline_password@offline-pooler.neon.tech/neondb';
const timeouts = "\nSET LOCAL lock_timeout = '1s';\nSET LOCAL statement_timeout = '15s';";
const hash = text => createHash('sha256').update(text).digest('hex');

test('connection keeps the same endpoint, verified TLS and bounded client timeouts', () => {
  const config = installationConnectionOptions(`${fakeUrl}?sslmode=disable&options=unsafe&sslcert=unused&lock_timeout=20&statement_timeout=30`, 'offline-install');
  const url = new URL(config.connectionString);
  assert.equal(url.hostname, 'offline-pooler.neon.tech');
  assert.equal(url.pathname, '/neondb');
  assert.equal(url.username, 'offline_user');
  assert.equal(url.password, 'offline_password');
  assert.equal(url.search, '');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.connectionTimeoutMillis, 10000);
  assert.equal(config.query_timeout, 20000);
  assert.equal(config.application_name, 'offline-install');
});

test('real pg StartupMessage no longer carries the unsupported timeout options, without connecting', () => {
  const oldClient = new pg.Client({ connectionString: fakeUrl, options: '-c lock_timeout=1000 -c statement_timeout=15000' });
  const client = new pg.Client(installationConnectionOptions(`${fakeUrl}?options=unsafe&lock_timeout=20&statement_timeout=30`, 'offline-install'));
  const startup = client.getStartupConf();
  assert.equal(oldClient.getStartupConf().options, '-c lock_timeout=1000 -c statement_timeout=15000');
  for (const key of ['options', 'lock_timeout', 'statement_timeout']) assert.equal(Object.hasOwn(startup, key), false);
  const bytes = serialize.startup(startup);
  assert.equal(bytes.includes(Buffer.from('lock_timeout')), false);
  assert.equal(bytes.includes(Buffer.from('statement_timeout')), false);
  assert.equal(client._connected, false);
  assert.equal(oldClient._connected, false);
});

for (const begin of ['BEGIN', 'BEGIN READ ONLY', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY']) {
  test(`${begin}: timeouts stay inside the existing transaction in the same submission`, () => {
    const submitted = installationTransactionSql(begin);
    assert.equal(submitted, `${begin};${timeouts}`);
    assert.equal((submitted.match(/\bBEGIN\b/g) ?? []).length, 1);
    assert.equal(submitted.includes('COMMIT'), false);
    assert.equal(new pg.Query({ text: submitted, values: [] }).requiresPreparation(), false);
  });
}

test('self-contained promotion SQL keeps its source body and single BEGIN/COMMIT unchanged', () => {
  const source = fs.readFileSync(new URL('../ops/releases/promotion.draft.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const submitted = installationTransactionSql(source);
  const opening = source.indexOf('\nBEGIN;') + '\nBEGIN;'.length;
  assert(opening > '\nBEGIN;'.length);
  assert.equal(submitted, source.slice(0, opening) + timeouts + source.slice(opening));
  assert.equal(submitted.replace(timeouts, ''), source);
  assert.equal(submitted.endsWith('COMMIT;\n'), true);
  assert.notEqual(hash(submitted), hash(source));
  assert.equal(fs.readFileSync(new URL('../ops/releases/promotion.draft.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n'), source);
});

test('comments and existing semicolon retain the exact original transaction mode', () => {
  const input = '-- BEGIN in comment\n\nBEGIN READ ONLY;\nSELECT 1;\nCOMMIT;';
  assert.equal(installationTransactionSql(input), input.replace('BEGIN READ ONLY;', `BEGIN READ ONLY;${timeouts}`));
});

for (const text of ['SELECT $1::text', 'COMMIT', 'ROLLBACK', 'DO $$ BEGIN PERFORM 1; END $$;', "SELECT 'BEGIN'", '-- only a comment\n']) {
  test(`non-opening SQL stays byte-identical: ${text.split('\n')[0]}`, () => {
    assert.equal(installationTransactionSql(text), text);
  });
}

test('the LOGIN fragments are not rewritten or given a second transaction', () => {
  for (const file of ['login-roles.draft.sql', 'publisher-login.draft.sql']) {
    const source = fs.readFileSync(new URL(`../ops/releases/${file}`, import.meta.url), 'utf8');
    assert.equal(installationTransactionSql(source), source);
  }
});
