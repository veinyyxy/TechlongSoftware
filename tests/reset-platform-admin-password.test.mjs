import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { hashPassword, verifyPassword, PASSWORD_ITERATIONS } from '../lib/auth/security.ts';
import { TARGET, recoveryMode, validateNewPassword, assertRecoveryDatabase,
  assertRecoveryTarget, recoveryProgram, verifyRecoveryReadback } from '../scripts/reset-platform-admin-password.mjs';

const before = () => ({ id: TARGET.userId, email: TARGET.email, name: 'fixture-admin', status: 'active',
  is_platform_admin: 1, created_at: 1, updated_at: 2, credential_user_id: TARGET.userId,
  credential_updated_at: 3, password_changed_at: 3 });

test('only fixed target and explicit local modes; password never comes from CLI parameters', () => {
  assert.equal(recoveryMode([]), 'Reset'); assert.equal(recoveryMode(['--check']), 'Check');
  assert.equal(recoveryMode(['--preflight']), 'Preflight');
  for (const a of [['--password=fixture'], ['--email=other'], ['--preflight', '--check']]) assert.throws(() => recoveryMode(a));
  for (const p of ['', 'short', 'x'.repeat(129)]) assert.throws(() => validateNewPassword(p, p));
  assert.throws(() => validateNewPassword('fixture-long-enough', 'different-fixture'));
  validateNewPassword('fixture-long-enough', 'fixture-long-enough');
});

test('other database or non-TLS endpoint is rejected without connecting', async () => {
  for (const dsn of ['postgresql://user:fixture@other.neon.tech/db?sslmode=require',
    'postgresql://user:fixture@localhost/db', 'https://example.com']) await assert.rejects(assertRecoveryDatabase(dsn));
});

test('one guarded credential UPDATE and dependent session DELETE; no bootstrap/identity/business writes', async () => {
  const digest = await hashPassword('test-fixture-not-a-real-password');
  assert.equal(digest.iterations, PASSWORD_ITERATIONS);
  assert.equal(await verifyPassword('test-fixture-not-a-real-password', digest), true);
  const program = recoveryProgram(before(), digest);
  assert.equal((program.text.match(/UPDATE public\.user_credentials/g) ?? []).length, 1);
  assert.equal((program.text.match(/DELETE FROM public\.auth_sessions/g) ?? []).length, 1);
  assert.ok(program.text.includes('USING changed c')); assert.ok(program.text.includes('FOR UPDATE OF u,c'));
  assert.ok(program.text.includes('c.updated_at=$3 AND c.password_changed_at=$4'));
  assert.ok(!/\b(INSERT|UPSERT|CREATE|DROP|ALTER)\b/.test(program.text));
  assert.ok(!/UPDATE public\.users|workspaces|deployment_jobs|auth_invitations/.test(program.text));
  assert.ok(!program.text.includes(digest.hash)); assert.ok(!program.values.includes('test-fixture-not-a-real-password'));
  assert.deepEqual(program.values.slice(0, 4), [TARGET.userId, TARGET.email, 3, 3]);
  for (const p of [{ id: 'other' }, { email: 'other@example.com' }, { status: 'disabled' }, { is_platform_admin: 0 },
    { credential_user_id: null }, { credential_updated_at: undefined }]) assert.throws(() => assertRecoveryTarget({ ...before(), ...p }));
});

test('independent verification detects identity drift, wrong digest, lock, timestamp or concurrent session', () => {
  const after = { ...before(), digest_matches: true, password_changed_at: 10, failed_attempts: 0, locked_until: null, session_count: 0 };
  verifyRecoveryReadback(before(), after, 10);
  for (const p of [{ name: 'changed' }, { updated_at: 11 }, { digest_matches: false }, { password_changed_at: 9 },
    { failed_attempts: 1 }, { locked_until: 20 }, { session_count: 1 }])
    assert.throws(() => verifyRecoveryReadback(before(), { ...after, ...p }, 10));
});

test('Check reads no env/DB; non-interactive reset is rejected before configuration or password input', () => {
  const args = ['--experimental-strip-types', 'scripts/reset-platform-admin-password.mjs'];
  const cwd = new URL('../', import.meta.url);
  const checked = JSON.parse(execFileSync(process.execPath, [...args, '--check'], { cwd, encoding: 'utf8' }));
  assert.equal(checked.sqlConnections, 0); assert.equal(checked.passwordRead, false);
  const refused = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', input: 'fixture-not-accepted\n' });
  assert.equal(refused.status, 1); assert.equal(refused.stdout, '');
  const failure = JSON.parse(refused.stderr);
  assert.equal(failure.code, 'INTERACTIVE_TERMINAL_REQUIRED'); assert.equal(failure.mutationAttempted, false);
  assert.ok(!refused.stderr.includes('fixture-not-accepted'));
});
