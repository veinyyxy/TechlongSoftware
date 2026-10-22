// Inventory/Prepare never connect to Neon or retrieve a Secret value.
import {readFile,lstat,realpath,open,access,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,BASE,environment,parseTarget} from '../platform-web-database-v1/local.mjs';
import {QUERIES,SESSION_SQL} from '../platform-web-database-v1/catalog.mjs';
import {assertInstalled,LOCK_SQL} from '../platform-web-database-role-v1/contract.mjs';
import {EFFECTIVE_SQL} from '../platform-web-database-role-v1/effective.mjs';
import {C,ROLE,SCOPE,must,hash,canonical,same,sourceOnlyPolicy,passwordSql,assertWebSnapshot,isUuid,safeCode} from './contract.mjs';
import {PROVIDER_SQL,PROOF_SQL} from './database.mjs';
import {awsIo,awsEnvironment} from './aws.mjs';
import {installOnce} from './install.mjs';
export const RISK='docs/aws-platform-hosting-w7m-credential-review.md',TASK_DOC='docs/aws-platform-hosting-w7m-task-handoff.md';
export const INDEX='ops/aws-sandbox/reviews/platform-web-credential-w7m.review.json',CI_PATH='.github/workflows/platform-web-credential-candidate.yml';
export const SLOT=BASE+'/techlong-platform-web-credential-v1.intent.json';
export const B=Object.freeze({
  manifest:{file:BASE+'/techlong-platform-web-role-review-w7l-20261022.json',sha256:'38e987e12585c6494990ac7fc68b0222ee12828a05fd248703885a6f95ac8154'},
  original:{file:BASE+'/techlong-platform-web-db-catalog-8b2005d47002a7361de0b84e95dbff0e.json',sha256:'d351064ef8d7b4fca5266830117286febaca9e8b41fa15621c7718feab9ebf3e'},
  catalog:{file:BASE+'/techlong-platform-web-db-nologin-cdf793b6ecd15dd71c9d8e420928b27e/independent-catalog.json',sha256:'28b83add3de469a950e7e4d02a57db4358875b2d7fa6c7156c089170dd08930f'},
  effective:{file:BASE+'/techlong-platform-web-db-nologin-cdf793b6ecd15dd71c9d8e420928b27e/independent-effective.json',sha256:'ca8fdfe15e08737f10e5cdc154395dacc7ad322c0aa3a9546757314b2d77e3b3'},
  result:{file:BASE+'/techlong-platform-web-db-nologin-cdf793b6ecd15dd71c9d8e420928b27e/result.json',sha256:'0633a871f8cc067d1593a499e8345aa791e5048447863c367ef0b69e59c89715'},
  intent:{file:BASE+'/techlong-platform-web-db-nologin-v1.intent.json',sha256:'eadb07978cd78296c4669874624e5b7f00a91aefee41140a97c55f85c940aa70'},
});
export const SOURCES=Object.freeze(['ops/platform-web-credential-v1/contract.mjs','ops/platform-web-credential-v1/database.mjs',
  'ops/platform-web-credential-v1/aws.mjs','ops/platform-web-credential-v1/install.mjs','ops/platform-web-credential-v1/local.mjs',
  'ops/platform-web-database-role-v1/contract.mjs','ops/platform-web-database-role-v1/effective.mjs','ops/platform-web-database-v1/catalog.mjs',
  'ops/platform-web-database-v1/local.mjs','ops/platform-hosting-v1/database-profile.mjs','ops/platform-hosting-v1/contract.mjs',
  'tests/platform-web-credential-v1.test.mjs','scripts/ci/verify-platform-web-credential-v1.mjs',CI_PATH,RISK,TASK_DOC,'package.json','package-lock.json',
  'ops/aws-sandbox/reviews/platform-web-database-w7l.nologin-observed.json']);
