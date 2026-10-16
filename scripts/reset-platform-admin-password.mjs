// Approved one-account recovery, not bootstrap, login bypass or a web endpoint.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { neon } from '@neondatabase/serverless';
import { hashPassword, validatePassword, PASSWORD_ITERATIONS } from '../lib/auth/security.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const TARGET = Object.freeze({ email: 'veinyang@gmail.com', userId: 'usr_4dcd0a09821fde2bb1801f58',
  endpointSha256: 'ddafbcdf74b6e8df51e7bde9d7337778187983f05ab6cc01b2084ad54799d8f4' });
const USER_FIELDS = ['id', 'email', 'name', 'status', 'is_platform_admin', 'created_at', 'updated_at'];
const USER_COLUMNS = USER_FIELDS.map(key => `u.${key}`).join(',');
const must = (value, code) => { if (!value) throw Object.assign(new Error(code), { recoveryCode: code }); };
const userOnly = row => Object.fromEntries(USER_FIELDS.map(key => [key, row[key]]));

export function recoveryMode(args) {
  must(args.length <= 1 && (!args.length || ['--check', '--preflight'].includes(args[0])), 'ARGUMENTS');
  return args[0] === '--check' ? 'Check' : args[0] === '--preflight' ? 'Preflight' : 'Reset';
}
export function validateNewPassword(first, second) {
  must(typeof first === 'string' && typeof second === 'string', 'PASSWORD_INPUT_REQUIRED');
  must(!validatePassword(first), 'PASSWORD_LENGTH_12_TO_128_REQUIRED');
  must(first === second, 'PASSWORD_CONFIRMATION_MISMATCH');
}
export async function assertRecoveryDatabase(value) {
  const url = new URL(value);
  must(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.endsWith('.neon.tech') &&
    ['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''), 'PINNED_TLS_NEON_REQUIRED');
  must(await sha256Hex([url.hostname, url.port || '5432', url.pathname, url.username]) === TARGET.endpointSha256,
    'DATABASE_ENDPOINT_CHANGED');
}
export function assertRecoveryTarget(row) {
  must(row && row.id === TARGET.userId && row.email === TARGET.email && row.status === 'active' &&
    row.is_platform_admin === 1 && row.credential_user_id === TARGET.userId, 'EXISTING_ACTIVE_ADMIN_REQUIRED');
  for (const key of ['credential_updated_at', 'password_changed_at'])
    must(Number.isSafeInteger(Number(row[key])) && Number(row[key]) > 0, 'CREDENTIAL_METADATA_REQUIRED');
}

export function recoveryProgram(before, digest) {
  assertRecoveryTarget(before);
  must(digest.iterations === PASSWORD_ITERATIONS && /^[a-f0-9]{64}$/.test(digest.hash) && /^[a-f0-9]{32}$/.test(digest.salt), 'NEW_DIGEST_REQUIRED');
  return { text: `WITH locked AS MATERIALIZED (
    SELECT u.id,c.updated_at,c.password_changed_at
    FROM public.users u JOIN public.user_credentials c ON c.user_id=u.id
    WHERE u.id=$1 AND u.email=$2 AND u.status='active' AND u.is_platform_admin=1
      AND c.updated_at=$3 AND c.password_changed_at=$4 FOR UPDATE OF u,c
  ), changed AS (
    UPDATE public.user_credentials c SET password_hash=$5,password_salt=$6,password_iterations=$7,
      failed_attempts=0,locked_until=NULL,
      password_changed_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
      updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint
    FROM locked l WHERE c.user_id=l.id
    RETURNING c.user_id,c.password_changed_at
  ), revoked AS (
    DELETE FROM public.auth_sessions s USING changed c WHERE s.user_id=c.user_id RETURNING s.id
  ) SELECT c.user_id,c.password_changed_at,(SELECT count(*)::int FROM revoked) AS revoked_sessions FROM changed c`,
  values: [TARGET.userId, TARGET.email, before.credential_updated_at, before.password_changed_at,
    digest.hash, digest.salt, digest.iterations] };
}

export function verifyRecoveryReadback(before, after, changedAt) {
  must(after && canonicalJson(userOnly(before)) === canonicalJson(userOnly(after)), 'USER_IDENTITY_CHANGED');
  must(after.digest_matches === true && Number(after.password_changed_at) === Number(changedAt) &&
    after.failed_attempts === 0 && after.locked_until === null, 'CREDENTIAL_READBACK_REQUIRES_INSPECT');
  must(Number(after.session_count) === 0, 'SESSIONS_REMAIN_OR_CONCURRENT_LOGIN_NO_RETRY');
}

/** Readline's output is deliberately discarded; history is disabled. Passwords
 * are never accepted through argv/env/stdin pipes, echoed or written to a file. */
async function hiddenPassword(prompt) {
  must(process.stdin.isTTY && process.stdout.isTTY, 'INTERACTIVE_TERMINAL_REQUIRED');
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true, historySize: 0 });
  process.stdout.write(prompt);
  try {
    return await new Promise((resolve, reject) => {
      let answered = false;
      rl.once('SIGINT', () => reject(Object.assign(new Error('CANCELLED'), { recoveryCode: 'CANCELLED' })));
      rl.once('close', () => { if (!answered) reject(Object.assign(new Error('CANCELLED'), { recoveryCode: 'CANCELLED' })); });
      rl.question('', answer => { answered = true; resolve(answer); });
    });
  } finally { rl.close(); sink.end(); process.stdout.write('\n'); }
}

