// The implementation lives in the project. F: holds immutable data, not wrappers.
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {environment} from '../platform-web-database-v1/local.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {noLinks,readText,writeOnce,absent} from '../platform-image-source-v2/files.mjs';
import {prices} from '../platform-ecs-v1/prices.mjs';
import {H,must,hash,canonical,same,template,makeReview,validate,safeCode} from './contract.mjs';
import {cloud} from './cloud.mjs';
import {run} from './run.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url)),BASE='F:/ChatGPT_workshop';
export const INDEX='ops/aws-sandbox/reviews/platform-hosted-deploy-w8g.review.json',CI_INDEX='ops/aws-sandbox/reviews/platform-hosted-deploy-w8g.verified.json';
const metadata=['README.md','docs/aws-auto-deployment-mainline.md',INDEX,CI_INDEX];
export const PARENTS=Object.freeze([
  {file:BASE+'/techlong-hosted-supply-48978ffd5cbe6fcdca130d9f4d4e689b/result.json',sha256:'5c523063d4a512b340d42bbf992d8789d0e38fe20ffef749d1800236e5433682'},
  {file:BASE+'/techlong-platform-hosted-source-v2-97cf75e760763028096b13b7d443e6c6/result.json',sha256:'ffb5ce27b347fdf1d443bf385cacae3422045069a02a95dc6089fdec15fb1601'},
  {file:BASE+'/techlong-platform-hosting-cleanup-v2.intent.json',sha256:'feed94c6ae7c2ae32e43e44861c715137b0c8e696758f4be8c4e73d6736571a6'},
  {file:BASE+'/techlong-platform-hosted-publication-v2.source.intent.json',sha256:'34f2e425748a5968dc34a9dc7ade3e287a9ec6a237bbc9bedb2d11ece3b3281c'}]);
const roots=['ops/platform-hosted-deploy-v6/local.mjs','tests/platform-hosted-deploy-v6.test.mjs',H.ciPath,H.riskFile,
  'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
const lf=s=>s.replaceAll('\r\n','\n');
function git(args,input){return execFileSync('git',args,{cwd:ROOT,input,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:3000000,
  stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}}).trim();}
export async function sourcePins(){const tracked=new Set(git(['ls-files','-z']).split('\0')),found=new Map();
  async function visit(file){must(tracked.has(file)&&!file.includes('..')&&!/\.env|\.pem$/.test(file),'SOURCE_PATH');if(found.has(file))return;
    const text=lf(await readText(path.join(ROOT,file),2000000));found.set(file,{file,sha256:hash(text)});
    if(!/\.(mjs|ts|tsx)$/.test(file)||file.startsWith('tests/'))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const base=path.relative(ROOT,path.resolve(path.dirname(path.join(ROOT,file)),m[1])).replaceAll('\\','/');
      const resolved=[base,base+'.ts',base+'.mjs',base+'/index.ts'].find(f=>tracked.has(f));must(resolved,'SOURCE_IMPORT');await visit(resolved);}}
  for(const file of roots)await visit(file);return [...found.values()].sort((a,b)=>a.file.localeCompare(b.file));}
async function clean(m){environment();awsEnvironment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
  git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');const head=git(['rev-parse','HEAD']);
  if(m){git(['merge-base','--is-ancestor',m.sourceCommit,head]);must(git(['diff','--name-only',m.sourceCommit,head]).split(/\r?\n/).filter(Boolean).every(f=>metadata.includes(f))&&
    same(await sourcePins(),m.pins)&&hash(lf(await readText(path.join(ROOT,H.riskFile))))===m.riskSha256,'SOURCE_DRIFT');}return head;}
