// C4h calibrates only the exact observed membership grantor and pins IAM OID.
// Frozen C4g/C4f source, eight SQL statements and all other predicates remain.
// Review: archive compilation and AWS metadata only. Run/Inspect require fresh
// exact human approval. No Secret-value, IAM writer, ECS or Neon client.
import path from 'node:path';
import tls from 'node:tls';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFile,mkdir,open,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import * as iamSdk from '@aws-sdk/client-iam';
import {SecretsManagerClient,DescribeSecretCommand} from '@aws-sdk/client-secrets-manager';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import review from '../../../lib/deployments/execution/express-application-activation-c4h.cjs';
import iamReview from '../../../lib/deployments/execution/express-runtime-iam-c4e.cjs';
import {observeRuntimeSecretC4d} from '../../../lib/deployments/execution/express-runtime-secret-c4d.ts';
import {validateExistingExpressBinding,assertDiagnosticFacts} from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
const root=path.resolve('F:/ChatGPT_workshop'),platform=fileURLToPath(new URL('../../../',import.meta.url)),backend='E:/NodejsProject/SpeedFeast_Backend_main';
const requireBackend=createRequire(backend+'/package.json'),cli=promisify(execFile),hash=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Error(code);},pairs=[],raw=process.argv.slice(2);
if(raw.length%2)fail('C4H_ARGUMENTS_REJECTED');for(let n=0;n<raw.length;n+=2)pairs.push([raw[n],raw[n+1]]);
const args=Object.fromEntries(pairs),mode=args['--mode'],out=path.resolve(args['--output']||'');
if(new Set(pairs.map(p=>p[0])).size!==pairs.length||!['Review','Run','Inspect'].includes(mode)||
 Object.keys(args).some(k=>!['--mode','--manifest','--approved-sha','--output'].includes(k))||Object.values(args).some(v=>!v)||
 path.dirname(out).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4h-[a-z0-9-]+$/.test(path.basename(out))||
 mode==='Review'&&(args['--manifest']||args['--approved-sha'])||mode!=='Review'&&(!args['--manifest']||!args['--approved-sha']))fail('C4H_ARGUMENTS_REJECTED');
