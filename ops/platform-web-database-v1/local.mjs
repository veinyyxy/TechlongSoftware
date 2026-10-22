// Prepare is offline. ReadReviewed is one explicitly approved Neon catalog session.
import {readFile,lstat,realpath,open,access} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {QUERIES,SESSION_SQL,PROFILE,readCatalog,assess,must} from './catalog.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const BASE='F:/ChatGPT_workshop',SLOT=BASE+'/techlong-platform-web-db-catalog-v1.intent.json';
export const RISK='docs/aws-platform-hosting-w7k-database-catalog-review.md';
export const PUBLIC_REVIEW='ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-review.json';
export const CI_PATH='.github/workflows/platform-web-database-candidate.yml';
export const SOURCES=Object.freeze(['ops/platform-web-database-v1/catalog.mjs','ops/platform-web-database-v1/local.mjs',
  'ops/platform-hosting-v1/database-profile.mjs','tests/platform-web-database-v1.test.mjs',
  'scripts/ci/verify-platform-web-catalog-v1.mjs',CI_PATH,RISK,'package.json','package-lock.json',
  'ops/aws-sandbox/reviews/platform-publication-w7j.verified.json']);
export const SCOPE=Object.freeze({connections:1,metadataSelects:7,readOnlyTransactions:1,sessionLocalSettings:3,
  localDatabaseUrlLoads:1,businessRows:0,passwordHashReads:0,functionBodyReads:0,sqlDataWrites:0,sqlDdl:0,
  awsCalls:0,secretValueReads:0,githubCalls:0,deployments:0,deletions:0,applicationRetries:0});
