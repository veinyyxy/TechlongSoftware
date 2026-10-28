import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {a604CloudClosure} from '../platform-a604-cloud-v1/closure.mjs';
export async function cycleCloudClosure(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),old=await a604CloudClosure(),pins=new Map(),hash=v=>createHash('sha256').update(v).digest('hex');
  if(old.pinCount!==104||old.closureSha256!=='f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269')throw Error('REVIEWED_CYCLE_FROZEN_DRIFT');
  async function visit(file){
    const full=await realpath(path.join(root,file)),rel=path.relative(root,full).replaceAll('\\','/');
    if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('REVIEWED_CYCLE_CLOSURE_OUTSIDE');if(pins.has(rel))return;
    const text=(await readFile(full,'utf8')).replaceAll('\r\n','\n');
    if(!/(?:^|\/)package(?:-lock)?\.json$/.test(rel)&&/node\x3achild_process|\bfrom\x4coginCredentials\b|F:[/\\]|E:[/\\]|\.env\.local/.test(text))throw Error('REVIEWED_CYCLE_LOCAL_CAPABILITY:'+rel);
    pins.set(rel,{file:rel,normalizedLfSha256:hash(text)});
    if(!/\.(?:mjs|js|ts)$/.test(rel))return;
    for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g))await visit(path.relative(root,path.resolve(path.dirname(full),m[1])).replaceAll('\\','/'));
  }
  for(const p of old.pins)await visit(p.file);
  await visit('ops/platform-reviewed-cycle-v1/closure.mjs');await visit('ops/platform-reviewed-cycle-v1/live.mjs');
  await visit('docs/aws-auto-deployment-reviewed-cycle-v1.md');
  const values=[...pins.values()].sort((a,b)=>a.file.localeCompare(b.file));
  for(const p of old.pins)if(pins.get(p.file)?.normalizedLfSha256!==p.normalizedLfSha256)throw Error('REVIEWED_CYCLE_OLD_PIN_DRIFT');
  return {schema:'techlong/reviewed-cycle-cloud-closure/v1',pinCount:values.length,pins:values,closureSha256:hash(JSON.stringify(values)),
    previousA604ClosureSha256:old.closureSha256,previousRecoveryClosureSha256:old.previousRecoveryClosureSha256,
    previousPlatformClosureSha256:old.previousPlatformClosureSha256,legacyClosureSha256:old.legacyClosureSha256};
}