const lf=s=>s.replaceAll('\r\n','\n'),querySha=()=>hash(canonical({QUERIES,SESSION_SQL,EFFECTIVE_SQL,PROVIDER_SQL,PROOF_SQL,LOCK_SQL}));
async function plain(file){for(let p=path.resolve(file);;){must(!(await lstat(p)).isSymbolicLink(),'CREDENTIAL_LINK');const n=path.dirname(p);if(p===n)break;p=n;}
  must((await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'CREDENTIAL_REALPATH');}
async function read(file){await plain(file);const s=await lstat(file);must(s.isFile()&&s.size<3*1024*1024,'CREDENTIAL_FILE_SIZE');return readFile(file,'utf8');}
async function absent(file){try{await access(file);must(false,'CREDENTIAL_SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function write(file,value){await plain(path.dirname(file));const f=await open(file,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}}
function git(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',timeout:15000,windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();}
async function clean(expected){must(git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CREDENTIAL_CLEAN_MAIN');const head=git(['rev-parse','HEAD']);
  if(expected){git(['merge-base','--is-ancestor',expected,head]);must(git(['diff','--name-only',expected,head]).split('\n').filter(Boolean).every(f=>['README.md',INDEX].includes(f)),'CREDENTIAL_SOURCE_DRIFT');}return head;}
async function pins(){return Promise.all(SOURCES.map(async file=>({file,sha256:hash(lf(await read(path.join(ROOT,file))))})));}
async function baseline(){const all={};for(const [k,r]of Object.entries(B)){const t=await read(r.file);must(hash(t)===r.sha256,'CREDENTIAL_BASELINE_FILE');all[k]=JSON.parse(t);}
  must(all.result.outcome==='NOLOGIN_ROLE_INSTALLED_AND_INDEPENDENTLY_VERIFIED'&&all.result.roleOid===C.roleOid&&
    all.result.manifestSha256===B.manifest.sha256&&all.intent.manifestSha256===B.manifest.sha256&&all.manifest.nonce===all.result.nonce,'CREDENTIAL_BASELINE_BINDING');
  assertInstalled(all.catalog,all.original.catalog,C.roleOid);assertWebSnapshot(all.catalog,all.effective.effective,all.catalog,false);
  return {catalog:all.catalog,target:all.manifest.target};}
async function configuration(){const e=parseEnv(await read(path.join(ROOT,'.env.local')));return parseTarget(e.DATABASE_URL);}
function ciCheck(c,head){must(c.schema==='techlong/platform-web-credential-ci/v1'&&c.repositoryId===1323312747&&c.headSha===head&&c.workflowPath===CI_PATH&&
  c.headBranch==='main'&&c.event==='push'&&c.attempt===1&&c.status==='completed'&&c.conclusion==='success'&&Number.isSafeInteger(c.runId)&&c.runId>0&&
  c.jobs?.length===1&&c.jobs[0].conclusion==='success'&&c.jobs[0].steps.length>=8&&c.jobs[0].steps.every(s=>s.conclusion==='success')&&
  c.jobs[0].steps.some(s=>s.name==='Real password authentication and one-shot credential flow on PostgreSQL'),'CREDENTIAL_CI');}
export function validate(text,sha,now=Date.now()){
  must(/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'CREDENTIAL_APPROVAL_SHA');const m=JSON.parse(text);
  must(m.schema==='techlong/platform-web-credential-review/v1'&&/^[a-f0-9]{40}$/.test(m.sourceCommit??'')&&/^[a-f0-9]{32}$/.test(m.nonce??'')&&isUuid(m.versionId)&&
    m.roleOid===C.roleOid&&same(m.scope,SCOPE)&&same(m.baseline,B)&&same(m.policy,sourceOnlyPolicy())&&m.sqlTemplateSha256===hash(passwordSql('X'.repeat(64)))&&
    m.querySha256===querySha()&&m.targetSha256===hash(canonical(m.target))&&same(m.sourcePins?.map(p=>p.file),SOURCES)&&
    m.sourcePins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&m.riskSha256===m.sourcePins.find(p=>p.file===RISK).sha256&&
    m.inventory?.secretAbsent===true&&m.inventory.policyValidated===true&&m.inventory.source?.Account===C.account&&
    m.inventory.source.Arn===C.sourceArn&&m.inventory.source.UserId===C.sourceId&&m.inventory.kms?.keyManager==='AWS'&&
    new RegExp('^arn:aws:kms:'+C.region+':'+C.account+':key/[a-f0-9-]+$').test(m.inventory.kms.arn)&&
    Number.isSafeInteger(m.ciReceipt?.runId)&&m.ciReceipt.runId>0&&m.ciReceipt.file===BASE+'/techlong-platform-web-credential-ci-'+m.ciReceipt.runId+'.json'&&
    /^[a-f0-9]{64}$/.test(m.ciReceipt.sha256??'')&&/^[a-f0-9]{64}$/.test(m.baselineCatalogSha256??''),'CREDENTIAL_REVIEW_BINDING');
  const a=Date.parse(m.issuedAt),b=Date.parse(m.expiresAt),latest=Date.parse(m.latestStartAt);
  must(Number.isFinite(a)&&b-a===C.validMs&&latest===b-600000&&now>=a&&now<latest,'CREDENTIAL_REVIEW_WINDOW');return m;
}
export async function inventory(output){must(/^F:\/ChatGPT_workshop\/techlong-platform-web-credential-inventory-[a-z0-9-]+\.json$/.test(output??''),'CREDENTIAL_INVENTORY_PATH');
  await absent(output);const a=awsIo();try{const value=await a.inventory();await write(output,{schema:'techlong/platform-web-credential-inventory/v1',...value,awsCalls:{...a.calls},awsWrites:0,secretValueReads:0,databaseConnections:0});
    return {mode:'Inventory',output,sourceMatched:true,secretAbsent:true,policyValidated:true,awsWrites:0,secretValueReads:0,databaseConnections:0};}finally{a.dispose();}}
export async function prepare(output,ciFile){must(/^F:\/ChatGPT_workshop\/techlong-platform-web-credential-review-[a-z0-9-]+\.json$/.test(output??'')&&
  /^F:\/ChatGPT_workshop\/techlong-platform-web-credential-ci-[0-9]+\.json$/.test(ciFile??''),'CREDENTIAL_PREPARE_PATH');
  await absent(SLOT);await absent(output);const head=await clean(),ciText=await read(ciFile),ci=JSON.parse(ciText);ciCheck(ci,head);
  const b=await baseline(),{target}=await configuration();must(same(target,b.target),'CREDENTIAL_TARGET');const a=awsIo();let metadata;try{metadata=await a.inventory();}finally{a.dispose();}
  const now=Date.now(),m={schema:'techlong/platform-web-credential-review/v1',sourceCommit:head,nonce:randomBytes(16).toString('hex'),versionId:randomUUID(),roleOid:C.roleOid,
    issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+C.validMs).toISOString(),latestStartAt:new Date(now+C.validMs-600000).toISOString(),
    scope:{...SCOPE},baseline:{...B},baselineCatalogSha256:hash(canonical(b.catalog)),target,targetSha256:hash(canonical(target)),inventory:metadata,
    policy:sourceOnlyPolicy(),sqlTemplateSha256:hash(passwordSql('X'.repeat(64))),querySha256:querySha(),sourcePins:await pins(),riskSha256:hash(lf(await read(path.join(ROOT,RISK)))),
    ciReceipt:{file:ciFile,sha256:hash(ciText),runId:ci.runId},taskHandoff:{jsonKey:'databaseUrl',containerEnvironmentName:'DATABASE_URL',fixedVersionId:true,
      actualArnMustComeFromVerifiedReceipt:true,executionRoleGetValueCurrentlyDenied:true,separatePolicyIamAndDeploymentApprovalRequired:true}};
  const text=JSON.stringify(m,null,2)+'\n';validate(text,hash(text));await write(output,m);
  return {mode:'Prepare',output,manifestSha256:hash(text),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,awsWrites:0,secretValueReads:0,databaseConnections:0};
}
export async function install(file,sha){must(/^F:\/ChatGPT_workshop\/techlong-platform-web-credential-review-[a-z0-9-]+\.json$/.test(file??'')&&/^[a-f0-9]{64}$/.test(sha??''),'CREDENTIAL_INSTALL_ARGUMENTS');
  const m=validate(await read(file),sha);await clean(m.sourceCommit);must(same(await pins(),m.sourcePins),'CREDENTIAL_CODE_DRIFT');
  const ciText=await read(m.ciReceipt.file),ci=JSON.parse(ciText);must(hash(ciText)===m.ciReceipt.sha256&&ci.runId===m.ciReceipt.runId,'CREDENTIAL_CI_DRIFT');ciCheck(ci,m.sourceCommit);
  const b=await baseline(),{target,config}=await configuration();must(same(target,m.target)&&hash(canonical(b.catalog))===m.baselineCatalogSha256,'CREDENTIAL_TARGET_DRIFT');
  await absent(SLOT);const dir=BASE+'/techlong-platform-web-credential-'+m.nonce;await plain(BASE);await mkdir(dir);await plain(dir);
  const secrets=new Set(),record=async(name,value)=>{must(/^[a-z0-9-]+$/.test(name),'CREDENTIAL_RECORD_NAME');const text=JSON.stringify(value);
    must(!/postgres(?:ql)?:\/\/|SCRAM-SHA-256\$/.test(text)&&![...secrets].some(s=>text.includes(s)),'CREDENTIAL_RECORD_REDACTION');await write(path.join(dir,name+'.json'),value);};
  const a=awsIo();let ownerCount=0,dedicatedCount=0;
  async function connect(pgConfig){const {default:pg}=await import('pg'),c=new pg.Client({...pgConfig,application_name:'Techlong-Web-Credential-V1'});c.on('error',()=>{});
    try{await c.connect();return c;}catch(e){try{await c.end();}catch{/* Never reconnect. */}throw e;}}
  try{const result=await installOnce({manifest:m,sha,baseline:b.catalog,io:{aws:a,record,setSensitive:v=>secrets.add(v),
    consume:v=>write(SLOT,v),owner(){must(++ownerCount<=2,'CREDENTIAL_OWNER_ONCE');return connect(config);},
    dedicated(password){must(++dedicatedCount<=1,'CREDENTIAL_AUTH_ONCE');return connect({...config,user:ROLE,password});}}});
    return {mode:'InstallReviewed',output:path.join(dir,'result.json'),...result};
  }finally{secrets.clear();a.dispose();}
}
export async function main(args=process.argv.slice(2)){
  environment();awsEnvironment();const [mode,file,value,...extra]=args;must(!extra.length&&file&&['Inventory','Prepare','InstallReviewed'].includes(mode)&&
    (mode==='Inventory'?!value:!!value),'CREDENTIAL_ARGS');return mode==='Inventory'?inventory(file):mode==='Prepare'?prepare(file,value):install(file,value);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{
  console.log(JSON.stringify(r,null,2));if(r.outcome==='CREDENTIAL_REQUIRES_REVIEW_NO_RETRY')process.exitCode=2;
}).catch(e=>{console.error(JSON.stringify({outcome:'WEB_CREDENTIAL_STOPPED',code:safeCode(e),automaticRetry:false}));process.exitCode=1;});
