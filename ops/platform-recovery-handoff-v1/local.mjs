// Explicit operator modes only. Check/Prepare do not enable live private ports.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {RECOVERY_CONTROL_BINDING as B,bindRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {loadOriginalRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
import {verifyBaseline,runReviewed} from '../platform-recovery-launch-v1/operation.mjs';
import {ROOTS as REVIEW_ROOTS} from '../platform-recovery-launch-v1/local.mjs';
import {createLiveIo} from '../platform-recovery-launch-v1/io.mjs';
import {confirmNeonReadiness} from '../platform-recovery-launch-v1/readiness.mjs';
import {createHandoffCloud} from '../platform-recovery-hosting-v1/cloud.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {assertSnapshotTime} from '../platform-recovery-hosting-v1/plan.mjs';
import {H,hash,same,must,errorCode,verifyObserved,baseline,review,validate,verifyIntent,verifyInspection} from './plan.mjs';
import {runOnce} from './operation.mjs';
const BASE='F:/ChatGPT_workshop',PACKAGE=BASE+'/techlong-w9f-request-20261025-a/publication-package.json',
  STATE=BASE+'/techlong-recovery-hosting-continuation-run-20261026-a/neon-preflight-state.json';
export const ROOTS=[...REVIEW_ROOTS,'ops/platform-recovery-handoff-v1/local.mjs',H.riskFile,'tests/platform-recovery-handoff-v1.test.mjs'];
const json=async f=>JSON.parse(await readText(f,4000000));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const clean=expected=>{const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||expected===h),'SOURCE');return h;};
function output(v){must(/^F:\/ChatGPT_workshop\/techlong-recovery-handoff-[a-z0-9-]+$/.test(v??''),'OUTPUT');return v;}
export function parseArgs(args){if(same(args,['--check']))return {'--mode':'Check'};
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=mode==='Snapshot'?['--mode','--output']:mode==='PrepareSaved'?['--mode','--output','--snapshot','--ci-run']:
    ['--mode','--manifest','--approved-sha',...(mode==='RunReviewed'?['--ready-at']:[])];
  must(['Snapshot','PrepareSaved','RunReviewed','InspectReviewed'].includes(mode)&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  if(a['--output'])output(a['--output']);return a;
}
export async function loadParents(){const raw=await readText(H.parentFile,4000000);must(hash(raw)===H.parentSha256,'PARENT_SEAL');const seal=JSON.parse(raw);
  must(seal.newTaskDefinitionRevision===10&&seal.sourceCommit===H.priorSource&&seal.artifacts.length===16,'PARENT_BINDING');
  for(const a of seal.artifacts)must(hash(await readText(a.file,4000000))===a.rawSha256,'PARENT_ARTIFACT');
  const packageValue=await json(PACKAGE);must(await sha256Hex(packageValue)===B.packageReference.sha256,'PACKAGE');
  const basis=await rebuildRecoveryPackage(packageValue),requestEvidence=await loadOriginalRequestEvidence(basis),state=await json(STATE);
  await verifyBaseline(basis,state,'PublishReview',await bindRecoveryPublication(B,H.priorSource),requestEvidence);
  return {packageValue,basis,requestEvidence,stateReference:{file:STATE,rawSha256:hash(await readText(STATE,4000000))}};
}
export async function loadEvidence(snapshotFile,{audit=false}={}){
  must(/^F:\/ChatGPT_workshop\/techlong-recovery-handoff-[a-z0-9-]+\/snapshot\.json$/.test(snapshotFile),'SNAPSHOT_PATH');
  const e=await loadParents(),raw=await readText(snapshotFile,4000000),s=JSON.parse(raw);assertSnapshotTime(s.checkedAt,Date.now(),audit);
  must(s.counts?.sts===1&&s.counts.metadata<=65&&s.counts.writes===0,'SNAPSHOT_COUNTS');
  const proof=await verifyObserved(s.rawMetadata,s.extra,{}),before=baseline(s.rawMetadata,s.extra,proof),r=s.image?.rawManifest,i=r?.images?.[0];
  must(r&&!r.failures?.length&&r.images?.length===1&&i.imageId?.imageDigest===H.imageDigest&&'sha256:'+hash(i.imageManifest)===H.imageDigest&&
    JSON.parse(i.imageManifest).config.digest===H.configDigest,'ECR');
  return {...e,before,parents:[{file:H.parentFile,rawSha256:H.parentSha256},{file:snapshotFile,rawSha256:hash(raw)},e.stateReference]};
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args),mode=a['--mode'];if(mode==='Check'){const r={outcome:'HANDOFF_ENTRY_NOT_AUTHORIZED',priorRevision:10,
    privateReads:0,awsCalls:0,sqlConnections:0,slotsConsumed:0};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  await noLinks(BASE);const h=clean(),collect=()=>pins({roots:ROOTS});
  if(mode==='Snapshot'){const out=output(a['--output']);await absent(out);await mkdir(out);const c=createHandoffCloud({readOnly:true,metadataLimit:65,record:(n,v)=>write(out+'/'+n+'.json',v)});
    try{const s=await c.snapshot();await write(out+'/snapshot.json',{schema:'techlong/recovery-handoff-readonly/v1',sourceCommit:h,...s});
      const r={outcome:'HANDOFF_SNAPSHOT_VERIFIED',counts:c.counts};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;}finally{c.close();}}
  if(mode==='PrepareSaved'){const out=output(a['--output']);await absent(out);for(const f of [H.slot,H.inspectSlot,H.publishSlot])await absent(f);
    const e=await loadEvidence(a['--snapshot']),ci=await readCi(a['--ci-run'],h),m=review({sourceCommit:h,pins:await collect(),reviewPins:await pins({roots:REVIEW_ROOTS}),
      ci,before:e.before,parents:e.parents,requestEvidence:e.requestEvidence,compatibility:await compatibility(h),auth:await authMetadataV6(),nonce:randomBytes(16).toString('hex'),issuedAt:Date.now()});
    validate(m,m.manifestSha256,Date.now());clean(h);await absent(m.outputs.run);await absent(m.outputs.inspect);await mkdir(out);await write(out+'/manifest.json',m);
    const r={outcome:'HANDOFF_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit:h,latestStartAt:m.latestStartAt,expiresAt:m.expiresAt,
      awsCalls:0,configurationContentReads:0,sqlConnections:0,slotsConsumed:0};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;}
  const file=a['--manifest'];must(typeof file==='string'&&path.basename(file)==='manifest.json','MANIFEST_PATH');output(path.dirname(file).replaceAll('\\','/'));
  const m=validate(await json(file),a['--approved-sha'],Date.now(),mode==='InspectReviewed');
  must(m.sourceCommit===h&&same(await collect(),m.pins)&&same(await pins({roots:REVIEW_ROOTS}),m.reviewPins)&&same(await compatibility(h),m.compatibility),'SOURCE_PINS');
  const guard=async()=>{clean(h);must(same(await collect(),m.pins),'SOURCE_DRIFT');};
  if(mode==='InspectReviewed'){
    const slot=await json(H.slot);must(slot.manifestSha256===m.manifestSha256&&slot.output===m.outputs.run,'SLOT');
    const intent=await json(m.outputs.run+'/update-intent.json');verifyIntent(m,intent);
    must(Number.isSafeInteger(slot.readyAt)&&Date.now()>=slot.readyAt&&Date.now()-slot.readyAt<40*60000&&
      Date.now()>=intent.intentAt&&Date.now()-intent.intentAt<H.chainMs,'INSPECT_TIME');
    await absent(H.inspectSlot);await absent(m.outputs.inspect);await mkdir(m.outputs.inspect);
    await write(H.inspectSlot,{manifestSha256:m.manifestSha256,output:m.outputs.inspect,consumedAt:Date.now(),retryAllowed:false});
    const record=(n,v)=>write(m.outputs.inspect+'/'+n+'.json',v),c=createHandoffCloud({manifest:m,readOnly:true,metadataLimit:65,record});
    try{const v=await c.observe(intent);await record('observed',v);const r={outcome:'RECOVERY_HANDOFF_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',proof:v.proof,
      counts:{...c.counts},cloudWrites:c.counts.writes,controlAcceptancePassed:false,businessDeploymentAccepted:false,retryAllowed:false};
      verifyInspection(m,intent,r);await record('result',r);console.log(JSON.stringify({outcome:r.outcome,counts:r.counts}));return r;}finally{c.close();}}
  for(const f of [H.slot,H.inspectSlot,H.publishSlot,m.outputs.run,m.outputs.inspect])await absent(f);
  const e=await loadEvidence(m.parents[1].file,{audit:true});must(same(e.parents,m.parents)&&same(e.requestEvidence,m.requestEvidence),'PARENTS');
  const readyAt=Date.parse(a['--ready-at']),binding=await bindRecoveryPublication(B,h);await mkdir(m.outputs.run);
  const record=(n,v)=>write(m.outputs.run+'/'+n+'.json',v),cloud=createHandoffCloud({manifest:m,approved:a['--approved-sha'],readOnly:false,metadataLimit:240,record});
  await record('approved-manifest',m);let token;
  const result=await runOnce({manifest:m,approved:a['--approved-sha'],readyAt,basis:e.basis,binding,io:{cloud,record,assertSource:guard,
    verifyCi:async()=>must(same(await readCi(m.ci.runId,h),m.ci),'CI_DRIFT'),
    confirmNeon:()=>confirmNeonReadiness({manifest:m,basis:e.basis,binding,guard,record}),
    claim:()=>write(H.slot,{manifestSha256:m.manifestSha256,sourceCommit:h,output:m.outputs.run,readyAt,consumedAt:Date.now(),retryAllowed:false}),
    wait:()=>new Promise(r=>setTimeout(r,10000)),
    inspect:async()=>{await promisify(execFile)(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'--mode','InspectReviewed',
      '--manifest',file,'--approved-sha',a['--approved-sha']],{cwd:ROOT,windowsHide:true,timeout:120000,maxBuffer:100000});return json(m.outputs.inspect+'/result.json');},
    publish:async(derived,ticket,chainGuard)=>{
      await record('derived-launch-manifest',{outerApprovalSha256:m.manifestSha256,review:derived,hostingManifestFile:file,
        hostingIntentFile:m.outputs.run+'/update-intent.json',hostingInspectionFile:m.outputs.inspect+'/result.json'});
      const live=createLiveIo({manifest:derived,packageValue:e.packageValue,record:(n,v)=>record('review-'+n,v),assertSource:async()=>{await chainGuard();},
        claim:v=>write(H.publishSlot,{...v,outerApprovalSha256:m.manifestSha256,output:m.outputs.run,consumedAt:Date.now()}),
        verifyCi:async()=>{must(same(await readCi(m.ci.runId,h),m.ci),'CI_DRIFT');const raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
          token=raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);must(token,'GITHUB_AUTH');},githubToken:()=>token});
      return runReviewed({manifest:derived,basis:e.basis,approved:derived.manifestSha256,lease:JSON.parse((await readText(m.outputs.run+'/update-intent.json',4000000))).controlLease,
        readyAt,io:live,handoffSession:ticket});},
    close:async()=>{token=undefined;cloud.close();await record('cloud-counts',{...cloud.counts});}}});
  console.log(JSON.stringify({outcome:result.outcome,updates:result.updates,planSha256:result.review?.planSha256,controlLease:result.controlLease}));
  if(result.outcome.includes('STOPPED'))process.exitCode=1;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'HANDOFF_ENTRY_STOPPED_NO_RETRY',code:errorCode(e)}));process.exitCode=1;
});
