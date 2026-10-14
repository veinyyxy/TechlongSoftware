// One fresh reviewed CreateSecret; independent DescribeSecret only. No IAM/SQL/ECS writes.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFile,mkdir,open,access,realpath,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {IAMClient,SimulatePrincipalPolicyCommand,GetRoleCommand,ListRolePoliciesCommand,ListAttachedRolePoliciesCommand,GetRolePolicyCommand,GetPolicyCommand,GetPolicyVersionCommand} from '@aws-sdk/client-iam';
import {SecretsManagerClient,DescribeSecretCommand,CreateSecretCommand} from '@aws-sdk/client-secrets-manager';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import {sha256Hex} from '../../../lib/deployments/execution/hash.ts';
import {validateExistingExpressBinding,assertDiagnosticFacts} from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
import {C4D_SCOPE,C4D_RUN_SLOT,C4D_INSPECT_SLOT,C4D_PRIVATE_DIRECTORY,C4D_PAYMENT_BINDING_SHA,
  prepareRuntimeSecretReviewC4d,assertRuntimeSecretApprovalC4d,generateRuntimeSecretMaterialC4d,observeRuntimeSecretC4d,runtimeIamNextStepC4d,compileRuntimeSecretExposureC4d} from '../../../lib/deployments/execution/express-runtime-secret-c4d.ts';
const root=path.resolve('F:/ChatGPT_workshop'),platform=fileURLToPath(new URL('../../../',import.meta.url));
const backend='E:/NodejsProject/SpeedFeast_Backend_main',requireBackend=createRequire(path.join(backend,'package.json')),cli=promisify(execFile);
const hash=v=>createHash('sha256').update(v).digest('hex'),fail=code=>{throw Error(code);};
const raw=process.argv.slice(2),pairs=[];
if(raw.length%2)fail('C4D_ARGUMENTS_REJECTED');
for(let n=0;n<raw.length;n+=2)pairs.push([raw[n],raw[n+1]]);
const args=Object.fromEntries(pairs),mode=args['--mode'],out=path.resolve(args['--output']||'');
if(new Set(pairs.map(p=>p[0])).size!==pairs.length||!['Review','Run','Inspect'].includes(mode)||
  Object.keys(args).some(k=>!['--mode','--manifest','--approved-sha','--output'].includes(k))||Object.values(args).some(v=>!v)||
  path.dirname(out).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4d-[a-z0-9-]+$/.test(path.basename(out))||
  mode==='Review'&&(args['--manifest']||args['--approved-sha'])||mode!=='Review'&&(!args['--manifest']||!args['--approved-sha']))fail('C4D_ARGUMENTS_REJECTED');
