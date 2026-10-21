// Public source artifact read/check only. No AWS clients or registry credentials.
import {readFile,open,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {P,must,hash,verifyCandidate} from './plan.mjs';
import {main as verifyArchive,imageReceipt} from '../platform-hosting-v1/image-artifact.mjs';
import {checkCandidateScan} from '../platform-hosting-v1/security-scan.mjs';
export async function save(file,value){const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}
export async function fileHash(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
export function assertArtifactContext(e,{publication=false}={}){
  must(e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY===P.repository&&e.GITHUB_REPOSITORY_ID===String(P.repositoryId)&&
    e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_RUN_ATTEMPT==='1'&&e.GITHUB_EVENT_NAME===(publication?'workflow_dispatch':'push'),'ARTIFACT_CONTEXT');
  must(!Object.keys(e).some(k=>/^(AWS_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&e[k])&&
    (publication||!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN)&&e.NODE_TLS_REJECT_UNAUTHORIZED!=='0','ARTIFACT_CREDENTIAL_OVERRIDE');
}
async function github(suffix,token){
  must(token&&suffix.startsWith(`/repos/${P.repository}/`),'ARTIFACT_API_SCOPE');
  const r=await fetch('https://api.github.com'+suffix,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},
    redirect:'error',signal:AbortSignal.timeout(30000)});must(r.ok,'ARTIFACT_API_RESPONSE');return r.json();
}
export async function prepare(dir,env=process.env,{publication=false}={}){
  assertArtifactContext(env,{publication});const out=path.resolve(dir),temp=path.resolve(env.RUNNER_TEMP);
  must(path.dirname(out)===temp&&(await lstat(temp)).isDirectory(),'ARTIFACT_DIRECTORY');
  const [run,artifact]=await Promise.all([github(`/repos/${P.repository}/actions/runs/${P.runId}`,env.GH_TOKEN),
    github(`/repos/${P.repository}/actions/artifacts/${P.artifactId}`,env.GH_TOKEN)]);verifyCandidate(run,artifact);
  const redirect=await fetch(`https://api.github.com/repos/${P.repository}/actions/artifacts/${P.artifactId}/zip`,{
    headers:{authorization:'Bearer '+env.GH_TOKEN,accept:'application/vnd.github+json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
  must(redirect.status===302,'ARTIFACT_REDIRECT');const u=new URL(redirect.headers.get('location'));
  must(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.endsWith('.blob.core.windows.net'),'ARTIFACT_STORAGE');
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(180000)});must(r.ok&&r.body,'ARTIFACT_DOWNLOAD');
  const h=createHash('sha256');let n=0;const zip=out+'.zip';
  await pipeline(Readable.fromWeb(r.body),new Transform({transform(c,enc,cb){n+=c.length;if(n>P.artifactBytes){cb(Error('ARTIFACT_SIZE'));return;}h.update(c);cb(null,c);}}),createWriteStream(zip,{flags:'wx',mode:0o600}));
  must(n===P.artifactBytes&&'sha256:'+h.digest('hex')===P.artifactDigest,'ARTIFACT_OFFICIAL_BYTES');
  execFileSync('python3',['ops/platform-image-publication-v1/extract.py',zip,out],{stdio:'pipe',timeout:120000});
  const v=await verifyArchive(['verify',out,P.sourceCommit,String(P.runId)],{});
  must(v.imageConfigDigest===P.imageConfigDigest&&v.archiveSha256===P.archiveSha256,'ARTIFACT_IMAGE');
  const receipt=await readFile(path.join(out,'image-receipt.json'));
  must(await readFile(path.join(out,'SHA256SUMS'),'utf8')===`${P.archiveSha256}  image.tar.gz\n${hash(receipt)}  image-receipt.json\n`,'ARTIFACT_SUMS');
  const result={schema:'techlong/platform-publication-artifact/v2',sourceCommit:P.sourceCommit,producerRunId:P.runId,
    artifactId:P.artifactId,artifactZipDigest:P.artifactDigest,archiveSha256:P.archiveSha256,
    archiveBytes:JSON.parse(receipt).archiveBytes,imageConfigDigest:P.imageConfigDigest,awsCalls:0,
    executorCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,recordedAtUtc:new Date().toISOString()};
  await save(path.join(out,'verified-artifact.json'),result);return result;
}
export async function inspect(dir){
  const a=JSON.parse(await readFile(path.join(dir,'verified-artifact.json'),'utf8'));
  const context={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:P.repository,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',
    GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:P.sourceCommit,GITHUB_RUN_ID:String(P.runId)};
  const r=imageReceipt(JSON.parse(await readFile(path.join(dir,'loaded-inspect.json'),'utf8')),{bytes:a.archiveBytes,sha256:P.archiveSha256},context);
  must(r.imageConfigDigest===P.imageConfigDigest,'LOADED_IMAGE');return r;
}
export async function scan(dir,cache){
  const report=path.join(dir,'os-scan.json'),metadata=path.join(cache,'db/metadata.json');
  const r=checkCandidateScan(JSON.parse(await readFile(report,'utf8')),JSON.parse(await readFile(metadata,'utf8')),P.imageConfigDigest);
  Object.assign(r,{schema:'techlong/platform-publication-preflight/v2',sourceCommit:P.sourceCommit,producerRunId:P.runId,
    artifactId:P.artifactId,artifactZipDigest:P.artifactDigest,archiveSha256:P.archiveSha256,recordedAtUtc:new Date().toISOString(),
    reportSha256:await fileHash(report),databaseMetadataSha256:await fileHash(metadata),databaseSha256:await fileHash(path.join(cache,'db/trivy.db'))});
  await save(path.join(dir,'verified-preflight.json'),r);must(r.outcome==='OS_HIGH_CRITICAL_ZERO','SCAN_FINDINGS');return r;
}
async function main(){const [mode,dir,cache]=process.argv.slice(2);must(dir&&['prepare','inspect','scan','prepare-publication'].includes(mode),'ARTIFACT_ARGUMENTS');
  const r=mode.startsWith('prepare')?await prepare(dir,process.env,{publication:mode==='prepare-publication'}):mode==='inspect'?await inspect(dir):await scan(dir,cache);console.log(JSON.stringify(r));}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('PLATFORM_PUBLICATION_ARTIFACT_REFUSED');process.exitCode=1;});
