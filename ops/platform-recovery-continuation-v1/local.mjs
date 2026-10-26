// Explicit single-continuation entry. No mode runs on import.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {RECOVERY_CONTROL_BINDING as B,bindRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {loadOriginalRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
import {verifyBaseline} from '../platform-recovery-launch-v1/operation.mjs';
import {confirmNeonReadiness} from '../platform-recovery-launch-v1/readiness.mjs';
import {createContinuationCloud} from '../platform-recovery-hosting-v1/cloud.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {assertReadiness,assertSnapshotTime} from '../platform-recovery-hosting-v1/plan.mjs';
import {W,hash,same,must,errorCode,verifyObserved,baseline,review,validate,request,runOnce} from './plan.mjs';
const BASE='F:/ChatGPT_workshop',PACKAGE=BASE+'/techlong-w9f-request-20261025-a/publication-package.json';
const SEALS=[{file:BASE+'/techlong-w9p-hosting-executed-verified-20261026-a.json',rawSha256:'62b30828ebfe0a154ebe7ae25e2c2da8227b9a69f11824b041594e53778f4b5b'},
  {file:BASE+'/techlong-recovery-continuation-readonly-plan-verified-20261026-a.json',rawSha256:'17726eb50c7c87b9070d6a6818a9453822028d9e648d27ad649b3e8901d048f2'}];
