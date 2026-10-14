// Review prepares a fresh two-database isolation write scope from fixed history.
// Run performs only two RESTRICT revocations atomically; Inspect independently
// verifies the exact post-state. No application LOGIN/GRANT or AWS writes.
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
import inventory from '../../../lib/deployments/execution/express-activation-inventory-c4b.cjs';
import review from '../../../lib/deployments/execution/express-isolation-c4c.cjs';
import {buildExpressRuntimeCandidateV7} from '../../../lib/deployments/execution/express-runtime-candidate-v7.ts';
import {validateExistingExpressBinding,assertDiagnosticFacts} from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
const root=path.resolve('F:/ChatGPT_workshop'),backend='E:/NodejsProject/SpeedFeast_Backend_main';
const platform=fileURLToPath(new URL('../../../',import.meta.url)),requireBackend=createRequire(path.join(backend,'package.json'));
const hash=v=>createHash('sha256').update(v).digest('hex'),fail=code=>{throw Error(code);},cli=promisify(execFile);
const raw=process.argv.slice(2),pairs=[];
if(raw.length%2)fail('C4C_ARGUMENTS_REJECTED');
for(let i=0;i<raw.length;i+=2)pairs.push([raw[i],raw[i+1]]);
const args=Object.fromEntries(pairs),mode=args['--mode'],out=path.resolve(args['--output']||'');
if(new Set(pairs.map(p=>p[0])).size!==pairs.length||!['Review','Run','Inspect'].includes(mode)||
  Object.keys(args).some(k=>!['--mode','--manifest','--approved-sha','--run-directory','--output'].includes(k))||
  Object.values(args).some(v=>typeof v!=='string'||!v)||path.dirname(out).toLowerCase()!==root.toLowerCase()||
  !/^techlong-d002-express-c4c-[a-z0-9-]+$/.test(path.basename(out))||
  mode==='Review'&&(args['--manifest']||args['--approved-sha']||args['--run-directory'])||mode!=='Review'&&(!args['--manifest']||!args['--approved-sha'])||
  mode==='Run'&&args['--run-directory']||mode==='Inspect'&&!args['--run-directory'])fail('C4C_ARGUMENTS_REJECTED');
