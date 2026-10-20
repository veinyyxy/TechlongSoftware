// Scoped operator entry. Inventory/Prepare are read-only remotely; Install and
// Inspect require the exact reviewed manifest and original permanent slot.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {parseEnv,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {IAMClient,GetRoleCommand} from '@aws-sdk/client-iam';
import {CloudFormationClient,GetTemplateCommand} from '@aws-sdk/client-cloudformation';
import {SecretsManagerClient,DescribeSecretCommand,ListSecretVersionIdsCommand,GetResourcePolicyCommand,CreateSecretCommand,
  PutResourcePolicyCommand,PutSecretValueCommand,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {publisherDatabaseConfigV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {readControlCatalog} from '../platform-controller-review-v6/catalog.mjs';
import {sqlContract,assertInstalled,hash} from '../platform-controller-review-v6/install.mjs';
import {readControlPrivilegesV6} from '../platform-publisher-v6/privileges.mjs';
import {assessLegacyCompatibilityV6} from './compatibility.mjs';
import {A,must,same,secretPolicyV6,verifySecretArnV6,makeCredentialReviewV6,verifyCredentialReviewV6,roleLoginSqlV6,
  assertOnlyLoginChangedV6,installCredentialOnceV6} from './credentials.mjs';
import {FROZEN_V6,prepareAppPublicationObjectsV6} from './publication.mjs';
import {CLOUD_V6 as C} from '../platform-cloud-v6/contract.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
export const FILES=[
  'ops/platform-activation-v6/compatibility.mjs','ops/platform-activation-v6/credentials.mjs','ops/platform-activation-v6/publication.mjs','ops/platform-activation-v6/local.mjs',
  'ops/platform-publisher-v6/io.mjs','ops/platform-publisher-v6/privileges.mjs','ops/platform-controller-review-v6/catalog.mjs',
  'ops/platform-controller-review-v6/install.mjs','ops/platform-controller-v6/install.sql',
  'ops/aws-sandbox/reviews/platform-publisher-v6.legacy-trigger-proposal.json','ops/aws-sandbox/reviews/platform-control-install-v6.executed.json',
  'ops/aws-sandbox/reviews/platform-cloud-v6.verified.json','ops/aws-sandbox/reviews/platform-identity-dispatch-v6.executed.json',
  'ops/platform-cloud-v6/workflows.mjs','ops/platform-cloud-v6/contract.mjs','lib/deployments/execution/hash.ts',
  'lib/deployments/controller-v6/contract.ts','tests/platform-activation-v6.test.mjs',
  'scripts/ci/verify-platform-cloud-publisher-pg-v6.mjs','.github/workflows/platform-cloud-candidate.yml',
  'ops/platform-identity-review-v6/publication.mjs',A.riskFile];
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const exec=promisify(execFile);
async function write(f,value){assertEvidenceSafeV5(value);await writeFile(f,JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function cleanMain(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'CLEAN_MAIN');return head;}
async function ciProof(run,sourceCommit){
  must(/^[1-9][0-9]{0,15}$/.test(run),'CI_ID');const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
  let token=raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);must(token,'GITHUB_READ_AUTH');
  const get=async suffix=>{const r=await fetch('https://api.github.com/repos/veinyyxy/TechlongSoftware/'+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Techlong-Activation-Prepare'}});must(r.status===200,'CI_READ');
    const text=await r.text();must(text.length<256000,'CI_SIZE');return JSON.parse(text);};
  try{const r=await get('actions/runs/'+run),jobs=await get('actions/runs/'+run+'/attempts/1/jobs?per_page=100');
    must(String(r.id)===run&&r.head_sha===sourceCommit&&r.head_branch==='main'&&r.path==='.github/workflows/platform-cloud-candidate.yml'&&r.event==='push'&&
      r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success'&&String(r.repository?.id)==='1323312747'&&r.repository.full_name==='veinyyxy/TechlongSoftware'&&String(r.repository.owner?.id)==='14145707'&&
      jobs.total_count===1&&jobs.jobs?.length===1&&String(jobs.jobs[0].run_id)===run&&jobs.jobs[0].run_attempt===1&&jobs.jobs[0].head_sha===sourceCommit&&jobs.jobs[0].status==='completed'&&jobs.jobs[0].conclusion==='success'&&
      jobs.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success')&&
      jobs.jobs[0].steps.some(s=>s.name==='Exact SQL and actual publisher queries on disposable PostgreSQL'&&s.conclusion==='success')&&
      (await get('branches/main')).commit.sha===sourceCommit,'EXACT_CI');
    return {runId:run,jobId:String(jobs.jobs[0].id),sourceCommit,status:'completed',conclusion:'success',attempt:1};
  }finally{token=undefined;}
}
async function openIo(output,m){
  const env=parseEnv(await readFile(P.root+'/.env.local','utf8')),ownerConfig=await publisherDatabaseConfigV6(env.DATABASE_URL);
  const owner=new pg.Client(ownerConfig);let unhealthy=false;owner.on('error',()=>{unhealthy=true;});
  try{await owner.connect();}catch{try{await owner.end();}catch{/* No retry. */}throw Error('CONTROLLER_CREDENTIAL_OWNER_UNAVAILABLE');}
  const cfg={region:A.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})};
  const sm=new SecretsManagerClient({...cfg,endpoint:'https://secretsmanager.ca-central-1.amazonaws.com'}),sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),
    iam=new IAMClient({...cfg,region:'us-east-1',endpoint:'https://iam.amazonaws.com'}),cfn=new CloudFormationClient({...cfg,endpoint:'https://cloudformation.ca-central-1.amazonaws.com'});
  const send=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
  const record=(name,value)=>write(output+'/'+name+'.json',value);let material,password,secretArn,readPhase='SOURCE';
  const readDatabase=async()=>{must(!unhealthy,'OWNER_SESSION');return {catalog:await readControlCatalog(owner),privileges:await readControlPrivilegesV6(owner)};};
  async function source(){const s=await send(sts,new GetCallerIdentityCommand({}));must(s.Account===A.account&&s.Arn===A.sourceArn&&s.UserId===A.sourceUserId,'SOURCE_IDENTITY');
    return {Account:s.Account,Arn:s.Arn,UserId:s.UserId};}
  async function metadata(arn){verifySecretArnV6(arn);
    const d=await send(sm,new DescribeSecretCommand({SecretId:arn})),p=await send(sm,new GetResourcePolicyCommand({SecretId:arn})),
      v=await send(sm,new ListSecretVersionIdsCommand({SecretId:arn,IncludeDeprecated:true,MaxResults:100}));
    must(d.ARN===arn&&d.Name===A.secretName&&!d.DeletedDate&&!d.RotationEnabled&&!d.ReplicationStatus?.length&&
      d.Tags?.some(t=>t.Key==='ReviewSha256'&&t.Value===m.manifestSha256)&&!v.NextToken&&same(JSON.parse(p.ResourcePolicy),secretPolicyV6()),'SECRET_METADATA');
    return {arn,name:d.Name,kmsKeyId:d.KmsKeyId??null,versions:(v.Versions??[]).map(x=>({id:x.VersionId,stages:x.VersionStages})).sort((a,b)=>a.id.localeCompare(b.id)),policy:JSON.parse(p.ResourcePolicy)};
  }
  const verifyMaterialMetadata=async arn=>{const x=await metadata(arn);must(x.versions.length===1&&x.versions[0].id===A.versionId&&
    same(x.versions[0].stages,['AWSCURRENT'])&&(!x.kmsKeyId||x.kmsKeyId===m.prestate.kms.arn||x.kmsKeyId==='alias/aws/secretsmanager'),'MATERIAL_METADATA');return x;};
  async function verifyDedicated(databaseUrl=material.databaseUrl){
    const u=new URL(databaseUrl);must(u.protocol==='postgresql:'&&decodeURIComponent(u.username)===A.role&&u.hostname===ownerConfig.host&&
      u.pathname==='/'+ownerConfig.database&&(!u.port||u.port==='5432')&&u.password&&!u.hash&&u.searchParams.size===1&&u.searchParams.get('sslmode')==='verify-full','DEDICATED_TARGET');
    const c=new pg.Client({...ownerConfig,user:A.role,password:decodeURIComponent(u.password)});c.on('error',()=>{});
    try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const r=await c.query(`SELECT current_user AS actor,session_user AS session_actor,current_setting('transaction_read_only') AS read_only,
        (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_oid,deployment_control_v6.status() AS plans`);
      const p=r.rows[0];must(r.rows.length===1&&p.actor===A.role&&p.session_actor===A.role&&p.role_oid===A.roleOid&&p.read_only==='on'&&same(p.plans,[]),'DEDICATED_PROOF');
      await c.query('COMMIT');return {roleOid:p.role_oid,roleAuthenticated:true,readOnly:true,emptyControlLedger:true,passwordRecorded:false};
    }finally{await c.end();}
  }
  return {
    readDatabase,record,source,
    async foundation(){const r=await send(cfn,new GetTemplateCommand({StackName:FROZEN_V6.stackId,TemplateStage:'Original'}));
      must(typeof r.TemplateBody==='string','FOUNDATION_JSON');return JSON.parse(r.TemplateBody);},
    async preflight(){try{readPhase='SOURCE';const who=await source();readPhase='NEON';const db=await readDatabase();let secret;
      readPhase='SECRET_ABSENCE';
      try{await send(sm,new DescribeSecretCommand({SecretId:A.secretName}));secret={state:'OCCUPIED'};}
      catch(e){if(e.name!=='ResourceNotFoundException')throw Error('CONTROLLER_CREDENTIAL_SECRET_ABSENCE_UNKNOWN');secret={state:'ABSENT'};}
      readPhase='KMS_METADATA';const kmsOutput=await exec('aws.exe',['kms','describe-key','--key-id','alias/aws/secretsmanager','--profile','techlong-sandbox-user',
        '--region',A.region,'--endpoint-url','https://kms.ca-central-1.amazonaws.com','--output','json','--no-cli-pager'],
        {windowsHide:true,timeout:30000,maxBuffer:32000});
      const k=JSON.parse(kmsOutput.stdout).KeyMetadata;
      must(k?.KeyManager==='AWS'&&k.Enabled===true&&k.KeyState==='Enabled'&&k.Arn.startsWith('arn:aws:kms:'+A.region+':'+A.account+':key/'),'KMS');
      readPhase='INSTALL_ORIGINAL';const original=await readFile('F:/ChatGPT_workshop/techlong-w6f-control-20261020-b/manifest.json');
      must(hash(original)==='29b3cb590d4e098e0503b49564b571a73374cbcaf7a36b957f7bf36493420a3e','INSTALL_ORIGINAL');
      const sql=(await readFile(P.root+'/ops/platform-controller-v6/install.sql','utf8')).replaceAll('\r\n','\n');
      assertInstalled(db.catalog,sqlContract(sql),JSON.parse(original).prestate);
      readPhase='WORKER_ROLE';const role=(await send(iam,new GetRoleCommand({RoleName:'TechlongSandboxGitHubDeploymentWorkerRole'}))).Role;
      must(role?.RoleId===C.roleId&&role.Arn===C.roleArn,'WORKER_ROLE_ID');
      const trust=typeof role.AssumeRolePolicyDocument==='string'?JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument)):role.AssumeRolePolicyDocument;
      return {source:who,...db,secret,kms:{arn:k.Arn,keyManager:k.KeyManager},workerRole:{id:role.RoleId,arn:role.Arn,trust},targetFingerprintSha256:DATABASE_V6.targetFingerprintSha256};
      }catch(e){if(/^CONTROLLER_CREDENTIAL_[A-Z_]+$/.test(e?.message))throw e;throw Error('CONTROLLER_CREDENTIAL_READ_'+readPhase+'_UNAVAILABLE');}
    },
    async assertSource(review){await cleanMain(review.sourceCommit);must(same(await pins(),review.pins),'SOURCE_PINS');},
    claim:v=>write(A.slot,v),
    async createEmpty(){const r=await send(sm,new CreateSecretCommand({Name:A.secretName,Description:'Dedicated platform controller ledger credential V6',
      Tags:[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-controller-v6'},{Key:'ReviewSha256',Value:m.manifestSha256}]}));
      must(r.Name===A.secretName&&!r.VersionId,'EMPTY_CREATE_ACK');secretArn=verifySecretArnV6(r.ARN);return secretArn;},
    async protect(arn,policy){await send(sm,new PutResourcePolicyCommand({SecretId:arn,ResourcePolicy:canonicalJson(policy),BlockPublicPolicy:true}));},
    async verifyEmptyProtected(arn){must((await metadata(arn)).versions.length===0,'EMPTY_PROTECTED');},
    async putMaterial(arn){must(!material,'MATERIAL_ONCE');const bytes=randomBytes(48);password=bytes.toString('base64url');bytes.fill(0);
      const u=new URL(env.DATABASE_URL);u.protocol='postgresql:';u.username=A.role;u.password=password;u.search='';u.searchParams.set('sslmode','verify-full');
      material={schema:'techlong/platform-controller-neon-material/v6',databaseUrl:u.toString()};
      const r=await send(sm,new PutSecretValueCommand({SecretId:arn,ClientRequestToken:A.versionId,SecretString:JSON.stringify(material)}));
      must(r.ARN===arn&&r.Name===A.secretName&&r.VersionId===A.versionId&&same(r.VersionStages,['AWSCURRENT']),'PUT_ACK');},
    verifyMaterialMetadata,
    async activateRole(){const r=await owner.query(roleLoginSqlV6(password));return {commitAcknowledged:Array.isArray(r)&&r.at(-1)?.command==='COMMIT'};},
    verifyDedicated,
    async inspect(review){await source();const post=await readDatabase();
      let secret;try{const d=await send(sm,new DescribeSecretCommand({SecretId:A.secretName}));secretArn=verifySecretArnV6(d.ARN);secret=await verifyMaterialMetadata(secretArn);}
      catch{return {outcome:'CREDENTIAL_PARTIAL_OR_METADATA_UNAVAILABLE_NO_RETRY',roleLogin:post.catalog.role?.login??null,runtimeEnabled:false,retryAllowed:false};}
      assertOnlyLoginChangedV6(review.prestate,post);
      must((await assessLegacyCompatibilityV6(post.privileges,review.proposal,{expectedLogin:true})).eligibleForReviewedCredentialInstall,'INSPECT_COMPATIBILITY');
      await source();
      try{await write(A.inspectSlot,{manifestSha256:review.manifestSha256,secretArn,versionId:A.versionId,claimedAt:Date.now(),maximumSecretReads:1,retryAllowed:false});}
      catch(e){if(e.code==='EEXIST')throw Error('CONTROLLER_CREDENTIAL_INSPECT_SECRET_READ_SLOT_OCCUPIED');throw e;}
      const r=await send(sm,new GetSecretValueCommand({SecretId:secretArn,VersionId:A.versionId,VersionStage:'AWSCURRENT'}));
      must(r.ARN===secretArn&&r.Name===A.secretName&&r.VersionId===A.versionId&&same(r.VersionStages,['AWSCURRENT'])&&
        typeof r.SecretString==='string'&&!r.SecretBinary&&r.SecretString.length<12000,'INSPECT_SECRET_VERSION');
      const value=JSON.parse(r.SecretString);must(value.schema==='techlong/platform-controller-neon-material/v6'&&Object.keys(value).sort().join(',')==='databaseUrl,schema','INSPECT_MATERIAL');
      const dedicated=await verifyDedicated(value.databaseUrl);await record('inspected-database',post);await record('secret-metadata',secret);await record('independent-dedicated-proof',dedicated);
      return {outcome:'CONTROLLER_CREDENTIAL_INDEPENDENTLY_VERIFIED',roleLogin:true,secretArn,versionId:A.versionId,secretValueReads:1,
        dedicatedRoleAuthenticated:true,runtimeEnabled:false,retryAllowed:false};
    },
    async dispose(){material=undefined;password=undefined;env.DATABASE_URL='';sm.destroy();sts.destroy();iam.destroy();cfn.destroy();await owner.end();},
  };
}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!a[args[i]],'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],required=['--mode','--output',...(mode==='Prepare'?['--ci-run']:mode==='Install'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Inventory','Prepare','Install','Inspect'].includes(mode)&&Object.keys(a).length===required.length&&required.every(k=>a[k]),'MODE');
  must(!['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_PATH','DATABASE_URL','AWS_CA_BUNDLE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^PG|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const dir=path.resolve(a['--output']);must(path.dirname(dir).toLowerCase()===path.resolve(P.base).toLowerCase()&&/^techlong-w6h-activation-[a-z0-9-]+$/.test(path.basename(dir)),'OUTPUT');
  let m;if(['Install','Inspect'].includes(mode)){const f=path.resolve(a['--manifest']);must(path.basename(f)==='manifest.json'&&path.dirname(path.dirname(f)).toLowerCase()===path.resolve(P.base).toLowerCase(),'MANIFEST_PATH');
    m=await json(f);await verifyCredentialReviewV6(m,a['--approved-sha'],Date.now(),mode==='Inspect');}
  if(['Prepare','Install'].includes(mode))await absent(A.slot);
  await mkdir(dir);const io=await openIo(dir,m);
  try{let result;
    if(mode==='Inventory'||mode==='Prepare'){
      const prestate=await io.preflight(),proposal=await json(P.root+'/ops/aws-sandbox/reviews/platform-publisher-v6.legacy-trigger-proposal.json');
      const compatibility=await assessLegacyCompatibilityV6(prestate.privileges,proposal);await io.record('prestate',prestate);await io.record('compatibility',compatibility);
      if(mode==='Prepare'){const sourceCommit=await cleanMain(),ci=await ciProof(a['--ci-run'],sourceCommit);
        m=await makeCredentialReviewV6({sourceCommit,pins:await pins(),ci,prestate,proposal,createdAt:Date.now()});await io.record('manifest',m);
        const publication=await prepareAppPublicationObjectsV6({parent:sourceCommit,output:dir,template:await io.foundation()});
        result={outcome:'CREDENTIAL_REVIEW_AND_APP_PUBLICATION_MATERIAL_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,sourceCommit,
          expiresAtUtc:new Date(m.expiresAt).toISOString(),expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
          proposedSecretCount:1,proposedLoginCount:1,proposedAwsWrites:3,publicationApproved:false,reusableCommit:publication.reusable.commit,callerCommit:publication.caller.commit};
      }else result={outcome:'ACTIVATION_METADATA_READ_ONLY',compatibility,secretAbsent:prestate.secret.state==='ABSENT',awsWrites:0,databaseWrites:0};
    }else if(mode==='Install'){
      await ciProof(m.ci.runId,m.sourceCommit);await io.record('approved-manifest',m);
      result=await installCredentialOnceV6({manifest:m,approved:a['--approved-sha'],io});if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{const slot=await json(A.slot);must(slot.manifestSha256===m.manifestSha256&&slot.targetFingerprintSha256===m.prestate.targetFingerprintSha256,'INSPECT_SLOT');result=await io.inspect(m);}
    await io.record('result',{...result,manifestSha256:m?.manifestSha256??null});console.log(JSON.stringify({...result,output:dir},null,2));return result;
  }finally{await io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'CONTROLLER_CREDENTIAL_ENTRY_STOPPED_NO_RETRY',failure:/^[A-Z][A-Z0-9_]{1,100}$/.test(e?.message)?e.message:'DETAILS_WITHHELD',
    errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD'}));process.exitCode=1;
});
