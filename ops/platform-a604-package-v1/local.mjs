// Reuse the original conditional PUT/fixed-version GET adapter. No live I/O on PrepareSaved.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {recoveryBasisCompiler,recoveryData} from '../platform-recovery-v1/basis-core.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {A604_PROFILE} from '../platform-a604-cloud-v1/profile.mjs';
import {a604CloudClosure} from '../platform-a604-cloud-v1/closure.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {createPackageIo} from '../platform-recovery-package-v1/local.mjs';
import {K,must,same,hash,assertAck,assertSourceIdentity,makeReview,verifyReview,uploadOnce,factsApproval} from './plan.mjs';
export const ROOTS=['ops/platform-a604-package-v1/local.mjs','tests/platform-a604-package-v1.test.mjs',K.riskFile,
  '.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
const json=async(f,max=1000000)=>JSON.parse(await readText(f,max)),write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
export const rebuild=value=>rebuildRecoveryPackage(value,recoveryBasisCompiler(A604_PROFILE));
export async function readCandidateBody(at=Date.now()){
  const raw=await readText(K.file,K.rawBytes);must(Buffer.byteLength(raw)===K.rawBytes&&hash(raw)===K.rawSha256,'CANDIDATE_RAW');const c=JSON.parse(raw);
  must(c.state==='CANDIDATE_NOT_APPROVED'&&c.newFactsWindowApproved===false&&c.approvedForUpload===false&&
    c.packageSha256===K.packageSha256&&c.basisSha256===K.basisSha256&&c.proposedNewExpiresAt===K.basisExpiresAt,'CANDIDATE_BINDING');
  const basis=await rebuild(c.packageValue),data=recoveryData(basis,at),body=canonicalJson(c.packageValue);
  must(data.target.newJobId===K.jobId&&basis.basisSha256===K.basisSha256&&basis.expiresAt===K.basisExpiresAt&&
    c.packageValue.objects.length===7&&Buffer.byteLength(body)===K.bytes&&hash(body)===K.packageSha256,'CANDIDATE_CONTENT');return body;
}
export async function savedReadiness(at=Date.now(),fresh=false){
  const raw=await readText(K.readinessFile,1000000);must(hash(raw)===K.readinessRawSha256,'READINESS_SEAL');const seal=JSON.parse(raw);
  must(seal.outcome==='CURRENT_FACTS_MATCHED_PUBLICATION_STILL_CLOSED'&&seal.sourceCommit==='2b4601ff6644d3869a3ab8d5b419e46c7d4011a8'&&
    seal.checkedAt===K.readinessAt&&seal.fullDatabaseBaselineSha256==='fc63f78250538658d0d193fe7eaaf69691c26a8e9aa79a6140270b7277563b88'&&
    seal.heldJob===K.jobId&&seal.newLedgerEmpty===true&&seal.targetPackageObjectAbsent===true&&seal.newFactsWindowApproved===false&&Array.isArray(seal.inventory),'READINESS_BINDING');
  const snapshot=seal.inventory.find(r=>r.file.endsWith('/techlong-a604-publication-readonly-20261027-c/neon-snapshot.json'));
  must(snapshot&&Array.isArray(seal.inventory)&&seal.inventory.length>=10,'READINESS_INVENTORY');
  for(const r of seal.inventory){must(/^F:\/ChatGPT_workshop\/techlong-a604-publication-readonly-20261027-[abc]\/[a-z0-9-]+\.json$/.test(r.file),'ARCHIVE_PATH');
    must(hash(await readText(r.file,1000000))===r.rawSha256,'ARCHIVE_CHANGED');}
  const v=await json(snapshot.file);must(v.sha256==='fc63f78250538658d0d193fe7eaaf69691c26a8e9aa79a6140270b7277563b88','READINESS_DATABASE');
  if(fresh)must(at>=seal.checkedAt&&at-seal.checkedAt<7200000,'READINESS_AGE');return {file:K.readinessFile,rawSha256:K.readinessRawSha256,checkedAt:seal.checkedAt};
}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields={PrepareSaved:['--mode','--ci-run','--output'],UploadReviewed:['--mode','--manifest','--approved-sha','--output'],Inspect:['--mode','--manifest','--output']}[mode];
  must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  const dir=v=>/^F:\/ChatGPT_workshop\/techlong-a604-package-[a-z0-9-]+$/.test(v??'');must(dir(a['--output']),'OUTPUT');
  if(a['--manifest'])must(path.basename(a['--manifest'])==='manifest.json'&&dir(path.dirname(a['--manifest']).replaceAll('\\','/')),'MANIFEST');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'A604_PACKAGE_CODE_AVAILABLE_NOT_AUTHORIZED',awsCalls:0,sqlConnections:0,privateReads:0,uploads:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'ENVIRONMENT');
  const head=git(['rev-parse','HEAD']).trim(),collect=()=>pins({roots:ROOTS}),clean=async m=>{must(git(['rev-parse','HEAD']).trim()===head&&
    git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!m||m.sourceCommit===head),'SOURCE');
    if(m)must(same(await collect(),m.pins),'SOURCE_PINS');await compatibility(head);const c=await a604CloudClosure();must(c.pinCount===104&&c.closureSha256===K.closureSha256,'CLOUD_CLOSURE');};
  await clean();await savedReadiness(Date.now(),a['--mode']==='PrepareSaved');await noLinks('F:/ChatGPT_workshop');await absent(a['--output']);
  if(a['--mode']==='PrepareSaved'){
    await absent(K.slot);await absent(K.inspectSlot);const ci=await readCi(a['--ci-run'],head);await readCandidateBody();
    const m=await makeReview({sourceCommit:head,pins:await collect(),ci,createdAt:Date.now()});await clean(m);await mkdir(a['--output']);await write(a['--output']+'/manifest.json',m);
    const result={outcome:'A604_PACKAGE_REVIEW_PREPARED_NOT_APPROVED',sourceCommit:head,manifestSha256:m.manifestSha256,expiresAt:m.expiresAt,latestStartAt:m.expiresAt-120000,
      packageSha256:K.packageSha256,basisSha256:K.basisSha256,canonicalBytes:K.bytes,newFactsExpiresAt:K.basisExpiresAt,awsCalls:0,sqlConnections:0,slotsConsumed:0,
      newFactsWindowApproved:false,uploads:0,workflowPublications:0,executionAuthorized:false};await write(a['--output']+'/result.json',result);console.log(JSON.stringify(result));return result;
  }
  const m=await json(a['--manifest']);await verifyReview(m,a['--approved-sha'],Date.now(),a['--mode']==='Inspect');await clean(m);
  const cap={target:K,assertSourceIdentity,assertAck,rebuild,readPackage:readCandidateBody,assertSource:()=>clean(m)};
  const inspect=async(out,ack)=>{await absent(K.inspectSlot);await absent(out);await mkdir(out);const io=await createPackageIo(m,out,{inspect:true,capability:cap});
    try{await io.assertSource();await write(out+'/approved-manifest.json',m);await write(K.inspectSlot,{manifestSha256:m.manifestSha256,reference:assertAck(ack),output:out,claimedAt:Date.now(),writesAuthorized:0,retryAllowed:false});
      const r=await io.inspect(ack);await io.assertSource();const result={...r,factsApproval:await factsApproval(m,m.manifestSha256),counts:io.counts(),packageOnly:true,runtimeActivated:false};
      await write(out+'/result.json',result);return result;
    }catch(e){await write(out+'/result.json',{outcome:'A604_PACKAGE_INSPECT_STOPPED_NO_RETRY',code:/^(?:A604|RECOVERY)_PACKAGE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',counts:io.counts(),retryAllowed:false});throw e;}
    finally{io.close();}};
  if(a['--mode']==='Inspect'){
    const slot=await json(K.slot);must(slot.manifestSha256===m.manifestSha256&&slot.sourceCommit===head&&slot.packageSha256===K.packageSha256&&
      /^F:\/ChatGPT_workshop\/techlong-a604-package-[a-z0-9-]+$/.test(slot.output),'UPLOAD_SLOT');
    const r=await inspect(a['--output'],await json(slot.output+'/put-ack.json'));console.log(JSON.stringify(r));return r;
  }
  await absent(K.slot);await absent(K.inspectSlot);await mkdir(a['--output']);const io=await createPackageIo(m,a['--output'],{capability:cap});let result;
  try{await write(a['--output']+'/approved-manifest.json',m);await readCi(m.ci.runId,head);result=await uploadOnce({manifest:m,approved:a['--approved-sha'],io});}
  catch(e){result={outcome:'A604_PACKAGE_UPLOAD_STOPPED_NO_RETRY',code:/^(?:A604|RECOVERY)_PACKAGE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',retryAllowed:false};}
  finally{try{await write(a['--output']+'/result.json',{...result,counts:io.counts()});}finally{io.close();}}
  if(result.outcome==='RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT'){
    const verified=await inspect(a['--output']+'-inspect',await json(a['--output']+'/put-ack.json'));console.log(JSON.stringify(verified));return verified;
  }
  process.exitCode=1;console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('A604_PACKAGE_STOPPED_NO_RETRY');process.exitCode=1;});
