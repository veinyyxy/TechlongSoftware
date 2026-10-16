import tls from 'node:tls';
import { createRequire } from 'node:module';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { A, hash, SUMMARY_SQL, requireAudit as must, verifyCatalog, classifyInitialization } from './express-initialization-audit-plan-v1.mjs';
const req = createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');

// Nothing is opened until the caller has validated the exact approval and
// current hosting proof. Only one client/token/connection and fixed SQL program.
export async function runInitializationAudit({ program, consume, save, signal }) {
  const readiness = req('./services/saas/tenant-readiness-v1.cjs');
  must(program.target.endpoint === A.endpoint && program.target.database === A.database &&
    program.target.databaseOid === A.databaseOid && program.statements.length === 10 &&
    hash(program.statements) === program.statementsSha256 && program.normalSqlCalls === 14 &&
    hash(program.statements.slice(0, 8)) === A.snapshotSha256 && program.statements[8].text === readiness.STATE_SQL &&
    program.statements[9].text === SUMMARY_SQL && program.begin === 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY' &&
    program.search === 'SET LOCAL search_path = pg_catalog' && program.lock === "SET LOCAL lock_timeout = '5000ms'", 'RUNTIME_PROGRAM');
  const credentials = await fromLoginCredentials({ profile: 'techlong-sandbox-user',
    clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } })();
  must(credentials.expiration instanceof Date && credentials.expiration.getTime() >= Date.now() + 180000, 'SOURCE_TOO_SHORT_NO_SQL');
  const sts = new STSClient({ credentials, region: 'ca-central-1', endpoint: 'https://sts.ca-central-1.amazonaws.com', maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  try { const who = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
    must(who.Account === '402010193138' && who.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && who.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE_CHANGED');
  } finally { sts.destroy(); }
  const { Client } = req('pg'), { Signer } = req('@aws-sdk/rds-signer'), { loadAtsRoots } = req('./services/saas/aurora_connections_v2');
  let signed = false, connected = false, begun = false, sqlCalls = 0, connectEntered = false, rollbackCalls = 0;
  const client = new Client({ host: A.endpoint, port: 5432, database: A.database, user: 'postgres',
    password: async () => { must(!signed, 'TOKEN_ALREADY_SIGNED'); signed = true;
      return new Signer({ hostname: A.endpoint, port: 5432, username: 'postgres', region: 'ca-central-1', credentials }).getAuthToken(); },
    ssl: { ca: loadAtsRoots(), rejectUnauthorized: true, servername: A.endpoint, minVersion: 'TLSv1.2', checkServerIdentity: tls.checkServerIdentity },
    connectionTimeoutMillis: 30000, query_timeout: 15000, application_name: 'techlong-k2a-initialization-audit-v1',
    options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000' });
  const kill = () => { try { client.connection?.stream?.destroy(); } catch { /* no reconnect */ } };
  client.on('error', kill); signal.addEventListener('abort', kill, { once: true });
  const query = async q => { signal.throwIfAborted(); must(++sqlCalls <= 14, 'SQL_LIMIT');
    const r = await client.query(q); signal.throwIfAborted(); return r; };
  try {
    await consume(); // durable one-use local attempt, before signing/connection.
    signal.throwIfAborted(); connectEntered = true; await client.connect(); connected = true;
    const stream = client.connection?.stream;
    must(stream?.encrypted === true && stream.authorized === true && stream.servername === A.endpoint, 'CLIENT_TLS_UNPROVED');
    await query(program.begin); begun = true; await query(program.search); await query(program.lock);
    const results = [];
    for (let n = 0; n < program.statements.length; n++) {
      const q = program.statements[n]; results.push(await query(q.values ? q : q.text));
      if (n === 3) verifyCatalog(results); // stop BEFORE table counts/state reads if foreign catalog/identity.
    }
    const facts = classifyInitialization(results, program);
    await query('COMMIT'); begun = false;
    const receipt = { schema: 'techlong/initialization-audit-receipt/v1', checkedAt: new Date().toISOString(), facts,
      target: { database: A.database, databaseOid: A.databaseOid, roleOid: A.roleOid, user: 'postgres', endpoint: A.endpoint },
      clientTlsVerified: true, backendTlsVerified: true, readOnly: true, isolation: 'serializable', connections: 1, sqlCalls,
      rollbackCalls: 0, rawBusinessRowsPersisted: false, iamTokenPersisted: false, automaticRetries: 0,
      metadataIsNotCrossServiceCas: true, sqlBusinessWrites: 0, cloudWrites: 0, provisionAuthorized: false };
    await save('sql-receipt.json', receipt); return receipt;
  } catch (e) {
    if (begun && connected && !signal.aborted) { rollbackCalls++; try { await client.query('ROLLBACK'); } catch { kill(); } }
    const code = /^INITIALIZATION_AUDIT_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'INITIALIZATION_AUDIT_SQL_OR_TRANSPORT_FAILED';
    await save('sql-failure.json', { code, connectEntered, connected, sqlCalls, rollbackCalls, automaticRetries: 0,
      sqlBusinessWrites: 0, rawProviderErrorPersisted: false, provisionAuthorized: false });
    throw Error(code);
  } finally {
    signal.removeEventListener('abort', kill); kill(); client.password = null;
    if (client.connectionParameters) client.connectionParameters.password = null;
    await client.end().catch(() => {});
  }
}
