import {readFile,lstat,realpath,open,access,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,BASE,environment} from '../platform-web-database-v1/local.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {SOURCES as ACCESS_SOURCES} from '../platform-ecs-v1/local.mjs';
import {prices} from '../platform-ecs-v1/prices.mjs';
import {P,B,SCOPE,must,hash,canonical,same,safeCode,template,assertAccess,assertInventory} from './contract.mjs';
import {cloud} from './cloud.mjs';
import {deployHosting} from './deploy.mjs';
import {Q} from './trial-v2.mjs';
export const RISK='docs/aws-platform-hosting-w7o-deployment-review.md',INDEX='ops/aws-sandbox/reviews/platform-hosting-w7o.review.json';
export const CI_PATH='.github/workflows/platform-hosting-deploy-candidate.yml',SLOT=BASE+'/techlong-platform-hosting-deploy-v1.intent.json';
export const SOURCES=Object.freeze([...new Set(['ops/platform-hosting-deploy-v1/contract.mjs','ops/platform-hosting-deploy-v1/cloud.mjs',
  'ops/platform-hosting-deploy-v1/deploy.mjs','ops/platform-hosting-deploy-v1/local.mjs','ops/platform-hosting-deploy-v1/trial-v2.mjs','tests/platform-hosting-deploy-v1.test.mjs',CI_PATH,RISK,
  ...ACCESS_SOURCES,'ops/aws-sandbox/reviews/platform-ecs-w7n.observed.json'])]);
export const NEXT_RISK='docs/aws-platform-hosting-w7q-acceptance-review.md',NEXT_INDEX='ops/aws-sandbox/reviews/platform-hosting-w7q.review.json';
export const NEXT_SLOT=BASE+'/techlong-platform-hosting-deploy-v2.intent.json';
export const NEXT_SOURCES=Object.freeze([...SOURCES,'tests/platform-hosting-trial-v2.test.mjs',NEXT_RISK,Q.cleanupObservedFile]);
function settings(secondTrial){must(typeof secondTrial==='boolean','TRIAL_SELECTOR');return secondTrial?
  {risk:NEXT_RISK,index:NEXT_INDEX,slot:NEXT_SLOT,sources:NEXT_SOURCES,schema:'techlong/platform-hosting-deployment-review/v2'}:
  {risk:RISK,index:INDEX,slot:SLOT,sources:SOURCES,schema:'techlong/platform-hosting-deployment-review/v1'};}
export const ARTIFACTS=Object.freeze(['hosting-template.json','inventory.json','prices.json','service-validation.json']);
const lf=s=>s.replaceAll('\r\n','\n');
async function plain(f){for(let p=path.resolve(f);;){must(!(await lstat(p)).isSymbolicLink(),'LINK');const n=path.dirname(p);if(n===p)break;p=n;}
  must((await realpath(f)).toLowerCase()===path.resolve(f).toLowerCase(),'REALPATH');}
async function read(f){await plain(f);const s=await lstat(f);must(s.isFile()&&s.size<3*1024*1024,'FILE_SIZE');return readFile(f,'utf8');}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function write(f,v){await plain(path.dirname(f));const text=JSON.stringify(v,null,2)+'\n';must(!/postgres(?:ql)?:\/\/|SCRAM-SHA-256\$/.test(text),'REDACTION');
  const h=await open(f,'wx',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}}
