// Local Source-only C3 bootstrap. Review = metadata + offline compilation only.
// Run/one independent SQL Inspect require the exact fresh human-reviewed SHA.
// No AWS resource writes, Secret reads, IAM grants, runtime activation or retry.
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
import { validateExistingExpressBinding, assertDiagnosticFacts } from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
import { prepareC3Review, assertC3Approval, c3AttemptSlot, c3InspectSlot } from '../../../lib/deployments/execution/aurora-express-c3-review.ts';

const root = path.resolve('F:/ChatGPT_workshop'), backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url)), cli = promisify(execFile);
const hash = data => createHash('sha256').update(data).digest('hex'), fail = code => { throw Error(code); };
const candidatePath = path.join(root, 'techlong-d002-express-c3a-candidate-input-20261014.json');
const baselineDirectory = path.join(root, 'techlong-empty-baseline-20261005-f2a4');
const pgRestorePath = path.join(root, 'techlong-pg16-20261006/portable/pgsql/bin/pg_restore.exe');
const pythonPath = 'C:/Users/VeinyYang/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const historicalFiles = [
  'techlong-f3c9l-v6-code-20261013-r1/code-binding.json', 'techlong-d001-cell-iam-20261013-r2/code-binding.json',
  'techlong-d001-business-review-20261013-r3/code-binding.json', 'techlong-d001-private-inputs-code-20261013-r1.json',
  'techlong-d001-cell-foundation-review-20261013-r1/code-binding.json', 'techlong-d002-express-c2b-run-20261014-r1/code-binding.json',
];
const raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('EXPRESS_C3_ARGUMENTS_REJECTED');
for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (new Set(pairs.map(([k]) => k)).size !== pairs.length || !['Review','Run','Inspect','InspectMetadata'].includes(mode) ||
  Object.keys(args).some(k => !['--mode','--manifest','--approved-sha','--run-directory','--output'].includes(k)) ||
  Object.values(args).some(v => typeof v !== 'string' || !v) || path.dirname(out).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-d002-express-c3-[a-z0-9-]+$/.test(path.basename(out))) fail('EXPRESS_C3_ARGUMENTS_REJECTED');
