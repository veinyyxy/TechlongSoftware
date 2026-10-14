// C3g Source-only restore into exact retained DB16459. No prepare/role/DB creation.
// Review compiles the original archive locally and reads metadata only.
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
import { assertContinuationApproval } from '../../../lib/deployments/execution/aurora-express-c3-continuation-review.ts';
import review from '../../../lib/deployments/execution/aurora-express-c3g-restore-review.cjs';
import capture from '../../../lib/deployments/execution/aurora-express-c3g-restore-capture.cjs';
import frozenRestoreReview from '../../../lib/deployments/execution/aurora-express-c3-restore-review.cjs';
import diagnostic from '../../../lib/deployments/execution/aurora-express-c3-catalog-diagnostic.cjs';
const c3AttemptSlot=review.RUN_SLOT,c3InspectSlot=review.INSPECT_SLOT;

const root = path.resolve('F:/ChatGPT_workshop'), backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url)), cli = promisify(execFile);
const hash = data => createHash('sha256').update(data).digest('hex'), fail = code => { throw Error(code); };
const baselineDirectory = path.join(root, 'techlong-empty-baseline-20261005-f2a4');
const pgRestorePath = path.join(root, 'techlong-pg16-20261006/portable/pgsql/bin/pg_restore.exe');
const pythonPath = 'C:/Users/VeinyYang/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('EXPRESS_C3G_ARGUMENTS_REJECTED');
for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (new Set(pairs.map(([k]) => k)).size !== pairs.length || !['Review','Run','Inspect','InspectMetadata'].includes(mode) ||
  Object.keys(args).some(k => !['--mode','--manifest','--approved-sha','--run-directory','--output'].includes(k)) ||
  Object.values(args).some(v => typeof v !== 'string' || !v) || path.dirname(out).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-d002-express-c3g-[a-z0-9-]+$/.test(path.basename(out))) fail('EXPRESS_C3G_ARGUMENTS_REJECTED');
