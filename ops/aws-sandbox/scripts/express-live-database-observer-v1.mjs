import tls from 'node:tls';
import { createRequire } from 'node:module';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { LIVE_BACKEND } from './express-live-local-inputs-v1.mjs';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const req = createRequire(LIVE_BACKEND + '/package.json');
const EXPECTED = { catalog: 'ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9',
  role: '941cfda905da13438878f0f5415a2d9bb56a7be217a8d813daef8fde401055d5',
  acl: '9a6a5619d26ca00ec807c83e6dbf3c2f69504b06f93af26eb9b8ce6b86d61c22',
  counts: '8fb858f29bf407a2e06afb7506078c253c4707e5eead0555483b5dca0ad7451f' };
const ENTITLEMENTS = [
  ['branding.custom_theme.enabled', true, 'boolean'], ['branding.merchant_editable', true, 'boolean'],
  ['buyer.access.heartbeat_seconds', 300, 'integer'], ['buyer.access.lease_seconds', 900, 'integer'],
  ['buyer.accounts.max', null, 'integer_or_null'], ['buyer.concurrent_access.max', null, 'integer_or_null'],
  ['merchant.active_users.max', null, 'integer_or_null'], ['stores.max', null, 'integer_or_null'],
].map(([key, value, type]) => ({ key, value, type, source: 'default', license: null, revision: '1', updatedBy: 'migration', sameInstance: true }));
export async function validateExpressInstalledSnapshotV1(results, program) {
  if (results.length !== 8 || program.snapshot.length !== 8 || program.tables.length !== 73) throw Error('LIVE_DATABASE_SNAPSHOT_REJECTED');
  const [context, roles, databases, catalog, counts, guards, singleton, stores] = results;
  const c = context.rows?.[0], t = program.target;
  if (context.rowCount !== 1 || c.database !== t.database || c.database_oid !== '16459' || c.username !== 'postgres' ||
      c.session_username !== 'postgres' || c.role_oid !== t.managementRoleOid || c.server_version_num !== 170009 ||
      c.read_only !== 'on' || c.isolation !== 'serializable' || c.backend_tls_active !== true ||
      roles.rowCount !== 1 || databases.rowCount !== 4 || catalog.rowCount !== 1 || counts.rowCount !== 73 ||
      await sha256Hex(roles.rows[0]) !== EXPECTED.role || await sha256Hex(databases.rows) !== EXPECTED.acl ||
      await sha256Hex(catalog.rows[0]?.identity) !== EXPECTED.catalog || await sha256Hex(counts.rows) !== EXPECTED.counts ||
      guards.rowCount !== 1 || canonicalJson(guards.rows) !== canonicalJson([{ database_comment: program.comments.database,
        role_comment: program.comments.role, bootstrap_guard_absent: true }]) ||
      singleton.rowCount !== 1 || canonicalJson(singleton.rows) !== canonicalJson([{ pristine: true, entitlements: ENTITLEMENTS }]) ||
      stores.rowCount !== 1 || canonicalJson(stores.rows) !== canonicalJson([{ ...program.seed.expectedReturnedRow,
        empty_contact: true, initial_timestamps: true }])) throw Error('LIVE_DATABASE_CURRENT_STATE_DIVERGED');
  return { catalogSha256: EXPECTED.catalog, roleSha256: EXPECTED.role, databaseAclSha256: EXPECTED.acl,
    rowCountsSha256: EXPECTED.counts, defaultStoreId: stores.rows[0].store_id, initialized: false };
}

/** Lazy, two fixed READ ONLY transactions maximum. Reuses the original frozen
 * eight SELECTs, NEVER the old C5c Run/Inspect entry/approval/slot or INSERT.
 * Source postgres is privileged; execution requires fresh explicit approval. */
