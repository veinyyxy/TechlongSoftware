// Explicit reviewed local publisher. --check has no credential/private/network port.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ROOT,environment,git,readText,noLinks,absent,writeOnce,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {RECOVERY_CONTROL_BINDING as B,assertRecoveryPublication,bindRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {validate as validateHosting,request as hostingRequest,hash as rawHash} from '../platform-recovery-hosting-v1/plan.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {createLiveIo} from './io.mjs';
import {makeReview,verifyReview,runReviewed,RISK,must,same} from './operation.mjs';
const BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-recovery-launch-v1/local.mjs','tests/platform-recovery-launch-v1.test.mjs',RISK,
  'package.json','package-lock.json','.github/workflows/platform-recovery-hosting-candidate.yml'];
const json=async f=>JSON.parse(await readText(f,3000000));
const safeWrite=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const clean=expected=>{const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||h===expected),'CLEAN_SOURCE');return h;};
function evidenceFile(f,pattern){must(typeof f==='string'&&f===f.replaceAll('\\','/')&&new RegExp('^F:/ChatGPT_workshop/'+pattern+'$').test(f),'MATERIAL_PATH');return f;}
export function parseArgs(args){
  if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGUMENTS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGUMENTS');a[args[i]]=args[i+1];}
  const fields=a['--mode']==='PrepareSaved'?['--mode','--material','--ci-run','--output']:['--mode','--manifest','--approved-sha','--ready-at','--output'];
  must(['PrepareSaved','RunReviewed'].includes(a['--mode'])&&same(Object.keys(a).sort(),fields.sort()),'ARGUMENTS');
  evidenceFile(a['--output'],'techlong-recovery-launch-[a-z0-9-]+');return a;
}
async function packageFor(material,binding){
  evidenceFile(material.packageFile,'techlong-w9f-request-[a-z0-9-]+/publication-package\\.json');
  const value=await json(material.packageFile);must(await sha256Hex(value)===binding.packageReference.sha256,'PACKAGE_HASH');
  return {value,basis:await rebuildRecoveryPackage(value)};
}
async function hosting(material,source){
  evidenceFile(material.hostingManifestFile,'techlong-w9p-recovery-hosting-[a-z0-9-]+/manifest\\.json');
  evidenceFile(material.hostingIntentFile,'techlong-w9p-recovery-hosting-[a-z0-9-]+/update-intent\\.json');
  evidenceFile(material.hostingInspectionFile,'techlong-w9p-recovery-hosting-[a-z0-9-]+/result\\.json');
  const h=await json(material.hostingManifestFile);validateHosting(h,h.manifestSha256,Date.now(),true);must(h.sourceCommit===source,'HOSTING_SOURCE');
  const i=await json(material.hostingIntentFile),inspection=await json(material.hostingInspectionFile);
  must(i.manifestSha256===h.manifestSha256&&same(i.request,hostingRequest(h,i.intentAt))&&same(i.controlLease,JSON.parse(i.request.Parameters.find(p=>p.ParameterKey==='ControllerLease').ParameterValue)),'HOSTING_INTENT');
  must(inspection.outcome==='RECOVERY_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING'&&inspection.cloudWrites===0&&
    same(inspection.proof?.controlLease,i.controlLease)&&inspection.controlAcceptancePassed===false&&inspection.businessDeploymentAccepted===false,'HOSTING_INSPECTION');
  return {manifest:h,intent:i,parents:await Promise.all([material.hostingManifestFile,material.hostingIntentFile,material.hostingInspectionFile]
    .map(async file=>({file,rawSha256:rawHash(await readText(file,3000000))})))};
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){
    await assertRecoveryPublication(B);const r={outcome:'RECOVERY_LAUNCH_ENTRY_AVAILABLE_NOT_AUTHORIZED',operations:['PublishReview','AdvanceReview'],
      privateReads:0,awsCalls:0,sqlConnections:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;
  }
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  await assertRecoveryPublication(B);const sourceCommit=clean(),binding=await bindRecoveryPublication(B,sourceCommit),out=a['--output'];
  await noLinks(BASE);await absent(out);
  if(a['--mode']==='PrepareSaved'){
    evidenceFile(a['--material'],'techlong-recovery-launch-[a-z0-9-]+\\.json');const material=await json(a['--material']);
    must(same(Object.keys(material).sort(),['action','hostingInspectionFile','hostingIntentFile','hostingManifestFile','packageFile']),'MATERIAL_KEYS');
    const {basis}=await packageFor(material,binding),host=await hosting(material,sourceCommit),ci=await readCi(a['--ci-run'],sourceCommit);
    const m=await makeReview({binding,basis,sourceCommit,pins:await collectPins({roots:ROOTS}),ci,auth:await authMetadataV6(),
      hostingManifestSha256:host.manifest.manifestSha256,hostingIntentFile:material.hostingIntentFile,action:material.action,createdAt:Date.now()});
    const extra={material,materialSha256:await sha256Hex(material),parents:host.parents};clean(sourceCommit);await absent(m.slot);await mkdir(out,{mode:0o700});
    await safeWrite(out+'/manifest.json',{review:m,extra,operatorSha256:await sha256Hex({review:m,extra})});
    const r={outcome:'RECOVERY_LAUNCH_PREPARED_NOT_APPROVED',operation:m.action.operation,manifestSha256:await sha256Hex({review:m,extra}),
      expiresAt:m.expiresAt,sourceCommit,configurationContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,dispatches:0};
    await safeWrite(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  evidenceFile(a['--manifest'],'techlong-recovery-launch-[a-z0-9-]+/manifest\\.json');const saved=await json(a['--manifest']),m=saved.review,extra=saved.extra;
  must(saved.operatorSha256===a['--approved-sha']&&await sha256Hex({review:m,extra})===saved.operatorSha256,'OPERATOR_APPROVAL');
  must(same(binding,m.binding)&&same(await collectPins({roots:ROOTS}),m.pins)&&extra.materialSha256===await sha256Hex(extra.material),'SOURCE_PINS');
  const {value,basis}=await packageFor(extra.material,binding);await verifyReview(m,basis,m.manifestSha256,Date.now());
  const host=await hosting(extra.material,sourceCommit);must(same(host.parents,extra.parents)&&host.manifest.manifestSha256===m.hostingManifestSha256&&
    extra.material.hostingIntentFile===m.hostingIntentFile&&same(extra.material.action,m.action),'PARENT_DRIFT');
  await absent(m.slot);await mkdir(out,{mode:0o700});const record=(n,v)=>safeWrite(out+'/'+n+'.json',v);await record('approved-manifest',saved);
  let token;const guard=async()=>{clean(sourceCommit);must(same(await collectPins({roots:ROOTS}),m.pins),'SOURCE_DRIFT');};
  const io=createLiveIo({manifest:m,packageValue:value,record,assertSource:guard,
    claim:v=>safeWrite(m.slot,{...v,operatorSha256:saved.operatorSha256,output:out,consumedAt:Date.now()}),
    verifyCi:async()=>{
      must(same(await readCi(m.ci.runId,sourceCommit),m.ci),'CI_DRIFT');
      const raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
      token=raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);must(token,'GITHUB_AUTH');return token;
    },githubToken:()=>token});
  // This exact operator SHA covers the inner review and all parent references.
  const r=await runReviewed({manifest:m,basis,approved:m.manifestSha256,lease:host.intent.controlLease,readyAt:Date.parse(a['--ready-at']),io});
  token=undefined;console.log(JSON.stringify(r));if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('RECOVERY_LAUNCH_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;
});