function git(args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();}
async function source(expected,index=INDEX){must(git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');const h=git(['rev-parse','HEAD']);
  if(expected){git(['merge-base','--is-ancestor',expected,h]);must(git(['diff','--name-only',expected,h]).split('\n').filter(Boolean).every(f=>['README.md',index].includes(f)),'SOURCE_DRIFT');}return h;}
const pins=(files=SOURCES)=>Promise.all(files.map(async file=>({file,sha256:hash(lf(await read(path.join(ROOT,file))))})));
async function parent(secondTrial=false){const dir=BASE+'/techlong-platform-ecs-access-'+B.accessNonce,files=[
  {file:dir+'/result.json',sha256:B.parentResultSha256},{file:dir+'/independent-observation.json',sha256:B.parentObservationSha256},
  {file:BASE+'/techlong-platform-ecs-access-v1.intent.json',sha256:B.parentIntentSha256}];
  const values=[];for(const p of files){const raw=await read(p.file);must(hash(raw)===p.sha256,'PARENT_HASH');values.push(JSON.parse(raw));}
  const [result,observation,intent]=values;must(result.outcome==='ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED'&&result.manifestSha256===B.parentManifestSha256&&
    result.roleId===B.roleId&&intent.manifestSha256===B.parentManifestSha256&&observation.secretPolicyState==='HANDOFF','PARENT_RESULT');assertAccess(observation.access);
  if(secondTrial){const extra=[{file:Q.cleanupObservedFile,sha256:Q.cleanupObservedSha256,normalizeLf:true},
    {file:Q.cleanupVerificationFile,sha256:Q.cleanupVerificationSha256},
    {file:SLOT,sha256:Q.previousCreateIntentSha256},{file:BASE+'/techlong-platform-hosting-cleanup-v1.intent.json',sha256:Q.previousDeleteIntentSha256}];
    const v=[];for(const p of extra){const raw=await read(p.file);must(hash(p.normalizeLf?lf(raw):raw)===p.sha256,'CLEANUP_PARENT_HASH');v.push(JSON.parse(raw));}
    must(v[0].status==='HOSTING_CLEANUP_INDEPENDENTLY_VERIFIED'&&v[0].targetStackId===Q.previousStackId&&v[0].approvedManifest.sha256===Q.cleanupManifestSha256&&
      v[1].outcome===v[0].status&&v[1].allElevenCfnResourcesDeleteComplete&&v[1].allElevenServiceChecksPassed&&
      v[2].manifestSha256==='289e7cdcb09630b2b851fe5fa493477f1d7a642bbe10509efa21bf3ccac178ab'&&
      v[3].manifestSha256===Q.cleanupManifestSha256&&v[3].targetStackId===Q.previousStackId,'CLEANUP_PARENT_RESULT');files.push(...extra);}
  return files;}
function ciCheck(c,head){must(c.schema==='techlong/platform-hosting-deploy-ci/v1'&&c.repositoryId===1323312747&&c.headSha===head&&c.workflowPath===CI_PATH&&
  c.headBranch==='main'&&c.event==='push'&&c.attempt===1&&c.status==='completed'&&c.conclusion==='success'&&Number.isSafeInteger(c.runId)&&c.runId>0&&
  c.jobs?.length===1&&c.jobs[0].conclusion==='success'&&c.jobs[0].steps.every(s=>s.conclusion==='success')&&c.jobs[0].steps.some(s=>s.name==='Fixed hosting deployment contracts - No AWS'),'CI');}
export function validate(text,sha,now=Date.now(),secondTrial=false){const cfg=settings(secondTrial);
  must(/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'APPROVAL_SHA');const m=JSON.parse(text);
  must(m.schema===cfg.schema&&/^[a-f0-9]{40}$/.test(m.sourceCommit??'')&&/^[a-f0-9]{32}$/.test(m.nonce??'')&&
    same(m.constants,P)&&same(m.accessBinding,B)&&same(m.scope,SCOPE)&&m.templateSha256===hash(canonical(template(m.nonce,secondTrial)))&&
    same(m.sourcePins?.map(p=>p.file),cfg.sources)&&m.sourcePins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&m.riskSha256===m.sourcePins.find(p=>p.file===cfg.risk).sha256&&
    m.artifactDirectory===BASE+'/techlong-platform-hosting-review-'+m.nonce&&same(m.artifactPins?.map(p=>p.name),ARTIFACTS)&&m.artifactPins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    m.ciReceipt?.file===BASE+'/techlong-platform-hosting-ci-'+m.ciReceipt.runId+'.json'&&Number.isSafeInteger(m.ciReceipt.runId)&&m.ciReceipt.runId>0&&/^[a-f0-9]{64}$/.test(m.ciReceipt.sha256??''),'BINDING');
  if(secondTrial)must(same(m.trialBinding,Q)&&m.inventory?.retiredHosting?.generation===2&&
    m.inventory.retiredHosting.previousStackId===Q.previousStackId&&m.inventory.retiredHosting.previousStackStatus==='DELETE_COMPLETE'&&
    m.inventory.retiredHosting.previousTaskDefinition===Q.previousTaskDefinition&&['INACTIVE','ABSENT'].includes(m.inventory.retiredHosting.previousTaskDefinitionStatus)&&
    m.inventory.retiredHosting.activeDefinitions===0&&m.inventory.retiredHosting.deletingDefinitions===0,'TRIAL_BINDING');
  else must(!m.trialBinding&&!m.inventory?.retiredHosting,'LEGACY_TRIAL_BINDING');
  assertInventory(m.inventory);const start=Date.parse(m.issuedAt),end=Date.parse(m.expiresAt);
  must(Number.isFinite(start)&&end-start===48*3600000&&Date.parse(m.latestStartAt)===end-30*60000&&now>=start&&now<Date.parse(m.latestStartAt),'WINDOW');return m;
}
export async function inventory(output,secondTrial=false){settings(secondTrial);must(/^F:\/ChatGPT_workshop\/techlong-platform-hosting-inventory-[a-z0-9-]+\.json$/.test(output??''),'INVENTORY_PATH');await absent(output);if(secondTrial)await parent(true);const c=cloud({secondTrial});
  try{const x=await c.inventory();assertInventory(x);await write(output,x);return {mode:secondTrial?'InventoryTrial2':'Inventory',output,roleId:x.access.roleId,hostingNamesAbsent:x.hostingNamesAbsent,awsWrites:0,directSecretValueReads:0,directSqlConnections:0};}finally{c.dispose();}}
export async function prepare(output,ciFile,secondTrial=false){const cfg=settings(secondTrial);must(/^F:\/ChatGPT_workshop\/techlong-platform-hosting-review-[a-z0-9-]+\.json$/.test(output??'')&&/^F:\/ChatGPT_workshop\/techlong-platform-hosting-ci-[0-9]+\.json$/.test(ciFile??''),'PREPARE_PATH');
  await absent(cfg.slot);await absent(output);const head=await source(),ciRaw=await read(ciFile),ci=JSON.parse(ciRaw);ciCheck(ci,head);const previous=await parent(secondTrial);
  const nonce=randomBytes(16).toString('hex'),dir=BASE+'/techlong-platform-hosting-review-'+nonce;await plain(BASE);await mkdir(dir);await write(dir+'/hosting-template.json',template(nonce,secondTrial));
  const c=cloud({secondTrial});let x,pricing,service;try{x=await c.inventory();assertInventory(x);await write(dir+'/inventory.json',x);pricing=await prices();await write(dir+'/prices.json',pricing);
    service=await c.validate(nonce);await write(dir+'/service-validation.json',service);}finally{c.dispose();}
  const now=Date.now(),m={schema:cfg.schema,sourceCommit:head,nonce,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+48*3600000).toISOString(),
    latestStartAt:new Date(now+48*3600000-30*60000).toISOString(),constants:{...P},accessBinding:{...B},scope:{...SCOPE},...(secondTrial?{trialBinding:Q}:{}),parent:previous,inventory:x,pricing,serviceValidation:service,
    templateSha256:hash(canonical(template(nonce,secondTrial))),sourcePins:await pins(cfg.sources),riskSha256:hash(lf(await read(path.join(ROOT,cfg.risk)))),artifactDirectory:dir,
    artifactPins:await Promise.all(ARTIFACTS.map(async name=>({name,sha256:hash(await read(dir+'/'+name))}))),ciReceipt:{file:ciFile,sha256:hash(ciRaw),runId:ci.runId},hostingWindowStarted:false};
  const raw=JSON.stringify(m,null,2)+'\n';validate(raw,hash(raw),now,secondTrial);await write(output,m);return {mode:secondTrial?'PrepareTrial2':'Prepare',output,manifestSha256:hash(raw),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,
    proposedCreateStack:1,hostingResources:11,newIamResources:0,hostingWindowStarted:false,exampleTwoHoursUsd:pricing.estimate.exampleTwoHoursUsd,awsWrites:0,directSecretValueReads:0,directSqlConnections:0};}
