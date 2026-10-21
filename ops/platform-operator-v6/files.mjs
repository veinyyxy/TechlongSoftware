import {readFile,writeFile,lstat,realpath,open,access,mkdir} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,createPrivateKey} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {must,same} from './review.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex'),exec=promisify(execFile);
const equalPath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
export const within=(root,file)=>{const r=path.relative(root,file);return r===''||(!r.startsWith('..')&&!path.isAbsolute(r));};
export function assertEnvironment(){
  must(!['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^AWS_ENDPOINT_URL|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
}
export function git(args,input=''){
  return new Promise((resolve,reject)=>{
    const c=spawn('git',args,{cwd:ROOT,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['pipe','pipe','pipe']});
    let out='',bad=false;const timer=setTimeout(()=>{bad=true;c.kill();},20000);
    c.stdout.setEncoding('utf8');c.stdout.on('data',s=>{out+=s;if(out.length>3000000){bad=true;c.kill();}});
    c.stderr.on('data',()=>{});c.stdin.on('error',()=>{});
    c.on('error',()=>{clearTimeout(timer);reject(Error('PLATFORM_OPERATOR_GIT_UNAVAILABLE'));});
    c.on('close',code=>{clearTimeout(timer);if(code||bad)reject(Error('PLATFORM_OPERATOR_GIT_FAILED'));else resolve(out);});c.stdin.end(input);
  });
}
export async function noLinks(file){
  // Check every existing ancestor, not merely the final filename.
  let at=path.resolve(file);
  for(;;){const s=await lstat(at);must(!s.isSymbolicLink(),'LINK_PATH');const parent=path.dirname(at);if(parent===at)break;at=parent;}
  must(equalPath(await realpath(file),file),'CANONICAL_PATH');return lstat(file);
}
export async function jsonFile(file,max=10000000){
  const s=await noLinks(file);must(s.isFile()&&s.size>0&&s.size<=max,'JSON_FILE');
  const handle=await open(file,'r');try{
    const a=await handle.stat();must(a.ino===s.ino&&a.dev===s.dev&&a.size===s.size&&a.mtimeMs===s.mtimeMs,'JSON_DRIFT');
    const bytes=Buffer.alloc(max+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0),after=await handle.stat();
    must(bytesRead===a.size&&after.size===a.size&&after.mtimeMs===a.mtimeMs,'JSON_DRIFT');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
  }finally{await handle.close();}
}
export async function absent(file){try{await access(file);must(false,'OCCUPIED_NO_RETRY');}catch(e){if(e.code!=='ENOENT')throw e;}}
export async function evidenceRoot(root){
  const s=await noLinks(root);must(s.isDirectory()&&!within(ROOT,root)&&path.dirname(path.resolve(root))!==path.resolve(root),'EVIDENCE_ROOT');
  return path.resolve(root);
}
export async function writeOnce(file,value){
  assertEvidenceSafeV5(value);await noLinks(path.dirname(file));
  await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true,mode:0o600});
}
export async function newDirectory(parent,name){
  must(/^[a-z0-9-]{1,100}$/.test(name),'DIRECTORY_NAME');await noLinks(parent);
  const directory=path.join(parent,name);await mkdir(directory,{mode:0o700});await noLinks(directory);return directory;
}
export async function keyMetadata(file){
  const s=await noLinks(file);must(s.isFile()&&s.size>0&&s.size<=16000,'KEY_FILE');let protection;
  if(process.platform==='win32'){
    const r=await exec('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(ROOT,'ops/platform-operator-v6/key-metadata.ps1'),'-KeyPath',file],
      {cwd:ROOT,windowsHide:true,timeout:20000,maxBuffer:8000});
    const v=JSON.parse(r.stdout);must(v.protectedThreePrincipalAcl===true&&v.keyContentRead===false,'KEY_ACL');protection=v.protectionSha256;
  }else{
    must(typeof process.getuid==='function'&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1,'KEY_PERMISSIONS');
    protection=hash(JSON.stringify({uid:s.uid,gid:s.gid,mode:s.mode}));
  }
  return {length:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,identity:s.dev+':'+s.ino,protectionSha256:protection,contentRead:false};
}
export async function readKey(file,expected){
  must(same(await keyMetadata(file),expected),'KEY_DRIFT');const s=await noLinks(file),h=await open(file,'r');let bytes;
  try{const a=await h.stat();must(a.ino===s.ino&&a.dev===s.dev&&a.size===expected.length&&a.mtimeMs===expected.mtimeMs,'KEY_DRIFT');
    bytes=Buffer.alloc(a.size+1);const r=await h.read(bytes,0,bytes.length,0),after=await h.stat();
    must(r.bytesRead===a.size&&after.size===a.size&&after.mtimeMs===a.mtimeMs&&same(await keyMetadata(file),expected),'KEY_DRIFT');
    const pem=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,r.bytesRead)),key=createPrivateKey(pem);
    must(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048,'KEY_STRENGTH');return pem;
  }finally{bytes?.fill(0);await h.close();}
}
export async function cleanSource(expected){
  const source=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
    (await git(['status','--porcelain'])).trim()===''&&(!expected||source===expected),'CLEAN_MAIN');return source;
}
export async function sourcePins(){
  const tracked=new Set((await git(['ls-files','-z'])).split('\0')),pins=new Map(),closure=await platformClosureV6();
  must(closure.closureSha256===B.platform.closureSha256,'CLOUD_CLOSURE');
  async function visit(file){
    const absolute=path.resolve(ROOT,file),rel=path.relative(ROOT,absolute).replaceAll('\\','/');
    must(within(ROOT,absolute)&&tracked.has(rel)&&!rel.includes('.env')&&!/\.pem$/.test(rel),'PIN_TRACKED_SOURCE');
    if(pins.has(rel))return;const s=await noLinks(absolute);must(s.isFile()&&s.size<2000000,'PIN_FILE');
    const text=(await readFile(absolute,'utf8')).replaceAll('\r\n','\n');pins.set(rel,{file:rel,sha256:hash(text)});
    if(!/\.(mjs|js|ts)$/.test(rel))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const target=path.resolve(path.dirname(absolute),m[1]);let found;
      for(const c of [target,target+'.ts',target+'.mjs',target+'.js',path.join(target,'index.ts')]){
        try{if((await lstat(c)).isFile()){found=c;break;}}catch(e){if(e.code!=='ENOENT')throw e;}}
      must(found,'PIN_IMPORT');await visit(path.relative(ROOT,found));
    }
  }
  for(const file of ['ops/platform-operator-v6/cli.mjs','ops/platform-operator-v6/key-metadata.ps1',
    'tests/platform-operator-v6.test.mjs','docs/aws-auto-deployment-platform-w6y-operator-entry.md',...closure.pins.map(p=>p.file)])await visit(file);
  return [...pins.values()].sort((a,b)=>a.file.localeCompare(b.file));
}