await mkdir(out);
const save=async(name,v)=>{const f=await open(path.join(out,name),'wx');try{await f.writeFile(JSON.stringify(v,null,2)+'\n');await f.sync();}finally{await f.close();}};
let metadataCalls=0,awsWriteCalls=0,privateMaterialReads=0,slotConsumed=false,phase='LOCAL_BINDING',manifest,journal;
const clients=[];
const emptySlot=async(name)=>{try{await access(path.join(root,name));fail('C4D_SLOT_OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}};
const consumeSlot=async(name)=>{const f=await open(path.join(root,name),'wx');slotConsumed=true;try{
  await f.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,versionToken:manifest.request.ClientRequestToken,consumedAt:new Date().toISOString(),retryAuthorized:false})+'\n');await f.sync();
}finally{await f.close();}};
const stage=async(kind,extra={})=>{if(!journal)journal=await open(path.join(out,'stages.jsonl'),'wx');await journal.writeFile(JSON.stringify({at:new Date().toISOString(),kind,...extra})+'\n');await journal.sync();};
try{
  if(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','DATABASE_URL','PGPASSWORD'].some(k=>process.env[k])||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('C4D_ENV_CONFLICT');
  const previous=path.join(root,'techlong-d002-express-c4c-inspect-20261014-r1');
  const history={'observation.json':'624478cdb00bac5fd9c2c566400955eb6adf37e18150c16f3dc6b01c5fe9c262',
    'result.json':'442b39f64cab2a12646f4366a4c3c23650348bebfc0f1bf50f516f11dd7f48cc',
    'code-binding.json':'30c90fd407202574023d1f4992fd575998404e28d52a279281a7485d1b432ce1'};
  for(const [name,sha]of Object.entries(history))if(hash(await readFile(path.join(previous,name)))!==sha)fail('C4D_ISOLATION_HISTORY_CHANGED');
  for(const [name,sha]of [['techlong-d002-express-c4c-isolation-write-v1.permanent-slot.json','3d53727c6b8385a790fe419ec9154355e71a3329793ebac3fa647d7354b0b80e'],
    ['techlong-d002-express-c4c-isolation-inspect-v1.permanent-slot.json','6cddecb4e3a8ecd6e97e9335679ee4eafe9ca0f237c0ca29ec06560bc85d287e']])
    if(hash(await readFile(path.join(root,name)))!==sha)fail('C4D_ISOLATION_HISTORY_CHANGED');
  const obs=JSON.parse(await readFile(path.join(previous,'observation.json'),'utf8'));
  if(obs.state!=='closed'||obs.role.otherConnectableDatabases!==0||obs.loginEnabled||obs.applicationGrantsInstalled||
    obs.databaseAclDigest!=='0251a30e18af71c2bd73a3880eadda1d00845fcbaf619c599cac88b5b2323d87')fail('C4D_ISOLATION_HISTORY_REJECTED');
  const old=JSON.parse(await readFile(path.join(previous,'code-binding.json'),'utf8'));
  if(old.pins.length!==248||old.tools.length!==2||db.digest({pins:old.pins,tools:old.tools})!=='1c7f2d876cb60b7895b3a70a4631ea0f4d6349a81b5f6c44ea0ac3868807bdf6')fail('C4D_CODE_BINDING_REJECTED');
  const pins=[...old.pins];
  for(const p of pins)if(hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n'))!==p.sha256)fail('C4D_BOUND_CODE_CHANGED');
  for(const t of old.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('C4D_BOUND_TOOL_CHANGED');
  for(const name of ['ops/aws-sandbox/scripts/review-express-runtime-secret-c4d.mjs','lib/deployments/execution/express-runtime-secret-c4d.ts','tests/express-runtime-secret-c4d.test.ts'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha=db.digest({pins,tools:old.tools});
  await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:old.tools,history});
  const originalBytes=await readFile(path.join(root,'techlong-d002-express-c4c-review-20261014-r2/manifest.json'));
  if(hash(originalBytes)!=='7d97ac474a1da4e72e4f5d0a10af67ec56cda4beee43c739422446ce9829818e')fail('C4D_ISOLATION_HISTORY_CHANGED');
  const original=JSON.parse(originalBytes.toString('utf8'));
  const binding=validateExistingExpressBinding(original.facts.binding);
  // Non-secret binding files only. The private-material JSON is not read by Review/Inspect.
  const privateDir=path.join(root,C4D_PRIVATE_DIRECTORY);
  const safeLocal=async(name)=>{const p=path.join(privateDir,name);if((await realpath(p)).toLowerCase()!==p.toLowerCase())fail('C4D_LOCAL_SOURCE_LINK_REJECTED');return readFile(p);};
  const summaryBytes=await safeLocal('summary.json'),bindingBytes=await safeLocal('binding.json');
  if(hash(summaryBytes)!=='9daf504a6d4cd3b281cb9632f41c45085d6f531f6af96680e44f05c8a805fd63'||
    hash(bindingBytes)!=='ab89566fc889b0ea7f4eeb1e818b7ce0ae02c330c88a71cf6924e18562d91bd9')fail('C4D_PAYMENT_BINDING_CHANGED');
  const sourceBinding=JSON.parse(bindingBytes.toString('utf8'));
  if(await sha256Hex(sourceBinding)!==C4D_PAYMENT_BINDING_SHA||db.canonicalJson({...C4D_SCOPE,appInstanceId:sourceBinding.scope.appInstanceId,
    workspaceId:sourceBinding.workspaceId,productId:sourceBinding.productId,environmentId:sourceBinding.scope.environmentId,cellKey:sourceBinding.plan.cellKey})!==db.canonicalJson(C4D_SCOPE))fail('C4D_PAYMENT_BINDING_CHANGED');
  const slot=mode==='Inspect'?C4D_INSPECT_SLOT:C4D_RUN_SLOT;
  await emptySlot(slot);if(mode==='Review')await emptySlot(C4D_INSPECT_SLOT);
  if(mode!=='Review'){
    const p=await realpath(args['--manifest']);
    if(path.basename(p)!=='manifest.json'||path.dirname(path.dirname(p)).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4d-/.test(path.basename(path.dirname(p))))fail('C4D_MANIFEST_PATH_REJECTED');
    manifest=JSON.parse(await readFile(p,'utf8'));
    assertRuntimeSecretApprovalC4d(manifest,args['--approved-sha'],codeSha,Date.now());
    if(mode==='Inspect'){
      const runSlot=JSON.parse(await readFile(path.join(root,C4D_RUN_SLOT),'utf8'));
      if(runSlot.manifestSha256!==manifest.manifestSha256||runSlot.versionToken!==manifest.request.ClientRequestToken||runSlot.retryAuthorized!==false)fail('C4D_APPROVED_RUN_SLOT_REQUIRED');
    }
  }
  phase='AWS_METADATA';
  const credentials=fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
  const config={region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true},rdsSdk=requireBackend('@aws-sdk/client-rds');
  const sts=new STSClient(config),iam=new IAMClient(config),rds=new rdsSdk.RDSClient(config),secrets=new SecretsManagerClient(config);clients.push(sts,iam,rds,secrets);
  const send=async(client,command,absent=false)=>{
    if(!['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','SimulatePrincipalPolicyCommand','DescribeSecretCommand',
      'GetRoleCommand','ListRolePoliciesCommand','ListAttachedRolePoliciesCommand','GetRolePolicyCommand','GetPolicyCommand','GetPolicyVersionCommand'].includes(command.constructor.name)||++metadataCalls>16)fail('C4D_METADATA_SCOPE_REJECTED');
    try{return await client.send(command,{abortSignal:AbortSignal.timeout(30000)});}catch(e){
      if(absent&&e.name==='ResourceNotFoundException')return null;
      const code={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED'}[e.name];
      fail('C4D_'+(code||'METADATA_PROVIDER_FAILED'));
    }
  };
  const identity=v=>{if(v.Account!=='402010193138'||v.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||v.UserId!=='AIDAV3GNMXTZEO7SHLC2X')fail('C4D_SOURCE_CHANGED');return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};};
  const facts=async()=>{
    const source=identity(await send(sts,new GetCallerIdentityCommand({})));
    const cs=(await send(rds,new rdsSdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters,c=cs?.[0];
    if(cs?.length!==1||c.MasterUsername!=='postgres'||c.MasterUserSecret||!c.IAMDatabaseAuthenticationEnabled||!c.InternetAccessGatewayEnabled||c.VPCNetworkingEnabled!==false||
      c.DeletionProtection!==false||c.DBClusterMembers?.length!==1||c.DBClusterMembers[0].DBInstanceIdentifier!==binding.writerIdentifier||!c.DBClusterMembers[0].IsClusterWriter||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration)!==db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))fail('C4D_CLUSTER_CHANGED');
    const ins=(await send(rds,new rdsSdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances,i=ins?.[0];
    if(ins?.length!==1||i.DBClusterIdentifier!=='techlong-sandbox-express-d001'||i.DBInstanceClass!=='db.serverless')fail('C4D_WRITER_CHANGED');
    const current=validateExistingExpressBinding({...binding,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,
      endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    const resource=`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const ev=(await send(iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:source.Arn,ActionNames:['rds-db:connect'],ResourceArns:[resource]}))).EvaluationResults;
    if(ev?.length!==1)fail('C4D_SOURCE_SIMULATION_CHANGED');
    if(++metadataCalls>16)fail('C4D_METADATA_SCOPE_REJECTED');
    let plan;try{const v=await cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
      '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:30000,maxBuffer:16384,windowsHide:true,
      env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}});plan=JSON.parse(v.stdout);}catch{fail('C4D_PLAN_METADATA_UNAVAILABLE');}
    const e=ev[0],f={observedAt:new Date().toISOString(),source,binding:current,plan,connectPermission:{action:e.EvalActionName,resource:e.EvalResourceName,decision:e.EvalDecision,missingContext:e.MissingContextValues||[]}};
    assertDiagnosticFacts(f,binding,Date.now());return f;
  };
  const candidateName='techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1';
  const oldName='techlong/sandbox/tenant/a0da1748bc4d5419/runtime/g1';
  const fresh=await facts();
  const exposure=async()=>{
    const name='TechlongSandboxTaskExecutionRole',boundaryArn='arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary';
    const r=(await send(iam,new GetRoleCommand({RoleName:name}))).Role;
    const ins=await send(iam,new ListRolePoliciesCommand({RoleName:name})),ats=await send(iam,new ListAttachedRolePoliciesCommand({RoleName:name}));
    if(ins.IsTruncated||ats.IsTruncated||r?.PermissionsBoundary?.PermissionsBoundaryArn!==boundaryArn||
      db.canonicalJson(ins.PolicyNames)!==db.canonicalJson(['PullSandboxImageAndRuntimeSecrets'])||ats.AttachedPolicies?.length!==0)fail('C4D_EXISTING_SECRET_EXPOSURE_CHANGED');
    const p=await send(iam,new GetRolePolicyCommand({RoleName:name,PolicyName:'PullSandboxImageAndRuntimeSecrets'}));
    const b=(await send(iam,new GetPolicyCommand({PolicyArn:boundaryArn}))).Policy;
    const v=(await send(iam,new GetPolicyVersionCommand({PolicyArn:boundaryArn,VersionId:b?.DefaultVersionId}))).PolicyVersion;
    if(p.RoleName!==name||p.PolicyName!=='PullSandboxImageAndRuntimeSecrets'||b?.Arn!==boundaryArn||v?.VersionId!==b.DefaultVersionId||!v.IsDefaultVersion)fail('C4D_EXISTING_SECRET_EXPOSURE_CHANGED');
    const doc=raw=>{const d=typeof raw==='string'?JSON.parse(decodeURIComponent(raw)):raw;if(!d||typeof d!=='object'||Array.isArray(d)||Buffer.byteLength(db.canonicalJson(d))>100000)fail('C4D_POLICY_METADATA_REJECTED');return d;};
    const input={roleId:r.RoleId,roleArn:r.Arn,boundaryArn,boundaryPolicyId:b.PolicyId,defaultVersion:b.DefaultVersionId,
      inlinePolicyNames:ins.PolicyNames,attachedPolicyArns:[],inlineDocument:doc(p.PolicyDocument),boundaryDocument:doc(v.Document)};
    const result=compileRuntimeSecretExposureC4d(input);await save('existing-secret-exposure.json',{...result,policyMetadata:input});return result;
  };
  if(mode==='Review'){
    const e=await exposure();
    for(const name of [candidateName,oldName])if(await send(secrets,new DescribeSecretCommand({SecretId:name}),true))fail('C4D_SECRET_NAME_OCCUPIED');
    manifest=prepareRuntimeSecretReviewC4d({facts:fresh,exposure:e,codeBindingSha256:codeSha,versionToken:randomUUID(),now:Date.now()});
    await save('manifest.json',manifest);await save('iam-next-step.json',runtimeIamNextStepC4d(manifest));
    await save('result.json',{mode,manifestSha256:manifest.manifestSha256,metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,runtimeEnabled:false});
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed})+'\n');
  }else{
    const approval=()=>assertRuntimeSecretApprovalC4d(manifest,args['--approved-sha'],codeSha,Date.now());
    if(db.canonicalJson(fresh.binding)!==db.canonicalJson(manifest.facts.binding))fail('C4D_APPROVED_BINDING_CHANGED');
    if(mode==='Run'){
      if(db.canonicalJson(await exposure())!==db.canonicalJson(manifest.exposure))fail('C4D_EXISTING_SECRET_EXPOSURE_CHANGED');
      for(const name of [candidateName,oldName])if(await send(secrets,new DescribeSecretCommand({SecretId:name}),true))fail('C4D_SECRET_NAME_OCCUPIED');
      const snapshot=await credentials();
      if(!snapshot.accessKeyId||!snapshot.secretAccessKey||!snapshot.sessionToken||!(snapshot.expiration instanceof Date)||snapshot.expiration.getTime()<Date.now()+120000)fail('C4D_CREDENTIAL_SNAPSHOT_TOO_SHORT');
      const ss=new STSClient({...config,credentials:snapshot}),writer=new SecretsManagerClient({...config,credentials:snapshot});clients.push(ss,writer);
      identity(await send(ss,new GetCallerIdentityCommand({})));
      phase='PRIVATE_SOURCE_ACL';
      const file=path.join(privateDir,'private-material.json');
      if((await realpath(file)).toLowerCase()!==file.toLowerCase()||(await stat(file)).size>65536)fail('C4D_PRIVATE_PATH_REJECTED');
      const aclScript="$ErrorActionPreference='Stop'; $taskPrincipal=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; " +
        "$taskFolderAcl=Get-Acl -LiteralPath $env:TECHLONG_C4D_SOURCE_DIR; if(-not $taskFolderAcl.AreAccessRulesProtected){throw 'ACL'}; " +
        "foreach($taskAclPath in @($env:TECHLONG_C4D_SOURCE_DIR,$env:TECHLONG_C4D_SOURCE_FILE)){ $taskAcl=Get-Acl -LiteralPath $taskAclPath; " +
        "$taskRules=@($taskAcl.Access); if($taskRules.Count -ne 2){throw 'ACL'}; foreach($taskRule in $taskRules){ " +
        "$taskSid=$taskRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; " +
        "if($taskSid -notin @($taskPrincipal,'S-1-5-18') -or $taskRule.AccessControlType -ne 'Allow' -or $taskRule.FileSystemRights -ne 'FullControl'){throw 'ACL'} }}; 'VERIFIED'";
      const aclEnv={...process.env,TECHLONG_C4D_SOURCE_DIR:privateDir,TECHLONG_C4D_SOURCE_FILE:file};
      for(const key of Object.keys(aclEnv))if(key.toLowerCase()==='psmodulepath')delete aclEnv[key];
      try{const a=await cli('powershell.exe',['-NoProfile','-NonInteractive','-Command',aclScript],{env:aclEnv,windowsHide:true,timeout:15000,maxBuffer:1024});
        if(a.stdout.trim()!=='VERIFIED')fail('C4D_PRIVATE_ACL_UNPROVEN');}catch{fail('C4D_PRIVATE_ACL_UNPROVEN');}
      approval();assertDiagnosticFacts(fresh,binding,Date.now());await emptySlot(C4D_RUN_SLOT);await consumeSlot(C4D_RUN_SLOT);
      phase='PRIVATE_SOURCE_AND_CREATE';
      let rawPrivate,privateJson,material,request,command;
      try{
        privateMaterialReads++;rawPrivate=await readFile(file);privateJson=JSON.parse(rawPrivate.toString('utf8'));
        material=generateRuntimeSecretMaterialC4d({stripeSecretKey:privateJson.stripeSecretKey,stripeWebhookSecret:privateJson.stripeWebhookSecret});
        request={...manifest.request,SecretString:JSON.stringify(material)};
        approval();assertDiagnosticFacts(fresh,binding,Date.now());if(snapshot.expiration.getTime()<Date.now()+120000)fail('C4D_CREDENTIAL_SNAPSHOT_TOO_SHORT');
        await stage('CREATE_SECRET_INTENT',{name:manifest.candidate.name,versionId:manifest.request.ClientRequestToken});
        approval();if(++awsWriteCalls>1)fail('C4D_CREATE_BUDGET_REJECTED');
        command=new CreateSecretCommand(request);
        const response=await writer.send(command,{abortSignal:AbortSignal.timeout(30000)});
        if(response.Name!==candidateName||response.VersionId!==manifest.request.ClientRequestToken||typeof response.ARN!=='string'||
          !new RegExp('^arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+candidateName+'-[A-Za-z0-9]{6}$').test(response.ARN))fail('C4D_CREATE_RESPONSE_REQUIRES_INSPECT');
        await stage('CREATE_SECRET_OBSERVED',{arn:response.ARN,versionId:response.VersionId});
        await save('created.json',{name:response.Name,arn:response.ARN,versionId:response.VersionId,manifestSha256:manifest.manifestSha256,secretValuesIncluded:false});
        await save('result.json',{mode,manifestSha256:manifest.manifestSha256,outcome:'SECRET_CREATE_OBSERVED_REQUIRES_INDEPENDENT_INSPECT',metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,runtimeEnabled:false});
      }finally{rawPrivate?.fill(0);if(privateJson)for(const k of Object.keys(privateJson))privateJson[k]=undefined;
        if(material)for(const k of Object.keys(material))material[k]=undefined;if(request)request.SecretString=undefined;if(command)command.input.SecretString=undefined;}
      process.stdout.write(JSON.stringify({mode,directory:out,outcome:'SECRET_CREATE_OBSERVED_REQUIRES_INDEPENDENT_INSPECT',metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed})+'\n');
    }else{
      approval();await emptySlot(C4D_INSPECT_SLOT);await consumeSlot(C4D_INSPECT_SLOT);phase='INDEPENDENT_SECRET_METADATA';
      const metadata=await send(secrets,new DescribeSecretCommand({SecretId:candidateName}),true);
      let outcome='SECRET_ABSENT_REQUIRES_REVIEW';
      if(metadata){const observed=observeRuntimeSecretC4d(manifest,metadata);await save('runtime-binding.json',observed);await save('iam-next-step.json',runtimeIamNextStepC4d(manifest,observed));
        outcome='SECRET_METADATA_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED';}
      await save('result.json',{mode,manifestSha256:manifest.manifestSha256,outcome,metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,secretContentsVerified:false,runtimeEnabled:false});
      process.stdout.write(JSON.stringify({mode,directory:out,outcome,metadataCalls,privateMaterialReads,awsWriteCalls,slotConsumed})+'\n');
    }
  }
}catch(e){
  const code=/^C4D_[A-Z0-9_]+$/.test(e.message||'')?e.message:'C4D_LOCAL_OR_PROVIDER_FAILURE';
  await save('stopped.json',{mode,manifestSha256:manifest?.manifestSha256??null,code,phase,metadataCalls,awsWriteCalls,privateMaterialReads,slotConsumed,
    sqlConnections:0,secretValueReads:0,automaticRetries:0,requiresIndependentInspect:slotConsumed&&mode==='Run',runtimeEnabled:false});
  process.stderr.write(code+'\n');process.exitCode=1;
}finally{for(const c of clients)c.destroy();if(journal)await journal.close();}
