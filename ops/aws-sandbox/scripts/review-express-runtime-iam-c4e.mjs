// Fixed three-write IAM install and independent metadata readback. No SQL/Secret-value/ECS client.
import path from 'node:path';
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
import review from '../../../lib/deployments/execution/express-runtime-iam-c4e.cjs';
import {observeRuntimeSecretC4d} from '../../../lib/deployments/execution/express-runtime-secret-c4d.ts';
import {validateExistingExpressBinding,assertDiagnosticFacts} from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
const root=path.resolve('F:/ChatGPT_workshop'),platform=fileURLToPath(new URL('../../../',import.meta.url));
const requireBackend=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json'),cli=promisify(execFile),hash=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Error(code);},raw=process.argv.slice(2),pairs=[];
if(raw.length%2)fail('C4E_ARGUMENTS_REJECTED');
for(let n=0;n<raw.length;n+=2)pairs.push([raw[n],raw[n+1]]);
const args=Object.fromEntries(pairs),mode=args['--mode'],out=path.resolve(args['--output']||'');
if(new Set(pairs.map(p=>p[0])).size!==pairs.length||!['Review','Run','Inspect'].includes(mode)||
  Object.keys(args).some(k=>!['--mode','--manifest','--approved-sha','--output'].includes(k))||Object.values(args).some(v=>!v)||
  path.dirname(out).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4e-[a-z0-9-]+$/.test(path.basename(out))||
  mode==='Review'&&(args['--manifest']||args['--approved-sha'])||mode!=='Review'&&(!args['--manifest']||!args['--approved-sha']))fail('C4E_ARGUMENTS_REJECTED');
