// PrepareSaved only: fixed, hash-checked archives. No AWS, SQL, key or .env port.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {git,ROOT,readText,noLinks,absent,writeOnce,pins as collectPins,environment} from '../platform-image-source-v2/files.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {prepareRecoveryBasis,RECOVERY,must} from './basis.mjs';
import {makeRecoveryRequestReview} from './request.mjs';
export const SAVED_DESCRIPTOR_FILE='F:/ChatGPT_workshop/techlong-w9e-execution-descriptor-20261025-a.json';
const P='F:/ChatGPT_workshop/',json=async f=>JSON.parse(await readText(f,3000000));
export function parseSavedArgs(args){
  must(args.length===4&&args[0]==='--mode'&&args[1]==='PrepareSaved'&&args[2]==='--output'&&typeof args[3]==='string','SAVED_ARGS');
  const output=path.resolve(args[3]).replaceAll('\\','/');must(/^F:\/ChatGPT_workshop\/techlong-w9e-recovery-candidate-[a-z0-9-]+$/.test(output),'SAVED_OUTPUT');return output;
}
async function archive(file,hash,count){
  const raw=await readText(file,3000000);must(await sha256Hex(raw)===hash,'SAVED_PARENT_HASH');const c=JSON.parse(raw);
  must(c.artifacts.length===count,'SAVED_PARENT_COUNT');for(const a of c.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'SAVED_PARENT_ARTIFACT');
}
export async function loadSavedInputs(){
  await archive(P+'techlong-w8z-cycle-completed-control-verified-20261025-a.json','8880ad74f5bc3983097332ecd0affaf0da0ce2db61bc60dd54089f2fa581c407',64);
  await archive(P+'techlong-w9a-inspect-reference-expiry-verified-20261025-a.json','9a53e83e66fbc722544c956aaa565e4b4b64c14ac0578ab9fa1360635b1406bb',6);
  await archive(P+'techlong-w9a-post-expiry-completed-verified-20261025-a.json','298614796821f639bd7d4e56ad707005bd1ef8b74305c0615a7900d82e08ec86',11);
  await archive(P+'techlong-w9d-fresh-cycle-readonly-verified-20261025-a.json','5811f9bffc1a946feb9a0ac3cec28abae1ed32c71aa6c796df9af0c7420d93d4',7);
  // Never manufacture an expected object and call it a fetched provider record.
  let descriptor;try{descriptor=await json(SAVED_DESCRIPTOR_FILE);}catch{must(false,'SAVED_DESCRIPTOR_REQUIRED');}
  const db=(await json(P+'techlong-w9d-fresh-cycle-readonly-20261025-a/database-snapshot.json')).snapshot;
  const state={...db.state,ledger:Object.fromEntries(Object.entries(db.state.ledger).map(([k,v])=>[k,[...v,...db.newLedger[k]].sort((a,b)=>a.plan_sha.localeCompare(b.plan_sha))]))};
  const cache=new Map();
  const files=[...[1,2,4].map(n=>P+`techlong-w8z-hosted-cycle-20261025-a-run/object-${n}.json`),
    P+'techlong-w9a-inspect-readonly-20261025-a/runonce-result.json',
    P+'techlong-w9a-post-expiry-readonly-20261025-a/original-run-report.json',P+'techlong-w9a-post-expiry-readonly-20261025-a/original-provider-after.json'];
  for(const f of files){const v=await json(f);cache.set(canonicalJson(v.reference),v.object);}
  must(descriptor.reference&&descriptor.object,'SAVED_DESCRIPTOR_SHAPE');cache.set(canonicalJson(descriptor.reference),descriptor.object);
  const result=cache.get(canonicalJson(RECOVERY.resultReference));must(result&&canonicalJson(descriptor.reference)===canonicalJson(result.value.executionReference),'SAVED_DESCRIPTOR_BINDING');
  return {capsule:await json(path.join(ROOT,'ops/cloud-worker/material/public-capsule-v5.json')),state,
    retirement:await json(P+'techlong-w9d-fresh-cycle-readonly-20261025-a/deleted-tenant.json'),
    execution:{plan:(await json(P+'techlong-w8z-hosted-cycle-20261025-a-run/handoff-proposed-runonce-plan.json')).plan,runId:RECOVERY.runId,
      run:await json(P+'techlong-w9a-inspect-readonly-20261025-a/github-run.json'),resultReference:RECOVERY.resultReference},
    readObject:async ref=>{const o=cache.get(canonicalJson(ref));must(o,'SAVED_EXACT_OBJECT_MISSING');return structuredClone(o);}};
}
export async function main(args=process.argv.slice(2)){
  const out=parseSavedArgs(args);environment();const head=git(['rev-parse','HEAD']).trim();
  must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','SAVED_CLEAN_MAIN');
  const inputs=await loadSavedInputs(),createdAt=Date.now(),basis=await prepareRecoveryBasis({...inputs,createdAt});
  const request=await makeRecoveryRequestReview({basis,sourceCommit:head,createdAt});
  const pins=await collectPins({roots:['ops/platform-recovery-v1/saved.mjs','ops/platform-recovery-v1/worker.mjs',
    'tests/platform-recovery-v1.test.mjs','tests/fixtures/platform-recovery-v1.mjs','docs/aws-auto-deployment-w9e-retired-recovery.md']});
  must(git(['rev-parse','HEAD']).trim()===head&&git(['status','--porcelain']).trim()==='','SAVED_SOURCE_DRIFT');
  await noLinks(P);await absent(out);await mkdir(out,{mode:0o700});await writeOnce(out+'/basis.json',basis);await writeOnce(out+'/request-review-candidate.json',request);
  const result={outcome:'LOCAL_RECOVERY_CANDIDATE_PREPARED_NO_WRITE_AUTHORITY',sourceCommit:head,pins,basisSha256:basis.basisSha256,
    requestCandidateSha256:request.manifestSha256,oldJobId:RECOVERY.oldJobId,newJobId:RECOVERY.newJobId,expiresAt:basis.expiresAt,
    networkCalls:0,configurationContentReads:0,pemReads:0,sqlConnections:0,slotsConsumed:0,executionAuthorized:false,
    productionEntryInstalled:false,independentCloudAcceptance:false};await writeOnce(out+'/result.json',result);
  console.log(JSON.stringify({...result,pins:undefined,output:out}));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'LOCAL_RECOVERY_PREPARATION_STOPPED_NO_RETRY',
    code:/^RECOVERY_V1_[A-Z0-9_]+$/.test(e?.message)?e.message:null,detailsWithheld:true,executionAuthorized:false}));process.exitCode=1;
});
