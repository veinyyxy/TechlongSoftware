// GitHub cloud read/test only. No AWS SDK, OIDC request, registry login or push.
import {readFile,open,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PUBLICATION as P,must,verifyCandidate,verifyOsScan} from './plan.mjs';
import {main as verifyArchive,imageReceipt} from '../platform-hosting-v1/image-artifact.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const save=async(file,value)=>{const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}};
async function fileHash(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
export function assertNoAwsContext(e){
  must(e.GITHUB_ACTIONS==='true'&&e.GITHUB_REPOSITORY===P.repository&&e.GITHUB_REPOSITORY_ID===String(P.repositoryId)&&
    e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_EVENT_NAME==='push'&&e.GITHUB_RUN_ATTEMPT==='1','PREFLIGHT_CONTEXT');
  must(!Object.keys(e).some(k=>/^(AWS_|ACTIONS_ID_TOKEN_REQUEST_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&e[k])&&
    e.NODE_TLS_REJECT_UNAUTHORIZED!=='0','PREFLIGHT_CREDENTIAL_OR_NODE_OVERRIDE');
}
async function github(suffix,token){
  must(token&&suffix.startsWith('/repos/'+P.repository+'/'),'GITHUB_SCOPE');
  const r=await fetch('https://api.github.com'+suffix,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(30000)});
  must(r.ok,'GITHUB_READ');return r.json();
}
async function download(token,destination){
  const api=await fetch(`https://api.github.com/repos/${P.repository}/actions/artifacts/${P.artifactId}/zip`,{
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
  must(api.status===302,'ARTIFACT_REDIRECT');const u=new URL(api.headers.get('location'));
  must(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.endsWith('.blob.core.windows.net'),'ARTIFACT_STORAGE_HOST');
  // Never forward the GitHub credential to the signed storage URL or print it.
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(180000)});must(r.ok&&r.body,'ARTIFACT_DOWNLOAD');
  const h=createHash('sha256');let n=0;
  await pipeline(Readable.fromWeb(r.body),new Transform({transform(c,enc,cb){n+=c.length;if(n>P.artifactBytes){cb(Error('ARTIFACT_TOO_LARGE'));return;}h.update(c);cb(null,c);}}),createWriteStream(destination,{flags:'wx',mode:0o600}));
  must(n===P.artifactBytes&&'sha256:'+h.digest('hex')===P.artifactDigest,'OFFICIAL_ZIP_DIGEST');
}
export async function prepare(dir,env=process.env){
  assertNoAwsContext(env);const temp=path.resolve(env.RUNNER_TEMP),out=path.resolve(dir);
  must(path.dirname(out)===temp&&(await lstat(temp)).isDirectory(),'PREFLIGHT_DIRECTORY');
  const [run,artifact]=await Promise.all([github(`/repos/${P.repository}/actions/runs/${P.runId}`,env.GH_TOKEN),
    github(`/repos/${P.repository}/actions/artifacts/${P.artifactId}`,env.GH_TOKEN)]);
  verifyCandidate(run,artifact);const zip=out+'.zip';await download(env.GH_TOKEN,zip);
  execFileSync('python3',['ops/platform-image-publication-v1/extract.py',zip,out],{stdio:'pipe',timeout:120000});
  const verified=await verifyArchive(['verify',out,P.sourceCommit,String(P.runId)],{});
  must(verified.imageConfigDigest===P.imageConfigDigest&&verified.archiveSha256===P.archiveSha256,'ARCHIVE_EXPECTED_IMAGE');
  const receiptBytes=await readFile(path.join(out,'image-receipt.json'));const sums=await readFile(path.join(out,'SHA256SUMS'),'utf8');
  must(sums===`${P.archiveSha256}  image.tar.gz\n${hash(receiptBytes)}  image-receipt.json\n`,'ARTIFACT_SUMS');
  const result={schema:'techlong/platform-image-preflight-bytes/v1',outcome:'EXACT_SOURCE_ARTIFACT_BYTES_VERIFIED_NOT_AWS',
    recordedAtUtc:new Date().toISOString(),sourceCommit:P.sourceCommit,candidateRunId:P.runId,artifactId:P.artifactId,
    artifactZipDigest:P.artifactDigest,imageConfigDigest:P.imageConfigDigest,archiveSha256:P.archiveSha256,archiveBytes:JSON.parse(receiptBytes).archiveBytes,
    executorCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,awsCalls:0};
  await save(path.join(out,'preflight-bytes.json'),result);return result;
}
export async function inspect(dir){
  const bytes=JSON.parse(await readFile(path.join(dir,'preflight-bytes.json'),'utf8'));
  const inspection=JSON.parse(await readFile(path.join(dir,'loaded-inspect.json'),'utf8'));
  must(inspection.length===1&&inspection[0].Id===P.imageConfigDigest,'LOADED_IMAGE_ID');
  const context={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:P.repository,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',
    GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:P.sourceCommit,GITHUB_RUN_ID:String(P.runId)};
  const r=imageReceipt(inspection,{bytes:bytes.archiveBytes,sha256:P.archiveSha256},context);
  must(r.imageConfigDigest===P.imageConfigDigest,'LOADED_CONFIG');return {outcome:'LOADED_IMAGE_CONFIG_VERIFIED',imageConfigDigest:P.imageConfigDigest};
}
export async function scan(dir,cache){
  const reportFile=path.join(dir,'os-scan.json'),dbFile=path.join(cache,'db/metadata.json');
  const result=verifyOsScan(JSON.parse(await readFile(reportFile,'utf8')),JSON.parse(await readFile(dbFile,'utf8')));
  Object.assign(result,{recordedAtUtc:new Date().toISOString(),reportSha256:await fileHash(reportFile),databaseMetadataSha256:await fileHash(dbFile),
    databaseSha256:await fileHash(path.join(cache,'db/trivy.db'))});
  await save(path.join(dir,'os-scan-summary.json'),result);
  must(result.outcome==='OS_HIGH_CRITICAL_ZERO','OS_HIGH_CRITICAL_FINDINGS');return result;
}
async function main(){const [mode,dir,cache]=process.argv.slice(2);must(dir&&['prepare','inspect','scan'].includes(mode),'ARGUMENTS');
  const v=mode==='prepare'?await prepare(dir):mode==='inspect'?await inspect(dir):await scan(dir,cache);console.log(JSON.stringify(v));}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  const code=/^PLATFORM_(IMAGE_PUBLICATION|HOSTING)_[A-Z_]+$/.test(e?.message)?e.message:'UNEXPECTED_LOCAL_OR_NETWORK_ERROR';
  console.error('PLATFORM_IMAGE_PREFLIGHT_REFUSED_NO_AWS '+code);process.exitCode=1;
});
