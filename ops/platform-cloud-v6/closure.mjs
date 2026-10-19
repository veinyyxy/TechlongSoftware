import {readFile,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {computeCloudClosureV5} from '../cloud-worker/closure-v5.mjs';
export async function platformClosureV6() {
  const root=fileURLToPath(new URL('../../',import.meta.url)),seen=new Set(),pins=[];
  const hash=v=>createHash('sha256').update(v).digest('hex');
  async function pin(filename) {
    const absolute=await realpath(filename),file=path.relative(root,absolute).replaceAll('\\','/');
    if(file.startsWith('..')||path.isAbsolute(file))throw Error('CONTROL_V6_CLOSURE_OUTSIDE');
    if(seen.has(absolute))return;seen.add(absolute);
    const text=(await readFile(absolute,'utf8')).replace(/\r\n/g,'\n');
    if(!/(?:^|\/)package(?:-lock)?\.json$/.test(file) && /node\x3achild_process|\bfrom\x4coginCredentials\b|F:[/\\]|E:[/\\]|\.env\.local/.test(text))
      throw Error('CONTROL_V6_LOCAL_CAPABILITY_IN_CLOSURE');
    pins.push({file,normalizedLfSha256:hash(text)});
    if(!/\.(?:mjs|js|ts)$/.test(absolute))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const base=path.resolve(path.dirname(absolute),m[1]);let found;
      for(const candidate of [base,base+'.ts',base+'.mjs',base+'.js',path.join(base,'index.ts')]){try{await access(candidate);found=candidate;break;}catch{/* explicit suffix */}}
      if(!found)throw Error('CONTROL_V6_UNRESOLVED_IMPORT');await pin(found);
    }
  }
  for(const file of ['ops/platform-cloud-v6/run.mjs','ops/cloud-worker/material/public-capsule-v5.json','ops/cloud-worker/material/neon-programs-v5.json',
    'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json','package.json','package-lock.json','docs/aws-auto-deployment-cloud-worker-w5c.md'])await pin(path.join(root,file));
  pins.sort((a,b)=>a.file.localeCompare(b.file));const old=await computeCloudClosureV5();
  return {schema:'techlong/platform-cloud-closure/v6',pinCount:pins.length,pins,closureSha256:hash(JSON.stringify(pins)),legacyClosureSha256:old.closureSha256};
}