await mkdir(out); // all artifacts and attempts are new immutable directories
const save = async (name, value) => {
  const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
};
const emptySlot = async name => { try { await access(path.join(root, name)); fail('EXPRESS_C3_SLOT_OCCUPIED_INSPECT_ONLY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } };
const consume = async (name, manifest) => {
  const f = await open(path.join(root, name), 'wx');
  try { await f.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, bootstrapProgramSha256: manifest.bootstrapProgramSha256,
    sqlProgramSha256: manifest.sqlProgramSha256, consumedAt: new Date().toISOString(), retryAuthorized: false }) + '\n'); await f.sync(); }
  finally { await f.close(); }
};
let metadataCalls = 0, sqlConnections = 0, sqlCalls = 0, attemptConsumed = false, inspectionConsumed = false;
let sts, iam, rds, built, manifest, stageJournal;
try {
  if (['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k => process.env[k]) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C3_ENV_CONFLICT');
  const histories = [], oldPins = [];
  for (const relative of historicalFiles) {
    const bytes = await readFile(path.join(root, relative)), record = JSON.parse(bytes);
    histories.push({ relative, sha256: hash(bytes) });
    for (const pin of record.pins) {
      const repo = pin.repo || platform, name = pin.name || pin.file;
      if (hash((await readFile(path.resolve(repo, name), 'utf8')).replace(/\r\n/g, '\n')) !== pin.sha256)
        fail('EXPRESS_C3_HISTORICAL_CODE_DRIFT');
      oldPins.push({ repo, name, sha256: pin.sha256 });
    }
  }
  if (oldPins.length !== 183) fail('EXPRESS_C3_HISTORY_INCOMPLETE');
  const binding = validateExistingExpressBinding(JSON.parse(await readFile(path.join(root,
    'techlong-d002-express-c2b-run-20261014-r1/postconnection-binding.json'), 'utf8')));
  const diagnosis = await readFile(path.join(root, 'techlong-d002-express-c2b-run-20261014-r1/diagnostic.json'));
  if (hash(diagnosis) !== '52b8b44db1c958a28b0a0cae3e1158a1de8b39e677414aca7149c1dcc1b9b184') fail('EXPRESS_C3_DIAGNOSTIC_HISTORY_DRIFT');
  histories.push({ relative: 'C2b-diagnostic', sha256: hash(diagnosis) }, { relative: 'C2b-binding', sha256: db.digest(binding) });
  const candidateInput = JSON.parse(await readFile(candidatePath, 'utf8'));
  const requireBackend = createRequire(path.join(backend, 'package.json'));
  const bootstrap = requireBackend('./services/saas/aurora-express-bootstrap-v3.cjs');
  if (bootstrap.digest(bootstrap.compileExpressBootstrapV3(candidateInput)) !== 'b15c541f4c008db9af7c3cc6f42e126e8477b3a374ccf5e2d3cb2410c2bbb8c7')
    fail('EXPRESS_C3_CANDIDATE_CHANGED');
  histories.push({ relative: 'C3a-candidate', sha256: db.digest(candidateInput) });
  const historySha = db.digest(histories);
  const sourceFiles = [
    [platform,'ops/aws-sandbox/scripts/review-aurora-express-c3.mjs'], [platform,'lib/deployments/execution/aurora-express-c3-review.ts'],
    [platform,'lib/deployments/execution/aurora-express-bootstrap-v3.cjs'],
    ...['aurora-express-bootstrap-v3.cjs','aurora_express_bootstrap_provider_v3.js','aurora_management_sessions_v3.js',
      'aurora_express_restore_v3.js','tenant_baseline_program.js','tenant_baseline_catalog.js','tenant_baseline_restore_provider.js',
      'tenant_saas_transaction_provider.js','tenant_postgres_tools.js'].map(name => [backend,'services/saas/' + name]),
    [backend,'scripts/prepare-aurora-express-sql-v3.js'], [backend,'scripts/verify-empty-tenant-baseline-pg16.js'],
    [backend,'scripts/render_tenant_baseline_verification.py'], [backend,'scripts/tenant_baseline_schema_profile.py'],
    [backend,'db/saas_control.sql'], [backend,'db/theme_config.sql'],
  ];
  // Pin the literal relative CommonJS dependency closure as well, rather than
  // claiming a compiler/provider hash also protects its mutable helper files.
  const known = new Set(sourceFiles.filter(([repo])=>repo===backend).map(([,name])=>path.resolve(backend,name)));
  const queue = [...known].filter(name=>/\.(?:js|cjs)$/.test(name));
  for(let index=0;index<queue.length;index++){
    const filename=queue[index], text=await readFile(filename,'utf8');
    for(const match of text.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)){
      const resolved=requireBackend.resolve(path.resolve(path.dirname(filename),match[1]));
      if(!resolved.toLowerCase().startsWith(path.resolve(backend).toLowerCase()+path.sep))fail('EXPRESS_C3_DEPENDENCY_PATH_REJECTED');
      if(!known.has(resolved)){known.add(resolved);sourceFiles.push([backend,path.relative(backend,resolved)]);
        if(/\.(?:js|cjs)$/.test(resolved))queue.push(resolved);}
    }
  }
  const pins = [...oldPins];
  for (const [repo,name] of sourceFiles) pins.push({ repo,name,sha256: hash((await readFile(path.join(repo,name),'utf8')).replace(/\r\n/g,'\n')) });
  const tools = [];
  for (const filename of [pgRestorePath,pythonPath]) tools.push({ filename,sha256: hash(await readFile(filename)) });
  const codeSha = db.digest({ pins,tools });
  await save('code-binding.json', { codeBindingSha256: codeSha, pins,tools,historySha256: historySha });
  if (mode !== 'Review') {
    const file = await realpath(args['--manifest']);
    if (path.basename(file) !== 'manifest.json' || path.dirname(path.dirname(file)).toLowerCase() !== root.toLowerCase() ||
      !/^techlong-d002-express-c3-/.test(path.basename(path.dirname(file)))) fail('EXPRESS_C3_MANIFEST_PATH_REJECTED');
    manifest = JSON.parse(await readFile(file,'utf8'));
    assertC3Approval(manifest, mode === 'InspectMetadata' ? manifest.manifestSha256 : args['--approved-sha'], codeSha,
      mode === 'InspectMetadata' ? Date.parse(manifest.preparedAt) : Date.now());
    if (manifest.historySha256 !== historySha || db.canonicalJson(manifest.expectedBinding) !== db.canonicalJson(binding) ||
      db.canonicalJson(manifest.candidateInput) !== db.canonicalJson(candidateInput)) fail('EXPRESS_C3_HISTORY_CHANGED');
  }
  const { compile } = requireBackend('./scripts/prepare-aurora-express-sql-v3');
  built = await compile({ candidateInput,baselineDirectory,pgRestorePath,pythonPath,workspace: path.join(out,'compiled') });
  await save('sql-program.json', { identity: built.identity,sqlProgramSha256: db.digest(built.identity),
    bootstrapProgramSha256: bootstrap.digest(built.bootstrap), artifactCompilationOnly: true });
  if (manifest && db.canonicalJson(manifest.sqlProgram) !== db.canonicalJson(built.identity)) fail('EXPRESS_C3_COMPILED_SQL_CHANGED');
  const credentials = fromLoginCredentials({ profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true} });
  const config = { region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true };
  const sdk = requireBackend('@aws-sdk/client-rds');
  sts = new STSClient(config); iam = new IAMClient(config); rds = new sdk.RDSClient(config);
  const send = async (client,command) => {
    const limit = ['Inspect','InspectMetadata'].includes(mode) ? 9 : 18;
    if (!['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand'].includes(command.constructor.name) ||
      ++metadataCalls > limit) fail('EXPRESS_C3_METADATA_BUDGET_REJECTED');
    try { return await client.send(command,{abortSignal:AbortSignal.timeout(45000)}); }
    catch(e){
      const classes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',
        ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED',
        TimeoutError:'METADATA_TIMEOUT',AbortError:'METADATA_CANCELLED'};
      fail('EXPRESS_C3_'+(classes[e.name]||'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity = response => {
    if (response.Account !== '402010193138' || response.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      response.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C3_SOURCE_CHANGED');
    return { Account:response.Account,Arn:response.Arn,UserId:response.UserId };
  };
  const readBinding = async () => {
    const values = (await send(rds,new sdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters;
    const c = values?.[0];
    if (values?.length !== 1 || c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
      c.DBClusterMembers[0].DBInstanceIdentifier !== binding.writerIdentifier || c.MasterUsername !== 'postgres' || c.MasterUserSecret ||
      !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false || c.DeletionProtection !== false ||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration) !== db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))
      fail('EXPRESS_C3_RESOURCE_CHANGED');
    const instances = (await send(rds,new sdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances, i = instances?.[0];
    if (instances?.length !== 1 || i.DBClusterIdentifier !== 'techlong-sandbox-express-d001' || i.DBInstanceClass !== 'db.serverless') fail('EXPRESS_C3_WRITER_CHANGED');
    const current = validateExistingExpressBinding({manifestSha256:binding.manifestSha256,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,
      createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,
      writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    if (db.canonicalJson(current) !== db.canonicalJson(binding)) fail('EXPRESS_C3_PHYSICAL_BINDING_CHANGED');
    return current;
  };
  const facts = async () => {
    const observedAt = new Date().toISOString(), arn = `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const [source,current,permissions,plan] = await Promise.all([send(sts,new GetCallerIdentityCommand({})).then(identity),readBinding(),
      send(iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',ActionNames:['rds-db:connect'],ResourceArns:[arn]})),
      cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
        '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:45000,maxBuffer:16384,
        env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}})]);
    metadataCalls++;
    if (permissions.EvaluationResults?.length !== 1) fail('EXPRESS_C3_CONNECT_SIMULATION_AMBIGUOUS');
    const p = permissions.EvaluationResults[0], f = {observedAt,source,binding:current,plan:JSON.parse(plan.stdout),
      connectPermission:{action:p.EvalActionName,resource:p.EvalResourceName,decision:p.EvalDecision,missingContext:p.MissingContextValues||[]}};
    assertDiagnosticFacts(f,binding,Date.now()); return f;
  };
  if (mode === 'Review') {
    await emptySlot(c3AttemptSlot); await emptySlot(c3InspectSlot);
    const fresh = await facts(); manifest = prepareC3Review({facts:fresh,expectedBinding:binding,candidateInput,sqlProgram:built.identity,
      codeBindingSha256:codeSha,historySha256:historySha},Date.now());
    await save('manifest.json',manifest);
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,
      limits:manifest.limits,metadataCalls,sqlConnections:0,awsResourceWrites:0,executionAuthorized:false})+'\n');
  } else if (mode === 'InspectMetadata') {
    await save('facts.json',await facts());
    process.stdout.write(JSON.stringify({mode,directory:out,metadataCalls,sqlConnections:0,awsResourceWrites:0,
      outcome:'PHYSICAL_ONLY_SQL_NOT_PROVED'})+'\n');
  } else {
    const approval = () => assertC3Approval(manifest,args['--approved-sha'],codeSha,Date.now());
    approval(); await emptySlot(mode === 'Run' ? c3AttemptSlot : c3InspectSlot);
    const fresh = await facts(), snapshot = await credentials();
    if (!snapshot.accessKeyId || !snapshot.secretAccessKey || !snapshot.sessionToken || !(snapshot.expiration instanceof Date) ||
      snapshot.expiration.getTime() < Date.now()+300000) fail('EXPRESS_C3_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const snapshotSts = new STSClient({...config,credentials:snapshot});
    try { identity(await send(snapshotSts,new GetCallerIdentityCommand({}))); } finally { snapshotSts.destroy(); }
    const { ExpressManagementSessionProviderV3 } = requireBackend('./services/saas/aurora_management_sessions_v3');
    const Pg = requireBackend('pg').Client;
    class BudgetClient extends Pg {
      connect(...values) { if (++sqlConnections > (mode==='Run'?3:2)) fail('EXPRESS_C3_CONNECTION_BUDGET_REJECTED'); return super.connect(...values); }
      query(...values) { if (++sqlCalls > 64) fail('EXPRESS_C3_SQL_CALL_BUDGET_REJECTED'); return super.query(...values); }
    }
    const sessions = new ExpressManagementSessionProviderV3({target:built.bootstrap.target,
      dependencies:{Client:BudgetClient,credentialProvider:async()=>snapshot}});
    const signal = AbortSignal.timeout(mode==='Run'?270000:135000), common = {sessions,managementDatabaseOid:'5',managementRoleOid:'16410',signal};
    stageJournal = await open(path.join(out,'stages.jsonl'),'wx');
    const append = async frame => { await stageJournal.writeFile(JSON.stringify({at:new Date().toISOString(),...frame})+'\n'); await stageJournal.sync(); };
    const journal = {beforeStage:async frame=>{approval();await append({kind:'INTENT',...frame});},
      stageObserved:async frame=>{await append({kind:'OBSERVED',...frame});}};
    let prepared, schema;
    if (mode === 'Run') {
      approval(); assertDiagnosticFacts(fresh,binding,Date.now());
      await consume(c3AttemptSlot,manifest); attemptConsumed=true; approval();
      const { PostgresExpressBootstrapProviderV3 } = requireBackend('./services/saas/aurora_express_bootstrap_provider_v3');
      prepared = await new PostgresExpressBootstrapProviderV3(built.bootstrap).prepare({...common,journal});
      await save('prepared.json',prepared); await readBinding(); identity(await send(sts,new GetCallerIdentityCommand({})));
      approval(); if(snapshot.expiration.getTime()<Date.now()+120000)fail('EXPRESS_C3_CREDENTIAL_SNAPSHOT_TOO_SHORT');
      schema = await built.provider.apply({...common,prepared,journal});
    } else {
      const runDir = await realpath(args['--run-directory']);
      if(path.dirname(runDir).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c3-/.test(path.basename(runDir)))fail('EXPRESS_C3_RUN_PATH_REJECTED');
      const slot = JSON.parse(await readFile(path.join(root,c3AttemptSlot),'utf8'));
      let result;
      try { result = JSON.parse(await readFile(path.join(runDir,'result.json'),'utf8')); }
      catch(e) { if(e.code!=='ENOENT')throw e; }
      if(slot.manifestSha256!==manifest.manifestSha256||slot.bootstrapProgramSha256!==manifest.bootstrapProgramSha256||
        slot.sqlProgramSha256!==manifest.sqlProgramSha256)fail('EXPRESS_C3_RUN_SLOT_CHANGED');
      approval();assertDiagnosticFacts(fresh,binding,Date.now());
      await consume(c3InspectSlot,manifest);inspectionConsumed=true;
      if(result){
        if(result.manifestSha256!==manifest.manifestSha256||result.outcome!=='SCHEMA_AND_MIGRATION_OBSERVED_NOT_RUNTIME_VERIFIED')
          fail('EXPRESS_C3_COMMITTED_RUN_REQUIRED');
        prepared = JSON.parse(await readFile(path.join(runDir,'prepared.json'),'utf8'));
        schema = await built.provider.apply({...common,prepared,inspectOnly:true});
        if(schema.catalog.catalogSha256!==result.schema.catalog.catalogSha256||schema.sqlProgramSha256!==result.schema.sqlProgramSha256)
          fail('EXPRESS_C3_INDEPENDENT_SCHEMA_CHANGED');
      } else {
        const stopped = JSON.parse(await readFile(path.join(runDir,'stopped.json'),'utf8'));
        if(stopped.attemptConsumed!==true||stopped.manifestSha256!==manifest.manifestSha256)fail('EXPRESS_C3_STOPPED_RUN_REQUIRED');
        // Failed run: only exact role/database metadata, not replay/restore or
        // a claim of schema absence. Unknown comments are hashed, not printed.
        const {CATALOG_SQL} = requireBackend('./services/saas/aurora_express_bootstrap_provider_v3');
        schema = await sessions.withManagement({...common,use:async client=>{
          await client.query('BEGIN READ ONLY');
          const r = await client.query({text:CATALOG_SQL,values:[[built.bootstrap.target.tenantUsername,built.bootstrap.guardName],built.bootstrap.target.tenantDatabase]});
          signal.throwIfAborted();
          const c = r.rows?.[0];
          if(r.rowCount!==1||!Array.isArray(c?.roles)||c.roles.length>2||!Array.isArray(c.databases)||c.databases.length>1||db.canonicalJson(c).length>65536)
            fail('EXPRESS_C3_PARTIAL_CATALOG_REJECTED');
          await client.query('COMMIT');
          return {state:'PARTIAL_BOOTSTRAP_CATALOG_OBSERVED_NOT_SCHEMA_VERIFIED',catalogSha256:db.digest(c),
            roles:c.roles.map(v=>({oid:v.oid,isTenant:v.name===built.bootstrap.target.tenantUsername,isGuard:v.name===built.bootstrap.guardName,
              login:v.login,expectedOwnershipComment:v.comment===built.bootstrap.comments[v.name===built.bootstrap.guardName?'guard':'role']})),
            databases:c.databases.map(v=>({oid:v.oid,ownerOid:v.ownerOid,connect:v.connect,
              expectedOwnershipComment:v.comment===built.bootstrap.comments.database})),
            sqlMutationPerformed:false,retryAuthorized:false,runtimeEnabled:false,lifecycleCompatible:false};
        }});
      }
    }
    await save('schema.json',schema); await readBinding(); identity(await send(sts,new GetCallerIdentityCommand({})));
    const result = {manifestSha256:manifest.manifestSha256,outcome:schema.state,schema,metadataCalls,sqlConnections,sqlCalls,
      attemptConsumed,inspectionConsumed,awsResourceWrites:0,mutationPerformed:mode==='Run',retryAuthorized:false,runtimeEnabled:false};
    await save('result.json',result);
    process.stdout.write(JSON.stringify({mode,directory:out,outcome:result.outcome,metadataCalls,sqlConnections,sqlCalls,
      mutationPerformed:result.mutationPerformed,runtimeEnabled:false,retryAuthorized:false})+'\n');
  }
} catch(e) {
  const code = /^(?:EXPRESS_C3|AURORA_V3)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'EXPRESS_C3_STOPPED_INSPECT_REQUIRED';
  await save('stopped.json',{code,manifestSha256:manifest?.manifestSha256||null,metadataCalls,sqlConnections,sqlCalls,attemptConsumed,inspectionConsumed,
    sqlEffectsMayHaveOccurred:attemptConsumed&&sqlCalls>0,awsResourceWrites:0,retryAuthorized:false,runtimeEnabled:false});
  process.stderr.write(JSON.stringify({code,directory:out,metadataCalls,sqlConnections,sqlCalls,attemptConsumed,inspectionConsumed,
    retryAuthorized:false})+'\n');process.exitCode=1;
} finally { await stageJournal?.close();sts?.destroy();iam?.destroy();rds?.destroy(); }
