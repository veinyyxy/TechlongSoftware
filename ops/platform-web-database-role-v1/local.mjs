// Offline preparation or one reviewed disabled-role install + independent readback.
import {readFile,lstat,realpath,open,access,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,BASE,environment,parseTarget,validateReview as oldReview} from '../platform-web-database-v1/local.mjs';
import {QUERIES} from '../platform-web-database-v1/catalog.mjs';
import {PROFILE,SCOPE,STATEMENTS,INSTALL_SQL,LOCK_SQL,SETTINGS,must,hash,same,canonical,assertBaseline} from './contract.mjs';
import {EFFECTIVE_SQL} from './effective.mjs';
import {installTransaction,independentRead} from './install.mjs';
export const SLOT=BASE+'/techlong-platform-web-db-nologin-v1.intent.json';
export const RISK='docs/aws-platform-hosting-w7l-nologin-role-review.md';
export const INDEX='ops/aws-sandbox/reviews/platform-web-database-w7l.nologin-review.json';
export const CI_PATH='.github/workflows/platform-web-database-role-candidate.yml';
export const BASELINE=Object.freeze({
  receipt:{file:BASE+'/techlong-platform-web-db-catalog-8b2005d47002a7361de0b84e95dbff0e.json',sha256:'d351064ef8d7b4fca5266830117286febaca9e8b41fa15621c7718feab9ebf3e'},
  review:{file:BASE+'/techlong-platform-web-db-review-w7k-20261022.json',sha256:'cdf4f18d0989075ba364b503b0f82effc0ee0aa123d9b0468d149937e3d5e27f'},
  intent:{file:BASE+'/techlong-platform-web-db-catalog-v1.intent.json',sha256:'06f62069535276ad15c65322a21b81bb152d4bc030605155c6a7eeb82461f0cf'},
  semantic:{file:BASE+'/techlong-platform-web-db-catalog-8b2005d47002a7361de0b84e95dbff0e.semantic.json',sha256:'390df5f248b002d354f145b406c019a836bc17298753c8db67126cf3b65cc22b'},
});
export const SOURCES=Object.freeze(['ops/platform-web-database-role-v1/contract.mjs','ops/platform-web-database-role-v1/effective.mjs',
  'ops/platform-web-database-role-v1/install.mjs','ops/platform-web-database-role-v1/local.mjs','ops/platform-web-database-role-v1/no-login.sql',
  'ops/platform-web-database-v1/catalog.mjs','ops/platform-web-database-v1/local.mjs','ops/platform-hosting-v1/database-profile.mjs',
  'tests/platform-web-database-role-v1.test.mjs','scripts/ci/verify-platform-web-role-v1.mjs',CI_PATH,RISK,'package.json','package-lock.json',
  'ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-observed.json']);
