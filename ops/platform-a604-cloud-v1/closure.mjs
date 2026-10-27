import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
export async function a604CloudClosure(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),old=await recoveryCloudClosure(),pins=new Map();
  const hash=v=>createHash('sha256').update(v).digest('hex');
  if(old.pinCount!==97||old.closureSha256!=='30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374')throw Error('A604_OLD_CLOSURE_DRIFT');
  async function visit(file){
    const full=await realpath(path.join(root,file)),rel=path.relative(root,full).replaceAll('\\','/');
    if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('A604_CLOSURE_OUTSIDE');if(pins.has(rel))return;
    const text=(await readFile(full,'utf8')).replaceAll('\r\n','\n');
    if(!/(?:^|\/)package(?:-lock)?\.json$/.test(rel)&&/node\x3achild_process|\bfrom\x4coginCredentials\b|F:[/\\]|E:[/\\]|\.env\.local/.test(text))throw Error('A604_LOCAL_CAPABILITY:'+rel);
    pins.set(rel,{file:rel,normalizedLfSha256:hash(text)});
    if(!/\.(?:mjs|js|ts)$/.test(rel))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)){
      await visit(path.relative(root,path.resolve(path.dirname(full),m[1])).replaceAll('\\','/'));
    }
  }
  for(const p of old.pins)await visit(p.file);
  await visit('ops/platform-a604-cloud-v1/run.mjs');
  await visit('docs/aws-auto-deployment-a604-cloud-compatibility.md');
  const values=[...pins.values()].sort((a,b)=>a.file.localeCompare(b.file));
  for(const p of old.pins)if(pins.get(p.file)?.normalizedLfSha256!==p.normalizedLfSha256)throw Error('A604_FROZEN_FILE_DRIFT');
  return {schema:'techlong/a604-cloud-closure/v1',pinCount:values.length,pins:values,closureSha256:hash(JSON.stringify(values)),
    previousRecoveryClosureSha256:old.closureSha256,previousPlatformClosureSha256:old.previousPlatformClosureSha256,legacyClosureSha256:old.legacyClosureSha256};
}