export function createExpressInstalledDatabaseObserverV1({ program, journal, save }) {
  if (program.target.endpoint !== 'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com' ||
      program.target.database !== 'tenant_a0da1748bc4d5419_db' || program.target.role !== 'tenant_a0da1748bc4d5419_role' ||
      program.target.databaseOid !== '16459' || program.target.roleOid !== '16456') throw Error('LIVE_DATABASE_TARGET_REJECTED');
  const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
  const used = new Set();
  return { async observe(phase, signal) {
    if (!['preflight', 'after_bootstrap'].includes(phase) || used.has(phase) || program.snapshot.length !== 8 ||
        program.snapshot.some(q => !/^SELECT\b/i.test(q.text.trim()))) throw Error('LIVE_DATABASE_OBSERVER_ENTRY_REJECTED');
    used.add(phase); signal.throwIfAborted();
    const snapshot = await credentials();
    if (!(snapshot.expiration instanceof Date) || snapshot.expiration.getTime() < Date.now() + 180000) throw Error('LIVE_DATABASE_SOURCE_TOO_SHORT');
    const sts = new STSClient({ region: 'ca-central-1', credentials: snapshot, maxAttempts: 1,
      endpoint: 'https://sts.ca-central-1.amazonaws.com', ignoreConfiguredEndpointUrls: true });
    try {
      const who = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
      if (who.Account !== '402010193138' || who.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
          who.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') throw Error('LIVE_DATABASE_SOURCE_CHANGED');
    } finally { sts.destroy(); }
    const t = program.target, Pg = req('pg').Client, { Signer } = req('@aws-sdk/rds-signer');
    const { loadAtsRoots } = req('./services/saas/aurora_connections_v2');
    let signed = false, begun = false;
    const client = new Pg({ host: t.endpoint, port: 5432, database: t.database, user: 'postgres',
      password: async () => { if (signed) throw Error('LIVE_DATABASE_SIGN_ONCE'); signed = true;
        return new Signer({ hostname: t.endpoint, port: 5432, username: 'postgres', region: 'ca-central-1', credentials: snapshot }).getAuthToken(); },
      ssl: { ca: loadAtsRoots(), rejectUnauthorized: true, servername: t.endpoint, minVersion: 'TLSv1.2', checkServerIdentity: tls.checkServerIdentity },
      connectionTimeoutMillis: 30000, query_timeout: 15000, application_name: 'techlong-express-c5h-' + phase,
      options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000' });
    const kill = () => { client.connection?.stream?.destroy(); }; client.on('error', kill); signal.addEventListener('abort', kill, { once: true });
    await journal.consume('database_observe_' + phase, await sha256Hex({ target: t, snapshot: program.snapshot, phase }));
    try {
      await client.connect(); signal.throwIfAborted(); const stream = client.connection?.stream;
      if (!stream?.encrypted || !stream.authorized || stream.servername !== t.endpoint) throw Error('LIVE_DATABASE_CLIENT_TLS_UNPROVED');
      const query = async q => { signal.throwIfAborted(); const result = await client.query(q); signal.throwIfAborted(); return result; };
      await query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'); begun = true;
      await query('SET LOCAL search_path = pg_catalog'); await query("SET LOCAL lock_timeout = '5000ms'");
      const results = []; for (const q of program.snapshot) results.push(await query(q.values ? q : q.text));
      const facts = await validateExpressInstalledSnapshotV1(results, program);
      await query('COMMIT'); begun = false;
      const observation = { ...facts, checkedAt: Date.now(), readOnly: true, connections: 1, normalSqlCalls: 12,
        clientTlsVerified: true, backendTlsVerified: true, programSha256: await sha256Hex(program.snapshot) };
      await save('database-' + phase + '.json', observation);
      return { checkedAt: observation.checkedAt, evidenceSha256: await sha256Hex(observation), databaseOid: '16459', roleOid: '16456',
        databaseName: t.database, roleName: t.role, defaultStoreId: facts.defaultStoreId, activeDefaultStores: 1, initialized: false,
        sourceArchiveSha256: '1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a' };
    } catch { if (begun) { try { await client.query('ROLLBACK'); } catch { /* no reconnect */ } }
      throw Error('LIVE_DATABASE_OBSERVATION_FAILED_NO_RETRY');
    } finally { signal.removeEventListener('abort', kill); kill(); client.password = null;
      if (client.connectionParameters) client.connectionParameters.password = null; await client.end().catch(() => {}); }
  } };
}
