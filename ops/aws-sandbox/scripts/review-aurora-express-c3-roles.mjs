// C3c: one separately approved READ ONLY role-catalog connection. No mutation,
// adoption, namespace change, database create/restore, or old-slot reset path.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, open, mkdir, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import diagnostic from '../../../lib/deployments/execution/aurora-express-c3-role-diagnostic.cjs';
import { assertDiagnosticFacts } from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
import { assertC3Approval } from '../../../lib/deployments/execution/aurora-express-c3-review.ts';
const root = path.resolve('F:/ChatGPT_workshop'), backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url)), cli = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), fail = code => { throw Error(code); };
const raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('EXPRESS_C3_ROLE_ARGUMENTS_REJECTED');
for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (new Set(pairs.map(([k]) => k)).size !== pairs.length || !['Review', 'Run', 'InspectMetadata'].includes(mode) ||
  Object.keys(args).some(k => !['--mode', '--manifest', '--approved-sha', '--output'].includes(k)) ||
  Object.values(args).some(v => typeof v !== 'string' || !v) || path.dirname(out).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-d002-express-c3-role-[a-z0-9-]+$/.test(path.basename(out))) fail('EXPRESS_C3_ROLE_ARGUMENTS_REJECTED');
await mkdir(out);
const save = async (name, value) => {
  const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
};
const emptySlot = async () => { try { await access(path.join(root, diagnostic.SLOT)); fail('EXPRESS_C3_ROLE_SLOT_OCCUPIED'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } };
let metadataCalls = 0, sqlConnections = 0, sqlCalls = 0, slotConsumed = false, phase = 'LOCAL_HISTORY';
let sts, iam, rds, manifest;
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY'].some(k => process.env[k]) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C3_ROLE_ENV_CONFLICT');
  const original = JSON.parse(await readFile(path.join(root, 'techlong-d002-express-c3-review-20261014-r4/manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'techlong-d002-express-c3-run-20261014-r1/code-binding.json'), 'utf8'));
  const frozenSha = 'fc7a6d9adc785d481269ceba26f8a1fef0c0edc594900663c8fd24be443f63e9';
  if (frozen.pins.length !== 210 || frozen.tools.length !== 2 || db.digest({ pins: frozen.pins, tools: frozen.tools }) !== frozenSha ||
    frozen.codeBindingSha256 !== frozenSha) fail('EXPRESS_C3_ROLE_FROZEN_BINDING_REJECTED');
  assertC3Approval(original, diagnostic.ORIGINAL_SHA, frozenSha, Date.parse(original.preparedAt)); // integrity only, not replay
  for (const pin of frozen.pins) {
    if (hash((await readFile(path.join(pin.repo, pin.name), 'utf8')).replace(/\r\n/g, '\n')) !== pin.sha256)
      fail('EXPRESS_C3_ROLE_FROZEN_CODE_DRIFT');
  }
  for (const tool of frozen.tools) if (hash(await readFile(tool.filename)) !== tool.sha256) fail('EXPRESS_C3_ROLE_FROZEN_TOOL_DRIFT');
  const expectedFiles = [
    ['techlong-d002-express-c3-run-20261014-r1/stopped.json', '7c5f664cfe012aab465709b402ac108d6071788737a68f383b4ec20be943e061'],
    ['techlong-d002-express-c3-run-20261014-r1/stages.jsonl', 'b48a706ca68cae27e5a71c539cd3a40723b2f32a523e4cd86f3c8d200742d99e'],
    ['techlong-d002-express-c3-inspect-20261014-r1/result.json', '8e4cb1f7d1ffba334be0d849253595b02ee4e7f3c413d82e73886f687899882a'],
    ['techlong-d002-express-c3-bootstrap-g1.permanent-slot.json', '0d08ac8a636ecad70153a52724dfc0334a9faf53dd50b499d3d4110d08272a33'],
    ['techlong-d002-express-c3-bootstrap-g1-inspect.permanent-slot.json', '56a883de7de8d90608f7540585bdaf794282d76d823047f8fdeb1d872fd42b50']
  ];
  for (const [relative, sha256] of expectedFiles) if (hash(await readFile(path.join(root, relative))) !== sha256) fail('EXPRESS_C3_ROLE_HISTORY_DRIFT');
  const historySha = db.digest({ originalManifestSha256: diagnostic.ORIGINAL_SHA, frozenCodeSha256: frozenSha, evidence: expectedFiles });
  const pins = [...frozen.pins];
  for (const name of ['ops/aws-sandbox/scripts/review-aurora-express-c3-roles.mjs', 'lib/deployments/execution/aurora-express-c3-role-diagnostic.cjs'])
    pins.push({ repo: platform, name, sha256: hash((await readFile(path.join(platform, name), 'utf8')).replace(/\r\n/g, '\n')) });
  const codeSha = db.digest({ pins, tools: frozen.tools });
  await save('code-binding.json', { codeBindingSha256: codeSha, pins, tools: frozen.tools, historySha256: historySha });
  const requireBackend = createRequire(path.join(backend, 'package.json'));
  const bootstrap = requireBackend('./services/saas/aurora-express-bootstrap-v3.cjs');
  const { CATALOG_SQL, verifyStage } = requireBackend('./services/saas/aurora_express_bootstrap_provider_v3');
  const program = bootstrap.compileExpressBootstrapV3(original.candidateInput), legacySha = db.digest(CATALOG_SQL);
  if (bootstrap.digest(program) !== original.bootstrapProgramSha256) fail('EXPRESS_C3_ROLE_PROGRAM_DRIFT');
  const binding = original.expectedBinding;
  if (mode !== 'Review') {
    const filename = await realpath(args['--manifest']);
    if (path.basename(filename) !== 'manifest.json' || path.dirname(path.dirname(filename)).toLowerCase() !== root.toLowerCase() ||
      !/^techlong-d002-express-c3-role-/.test(path.basename(path.dirname(filename)))) fail('EXPRESS_C3_ROLE_MANIFEST_PATH_REJECTED');
    manifest = JSON.parse(await readFile(filename, 'utf8'));
    diagnostic.assertApproval(manifest, mode === 'InspectMetadata' ? manifest.manifestSha256 : args['--approved-sha'],
      codeSha, historySha, original, legacySha, mode === 'InspectMetadata' ? Date.parse(manifest.preparedAt) : Date.now());
  }
  phase = 'READ_ONLY_METADATA';
  const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
  const config = { region: 'ca-central-1', credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const sdk = requireBackend('@aws-sdk/client-rds');
  sts = new STSClient(config); iam = new IAMClient(config); rds = new sdk.RDSClient(config);
  const send = async (client, command) => {
    if (!['GetCallerIdentityCommand', 'DescribeDBClustersCommand', 'DescribeDBInstancesCommand', 'SimulatePrincipalPolicyCommand'].includes(command.constructor.name) ||
      ++metadataCalls > 9) fail('EXPRESS_C3_ROLE_METADATA_BUDGET_REJECTED');
    try { return await client.send(command, { abortSignal: AbortSignal.timeout(45000) }); }
    catch (e) {
      const codes = { CredentialsProviderError: 'SOURCE_CREDENTIALS_UNAVAILABLE', ExpiredToken: 'SOURCE_TOKEN_EXPIRED',
        ExpiredTokenException: 'SOURCE_TOKEN_EXPIRED', AccessDenied: 'METADATA_ACCESS_DENIED', AccessDeniedException: 'METADATA_ACCESS_DENIED',
        TimeoutError: 'METADATA_TIMEOUT', AbortError: 'METADATA_CANCELLED' };
      fail('EXPRESS_C3_ROLE_' + (codes[e.name] || 'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity = value => {
    if (value.Account !== '402010193138' || value.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      value.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C3_ROLE_SOURCE_CHANGED');
    return { Account: value.Account, Arn: value.Arn, UserId: value.UserId };
  };
  const readBinding = async () => {
    const clusters = (await send(rds, new sdk.DescribeDBClustersCommand({ DBClusterIdentifier: 'techlong-sandbox-express-d001' }))).DBClusters;
    const c = clusters?.[0];
    if (clusters?.length !== 1 || c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
      c.DBClusterMembers[0].DBInstanceIdentifier !== binding.writerIdentifier || c.MasterUsername !== 'postgres' || c.MasterUserSecret ||
      !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false || c.DeletionProtection !== false ||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration) !== db.canonicalJson({ MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 }))
      fail('EXPRESS_C3_ROLE_RESOURCE_CHANGED');
    const instances = (await send(rds, new sdk.DescribeDBInstancesCommand({ DBInstanceIdentifier: binding.writerIdentifier }))).DBInstances, i = instances?.[0];
    if (instances?.length !== 1 || i.DBClusterIdentifier !== 'techlong-sandbox-express-d001' || i.DBInstanceClass !== 'db.serverless') fail('EXPRESS_C3_ROLE_WRITER_CHANGED');
    const current = { manifestSha256: binding.manifestSha256, clusterArn: c.DBClusterArn, clusterResourceId: c.DbClusterResourceId,
      createdAt: c.ClusterCreateTime?.toISOString(), engineVersion: c.EngineVersion, endpoint: c.Endpoint, port: c.Port,
      writerIdentifier: i.DBInstanceIdentifier, writerArn: i.DBInstanceArn, writerResourceId: i.DbiResourceId,
      writerCreatedAt: i.InstanceCreateTime?.toISOString(), tags: Object.fromEntries((c.TagList || []).map(t => [t.Key, t.Value])),
      clusterStatus: c.Status, writerStatus: i.DBInstanceStatus };
    if (db.canonicalJson(current) !== db.canonicalJson(binding)) fail('EXPRESS_C3_ROLE_PHYSICAL_BINDING_CHANGED');
    return current;
  };
  const facts = async () => {
    const observedAt = new Date().toISOString(), arn = `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const [source, current, permissions, plan] = await Promise.all([send(sts, new GetCallerIdentityCommand({})).then(identity), readBinding(),
      send(iam, new SimulatePrincipalPolicyCommand({ PolicySourceArn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', ActionNames: ['rds-db:connect'], ResourceArns: [arn] })),
      cli('aws', ['freetier', 'get-account-plan-state', '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--no-cli-pager', '--output', 'json',
        '--query', '{planType:accountPlanType,planStatus:accountPlanStatus}'], { timeout: 45000, maxBuffer: 16384,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off' } }).catch(e => {
          // Keep provider text/private login material out of all receipts.
          const text = String(e.stderr || ''), api = text.match(/An error occurred \(([A-Za-z0-9_-]{1,64})\)/)?.[1];
          const codes = { '502': 'PLAN_HTTP_502', '503': 'PLAN_HTTP_503', '504': 'PLAN_HTTP_504',
            ExpiredToken: 'SOURCE_TOKEN_EXPIRED', ExpiredTokenException: 'SOURCE_TOKEN_EXPIRED',
            AccessDeniedException: 'PLAN_ACCESS_DENIED', TooManyRequestsException: 'PLAN_THROTTLED' };
          fail('EXPRESS_C3_ROLE_' + (codes[api] || (/expired|refresh|credentials/i.test(text) ? 'SOURCE_CREDENTIALS_UNAVAILABLE' : 'PLAN_READ_FAILED')));
        })]);
    if (++metadataCalls > 9 || permissions.EvaluationResults?.length !== 1) fail('EXPRESS_C3_ROLE_METADATA_BUDGET_REJECTED');
    const p = permissions.EvaluationResults[0], result = { observedAt, source, binding: current, plan: JSON.parse(plan.stdout),
      connectPermission: { action: p.EvalActionName, resource: p.EvalResourceName, decision: p.EvalDecision, missingContext: p.MissingContextValues || [] } };
    assertDiagnosticFacts(result, binding, Date.now()); return result;
  };
  if (mode === 'Review') {
    await emptySlot();
    manifest = diagnostic.prepareReview({ facts: await facts(), original, codeBindingSha256: codeSha, historySha256: historySha, legacySqlSha256: legacySha }, Date.now());
    await save('manifest.json', manifest);
    process.stdout.write(JSON.stringify({ mode, directory: out, manifestSha256: manifest.manifestSha256, expiresAt: manifest.expiresAt,
      metadataCalls, sqlConnections: 0, sqlMutations: 0, executionAuthorized: false }) + '\n');
  } else if (mode === 'InspectMetadata') {
    await save('facts.json', await facts());
    process.stdout.write(JSON.stringify({ mode, directory: out, metadataCalls, sqlConnections: 0, awsResourceWrites: 0,
      outcome: 'PHYSICAL_ONLY_ROLE_STATE_NOT_REOBSERVED' }) + '\n');
  } else {
    const approval = () => diagnostic.assertApproval(manifest, args['--approved-sha'], codeSha, historySha, original, legacySha, Date.now());
    approval(); await emptySlot(); const fresh = await facts(), snapshot = await credentials();
    if (!snapshot.accessKeyId || !snapshot.secretAccessKey || !snapshot.sessionToken || !(snapshot.expiration instanceof Date) ||
      snapshot.expiration.getTime() < Date.now() + 300000) fail('EXPRESS_C3_ROLE_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const snapshotSts = new STSClient({ ...config, credentials: snapshot });
    try { identity(await send(snapshotSts, new GetCallerIdentityCommand({}))); } finally { snapshotSts.destroy(); }
    const { ExpressManagementSessionProviderV3, MANAGEMENT_IDENTITY_SQL } = requireBackend('./services/saas/aurora_management_sessions_v3');
    const Pg = requireBackend('pg').Client, values = [[program.target.tenantUsername, program.guardName], program.target.tenantDatabase];
    class ReadOnlyClient extends Pg {
      connect(...args) { if (++sqlConnections > 1) fail('EXPRESS_C3_ROLE_CONNECTION_BUDGET_REJECTED'); return super.connect(...args); }
      query(query, ...args) {
        approval();
        const text = typeof query === 'string' ? query : query?.text;
        if (++sqlCalls > 5 || ![MANAGEMENT_IDENTITY_SQL, manifest.sql.transaction, CATALOG_SQL, diagnostic.DETAIL_SQL, 'COMMIT'].includes(text) ||
          ([CATALOG_SQL, diagnostic.DETAIL_SQL].includes(text) && db.canonicalJson(query.values) !== db.canonicalJson(values)))
          fail('EXPRESS_C3_ROLE_READ_ONLY_QUERY_REJECTED');
        return super.query(query, ...args);
      }
    }
    const sessions = new ExpressManagementSessionProviderV3({ target: program.target,
      dependencies: { Client: ReadOnlyClient, credentialProvider: async () => snapshot } });
    approval(); assertDiagnosticFacts(fresh, binding, Date.now());
    const slot = await open(path.join(root, diagnostic.SLOT), 'wx'); slotConsumed = true;
    try { await slot.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, consumedAt: new Date().toISOString(),
      originalManifestSha256: diagnostic.ORIGINAL_SHA, expectedOids: diagnostic.EXPECTED, retryAuthorized: false }) + '\n'); await slot.sync(); }
    finally { await slot.close(); }
    phase = 'SQL_CONNECTION'; approval();
    const observation = await sessions.withManagement({ managementDatabaseOid: '5', managementRoleOid: '16410', signal: AbortSignal.timeout(90000),
      use: async client => {
        phase = 'SQL_READ_ONLY_BEGIN'; await client.query(manifest.sql.transaction);
        phase = 'SQL_LEGACY_CATALOG'; const legacy = await client.query({ text: CATALOG_SQL, values });
        phase = 'SQL_DETAIL_CATALOG'; const detail = await client.query({ text: diagnostic.DETAIL_SQL, values });
        if (legacy.rowCount !== 1 || detail.rowCount !== 1) fail('EXPRESS_C3_ROLE_CATALOG_REJECTED');
        phase = 'PREDICATE_ANALYSIS'; const result = diagnostic.diagnose({ program, legacy: legacy.rows[0], detail: detail.rows[0], verifyReserve: verifyStage });
        phase = 'SQL_READ_ONLY_COMMIT'; await client.query('COMMIT'); return result;
      } });
    const observedAt = new Date().toISOString();
    await save('observation.json', { manifestSha256: manifest.manifestSha256, observedAt, ...observation });
    phase = 'POST_SQL_METADATA'; await readBinding(); identity(await send(sts, new GetCallerIdentityCommand({})));
    const result = { manifestSha256: manifest.manifestSha256, observedAt, outcome: observation.state, metadataCalls,
      sqlConnections, sqlCalls, slotConsumed, sqlMutationPerformed: false, awsResourceWrites: 0, runtimeEnabled: false, retryAuthorized: false };
    await save('result.json', result); process.stdout.write(JSON.stringify({ mode, directory: out, ...result }) + '\n');
  }
} catch (e) {
  const code = /^(?:EXPRESS_C3_ROLE|AURORA_V3)_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'EXPRESS_C3_ROLE_STOPPED';
  const result = { code, phase, manifestSha256: manifest?.manifestSha256 || null, metadataCalls, sqlConnections, sqlCalls,
    slotConsumed, sqlMutationPerformed: false, awsResourceWrites: 0, retryAuthorized: false, runtimeEnabled: false };
  await save('stopped.json', result); process.stderr.write(JSON.stringify({ directory: out, ...result }) + '\n'); process.exitCode = 1;
} finally { sts?.destroy(); iam?.destroy(); rds?.destroy(); }