await mkdir(out);
const save=async(name,value)=>{const f=await open(path.join(out,name),'wx');try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}};
let metadataCalls=0,sqlConnections=0,sqlCalls=0,permissionWriteCalls=0,slotConsumed=false,phase='LOCAL_BINDING',manifest;
let stageJournal;
const clients=[];
try{
  if(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k=>process.env[k])||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('C4C_ENV_CONFLICT');
  const previousDir=path.join(root,'techlong-d002-express-c4b-inspect-20261014-r1');
  const cap=JSON.parse(await readFile(path.join(platform,'ops/aws-sandbox/reviews/aurora-express-c4b-isolation.executed.json'),'utf8'));
  if(cap.approvedManifestSha256!=='4de95e9036fd7b87e57b2f67689f26bcc1561d43ed5327dc408ce18fe7af3121'||
    cap.codeBindingSha256!=='bb553f2dc37df3633409bb83af442f782308a353e699e2d0945e6637608ccce1'||
    cap.files['observation.json']!==review.OBSERVATION_FILE_SHA||
    cap.slotFileSha256!=='2c4c3d3f84ca7356fcb5e2bd89a364c0641b6abd206534995b4361b43cc0b12f')fail('C4C_PREDECESSOR_REJECTED');
  const historyFiles={'observation.json':review.OBSERVATION_FILE_SHA,
    'result.json':'1f2626a1c91cca8c48e7c42fc0f76ab1de92bd104dc90c27739f5c9c7e1e400b',
    'code-binding.json':'7cd0668f793f82659788cf714d1ed6ffa9b1950f522e2ed36674277a88bf8ab8'};
  if(db.canonicalJson(cap.files)!==db.canonicalJson(historyFiles))fail('C4C_HISTORY_PATH_SCOPE_REJECTED');
  for(const [name,sha]of Object.entries(historyFiles))if(hash(await readFile(path.join(previousDir,name)))!==sha)fail('C4C_PREDECESSOR_FILE_CHANGED');
  if(cap.slot!==path.join(root,'techlong-d002-express-c4b-isolation-read-v1.permanent-slot.json').replaceAll('\\','/'))fail('C4C_HISTORY_PATH_SCOPE_REJECTED');
  if(hash(await readFile(path.join(root,'techlong-d002-express-c4b-isolation-read-v1.permanent-slot.json')))!==cap.slotFileSha256)fail('C4C_PREDECESSOR_SLOT_CHANGED');
  const observation=JSON.parse(await readFile(path.join(previousDir,'observation.json'),'utf8')),program=review.compile(observation);
  const old=JSON.parse(await readFile(path.join(previousDir,'code-binding.json'),'utf8'));
  if(old.pins.length!==243||old.tools.length!==2||db.digest({pins:old.pins,tools:old.tools})!==cap.codeBindingSha256)fail('C4C_CODE_BINDING_REJECTED');
  const pins=[...old.pins];
  for(const p of pins)if(hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n'))!==p.sha256)fail('C4C_BOUND_CODE_CHANGED');
  for(const t of old.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('C4C_BOUND_TOOL_CHANGED');
  for(const name of ['ops/aws-sandbox/scripts/review-express-isolation-c4c.mjs','lib/deployments/execution/express-isolation-c4c.cjs',
    'lib/deployments/execution/express-runtime-candidate-v7.ts','tests/express-isolation-c4c.test.mjs','tests/express-runtime-candidate-v7.test.ts'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha=db.digest({pins,tools:old.tools});
  await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:old.tools,predecessorObservationFileSha256:review.OBSERVATION_FILE_SHA});
  await save('isolation-program.json',program);
  const original=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3d-review-20261014-r2/manifest.json'),'utf8'));
  const binding=validateExistingExpressBinding(original.expectedBinding);
  const runtimeCandidate=buildExpressRuntimeCandidateV7(original.continuationInput.bootstrapInput.scope);
  await save('runtime-candidate.json',runtimeCandidate);
  const {ROLE_DIRECTORY_SQL}=requireBackend('./services/saas/aurora_role_directory_v2');
  const {classifyApplicationRoleV6}=requireBackend('./services/saas/aurora-express-application-v6.cjs');
  const plan=inventory.sqlPlan(ROLE_DIRECTORY_SQL),slotName=mode==='Inspect'?review.INSPECT_SLOT:review.RUN_SLOT;
  const emptySlot=async(name=slotName)=>{try{await access(path.join(root,name));fail('C4C_SLOT_OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}};
  await emptySlot();if(mode==='Review')await emptySlot(review.INSPECT_SLOT);
  if(mode!=='Review'){
    const f=await realpath(args['--manifest']);
    if(path.basename(f)!=='manifest.json'||path.dirname(path.dirname(f)).toLowerCase()!==root.toLowerCase()||
      !/^techlong-d002-express-c4c-/.test(path.basename(path.dirname(f))))fail('C4C_MANIFEST_PATH_REJECTED');
    manifest=JSON.parse(await readFile(f,'utf8'));
    review.assertApproval(manifest,args['--approved-sha'],codeSha,program,plan,Date.now()); // before credentials/AWS/SQL/slot
  }
  phase='AWS_METADATA';
  const credentials=fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
  const config={region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true},rdsSdk=requireBackend('@aws-sdk/client-rds');
  const sts=new STSClient(config),iam=new iamSdk.IAMClient(config),rds=new rdsSdk.RDSClient(config),secrets=new SecretsManagerClient(config);
  clients.push(sts,iam,rds,secrets);
  const send=async(client,command,absent=false)=>{
    const allowed=['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand','DescribeSecretCommand'];
    if(!allowed.includes(command.constructor.name)||++metadataCalls>(mode==='Review'?9:7))fail('C4C_METADATA_BUDGET_REJECTED');
    try{return await client.send(command,{abortSignal:AbortSignal.timeout(30000)});}catch(e){
      if(absent&&e.name==='ResourceNotFoundException')return null;
      const codes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',
        AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED',AbortError:'METADATA_TIMEOUT',TimeoutError:'METADATA_TIMEOUT'};
      fail('C4C_'+(codes[e.name]||'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity=v=>{if(v.Account!=='402010193138'||v.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||v.UserId!=='AIDAV3GNMXTZEO7SHLC2X')fail('C4C_SOURCE_CHANGED');
    return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};};
  const facts=async()=>{
    const source=identity(await send(sts,new GetCallerIdentityCommand({})));
    const cs=(await send(rds,new rdsSdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters,c=cs?.[0];
    if(cs?.length!==1||c.DBClusterMembers?.length!==1||c.DBClusterMembers[0].DBInstanceIdentifier!==binding.writerIdentifier||!c.DBClusterMembers[0].IsClusterWriter||
      c.MasterUsername!=='postgres'||c.MasterUserSecret||!c.IAMDatabaseAuthenticationEnabled||!c.InternetAccessGatewayEnabled||c.VPCNetworkingEnabled!==false||
      c.DeletionProtection!==false||db.canonicalJson(c.ServerlessV2ScalingConfiguration)!==db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))fail('C4C_CLUSTER_CHANGED');
    const is=(await send(rds,new rdsSdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances,i=is?.[0];
    if(is?.length!==1||i.DBClusterIdentifier!=='techlong-sandbox-express-d001'||i.DBInstanceClass!=='db.serverless')fail('C4C_WRITER_CHANGED');
    const current=validateExistingExpressBinding({manifestSha256:binding.manifestSha256,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,
      createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,
      writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    const arn=`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const evals=(await send(iam,new iamSdk.SimulatePrincipalPolicyCommand({PolicySourceArn:source.Arn,ActionNames:['rds-db:connect'],ResourceArns:[arn]}))).EvaluationResults;
    if(evals?.length!==1)fail('C4C_CONNECT_SIMULATION_AMBIGUOUS');
    if(++metadataCalls>(mode==='Review'?9:7))fail('C4C_METADATA_BUDGET_REJECTED');
    let planState;try{const r=await cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
      '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:30000,maxBuffer:16384,
      env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}});planState=JSON.parse(r.stdout);}catch{fail('C4C_PLAN_METADATA_UNAVAILABLE');}
    const p=evals[0],v={observedAt:new Date().toISOString(),source,binding:current,plan:planState,
      connectPermission:{action:p.EvalActionName,resource:p.EvalResourceName,decision:p.EvalDecision,missingContext:p.MissingContextValues||[]}};
    assertDiagnosticFacts(v,binding,Date.now());return v;
  };
  if(mode==='Review'){
    const names=['techlong/sandbox/tenant/a0da1748bc4d5419/runtime/g1',runtimeCandidate.name],secretMetadata=[];
    for(const name of names){
      const v=await send(secrets,new DescribeSecretCommand({SecretId:name}),true);
      if(v&&(v.Name!==name||typeof v.ARN!=='string'||!v.ARN.startsWith('arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+name+'-')))fail('C4C_SECRET_METADATA_CHANGED');
      secretMetadata.push({name,state:v?(v.DeletedDate?'PENDING_DELETION':'PRESENT_UNVERIFIED'):'ABSENT',arn:v?.ARN||null,
        versions:Object.keys(v?.VersionIdsToStages||{})});
    }
    await save('secret-metadata.json',secretMetadata);
    const f=await facts();
    manifest=review.prepareReview({facts:f,codeBindingSha256:codeSha,program,readonlyPlan:plan,runtimeCandidate},Date.now());
    await save('manifest.json',manifest);
    await save('result.json',{mode,manifestSha256:manifest.manifestSha256,metadataCalls,sqlConnections:0,sqlCalls:0,
      awsWrites:0,permissionWriteCalls:0,secretValueReads:0,newSlotsConsumed:0,runtimeEnabled:false,readyVerified:false});
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,metadataCalls,
      proposedPermissionWrites:2,secretMetadata,sqlConnections:0,awsWrites:0,slotConsumed:false,runtimeEnabled:false})+'\n');
  }else{
    const approval=()=>review.assertApproval(manifest,args['--approved-sha'],codeSha,program,plan,Date.now());
    if(mode==='Inspect'){
      const runDir=await realpath(args['--run-directory']);
      if(path.dirname(runDir).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4c-run-/.test(path.basename(runDir)))fail('C4C_RUN_DIRECTORY_REJECTED');
      const runSlot=JSON.parse(await readFile(path.join(root,review.RUN_SLOT),'utf8'));
      if(runSlot.manifestSha256!==manifest.manifestSha256)fail('C4C_APPROVED_RUN_SLOT_REQUIRED');
      const runCode=JSON.parse(await readFile(path.join(runDir,'code-binding.json'),'utf8'));
      if(runCode.codeBindingSha256!==codeSha)fail('C4C_APPROVED_RUN_CODE_REQUIRED');
      let record=null;
      for(const name of ['result.json','stopped.json'])try{record=JSON.parse(await readFile(path.join(runDir,name),'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(record&&(record.manifestSha256!==manifest.manifestSha256||record.mode!=='Run'||record.slotConsumed!==true))fail('C4C_APPROVED_RUN_RECORD_REQUIRED');
      // A consumed exact Run slot and matching run-directory code binding
      // allow the already approved independent read even if receipt saving
      // failed. This never permits a Run/write retry or a second Inspect.
    }
    const fresh=await facts();
    if(db.canonicalJson(fresh.binding)!==db.canonicalJson(manifest.facts.binding))fail('C4C_APPROVED_BINDING_CHANGED');
    const snapshot=await credentials();
    if(!snapshot.accessKeyId||!snapshot.secretAccessKey||!snapshot.sessionToken||!(snapshot.expiration instanceof Date)||snapshot.expiration.getTime()<Date.now()+120000)fail('C4C_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const ss=new STSClient({...config,credentials:snapshot});clients.push(ss);identity(await send(ss,new GetCallerIdentityCommand({})));
    const {loadAtsRoots}=requireBackend('./services/saas/aurora_connections_v2');
    const {parseManagementTargetV3}=requireBackend('./services/saas/aurora-express-bootstrap-v3.cjs');
    const {Signer}=requireBackend('@aws-sdk/rds-signer');
    const target=original.continuationInput.bootstrapInput.target;
    parseManagementTargetV3(target);
    const Pg=requireBackend('pg').Client;
    const permitted=new Set(plan.map(q=>q.text).concat('ROLLBACK',...(mode==='Run'?['BEGIN ISOLATION LEVEL REPEATABLE READ',...program.statements]:[])));
    class FixedClient extends Pg{
      connect(...a){if(a.length||++sqlConnections>1)fail('C4C_CONNECTION_BUDGET_REJECTED');return super.connect();}
      query(q,...rest){approval();const text=typeof q==='string'?q:q?.text;
        if(rest.length||++sqlCalls>(mode==='Run'?11:7)||!permitted.has(text))fail('C4C_SQL_SCOPE_REJECTED');
        const wanted=plan.find(p=>p.text===text);
        if(wanted?.values?(typeof q!=='object'||db.canonicalJson(q.values)!==db.canonicalJson(wanted.values)):typeof q!=='string')fail('C4C_SQL_PARAMETERS_REJECTED');
        if(program.statements.includes(text)&&++permissionWriteCalls>2)fail('C4C_PERMISSION_WRITE_BUDGET_REJECTED');return super.query(q);}
    }
    if(target.managementDatabase!=='postgres'||target.managementUsername!=='postgres'||target.endpoint!==binding.endpoint||
      target.clusterResourceId!==binding.clusterResourceId)fail('C4C_MANAGEMENT_BINDING_REQUIRED');
    let signed=false;
    const client=new FixedClient({host:binding.endpoint,port:5432,database:'postgres',user:'postgres',
      password:async()=>{approval();if(signed||snapshot.expiration.getTime()<Date.now()+120000)fail('C4C_SIGNING_REPLAY_OR_EXPIRY');signed=true;
        const token=await new Signer({region:'ca-central-1',hostname:binding.endpoint,port:5432,username:'postgres',credentials:snapshot}).getAuthToken();
        if(typeof token!=='string'||token.length<80||token.length>16384||/[\r\n\0]/.test(token))fail('C4C_TOKEN_INVALID');return token;},
      ssl:{ca:loadAtsRoots(),rejectUnauthorized:true,servername:binding.endpoint,checkServerIdentity:tls.checkServerIdentity,minVersion:'TLSv1.2'},
      connectionTimeoutMillis:30000,query_timeout:15000,options:'-c default_transaction_read_only='+(mode==='Run'?'off':'on')+' -c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000',
      application_name:'techlong-express-c4c-isolation-read'});
    approval();assertDiagnosticFacts(fresh,binding,Date.now());await emptySlot();
    const f=await open(path.join(root,slotName),'wx');slotConsumed=true;
    try{await f.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,consumedAt:new Date().toISOString(),retryAuthorized:false})+'\n');await f.sync();}finally{await f.close();}
    stageJournal=await open(path.join(out,'stages.jsonl'),'wx');
    const journal=async frame=>{await stageJournal.writeFile(JSON.stringify({at:new Date().toISOString(),...frame})+'\n');await stageJournal.sync();};
    phase='CATALOG_CONNECTION';
    const signal=AbortSignal.timeout(90000),kill=()=>{try{client.connection?.stream?.destroy();}catch{/* best effort */}};
    client.on('error',kill);signal.addEventListener('abort',kill,{once:true});
    try{
      await client.connect();signal.throwIfAborted();const stream=client.connection?.stream;
      if(stream?.encrypted!==true||stream.authorized!==true||stream.servername!==binding.endpoint)fail('C4C_CLIENT_TLS_UNPROVEN');
      const observation=await review.execute({client,program,readonlyPlan:plan,inspectOnly:mode==='Inspect',signal,classifyRole:classifyApplicationRoleV6,approval,journal});
      await save('observation.json',observation);await save('result.json',{mode,manifestSha256:manifest.manifestSha256,
        outcome:mode==='Run'?'ISOLATION_COMMITTED_REQUIRES_INDEPENDENT_INSPECT':observation.state==='closed'?'ISOLATION_INDEPENDENTLY_OBSERVED_APP_NOLOGIN':'ISOLATION_ORIGINAL_OPEN_STATE_OBSERVED',metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,awsWrites:0,secretValueReads:0,runtimeEnabled:false,readyVerified:false});
      process.stdout.write(JSON.stringify({mode,directory:out,outcome:mode==='Run'?'ISOLATION_COMMITTED_REQUIRES_INDEPENDENT_INSPECT':observation.state==='closed'?'ISOLATION_INDEPENDENTLY_OBSERVED_APP_NOLOGIN':'ISOLATION_ORIGINAL_OPEN_STATE_OBSERVED',otherConnectableDatabases:observation.role.otherConnectableDatabases,
        metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,awsWrites:0,runtimeEnabled:false})+'\n');
    }finally{kill();signal.removeEventListener('abort',kill);client.password=null;if(client.connectionParameters)client.connectionParameters.password=null;
      let timer;try{await Promise.race([client.end(),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}catch{/* no reconnect */}finally{clearTimeout(timer);}}
  }
}catch(e){
  const code=/^C4C_[A-Z0-9_]+$/.test(e.message||'')?e.message:'C4C_LOCAL_OR_PROVIDER_FAILURE';
  await save('stopped.json',{mode,manifestSha256:manifest?.manifestSha256||null,code,phase,metadataCalls,sqlConnections,sqlCalls,permissionWriteCalls,slotConsumed,awsWrites:0,secretValueReads:0,
    automaticRetries:0,runtimeEnabled:false,readyVerified:false});process.stderr.write(code+'\n');process.exitCode=1;
}finally{for(const c of clients)c.destroy();if(stageJournal)await stageJournal.close();}