export async function deploy(file,sha,secondTrial=false){const cfg=settings(secondTrial);must(/^F:\/ChatGPT_workshop\/techlong-platform-hosting-review-[a-z0-9-]+\.json$/.test(file??'')&&/^[a-f0-9]{64}$/.test(sha??''),'DEPLOY_ARGUMENTS');
  const m=validate(await read(file),sha,Date.now(),secondTrial);await source(m.sourceCommit,cfg.index);must(same(await pins(cfg.sources),m.sourcePins)&&same(await parent(secondTrial),m.parent),'CODE_PARENT_DRIFT');
  const ciRaw=await read(m.ciReceipt.file);must(hash(ciRaw)===m.ciReceipt.sha256,'CI_DRIFT');ciCheck(JSON.parse(ciRaw),m.sourceCommit);
  for(const p of m.artifactPins)must(hash(await read(m.artifactDirectory+'/'+p.name))===p.sha256,'ARTIFACT_DRIFT');await absent(cfg.slot);
  const dir=BASE+'/techlong-platform-hosting-deployment-'+m.nonce;await plain(BASE);await mkdir(dir);const c=cloud({secondTrial});
  try{return {mode:secondTrial?'DeployTrial2Reviewed':'DeployReviewed',output:dir+'/result.json',...await deployHosting({manifest:m,sha,io:{cloud:c,consume:v=>write(cfg.slot,{...v,...(secondTrial?{trialBinding:Q}:{})}),
    record:(name,v)=>{must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');return write(dir+'/'+name+'.json',v);},pause:ms=>new Promise(r=>setTimeout(r,ms))}})};}finally{c.dispose();}}
export async function main(args=process.argv.slice(2)){environment();awsEnvironment();const [mode,file,value,...extra]=args;
  must(!extra.length&&file&&['Inventory','Prepare','DeployReviewed','InventoryTrial2','PrepareTrial2','DeployTrial2Reviewed'].includes(mode)&&(/^Inventory/.test(mode)?!value:!!value),'ARGS');
  const secondTrial=mode.includes('Trial2');return /^Inventory/.test(mode)?inventory(file,secondTrial):/^Prepare/.test(mode)?prepare(file,value,secondTrial):deploy(file,value,secondTrial);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{console.log(JSON.stringify(r,null,2));if(r.outcome==='HOSTING_REQUIRES_REVIEW_NO_RETRY')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'PLATFORM_HOSTING_DEPLOY_STOPPED',code:safeCode(e),operation:/^[A-Za-z0-9-]+$/.test(e.operation??'')?e.operation:undefined,automaticRetry:false}));process.exitCode=1;});