export async function main(args = process.argv.slice(2)) {
  let mutationAttempted = false, stage = 'arguments', first, second;
  try {
    const mode = recoveryMode(args);
    must(path.resolve(process.cwd()).toLowerCase() === path.resolve(ROOT).toLowerCase(), 'REPOSITORY_ROOT_REQUIRED');
    if (mode === 'Check') {
      console.log(JSON.stringify({ mode, target: TARGET.email, credentialUpdates: 1, revokeThisUsersSessions: true,
        accountOrPermissionUpdates: 0, createsUsers: false, sqlConnections: 0, cloudCalls: 0, passwordRead: false })); return;
    }
    if (mode === 'Reset') must(process.stdin.isTTY && process.stdout.isTTY, 'INTERACTIVE_TERMINAL_REQUIRED');
    stage = 'database_configuration';
    const configured = parseEnv(await readFile(path.join(ROOT, '.env.local'), 'utf8'));
    await assertRecoveryDatabase(configured.DATABASE_URL);
    const sql = neon(configured.DATABASE_URL, { fullResults: true });
    const options = { isolationLevel: 'Serializable', readOnly: true,
      fetchOptions: { signal: AbortSignal.timeout(20000) } };
    async function preflight() {
      const [result] = await sql.transaction(tx => [tx.query(`SELECT ${USER_COLUMNS},c.user_id AS credential_user_id,
        c.updated_at AS credential_updated_at,c.password_changed_at,c.failed_attempts,c.locked_until,
        (SELECT count(*)::int FROM public.auth_sessions s WHERE s.user_id=u.id) AS session_count
        FROM public.users u LEFT JOIN public.user_credentials c ON c.user_id=u.id WHERE u.id=$1 AND u.email=$2`,
      [TARGET.userId, TARGET.email])], { ...options, fetchOptions: { signal: AbortSignal.timeout(20000) } });
      must(result.rowCount === 1, 'EXACT_ACCOUNT_MISSING'); assertRecoveryTarget(result.rows[0]); return result.rows[0];
    }
    stage = 'read_only_preflight';
    const initial = await preflight();
    if (mode === 'Preflight') {
      console.log(JSON.stringify({ mode, outcome: 'EXACT_EXISTING_ADMIN_READY_NO_RESET', target: TARGET.email,
        userId: initial.id, sessionRows: Number(initial.session_count), failedAttempts: initial.failed_attempts,
        locked: Number(initial.locked_until ?? 0) > Date.now(), sqlWrites: 0, passwordHashOrSaltReads: 0, cloudCalls: 0 })); return;
    }
    console.log(`Reset only ${TARGET.email}; revoke its existing sessions. Ctrl+C cancels before submission.`);
    stage = 'hidden_password_input';
    first = await hiddenPassword('New password (12-128 characters, hidden): ');
    second = await hiddenPassword('Confirm new password (hidden): ');
    validateNewPassword(first, second);
    const digest = await hashPassword(first); first = undefined; second = undefined;
    stage = 'fresh_read_only_preflight';
    const before = await preflight(), program = recoveryProgram(before, digest);
    stage = 'atomic_reset_and_session_revoke'; mutationAttempted = true;
    // Exactly one mutation submission. No retry, upsert, account promotion,
    // session creation or other table mutation, including on ambiguous commit.
    const [changed] = await sql.transaction(tx => [tx.query(program.text, program.values)], {
      isolationLevel: 'Serializable', readOnly: false, fetchOptions: { signal: AbortSignal.timeout(20000) },
    });
    must(changed.rowCount === 1 && changed.rows[0].user_id === TARGET.userId, 'RESET_RESULT_REQUIRES_INSPECT_NO_RETRY');
    stage = 'independent_read_only_readback';
    const [readback] = await sql.transaction(tx => [tx.query(`SELECT ${USER_COLUMNS},
      c.failed_attempts,c.locked_until,c.password_changed_at,
      (c.password_hash=$3 AND c.password_salt=$4 AND c.password_iterations=$5) AS digest_matches,
      (SELECT count(*)::int FROM public.auth_sessions s WHERE s.user_id=u.id) AS session_count
      FROM public.users u JOIN public.user_credentials c ON c.user_id=u.id WHERE u.id=$1 AND u.email=$2`,
    [TARGET.userId, TARGET.email, digest.hash, digest.salt, digest.iterations])],
    { ...options, fetchOptions: { signal: AbortSignal.timeout(20000) } });
    must(readback.rowCount === 1, 'READBACK_ACCOUNT_MISSING');
    verifyRecoveryReadback(before, readback.rows[0], changed.rows[0].password_changed_at);
    console.log(JSON.stringify({ outcome: 'PASSWORD_RESET_AND_SESSION_REVOKE_VERIFIED', target: TARGET.email,
      userId: TARGET.userId, passwordChangedAt: Number(changed.rows[0].password_changed_at),
      revokedSessionRows: Number(changed.rows[0].revoked_sessions), remainingSessions: 0,
      credentialRowsUpdated: 1, userIdentityUnchanged: true, cloudCalls: 0, retryAllowed: false }));
  } catch (error) {
    console.error(JSON.stringify({ outcome: mutationAttempted ? 'RESET_SUBMISSION_REQUIRES_INSPECT_NO_RETRY' : 'STOPPED_BEFORE_RESET',
      stage, code: /^[A-Z0-9_]+$/.test(error.recoveryCode ?? '') ? error.recoveryCode : 'SANITIZED_LOCAL_OR_DATABASE_ERROR',
      mutationAttempted, retryAllowed: false, passwordOrDigestLogged: false })); process.exitCode = 1;
  } finally { first = undefined; second = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