await mkdir(out);
const save=async(name,v)=>{const f=await open(path.join(out,name),'wx');try{await f.writeFile(JSON.stringify(v,null,2)+'\n');await f.sync();}finally{await f.close();}};
let metadataCalls=0,iamWriteCalls=0,slotConsumed=false,phase='LOCAL_BINDING',manifest,journal;
const clients=[],emptySlot=async(name)=>{try{await access(path.join(root,name));fail('C4E_SLOT_OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}};
const stage=async(kind,extra)=>{if(!journal)journal=await open(path.join(out,'stages.jsonl'),'wx');await journal.writeFile(JSON.stringify({at:new Date().toISOString(),kind,...extra})+'\n');await journal.sync();};
try{
  if(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','DATABASE_URL','PGPASSWORD'].some(k=>process.env[k])||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('C4E_ENV_CONFLICT');
  const previous=path.join(root,'techlong-d002-express-c4d-inspect-20261014-r1');
  const history={'runtime-binding.json':'123fe1eaf9be362b460e52efe4754ed68e84f297f67fcc30764e77b79f2b0194',
    'result.json':'5ac9ce81abda1b7b6c3623898f7350dbe2543d1d9b3bceb032e213b9ff299606','code-binding.json':'34437bd30a180cd73f147f8ee5f1d37dac1b7fb7eae294e37cdb3271e7f9f6f2'};
  for(const [name,sha]of Object.entries(history))if(hash(await readFile(path.join(previous,name)))!==sha)fail('C4E_SECRET_HISTORY_CHANGED');
  for(const [name,sha]of [['techlong-d002-express-c4d-secret-create-v1.permanent-slot.json','ff070dd1d12cb34dc592240c1bdb7f0694a178e00fd2d516db99629f293eec2a'],
    ['techlong-d002-express-c4d-secret-inspect-v1.permanent-slot.json','379d377cb51b9d1cf80779108476df2092794d30c156fe42922045479489e202']])
    if(hash(await readFile(path.join(root,name)))!==sha)fail('C4E_SECRET_HISTORY_CHANGED');
  const old=JSON.parse(await readFile(path.join(previous,'code-binding.json'),'utf8'));
  if(old.pins.length!==251||old.tools.length!==2||db.digest({pins:old.pins,tools:old.tools})!=='7bcb167477a91756f2a136af524199072913a9b875570cb495381b0f57437703')fail('C4E_CODE_BINDING_REJECTED');
  const pins=[...old.pins];
  for(const p of pins)if(hash((await readFile(path.join(p.repo,p.name),'utf8')).replace(/\r\n/g,'\n'))!==p.sha256)fail('C4E_BOUND_CODE_CHANGED');
  for(const t of old.tools)if(hash(await readFile(t.filename))!==t.sha256)fail('C4E_BOUND_TOOL_CHANGED');
  for(const name of ['ops/aws-sandbox/scripts/review-express-runtime-iam-c4e.mjs','lib/deployments/execution/express-runtime-iam-c4e.cjs','tests/express-runtime-iam-c4e.test.mjs'])
    pins.push({repo:platform,name,sha256:hash((await readFile(path.join(platform,name),'utf8')).replace(/\r\n/g,'\n'))});
  const codeSha=db.digest({pins,tools:old.tools});await save('code-binding.json',{codeBindingSha256:codeSha,pins,tools:old.tools,history});
  const oldManifestBytes=await readFile(path.join(root,'techlong-d002-express-c4d-review-20261014-r5/manifest.json'));
  if(hash(oldManifestBytes)!=='4d0e0353d2c3aead3ce51ad87259de2104b07aa883199817349a6a3e1d66dbb1')fail('C4E_SECRET_HISTORY_CHANGED');
  const oldManifest=JSON.parse(oldManifestBytes.toString('utf8')),binding=validateExistingExpressBinding(oldManifest.facts.binding);
  const slot=mode==='Inspect'?review.INSPECT_SLOT:review.RUN_SLOT;await emptySlot(slot);if(mode==='Review')await emptySlot(review.INSPECT_SLOT);
  if(mode!=='Review'){
    const f=await realpath(args['--manifest']);
    if(path.basename(f)!=='manifest.json'||path.dirname(path.dirname(f)).toLowerCase()!==root.toLowerCase()||!/^techlong-d002-express-c4e-/.test(path.basename(path.dirname(f))))fail('C4E_MANIFEST_PATH_REJECTED');
    manifest=JSON.parse(await readFile(f,'utf8'));review.approval(manifest,args['--approved-sha'],codeSha,Date.now());
    if(mode==='Inspect'){const s=JSON.parse(await readFile(path.join(root,review.RUN_SLOT),'utf8'));
      if(s.manifestSha256!==manifest.manifestSha256||s.retryAuthorized!==false)fail('C4E_APPROVED_RUN_SLOT_REQUIRED');}
  }
  phase='AWS_METADATA';
  const credentials=fromLoginCredentials({profile:'techlong-sandbox-user',clientConfig:{maxAttempts:1,ignoreConfiguredEndpointUrls:true}});
  const config={region:'ca-central-1',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true},rdsSdk=requireBackend('@aws-sdk/client-rds');
  const iam=new iamSdk.IAMClient(config),sts=new STSClient(config),rds=new rdsSdk.RDSClient(config),secrets=new SecretsManagerClient(config);clients.push(iam,sts,rds,secrets);
  const allowed=['GetCallerIdentityCommand','DescribeDBClustersCommand','DescribeDBInstancesCommand','DescribeSecretCommand','GetRoleCommand','ListRolePoliciesCommand','ListAttachedRolePoliciesCommand',
    'GetRolePolicyCommand','GetPolicyCommand','GetPolicyVersionCommand','ListPolicyVersionsCommand','ListEntitiesForPolicyCommand','SimulatePrincipalPolicyCommand','SimulateCustomPolicyCommand'];
  const send=async(client,command)=>{if(!allowed.includes(command.constructor.name)||++metadataCalls>48)fail('C4E_METADATA_SCOPE_REJECTED');
    try{return await client.send(command,{abortSignal:AbortSignal.timeout(30000)});}catch(e){const codes={CredentialsProviderError:'SOURCE_CREDENTIALS_UNAVAILABLE',ExpiredToken:'SOURCE_TOKEN_EXPIRED',ExpiredTokenException:'SOURCE_TOKEN_EXPIRED',AccessDenied:'METADATA_ACCESS_DENIED',AccessDeniedException:'METADATA_ACCESS_DENIED'};
      fail('C4E_'+(codes[e.name]||'METADATA_PROVIDER_FAILED'));}};
  const identity=v=>{if(v.Account!=='402010193138'||v.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||v.UserId!=='AIDAV3GNMXTZEO7SHLC2X')fail('C4E_SOURCE_CHANGED');return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};};
  const facts=async()=>{
    const source=identity(await send(sts,new GetCallerIdentityCommand({})));
    const cs=(await send(rds,new rdsSdk.DescribeDBClustersCommand({DBClusterIdentifier:'techlong-sandbox-express-d001'}))).DBClusters,c=cs?.[0];
    if(cs?.length!==1||c.MasterUsername!=='postgres'||c.MasterUserSecret||!c.IAMDatabaseAuthenticationEnabled||!c.InternetAccessGatewayEnabled||c.VPCNetworkingEnabled!==false||
      c.DeletionProtection!==false||c.DBClusterMembers?.length!==1||c.DBClusterMembers[0].DBInstanceIdentifier!==binding.writerIdentifier||!c.DBClusterMembers[0].IsClusterWriter||
      db.canonicalJson(c.ServerlessV2ScalingConfiguration)!==db.canonicalJson({MinCapacity:0,MaxCapacity:1,SecondsUntilAutoPause:300}))fail('C4E_CLUSTER_CHANGED');
    const ins=(await send(rds,new rdsSdk.DescribeDBInstancesCommand({DBInstanceIdentifier:binding.writerIdentifier}))).DBInstances,i=ins?.[0];
    if(ins?.length!==1||i.DBClusterIdentifier!=='techlong-sandbox-express-d001'||i.DBInstanceClass!=='db.serverless')fail('C4E_WRITER_CHANGED');
    const current=validateExistingExpressBinding({...binding,clusterArn:c.DBClusterArn,clusterResourceId:c.DbClusterResourceId,createdAt:c.ClusterCreateTime?.toISOString(),engineVersion:c.EngineVersion,
      endpoint:c.Endpoint,port:c.Port,writerIdentifier:i.DBInstanceIdentifier,writerArn:i.DBInstanceArn,writerResourceId:i.DbiResourceId,writerCreatedAt:i.InstanceCreateTime?.toISOString(),
      tags:Object.fromEntries((c.TagList||[]).map(t=>[t.Key,t.Value])),clusterStatus:c.Status,writerStatus:i.DBInstanceStatus});
    const resource=`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`;
    const ev=(await send(iam,new iamSdk.SimulatePrincipalPolicyCommand({PolicySourceArn:source.Arn,ActionNames:['rds-db:connect'],ResourceArns:[resource]}))).EvaluationResults;
    if(ev?.length!==1)fail('C4E_SOURCE_SIMULATION_CHANGED');
    if(++metadataCalls>48)fail('C4E_METADATA_SCOPE_REJECTED');
    let plan;try{const x=await cli('aws',['freetier','get-account-plan-state','--profile','techlong-sandbox-user','--region','ca-central-1','--no-cli-pager','--output','json',
      '--query','{planType:accountPlanType,planStatus:accountPlanStatus}'],{timeout:30000,maxBuffer:16384,windowsHide:true,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true',AWS_CLI_AUTO_PROMPT:'off'}});plan=JSON.parse(x.stdout);}catch{fail('C4E_PLAN_METADATA_UNAVAILABLE');}
    const e=ev[0],f={observedAt:new Date().toISOString(),source,binding:current,plan,connectPermission:{action:e.EvalActionName,resource:e.EvalResourceName,decision:e.EvalDecision,missingContext:e.MissingContextValues||[]}};
    assertDiagnosticFacts(f,binding,Date.now());return f;
  };
  const doc=raw=>{const d=typeof raw==='string'?JSON.parse(decodeURIComponent(raw)):raw;if(!d||typeof d!=='object'||Array.isArray(d)||Buffer.byteLength(db.canonicalJson(d))>100000)fail('C4E_POLICY_METADATA_REJECTED');return d;};
  const inventory=async()=>{
    const roles=await Promise.all(Object.keys(review.ROLE_IDS).map(async name=>{
      const [rr,ins,ats]=await Promise.all([send(iam,new iamSdk.GetRoleCommand({RoleName:name})),send(iam,new iamSdk.ListRolePoliciesCommand({RoleName:name})),send(iam,new iamSdk.ListAttachedRolePoliciesCommand({RoleName:name}))]);
      const r=rr.Role;if(ins.IsTruncated||ats.IsTruncated||!Array.isArray(ins.PolicyNames)||ins.PolicyNames.length>2||ats.AttachedPolicies?.length)fail('C4E_ROLE_INVENTORY_CHANGED');
      const inline=[];for(const PolicyName of ins.PolicyNames){const p=await send(iam,new iamSdk.GetRolePolicyCommand({RoleName:name,PolicyName}));if(p.RoleName!==name||p.PolicyName!==PolicyName)fail('C4E_INLINE_ID_CHANGED');inline.push({name:PolicyName,document:doc(p.PolicyDocument)});}
      return {name,id:r?.RoleId,arn:r?.Arn,trust:doc(r?.AssumeRolePolicyDocument),boundaryArn:r?.PermissionsBoundary?.PermissionsBoundaryArn,attached:[],inline:inline.sort((a,b)=>a.name.localeCompare(b.name)),
        tags:Object.fromEntries((r.Tags||[]).map(t=>[t.Key,t.Value]))};
    }));
    const PolicyArn=review.BOUNDARY,[p,v,b,a]=await Promise.all([send(iam,new iamSdk.GetPolicyCommand({PolicyArn})),send(iam,new iamSdk.ListPolicyVersionsCommand({PolicyArn})),
      send(iam,new iamSdk.ListEntitiesForPolicyCommand({PolicyArn,PolicyUsageFilter:'PermissionsBoundary',MaxItems:100})),send(iam,new iamSdk.ListEntitiesForPolicyCommand({PolicyArn,PolicyUsageFilter:'PermissionsPolicy',MaxItems:100}))]);
    if(v.IsTruncated||b.IsTruncated||a.IsTruncated||p.Policy?.Arn!==PolicyArn)fail('C4E_POLICY_INVENTORY_CHANGED');
    const version=await send(iam,new iamSdk.GetPolicyVersionCommand({PolicyArn,VersionId:p.Policy.DefaultVersionId}));
    if(!version.PolicyVersion?.IsDefaultVersion||version.PolicyVersion.VersionId!==p.Policy.DefaultVersionId)fail('C4E_DEFAULT_VERSION_CHANGED');
    const entities=x=>({roles:(x.PolicyRoles||[]).map(r=>({name:r.RoleName,id:r.RoleId})).sort((a,b)=>a.name.localeCompare(b.name)),
      users:(x.PolicyUsers||[]).map(r=>({name:r.UserName,id:r.UserId})).sort((a,b)=>a.name.localeCompare(b.name)),groups:(x.PolicyGroups||[]).map(r=>({name:r.GroupName,id:r.GroupId})).sort((a,b)=>a.name.localeCompare(b.name))});
    return {roles:roles.sort((a,b)=>a.name.localeCompare(b.name)),boundary:{arn:PolicyArn,id:p.Policy.PolicyId,defaultVersion:p.Policy.DefaultVersionId,document:doc(version.PolicyVersion.Document),
      versions:v.Versions.map(x=>({id:x.VersionId,isDefault:x.IsDefaultVersion})).sort((a,b)=>a.id.localeCompare(b.id)),boundaryConsumers:entities(b),permissionConsumers:entities(a)}};
  };
  const checkSecret=async()=>{const m=await send(secrets,new DescribeSecretCommand({SecretId:review.SECRET})),o=observeRuntimeSecretC4d(oldManifest,m);
    if(o.binding.runtimeSecret.arn!==review.SECRET||o.binding.runtimeSecret.versionId!==review.VERSION)fail('C4E_ACTUAL_SECRET_CHANGED');};
  const sourceWrites=async(p)=>{const results=[];for(const a of p.actions){const action='iam:'+a.api,resource=a.input.PolicyArn||`arn:aws:iam::402010193138:role/${a.input.RoleName}`;
      const ev=(await send(iam,new iamSdk.SimulatePrincipalPolicyCommand({PolicySourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',ActionNames:[action],ResourceArns:[resource]}))).EvaluationResults;
      if(ev?.length!==1||ev[0].EvalActionName!==action||ev[0].EvalResourceName!==resource||ev[0].EvalDecision!=='allowed'||ev[0].MissingContextValues?.length)fail('C4E_SOURCE_WRITE_SIMULATION_DENIED');
      results.push({action,resource,decision:ev[0].EvalDecision});}await save('source-write-simulations.json',results);};
  const checkPolicies=async(p)=>{const results=[];for(const c of review.simulations(p)){const r=await send(iam,new iamSdk.SimulateCustomPolicyCommand(c.input));
      const safe={name:c.name,input:c.input,results:review.simulationRows(r).map(x=>({action:x.EvalActionName,resource:x.EvalResourceName,decision:x.EvalDecision,missingContext:x.MissingContextValues||[]}))};
      await save('simulation-'+c.name+'.json',safe);review.checkSimulation(c,r);results.push(safe);}await save('policy-simulations.json',results);};
  identity(await send(sts,new GetCallerIdentityCommand({})));
  const current=await inventory();await save('iam-metadata.json',current);await checkSecret();
  const program=mode==='Inspect'?manifest.program:review.compile(current);await save('program.json',program);
  if(mode!=='Inspect'){await sourceWrites(program);await checkPolicies(program);}
  const fresh=await facts();
  if(mode==='Review'){
    manifest=review.prepare({facts:fresh,inventory:current,codeBindingSha256:codeSha,program,now:Date.now()});await save('manifest.json',manifest);
    await save('result.json',{mode,manifestSha256:manifest.manifestSha256,metadataCalls,iamWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,runtimeEnabled:false});
    process.stdout.write(JSON.stringify({mode,directory:out,manifestSha256:manifest.manifestSha256,expiresAt:manifest.expiresAt,boundaryPolicyBytes:program.boundaryPolicyBytes,sharedBoundaryConsumers:7,metadataCalls,iamWriteCalls,slotConsumed})+'\n');
  }else{
    const approval=()=>review.approval(manifest,args['--approved-sha'],codeSha,Date.now());
    if(db.canonicalJson(fresh.binding)!==db.canonicalJson(manifest.facts.binding))fail('C4E_APPROVED_BINDING_CHANGED');
    if(mode==='Run'&&db.canonicalJson(current)!==db.canonicalJson(manifest.inventory))fail('C4E_APPROVED_IAM_CHANGED');
    let writer;
    if(mode==='Run'){const snapshot=await credentials();if(!snapshot.accessKeyId||!snapshot.secretAccessKey||!snapshot.sessionToken||!(snapshot.expiration instanceof Date)||snapshot.expiration.getTime()<Date.now()+120000)fail('C4E_CREDENTIAL_SNAPSHOT_TOO_SHORT');
      const ss=new STSClient({...config,credentials:snapshot});writer=new iamSdk.IAMClient({...config,credentials:snapshot});clients.push(ss,writer);identity(await send(ss,new GetCallerIdentityCommand({})));}
    approval();assertDiagnosticFacts(fresh,binding,Date.now());await emptySlot(slot);
    const f=await open(path.join(root,slot),'wx');slotConsumed=true;try{await f.writeFile(JSON.stringify({manifestSha256:manifest.manifestSha256,consumedAt:new Date().toISOString(),retryAuthorized:false})+'\n');await f.sync();}finally{await f.close();}
    if(mode==='Run'){
      phase='IAM_INSTALL';const receipts=[];
      for(const a of program.actions){approval();if(++iamWriteCalls>3)fail('C4E_WRITE_BUDGET_REJECTED');await stage('IAM_WRITE_INTENT',{api:a.api,resource:a.input.PolicyArn||a.input.RoleName,requestSha256:db.digest(a.input)});
        const Command={CreatePolicyVersion:iamSdk.CreatePolicyVersionCommand,PutRolePolicy:iamSdk.PutRolePolicyCommand}[a.api];if(!Command)fail('C4E_WRITE_SCOPE_REJECTED');
        const r=await writer.send(new Command(a.input),{abortSignal:AbortSignal.timeout(30000)});
        if(a.api==='CreatePolicyVersion'&&(!r.PolicyVersion?.IsDefaultVersion||!/^v[1-9][0-9]*$/.test(r.PolicyVersion.VersionId)))fail('C4E_BOUNDARY_RESPONSE_REQUIRES_INSPECT');
        const receipt={api:a.api,resource:a.input.PolicyArn||a.input.RoleName,requestSha256:db.digest(a.input),newDefaultVersion:a.api==='CreatePolicyVersion'?r.PolicyVersion.VersionId:null};
        receipts.push(receipt);await stage('IAM_WRITE_OBSERVED',receipt);
      }
      await save('write-receipts.json',receipts);
      await save('result.json',{mode,manifestSha256:manifest.manifestSha256,outcome:'IAM_INSTALL_RESPONSES_OBSERVED_REQUIRES_INDEPENDENT_INSPECT',metadataCalls,iamWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,runtimeEnabled:false});
      process.stdout.write(JSON.stringify({mode,directory:out,outcome:'IAM_INSTALL_RESPONSES_OBSERVED_REQUIRES_INDEPENDENT_INSPECT',metadataCalls,iamWriteCalls,slotConsumed})+'\n');
    }else{
      phase='INDEPENDENT_IAM_INSPECT';const outcome=review.inspect(manifest.inventory,current,program);
      if(outcome==='IAM_DOCUMENTS_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED')await checkPolicies(program);
      await save('result.json',{mode,manifestSha256:manifest.manifestSha256,outcome,metadataCalls,iamWriteCalls,slotConsumed,actualDefaultVersion:current.boundary.defaultVersion,sqlConnections:0,secretValueReads:0,effectiveAccessVerified:false,runtimeEnabled:false});
      process.stdout.write(JSON.stringify({mode,directory:out,outcome,metadataCalls,iamWriteCalls,slotConsumed})+'\n');
    }
  }
}catch(e){const code=/^C4E_[A-Z0-9_]+$/.test(e.message||'')?e.message:'C4E_LOCAL_OR_PROVIDER_FAILURE';
  await save('stopped.json',{mode,manifestSha256:manifest?.manifestSha256??null,code,phase,metadataCalls,iamWriteCalls,slotConsumed,sqlConnections:0,secretValueReads:0,privateMaterialReads:0,automaticRetries:0,requiresIndependentInspect:slotConsumed&&mode==='Run',runtimeEnabled:false});process.stderr.write(code+'\n');process.exitCode=1;
}finally{for(const c of clients)c.destroy();if(journal)await journal.close();}
