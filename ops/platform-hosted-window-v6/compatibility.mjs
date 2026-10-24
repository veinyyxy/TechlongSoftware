// Operator-only provenance witness; no environment/credentials/network discovery.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {H,hash,canonical} from '../platform-hosted-deploy-v6/contract.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const workflows=new Set(['platform-cloud-candidate.yml','platform-hosted-access-candidate.yml','platform-hosted-deploy-candidate.yml',
  'platform-hosted-inspect-candidate.yml','platform-hosted-publication-candidate.yml','platform-image-hosted-publish-job-v2.yml','platform-image-hosted-publish-v2.yml']);
const operator=/^ops\/(?:platform-hosted-(?:access-v6|deploy-v6|publication-v2|window-v6)|platform-image-(?:publication-v2|source-v2)|platform-request-v6|platform-review-v6)\//;
export function assertOperatorOnlyDiff(files,protectedFiles){
  const exact=new Set(protectedFiles);
  for(const f of files){
    if(exact.has(f)||/^(?:app|components|lib|worker|public|ops\/platform-hosting-v1|ops\/platform-cloud-v6|ops\/cloud-worker)\//.test(f)||
      !(/^(?:docs|tests|ops\/aws-sandbox\/reviews)\//.test(f)||f==='README.md'||operator.test(f)||
        f.startsWith('.github/workflows/')&&workflows.has(f.slice('.github/workflows/'.length))))throw Error('HOSTED_WINDOW_RUNTIME_SOURCE_CHANGED');
  }
}
export async function sourceCompatibility(sourceCommit){
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('HOSTED_WINDOW_SOURCE_COMMIT');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:3000000,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
  git(['merge-base','--is-ancestor',H.imageSource,sourceCommit]);
  const files=git(['diff','--name-only','-z',H.imageSource,sourceCommit]).split('\0').filter(Boolean).sort();
  const closure=await platformClosureV6();
  if(closure.closureSha256!==B.platform.closureSha256)throw Error('HOSTED_WINDOW_CLOUD_CLOSURE_CHANGED');
  assertOperatorOnlyDiff(files,closure.pins.map(p=>p.file));
  git(['diff','--exit-code','--quiet',H.imageSource,sourceCommit,'--','app','components','lib','worker','public','ops/platform-hosting-v1',
    'ops/platform-cloud-v6','ops/cloud-worker',...closure.pins.map(p=>p.file)]);
  return {schema:'techlong/image-dispatch-source-compatibility/v1',imageSourceCommit:H.imageSource,executionSourceCommit:sourceCommit,
    protectedRuntimeCodeUnchanged:true,cloudClosureSha256:closure.closureSha256,cloudPins:closure.pinCount,operatorOnlyChangedFiles:files,
    changedFilesSha256:hash(canonical(files)),notAnImageRebuild:true,notMainCheckBypass:true};
}
