// First-acceptance mainline. Review has NO Aurora connection. Run/Inspect each
// require the exact fresh human-approved SHA; no old SQL controller is invoked.
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, mkdir, open, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import seedReview from '../../../lib/deployments/execution/express-store-seed-reviewed-v1.cjs';
import activation from '../../../lib/deployments/execution/express-application-activation-c4h.cjs';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
const root = path.resolve('F:/ChatGPT_workshop'), platform = fileURLToPath(new URL('../../../', import.meta.url));
const backend = 'E:/NodejsProject/SpeedFeast_Backend_main', requireBackend = createRequire(backend + '/package.json'), cli = promisify(execFile);
const hash = v => createHash('sha256').update(v).digest('hex'), fail = code => { throw Error(code); };
const input = {
  seed: root + '/techlong-express-default-store-c5c-20261015-r1.prepared.json',
  delivery: root + '/techlong-express-delivery-c5c-20261015-r1.review.json',
  original: root + '/techlong-d002-express-c3d-review-20261014-r2/manifest.json',
  restoreRun: root + '/techlong-d002-express-c3g-run-20261014-r1/result.json',
  restoreInspect: root + '/techlong-d002-express-c3g-inspect-20261014-r1/result.json',
  closed: root + '/techlong-d002-express-c4c-inspect-20261014-r1/observation.json',
  tools: root + '/techlong-d002-express-c4h-review-20261015-r2/code-binding.json',
};
const EXPECTED = {
  seed: '9aedc3646280380bd12bee35a628642a02d29133a386767ea4aee7d32d03aa29',
  delivery: 'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e',
  restoreRun: '3ec0a90c18920a0625a5857f05b4b1d86da483f9e1915ef718b122a72894fd00',
  restoreInspect: 'f7040b664ce600c521dd37af9140941bd48de4fc66568538b878ab28cbccce03',
  closed: '624478cdb00bac5fd9c2c566400955eb6adf37e18150c16f3dc6b01c5fe9c262',
};
const raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('STORE_SEED_ARGUMENTS_REJECTED');
for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (new Set(pairs.map(p => p[0])).size !== pairs.length || !['Review', 'Run', 'Inspect'].includes(mode) ||
    Object.keys(args).some(k => !['--mode', '--output', '--manifest', '--approved-sha'].includes(k)) || Object.values(args).some(v => !v) ||
    path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-express-c5c-store-seed-[a-z0-9-]+$/.test(path.basename(out)) ||
    (mode === 'Review' ? args['--manifest'] || args['--approved-sha'] : !args['--manifest'] || !args['--approved-sha'])) fail('STORE_SEED_ARGUMENTS_REJECTED');