export const hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),lf=s=>s.replaceAll('\r\n','\n');
const querySha=()=>hash(JSON.stringify({queries:QUERIES,session:SESSION_SQL}));
export function environment(env=process.env){
  must(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(env).some(k=>/^PG|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|CONFIG.*)$/.test(k))&&
    !['DATABASE_URL','NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','OPENSSL_CONF','OPENSSL_MODULES'].some(k=>env[k]),'ENVIRONMENT');
}
async function plain(file){
  let current=path.resolve(file);
  for(;;){must(!(await lstat(current)).isSymbolicLink(),'LINK_PATH');const parent=path.dirname(current);if(parent===current)break;current=parent;}
  must((await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'REAL_PATH');return file;
}
async function read(file,limit=1024*1024){await plain(file);const stat=await lstat(file);must(stat.isFile()&&stat.size<=limit,'FILE_SIZE');return readFile(file,'utf8');}
async function absent(file){try{await access(file);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function writeOnce(file,value){
  await plain(path.dirname(file));const f=await open(file,'wx',0o600);
  try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
}
function git(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:15000,
  stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();}
async function source(expected){
  must(git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');
  const head=git(['rev-parse','HEAD']);
  if(expected){must(/^[a-f0-9]{40}$/.test(expected),'SOURCE_COMMIT');git(['merge-base','--is-ancestor',expected,head]);
    must(git(['diff','--name-only',expected,head]).split('\n').filter(Boolean).every(f=>['README.md',PUBLIC_REVIEW].includes(f)),'SOURCE_DRIFT');}
  return head;
}
async function pins(){return Promise.all(SOURCES.map(async file=>({file,sha256:hash(lf(await read(path.join(ROOT,file))))})));}
export function parseTarget(raw){
  let u;try{u=new URL(raw);}catch{must(false,'DATABASE_URL');}
  must(['postgres:','postgresql:'].includes(u.protocol)&&/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)&&
    (!u.port||u.port==='5432')&&/^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname)&&u.username&&u.password&&!u.hash&&
    [...u.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k))&&u.searchParams.getAll('sslmode').length===1&&
    ['require','verify-full'].includes(u.searchParams.get('sslmode'))&&u.searchParams.getAll('channel_binding').length<=1&&
    (!u.searchParams.has('channel_binding')||u.searchParams.get('channel_binding')==='require'),'NEON_TLS_TARGET');
  const actor=decodeURIComponent(u.username),database=u.pathname.slice(1);
  must(/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(actor),'ACTOR');
  const target={host:u.hostname,port:5432,database,actor,transport:'PostgresTLSVerifyFull'};
  return {target,config:{host:target.host,port:5432,database,user:actor,password:decodeURIComponent(u.password),
    ssl:{rejectUnauthorized:true,servername:target.host},enableChannelBinding:true,options:'',
    application_name:'Techlong-Web-Catalog-Review-V1',connectionTimeoutMillis:15000,query_timeout:25000,statement_timeout:15000}};
}
async function databaseConfig(){const env=parseEnv(await read(path.join(ROOT,'.env.local'),65536));return parseTarget(env.DATABASE_URL);}
function verifyCi(ci,head){
  must(ci.schema==='techlong/platform-web-database-ci/v1'&&ci.repositoryId===1323312747&&ci.headSha===head&&
    ci.workflowPath===CI_PATH&&ci.headBranch==='main'&&ci.event==='push'&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    Number.isSafeInteger(ci.runId)&&ci.runId>0&&ci.jobs?.length===1&&ci.jobs[0].conclusion==='success'&&
    ci.jobs[0].steps?.length>=5&&ci.jobs[0].steps.every(s=>s.conclusion==='success')&&
    ci.jobs[0].steps.some(s=>s.name==='Exact catalog SQL on disposable PostgreSQL'),'CI_EVIDENCE');
}
export function validateReview(text,sha,now=Date.now()){
  must(/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'APPROVAL_SHA');const m=JSON.parse(text);
  must(m.schema==='techlong/platform-web-database-catalog-review/v1'&&/^[a-f0-9]{40}$/.test(m.sourceCommit??'')&&
    /^[a-f0-9]{32}$/.test(m.nonce??'')&&same(m.scope,SCOPE)&&same(m.profile,PROFILE)&&m.querySha256===querySha()&&
    same(m.sourcePins?.map(p=>p.file),SOURCES)&&m.sourcePins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    /^[a-f0-9]{64}$/.test(m.riskSha256??'')&&m.targetSha256===hash(JSON.stringify(m.target))&&
    /^F:\/ChatGPT_workshop\/techlong-platform-web-db-ci-[0-9]+\.json$/.test(m.ciReceipt?.file??'')&&
    Number.isSafeInteger(m.ciReceipt.runId)&&m.ciReceipt.runId>0&&
    m.ciReceipt.file===BASE+'/techlong-platform-web-db-ci-'+m.ciReceipt.runId+'.json'&&
    /^[a-f0-9]{64}$/.test(m.ciReceipt.sha256??''),'REVIEW_SCOPE');
  const start=Date.parse(m.issuedAt),end=Date.parse(m.expiresAt);
  must(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=48*3600000&&now>=start&&now<end,'REVIEW_EXPIRED');return m;
}
export async function prepare(output,ciFile){
  environment();must(/^F:\/ChatGPT_workshop\/techlong-platform-web-db-review-[a-z0-9-]+\.json$/.test(output??'')&&
    /^F:\/ChatGPT_workshop\/techlong-platform-web-db-ci-[0-9]+\.json$/.test(ciFile??''),'PREPARE_PATH');
  await absent(SLOT);await absent(output);const head=await source(),ciText=await read(ciFile),ci=JSON.parse(ciText);verifyCi(ci,head);
  const {target}=await databaseConfig(),issuedAt=new Date().toISOString();
  const m={schema:'techlong/platform-web-database-catalog-review/v1',sourceCommit:head,nonce:randomBytes(16).toString('hex'),
    issuedAt,expiresAt:new Date(Date.parse(issuedAt)+48*3600000).toISOString(),sourcePins:await pins(),
    riskSha256:hash(lf(await read(path.join(ROOT,RISK)))),target,targetSha256:hash(JSON.stringify(target)),
    ciReceipt:{file:ciFile,sha256:hash(ciText),runId:ci.runId},querySha256:querySha(),profile:{...PROFILE},scope:{...SCOPE}};
  const text=JSON.stringify(m,null,2)+'\n';validateReview(text,hash(text));await writeOnce(output,m);
  return {mode:'Prepare',output,sha256:hash(text),expiresAt:m.expiresAt,databaseConnections:0,awsCalls:0,slotConsumed:false};
}
export async function runAudit({manifest:m,sha,ports}){
  await ports.consume({manifestSha256:sha,nonce:m.nonce,target:m.target,startedAtUtc:new Date().toISOString(),retryAllowed:false});
  let client;try{
    client=await ports.connect();const catalog=await readCatalog(client,m.target);
    const result={schema:'techlong/platform-web-database-catalog-result/v1',manifestSha256:sha,nonce:m.nonce,
      outcome:'READ_ONLY_CATALOG_CAPTURED_NOT_INSTALLED',completedAtUtc:new Date().toISOString(),target:m.target,
      catalog,assessment:assess(catalog),scope:{...SCOPE},retryAllowed:false};await ports.save(result);return result;
  }finally{if(client)await client.end();}
}
export async function readReviewed(file,sha){
  environment();const m=validateReview(await read(file),sha);await source(m.sourceCommit);
  must(same(await pins(),m.sourcePins)&&hash(lf(await read(path.join(ROOT,RISK))))===m.riskSha256,'APPROVED_CODE_DRIFT');
  const ciText=await read(m.ciReceipt.file),ci=JSON.parse(ciText);must(hash(ciText)===m.ciReceipt.sha256&&ci.runId===m.ciReceipt.runId,'CI_RECEIPT_DRIFT');verifyCi(ci,m.sourceCommit);
  const {target,config}=await databaseConfig();must(same(target,m.target),'DATABASE_TARGET_DRIFT');
  await absent(SLOT);const output=BASE+'/techlong-platform-web-db-catalog-'+m.nonce+'.json';await absent(output);
  try{return {mode:'ReadReviewed',output,...await runAudit({manifest:m,sha,ports:{consume:v=>writeOnce(SLOT,v),
    async connect(){const {default:pg}=await import('pg');const c=new pg.Client(config);c.on('error',()=>{});
      try{await c.connect();return c;}catch(e){try{await c.end();}catch{/* One connection only. */}throw e;}},
    save:v=>writeOnce(output,v)}})};}
  catch(e){await writeOnce(output+'.failed.json',{outcome:'CATALOG_READ_FAILED_NO_RETRY',code:errorCode(e),sqlDataWrites:0,awsCalls:0,retryAllowed:false});throw e;}
}
export const errorCode=e=>/^WEB_DB_[A-Z0-9_]+$/.test(e?.message??'')?e.message:/^[A-Z0-9_]{2,40}$/.test(e?.code??'')?e.code:'CATALOG_OPERATION_FAILED';
export async function main(args=process.argv.slice(2)){
  const [mode,file,value,...extra]=args;must(!extra.length&&file&&value&&['Prepare','ReadReviewed'].includes(mode),'ARGS');
  return mode==='Prepare'?prepare(file,value):readReviewed(file,value);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(JSON.stringify({outcome:'WEB_DB_COMMAND_STOPPED',code:errorCode(e),automaticRetry:false}));process.exitCode=1;});
