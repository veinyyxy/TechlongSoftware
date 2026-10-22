import {readFile,lstat,realpath,open,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {hash,same,must,S} from './review.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const EVIDENCE='F:/ChatGPT_workshop';
export function environment(e=process.env){
  must(!Object.keys(e).some(k=>/^(AWS_|GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&e[k])&&
    e.NODE_TLS_REJECT_UNAUTHORIZED!=='0','SOURCE_ENVIRONMENT_OVERRIDE');
}
export function git(args,input=''){
  const r=spawnSync('git',args,{cwd:ROOT,input,encoding:'utf8',timeout:20000,maxBuffer:3000000,windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
  must(r.status===0&&!r.error,'SOURCE_GIT');return r.stdout;
}
export async function noLinks(file){
  let at=path.resolve(file);for(;;){const s=await lstat(at);must(!s.isSymbolicLink(),'SOURCE_LINK_PATH');const parent=path.dirname(at);if(parent===at)break;at=parent;}
  must((await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'SOURCE_CANONICAL_PATH');return lstat(file);
}
export async function readText(file,max=100000){const s=await noLinks(file);must(s.isFile()&&s.size>0&&s.size<=max,'SOURCE_INPUT_FILE');return readFile(file,'utf8');}
export async function writeOnce(file,value){
  await noLinks(path.dirname(file));const h=await open(file,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
}
export async function absent(file){try{await lstat(file);must(false,'SOURCE_PERMANENT_SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
export async function directory(name){must(/^techlong-platform-source-v2-[a-f0-9]{32}$/.test(name),'SOURCE_EVIDENCE_NAME');
  await noLinks(EVIDENCE);const dir=path.join(EVIDENCE,name);await mkdir(dir,{mode:0o700});await noLinks(dir);return dir;}
export async function pins(){
  const known=new Set(git(['ls-files','-z']).split('\0')),out=new Map();
  async function visit(file){
    must(known.has(file)&&!file.includes('..')&&!file.includes('.env')&&!/\.pem$/.test(file),'SOURCE_PIN_PATH');if(out.has(file))return;
    const text=(await readText(path.join(ROOT,file),2000000)).replaceAll('\r\n','\n');out.set(file,{file,sha256:hash(text)});
    if(!/\.mjs$/.test(file))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const rel=path.relative(ROOT,path.resolve(path.dirname(path.join(ROOT,file)),m[1])).replaceAll('\\','/');await visit(rel);
    }
  }
  for(const file of ['ops/platform-image-source-v2/cli.mjs',S.riskFile,`.github/workflows/${S.sourceCiFile}`,'.github/workflows/platform-image-publish-v2.yml',
    'ops/platform-image-publication-v2/publish.mjs','tests/platform-image-source-v2.test.mjs','package.json','package-lock.json',
    'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'])await visit(file);
  return [...out.values()].sort((a,b)=>a.file.localeCompare(b.file));
}
export async function cleanSource(m){
  environment();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','SOURCE_CLEAN_MAIN');
  const head=git(['rev-parse','HEAD']).trim();
  if(m){
    git(['merge-base','--is-ancestor',m.operatorSourceCommit,head]);
    const changed=git(['diff','--name-only',m.operatorSourceCommit,head]).trim().split(/\r?\n/).filter(Boolean);
    must(changed.every(f=>['README.md',S.publicReviewFile].includes(f)),'SOURCE_CODE_DRIFT');
    must(same(await pins(),m.sourcePins),'SOURCE_PIN_DRIFT');
  }
  // Frozen reusable code must remain identical in the local import closure.
  const frozen=(await pins()).map(p=>p.file).filter(f=>/^ops\/platform-(image-publication|image-recovery|hosting)-/.test(f));
  for(const file of [...frozen,'.github/workflows/platform-image-publish-job-v2.yml']){
    const current=(await readText(path.join(ROOT,file),1000000)).replaceAll('\r\n','\n');
    must(current===git(['show',S.reusableCommit+':'+file]).replaceAll('\r\n','\n'),'SOURCE_REUSABLE_DRIFT');
  }
  return head;
}
