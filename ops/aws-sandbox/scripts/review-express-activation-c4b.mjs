// Review reads AWS metadata only. Inspect requires fresh exact approval and
// performs one fixed management-catalog transaction, never application SQL.
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
import review from '../../../lib/deployments/execution/express-activation-inventory-c4b.cjs';
import {validateExistingExpressBinding,assertDiagnosticFacts} from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
const root=path.resolve('F:/ChatGPT_workshop'),backend='E:/NodejsProject/SpeedFeast_Backend_main';
const platform=fileURLToPath(new URL('../../../',import.meta.url)),requireBackend=createRequire(path.join(backend,'package.json'));
const hash=v=>createHash('sha256').update(v).digest('hex'),fail=code=>{throw Error(code);},cli=promisify(execFile);
const raw=process.argv.slice(2),pairs=[];
if(raw.length%2)fail('C4B_ARGUMENTS_REJECTED');
for(let i=0;i<raw.length;i+=2)pairs.push([raw[i],raw[i+1]]);
const args=Object.fromEntries(pairs),mode=args['--mode'],out=path.resolve(args['--output']||'');
if(new Set(pairs.map(p=>p[0])).size!==pairs.length||!['Review','Inspect'].includes(mode)||
  Object.keys(args).some(k=>!['--mode','--manifest','--approved-sha','--output'].includes(k))||
  Object.values(args).some(v=>typeof v!=='string'||!v)||path.dirname(out).toLowerCase()!==root.toLowerCase()||
  !/^techlong-d002-express-c4b-[a-z0-9-]+$/.test(path.basename(out))||
  mode==='Review'&&(args['--manifest']||args['--approved-sha'])||mode==='Inspect'&&(!args['--manifest']||!args['--approved-sha']))fail('C4B_ARGUMENTS_REJECTED');