export const ROOTS=['ops/platform-recovery-continuation-v1/local.mjs','ops/platform-recovery-launch-v1/local.mjs',W.riskFile,
  'tests/platform-recovery-continuation-v1.test.mjs','tests/platform-recovery-launch-v1.test.mjs',
  '.github/workflows/'+W.ciFile,'package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,4000000));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const clean=expected=>{const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||expected===h),'SOURCE');return h;};
function outputPath(v){must(/^F:\/ChatGPT_workshop\/techlong-recovery-hosting-continuation-[a-z0-9-]+$/.test(v??''),'OUTPUT');return v;}
export function parseArgs(args){
  if(same(args,['--check']))return {'--mode':'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=mode==='Snapshot'?['--mode','--output']:mode==='PrepareSaved'?['--mode','--output','--snapshot','--ci-run']:
    ['--mode','--output','--manifest','--approved-sha',...(mode==='RunReviewed'?['--ready-at']:[])];
  must(['Snapshot','PrepareSaved','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort()),'MODE');outputPath(a['--output']);return a;
}
export async function loadSavedEvidence(snapshotFile,{audit=false}={}){
  const parents=[];
  for(const ref of SEALS){const text=await readText(ref.file,4000000);must(hash(text)===ref.rawSha256,'SEAL');const s=JSON.parse(text);
    for(const a of s.artifacts)must(hash(await readText(a.file,4000000))===a.rawSha256,'PARENT_ARTIFACT');parents.push(ref);}
  must(/^F:\/ChatGPT_workshop\/techlong-(?:recovery-continuation-snapshot|recovery-hosting-continuation)-[a-z0-9-]+\/snapshot\.json$/.test(snapshotFile),'SNAPSHOT_PATH');
  const text=await readText(snapshotFile,4000000),s=JSON.parse(text);must(s.counts?.sts===1&&s.counts.metadata<=65&&s.counts.writes===0,'SNAPSHOT_COUNTS');
  assertSnapshotTime(s.checkedAt,Date.now(),audit);const proof=await verifyObserved(s.rawMetadata,s.extra,{}),before=baseline(s.rawMetadata,s.extra,proof);
  const images=s.imageManifest??s.image?.rawManifest,i=images?.images?.[0];must(images&&!images.failures?.length&&images.images?.length===1&&
    i.imageId?.imageDigest===W.imageDigest&&'sha256:'+hash(i.imageManifest)===W.imageDigest&&JSON.parse(i.imageManifest).config.digest===W.configDigest,'ECR');
  const pkg=await json(PACKAGE);must(await sha256Hex(pkg)===B.packageReference.sha256,'PACKAGE');const basis=await rebuildRecoveryPackage(pkg),requestEvidence=await loadOriginalRequestEvidence(basis);
  const stateFile=BASE+'/techlong-recovery-launch-path-confirmation-20261026-a/actual-state.json',state=await json(stateFile);
  await verifyBaseline(basis,state,'PublishReview',await bindRecoveryPublication(B,W.priorSource),requestEvidence);
  parents.push({file:snapshotFile,rawSha256:hash(text)},{file:stateFile,rawSha256:hash(await readText(stateFile,4000000))});
  return {before,parents,basis,requestEvidence};
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args),mode=a['--mode'];if(mode==='Check'){
    const r={outcome:'CONTINUATION_ENTRY_NOT_AUTHORIZED',priorRevision:9,imageUnchanged:true,privateReads:0,awsCalls:0,sqlConnections:0,slotsConsumed:0};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'PLATFORM');
  const h=clean(),out=a['--output'];await noLinks(BASE);await absent(out);const pin=()=>pins({roots:ROOTS});
  if(mode==='Snapshot'){
    await mkdir(out);const c=createContinuationCloud({readOnly:true,metadataLimit:65,record:(n,v)=>write(out+'/'+n+'.json',v)});
    try{const s=await c.snapshot();await write(out+'/snapshot.json',{schema:'techlong/recovery-continuation-readonly/v1',sourceCommit:h,...s});
      const r={outcome:'CONTINUATION_READONLY_SNAPSHOT_VERIFIED',counts:c.counts,checkedAt:s.checkedAt};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
    }finally{c.close();}
  }
  if(mode==='PrepareSaved'){
    await absent(W.slot);await absent(W.inspectSlot);const e=await loadSavedEvidence(a['--snapshot']),ci=await readCi(a['--ci-run'],h);
    const m=review({sourceCommit:h,pins:await pin(),ci,before:e.before,parents:e.parents,requestEvidence:e.requestEvidence,auth:await authMetadataV6(),
      compatibility:await compatibility(h),nonce:randomBytes(16).toString('hex'),issuedAt:Date.now()});validate(m,m.manifestSha256,Date.now());clean(h);await mkdir(out);
    await write(out+'/manifest.json',m);const r={outcome:'CONTINUATION_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit:h,
      expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,awsCalls:0,configurationContentReads:0,sqlConnections:0,slotsConsumed:0};
    await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const f=a['--manifest'];must(typeof f==='string'&&path.basename(f)==='manifest.json','MANIFEST_PATH');outputPath(path.dirname(f).replaceAll('\\','/'));
  const m=validate(await json(f),a['--approved-sha'],Date.now(),mode==='Inspect');must(m.sourceCommit===h&&same(await pin(),m.pins)&&same(await compatibility(h),m.compatibility),'PINS');
  const guard=async()=>{clean(h);must(same(await pin(),m.pins),'SOURCE_DRIFT');};
  if(mode==='RunReviewed'){
    await absent(W.slot);await absent(W.inspectSlot);must(same(await readCi(m.ci.runId,h),m.ci),'CI_DRIFT');
    const e=await loadSavedEvidence(m.parents[2].file,{audit:true});
    must(same(e.parents,m.parents)&&same(e.requestEvidence,m.requestEvidence),'PARENTS');const readyAt=Date.parse(a['--ready-at']);assertReadiness(readyAt,Date.now());
    await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),c=createContinuationCloud({manifest:m,approved:a['--approved-sha'],readOnly:false,metadataLimit:240,record});
    try{await record('approved-manifest',m);const r=await runOnce({manifest:m,approved:a['--approved-sha'],io:{...c,record,assertSource:guard,
      assertHumanReady:async()=>assertReadiness(readyAt,Date.now()),
      confirmNeon:()=>confirmNeonReadiness({manifest:m,basis:e.basis,binding:sourceBinding(m.sourceCommit),guard,record}),
      claim:()=>write(W.slot,{manifestSha256:m.manifestSha256,output:out,consumedAt:Date.now(),retryAllowed:false}),
      wait:()=>new Promise(r=>setTimeout(r,10000))}});
      console.log(JSON.stringify(r));if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;
    }finally{c.close();}
  }
  const slot=await json(W.slot);must(slot.manifestSha256===m.manifestSha256,'SLOT');outputPath(slot.output);
  const intent=await json(slot.output+'/update-intent.json');must(intent.manifestSha256===m.manifestSha256&&same(intent.request,request(m,intent.intentAt)),'INTENT');
  await absent(W.inspectSlot);await mkdir(out);await write(W.inspectSlot,{manifestSha256:m.manifestSha256,output:out,consumedAt:Date.now(),retryAllowed:false});
  const c=createContinuationCloud({manifest:m,readOnly:true,metadataLimit:65,record:(n,v)=>write(out+'/'+n+'.json',v)});
  try{const o=await c.observe(intent);await write(out+'/observed.json',o);const r={outcome:'RECOVERY_CONTINUATION_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',proof:o.proof,
    counts:o.counts,cloudWrites:c.counts.writes,controlAcceptancePassed:false,businessDeploymentAccepted:false,retryAllowed:false};
    await write(out+'/result.json',r);console.log(JSON.stringify({outcome:r.outcome,taskDefinition:o.proof.taskDefinition,healthy:o.proof.healthy,counts:o.counts}));return r;
  }finally{c.close();}
}
function sourceBinding(source){return {...B,sourceCommit:source,activation:{...B.activation,sourceCommit:source}};}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'CONTINUATION_ENTRY_STOPPED_NO_RETRY',code:errorCode(e)}));process.exitCode=1;
});
