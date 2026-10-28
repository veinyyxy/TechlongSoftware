// Only SOURCE composition/receipts are new; the existing uploader owns all AWS I/O.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {recoveryBasisCompiler,recoveryData} from '../platform-recovery-v1/basis-core.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {createPackageIo} from '../platform-recovery-package-v1/local.mjs';
import {cycleCloudClosure} from './closure.mjs';
import {createReviewedCycle} from './cycle.mjs';
import {SELECTED_CYCLE} from './selection.mjs';
import {T,PROFILE,must,same,hash,assertAck,assertSourceIdentity,makeReview,verifyReview,uploadOnce,factsApproval} from './upload-plan.mjs';
export const ROOTS=['ops/platform-reviewed-cycle-v1/upload-local.mjs','ops/platform-reviewed-cycle-v1/composition.mjs',T.riskFile,
  'tests/platform-reviewed-cycle-upload-v1.test.mjs','.github/workflows/platform-recovery-hosting-candidate.yml',
  '.github/workflows/cloud-worker-platform-job-v6.yml','.github/workflows/cloud-worker-platform-v6.yml',
  'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
const json=async(f,max=1000000)=>JSON.parse(await readText(f,max)),write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
export const rebuild=value=>rebuildRecoveryPackage(value,recoveryBasisCompiler(PROFILE));
export async function readCandidateBody(at=Date.now()){
  const raw=await readText(T.file,T.rawBytes);must(Buffer.byteLength(raw)===T.rawBytes&&hash(raw)===T.rawSha256,'CANDIDATE_BYTES');const c=JSON.parse(raw);
  must(c.schema==='techlong/reviewed-cycle-package-candidate/v1'&&c.state==='CANDIDATE_NOT_APPROVED'&&c.newFactsWindowApproved===false&&
    c.approvedForUpload===false&&c.sourceSelected===false&&c.executionAuthorized===false&&same(c.sourceCandidate.profile,PROFILE)&&
    c.packageSha256===T.packageSha256&&c.basisSha256===T.basisSha256&&c.proposedNewExpiresAt===T.basisExpiresAt&&
    c.preparationExpiresAt===T.preparationExpiresAt&&c.originalPackageBasisExpiresAt===T.originalPackageBasisExpiresAt,'CANDIDATE_BINDING');
  const cycle=await createReviewedCycle(c.sourceCandidate),basis=await rebuild(c.packageValue),data=recoveryData(basis,at),body=canonicalJson(c.packageValue);
  must(cycle.cycleId===T.cycleId&&c.sourceCandidate.publication.state==='UNPUBLISHED'&&c.sourceCandidate.publication.packageReference===null&&
    c.sourceCandidate.publication.factsApproval===null&&data.target.newJobId===T.jobId&&basis.basisSha256===T.basisSha256&&
    basis.expiresAt===T.basisExpiresAt&&c.packageValue.objects.length===7&&Buffer.byteLength(body)===T.bytes&&hash(body)===T.packageSha256,'CANDIDATE_CONTENT');return body;
}
export async function savedReadiness(at=Date.now(),fresh=false){
  const values=[];for(const row of T.readiness){const raw=await readText(row.file,100000);must(hash(raw)===row.rawSha256,'READINESS_BYTES');values.push(JSON.parse(raw));}
  const [p,h,s,r]=values;
  must(p.outcome==='LOCAL_PACKAGE_RECONSTRUCTED_SOURCE_CLOSED'&&p.sourceCommit==='630fcf4188eabcfef1cd7041615309f82683c321'&&
    p.packageSha256===T.packageSha256&&p.basisSha256===T.basisSha256&&p.canonicalBytes===T.bytes&&p.historicalPlans===14&&p.sourceSelected===false&&
    h.outcome==='FULL_HISTORY_READONLY_COMPATIBILITY_CODE_AND_CI_VERIFIED_NO_ACTIVATION'&&h.sourceCommit==='d8c3de1f569cceb756529ec128c94df8631e24f8'&&
    h.ci?.conclusion==='success'&&h.archivedProjection.originalSealRawSha256===T.readiness[0].rawSha256&&
    same(s.profile,PROFILE)&&s.publication.state==='UNPUBLISHED'&&s.publication.packageReference===null&&
    s.publication.factsApproval===null&&s.historicalPlanCount===14&&s.historySha256===p.historySha256&&
    r.outcome==='PACKAGE_REBUILT_SOURCE_UNPUBLISHED_NOT_EXECUTABLE'&&r.packageSha256===T.packageSha256&&r.basisSha256===T.basisSha256&&
    same(r.requestEvidence,s.requestEvidence)&&r.requestEvidence.afterSha256==='c4d28f90e792b935c4fd3f3b99f80775410d481e0bb15e72f4804cf2da0bea52'&&
    r.preparationExpiresAt===T.preparationExpiresAt,'READINESS_BINDING');
  for(const row of h.changedFiles)must(hash((await readText(ROOT+'/'+row.file,100000)).replaceAll('\r\n','\n'))===row.normalizedLfSha256,'HISTORY_FIX_DRIFT');
  must((await createReviewedCycle(s)).cycleId===T.cycleId,'READINESS_CYCLE');
  if(fresh)must(Number.isSafeInteger(at)&&at>=T.preparationEarliestAt&&at<T.preparationExpiresAt,'PREPARATION_FIVE_HOUR_WINDOW');
  return {archives:T.readiness,originalObservedTimesPreserved:true};
}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields={PrepareSaved:['--mode','--ci-run','--output'],UploadReviewed:['--mode','--manifest','--approved-sha','--output'],
    Inspect:['--mode','--manifest','--approved-sha','--output']}[a['--mode']];must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  const dir=v=>/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-upload-[a-z0-9-]+$/.test(v??'');must(dir(a['--output']),'OUTPUT');
  if(a['--manifest'])must(path.basename(a['--manifest'])==='manifest.json'&&dir(path.dirname(a['--manifest']).replaceAll('\\','/'))&&/^[a-f0-9]{64}$/.test(a['--approved-sha']),'MANIFEST');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'REVIEWED_CYCLE_PACKAGE_REQUIRES_EXACT_APPROVAL',awsCalls:0,sqlConnections:0,
    configurationContentReads:0,pemReads:0,uploads:0,slotsConsumed:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'ENVIRONMENT');
  const head=git(['rev-parse','HEAD']).trim(),collect=()=>pins({roots:ROOTS}),clean=async m=>{
    must(SELECTED_CYCLE===null&&git(['rev-parse','HEAD']).trim()===head&&git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!m||m.sourceCommit===head),'SOURCE');
    if(m)must(same(await collect(),m.pins),'SOURCE_PINS');const c=await cycleCloudClosure();must(c.pinCount===110&&c.closureSha256===T.closureSha256,'CLOUD_CLOSURE');};
  await clean();await noLinks('F:/ChatGPT_workshop');await absent(a['--output']);
  if(a['--mode']==='PrepareSaved'){
    await absent(T.slot);await absent(T.inspectSlot);await savedReadiness(Date.now(),true);await readCandidateBody();
    const m=await makeReview({sourceCommit:head,pins:await collect(),ci:await readCi(a['--ci-run'],head),createdAt:Date.now()});await clean(m);
    await mkdir(a['--output']);await write(a['--output']+'/manifest.json',m);const r={outcome:'REVIEWED_CYCLE_PACKAGE_REVIEW_PREPARED_NOT_APPROVED',
      sourceCommit:head,manifestSha256:m.manifestSha256,expiresAt:m.expiresAt,latestStartAt:m.expiresAt-120000,
      packageSha256:T.packageSha256,basisSha256:T.basisSha256,canonicalBytes:T.bytes,newFactsExpiresAt:T.basisExpiresAt,
      awsCalls:0,sqlConnections:0,configurationContentReads:0,pemReads:0,localCandidateContentReads:1,localReadinessContentReads:4,
      githubCiGets:3,slotsConsumed:0,newFactsWindowApproved:false,uploads:0,workflowPublications:0,executionAuthorized:false};
    await write(a['--output']+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const m=await json(a['--manifest']),approved=a['--approved-sha'];await verifyReview(m,approved,Date.now(),a['--mode']==='Inspect');await clean(m);
  if(a['--mode']!=='Inspect')await savedReadiness();
  const cap={target:T,assertSourceIdentity,assertAck,rebuild,readPackage:readCandidateBody,assertSource:()=>clean(m)};
  const inspect=async(out,ack)=>{assertAck(ack);await absent(T.inspectSlot);await absent(out);await mkdir(out);
    const io=await createPackageIo(m,out,{inspect:true,capability:cap});try{
      await io.assertSource();await write(out+'/approved-manifest.json',m);await write(T.inspectSlot,{manifestSha256:m.manifestSha256,reference:assertAck(ack),output:out,claimedAt:Date.now(),retryAllowed:false});
      const r=await io.inspect(ack);await io.assertSource();const result={...r,factsApproval:await factsApproval(m,approved),counts:io.counts(),packageOnly:true,runtimeActivated:false};
      await write(out+'/result.json',result);return result;
    }catch(e){await write(out+'/result.json',{outcome:'REVIEWED_CYCLE_PACKAGE_INSPECT_STOPPED_NO_RETRY',code:/^(?:CYCLE|RECOVERY)_PACKAGE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',counts:io.counts(),retryAllowed:false});throw e;}
    finally{io.close();}};
  if(a['--mode']==='Inspect'){
    const slot=await json(T.slot);must(slot.manifestSha256===approved&&slot.sourceCommit===head&&slot.packageSha256===T.packageSha256&&
      /^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-upload-[a-z0-9-]+$/.test(slot.output)&&same(await json(slot.output+'/approved-manifest.json'),m),'UPLOAD_SLOT');
    const r=await inspect(a['--output'],await json(slot.output+'/put-ack.json'));console.log(JSON.stringify(r));return r;
  }
  await absent(T.slot);await absent(T.inspectSlot);await readCi(m.ci.runId,head);await mkdir(a['--output']);
  const io=await createPackageIo(m,a['--output'],{capability:cap});let result;
  try{await write(a['--output']+'/approved-manifest.json',m);result=await uploadOnce({manifest:m,approved,io});}
  catch(e){result={outcome:'REVIEWED_CYCLE_PACKAGE_UPLOAD_STOPPED_NO_RETRY',code:/^(?:CYCLE|RECOVERY)_PACKAGE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',retryAllowed:false};}
  finally{try{await write(a['--output']+'/result.json',{...result,counts:io.counts()});}finally{io.close();}}
  if(result.outcome==='RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT'){
    const verified=await inspect(a['--output']+'-inspect',await json(a['--output']+'/put-ack.json'));console.log(JSON.stringify(verified));return verified;
  }
  process.exitCode=1;console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('REVIEWED_CYCLE_PACKAGE_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;});
