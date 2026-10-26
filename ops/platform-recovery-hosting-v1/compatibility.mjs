// Public source provenance only; never obtains runtime credentials.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
import {T,hash,must} from './plan.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const PROTECTED=Object.freeze(['app','components','config','db','lib','public','types','postcss.config.mjs','tsconfig.json','package.json','package-lock.json',
  'ops/platform-hosting-v1','ops/platform-recovery-control-v1','ops/platform-cloud-v6','ops/cloud-worker']);
export async function compatibility(source){
  must(/^[a-f0-9]{40}$/.test(source),'COMPATIBILITY_SOURCE');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:20000,windowsHide:true,maxBuffer:3000000});
  git(['merge-base','--is-ancestor',T.imageSource,source]);
  const cloud=await recoveryCloudClosure();must(cloud.pinCount===97&&cloud.closureSha256==='30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374','CLOUD_CLOSURE');
  git(['diff','--exit-code','--quiet',T.imageSource,source,'--',...PROTECTED,...cloud.pins.map(p=>p.file)]);
  const files=git(['diff','--name-only',T.imageSource,source]).trim().split(/\r?\n/).filter(Boolean).sort();
  return {schema:'techlong/recovery-hosting-source-compatibility/v1',sourceCommit:source,imageSource:T.imageSource,protectedCodeUnchanged:true,
    cloudClosureSha256:cloud.closureSha256,changedFilesSha256:hash(files),notAnImageRebuild:true};
}
