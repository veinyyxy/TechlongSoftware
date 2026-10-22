import {readFile,lstat,realpath,open,access,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,BASE,environment} from '../platform-web-database-v1/local.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {P,ACCESS_SCOPE,must,hash,canonical,same,handoffPolicy,safeCode} from './contract.mjs';
import {accessTemplate,hostingTemplate,executionPolicy,trust,assertTemplates} from './templates.mjs';
import {cloud} from './cloud.mjs';
import {prices} from './prices.mjs';
import {installAccess} from './access.mjs';
export const RISK='docs/aws-platform-hosting-w7n-access-review.md',DRAFT='docs/aws-platform-hosting-w7n-two-hour-draft.md';
export const INDEX='ops/aws-sandbox/reviews/platform-ecs-w7n.access-review.json',CI_PATH='.github/workflows/platform-ecs-access-candidate.yml';
export const SLOT=BASE+'/techlong-platform-ecs-access-v1.intent.json';
export const SOURCES=Object.freeze(['ops/platform-ecs-v1/contract.mjs','ops/platform-ecs-v1/templates.mjs','ops/platform-ecs-v1/cloud.mjs',
  'ops/platform-ecs-v1/prices.mjs','ops/platform-ecs-v1/access.mjs','ops/platform-ecs-v1/local.mjs','ops/platform-hosting-v1/contract.mjs',
  'ops/platform-web-credential-v1/contract.mjs','ops/platform-web-credential-v1/aws.mjs','ops/platform-web-database-role-v1/contract.mjs',
  'ops/platform-web-database-role-v1/effective.mjs','ops/platform-web-database-v1/catalog.mjs','ops/platform-web-database-v1/local.mjs',
  'ops/platform-hosting-v1/database-profile.mjs','tests/platform-ecs-v1.test.mjs',CI_PATH,RISK,DRAFT,'package.json','package-lock.json',
  'ops/aws-sandbox/reviews/platform-web-credential-w7m.observed.json']);
