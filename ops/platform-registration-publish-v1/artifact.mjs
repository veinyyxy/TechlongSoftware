import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertArtifactContext, fileHash, save, scan } from '../platform-image-publication-v2/artifact.mjs';
import { hash, must, same } from '../platform-image-publication-v2/plan.mjs';
import { C, verifyCandidate, verifyImageReceipt } from './contract.mjs';

export function verifyLoaded(rows) {
  const i=rows?.[0], env=i?.Config?.Env??[], names=env.map(x=>x.split('=')[0]);
  must(rows?.length===1 && i.Id===C.imageConfigDigest && i.Os==='linux' && i.Architecture==='amd64' && i.Config?.User==='node' && i.Config.WorkingDir==='/app' &&
    same(i.Config.Cmd,['node','ops/platform-hosting-v1/start.mjs']) && same(i.Config.Entrypoint,['docker-entrypoint.sh']) &&
    !i.Config.Volumes && !i.Config.OnBuild?.length && new Set(names).size===names.length && names.every(n=>['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','PORT'].includes(n)) &&
    ['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000'].every(v=>env.includes(v)),'REGISTRATION_LOADED_IMAGE');
}
export function verifySeal(receiptBytes, scanBytes, sums, archiveBytes, archiveHash) {
  const receipt=verifyImageReceipt(JSON.parse(receiptBytes));
  const summary=JSON.parse(scanBytes);
  must(archiveBytes===C.archiveBytes && archiveHash===C.archiveSha256 && hash(scanBytes)===C.scanSummarySha256 &&
    summary.outcome==='OS_HIGH_CRITICAL_ZERO' && summary.imageConfigDigest===C.imageConfigDigest && same(summary.findingSeverityCounts,{HIGH:0,CRITICAL:0}) &&
    sums===`${C.archiveSha256}  image.tar.gz\n${hash(receiptBytes)}  image-receipt.json\n${C.scanSummarySha256}  os-scan-summary.json\n`,'REGISTRATION_ARCHIVE_SEAL');
  return receipt;
}
async function github(url, token, redirect='error') {
  must(token && url.startsWith(`https://api.github.com/repos/${C.repository}/actions/`),'REGISTRATION_DOWNLOAD_SCOPE');
  return fetch(url,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},redirect,signal:AbortSignal.timeout(30000)});
}
async function prepare(dir,e=process.env) {
  assertArtifactContext(e,{publication:true});
  must(!e.DATABASE_URL && path.dirname(path.resolve(dir))===path.resolve(e.RUNNER_TEMP),'REGISTRATION_DOWNLOAD_CONTEXT');
  const repo=`https://api.github.com/repos/${C.repository}`, artifact=`${repo}/actions/artifacts/${C.artifactId}`;
  const [run,a]=await Promise.all([github(`${repo}/actions/runs/${C.runId}`,e.GH_TOKEN),github(artifact,e.GH_TOKEN)]);
  must(run.ok&&a.ok,'REGISTRATION_DOWNLOAD_METADATA');verifyCandidate(await run.json(),await a.json());
  const res=await github(artifact+'/zip',e.GH_TOKEN,'manual');must(res.status===302,'REGISTRATION_DOWNLOAD_REDIRECT');
  const u=new URL(res.headers.get('location'));
  must(u.protocol==='https:' && !u.username && !u.password && !u.port && u.hostname.endsWith('.blob.core.windows.net'),'REGISTRATION_DOWNLOAD_HOST');
  const blob=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(180000)});must(blob.ok&&blob.body,'REGISTRATION_DOWNLOAD');
  const h=createHash('sha256');let n=0;const zip=dir+'.zip';
  await pipeline(Readable.fromWeb(blob.body),new Transform({transform(buf,_,cb){n+=buf.length;if(n>C.artifactBytes){cb(Error('REGISTRATION_ZIP_SIZE'));return;}h.update(buf);cb(null,buf);}}),createWriteStream(zip,{flags:'wx',mode:0o600}));
  must(n===C.artifactBytes && `sha256:${h.digest('hex')}`===C.artifactDigest,'REGISTRATION_ZIP_BYTES');
  execFileSync('python3',['ops/platform-registration-publish-v1/extract.py',zip,dir],{stdio:'pipe',timeout:120000});
  const file=name=>path.join(dir,name), archive=file('image.tar.gz');
  const receipt=verifySeal(await readFile(file('image-receipt.json')),await readFile(file('os-scan-summary.json')),
    await readFile(file('SHA256SUMS'),'utf8'),(await lstat(archive)).size,await fileHash(archive));
  await save(file('verified-artifact.json'),{artifactId:C.artifactId,buildRunId:C.runId,orchestrationCommit:C.sourceCommit,
    sourceRecipeSha256:receipt.sourceRecipeSha256,sourceTreeOid:receipt.sourceTreeOid,artifactZipDigest:C.artifactDigest,
    archiveSha256:C.archiveSha256,imageConfigDigest:C.imageConfigDigest,executorCommit:e.GITHUB_SHA,runId:e.GITHUB_RUN_ID});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode,dir,cache,...extra]=process.argv.slice(2);
  Promise.resolve().then(async()=>{
    must(dir&&!extra.length && ['prepare','inspect','scan'].includes(mode),'REGISTRATION_ARTIFACT_ARGUMENTS');
    if(mode==='prepare') return prepare(dir);
    if(mode==='inspect') return verifyLoaded(JSON.parse(await readFile(path.join(dir,'loaded-inspect.json'),'utf8')));
    must(cache,'REGISTRATION_SCAN_CACHE');return scan(dir,cache,{candidate:C});
  }).catch(()=>{console.error('REGISTRATION_ARTIFACT_REFUSED');process.exitCode=1;});
}
