// C3e: exact retained tenant catalog, READ ONLY. No restore, grant, repair or
// slot reset path. Old C3d source and seven real execution receipts are frozen.
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
import diagnostic from '../../../lib/deployments/execution/aurora-express-c3-catalog-diagnostic.cjs';
import { assertDiagnosticFacts } from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
import { assertContinuationApproval } from '../../../lib/deployments/execution/aurora-express-c3-continuation-review.ts';
const root = path.resolve('F:/ChatGPT_workshop'), backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url)), cli = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), fail = code => { throw Error(code); };
const raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('EXPRESS_C3_CATALOG_ARGUMENTS_REJECTED');
for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (new Set(pairs.map(([k]) => k)).size !== pairs.length || !['Review','Run','InspectMetadata'].includes(mode) ||
  Object.keys(args).some(k => !['--mode','--manifest','--approved-sha','--output'].includes(k)) ||
  Object.values(args).some(v => typeof v !== 'string' || !v) || path.dirname(out).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-d002-express-c3-catalog-[a-z0-9-]+$/.test(path.basename(out))) fail('EXPRESS_C3_CATALOG_ARGUMENTS_REJECTED');
await mkdir(out);
const save = async (name, value) => {
  const f = await open(path.join(out,name),'wx');
  try { await f.writeFile(JSON.stringify(value,null,2)+'\n'); await f.sync(); } finally { await f.close(); }
};
const emptySlot = async () => { try { await access(path.join(root,diagnostic.SLOT)); fail('EXPRESS_C3_CATALOG_SLOT_OCCUPIED'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } };
let metadataCalls = 0, sqlConnections = 0, sqlCalls = 0, slotConsumed = false, phase = 'LOCAL_HISTORY';
let sts, iam, rds, manifest;
try {
  if (['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k => process.env[k]) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C3_CATALOG_ENV_CONFLICT');
  const original = JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3d-review-20261014-r2/manifest.json'),'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3d-run-20261014-r1/code-binding.json'),'utf8'));
  const frozenSha = '8f66777769c2cb82b507f5a1362289776d0d1a23ce8892cd0138f853dee0b3ef';
  if (frozen.pins.length !== 224 || frozen.tools.length !== 2 || db.digest({pins:frozen.pins,tools:frozen.tools}) !== frozenSha ||
    frozen.codeBindingSha256 !== frozenSha) fail('EXPRESS_C3_CATALOG_FROZEN_BINDING_REJECTED');
  assertContinuationApproval(original,diagnostic.ORIGINAL_SHA,frozenSha,Date.parse(original.preparedAt)); // integrity only
  for (const p of frozen.pins) if (hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n')) !== p.sha256)
    fail('EXPRESS_C3_CATALOG_FROZEN_CODE_DRIFT');
  for (const t of frozen.tools) if (hash(await readFile(t.filename)) !== t.sha256) fail('EXPRESS_C3_CATALOG_TOOL_DRIFT');
  const evidence = [
    ['techlong-d002-express-c3d-run-20261014-r1/stopped.json','6292606affad86c0dc131efbe116064f840bf51ba8dbd0e56631dfe46313a61f'],
    ['techlong-d002-express-c3d-run-20261014-r1/prepared.json','59d8b5af4ab581fcc26d194346eb24917d5aa21735f6c0127e0e91d671c86d0a'],
    ['techlong-d002-express-c3d-run-20261014-r1/stages.jsonl','f17f8e3f52684e2f8a5d17da16e4ceffa9b0121d976a797909e0f16d013edf4a'],
    ['techlong-d002-express-c3d-inspect-20261014-r1/result.json','a87a58c108e2c1a48da8aea81016fdbe094f79700020c19b505349b8330707c9'],
    ['techlong-d002-express-c3d-inspect-20261014-r1/schema.json','958ed32cf65662bd36d1d8299f638482f5371965dcd47e4f0a5a3c268e48e8fc'],
    ['techlong-d002-express-c3-reserved-continuation-v4.permanent-slot.json','189b354108a09b7bc368e5b67b7d9568b759911e0671c29a777b526e14a8562e'],
    ['techlong-d002-express-c3-reserved-continuation-v4-inspect.permanent-slot.json','05ca613ed663d83e8f9950cabe789b50f88ae20d1be91cadb2328d7399ec1e20']
  ];
  for (const [relative,sha256] of evidence) if (hash(await readFile(path.join(root,relative))) !== sha256) fail('EXPRESS_C3_CATALOG_HISTORY_DRIFT');
  const prepared = JSON.parse(await readFile(path.join(root,evidence[1][0]),'utf8'));
  if (prepared.databaseOid !== diagnostic.EXPECTED.database || prepared.roleOid !== diagnostic.EXPECTED.tenant ||
    prepared.state !== 'NOLOGIN_CONTINUED_NOT_RESTORED' || prepared.programSha256 !== original.continuationProgramSha256)
    fail('EXPRESS_C3_CATALOG_PREDECESSOR_REJECTED');
  const baselineBytes = await readFile(path.join(root,'techlong-empty-baseline-20261005-f2a4/empty-baseline.manifest.json'));
  if (hash(baselineBytes) !== original.sqlProgram.manifestSha256) fail('EXPRESS_C3_CATALOG_TABLE_MANIFEST_DRIFT');
  const baseline = JSON.parse(baselineBytes);
  if (!Array.isArray(baseline.tables) || baseline.tables.length !== 73 ||
    baseline.tables.some(t => t.schema !== 'public' || t.rows !== 0 || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(t.table)))
    fail('EXPRESS_C3_CATALOG_TABLES_REJECTED');
  const tables = baseline.tables.map(t => t.table).sort();
  if (new Set(tables).size !== 73) fail('EXPRESS_C3_CATALOG_TABLES_REJECTED');
  const historySha = db.digest({originalManifestSha256:diagnostic.ORIGINAL_SHA,frozenCodeSha256:frozenSha,evidence,
    baselineManifestSha256:hash(baselineBytes)});
  const pins = [...frozen.pins];
  for (const name of ['ops/aws-sandbox/scripts/review-aurora-express-c3-catalog.mjs','lib/deployments/execution/aurora-express-c3-catalog-diagnostic.cjs'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha = db.digest({pins,tools:frozen.tools});
  await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:frozen.tools,historySha256:historySha});
  const requireBackend = createRequire(path.join(backend,'package.json'));
  const continuation = requireBackend('./services/saas/aurora-express-continuation-v4.cjs');
  const {CATALOG_SQL} = requireBackend('./services/saas/aurora_express_continuation_v4');
  const {PG17_CATALOG_SQL,verifyPg17Catalog,rowCountSql} = requireBackend('./services/saas/aurora_express_restore_v3');
  const program = continuation.compileContinuationV4(original.continuationInput), binding = original.expectedBinding;
  if (continuation.digest(program) !== original.continuationProgramSha256 || hash(rowCountSql(tables)) !== original.sqlProgram.rowCountsSqlSha256)
    fail('EXPRESS_C3_CATALOG_PROGRAM_DRIFT');
  const sql = {catalogSqlSha256:hash(PG17_CATALOG_SQL),ownersSqlSha256:hash(CATALOG_SQL),
    contextSqlSha256:db.digest(diagnostic.CONTEXT_SQL),tableNamesSha256:db.digest(tables)};
  if (mode !== 'Review') {
    const filename = await realpath(args['--manifest']);
    if (path.basename(filename) !== 'manifest.json' || path.dirname(path.dirname(filename)).toLowerCase() !== root.toLowerCase() ||
      !/^techlong-d002-express-c3-catalog-/.test(path.basename(path.dirname(filename)))) fail('EXPRESS_C3_CATALOG_MANIFEST_PATH_REJECTED');
    manifest = JSON.parse(await readFile(filename,'utf8'));
    diagnostic.assertApproval(manifest,mode==='InspectMetadata'?manifest.manifestSha256:args['--approved-sha'],
      codeSha,historySha,original,sql,mode==='InspectMetadata'?Date.parse(manifest.preparedAt):Date.now());
  }
  phase = 'READ_ONLY_METADATA';
  const credentials = fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
  const config = {region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const sdk = requireBackend('@aws-sdk/client-rds');
  sts = new STSClient(config); iam = new IAMClient(config); rds = new sdk.RDSClient(config);
  const send = async (client,command) => {
    if (!['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand'].includes(command.constructor.name) ||
      ++metadataCalls > 9) fail('EXPRESS_C3_CATALOG_METADATA_BUDGET_REJECTED');
    try { return await client.send(command,{abortSignal:AbortSignal.timeout(45000)}); }
    catch (e) {
      const codes = {CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',
        AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED',TimeoutError:'METADATA_TIMEOUT',AbortError:'METADATA_CANCELLED'};
      fail('EXPRESS_C3_CATALOG_'+(codes[e.name] || 'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity = value => {
    if (value.Account !== '402010193138' || value.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      value.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C3_CATALOG_SOURCE_CHANGED');
    return {Account:value.Account,Arn:value.Arn,UserId:value.UserId};
  };
  const readBinding = async () => {
    const clusters = (await send(rds,new sdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters;
    const c = clusters?.[0];
    if (clusters?.length !== 1 || c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
      c.DBClusterMembers[0].DBInstanceIdentifier !== binding.writerIdentifier || c.MasterUsername !== 'postgres' || c.MasterUserSecret ||
      !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false || c.DeletionProtection !== false ||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration) !== db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))
      fail('EXPRESS_C3_CATALOG_RESOURCE_CHANGED');
    const instances = (await send(rds,new sdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances, i = instances?.[0];
    if (instances?.length !== 1 || i.DBClusterIdentifier !== 'techlong-sandbox-express-d001' || i.DBInstanceClass !== 'db.serverless')
      fail('EXPRESS_C3_CATALOG_WRITER_CHANGED');
    const current = {manifestSha256:binding.manifestSha256,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,
      createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,endpoint:c.Endpoint,port:c.Port,
      writerIdentifier:i.DBInstanceIdentifier,writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,
      writerCreatedAt:i.InstanceCreateTime?.toISOString(),tags:Object.fromEntries((c.TagList || []).map(t => [t.Key,t.Value])),
      clusterStatus:c.Status,writerStatus:i.DBInstanceStatus};
    if (db.canonicalJson(current) !== db.canonicalJson(binding)) fail('EXPRESS_C3_CATALOG_PHYSICAL_BINDING_CHANGED');
    return current;
  };
  const facts = async () => {
    const observedAt = new Date().toISOString(), arn = `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const [source,current,permissions,plan] = await Promise.all([send(sts,new GetCallerIdentityCommand({})).then(identity),readBinding(),
      send(iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',ActionNames:['rds-db:connect'],ResourceArns:[arn]})),
      cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
        '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:45000,maxBuffer:16384,
        env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}}).catch(e => {
          const text = String(e.stderr || ''), api = text.match(/An error occurred \(([A-Za-z0-9_-]{1,64})\)/)?.[1];
          const codes = {'502':'PLAN_HTTP_502','503':'PLAN_HTTP_503','504':'PLAN_HTTP_504',ExpiredToken:'SOURCE_TOKEN_EXPIRED',
            ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDeniedException:'PLAN_ACCESS_DENIED',TooManyRequestsException:'PLAN_THROTTLED'};
          fail('EXPRESS_C3_CATALOG_'+(codes[api] || (/expired|refresh|credentials/i.test(text)?'SOURCE_CREDENTIALS_UNAVAILABLE':'PLAN_READ_FAILED')));
        })]);
    if (++metadataCalls > 9 || permissions.EvaluationResults?.length !== 1) fail('EXPRESS_C3_CATALOG_METADATA_BUDGET_REJECTED');
    const p = permissions.EvaluationResults[0], result = {observedAt,source,binding:current,plan:JSON.parse(plan.stdout),
      connectPermission:{action:p.EvalActionName,resource:p.EvalResourceName,decision:p.EvalDecision,missingContext:p.MissingContextValues || []}};
    assertDiagnosticFacts(result,binding,Date.now()); return result;
  };
  if (mode === 'Review') {
    await emptySlot();
    manifest = diagnostic.prepareReview({facts:await facts(),original,codeBindingSha256:codeSha,historySha256:historySha,sql},Date.now());
    await save('manifest.json',manifest);
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,
      metadataCalls,sqlConnections:0,sqlMutations:0,executionAuthorized:false})+'\n');
  } else if (mode === 'InspectMetadata') {
    await save('facts.json',await facts());
    process.stdout.write(JSON.stringify({mode,directory:out,metadataCalls,sqlConnections:0,awsResourceWrites:0,
      outcome:'PHYSICAL_ONLY_TENANT_CATALOG_NOT_REOBSERVED'})+'\n');
  } else {
    const approval = () => diagnostic.assertApproval(manifest,args['--approved-sha'],codeSha,historySha,original,sql,Date.now());
    approval(); await emptySlot(); const fresh = await facts(), snapshot = await credentials();
    if (!snapshot.accessKeyId || !snapshot.secretAccessKey || !snapshot.sessionToken || !(snapshot.expiration instanceof Date) ||
      snapshot.expiration.getTime() < Date.now()+300000) fail('EXPRESS_C3_CATALOG_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const snapshotSts = new STSClient({...config,credentials:snapshot});
    try { identity(await send(snapshotSts,new GetCallerIdentityCommand({}))); } finally { snapshotSts.destroy(); }
    const {ExpressManagementSessionProviderV3,MANAGEMENT_IDENTITY_SQL} = requireBackend('./services/saas/aurora_management_sessions_v3');
    const Pg = requireBackend('pg').Client, values = [[program.target.tenantUsername,program.guardName],program.target.tenantDatabase];
    class ReadOnlyClient extends Pg {
      connect(...args) { if (++sqlConnections > 2) fail('EXPRESS_C3_CATALOG_CONNECTION_BUDGET_REJECTED'); return super.connect(...args); }
      query(query,...args) {
        approval(); const text = typeof query === 'string' ? query : query?.text;
        if (++sqlCalls > 9 || ![MANAGEMENT_IDENTITY_SQL,diagnostic.TRANSACTION,CATALOG_SQL,diagnostic.CONTEXT_SQL,PG17_CATALOG_SQL,'COMMIT'].includes(text) ||
          (text === CATALOG_SQL && db.canonicalJson(query.values) !== db.canonicalJson(values)) ||
          (text !== CATALOG_SQL && typeof query !== 'string')) fail('EXPRESS_C3_CATALOG_READ_ONLY_QUERY_REJECTED');
        return super.query(query,...args);
      }
    }
    const sessions = new ExpressManagementSessionProviderV3({target:program.target,
      dependencies:{Client:ReadOnlyClient,credentialProvider:async()=>snapshot}});
    approval(); assertDiagnosticFacts(fresh,binding,Date.now());
    const slot = await open(path.join(root,diagnostic.SLOT),'wx'); slotConsumed = true;
    try { await slot.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,consumedAt:new Date().toISOString(),
      originalManifestSha256:diagnostic.ORIGINAL_SHA,expectedOids:diagnostic.EXPECTED,retryAuthorized:false})+'\n'); await slot.sync(); }
    finally { await slot.close(); }
    phase = 'SQL_CONNECTION'; approval();
    const observation = await sessions.withPair({managementDatabaseOid:'5',managementRoleOid:'16410',tenantDatabaseOid:'16459',
      signal:AbortSignal.timeout(120000),use:async({managementClient,targetClient}) => {
        phase = 'SQL_READ_ONLY_BEGIN'; await managementClient.query(diagnostic.TRANSACTION); await targetClient.query(diagnostic.TRANSACTION);
        phase = 'SQL_OWNER_CATALOG'; const owner = await managementClient.query({text:CATALOG_SQL,values});
        const c = owner.rows?.[0];
        if (owner.rowCount !== 1 || c?.roles?.length !== 1 || c?.databases?.length !== 1) fail('EXPRESS_C3_CATALOG_OWNER_CHANGED');
        continuation.verifyStageV4(program,{app:c.roles[0],guard:null,database:c.databases[0]},'promote',
          {app:{oid:prepared.roleOid},database:{oid:prepared.databaseOid}});
        phase = 'SQL_TENANT_CONTEXT'; const context = await targetClient.query(diagnostic.CONTEXT_SQL);
        if (context.rowCount !== 1) fail('EXPRESS_C3_CATALOG_CONTEXT_REJECTED');
        phase = 'SQL_TENANT_CATALOG'; const catalog = await targetClient.query(PG17_CATALOG_SQL);
        phase = 'PREDICATE_ANALYSIS'; const result = diagnostic.diagnose({result:catalog,context:context.rows[0],tables,verifyCatalog:verifyPg17Catalog});
        phase = 'SQL_READ_ONLY_COMMIT'; await targetClient.query('COMMIT'); await managementClient.query('COMMIT');
        return {...result,databaseOid:prepared.databaseOid,roleOid:prepared.roleOid,managementCatalogSha256:db.digest(c)};
      }});
    const observedAt = new Date().toISOString();
    await save('observation.json',{manifestSha256:manifest.manifestSha256,observedAt,...observation});
    phase = 'POST_SQL_METADATA'; await readBinding(); identity(await send(sts,new GetCallerIdentityCommand({})));
    const result = {manifestSha256:manifest.manifestSha256,observedAt,outcome:observation.state,metadataCalls,sqlConnections,sqlCalls,
      slotConsumed,sqlMutationPerformed:false,awsResourceWrites:0,runtimeEnabled:false,retryAuthorized:false};
    await save('result.json',result); process.stdout.write(JSON.stringify({mode,directory:out,...result})+'\n');
  }
} catch (e) {
  const code = /^(?:EXPRESS_C3_CATALOG|AURORA_V[34])_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'EXPRESS_C3_CATALOG_STOPPED';
  const result = {code,phase,manifestSha256:manifest?.manifestSha256 || null,metadataCalls,sqlConnections,sqlCalls,slotConsumed,
    sqlMutationPerformed:false,awsResourceWrites:0,retryAuthorized:false,runtimeEnabled:false};
  await save('stopped.json',result); process.stderr.write(JSON.stringify({directory:out,...result})+'\n'); process.exitCode = 1;
} finally { sts?.destroy(); iam?.destroy(); rds?.destroy(); }