await mkdir(out);
const save=async(name,value)=>{const f=await open(path.join(out,name),'wx');try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}};
let metadataCalls=0,sqlConnections=0,sqlCalls=0,slotConsumed=false,phase='LOCAL_BINDING',manifest;
const clients=[];
try{
  if(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLCERT','PGSSLKEY'].some(k=>process.env[k])||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('C4B_ENV_CONFLICT');
  const previousDir=path.join(root,'techlong-d002-express-c4a-prepared-20261014-r3');
  const cap=JSON.parse(await readFile(path.join(platform,'ops/aws-sandbox/reviews/aurora-express-c4a-application.prepared.json'),'utf8'));
  if(cap.candidateSha256!=='6a61880217d944c18c797ae1910e63fd8bbd6acbb6e4af27c915b585fa16486d')fail('C4B_PREDECESSOR_REJECTED');
  for(const [name,sha]of Object.entries(cap.files))if(hash(await readFile(path.join(previousDir,name)))!==sha)fail('C4B_PREDECESSOR_FILE_CHANGED');
  const old=JSON.parse(await readFile(path.join(previousDir,'code-binding.json'),'utf8'));
  if(old.pins.length!==240||old.tools.length!==2||db.digest({pins:old.pins,tools:old.tools})!==cap.codeBindingSha256)fail('C4B_CODE_BINDING_REJECTED');
  const pins=[...old.pins];
  for(const p of pins)if(hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n'))!==p.sha256)fail('C4B_BOUND_CODE_CHANGED');
  for(const t of old.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('C4B_BOUND_TOOL_CHANGED');
  for(const [name,sha]of old.evidence)if(hash(await readFile(path.join(root,name)))!==sha)fail('C4B_HISTORY_CHANGED');
  for(const name of ['ops/aws-sandbox/scripts/review-express-activation-c4b.mjs','lib/deployments/execution/express-activation-inventory-c4b.cjs','tests/express-activation-inventory-c4b.test.mjs'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha=db.digest({pins,tools:old.tools});
  await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:old.tools,predecessorCandidateSha256:cap.candidateSha256});
  const original=JSON.parse(await readFile(path.join(root,'techlong-d002-express-c3d-review-20261014-r2/manifest.json'),'utf8'));
  const binding=validateExistingExpressBinding(original.expectedBinding);
  const secretCandidate=JSON.parse(await readFile(path.join(previousDir,'secret-candidate.json'),'utf8'));
  const {ROLE_DIRECTORY_SQL}=requireBackend('./services/saas/aurora_role_directory_v2');
  const {classifyApplicationRoleV6}=requireBackend('./services/saas/aurora-express-application-v6.cjs');
  const plan=review.sqlPlan(ROLE_DIRECTORY_SQL),emptySlot=async()=>{try{await access(path.join(root,review.SLOT));fail('C4B_SLOT_OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}};
  await emptySlot();
  if(mode==='Inspect'){
    const f=await realpath(args['--manifest']);
    if(path.basename(f)!=='manifest.json'||path.dirname(path.dirname(f)).toLowerCase()!==root.toLowerCase()||
      !/^techlong-d002-express-c4b-/.test(path.basename(path.dirname(f))))fail('C4B_MANIFEST_PATH_REJECTED');
    manifest=JSON.parse(await readFile(f,'utf8'));
    review.assertApproval(manifest,args['--approved-sha'],codeSha,plan,Date.now()); // before credentials/AWS/SQL/slot
  }
  phase='AWS_METADATA';
  const credentials=fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
  const config={region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true},rdsSdk=requireBackend('@aws-sdk/client-rds');
  const sts=new STSClient(config),iam=new iamSdk.IAMClient(config),rds=new rdsSdk.RDSClient(config),secrets=new SecretsManagerClient(config);
  clients.push(sts,iam,rds,secrets);
  const send=async(client,command,absent=false)=>{
    const allowed=['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand',
      'GetRoleCommand','ListRolePoliciesCommand','ListAttachedRolePoliciesCommand','GetRolePolicyCommand','GetPolicyCommand','GetPolicyVersionCommand','DescribeSecretCommand'];
    if(!allowed.includes(command.constructor.name)||++metadataCalls>(mode==='Review'?42:7))fail('C4B_METADATA_BUDGET_REJECTED');
    try{return await client.send(command,{abortSignal:AbortSignal.timeout(30000)});}catch(e){
      if(absent&&e.name==='ResourceNotFoundException')return null;
      const codes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',
        AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED',AbortError:'METADATA_TIMEOUT',TimeoutError:'METADATA_TIMEOUT'};
      fail('C4B_'+(codes[e.name]||'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity=v=>{if(v.Account!=='402010193138'||v.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||v.UserId!=='AIDAV3GNMXTZEO7SHLC2X')fail('C4B_SOURCE_CHANGED');
    return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};};
  const facts=async()=>{
    const source=identity(await send(sts,new GetCallerIdentityCommand({})));
    const cs=(await send(rds,new rdsSdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters,c=cs?.[0];
    if(cs?.length!==1||c.DBClusterMembers?.length!==1||c.DBClusterMembers[0].DBInstanceIdentifier!==binding.writerIdentifier||!c.DBClusterMembers[0].IsClusterWriter||
      c.MasterUsername!=='postgres'||c.MasterUserSecret||!c.IAMDatabaseAuthenticationEnabled||!c.InternetAccessGatewayEnabled||c.VPCNetworkingEnabled!==false||
      c.DeletionProtection!==false||db.canonicalJson(c.ServerlessV2ScalingConfiguration)!==db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))fail('C4B_CLUSTER_CHANGED');
    const is=(await send(rds,new rdsSdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances,i=is?.[0];
    if(is?.length!==1||i.DBClusterIdentifier!=='techlong-sandbox-express-d001'||i.DBInstanceClass!=='db.serverless')fail('C4B_WRITER_CHANGED');
    const current=validateExistingExpressBinding({manifestSha256:binding.manifestSha256,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,
      createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,
      writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    const arn=`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const evals=(await send(iam,new iamSdk.SimulatePrincipalPolicyCommand({PolicySourceArn:source.Arn,ActionNames:['rds-db:connect'],ResourceArns:[arn]}))).EvaluationResults;
    if(evals?.length!==1)fail('C4B_CONNECT_SIMULATION_AMBIGUOUS');
    if(++metadataCalls>(mode==='Review'?42:7))fail('C4B_METADATA_BUDGET_REJECTED');
    let planState;try{const r=await cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
      '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:30000,maxBuffer:16384,
      env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}});planState=JSON.parse(r.stdout);}catch{fail('C4B_PLAN_METADATA_UNAVAILABLE');}
    const p=evals[0],v={observedAt:new Date().toISOString(),source,binding:current,plan:planState,
      connectPermission:{action:p.EvalActionName,resource:p.EvalResourceName,decision:p.EvalDecision,missingContext:p.MissingContextValues||[]}};
    assertDiagnosticFacts(v,binding,Date.now());return v;
  };
  if(mode==='Review'){
    const doc=v=>{try{const r=typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;if(!r||typeof r!=='object'||Array.isArray(r)||Buffer.byteLength(db.canonicalJson(r))>100000)fail('C4B_POLICY_METADATA_REJECTED');return r;}catch{fail('C4B_POLICY_METADATA_REJECTED');}};
    const roles=[],policies=new Map();
    const expected=[['TechlongSandboxTaskRole','AROAV3GNMXTZLH2AU5I5G'],['TechlongSandboxTenantLifecycleTaskRole','AROAV3GNMXTZDIWVT3BKN'],['TechlongSandboxTaskExecutionRole','AROAV3GNMXTZJHJWAN4IR']];
    const policyArn=arn=>{if(typeof arn!=='string'||!/^arn:aws:iam::402010193138:policy\/[A-Za-z0-9+=,.@_/-]{1,512}$/.test(arn))fail('C4B_FOREIGN_POLICY_REJECTED');return arn;};
    for(const [name,id]of expected){
      const r=(await send(iam,new iamSdk.GetRoleCommand({RoleName:name}))).Role;
      if(r?.RoleName!==name||r.RoleId!==id||r.Arn!==`arn:aws:iam::402010193138:role/${name}`)fail('C4B_ROLE_ID_CHANGED');
      const ins=await send(iam,new iamSdk.ListRolePoliciesCommand({RoleName:name})),ats=await send(iam,new iamSdk.ListAttachedRolePoliciesCommand({RoleName:name}));
      if(ins.IsTruncated||ats.IsTruncated||!Array.isArray(ins.PolicyNames)||ins.PolicyNames.length>4||!Array.isArray(ats.AttachedPolicies)||ats.AttachedPolicies.length>2)fail('C4B_ROLE_POLICY_INVENTORY_BUDGET_REJECTED');
      const inline=[];
      for(const n of ins.PolicyNames){const p=await send(iam,new iamSdk.GetRolePolicyCommand({RoleName:name,PolicyName:n}));
        if(p.RoleName!==name||p.PolicyName!==n)fail('C4B_INLINE_CHANGED');inline.push({name:n,document:doc(p.PolicyDocument)});}
      const attached=ats.AttachedPolicies.map(p=>policyArn(p.PolicyArn)),boundary=r.PermissionsBoundary?.PermissionsBoundaryArn;
      if(!boundary)fail('C4B_BOUNDARY_MISSING');
      for(const arn of [...attached,policyArn(boundary)])policies.set(arn,null);
      roles.push({name,roleId:id,arn:r.Arn,trust:doc(r.AssumeRolePolicyDocument),boundaryArn:boundary,attached,inline});
    }
    if(policies.size>7)fail('C4B_MANAGED_POLICY_BUDGET_REJECTED');
    for(const arn of policies.keys()){
      const p=(await send(iam,new iamSdk.GetPolicyCommand({PolicyArn:arn}))).Policy;
      if(p?.Arn!==arn||!/^v[1-9][0-9]*$/.test(p.DefaultVersionId||''))fail('C4B_MANAGED_POLICY_CHANGED');
      const v=(await send(iam,new iamSdk.GetPolicyVersionCommand({PolicyArn:arn,VersionId:p.DefaultVersionId}))).PolicyVersion;
      if(!v?.IsDefaultVersion||v.VersionId!==p.DefaultVersionId)fail('C4B_POLICY_VERSION_CHANGED');
      policies.set(arn,{arn,policyId:p.PolicyId,defaultVersion:p.DefaultVersionId,document:doc(v.Document)});
    }
    const s=await send(secrets,new DescribeSecretCommand({SecretId:secretCandidate.name}),true);
    let secret={name:secretCandidate.name,state:'ABSENT',arn:null,versionIds:[]};
    if(s){if(s.Name!==secretCandidate.name||typeof s.ARN!=='string'||!s.ARN.startsWith(`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${secretCandidate.name}-`))fail('C4B_SECRET_METADATA_CHANGED');
      secret={name:s.Name,state:s.DeletedDate?'PENDING_DELETION':'PRESENT_UNVERIFIED',arn:s.ARN,versionIds:Object.keys(s.VersionIdsToStages||{})};}
    await save('iam-metadata.json',{roles,policies:[...policies.values()],effectivePermissionsVerified:false});
    await save('secret-metadata.json',secret);
    const summary={roles:roles.map(r=>({name:r.name,roleId:r.roleId,arn:r.arn,boundaryArn:r.boundaryArn,
      trustSha256:db.digest(r.trust),attached:r.attached,inline:r.inline.map(p=>({name:p.name,sha256:db.digest(p.document)}))})),
      policies:[...policies.values()].map(p=>({arn:p.arn,policyId:p.policyId,defaultVersion:p.defaultVersion,sha256:db.digest(p.document)})),
      secret,effectivePermissionsVerified:false,secretValuesRead:false};
    const f=await facts();
    manifest=review.prepareReview({facts:f,metadataSummary:summary,codeBindingSha256:codeSha,predecessorSha256:cap.candidateSha256,plan},Date.now());
    await save('manifest.json',manifest);
    await save('result.json',{mode,manifestSha256:manifest.manifestSha256,metadataCalls,sqlConnections:0,sqlCalls:0,
      awsWrites:0,secretValueReads:0,newSlotsConsumed:0,runtimeEnabled:false,readyVerified:false});
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,metadataCalls,
      roles:summary.roles.map(r=>({name:r.name,roleId:r.roleId})),secret,sqlConnections:0,awsWrites:0,slotConsumed:false})+'\n');
  }else{
    const approval=()=>review.assertApproval(manifest,args['--approved-sha'],codeSha,plan,Date.now());
    const fresh=await facts();
    if(db.canonicalJson(fresh.binding)!==db.canonicalJson(manifest.facts.binding))fail('C4B_APPROVED_BINDING_CHANGED');
    const snapshot=await credentials();
    if(!snapshot.accessKeyId||!snapshot.secretAccessKey||!snapshot.sessionToken||!(snapshot.expiration instanceof Date)||snapshot.expiration.getTime()<Date.now()+120000)fail('C4B_CREDENTIAL_SNAPSHOT_TOO_SHORT');
    const ss=new STSClient({...config,credentials:snapshot});clients.push(ss);identity(await send(ss,new GetCallerIdentityCommand({})));
    const {loadAtsRoots}=requireBackend('./services/saas/aurora_connections_v2');
    const {parseManagementTargetV3}=requireBackend('./services/saas/aurora-express-bootstrap-v3.cjs');
    const {Signer}=requireBackend('@aws-sdk/rds-signer');
    const target=original.continuationInput.bootstrapInput.target;
    parseManagementTargetV3(target);
    const Pg=requireBackend('pg').Client;
    const permitted=new Set(plan.map(q=>q.text).concat('ROLLBACK'));
    class FixedClient extends Pg{
      connect(...a){if(a.length||++sqlConnections>1)fail('C4B_CONNECTION_BUDGET_REJECTED');return super.connect();}
      query(q,...rest){approval();const text=typeof q==='string'?q:q?.text;
        if(rest.length||++sqlCalls>7||!permitted.has(text))fail('C4B_SQL_SCOPE_REJECTED');
        const wanted=plan.find(p=>p.text===text);
        if(wanted?.values?(typeof q!=='object'||db.canonicalJson(q.values)!==db.canonicalJson(wanted.values)):typeof q!=='string')fail('C4B_SQL_PARAMETERS_REJECTED');return super.query(q);}
    }
    if(target.managementDatabase!=='postgres'||target.managementUsername!=='postgres'||target.endpoint!==binding.endpoint||
      target.clusterResourceId!==binding.clusterResourceId)fail('C4B_MANAGEMENT_BINDING_REQUIRED');
    let signed=false;
    const client=new FixedClient({host:binding.endpoint,port:5432,database:'postgres',user:'postgres',
      password:async()=>{approval();if(signed||snapshot.expiration.getTime()<Date.now()+120000)fail('C4B_SIGNING_REPLAY_OR_EXPIRY');signed=true;
        const token=await new Signer({region:'ca-central-1',hostname:binding.endpoint,port:5432,username:'postgres',credentials:snapshot}).getAuthToken();
        if(typeof token!=='string'||token.length<80||token.length>16384||/[\r\n\0]/.test(token))fail('C4B_TOKEN_INVALID');return token;},
      ssl:{ca:loadAtsRoots(),rejectUnauthorized:true,servername:binding.endpoint,checkServerIdentity:tls.checkServerIdentity,minVersion:'TLSv1.2'},
      connectionTimeoutMillis:30000,query_timeout:15000,options:'-c default_transaction_read_only=on -c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000',
      application_name:'techlong-express-c4b-isolation-read'});
    approval();assertDiagnosticFacts(fresh,binding,Date.now());await emptySlot();
    const f=await open(path.join(root,review.SLOT),'wx');slotConsumed=true;
    try{await f.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,consumedAt:new Date().toISOString(),retryAuthorized:false})+'\n');await f.sync();}finally{await f.close();}
    phase='CATALOG_CONNECTION';
    const signal=AbortSignal.timeout(90000),kill=()=>{try{client.connection?.stream?.destroy();}catch{/* best effort */}};
    client.on('error',kill);signal.addEventListener('abort',kill,{once:true});
    try{
      await client.connect();signal.throwIfAborted();const stream=client.connection?.stream;
      if(stream?.encrypted!==true||stream.authorized!==true||stream.servername!==binding.endpoint)fail('C4B_CLIENT_TLS_UNPROVEN');
      const observation=await review.inspectCatalog(client,{plan,signal,classifyRole:classifyApplicationRoleV6,approval});
      await save('observation.json',observation);await save('result.json',{mode,manifestSha256:manifest.manifestSha256,
        outcome:observation.state,metadataCalls,sqlConnections,sqlCalls,slotConsumed,awsWrites:0,secretValueReads:0,runtimeEnabled:false,readyVerified:false});
      process.stdout.write(JSON.stringify({mode,directory:out,outcome:observation.state,otherConnectableDatabases:observation.otherConnectableDatabases,
        metadataCalls,sqlConnections,sqlCalls,slotConsumed,awsWrites:0,runtimeEnabled:false})+'\n');
    }finally{kill();signal.removeEventListener('abort',kill);client.password=null;if(client.connectionParameters)client.connectionParameters.password=null;
      let timer;try{await Promise.race([client.end(),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}catch{/* no reconnect */}finally{clearTimeout(timer);}}
  }
}catch(e){
  const code=/^C4B_[A-Z0-9_]+$/.test(e.message||'')?e.message:'C4B_LOCAL_OR_PROVIDER_FAILURE';
  await save('stopped.json',{mode,code,phase,metadataCalls,sqlConnections,sqlCalls,slotConsumed,awsWrites:0,secretValueReads:0,
    automaticRetries:0,runtimeEnabled:false,readyVerified:false});process.stderr.write(code+'\n');process.exitCode=1;
}finally{for(const c of clients)c.destroy();}
