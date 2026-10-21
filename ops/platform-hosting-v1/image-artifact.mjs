// Portable image evidence only. No registry login, upload, AWS or credential discovery.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {must} from './contract.mjs';
const sha=/^sha256:[a-f0-9]{64}$/;
const fields=['schema','sourceCommit','runId','runAttempt','imageConfigDigest','os','architecture','archiveFile','archiveBytes','archiveSha256'];
export function imageReceipt(inspect,archive,context){
  must(context?.CI==='true'&&context.GITHUB_ACTIONS==='true'&&context.GITHUB_REPOSITORY==='veinyyxy/TechlongSoftware'&&
    context.GITHUB_EVENT_NAME==='push'&&context.GITHUB_REF==='refs/heads/main'&&context.GITHUB_RUN_ATTEMPT==='1'&&
    /^[a-f0-9]{40}$/.test(context.GITHUB_SHA)&&/^[1-9][0-9]{5,19}$/.test(context.GITHUB_RUN_ID),'IMAGE_ARTIFACT_CONTEXT');
  must(Array.isArray(inspect)&&inspect.length===1,'IMAGE_ARTIFACT_INSPECT');const i=inspect[0];
  const env=i.Config?.Env??[],names=env.map(v=>v.split('=')[0]);
  must(sha.test(i.Id)&&i.Os==='linux'&&i.Architecture==='amd64'&&i.Config?.User==='node'&&i.Config.WorkingDir==='/app'&&
    JSON.stringify(i.Config.Cmd)===JSON.stringify(['node','ops/platform-hosting-v1/start.mjs'])&&
    JSON.stringify(i.Config.Entrypoint)===JSON.stringify(['docker-entrypoint.sh'])&&
    new Set(names).size===names.length&&names.every(v=>['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','PORT'].includes(v))&&
    ['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000'].every(v=>env.includes(v))&&
    !i.Config.Volumes&&!i.Config.OnBuild?.length,'IMAGE_ARTIFACT_IMAGE_CONFIG');
  const receipt={schema:'techlong/platform-web-image-artifact/v1',sourceCommit:context.GITHUB_SHA,runId:context.GITHUB_RUN_ID,
    runAttempt:1,imageConfigDigest:i.Id,os:'linux',architecture:'amd64',archiveFile:'image.tar.gz',
    archiveBytes:archive.bytes,archiveSha256:archive.sha256};
  verifyReceipt(receipt,archive,{sourceCommit:context.GITHUB_SHA,runId:context.GITHUB_RUN_ID});return receipt;
}
export function verifyReceipt(r,archive,expected){
  must(r&&Object.keys(r).sort().join()===fields.toSorted().join()&&r.schema==='techlong/platform-web-image-artifact/v1'&&
    /^[a-f0-9]{40}$/.test(r.sourceCommit)&&r.sourceCommit===expected.sourceCommit&&r.runId===expected.runId&&
    /^[1-9][0-9]{5,19}$/.test(r.runId)&&r.runAttempt===1&&sha.test(r.imageConfigDigest)&&r.os==='linux'&&r.architecture==='amd64'&&
    r.archiveFile==='image.tar.gz'&&Number.isSafeInteger(r.archiveBytes)&&r.archiveBytes>0&&r.archiveBytes<1610612736&&
    r.archiveBytes===archive.bytes&&/^[a-f0-9]{64}$/.test(r.archiveSha256)&&r.archiveSha256===archive.sha256,'IMAGE_ARTIFACT_RECEIPT');
  return {outcome:'IMAGE_ARCHIVE_BYTES_VERIFIED_NOT_ECR',sourceCommit:r.sourceCommit,runId:r.runId,
    imageConfigDigest:r.imageConfigDigest,archiveSha256:r.archiveSha256,registryManifestVerified:false};
}
async function regular(file,max){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<max,'IMAGE_ARTIFACT_FILE');return s;}
async function archiveDigest(file){
  const s=await regular(file,1610612736),hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){bytes+=chunk.length;must(bytes<1610612736,'IMAGE_ARTIFACT_SIZE');hash.update(chunk);}
  must(bytes===s.size,'IMAGE_ARTIFACT_CHANGED');return {bytes,sha256:hash.digest('hex')};
}
export async function main(args=process.argv.slice(2),env=process.env){
  must((args.length===2&&args[0]==='seal')||(args.length===4&&args[0]==='verify'),'IMAGE_ARTIFACT_ARGUMENTS');const dir=path.resolve(args[1]);
  const s=await lstat(dir);must(s.isDirectory()&&!s.isSymbolicLink(),'IMAGE_ARTIFACT_DIRECTORY');
  if(args[0]==='verify'){
    const file=path.join(dir,'image-receipt.json');await regular(file,8192);
    return verifyReceipt(JSON.parse(await readFile(file,'utf8')),await archiveDigest(path.join(dir,'image.tar.gz')),{sourceCommit:args[2],runId:args[3]});
  }
  const inspectFile=path.join(dir,'image-inspect.json');await regular(inspectFile,262144);
  const archive=await archiveDigest(path.join(dir,'image.tar.gz'));
  const receipt=imageReceipt(JSON.parse(await readFile(inspectFile,'utf8')),archive,env);
  // Exclusive output: never replace a previous receipt or auto-reseal old attempts.
  const text=JSON.stringify(receipt,null,2)+'\n';await writeFile(path.join(dir,'image-receipt.json'),text,{flag:'wx',mode:0o600});
  const digest=createHash('sha256').update(text).digest('hex');
  await writeFile(path.join(dir,'SHA256SUMS'),`${archive.sha256}  image.tar.gz\n${digest}  image-receipt.json\n`,{flag:'wx',mode:0o600});
  return verifyReceipt(receipt,archive,{sourceCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(v=>console.log(JSON.stringify(v))).catch(()=>{
  console.error('PLATFORM_IMAGE_ARTIFACT_REFUSED');process.exitCode=1;
});
