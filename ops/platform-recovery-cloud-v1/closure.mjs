import {readFile,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
export async function recoveryCloudClosure(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),old=await platformClosureV6(),seen=new Set(),pins=[];
  const hash=v=>createHash('sha256').update(v).digest('hex');
  async function pin(filename){
    const absolute=await realpath(filename),file=path.relative(root,absolute).replaceAll('\\','/');
    if(file.startsWith('..')||path.isAbsolute(file))throw Error('RECOVERY_CLOSURE_OUTSIDE');
    if(seen.has(absolute))return;seen.add(absolute);const text=(await readFile(absolute,'utf8')).replaceAll('\r\n','\n');
    if(!/(?:^|\/)package(?:-lock)?\.json$/.test(file)&&/node\x3achild_process|\bfrom\x4coginCredentials\b|F:[/\\]|E:[/\\]|\.env\.local/.test(text))
      throw Error('RECOVERY_CLOSURE_LOCAL_CAPABILITY:'+file);
    pins.push({file,normalizedLfSha256:hash(text)});if(!/\.(?:mjs|js|ts)$/.test(absolute))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const base=path.resolve(path.dirname(absolute),m[1]);let found;
      for(const candidate of [base,base+'.ts',base+'.mjs',base+'.js',path.join(base,'index.ts')])try{await access(candidate);found=candidate;break;}catch{/* explicit suffix */}
      if(!found)throw Error('RECOVERY_CLOSURE_IMPORT');await pin(found);
    }
  }
  for(const p of old.pins)await pin(path.join(root,p.file));
  for(const file of ['ops/platform-recovery-cloud-v1/run.mjs','docs/aws-auto-deployment-w9g-recovery-cloud-runtime.md'])await pin(path.join(root,file));
  pins.sort((a,b)=>a.file.localeCompare(b.file));
  if(old.closureSha256!=='828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a')throw Error('RECOVERY_OLD_CLOSURE_DRIFT');
  return {schema:'techlong/recovery-cloud-closure/v1',pinCount:pins.length,pins,closureSha256:hash(JSON.stringify(pins)),
    legacyClosureSha256:old.legacyClosureSha256,previousPlatformClosureSha256:old.closureSha256};
}