const ARTIFACTS=['access-template.json','hosting-draft.json','execution-policy.json','trust.json','inventory.json','prices.json','service-validation.json','identity-validation.json','trust-validation.json'];
const lf=s=>s.replaceAll('\r\n','\n');
async function plain(file){for(let p=path.resolve(file);;){must(!(await lstat(p)).isSymbolicLink(),'LINK');const n=path.dirname(p);if(n===p)break;p=n;}
  must((await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'REALPATH');}
async function read(f){await plain(f);const s=await lstat(f);must(s.isFile()&&s.size<3*1024*1024,'FILE_SIZE');return readFile(f,'utf8');}
async function absent(f){try{await access(f);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function write(f,v){await plain(path.dirname(f));const text=JSON.stringify(v,null,2)+'\n';must(!/postgres(?:ql)?:\/\/|SCRAM-SHA-256\$/.test(text),'VALUE_REDACTION');
  const x=await open(f,'wx',0o600);try{await x.writeFile(text);await x.sync();}finally{await x.close();}}
function git(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',timeout:15000,windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();}
async function clean(expected){must(git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');const h=git(['rev-parse','HEAD']);if(expected){
  git(['merge-base','--is-ancestor',expected,h]);must(git(['diff','--name-only',expected,h]).split('\n').filter(Boolean).every(f=>['README.md',INDEX].includes(f)),'SOURCE_DRIFT');}return h;}
const pins=()=>Promise.all(SOURCES.map(async file=>({file,sha256:hash(lf(await read(path.join(ROOT,file))))})));
async function parent(){const f=BASE+'/techlong-platform-web-credential-31d32e3dfc04b53c425dfa7a7d6581e5/result.json',t=await read(f),r=JSON.parse(t);
  must(hash(t)==='0db96b44555ad053144c5705c98eb5faaf8d1a90b7e55ebabe9220f51e18ee13'&&r.outcome==='WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED'&&r.secretArn===P.secretArn&&r.versionId===P.secretVersion,'PARENT_CREDENTIAL');
  return {file:f,sha256:hash(t),outcome:r.outcome};}
function ciCheck(c,h){must(c.schema==='techlong/platform-ecs-access-ci/v1'&&c.repositoryId===1323312747&&c.headSha===h&&c.workflowPath===CI_PATH&&
  c.headBranch==='main'&&c.event==='push'&&c.attempt===1&&c.status==='completed'&&c.conclusion==='success'&&Number.isSafeInteger(c.runId)&&c.runId>0&&
  c.jobs?.length===1&&c.jobs[0].conclusion==='success'&&c.jobs[0].steps.every(s=>s.conclusion==='success')&&
  c.jobs[0].steps.some(s=>s.name==='Exact access and hosting draft contracts - No AWS'),'CI');}
export function validate(text,sha,now=Date.now()){
  must(/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'APPROVAL_SHA');const m=JSON.parse(text);
  must(m.schema==='techlong/platform-ecs-access-review/v1'&&/^[a-f0-9]{40}$/.test(m.sourceCommit??'')&&/^[a-f0-9]{32}$/.test(m.nonce??'')&&
    same(m.scope,ACCESS_SCOPE)&&same(m.constants,P)&&m.accessTemplateSha256===hash(canonical(accessTemplate(m.nonce)))&&
    m.hostingDraftSha256===hash(canonical(hostingTemplate()))&&m.handoffPolicySha256===hash(canonical(handoffPolicy()))&&
    same(m.sourcePins?.map(p=>p.file),SOURCES)&&m.sourcePins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&m.riskSha256===m.sourcePins.find(p=>p.file===RISK).sha256&&
    m.artifactDirectory===BASE+'/techlong-platform-ecs-review-'+m.nonce&&same(m.artifactPins?.map(p=>p.name),ARTIFACTS)&&m.artifactPins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    m.inventory?.accessNamesAbsent===true&&m.inventory.hostingNamesAbsent===true&&m.inventory.secret?.arn===P.secretArn&&m.inventory.secret.versionId===P.secretVersion&&
    m.ciReceipt?.file===BASE+'/techlong-platform-ecs-ci-'+m.ciReceipt.runId+'.json'&&Number.isSafeInteger(m.ciReceipt.runId)&&m.ciReceipt.runId>0&&/^[a-f0-9]{64}$/.test(m.ciReceipt.sha256??''),'REVIEW_BINDING');
  const a=Date.parse(m.issuedAt),b=Date.parse(m.expiresAt);must(Number.isFinite(a)&&b-a===48*3600000&&Date.parse(m.latestStartAt)===b-20*60000&&now>=a&&now<Date.parse(m.latestStartAt),'WINDOW');return m;
}
export async function inventory(output){must(/^F:\/ChatGPT_workshop\/techlong-platform-ecs-inventory-[a-z0-9-]+\.json$/.test(output??''),'INVENTORY_PATH');await absent(output);
  const c=cloud();try{const r=await c.inventory();await write(output,r);return {mode:'Inventory',output,accessNamesAbsent:r.accessNamesAbsent,hostingNamesAbsent:r.hostingNamesAbsent,awsWrites:0,secretValueReads:0,sqlConnections:0};}finally{c.dispose();}}
export async function prepare(output,ciFile){must(/^F:\/ChatGPT_workshop\/techlong-platform-ecs-access-review-[a-z0-9-]+\.json$/.test(output??'')&&
  /^F:\/ChatGPT_workshop\/techlong-platform-ecs-ci-[0-9]+\.json$/.test(ciFile??''),'PREPARE_PATH');await absent(SLOT);await absent(output);
  const head=await clean(),ciText=await read(ciFile),ci=JSON.parse(ciText);ciCheck(ci,head);const previous=await parent(),nonce=randomBytes(16).toString('hex'),dir=BASE+'/techlong-platform-ecs-review-'+nonce;
  await plain(BASE);await mkdir(dir);const a=accessTemplate(nonce),h=hostingTemplate();assertTemplates(a,h,nonce);await write(dir+'/access-template.json',a);await write(dir+'/hosting-draft.json',h);
  await write(dir+'/execution-policy.json',executionPolicy());await write(dir+'/trust.json',trust());
  const c=cloud();let snapshot,pricing,service;try{snapshot=await c.inventory();await write(dir+'/inventory.json',snapshot);pricing=await prices();await write(dir+'/prices.json',pricing);
    service=await c.validateTemplates(a,h);await write(dir+'/service-validation.json',service);
    await write(dir+'/identity-validation.json',c.validateIdentityPolicy(dir+'/execution-policy.json'));
    await write(dir+'/trust-validation.json',c.validateIdentityPolicy(dir+'/trust.json',true));}finally{c.dispose();}
  const now=Date.now(),m={schema:'techlong/platform-ecs-access-review/v1',sourceCommit:head,nonce,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+48*3600000).toISOString(),
    latestStartAt:new Date(now+48*3600000-20*60000).toISOString(),constants:{...P},scope:{...ACCESS_SCOPE},parent:previous,inventory:snapshot,pricing,serviceValidation:service,
    accessTemplateSha256:hash(canonical(a)),hostingDraftSha256:hash(canonical(h)),handoffPolicySha256:hash(canonical(handoffPolicy())),
    sourcePins:await pins(),riskSha256:hash(lf(await read(path.join(ROOT,RISK)))),artifactDirectory:dir,artifactPins:await Promise.all(ARTIFACTS.map(async name=>({name,sha256:hash(await read(dir+'/'+name))}))),
    ciReceipt:{file:ciFile,sha256:hash(ciText),runId:ci.runId},hostingDraftExecutionAuthorized:false,hostingWindowStarted:false};
  const raw=JSON.stringify(m,null,2)+'\n';validate(raw,hash(raw));await write(output,m);return {mode:'Prepare',output,manifestSha256:hash(raw),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,
    proposedNamedIamResources:2,proposedTopLevelWrites:2,hostingDraftResources:Object.keys(h.Resources).length,hostingDraftExecutionAuthorized:false,exampleTwoHoursUsd:pricing.estimate.exampleTwoHoursUsd,awsWrites:0,secretValueReads:0,sqlConnections:0};}
export async function install(file,sha){must(/^F:\/ChatGPT_workshop\/techlong-platform-ecs-access-review-[a-z0-9-]+\.json$/.test(file??'')&&/^[a-f0-9]{64}$/.test(sha??''),'INSTALL_ARGUMENTS');
  const m=validate(await read(file),sha);await clean(m.sourceCommit);must(same(await pins(),m.sourcePins)&&same(await parent(),m.parent),'CODE_PARENT_DRIFT');
  const ciText=await read(m.ciReceipt.file),ci=JSON.parse(ciText);must(hash(ciText)===m.ciReceipt.sha256,'CI_DRIFT');ciCheck(ci,m.sourceCommit);
  for(const p of m.artifactPins)must(hash(await read(m.artifactDirectory+'/'+p.name))===p.sha256,'ARTIFACT_DRIFT');
  await absent(SLOT);const dir=BASE+'/techlong-platform-ecs-access-'+m.nonce;await plain(BASE);await mkdir(dir);const c=cloud();
  const record=(name,v)=>{must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');return write(dir+'/'+name+'.json',v);};
  try{return {mode:'InstallAccessReviewed',output:dir+'/result.json',...await installAccess({manifest:m,sha,io:{cloud:c,record,consume:v=>write(SLOT,v),pause:ms=>new Promise(r=>setTimeout(r,ms))}})};}
  finally{c.dispose();}}
export async function main(args=process.argv.slice(2)){
  environment();awsEnvironment();const [mode,file,value,...extra]=args;must(!extra.length&&file&&['Inventory','Prepare','InstallAccessReviewed'].includes(mode)&&(mode==='Inventory'?!value:!!value),'ARGS');
  return mode==='Inventory'?inventory(file):mode==='Prepare'?prepare(file,value):install(file,value);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{console.log(JSON.stringify(r,null,2));if(r.outcome==='ACCESS_REQUIRES_REVIEW_NO_RETRY')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'PLATFORM_ECS_STOPPED',code:safeCode(e),operation:/^[A-Za-z0-9-]+$/.test(e.operation??'')?e.operation:undefined,automaticRetry:false}));process.exitCode=1;});