const querySha=()=>hash(canonical({QUERIES,EFFECTIVE_SQL,LOCK_SQL,SETTINGS}));
const lf=v=>v.replaceAll('\r\n','\n');
export const errorCode=e=>/^WEB_ROLE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:/^[A-Z0-9_]{2,40}$/.test(e?.code??'')?e.code:'ROLE_OPERATION_FAILED';
async function plain(file){for(let p=path.resolve(file);;){must(!(await lstat(p)).isSymbolicLink(),'LINK');const n=path.dirname(p);if(p===n)break;p=n;}
  must((await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'REALPATH');return file;}
async function read(file,limit=3*1024*1024){await plain(file);const s=await lstat(file);must(s.isFile()&&s.size<=limit,'FILE_SIZE');return readFile(file,'utf8');}
async function absent(file){try{await access(file);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function writeOnce(file,value){await plain(path.dirname(file));const f=await open(file,'wx',0o600);
  try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}}
function git(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:15000,
  stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();}
async function clean(expected){must(git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');
  const head=git(['rev-parse','HEAD']);if(expected){git(['merge-base','--is-ancestor',expected,head]);
    must(git(['diff','--name-only',expected,head]).split('\n').filter(Boolean).every(p=>['README.md',INDEX].includes(p)),'SOURCE_DRIFT');}return head;}
async function pins(){return Promise.all(SOURCES.map(async file=>({file,sha256:hash(lf(await read(path.join(ROOT,file))))})));}
async function baseline(){
  const values={};for(const [name,ref]of Object.entries(BASELINE)){const text=await read(ref.file);must(hash(text)===ref.sha256,'BASELINE_FILE');values[name]={text,value:JSON.parse(text)};}
  const previous=oldReview(values.review.text,BASELINE.review.sha256,Date.parse(values.review.value.issuedAt)),r=values.receipt.value;
  must(r.outcome==='READ_ONLY_CATALOG_CAPTURED_NOT_INSTALLED'&&r.manifestSha256===BASELINE.review.sha256&&
    r.nonce===previous.nonce&&same(r.target,previous.target)&&same(r.scope,previous.scope)&&
    values.intent.value.manifestSha256===BASELINE.review.sha256&&values.semantic.value.originalReceiptSha256===BASELINE.receipt.sha256,'BASELINE_BINDING');
  assertBaseline(r.catalog);return r;
}
async function configuration(){const e=parseEnv(await read(path.join(ROOT,'.env.local'),65536));return parseTarget(e.DATABASE_URL);}
function verifyCi(ci,head){must(ci.schema==='techlong/platform-web-role-ci/v1'&&ci.repositoryId===1323312747&&ci.headSha===head&&
  ci.workflowPath===CI_PATH&&ci.headBranch==='main'&&ci.event==='push'&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
  Number.isSafeInteger(ci.runId)&&ci.runId>0&&ci.jobs?.length===1&&ci.jobs[0].conclusion==='success'&&ci.jobs[0].steps.length>=5&&
  ci.jobs[0].steps.every(s=>s.conclusion==='success')&&ci.jobs[0].steps.some(s=>s.name==='Atomic NOLOGIN grant and forbidden-operation checks on PostgreSQL'),'CI');}
export function validate(text,sha,now=Date.now()){
  must(/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'APPROVAL_SHA');const m=JSON.parse(text);
  must(m.schema==='techlong/platform-web-nologin-review/v1'&&/^[a-f0-9]{40}$/.test(m.sourceCommit??'')&&/^[a-f0-9]{32}$/.test(m.nonce??'')&&
    same(m.scope,SCOPE)&&same(m.statements,STATEMENTS)&&m.sqlSha256===hash(INSTALL_SQL)&&m.querySha256===querySha()&&
    same(m.baseline,BASELINE)&&same(m.profile,PROFILE)&&same(m.sourcePins?.map(p=>p.file),SOURCES)&&m.sourcePins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    /^[a-f0-9]{64}$/.test(m.baselineCatalogSha256??'')&&/^[a-f0-9]{64}$/.test(m.riskSha256??'')&&m.targetSha256===hash(canonical(m.target))&&
    Number.isSafeInteger(m.ciReceipt?.runId)&&m.ciReceipt.runId>0&&m.ciReceipt.file===BASE+'/techlong-platform-web-role-ci-'+m.ciReceipt.runId+'.json'&&
    /^[a-f0-9]{64}$/.test(m.ciReceipt.sha256??''),'REVIEW_BINDING');
  const start=Date.parse(m.issuedAt),end=Date.parse(m.expiresAt),latest=Date.parse(m.latestStartAt);
  must(Number.isFinite(start)&&end>start&&end-start<=48*3600000&&latest===end-300000&&now>=start&&now<latest,'REVIEW_WINDOW');return m;
}
export async function prepare(output,ciFile){
  environment();must(/^F:\/ChatGPT_workshop\/techlong-platform-web-role-review-[a-z0-9-]+\.json$/.test(output??'')&&
    /^F:\/ChatGPT_workshop\/techlong-platform-web-role-ci-[0-9]+\.json$/.test(ciFile??''),'PREPARE_PATH');
  await absent(SLOT);await absent(output);const head=await clean(),ciText=await read(ciFile),ci=JSON.parse(ciText);verifyCi(ci,head);
  const b=await baseline(),{target}=await configuration();must(same(target,b.target),'DATABASE_TARGET');
  must(lf(await read(path.join(ROOT,'ops/platform-web-database-role-v1/no-login.sql')))===INSTALL_SQL,'SQL_FILE');
  const issued=Date.now(),m={schema:'techlong/platform-web-nologin-review/v1',sourceCommit:head,nonce:randomBytes(16).toString('hex'),
    issuedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+48*3600000).toISOString(),latestStartAt:new Date(issued+48*3600000-300000).toISOString(),
    scope:{...SCOPE},profile:{...PROFILE},statements:[...STATEMENTS],sqlSha256:hash(INSTALL_SQL),querySha256:querySha(),
    baseline:{...BASELINE},baselineCatalogSha256:hash(canonical(b.catalog)),target,targetSha256:hash(canonical(target)),
    sourcePins:await pins(),riskSha256:hash(lf(await read(path.join(ROOT,RISK)))),ciReceipt:{file:ciFile,sha256:hash(ciText),runId:ci.runId}};
  const text=JSON.stringify(m,null,2)+'\n';validate(text,hash(text));await writeOnce(output,m);
  return {mode:'Prepare',output,manifestSha256:hash(text),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,productionConnections:0,sqlWrites:0};
}
export async function coordinate({manifest:m,baseline:b,ports}){
  await ports.consume({manifestSha256:ports.sha,nonce:m.nonce,targetFingerprintSha256:m.targetSha256,startedAtUtc:new Date().toISOString(),retryAllowed:false});
  let installer,reader,installed,observed,roleOid;const errors=[];
  try{installer=await ports.connect('installer');installed=await installTransaction({client:installer,target:m.target,baseline:b.catalog,
    expiresAt:m.expiresAt,record:ports.record,roleIdentity:async oid=>{roleOid=oid;await ports.record('role-identity',{roleOid});}});}
  catch(e){errors.push({stage:'install',code:errorCode(e)});}
  finally{if(installer)try{await installer.end();}catch(e){errors.push({stage:'installer-close',code:errorCode(e)});}}
  try{reader=await ports.connect('independent-reader');observed=await independentRead({client:reader,target:m.target,baseline:b.catalog,roleOid,record:ports.record});}
  catch(e){errors.push({stage:'independent-read',code:errorCode(e)});}
  finally{if(reader)try{await reader.end();}catch(e){errors.push({stage:'reader-close',code:errorCode(e)});}}
  const outcome=errors.length===0&&installed?.commitAcknowledged&&observed?.state==='EXACT_NOLOGIN_ROLE_OBSERVED'
    ?'NOLOGIN_ROLE_INSTALLED_AND_INDEPENDENTLY_VERIFIED':'INSTALL_REQUIRES_REVIEW_NO_RETRY';
  const result={schema:'techlong/platform-web-nologin-result/v1',manifestSha256:ports.sha,nonce:m.nonce,outcome,roleOid:roleOid??null,
    installed:installed??null,observed:observed??null,errors,loginActivationAuthorized:false,passwordChangeAuthorized:false,awsCalls:0,retryAllowed:false};
  await ports.record('result',result);return result;
}
export async function installReviewed(file,sha){
  environment();must(/^F:\/ChatGPT_workshop\/techlong-platform-web-role-review-[a-z0-9-]+\.json$/.test(file??'')&&/^[a-f0-9]{64}$/.test(sha??''),'INSTALL_ARGUMENTS');
  const m=validate(await read(file),sha);await clean(m.sourceCommit);
  must(same(await pins(),m.sourcePins)&&hash(lf(await read(path.join(ROOT,RISK))))===m.riskSha256,'CODE_DRIFT');
  const ciText=await read(m.ciReceipt.file),ci=JSON.parse(ciText);must(hash(ciText)===m.ciReceipt.sha256&&ci.runId===m.ciReceipt.runId,'CI_DRIFT');verifyCi(ci,m.sourceCommit);
  const b=await baseline(),{target,config}=await configuration();must(same(target,m.target)&&hash(canonical(b.catalog))===m.baselineCatalogSha256,'TARGET_BASELINE_DRIFT');
  await absent(SLOT);const dir=BASE+'/techlong-platform-web-db-nologin-'+m.nonce;await plain(BASE);await mkdir(dir);await plain(dir);
  const record=(name,value)=>{must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');return writeOnce(path.join(dir,name+'.json'),value);};
  const result=await coordinate({manifest:m,baseline:b,ports:{sha,consume:v=>writeOnce(SLOT,v),record,
    async connect(){const {default:pg}=await import('pg');const c=new pg.Client({...config,application_name:'Techlong-Web-NoLogin-Review-V1'});c.on('error',()=>{});
      try{await c.connect();return c;}catch(e){try{await c.end();}catch{/* No reconnect. */}throw e;}}}});
  return {mode:'InstallReviewed',output:path.join(dir,'result.json'),...result};
}
export async function main(args=process.argv.slice(2)){
  const [mode,file,value,...extra]=args;must(!extra.length&&file&&value&&['Prepare','InstallReviewed'].includes(mode),'ARGS');
  return mode==='Prepare'?prepare(file,value):installReviewed(file,value);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>{console.log(JSON.stringify(r,null,2));if(r.outcome==='INSTALL_REQUIRES_REVIEW_NO_RETRY')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'WEB_ROLE_STOPPED',code:errorCode(e),automaticRetry:false}));process.exitCode=1;});
