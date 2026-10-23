// Prepare/Inspect are metadata-only. RunReviewed is a separately approved write.
import {readFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {environment} from '../platform-web-database-v1/local.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {noLinks,readText,writeOnce,absent} from '../platform-image-source-v2/files.mjs';
import {snapshotKeyMetadata} from '../platform-identity-review-v6/dispatch-local.mjs';
import {H,must,hash,same,makeReview,validate,verifyBaseline,verifyInstalled,verifiedCreatedArn,safeCode,install} from './contract.mjs';
import {createCloud} from './cloud.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url)),BASE='F:/ChatGPT_workshop';
export const PUBLIC_REVIEW='ops/aws-sandbox/reviews/platform-hosted-access-w8d.review.json';
const METADATA_ONLY=['README.md','docs/aws-auto-deployment-mainline.md',PUBLIC_REVIEW,'ops/aws-sandbox/reviews/platform-hosted-access-w8d.verified.json'];
const roots=['ops/platform-hosted-access-v6/local.mjs','ops/platform-hosted-access-v6/publication.mjs',
  'scripts/controller-auth-metadata-v6.ps1','tests/platform-hosted-access-v6.test.mjs',H.ciPath,H.riskFile,'package.json','package-lock.json',
  'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
function git(args,input){return execFileSync('git',args,{cwd:ROOT,input,encoding:'utf8',timeout:20000,windowsHide:true,
  maxBuffer:3000000,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}}).trim();}
export async function sourcePins(){
  const tracked=new Set(git(['ls-files','-z']).split('\0')),seen=new Map();
  async function visit(file){
    must(tracked.has(file)&&!file.includes('..')&&!/\.env|\.pem$/.test(file),'SOURCE_PATH');if(seen.has(file))return;
    const text=(await readText(path.join(ROOT,file),2000000)).replaceAll('\r\n','\n');seen.set(file,{file,sha256:hash(text)});
    if(!/\.(mjs|ts|tsx)$/.test(file)||file.startsWith('tests/'))return;
    for(const match of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const base=path.relative(ROOT,path.resolve(path.dirname(path.join(ROOT,file)),match[1])).replaceAll('\\','/');
      const resolved=[base,base+'.ts',base+'.mjs',base+'/index.ts'].find(f=>tracked.has(f));must(resolved,'SOURCE_IMPORT');await visit(resolved);
    }
  }
  for(const file of roots)await visit(file);return [...seen.values()].sort((a,b)=>a.file.localeCompare(b.file));
}
async function clean(m){
  environment();awsEnvironment();must(path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    process.platform==='win32'&&git(['branch','--show-current'])==='main'&&git(['status','--porcelain'])==='','CLEAN_MAIN');
  const h=git(['rev-parse','HEAD']);if(m){git(['merge-base','--is-ancestor',m.sourceCommit,h]);
    const changed=git(['diff','--name-only',m.sourceCommit,h]).split(/\r?\n/).filter(Boolean);
    must(changed.every(f=>METADATA_ONLY.includes(f))&&
      same(await sourcePins(),m.pins)&&hash((await readText(path.join(ROOT,H.riskFile))).replaceAll('\r\n','\n'))===m.riskSha256,'SOURCE_DRIFT');}
  return h;
}
async function ci(id,head){
  must(/^[1-9][0-9]{0,15}$/.test(id??''),'CI_ID');const raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
  let token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);must(token,'GITHUB_READ_CREDENTIAL');
  const get=async suffix=>{const r=await fetch('https://api.github.com/repos/veinyyxy/TechlongSoftware/'+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'}});must(r.status===200,'CI_METADATA');const text=await r.text();must(text.length<300000,'CI_SIZE');return JSON.parse(text);};
  try{const [r,j,b]=await Promise.all([get('actions/runs/'+id),get('actions/runs/'+id+'/attempts/1/jobs?per_page=100'),get('git/ref/heads/main')]);
    must(String(r.id)===id&&r.repository?.id===1323312747&&/^[a-f0-9]{40}$/.test(r.head_sha)&&r.head_branch==='main'&&r.event==='push'&&
      r.path===H.ciPath&&r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success'&&b.object?.sha===head&&
      j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===r.head_sha&&j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&
      j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&j.jobs[0].steps.every(s=>s.conclusion==='success')&&
      j.jobs[0].steps.some(s=>s.name==='Exact hosted supply and candidate binding - No AWS'),'EXACT_CI');
    git(['merge-base','--is-ancestor',r.head_sha,head]);must(git(['diff','--name-only',r.head_sha,head]).split(/\r?\n/).filter(Boolean).every(f=>METADATA_ONLY.includes(f)),'CI_CODE_DRIFT');
    return {runId:r.id,jobId:j.jobs[0].id,sourceCommit:r.head_sha,path:H.ciPath,attempt:1,status:'completed',conclusion:'success'};
  }finally{token=undefined;}
}
function safeEvidence(v){must(!/postgres(?:ql)?:\/\/|-----BEGIN (RSA )?PRIVATE KEY-----|SCRAM-SHA-256\$/.test(JSON.stringify(v)),'EVIDENCE_PRIVATE_VALUE');return v;}
async function outputPath(file){must(/^F:\/ChatGPT_workshop\/techlong-hosted-supply-review-[a-z0-9-]+\.json$/.test(file??''),'MANIFEST_PATH');
  await noLinks(BASE);return file;}
async function runDirectory(nonce){const dir=BASE+'/techlong-hosted-supply-'+nonce;await absent(dir);await mkdir(dir,{mode:0o700});await noLinks(dir);return dir;}
export async function main(args=process.argv.slice(2)){
  const [mode,file,approvalOrCi,...extra]=args;must(!extra.length&&['Prepare','RunReviewed','Inspect'].includes(mode),'ARGUMENTS');await outputPath(file);
  const head=await clean();
  if(mode==='Prepare'){
    await absent(file);await absent(H.slot);const proof=await ci(approvalOrCi,head),cloud=createCloud();
    try{const prestate=await cloud.snapshot();verifyBaseline(prestate);await cloud.validatePolicies();const keyMetadata=await snapshotKeyMetadata();
      const m=makeReview({sourceCommit:proof.sourceCommit,pins:await sourcePins(),ci:proof,prestate,keyMetadata,nonce:randomBytes(16).toString('hex'),versionId:randomUUID(),
        issuedAt:Date.now(),riskSha256:hash((await readText(path.join(ROOT,H.riskFile))).replaceAll('\r\n','\n'))});
      await clean();const bytes=JSON.stringify(m,null,2)+'\n';validate(bytes,hash(bytes));await writeOnce(file,safeEvidence(m));
      return {mode,output:file,manifestSha256:hash(bytes),expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
        topLevelAwsWritesMax:7,privateKeyReadsMax:1,cloudWrites:0,privateValueReads:0,executionAuthorized:false};
    }finally{cloud.close();}
  }
  const text=await readText(file,200000),m=validate(text,approvalOrCi,Date.now(),mode==='Inspect');await clean(m);
  if(mode==='Inspect'){
    const slot=JSON.parse(await readFile(H.slot,'utf8'));must(slot.manifestSha256===approvalOrCi&&slot.nonce===m.nonce,'INSPECT_INTENT');
    const cloud=createCloud();try{const observed=await cloud.snapshot(),bindingErrors=[];let outcome='SUPPLY_REQUIRES_REVIEW',expectedArn=null;try{
      const ack=JSON.parse(await readText(BASE+'/techlong-hosted-supply-'+m.nonce+'/app-created.json'));
      expectedArn=verifiedCreatedArn(ack,m,approvalOrCi);verifyInstalled(observed,expectedArn,m.versionId);outcome='SUPPLY_METADATA_INDEPENDENTLY_VERIFIED';
    }catch(e){bindingErrors.push(safeCode(e));}
      const output=BASE+'/techlong-hosted-supply-inspect-'+m.nonce+'-'+Date.now()+'.json';
      await writeOnce(output,safeEvidence({schema:'techlong/platform-hosted-supply-inspect/v6',manifestSha256:approvalOrCi,outcome,expectedArn,bindingErrors,observed,cloudWrites:0,secretValueReads:0}));return {mode,output,outcome,cloudWrites:0};
    }finally{cloud.close();}
  }
  await absent(H.slot);const dir=await runDirectory(m.nonce),cloud=createCloud();
  const record=(name,value)=>{must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');return writeOnce(dir+'/'+name+'.json',safeEvidence(value));};
  try{const result=await install({text,sha:approvalOrCi,io:{...cloud,record,
    async preflight(){await clean(m);await absent(H.slot);must(same(await snapshotKeyMetadata(),m.keyMetadata),'KEY_METADATA_DRIFT');return cloud.snapshot();},
    consume:value=>writeOnce(H.slot,safeEvidence(value)),
    async assertCurrent(){await clean(m);await cloud.roleGuard();},independentSnapshot:cloud.snapshot}});
    return {mode,output:dir+'/result.json',...result};
  }finally{cloud.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{
  console.log(JSON.stringify(r,null,2));if(r.outcome&&r.outcome!=='SUPPLY_METADATA_INDEPENDENTLY_VERIFIED')process.exitCode=2;
}).catch(e=>{console.error(JSON.stringify({outcome:'HOSTED_SUPPLY_STOPPED',code:safeCode(e),automaticRetry:false}));process.exitCode=1;});