await mkdir(out);
const save = async (name, value) => { const f = await open(path.join(out, name), 'wx'); try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
const json = async file => { const b = await readFile(file); if (b.length > 4_000_000) fail('STORE_SEED_INPUT_TOO_LARGE'); return JSON.parse(b.toString('utf8')); };
const emptySlot = async name => { try { await access(root + '/' + name); fail('STORE_SEED_SLOT_OCCUPIED_NO_RETRY'); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
let manifest, journal, phase = 'LOCAL_BINDING', metadataCalls = 0, sqlConnections = 0, sqlCalls = 0, insertCalls = 0, slotConsumed = false, lastSqlIndex = null;
const clients = [], stage = async value => { if (!journal) journal = await open(out + '/stages.jsonl', 'wx'); await journal.writeFile(JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); await journal.sync(); };
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY',
    'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS'].some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('STORE_SEED_ENV_CONFLICT');
  const history = [];
  for (const [name, file] of Object.entries(input)) { const sha256 = hash(await readFile(file));
    if (EXPECTED[name] && EXPECTED[name] !== sha256) fail('STORE_SEED_HISTORY_CHANGED'); history.push({ name, filename: file, sha256 }); }
  const oldTools = (await json(input.tools)).tools;
  if (oldTools.length !== 2) fail('STORE_SEED_NATIVE_TOOLS_REJECTED');
  for (const t of oldTools) if (hash(await readFile(t.filename)) !== t.sha256) fail('STORE_SEED_NATIVE_TOOL_CHANGED');
  // Pin the local import/require closure, compiler SQL/Python assets and locks.
  // No stale whole-project code-binding or consumed C4 execution is replayed.
  const seen = new Set(), pins = [];
  const pin = async filename => {
    const f = await realpath(filename); if (seen.has(f.toLowerCase())) return; seen.add(f.toLowerCase());
    const source = (await readFile(f, 'utf8')).replace(/\r\n/g, '\n'); pins.push({ filename: f, sha256: hash(source) });
    if (!/\.(?:ts|mjs|cjs|js)$/.test(f)) return;
    for (const m of source.matchAll(/(?:from\s*|(?:require|import)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(f), m[1]); let resolved;
      for (const v of [base, base + '.js', base + '.cjs', base + '.ts', base + '/index.js']) { try { await access(v); resolved = v; break; } catch { /* next exact resolver suffix */ } }
      if (!resolved) fail('STORE_SEED_LOCAL_DEPENDENCY_UNRESOLVED'); await pin(resolved);
    }
  };
  for (const name of [fileURLToPath(import.meta.url), platform + '/ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts',
    platform + '/package-lock.json', backend + '/package-lock.json', backend + '/scripts/prepare-aurora-express-sql-v5.js',
    backend + '/services/saas/aurora-express-application-v6.cjs', backend + '/services/saas/aurora_role_directory_v2.js',
    backend + '/services/saas/aurora_express_restore_v3.js', backend + '/services/saas/aurora_connections_v2.js',
    backend + '/scripts/render_tenant_baseline_verification.py', backend + '/db/saas_control.sql', backend + '/db/theme_config.sql']) await pin(name);
  pins.sort((a, b) => a.filename.localeCompare(b.filename));
  const codeBinding = { pins, tools: oldTools, history, nodeVersion: process.version }, codeSha = db.digest(codeBinding);
  await save('code-binding.json', { ...codeBinding, codeBindingSha256: codeSha });
  const slot = mode === 'Inspect' ? seedReview.INSPECT_SLOT : seedReview.RUN_SLOT;
  await emptySlot(slot); if (mode === 'Review') await emptySlot(seedReview.INSPECT_SLOT);
  // Invalid/expired approval stops before compilation/credentials/SQL/slots.
  if (mode !== 'Review') {
    const f = await realpath(args['--manifest']);
    if (path.basename(f) !== 'manifest.json' || path.dirname(path.dirname(f)).toLowerCase() !== root.toLowerCase() ||
        !/^techlong-express-c5c-store-seed-/.test(path.basename(path.dirname(f)))) fail('STORE_SEED_MANIFEST_PATH_REJECTED');
    manifest = await json(f); const { manifestSha256, ...body } = manifest;
    if (args['--approved-sha'] !== manifestSha256 || db.digest(body) !== manifestSha256 || manifest.codeBindingSha256 !== codeSha ||
        !Number.isFinite(Date.parse(manifest.expiresAt)) || Date.now() < Date.parse(manifest.preparedAt) || Date.now() >= Date.parse(manifest.expiresAt)) fail('STORE_SEED_FRESH_APPROVAL_REQUIRED');
    if (mode === 'Inspect') { const s = await json(root + '/' + seedReview.RUN_SLOT);
      if (s.manifestSha256 !== manifestSha256 || s.retryAuthorized !== false) fail('STORE_SEED_APPROVED_RUN_SLOT_REQUIRED'); }
  }
  phase = 'LOCAL_ARCHIVE_COMPILATION';
  const built = await requireBackend('./scripts/prepare-aurora-express-sql-v5').compile({ continuationInput: (await json(input.original)).continuationInput,
    baselineDirectory: root + '/techlong-empty-baseline-20261005-f2a4',
    pgRestorePath: oldTools.find(t => t.filename.endsWith('pg_restore.exe')).filename,
    pythonPath: oldTools.find(t => t.filename.endsWith('python.exe')).filename, workspace: out + '/compiled' });
  const app = requireBackend('./services/saas/aurora-express-application-v6.cjs'), rest = requireBackend('./services/saas/aurora_express_restore_v3');
  const candidate = app.compileApplicationCandidateV6({ bootstrapProgram: built.bootstrap, baselineProgram: built.baseline,
    run: await json(input.restoreRun), inspection: await json(input.restoreInspect) });
  app.assertCompiledApplicationCandidateV6(candidate);
  const applicationProgram = activation.compile({ candidate, closedDatabases: (await json(input.closed)).databases,
    roleSql: requireBackend('./services/saas/aurora_role_directory_v2').ROLE_DIRECTORY_SQL,
    catalogSql: rest.PG17_CATALOG_SQL, rowCountSql: rest.rowCountSql(candidate.tables) });
  const program = seedReview.compile({ seed: (await json(input.seed)).candidate, applicationProgram, bootstrap: built.bootstrap });
  await save('program.json', program);
  const approval = () => seedReview.approval(manifest, args['--approved-sha'], codeSha, program, Date.now());
  if (mode !== 'Review') approval();
  phase = 'AWS_METADATA_AND_NEON_READONLY';
  const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
  const config = { region: 'ca-central-1', credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const rdsSdk = requireBackend('@aws-sdk/client-rds'), rds = new rdsSdk.RDSClient(config), sts = new STSClient(config), iam = new IAMClient(config);
  clients.push(rds, sts, iam);
  const send = async (client, command) => {
    if (++metadataCalls > 6 || !['GetCallerIdentityCommand', 'DescribeDBClustersCommand', 'DescribeDBInstancesCommand', 'SimulatePrincipalPolicyCommand'].includes(command.constructor.name)) fail('STORE_SEED_METADATA_SCOPE_REJECTED');
    try { return await client.send(command, { abortSignal: AbortSignal.timeout(30000) }); }
    catch (e) { fail(['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException'].includes(e.name) ? 'STORE_SEED_SOURCE_REFRESH_REQUIRED' : 'STORE_SEED_METADATA_PROVIDER_FAILED'); }
  };
  const source = value => { if (value.Account !== '402010193138' || value.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || value.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('STORE_SEED_SOURCE_CHANGED'); return { Account: value.Account, Arn: value.Arn, UserId: value.UserId }; };
  const who = source(await send(sts, new GetCallerIdentityCommand({})));
  const cs = (await send(rds, new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: 'techlong-sandbox-express-d001' }))).DBClusters;
  const ins = (await send(rds, new rdsSdk.DescribeDBInstancesCommand({ DBInstanceIdentifier: 'techlong-sandbox-express-d001-instance-1' }))).DBInstances;
  const c = cs?.[0], i = ins?.[0], t = program.target;
  if (cs?.length !== 1 || ins?.length !== 1 || c.DBClusterArn !== t.clusterArn || c.DbClusterResourceId !== t.clusterResourceId ||
      c.Endpoint !== t.endpoint || c.Port !== 5432 || c.Engine !== 'aurora-postgresql' || c.EngineVersion !== '17.9' || c.Status !== 'available' ||
      c.ClusterCreateTime?.toISOString() !== '2026-10-14T03:13:30.069Z' || c.MasterUsername !== 'postgres' || c.MasterUserSecret ||
      c.IAMDatabaseAuthenticationEnabled !== true || c.InternetAccessGatewayEnabled !== true || c.VPCNetworkingEnabled !== false ||
      c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter || c.DBClusterMembers[0].DBInstanceIdentifier !== i.DBInstanceIdentifier ||
      i.DBInstanceIdentifier !== 'techlong-sandbox-express-d001-instance-1' || i.DbiResourceId !== 'db-NVAQZTKV2FPTHGITOQE563CPAY' ||
      i.InstanceCreateTime?.toISOString() !== '2026-10-14T03:13:30.758Z' || i.DBClusterIdentifier !== 'techlong-sandbox-express-d001' || i.DBInstanceClass !== 'db.serverless' ||
      i.DBInstanceStatus !== 'available' || i.EngineVersion !== '17.9' ||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration) !== db.canonicalJson({ MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 })) fail('STORE_SEED_PHYSICAL_CLUSTER_CHANGED');
  const resource = 'arn:aws:rds-db:ca-central-1:402010193138:dbuser:' + t.clusterResourceId + '/postgres';
  const ev = (await send(iam, new SimulatePrincipalPolicyCommand({ PolicySourceArn: who.Arn, ActionNames: ['rds-db:connect'], ResourceArns: [resource] }))).EvaluationResults;
  if (ev?.length !== 1 || ev[0].EvalActionName !== 'rds-db:connect' || ev[0].EvalResourceName !== resource || ev[0].EvalDecision !== 'allowed' || ev[0].MissingContextValues?.length) fail('STORE_SEED_SOURCE_CONNECT_DENIED');
  // Separate process keeps the existing Neon URL out of the Aurora environment.
  // This standing-authorized reader has exactly STS + two DDB GetItem + one
  // HTTPS read-only Neon SELECT; no Secret values or private bundle are read.
  let controlPlane;
  try { const result = await cli(process.execPath, ['--experimental-strip-types', '--env-file-if-exists=.env.local',
    'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts', '--review', input.delivery],
  { cwd: platform, timeout: 65000, maxBuffer: 128000, windowsHide: true, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true' } }); controlPlane = JSON.parse(result.stdout); }
  catch { fail('STORE_SEED_CONTROL_PLANE_READ_FAILED'); }
  const facts = { observedAt: new Date().toISOString(), source: who, clusterVerified: true, sourceConnectAllowed: true, controlPlane,
    cluster: { arn: c.DBClusterArn, resourceId: c.DbClusterResourceId, endpoint: c.Endpoint, engine: c.EngineVersion, createdAt: c.ClusterCreateTime.toISOString(), writerResourceId: i.DbiResourceId },
    sourceConnect: { action: 'rds-db:connect', resource, decision: 'allowed' } };
  seedReview.assertFacts(facts, Date.now()); await save('metadata.json', facts);
  if (mode === 'Review') {
    manifest = seedReview.prepare({ program, codeBindingSha256: codeSha, facts, now: Date.now() }); await save('manifest.json', manifest);
    const result = { mode, directory: out, manifestSha256: manifest.manifestSha256, expiresAt: manifest.expiresAt,
      metadataCalls, controlPlaneReads: { sts: 1, dynamodb: 2, neonReadonlyStatements: 1 }, sqlConnections, sqlCalls, insertCalls, slotConsumed,
      awsWrites: 0, secretValueReads: 0, privateMaterialReads: 0, runtimeEnabled: false, readyVerified: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } else {
    approval();
    if (db.canonicalJson(facts.cluster) !== db.canonicalJson(manifest.facts.cluster)) fail('STORE_SEED_APPROVED_CLUSTER_CHANGED');
    const snapshot = await credentials();
    if (!snapshot.accessKeyId || !snapshot.secretAccessKey || !snapshot.sessionToken || !(snapshot.expiration instanceof Date) || snapshot.expiration.getTime() < Date.now() + 300000) fail('STORE_SEED_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const ss = new STSClient({ ...config, credentials: snapshot }); clients.push(ss); source(await send(ss, new GetCallerIdentityCommand({})));
    const inspectOnly = mode === 'Inspect', Pg = requireBackend('pg').Client, guard = seedReview.createQueryGuard(program, inspectOnly, approval);
    let signed = false;
    class FixedClient extends Pg {
      connect(...extra) { approval(); if (extra.length || ++sqlConnections !== 1) fail('STORE_SEED_ONE_CONNECTION_ONLY'); return super.connect(); }
      query(q, ...extra) {
        ({ sqlCalls, insertCalls, lastSqlIndex } = guard.check(q, extra)); return super.query(q);
      }
    }
    const { loadAtsRoots } = requireBackend('./services/saas/aurora_connections_v2'), { Signer } = requireBackend('@aws-sdk/rds-signer');
    const client = new FixedClient({ host: t.endpoint, port: 5432, database: t.database, user: 'postgres',
      password: async () => { approval(); if (signed || snapshot.expiration.getTime() < Date.now() + 120000) fail('STORE_SEED_TOKEN_SIGNING_REJECTED'); signed = true;
        const token = await new Signer({ region: 'ca-central-1', hostname: t.endpoint, port: 5432, username: 'postgres', credentials: snapshot }).getAuthToken();
        if (typeof token !== 'string' || token.length < 80 || token.length > 16384 || /[\r\n\0]/.test(token)) fail('STORE_SEED_TOKEN_INVALID'); return token; },
      ssl: { ca: loadAtsRoots(), rejectUnauthorized: true, servername: t.endpoint, checkServerIdentity: tls.checkServerIdentity, minVersion: 'TLSv1.2' },
      connectionTimeoutMillis: 30000, query_timeout: 15000,
      options: '-c default_transaction_read_only=' + (inspectOnly ? 'on' : 'off') + ' -c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000',
      application_name: 'techlong-express-c5c-store-seed-' + mode.toLowerCase() });
    approval(); seedReview.assertFacts(facts, Date.now()); await emptySlot(slot);
    const f = await open(root + '/' + slot, 'wx'); slotConsumed = true;
    try { await f.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, consumedAt: new Date().toISOString(), retryAuthorized: false }) + '\n'); await f.sync(); } finally { await f.close(); }
    const signal = AbortSignal.timeout(90000), kill = () => { try { client.connection?.stream?.destroy(); } catch { /* best effort */ } };
    client.on('error', kill); signal.addEventListener('abort', kill, { once: true });
    try {
      phase = 'APPROVED_TLS_IAM_SQL'; await client.connect(); signal.throwIfAborted(); const stream = client.connection?.stream;
      if (stream?.encrypted !== true || stream.authorized !== true || stream.servername !== t.endpoint) fail('STORE_SEED_CLIENT_TLS_UNPROVEN');
      const observation = await seedReview.execute({ client, program, candidate, inspectOnly, approval, signal, journal: stage,
        checks: { assertCandidate: app.assertCompiledApplicationCandidateV6, classifyRole: app.classifyApplicationRoleV6, verifyCatalog: app.verifyApplicationCatalogV6 } });
      await save('observation.json', observation);
      const result = { mode, directory: out, manifestSha256: manifest.manifestSha256, outcome: observation.outcome, metadataCalls,
        controlPlaneReads: { sts: 1, dynamodb: 2, neonReadonlyStatements: 1 }, sqlConnections, sqlCalls, insertCalls, slotConsumed,
        awsWrites: 0, secretValueReads: 0, privateMaterialReads: 0, automaticRetries: 0, runtimeEnabled: false, readyVerified: false };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2));
    } finally { kill(); signal.removeEventListener('abort', kill); client.password = null; if (client.connectionParameters) client.connectionParameters.password = null;
      let timer; try { await Promise.race([client.end(), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); } catch { /* no reconnect */ } finally { clearTimeout(timer); } }
  }
} catch (e) {
  const code = /^STORE_SEED_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'STORE_SEED_LOCAL_OR_PROVIDER_FAILED';
  await save('stopped.json', { mode, code, phase, manifestSha256: manifest?.manifestSha256 ?? null, metadataCalls,
    sqlConnections, sqlCalls, insertCalls, slotConsumed, lastSqlIndex, transaction: e.storeSeedTransaction || null,
    postgresSqlState: /^[0-9][A-Z0-9]{4}$/.test(e.code || '') ? e.code : null,
    requiresIndependentInspect: slotConsumed && mode === 'Run', awsWrites: 0, secretValueReads: 0, privateMaterialReads: 0,
    automaticRetries: 0, runtimeEnabled: false, readyVerified: false });
  console.error(code); process.exitCode = 1;
} finally { for (const c of clients) c.destroy(); if (journal) await journal.close(); }