await mkdir(out);
const save=async(name,v)=>{const f=await open(path.join(out,name),'wx');try{await f.writeFile(JSON.stringify(v,null,2)+'\n');await f.sync();}finally{await f.close();}};
let metadataCalls=0,sqlConnections=0,sqlCalls=0,permissionWriteCalls=0,slotConsumed=false,phase='LOCAL_BINDING',manifest,journal,lastSqlLabel=null;
const clients=[],counts={management:0,application:0},emptySlot=async name=>{try{await access(root+'/'+name);fail('C4H_SLOT_OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}};
const stage=async v=>{if(!journal)journal=await open(out+'/stages.jsonl','wx');await journal.writeFile(JSON.stringify({at:new Date().toISOString(),...v})+'\n');await journal.sync();};
try{
 if(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','DATABASE_URL',
   'PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k=>process.env[k])||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('C4H_ENV_CONFLICT');
 const previous=root+'/techlong-d002-express-c4g-inspect-20261015-r1';
 const history={
  [previous+'/iam-metadata.json']:'e00154ab482638987e834c5d57dad0b5b6932dd3e03ac5ae40828a39230c5ce7',
  [previous+'/code-binding.json']:'54dec5970f1e88a9152918faf2de1f457d7610d820fdf95b9bff312404580c4f',
  [previous+'/result.json']:'92f3a2884c1b5b72e1fbd290997b2e07ec0973f23ac757619d56d5274bb3e705',
  [root+'/techlong-d002-express-c4g-run-20261015-r1/stopped.json']:'f9068229b491142e62c52c0c2c4bdf41f88222298df37ff9b3df8bb6ab511e95',
  [root+'/techlong-d002-express-c4g-run-20261015-r1/stages.jsonl']:'b967837684aee9ee99708a3235280fc98074bbedcfcdaa94b69c7a28c9e9e56f',
  [root+'/techlong-d002-express-c4g-local-analysis-20261015-r1.json']:'16bbca354997a15ce123539fda7cd14ddbf9ecfc34a77e6acc6d3dbabfd3fb89',
  [root+'/techlong-d002-express-c4g-application-install-v1.permanent-slot.json']:'48b8b48cc1c45ae25695d1b66f9a7a82b7a0b992ddb825be21f1b0a482c03598',
  [root+'/techlong-d002-express-c4g-application-inspect-v1.permanent-slot.json']:'d064dbcf6978fe153f5aea1187b75668416b73c8a743c967e009076dd5020f04',
  [previous+'/observation.json']:'1036cdf50e3a4257b53ae54edcadf5884c6af1b4fec2092010bdca97bd050852',
  [root+'/techlong-d002-express-c4f-run-20261014-r1/stopped.json']:'a075598dfc7217c1571792e94819899ab8e61a14bd5e578fdde1d4ec74377ba6',
  [root+'/techlong-d002-express-c4f-application-install-v1.permanent-slot.json']:'be9886b113c985b506a7db093dd0ecff64b39139dabba9f663543cb3580054a3',
  [root+'/techlong-d002-express-c4f-application-inspect-v1.permanent-slot.json']:'4a77afa115ee985d427ee288a3cf8911be6d0d8f25d8a19e6c67bc2d4856936d',
  [root+'/'+iamReview.RUN_SLOT]:'d1cab761cbbdbbec174deb79a5763b929a4806c409f8e2b6410ae1c0111fa316',
  [root+'/'+iamReview.INSPECT_SLOT]:'d1ae5ee1d57fb04d893d7adb0339ed0b53165d1ea61c0f87179365c0d0797bd8',
  [root+'/techlong-d002-express-c4c-inspect-20261014-r1/observation.json']:'624478cdb00bac5fd9c2c566400955eb6adf37e18150c16f3dc6b01c5fe9c262',
  [root+'/techlong-d002-express-c3g-run-20261014-r1/result.json']:'3ec0a90c18920a0625a5857f05b4b1d86da483f9e1915ef718b122a72894fd00',
  [root+'/techlong-d002-express-c3g-inspect-20261014-r1/result.json']:'f7040b664ce600c521dd37af9140941bd48de4fc66568538b878ab28cbccce03'};
 for(const [file,sha] of Object.entries(history))if(hash(await readFile(file))!==sha)fail('C4H_HISTORY_CHANGED');
 const old=JSON.parse(await readFile(previous+'/code-binding.json','utf8')),pins=[...old.pins];
 if(pins.length!==260||old.tools.length!==2||db.digest({pins,tools:old.tools})!=='2c9e0953d5a0a9abf7e8c1eaf9e6cbb74e80219ba47a0be00937c8e11c6991b0')fail('C4H_CODE_BINDING_REJECTED');
 for(const p of pins)if(hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n'))!==p.sha256)fail('C4H_BOUND_CODE_CHANGED');
 for(const t of old.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('C4H_BOUND_TOOL_CHANGED');
 for(const name of ['lib/deployments/execution/express-application-activation-c4h.cjs','ops/aws-sandbox/scripts/review-express-application-c4h.mjs','tests/express-application-activation-c4h.test.mjs'])
  pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
 const codeSha=db.digest({pins,tools:old.tools});await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:old.tools,history});
 const slot=mode==='Inspect'?review.INSPECT_SLOT:review.RUN_SLOT;await emptySlot(slot);if(mode==='Review')await emptySlot(review.INSPECT_SLOT);
 // Reject missing/wrong/expired approval before compiling native tools or fetching credentials.
 if(mode!=='Review'){
  const f=await realpath(args['--manifest']);
  if(path.basename(f)!=='manifest.json'||path.dirname(path.dirname(f)).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4h-/.test(path.basename(path.dirname(f))))fail('C4H_MANIFEST_PATH_REJECTED');
  manifest=JSON.parse(await readFile(f,'utf8'));const {manifestSha256,...body}=manifest;
  if(args['--approved-sha']!==manifestSha256||db.digest(body)!==manifestSha256||manifest.codeBindingSha256!==codeSha||
    Date.now()<Date.parse(manifest.preparedAt)||Date.now()>=Date.parse(manifest.expiresAt))fail('C4H_FRESH_APPROVAL_REQUIRED');
  if(mode==='Inspect'){const s=JSON.parse(await readFile(root+'/'+review.RUN_SLOT,'utf8'));
   if(s.manifestSha256!==manifestSha256||s.retryAuthorized!==false)fail('C4H_APPROVED_INSTALL_SLOT_REQUIRED');}
 }
 phase='ARCHIVE_COMPILATION';
 const original=JSON.parse(await readFile(root+'/techlong-d002-express-c3d-review-20261014-r2/manifest.json','utf8'));
 const {compile}=requireBackend('./scripts/prepare-aurora-express-sql-v5');
 const built=await compile({continuationInput:original.continuationInput,baselineDirectory:root+'/techlong-empty-baseline-20261005-f2a4',
  pgRestorePath:old.tools.find(t=>t.filename.endsWith('pg_restore.exe')).filename,pythonPath:old.tools.find(t=>t.filename.endsWith('python.exe')).filename,workspace:out+'/compiled'});
 const app=requireBackend('./services/saas/aurora-express-application-v6.cjs');
 const candidate=app.compileApplicationCandidateV6({bootstrapProgram:built.bootstrap,baselineProgram:built.baseline,
  run:JSON.parse(await readFile(root+'/techlong-d002-express-c3g-run-20261014-r1/result.json','utf8')),
  inspection:JSON.parse(await readFile(root+'/techlong-d002-express-c3g-inspect-20261014-r1/result.json','utf8'))});
 app.assertCompiledApplicationCandidateV6(candidate);
 let rejected=false;try{app.assertCompiledApplicationCandidateV6(structuredClone(candidate));}catch{rejected=true;}if(!rejected)fail('C4H_SERIALIZED_CANDIDATE_ACCEPTED');
 const {ROLE_DIRECTORY_SQL}=requireBackend('./services/saas/aurora_role_directory_v2'),rest=requireBackend('./services/saas/aurora_express_restore_v3');
 const closed=JSON.parse(await readFile(root+'/techlong-d002-express-c4c-inspect-20261014-r1/observation.json','utf8')).databases;
 const program=review.compile({candidate,closedDatabases:closed,roleSql:ROLE_DIRECTORY_SQL,catalogSql:rest.PG17_CATALOG_SQL,rowCountSql:rest.rowCountSql(candidate.tables)});
 await save('application-candidate.json',candidate);await save('program.json',program);
 const approval=()=>review.approval(manifest,args['--approved-sha'],codeSha,program,Date.now());if(mode!=='Review')approval();
 const expectedIam=JSON.parse(await readFile(previous+'/iam-metadata.json','utf8')),iamSha=db.digest(expectedIam);
 const c4d=JSON.parse(await readFile(root+'/techlong-d002-express-c4d-review-20261014-r5/manifest.json','utf8'));
 const binding=validateExistingExpressBinding(c4d.facts.binding);
 phase='AWS_METADATA';
 const credentials=fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
 const config={region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true},rdsSdk=requireBackend('@aws-sdk/client-rds');
 const sts=new STSClient(config),iam=new iamSdk.IAMClient(config),rds=new rdsSdk.RDSClient(config),secrets=new SecretsManagerClient(config);clients.push(sts,iam,rds,secrets);
 const send=async(c,cmd)=>{if(!['GetCallerIdentityCommand','GetRoleCommand','ListRolePoliciesCommand','ListAttachedRolePoliciesCommand','GetRolePolicyCommand',
  'GetPolicyCommand','GetPolicyVersionCommand','ListPolicyVersionsCommand','ListEntitiesForPolicyCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand',
  'DescribeSecretCommand','SimulatePrincipalPolicyCommand'].includes(cmd.constructor.name)||++metadataCalls>32)fail('C4H_METADATA_SCOPE_REJECTED');
  try{return await c.send(cmd,{abortSignal:AbortSignal.timeout(30000)});}catch(e){const codes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED'};
   fail('C4H_'+(codes[e.name]||'METADATA_PROVIDER_FAILED'));}};
 const identity=v=>{if(v.Account!=='402010193138'||v.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||v.UserId!=='AIDAV3GNMXTZEO7SHLC2X')fail('C4H_SOURCE_CHANGED');return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};};
 identity(await send(sts,new GetCallerIdentityCommand({})));
 const doc=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
 const roles=await Promise.all(expectedIam.roles.map(async wanted=>{
  const name=wanted.name,[rr,ps,ats]=await Promise.all([send(iam,new iamSdk.GetRoleCommand({RoleName:name})),send(iam,new iamSdk.ListRolePoliciesCommand({RoleName:name})),send(iam,new iamSdk.ListAttachedRolePoliciesCommand({RoleName:name}))]);
  if(ps.IsTruncated||ats.IsTruncated||!Array.isArray(ps.PolicyNames)||ps.PolicyNames.length>2||ats.AttachedPolicies?.length)fail('C4H_IAM_STATE_CHANGED');
  const inline=[];for(const PolicyName of ps.PolicyNames){const p=await send(iam,new iamSdk.GetRolePolicyCommand({RoleName:name,PolicyName}));if(p.RoleName!==name||p.PolicyName!==PolicyName)fail('C4H_IAM_STATE_CHANGED');inline.push({name:PolicyName,document:doc(p.PolicyDocument)});}
  const r=rr.Role;return {name,id:r?.RoleId,arn:r?.Arn,trust:doc(r?.AssumeRolePolicyDocument),boundaryArn:r?.PermissionsBoundary?.PermissionsBoundaryArn,attached:[],inline:inline.sort((a,b)=>a.name.localeCompare(b.name)),tags:Object.fromEntries((r.Tags||[]).map(t=>[t.Key,t.Value]))};
 }));
 const PolicyArn=iamReview.BOUNDARY,[p,v,b,a]=await Promise.all([send(iam,new iamSdk.GetPolicyCommand({PolicyArn})),send(iam,new iamSdk.ListPolicyVersionsCommand({PolicyArn})),
  send(iam,new iamSdk.ListEntitiesForPolicyCommand({PolicyArn,PolicyUsageFilter:'PermissionsBoundary',MaxItems:100})),send(iam,new iamSdk.ListEntitiesForPolicyCommand({PolicyArn,PolicyUsageFilter:'PermissionsPolicy',MaxItems:100}))]);
 if(v.IsTruncated||b.IsTruncated||a.IsTruncated||p.Policy?.Arn!==PolicyArn)fail('C4H_IAM_STATE_CHANGED');
 const version=await send(iam,new iamSdk.GetPolicyVersionCommand({PolicyArn,VersionId:p.Policy.DefaultVersionId}));
 if(!version.PolicyVersion?.IsDefaultVersion||version.PolicyVersion.VersionId!==p.Policy.DefaultVersionId)fail('C4H_IAM_STATE_CHANGED');
 const entities=x=>({roles:(x.PolicyRoles||[]).map(r=>({name:r.RoleName,id:r.RoleId})).sort((a,b)=>a.name.localeCompare(b.name)),users:(x.PolicyUsers||[]).map(r=>({name:r.UserName,id:r.UserId})).sort((a,b)=>a.name.localeCompare(b.name)),groups:(x.PolicyGroups||[]).map(r=>({name:r.GroupName,id:r.GroupId})).sort((a,b)=>a.name.localeCompare(b.name))});
 const currentIam={roles:roles.sort((a,b)=>a.name.localeCompare(b.name)),boundary:{arn:PolicyArn,id:p.Policy.PolicyId,defaultVersion:p.Policy.DefaultVersionId,document:doc(version.PolicyVersion.Document),versions:v.Versions.map(x=>({id:x.VersionId,isDefault:x.IsDefaultVersion})).sort((a,b)=>a.id.localeCompare(b.id)),boundaryConsumers:entities(b),permissionConsumers:entities(a)}};
 await save('iam-metadata.json',currentIam);if(db.digest(currentIam)!==iamSha)fail('C4H_INSTALLED_IAM_CHANGED');
 const secret=observeRuntimeSecretC4d(c4d,await send(secrets,new DescribeSecretCommand({SecretId:iamReview.SECRET})));
 if(secret.binding.runtimeSecret.arn!==iamReview.SECRET||secret.binding.runtimeSecret.versionId!==iamReview.VERSION)fail('C4H_SECRET_CHANGED');
 const source=identity(await send(sts,new GetCallerIdentityCommand({})));
 const cs=(await send(rds,new rdsSdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters,c=cs?.[0];
 const ins=(await send(rds,new rdsSdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances,i=ins?.[0];
 if(cs?.length!==1||ins?.length!==1||c.MasterUsername!=='postgres'||c.MasterUserSecret||!c.IAMDatabaseAuthenticationEnabled||!c.InternetAccessGatewayEnabled||
  c.VPCNetworkingEnabled!==false||c.DeletionProtection!==false||c.DBClusterMembers?.length!==1||c.DBClusterMembers[0].DBInstanceIdentifier!==binding.writerIdentifier||!c.DBClusterMembers[0].IsClusterWriter||
  i.DBClusterIdentifier!=='techlong-sandbox-express-d001'||i.DBInstanceClass!=='db.serverless'||db.canonicalJson(c.ServerlessV2ScalingConfiguration)!==db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))fail('C4H_PHYSICAL_CLUSTER_CHANGED');
 const currentBinding=validateExistingExpressBinding({...binding,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,
  endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
 const connect=async user=>{const resource='arn:aws:rds-db:ca-central-1:402010193138:dbuser:'+binding.clusterResourceId+'/'+user;
  const ev=(await send(iam,new iamSdk.SimulatePrincipalPolicyCommand({PolicySourceArn:source.Arn,ActionNames:['rds-db:connect'],ResourceArns:[resource]}))).EvaluationResults;
  if(ev?.length!==1||ev[0].EvalActionName!=='rds-db:connect'||ev[0].EvalResourceName!==resource||ev[0].EvalDecision!=='allowed'||ev[0].MissingContextValues?.length)fail('C4H_SOURCE_CONNECT_DENIED');
  return {action:ev[0].EvalActionName,resource,decision:ev[0].EvalDecision,missingContext:ev[0].MissingContextValues||[]};};
 const connectPermission=await connect('postgres'),applicationConnectPermission=await connect(candidate.target.role);if(++metadataCalls>32)fail('C4H_METADATA_SCOPE_REJECTED');
 let plan;try{const r=await cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json','--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:30000,maxBuffer:16384,windowsHide:true,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}});plan=JSON.parse(r.stdout);}catch{fail('C4H_PLAN_METADATA_UNAVAILABLE');}
 const facts={observedAt:new Date().toISOString(),source,binding:currentBinding,plan,connectPermission,applicationConnectPermission};assertDiagnosticFacts(facts,binding,Date.now());
 if(mode==='Review'){
  manifest=review.prepare({facts,program,iamInventorySha256:iamSha,codeBindingSha256:codeSha,now:Date.now()});await save('manifest.json',manifest);
  await save('result.json',{mode,manifestSha256:manifest.manifestSha256,metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,awsWrites:0,secretValueReads:0,privateMaterialReads:0,runtimeEnabled:false,readyVerified:false});
  process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,metadataCalls,sqlConnections,permissionWriteCalls,slotConsumed,proposedPermissionStatements:8})+'\n');
 }else{
  approval();if(manifest.iamInventorySha256!==iamSha||db.canonicalJson(facts.binding)!==db.canonicalJson(manifest.facts.binding))fail('C4H_APPROVED_FACTS_CHANGED');
  const snapshot=await credentials();if(!snapshot.accessKeyId||!snapshot.secretAccessKey||!snapshot.sessionToken||!(snapshot.expiration instanceof Date)||snapshot.expiration.getTime()<Date.now()+300000)fail('C4H_CREDENTIAL_SNAPSHOT_TOO_SHORT');
  const ss=new STSClient({...config,credentials:snapshot});clients.push(ss);identity(await send(ss,new GetCallerIdentityCommand({})));
  const {loadAtsRoots}=requireBackend('./services/saas/aurora_connections_v2'),{Signer}=requireBackend('@aws-sdk/rds-signer'),Pg=requireBackend('pg').Client;
  const checks={assertCandidate:app.assertCompiledApplicationCandidateV6,classifyRole:app.classifyApplicationRoleV6,verifyCatalog:app.verifyApplicationCatalogV6,verifyRows:rest.verifyRows};
  const session=async(application,operate)=>{
   const kind=application?'application':'management',normal=application?6:mode==='Run'?21:8,allowed=application?program.loginPlan:[{text:mode==='Run'?review.BEGIN:review.BEGIN_READ},{text:'SET LOCAL search_path = pg_catalog'},...program.snapshotPlan,{text:'COMMIT'},...(mode==='Run'?program.statements.map(text=>({text})):[])];
   let queries=0,signed=false;const permitted=new Map(allowed.map(q=>[q.text,q])),user=application?candidate.target.role:'postgres';
   class FixedClient extends Pg{
    connect(...a){if(a.length||++counts[kind]>1||++sqlConnections>(mode==='Run'?1:2))fail('C4H_CONNECTION_SCOPE_REJECTED');return super.connect();}
    query(q,...restArgs){approval();sqlCalls++;if(restArgs.length||++queries>normal+1)fail('C4H_QUERY_BUDGET_REJECTED');const text=typeof q==='string'?q:q?.text,wanted=permitted.get(text);
     if(text!=='ROLLBACK'&&(!wanted||(wanted.values?typeof q!=='object'||db.canonicalJson(q.values)!==db.canonicalJson(wanted.values):typeof q!=='string')))fail('C4H_SQL_SCOPE_REJECTED');
     if(text==='ROLLBACK'&&typeof q!=='string')fail('C4H_SQL_SCOPE_REJECTED');if(program.statements.includes(text)&&++permissionWriteCalls>8)fail('C4H_PERMISSION_WRITE_BUDGET_REJECTED');
     const permissionIndex=program.statements.indexOf(text),snapshotIndex=program.snapshotPlan.findIndex(v=>v.text===text);
     if(text!=='ROLLBACK')lastSqlLabel=permissionIndex>=0?'PERMISSION_'+(permissionIndex+1):snapshotIndex>=0?'SNAPSHOT_'+(snapshotIndex+1):text==='COMMIT'?'COMMIT':text===review.PRIVILEGES_SQL?'APPLICATION_PRIVILEGES':'TRANSACTION_SETUP';
     return super.query(q);}
   }
   const client=new FixedClient({host:binding.endpoint,port:5432,database:candidate.target.database,user,
    password:async()=>{approval();if(signed||snapshot.expiration.getTime()<Date.now()+120000)fail('C4H_TOKEN_SIGNING_REPLAY_OR_EXPIRY');signed=true;
     const token=await new Signer({region:'ca-central-1',hostname:binding.endpoint,port:5432,username:user,credentials:snapshot}).getAuthToken();
     if(typeof token!=='string'||token.length<80||token.length>16384||/[\r\n\0]/.test(token))fail('C4H_TOKEN_INVALID');return token;},
    ssl:{ca:loadAtsRoots(),rejectUnauthorized:true,servername:binding.endpoint,checkServerIdentity:tls.checkServerIdentity,minVersion:'TLSv1.2'},connectionTimeoutMillis:30000,query_timeout:15000,
    options:'-c default_transaction_read_only='+(mode==='Run'&&!application?'off':'on')+' -c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000',application_name:'techlong-express-c4h-'+kind});
   const signal=AbortSignal.timeout(90000),kill=()=>{try{client.connection?.stream?.destroy();}catch{/* best effort */}};client.on('error',kill);signal.addEventListener('abort',kill,{once:true});
   try{phase=application?'APPLICATION_TLS_IAM_LOGIN':'MANAGEMENT_SQL_TRANSACTION';await client.connect();signal.throwIfAborted();const s=client.connection?.stream;
    if(s?.encrypted!==true||s.authorized!==true||s.servername!==binding.endpoint)fail('C4H_CLIENT_TLS_UNPROVEN');return await operate(client,signal);
   }finally{kill();signal.removeEventListener('abort',kill);client.password=null;if(client.connectionParameters)client.connectionParameters.password=null;
    let timer;try{await Promise.race([client.end(),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}catch{/* never reconnect */}finally{clearTimeout(timer);}}
  };
  approval();assertDiagnosticFacts(facts,binding,Date.now());await emptySlot(slot);
  const f=await open(root+'/'+slot,'wx');slotConsumed=true;try{await f.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,consumedAt:new Date().toISOString(),retryAuthorized:false})+'\n');await f.sync();}finally{await f.close();}
  const observation=await session(false,(client,signal)=>review.execute({client,program,candidate,checks,inspectOnly:mode==='Inspect',approval,signal,journal:stage}));
  await save('observation.json',observation);
  let login=null;if(mode==='Inspect'&&observation.state==='active'){login=await session(true,(client,signal)=>review.login({client,program,approval,signal,checks}));await save('application-login.json',login);}
  const outcome=login?login.outcome:observation.outcome;
  await save('result.json',{mode,manifestSha256:manifest.manifestSha256,outcome,metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,
    awsWrites:0,secretValueReads:0,privateMaterialReads:0,applicationLoginVerified:!!login,ecsTaskRoleVerified:false,runtimeEnabled:false,readyVerified:false});
  process.stdout.write(JSON.stringify({mode,directory:out,outcome,metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,applicationLoginVerified:!!login})+'\n');
 }
}catch(e){const details=review.errorDetails(e),code=/^C4H_[A-Z0-9_]+$/.test(e.message||'')?e.message:details.validationCode?'C4H_VALIDATION_REJECTED':'C4H_LOCAL_OR_PROVIDER_FAILURE';
 await save('stopped.json',{mode,manifestSha256:manifest?.manifestSha256??null,code,phase,metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,
  awsWrites:0,secretValueReads:0,privateMaterialReads:0,automaticRetries:0,lastSqlLabel,...details,
  postgresSqlState:typeof e.code==='string'&&/^[0-9][A-Z0-9]{4}$/.test(e.code)?e.code:null,
  transactionState:e.c4fTransactionState||null,requiresIndependentInspect:slotConsumed&&mode==='Run',runtimeEnabled:false,readyVerified:false});process.stderr.write(code+'\n');process.exitCode=1;
}finally{for(const c of clients)c.destroy();if(journal)await journal.close();}