await mkdir(out); // all artifacts and attempts are new immutable directories
const save = async (name, value) => {
  const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
};
const emptySlot = async name => { try { await access(path.join(root, name)); fail('EXPRESS_C3G_SLOT_OCCUPIED_INSPECT_ONLY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } };
const consume = async (name, manifest) => {
  const f = await open(path.join(root, name), 'wx');
  if(name===c3AttemptSlot)attemptConsumed=true;else inspectionConsumed=true;
  try { await f.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, continuationProgramSha256: manifest.continuationProgramSha256,
    sqlProgramSha256: manifest.sqlProgramSha256, consumedAt: new Date().toISOString(), retryAuthorized: false }) + '\n'); await f.sync(); }
  finally { await f.close(); }
};
let metadataCalls = 0, sqlConnections = 0, sqlCalls = 0, attemptConsumed = false, inspectionConsumed = false, schemaWriteSubmitted=false;
let sts, iam, rds, built, manifest, stageJournal;
try {
  if (['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k => process.env[k]) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C3G_ENV_CONFLICT');
  const originalD=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3d-review-20261014-r2/manifest.json'),'utf8'));
  const originalE=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3-catalog-review-20261014-r2/manifest.json'),'utf8'));
  const frozen=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3f-run-20261014-r1/code-binding.json'),'utf8'));
  const frozenSha='277ae66e812dde07027ab9391dc21c98469e54b6bef5968cf8a3123e370e4239';
  if(frozen.pins.length!==229||frozen.tools.length!==2||db.digest({pins:frozen.pins,tools:frozen.tools})!==frozenSha||
    frozen.codeBindingSha256!==frozenSha)fail('EXPRESS_C3G_FROZEN_CODE_REJECTED');
  assertContinuationApproval(originalD,'87c5995ea79c8e7218e33bdc76bc5c98618cd2d486b77319b290d3ce5a26599f',
    '8f66777769c2cb82b507f5a1362289776d0d1a23ce8892cd0138f853dee0b3ef',Date.parse(originalD.preparedAt));
  diagnostic.assertApproval(originalE,review.DIAGNOSTIC_SHA,'91a2c8e1ce994e607a709ac90b2a827f0bd6cb9cfcba67e6eff5f84b527d38db',
    '783a896da1af5d3379c33c93e5fb776a1913a6ff66b2e840d121dafeae0b1b96',originalD,originalE.sql,Date.parse(originalE.preparedAt));
  const changedWorkflow='.github/workflows/backend-image-candidate.yml';
  const historicalWorkflow=(await cli('git',['show','7648f07eda3dd44d128e365733e25a0b76abdb27:'+changedWorkflow],
    {cwd:backend,windowsHide:true,maxBuffer:100000})).stdout;
  if(frozen.pins.filter(p=>p.repo===backend&&p.name===changedWorkflow).length!==1)fail('EXPRESS_C3G_WORKFLOW_PIN_REJECTED');
  for(const p of frozen.pins) {
    const current=p.repo===backend&&p.name===changedWorkflow?historicalWorkflow:await readFile(path.join(p.repo,p.name),'utf8');
    if(hash(current.replace(/\r\n/g,'\n'))!==p.sha256)fail('EXPRESS_C3G_FROZEN_CODE_DRIFT');
  }
  const originalF=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3f-review-20261014-r3/manifest.json'),'utf8'));
  frozenRestoreReview.assertApproval(originalF,review.PREDECESSOR_SHA,frozenSha,
    'da9bb6d8a78c1c6f65f35ce83eba971ed0bf5181878b97c334c960bb2752ce8c',originalD,originalE,Date.parse(originalF.preparedAt));
  for(const t of frozen.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('EXPRESS_C3G_TOOL_DRIFT');
  const evidence=[
    ['techlong-d002-express-c3d-run-20261014-r1/prepared.json','59d8b5af4ab581fcc26d194346eb24917d5aa21735f6c0127e0e91d671c86d0a'],
    ['techlong-d002-express-c3-catalog-run-20261014-r2/observation.json','8bd2d3b35f7f490f991124c8136c5429a7388c02c2b4c1174fdb17ae91da6329'],
    ['techlong-d002-express-c3-catalog-run-20261014-r2/result.json','a386f78167778f388fda4f663572b179f0b88ae3ff88b727427a6bae8379a4af'],
    ['techlong-d002-express-c3-pg17-catalog-diagnostic-v1.permanent-slot.json','30a48f9e71e0ee87c803b6b02275ccf9685d01b604a49710900c236fcd564a59'],
    ['techlong-d002-express-c3-catalog-run-20261014-r1/stopped.json','f98307951c03c5c571935a78b1abe0d990d5824f6988e2ca718b1a5b3e6d6c3c'],
    ['techlong-d002-express-c3f-review-20261014-r3/manifest.json','e40a8f2ea74eafe505519b38791cd7c5b6843842adf74472c23c9ab51a94b38b'],
    ['techlong-d002-express-c3f-run-20261014-r1/stopped.json','66be39eece50db5d1eef3dbac383a2530b14aae9826ff08357ea6a7ee5a9433d'],
    ['techlong-d002-express-c3f-run-20261014-r1/stages.jsonl','d25d9353413a30d529aa61752c38c8ad2ff8912b4b49976f2c9dc7435fdaec60'],
    ['techlong-d002-express-c3f-run-20261014-r1/catalog-baseline-before-verifier.json','f19b0f2c4a1c7698de9b39e579e70358d114a280e3896eb17e2c0df0aee1ade2'],
    ['techlong-d002-express-c3f-inspect-20261014-r1/result.json','57b9cd516b03c504a05fb7d7d156799e544876e2629ffa23bc405206637d2f87'],
    ['techlong-d002-express-c3f-inspect-20261014-r1/catalog-independent-after-stop.json','dea8c3648980b1efc26eee72c5b1412246573d698f26c19606ca3459104a4f35'],
    ['techlong-d002-express-c3-restore-only-v4.permanent-slot.json','1c16f85522fe03296b9ccbb158e38fd6abe1c1296b42305819cd7b2cb2e6ec27'],
    ['techlong-d002-express-c3-restore-only-v4-inspect.permanent-slot.json','45dd8906255f9f6f068c3aaa7a3368a6d72c66e4d1560914427e4bb2d77b23d5']
  ];
  for(const [relative,sha256]of evidence)if(hash(await readFile(path.join(root,relative)))!==sha256)fail('EXPRESS_C3G_HISTORY_DRIFT');
  const preparedProof=JSON.parse(await readFile(path.join(root,evidence[0][0]),'utf8'));
  const observedProof=JSON.parse(await readFile(path.join(root,evidence[1][0]),'utf8'));
  if(preparedProof.databaseOid!=='16459'||preparedProof.roleOid!=='16456'||preparedProof.programSha256!==originalD.continuationProgramSha256||
    observedProof.databaseOid!=='16459'||observedProof.roleOid!=='16456'||observedProof.catalogSha256!==review.EMPTY_CATALOG_SHA||
    observedProof.allUserObjectsEmptyNow!==true||observedProof.managementCatalogSha256!=='30c1559c488e1885d59a4c897f3966450fff28a943637f0887133faecf582553')
    fail('EXPRESS_C3G_PROOF_REJECTED');
  const priorStopped=JSON.parse(await readFile(path.join(root,evidence[6][0]),'utf8'));
  const priorBaseline=JSON.parse(await readFile(path.join(root,evidence[8][0]),'utf8'));
  const priorInspect=JSON.parse(await readFile(path.join(root,evidence[9][0]),'utf8'));
  if(priorStopped.manifestSha256!==review.PREDECESSOR_SHA||priorStopped.attemptConsumed!==true||
    priorBaseline.catalogSha256!=='868ca1351fc83ae6d202dfc1539345c63b39c21e82c0194bef402b7b3f9e223e'||
    db.canonicalJson(priorBaseline.rejectedPredicates)!=='["uuid_extension_version_schema_owner"]'||
    priorBaseline.extensions?.length!==1||priorBaseline.extensions[0].owner.value!=='rdsadmin'||
    !priorBaseline.extensions[0].versionMatches||!priorBaseline.extensions[0].schemaMatches||
    priorInspect.manifestSha256!==review.PREDECESSOR_SHA||priorInspect.inspectionConsumed!==true||
    priorInspect.schema.catalogReport.catalogSha256!==review.EMPTY_CATALOG_SHA||priorInspect.schema.catalogReport.allUserObjectsEmpty!==true)
    fail('EXPRESS_C3G_PREDECESSOR_OBSERVATION_REJECTED');
  const requireBackend=createRequire(path.join(backend,'package.json'));
  const bootstrap=requireBackend('./services/saas/aurora-express-continuation-v4.cjs');
  const continuationInput=originalD.continuationInput,binding=validateExistingExpressBinding(originalD.expectedBinding);
  const historySha=db.digest({evidence,diagnosticManifestSha256:review.DIAGNOSTIC_SHA,frozenCodeSha256:frozenSha,emptyCatalogSha256:review.EMPTY_CATALOG_SHA,predecessorRestoreManifestSha256:review.PREDECESSOR_SHA});
  const pins=frozen.pins.map(p=>({...p})),tools=frozen.tools;
  const workflowPin=pins.find(p=>p.repo===backend&&p.name===changedWorkflow);
  workflowPin.sha256=hash((await readFile(path.join(backend,changedWorkflow),'utf8')).replace(/\r\n/g,'\n'));
  for(const name of ['ops/aws-sandbox/scripts/review-aurora-express-c3g-restore.mjs',
    'lib/deployments/execution/aurora-express-c3g-restore-review.cjs','lib/deployments/execution/aurora-express-c3g-restore-capture.cjs'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  for(const name of ['services/saas/aurora-pg17-catalog-policy-v5.cjs','services/saas/aurora_express_restore_v5.js',
    'scripts/prepare-aurora-express-sql-v5.js','services/saas/aurora-express-restore-v5-check.cjs'])
    pins.push({repo:backend,name,sha256:hash((await readFile(path.join(backend,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha=db.digest({pins,tools});
  await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools,historySha256:historySha});
  const prepareC3Review=(input,now)=>review.prepareReview({...input,originalD,originalE},now);
  const assertC3Approval=(r,sha,code,now)=>review.assertApproval(r,sha,code,historySha,originalD,originalE,now);
  if(mode!=='Review'){
    const file=await realpath(args['--manifest']);
    if(path.basename(file)!=='manifest.json'||path.dirname(path.dirname(file)).toLowerCase()!==root.toLowerCase()||
      !/^techlong-d002-express-c3g-/.test(path.basename(path.dirname(file))))fail('EXPRESS_C3G_MANIFEST_PATH_REJECTED');
    manifest=JSON.parse(await readFile(file,'utf8'));
    assertC3Approval(manifest,mode==='InspectMetadata'?manifest.manifestSha256:args['--approved-sha'],codeSha,
      mode==='InspectMetadata'?Date.parse(manifest.preparedAt):Date.now());
  }
  const {compile}=requireBackend('./scripts/prepare-aurora-express-sql-v5');
  built=await compile({continuationInput,baselineDirectory,pgRestorePath,pythonPath,workspace:path.join(out,'compiled')});
  await save('sql-program.json',{identity:built.identity,sqlProgramSha256:db.digest(built.identity),
    continuationProgramSha256:bootstrap.digest(built.bootstrap),artifactCompilationOnly:true});
  if(db.digest(built.identity)!==review.assertSqlProgram(built.identity,originalD)||bootstrap.digest(built.bootstrap)!==originalD.continuationProgramSha256||
    manifest&&db.canonicalJson(manifest.sqlProgram)!==db.canonicalJson(built.identity))fail('EXPRESS_C3G_COMPILED_SQL_CHANGED');
  const credentials = fromLoginCredentials({ profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true} });
  const config = { region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true };
  const sdk = requireBackend('@aws-sdk/client-rds');
  sts = new STSClient(config); iam = new IAMClient(config); rds = new sdk.RDSClient(config);
  const send = async (client,command) => {
    const limit = 9;
    if (!['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand'].includes(command.constructor.name) ||
      ++metadataCalls > limit) fail('EXPRESS_C3G_METADATA_BUDGET_REJECTED');
    try { return await client.send(command,{abortSignal:AbortSignal.timeout(45000)}); }
    catch(e){
      const classes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',
        ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED',
        TimeoutError:'METADATA_TIMEOUT',AbortError:'METADATA_CANCELLED'};
      fail('EXPRESS_C3G_'+(classes[e.name]||'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity = response => {
    if (response.Account !== '402010193138' || response.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      response.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C3G_SOURCE_CHANGED');
    return { Account:response.Account,Arn:response.Arn,UserId:response.UserId };
  };
  const readBinding = async () => {
    const values = (await send(rds,new sdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters;
    const c = values?.[0];
    if (values?.length !== 1 || c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
      c.DBClusterMembers[0].DBInstanceIdentifier !== binding.writerIdentifier || c.MasterUsername !== 'postgres' || c.MasterUserSecret ||
      !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false || c.DeletionProtection !== false ||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration) !== db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))
      fail('EXPRESS_C3G_RESOURCE_CHANGED');
    const instances = (await send(rds,new sdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances, i = instances?.[0];
    if (instances?.length !== 1 || i.DBClusterIdentifier !== 'techlong-sandbox-express-d001' || i.DBInstanceClass !== 'db.serverless') fail('EXPRESS_C3G_WRITER_CHANGED');
    const current = validateExistingExpressBinding({manifestSha256:binding.manifestSha256,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,
      createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,
      writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    if (db.canonicalJson(current) !== db.canonicalJson(binding)) fail('EXPRESS_C3G_PHYSICAL_BINDING_CHANGED');
    return current;
  };
  const facts = async () => {
    const observedAt = new Date().toISOString(), arn = `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const [source,current,permissions,plan] = await Promise.all([send(sts,new GetCallerIdentityCommand({})).then(identity),readBinding(),
      send(iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',ActionNames:['rds-db:connect'],ResourceArns:[arn]})),
      cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
        '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:45000,maxBuffer:16384,
        env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}}).catch(e=>{
          const text=String(e.stderr||''),api=text.match(/An error occurred \(([A-Za-z0-9_-]{1,64})\)/)?.[1];
          const codes={'502':'PLAN_HTTP_502','503':'PLAN_HTTP_503','504':'PLAN_HTTP_504',ExpiredToken:'SOURCE_TOKEN_EXPIRED',
            ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDeniedException:'PLAN_ACCESS_DENIED',TooManyRequestsException:'PLAN_THROTTLED'};
          fail('EXPRESS_C3G_'+(codes[api]||(/expired|refresh|credentials/i.test(text)?'SOURCE_CREDENTIALS_UNAVAILABLE':'PLAN_READ_FAILED')));
        })]);
    if(++metadataCalls>9)fail('EXPRESS_C3G_METADATA_BUDGET_REJECTED');
    if (permissions.EvaluationResults?.length !== 1) fail('EXPRESS_C3G_CONNECT_SIMULATION_AMBIGUOUS');
    const p = permissions.EvaluationResults[0], f = {observedAt,source,binding:current,plan:JSON.parse(plan.stdout),
      connectPermission:{action:p.EvalActionName,resource:p.EvalResourceName,decision:p.EvalDecision,missingContext:p.MissingContextValues||[]}};
    assertDiagnosticFacts(f,binding,Date.now()); return f;
  };
  if (mode === 'Review') {
    await emptySlot(c3AttemptSlot); await emptySlot(c3InspectSlot);
    const fresh = await facts(); manifest = prepareC3Review({facts:fresh,expectedBinding:binding,continuationInput,sqlProgram:built.identity,
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
      snapshot.expiration.getTime() < Date.now()+300000) fail('EXPRESS_C3G_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const snapshotSts = new STSClient({...config,credentials:snapshot});
    try { identity(await send(snapshotSts,new GetCallerIdentityCommand({}))); } finally { snapshotSts.destroy(); }
    let inspectionRunResult=null,inspectionRunDir=null,failedInspection=false;
    if(mode==='Inspect'){
      inspectionRunDir=await realpath(args['--run-directory']);
      if(path.dirname(inspectionRunDir).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c3g-/.test(path.basename(inspectionRunDir)))
        fail('EXPRESS_C3G_RUN_PATH_REJECTED');
      try{inspectionRunResult=JSON.parse(await readFile(path.join(inspectionRunDir,'result.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      failedInspection=!inspectionRunResult;
    }
    stageJournal=await open(path.join(out,'stages.jsonl'),'wx');
    const append=async frame=>{await stageJournal.writeFile(JSON.stringify({at:new Date().toISOString(),...frame})+'\n');await stageJournal.sync();};
    const saveReport=async report=>{approval();await append({kind:'CATALOG_OBSERVED',...report});await save('catalog-'+report.phase+'.json',report);};
    const journal={beforeStage:async frame=>{approval();await append({kind:'INTENT',...frame});},
      stageObserved:async frame=>{await append({kind:'OBSERVED',...frame});},stageFailed:async frame=>{await append({kind:'FAILED',...frame});}};
    const {ExpressManagementSessionProviderV3,MANAGEMENT_IDENTITY_SQL}=requireBackend('./services/saas/aurora_management_sessions_v3');
    const {CATALOG_SQL:OWNERS_SQL}=requireBackend('./services/saas/aurora_express_continuation_v4');
    const {PG17_CATALOG_SQL,verifyPg17Catalog,rowCountSql}=requireBackend('./services/saas/aurora_express_restore_v5');
    const {verifyPg17Catalog:frozenVerify}=requireBackend('./services/saas/aurora_express_restore_v3');
    const {EMPTY_SQL}=requireBackend('./services/saas/tenant_baseline_restore_provider');
    const {loadSaasPrograms}=requireBackend('./services/saas/tenant_saas_transaction_provider');
    const migrationSql=loadSaasPrograms().map(v=>v.sql);
    const ownerValues=[[built.bootstrap.target.tenantUsername,built.bootstrap.guardName],built.bootstrap.target.tenantDatabase];
    const lockKey=bootstrap.canonical({schema:'techlong/express-bootstrap-lock/v3',stableIdentity:built.bootstrap.target.stableIdentity,generation:1});
    const lockSql='SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS locked';
    const unlockSql='SELECT pg_advisory_unlock(hashtextextended($1::text,0)) AS unlocked';
    const rowsSql=rowCountSql(built.baseline.tables),sizeSql='SELECT pg_database_size(current_database())::text AS bytes';
    const instanceSql='SELECT singleton_key, external_instance_id, external_operation_epoch, provisioned_at FROM public.saas_instances';
    const entitlementSql='SELECT e.entitlement_key,e.entitlement_value,e.value_type,e.source,e.updated_by\n            FROM public.saas_entitlements e JOIN public.saas_instances i USING(instance_id) WHERE i.singleton_key=TRUE ORDER BY e.entitlement_key';
    const programs={empty:EMPTY_SQL,catalog:PG17_CATALOG_SQL,restore:built.baseline.restoreSql,verification:built.baseline.verificationSql,rows:rowsSql,migrations:migrationSql};
    const managerSql=new Set([MANAGEMENT_IDENTITY_SQL,OWNERS_SQL,lockSql,unlockSql,'SELECT 1',
      ...(failedInspection?[diagnostic.TRANSACTION,'COMMIT']:[])]);
    const tenantSql=new Set([MANAGEMENT_IDENTITY_SQL,PG17_CATALOG_SQL,
      ...(failedInspection?[diagnostic.TRANSACTION,diagnostic.CONTEXT_SQL,'COMMIT']:
        ['SET LOCAL search_path = pg_catalog',rowsSql,instanceSql,entitlementSql,sizeSql,'COMMIT',mode==='Run'?'BEGIN':'BEGIN READ ONLY',
          ...(mode==='Run'?[EMPTY_SQL,built.baseline.restoreSql,built.baseline.verificationSql,'SET LOCAL search_path = pg_catalog, public',...migrationSql]:[])])]);
    const Pg=requireBackend('pg').Client;
    class BudgetClient extends Pg{
      constructor(options){
        super(options);
        if(options.user!=='postgres'||![built.bootstrap.target.managementDatabase,built.bootstrap.target.tenantDatabase].includes(options.database))
          fail('EXPRESS_C3G_CLIENT_SCOPE_REJECTED');
        this.tenant=options.database===built.bootstrap.target.tenantDatabase;
        const nativeQuery=(query,...rest)=>{
          approval();const text=typeof query==='string'?query:query?.text;
          if(rest.length||++sqlCalls>40||!(this.tenant?tenantSql:managerSql).has(text))fail('EXPRESS_C3G_QUERY_SCOPE_REJECTED');
          if([OWNERS_SQL,lockSql,unlockSql].includes(text)){
            const expected=text===OWNERS_SQL?ownerValues:[lockKey];
            if(typeof query!=='object'||db.canonicalJson(query.values)!==db.canonicalJson(expected))fail('EXPRESS_C3G_QUERY_PARAMETERS_REJECTED');
          }else if(typeof query!=='string')fail('EXPRESS_C3G_QUERY_PARAMETERS_REJECTED');
          if(text===built.baseline.restoreSql)schemaWriteSubmitted=true;
          return super.query(query);
        };
        this.controlledQuery=this.tenant&&!failedInspection?capture.createCaptureQuery({nativeQuery,approval,programs,
          tables:built.baseline.tables,verifyCatalog:verifyPg17Catalog,frozenVerify,saveReport,inspectOnly:mode==='Inspect'}):nativeQuery;
      }
      connect(...args){if(++sqlConnections>2)fail('EXPRESS_C3G_CONNECTION_BUDGET_REJECTED');return super.connect(...args);}
      query(...args){return this.controlledQuery(...args);}
    }
    const sessions=new ExpressManagementSessionProviderV3({target:built.bootstrap.target,
      dependencies:{Client:BudgetClient,credentialProvider:async()=>snapshot}});
    const signal=AbortSignal.timeout(135000),common={sessions,managementDatabaseOid:'5',managementRoleOid:'16410',signal};
    let prepared, schema;
    if(mode==='Run'){
      approval();assertDiagnosticFacts(fresh,binding,Date.now());
      await consume(c3AttemptSlot,manifest);approval();
      prepared=preparedProof;await save('prepared.json',prepared);
      schema=await built.provider.apply({...common,prepared,journal});
    }else{
      const slot=JSON.parse(await readFile(path.join(root,c3AttemptSlot),'utf8'));
      if(slot.manifestSha256!==manifest.manifestSha256||slot.continuationProgramSha256!==manifest.continuationProgramSha256||
        slot.sqlProgramSha256!==manifest.sqlProgramSha256)fail('EXPRESS_C3G_RUN_SLOT_CHANGED');
      if(!inspectionRunResult){
        const stopped=JSON.parse(await readFile(path.join(inspectionRunDir,'stopped.json'),'utf8'));
        if(stopped.attemptConsumed!==true||stopped.manifestSha256!==manifest.manifestSha256)fail('EXPRESS_C3G_STOPPED_RUN_REQUIRED');
      }else if(inspectionRunResult.manifestSha256!==manifest.manifestSha256||inspectionRunResult.outcome!=='SCHEMA_AND_MIGRATION_OBSERVED_NOT_RUNTIME_VERIFIED')
        fail('EXPRESS_C3G_COMMITTED_RUN_REQUIRED');
      approval();assertDiagnosticFacts(fresh,binding,Date.now());await consume(c3InspectSlot,manifest);approval();
      prepared=preparedProof;
      if(inspectionRunResult){
        schema=await built.provider.apply({...common,prepared,inspectOnly:true});
        if(schema.catalog.catalogSha256!==inspectionRunResult.schema.catalog.catalogSha256||
          schema.sqlProgramSha256!==inspectionRunResult.schema.sqlProgramSha256)fail('EXPRESS_C3G_INDEPENDENT_SCHEMA_CHANGED');
      }else{
        schema=await sessions.withPair({...common,tenantDatabaseOid:'16459',use:async({managementClient,targetClient})=>{
          await managementClient.query(diagnostic.TRANSACTION);await targetClient.query(diagnostic.TRANSACTION);
          const owners=await managementClient.query({text:OWNERS_SQL,values:ownerValues}),c=owners.rows?.[0];
          if(owners.rowCount!==1||c?.roles?.length!==1||c?.databases?.length!==1)fail('EXPRESS_C3G_INSPECT_OWNER_CHANGED');
          bootstrap.verifyStageV4(built.bootstrap,{app:c.roles[0],guard:null,database:c.databases[0]},'promote',
            {app:{oid:'16456'},database:{oid:'16459'}});
          const context=await targetClient.query(diagnostic.CONTEXT_SQL);
          if(context.rowCount!==1||context.rows[0].read_only!=='on'||context.rows[0].isolation!=='repeatable read')
            fail('EXPRESS_C3G_INSPECT_CONTEXT_REJECTED');
          const r=await targetClient.query(PG17_CATALOG_SQL),report=capture.catalogReport({result:r,tables:built.baseline.tables,
            phase:'independent-after-stop',verifyCatalog:verifyPg17Catalog,frozenVerify});
          await saveReport(report);
          await targetClient.query('COMMIT');await managementClient.query('COMMIT');
          return {state:'PARTIAL_TENANT_CATALOG_OBSERVED_NOT_ROWS_VERIFIED',databaseOid:'16459',roleOid:'16456',
            catalogReport:report,managementCatalogSha256:db.digest(c),tenantDatabaseBytes:context.rows[0].bytes,
            rowCountsRead:false,sqlMutationPerformed:false,runtimeEnabled:false,lifecycleCompatible:false};
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
  const code = /^(?:EXPRESS_C3G|AURORA_V[345])_[A-Z0-9_]+$/.test(e.message||'')?e.message:'EXPRESS_C3G_STOPPED_INSPECT_REQUIRED';
  await save('stopped.json',{code,manifestSha256:manifest?.manifestSha256||null,metadataCalls,sqlConnections,sqlCalls,attemptConsumed,inspectionConsumed,
    sqlEffectsMayHaveOccurred:schemaWriteSubmitted,schemaWriteSubmitted,awsResourceWrites:0,retryAuthorized:false,runtimeEnabled:false});
  process.stderr.write(JSON.stringify({code,directory:out,metadataCalls,sqlConnections,sqlCalls,attemptConsumed,inspectionConsumed,
    retryAuthorized:false})+'\n');process.exitCode=1;
} finally { await stageJournal?.close();sts?.destroy();iam?.destroy();rds?.destroy(); }
