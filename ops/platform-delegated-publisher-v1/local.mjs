// Explicit reviewed entry only. --check never touches private files or services.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,readText,writeOnce,noLinks,absent,pins} from '../platform-image-source-v2/files.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {RECOVERY_CONTROL_BINDING as B,bindRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {loadOriginalRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
import {createLiveIo} from '../platform-recovery-launch-v1/io.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {proposeReviewSuccessor} from './successor.mjs';
import {publisherOperations as P,RISK,SLOT,must,same} from './operation.mjs';
const BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-delegated-publisher-v1/local.mjs','tests/platform-delegated-publisher-live-v1.test.mjs',
  'tests/platform-delegated-publisher-v1.test.mjs','tests/platform-delegated-request-handoff-v1.test.mjs',
  'ops/platform-delegated-publisher-v1/request-handoff.mjs',RISK,'.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,5000000));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const clean=expected=>{const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||h===expected),'CLEAN_SOURCE');return h;};
const evidence=f=>{must(typeof f==='string'&&/^F:\/ChatGPT_workshop\/techlong-[a-z0-9-]+(?:\/[a-zA-Z0-9_.-]+)*\.json$/.test(f)&&!f.includes('..'),'EVIDENCE_PATH');return f;};
const output=f=>{must(/^F:\/ChatGPT_workshop\/techlong-delegated-publisher-prepare-[a-z0-9-]+$/.test(f??''),'OUTPUT_PATH');return f;};
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n])&&args[n+1]&&!args[n+1].startsWith('--'),'ARGS');a[args[n]]=args[n+1];}
  const fields=a['--mode']==='PrepareSaved'?['--mode','--material','--ci-run','--output']:['--mode','--manifest','--approved-sha'];
  must(['PrepareSaved','RunReviewed'].includes(a['--mode'])&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  if(a['--mode']==='PrepareSaved'){evidence(a['--material']);output(a['--output']);}
  else must(/^F:\/ChatGPT_workshop\/techlong-delegated-publisher-prepare-[a-z0-9-]+\/manifest\.json$/.test(a['--manifest']??'')&&/^[a-f0-9]{64}$/.test(a['--approved-sha']??''),'MANIFEST_PATH');return a;
}
export async function savedMaterial(file,binding,{rebuild=rebuildRecoveryPackage,propose=proposeReviewSuccessor}={}){
  const material=await json(evidence(file));must(material.schema==='techlong/delegated-publisher-material/v1'&&
    same(Object.keys(material).sort(),['entryFile','objectsFile','runFile','schema','snapshotFile']),'MATERIAL');
  const archives=[{file,sha256:await sha256Hex(await readText(file,5000000))}],values={};
  for(const k of ['entryFile','objectsFile','runFile','snapshotFile']){const f=evidence(material[k]),raw=await readText(f,5000000);
    archives.push({file:f,sha256:await sha256Hex(raw)});values[k]=JSON.parse(raw);assertEvidenceSafeV5(values[k]);}
  const objects=values.objectsFile;must(Array.isArray(objects)&&objects.length===4&&new Set(objects.map(v=>v.reference?.key)).size===4,'FOUR_OBJECTS');
  for(const v of objects){must(v.reference&&v.object?.value&&v.object.versionId===v.reference.versionId&&
    v.object.encryption==='AES256'&&v.object.contentLength>0&&v.object.contentLength<=1000000&&await sha256Hex(v.object.value)===v.reference.sha256,'SAVED_OBJECT');
  }
  const packageObject=objects.find(v=>same(v.reference,binding.packageReference));must(packageObject,'ORIGINAL_PACKAGE');
  const basis=await rebuild(packageObject.object.value),entry=values.entryFile,run=values.runFile;
  must(entry.plan?.sourceCommit===binding.sourceCommit&&entry.plan.mode==='Review','MATERIAL_SOURCE');
  const candidates=objects.filter(v=>v.object.value.schema==='techlong/recovery-cloud-result/v1'&&v.object.value.run?.runId===entry.attempt?.runId);
  must(candidates.length===1,'SAVED_RESULT');
  const proposal=await propose({binding,basis,entry,run,resultReference:candidates[0].reference,
    readObject:async r=>{const v=objects.find(v=>same(v.reference,r));must(v,'SAVED_REFERENCE');return structuredClone(v.object);}});
  const envelope=objects.find(v=>same(v.reference,proposal.manifestReference)).object.value;
  return {material,archives,basis,entry,run,baseline:values.snapshotFile,resultReference:candidates[0].reference,
    packageValue:packageObject.object.value,timing:{preparedAt:envelope.innerManifest.jobPlan.preparedAt,claimBy:proposal.timing.claimBy,
      workloadExpiresAt:proposal.timing.workloadExpiresAt}};
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'DELEGATED_PUBLISHER_ENTRY_AVAILABLE_NOT_AUTHORIZED',
    webLoginRequired:false,webLeaseRequired:false,maximumPublisherWrites:3,privateReads:0,awsCalls:0,sqlConnections:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGOPTIONS','PGSERVICE'].some(k=>process.env[k]),'ENVIRONMENT');
  await noLinks(BASE);const source=clean(),binding=await bindRecoveryPublication(B,source),collect=()=>pins({roots:ROOTS});
  if(a['--mode']==='PrepareSaved'){
    const out=output(a['--output']);await absent(out);await absent(SLOT);const v=await savedMaterial(a['--material'],binding);
    const requestEvidence=await loadOriginalRequestEvidence(v.basis),review=await P.makeReview({binding,basis:v.basis,baseline:v.baseline,reviewEntry:v.entry,
      requestEvidence,action:{operation:'AdvanceReview',planSha256:v.entry.planSha256,runId:v.entry.attempt.runId,resultReference:v.resultReference},
      timing:v.timing,pins:await collect(),ci:await readCi(a['--ci-run'],source),auth:await authMetadataV6(),createdAt:Date.now()});
    const extra={materialFile:a['--material'],archives:v.archives};const operatorSha256=await sha256Hex({review,extra});
    await compatibility(source);clean(source);await mkdir(out);await write(out+'/manifest.json',{review,extra,operatorSha256});
    const r={outcome:'DELEGATED_PUBLISHER_PREPARED_NOT_APPROVED',operatorSha256,latestStartAt:review.latestStartAt,expiresAt:review.expiresAt,
      configurationContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,dispatches:0};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const saved=await json(a['--manifest']),m=saved.review,extra=saved.extra;
  must(saved.operatorSha256===a['--approved-sha']&&await sha256Hex({review:m,extra})===saved.operatorSha256&&same(m.binding,binding)&&same(await collect(),m.pins),'OPERATOR_APPROVAL_SOURCE_PINS');
  const v=await savedMaterial(evidence(extra.materialFile),binding);must(same(v.archives,extra.archives)&&same(await loadOriginalRequestEvidence(v.basis),m.requestEvidence),'ARCHIVE_DRIFT');
  await P.verifyReview(m,v.basis,m.manifestSha256,Date.now(),true);await compatibility(source);await absent(SLOT);
  const out=BASE+'/techlong-delegated-publisher-run-'+saved.operatorSha256;await absent(out);await mkdir(out);
  const record=(n,value)=>write(out+'/'+n+'.json',value);await record('approved-manifest',saved);
  let token;const guard=async()=>{clean(source);must(same(await collect(),m.pins),'SOURCE_DRIFT');};
  const io=createLiveIo({manifest:m,packageValue:v.packageValue,record,assertSource:guard,
    claim:value=>write(SLOT,{...value,operatorSha256:saved.operatorSha256,consumedAt:Date.now(),output:out,retryAllowed:false}),
    verifyCi:async()=>{must(same(await readCi(m.ci.runId,source),m.ci),'CI_DRIFT');let raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
      token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);raw=undefined;must(token,'GITHUB_AUTH');},githubToken:()=>token});
  try{const r=await P.runReviewed({manifest:m,basis:v.basis,approved:m.manifestSha256,io});console.log(JSON.stringify(r));if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;}
  finally{token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('DELEGATED_PUBLISHER_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;
});