export async function parents(){for(const p of PARENTS)must(hash(await readText(p.file,300000))===p.sha256,'PARENT_DRIFT');return PARENTS;}
async function ci(id,head){must(/^[1-9][0-9]{0,15}$/.test(id??''),'CI_ID');
  const credential=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
  let token=credential.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);must(token,'CI_CREDENTIAL');
  const get=async suffix=>{const r=await fetch('https://api.github.com/repos/veinyyxy/TechlongSoftware/'+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'}});must(r.status===200,'CI_HTTP');const text=await r.text();must(text.length<300000,'CI_SIZE');return JSON.parse(text);};
  try{const [r,j,b]=await Promise.all([get('actions/runs/'+id),get('actions/runs/'+id+'/attempts/1/jobs?per_page=100'),get('git/ref/heads/main')]);
    must(String(r.id)===id&&r.repository?.id===1323312747&&r.head_branch==='main'&&r.event==='push'&&r.path===H.ciPath&&r.run_attempt===1&&
      r.status==='completed'&&r.conclusion==='success'&&b.object?.sha===head&&j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===r.head_sha&&
      j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&
      j.jobs[0].steps.every(s=>s.conclusion==='success')&&j.jobs[0].steps.some(s=>s.name==='Hosted deployment contracts - No AWS'),'EXACT_CI');
    git(['merge-base','--is-ancestor',r.head_sha,head]);must(git(['diff','--name-only',r.head_sha,head]).split(/\r?\n/).filter(Boolean).every(f=>metadata.includes(f)),'CI_SOURCE_DRIFT');
    return {runId:r.id,jobId:j.jobs[0].id,sourceCommit:r.head_sha,path:H.ciPath,attempt:1,status:'completed',conclusion:'success'};
  }finally{token=undefined;}}
function safe(v){must(!/postgres(?:ql)?:\/\/|-----BEGIN (RSA )?PRIVATE KEY-----|SCRAM-SHA-256\$/.test(JSON.stringify(v)),'PRIVATE_EVIDENCE');return v;}
const record=(file,v)=>writeOnce(file,safe(v));
const runDir=nonce=>BASE+'/techlong-platform-hosted-deploy-'+nonce;
export async function main(args=process.argv.slice(2)){
  const [mode,file,value,...extra]=args;must(!extra.length&&['Prepare','RunReviewed','Inspect'].includes(mode)&&
    /^F:\/ChatGPT_workshop\/techlong-hosted-deploy-review-[a-z0-9-]+\.json$/.test(file??''),'ARGUMENTS');
  await noLinks(BASE);const head=await clean();
  if(mode==='Prepare'){
    await absent(file);await absent(H.slot);const proof=await ci(value,head),parent=await parents(),c=cloud();
    try{const nonce=randomBytes(16).toString('hex'),snapshot=await c.inventory(),pricing=await prices(),validation=await c.validate(nonce);
      const m=makeReview({sourceCommit:proof.sourceCommit,pins:await sourcePins(),ci:proof,baseline:snapshot.baseline,pricing,validation,parents:parent,
        nonce,issuedAt:Date.now(),riskSha256:hash(lf(await readText(path.join(ROOT,H.riskFile))))});
      await clean();const text=JSON.stringify(m,null,2)+'\n';validate(text,hash(text));await record(file,m);
      await record(file+'.facts.json',{observedAtUtc:snapshot.observedAtUtc,counts:c.counts(),directSecretValueReads:0,directSql:0,applicationHttp:0,
        template:template(nonce),templateCanonicalSha256:hash(canonical(template(nonce))),manifestSha256:hash(text)});
      return {mode,output:file,manifestSha256:hash(text),expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
        imageDigest:H.imageDigest,proposedCreateStackMax:1,logicalResources:11,exampleTwoHoursUsd:pricing.estimate.exampleTwoHoursUsd,
        ...c.counts(),executionAuthorized:false};
    }finally{c.close();}
  }
  const text=await readText(file,300000),m=validate(text,value,Date.now(),mode==='Inspect');await clean(m);must(same(await parents(),m.parents),'PARENTS');
  if(mode==='Inspect'){
    const slot=JSON.parse(await readText(H.slot));must(slot.manifestSha256===value&&slot.nonce===m.nonce,'INSPECT_SLOT');
    const c=cloud();try{let outcome='HOSTING_REQUIRES_REVIEW',observed=null,code=null;
      try{const intent=JSON.parse(await readText(runDir(m.nonce)+'/create-intent.json'));
        const ack=JSON.parse(await readText(runDir(m.nonce)+'/create-ack.json'));
        must(intent.manifestSha256===value&&intent.nonce===m.nonce&&ack.manifestSha256===value&&ack.nonce===m.nonce&&
          same(ack.controlLease,intent.controlLease)&&ack.hostingExpiresAt===intent.hostingExpiresAt,'ACK_BINDING');
        observed=await c.observe({nonce:m.nonce,...ack});if(observed.verified)outcome='HOSTING_METADATA_INDEPENDENTLY_VERIFIED_CONTROL_PENDING';
      }catch(e){code=safeCode(e);}
      const output=BASE+'/techlong-hosted-deploy-inspect-'+m.nonce+'-'+Date.now()+'.json';
      await record(output,{schema:'techlong/platform-hosted-deploy-inspect/v6',manifestSha256:value,outcome,observed,code,counts:c.counts(),directSecretValueReads:0});
      return {mode,output,outcome,cloudWrites:0};
    }finally{c.close();}
  }
  await absent(H.slot);await ci(String(m.ci.runId),head);const dir=runDir(m.nonce);await absent(dir);await mkdir(dir,{mode:0o700});await noLinks(dir);const c=cloud();
  try{c.startWrites(Math.min(m.expiresAt,Date.now()+H.runMs));
    const r=await run({text,sha:value,io:{inventory:c.inventory,guard:async()=>{await clean(m);await parents();await c.source();},
      consume:v=>record(H.slot,v),assertSupply:c.assertSupply,create:c.create,stack:c.stack,observe:c.observe,counts:c.counts,
      record:(name,v)=>{must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');return record(dir+'/'+name+'.json',v);},pause:ms=>new Promise(r=>setTimeout(r,ms))}});
    return {mode,output:dir+'/result.json',...r};
  }finally{c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{
  console.log(JSON.stringify(r,null,2));if(r.outcome==='HOSTING_REQUIRES_INSPECT_NO_RETRY'||r.outcome==='HOSTING_REQUIRES_REVIEW')process.exitCode=2;
}).catch(e=>{console.error(JSON.stringify({outcome:'HOSTED_DEPLOY_STOPPED',code:safeCode(e),retryAllowed:false}));process.exitCode=1;});
