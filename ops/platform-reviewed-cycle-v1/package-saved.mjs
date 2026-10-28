// Fixed archived inputs -> local candidates only. No AWS/SQL/private-key port.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,readText,writeOnce,absent,noLinks,git,environment} from '../platform-image-source-v2/files.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {K as ORIGINAL} from '../platform-a604-package-v1/plan.mjs';
import {REQUEST_SOURCE as R} from './request-source.mjs';
import {createCyclePackagePlanner} from './package.mjs';
import {cycleCloudClosure} from './closure.mjs';
import {must} from './cycle.mjs';
export const SAVED=Object.freeze({seal:'F:/ChatGPT_workshop/techlong-reviewed-cycle-handoff-executed-verified-20261028-a.json',
  sealRawSha256:'c5b365acc3d812b7102f282a6cc3302aa42fb3e67a3a75d8cf538f594cf954bf',
  root:'F:/ChatGPT_workshop/techlong-reviewed-cycle-handoff-20261028-ready-a'});
export function parsePackageSavedArgs(args){
  if(args.length===1&&args[0]==='--check')return {check:true};
  must(args.length===2&&args[0]==='--output'&&/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-package-[a-z0-9-]+$/.test(args[1]),'PREPARE_ONLY_ARGUMENTS');
  return {output:args[1]};
}
export async function loadSavedCyclePackageInputs(){
  const raw=await readText(SAVED.seal,100000);must(await sha256Hex(raw)===SAVED.sealRawSha256,'HANDOFF_SEAL_BYTES');const seal=JSON.parse(raw);
  must(seal.outcome==='TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'&&seal.manifestSha256==='89bf6dcd122e2e0ffbc04a3f76156ffde8b9d57886d1848bc76507a57bbd9f1e'&&
    seal.oldJob.id===R.target.oldJobId&&seal.newJob.id===R.target.newJobId&&seal.artifacts.length===14,'HANDOFF_SEAL_SCOPE');
  const values=new Map();for(const row of seal.artifacts){
    must(/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-[A-Za-z0-9/_.-]+\.json$/.test(row.path)&&!row.path.includes('..')&&!values.has(row.path),'ARCHIVE_PATH');
    const bytes=await readText(row.path,4000000);must(Buffer.byteLength(bytes)===row.bytes&&await sha256Hex(bytes)===row.rawSha256,'ARCHIVE_BYTES');values.set(row.path,JSON.parse(bytes));
  }
  const root=SAVED.root,get=f=>{const v=values.get(f);must(v,'PINNED_ARTIFACT_REQUIRED');return v;},
    counts=get(root+'-inspect/counts.json'),original=await readText(ORIGINAL.file,ORIGINAL.rawBytes);
  must(Buffer.byteLength(original)===ORIGINAL.rawBytes&&await sha256Hex(original)===ORIGINAL.rawSha256,'ORIGINAL_PACKAGE_BYTES');
  return {originalPackage:JSON.parse(original).packageValue,sealRawSha256:SAVED.sealRawSha256,
    archives:[{path:SAVED.seal,rawSha256:SAVED.sealRawSha256},...seal.artifacts,{path:ORIGINAL.file,rawSha256:ORIGINAL.rawSha256}],
    handoff:{review:get(root+'/manifest.json'),approved:seal.manifestSha256,intent:get(root+'-run/transfer-intent.json'),
      after:get(root+'-inspect/independent-state.json'),inspection:get(root+'-inspect/result.json'),databaseObservedAt:counts.databaseClockSamples[0]}};
}
export async function main(args=process.argv.slice(2)){
  const a=parsePackageSavedArgs(args);if(a.check){const r={outcome:'SAVED_PACKAGE_PREPARATION_ONLY',productionReads:0,configurationContentReads:0,
    sqlConnections:0,awsCalls:0,uploads:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'LOCAL_WORKSPACE');
  const head=git(['rev-parse','HEAD']).trim(),clean=()=>must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&
    git(['rev-parse','HEAD']).trim()===head,'CLEAN_SOURCE');clean();await noLinks('F:/ChatGPT_workshop');await absent(a.output);
  const input=await loadSavedCyclePackageInputs(),candidate=await createCyclePackagePlanner({originalSha256:ORIGINAL.packageSha256})({...input,createdAt:Date.now()}),
    closure=await cycleCloudClosure();must(closure.pinCount===110&&closure.closureSha256===R.cloudClosureSha256,'CLOUD_CLOSURE_DRIFT');clean();
  await mkdir(a.output,{mode:0o700});const write=async(n,v)=>{assertEvidenceSafeV5(v);await writeOnce(a.output+'/'+n+'.json',v);};
  await write('candidate',candidate);await write('source-candidate',candidate.sourceCandidate);
  const result={outcome:'PACKAGE_REBUILT_SOURCE_UNPUBLISHED_NOT_EXECUTABLE',sourceCommit:head,archives:input.archives,cycleId:candidate.cycleId,
    packageSha256:candidate.packageSha256,basisSha256:candidate.basisSha256,profileSha256:candidate.profileSha256,
    packageKey:candidate.packageKey,canonicalBytes:candidate.canonicalBytes,objectCount:candidate.packageValue.objects.length,
    historicalJobs:candidate.sourceCandidate.historicalJobIds.length,historicalPlans:candidate.sourceCandidate.historicalPlanCount,
    historySha256:candidate.sourceCandidate.historySha256,requestEvidence:candidate.sourceCandidate.requestEvidence,
    preparationExpiresAt:candidate.preparationExpiresAt,proposedNewExpiresAt:candidate.proposedNewExpiresAt,
    cloudClosureSha256:closure.closureSha256,sourceSelected:false,newFactsWindowApproved:false,approvedForUpload:false,
    blockers:['Exact upload/facts approval and immutable VersionId are not yet available.','Workflow/source/trust publication requires its own exact approval.'],
    productionReads:0,configurationContentReads:0,sqlConnections:0,awsCalls:0,uploads:0,slotsConsumed:0,dispatches:0,executionAuthorized:false};
  await write('result',result);console.log(JSON.stringify({...result,archives:result.archives.length}));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('SAVED_PACKAGE_PREPARATION_STOPPED_NO_PRODUCTION_OPERATION');process.exitCode=1;});
