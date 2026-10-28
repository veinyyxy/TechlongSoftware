// Explicit CLI. Default source publication is closed before all production I/O.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,noLinks,absent} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {keyMetadata} from '../platform-operator-v6/files.mjs';
import {createDispatchOperation} from '../platform-delegated-approval-v1/operation.mjs';
import {savedMaterial} from '../platform-delegated-publisher-v1/local.mjs';
import {proposeReviewSuccessor} from '../platform-delegated-publisher-v1/successor.mjs';
import {assertA604Publication,assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {createA604Runtime} from '../platform-a604-cloud-v1/runtime.mjs';
import {A604_PROFILE,HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {D,RISK,PUBLISH_SLOT,INSPECT_PUBLISH_SLOT,LOCAL_PUBLICATION,publicationAt} from './scope.mjs';
import {must,same,digest,slot,auditKey,oldHistory,createA604Policy} from './policy.mjs';
import {createA604DispatchIo,createA604PublisherIo} from './io.mjs';
import {createA604PublisherOperations,createA604InspectPublisherOperations,REQUEST_EVIDENCE} from './publisher.mjs';
import {createInspectProposer} from './inspect-successor.mjs';
import {preparePackageCandidate} from './package.mjs';
import {loadSealedPackageInputs} from './saved.mjs';
import {SNAPSHOT_MAX_AGE_MS} from '../platform-a604-publication-v1/readiness.mjs';
const BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-a604-operator-v1/local.mjs','ops/platform-operator-v6/key-metadata.ps1',RISK,
  'tests/platform-a604-operator-v1.test.mjs','tests/platform-a604-inspect-publisher-v1.test.mjs',
  '.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,5000000)),write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const outPath=f=>{must(/^F:\/ChatGPT_workshop\/techlong-a604-operator-[a-z0-9-]+$/.test(f??''),'OUTPUT');return f;};
const evidence=f=>{must(/^F:\/ChatGPT_workshop\/techlong-[A-Za-z0-9/_.-]+\.json$/.test(f??'')&&!f.includes('..'),'EVIDENCE_PATH');return f;};
export function assertPreparationReadiness(saved,now){
  must(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(saved?.checkedAt)&&saved.checkedAt>=0&&
    saved.checkedAt<=now&&now-saved.checkedAt<SNAPSHOT_MAX_AGE_MS,'READINESS_AGE');
}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields={PreparePackageSaved:['--mode','--ci-run','--output'],PrepareGrantSaved:['--mode','--ci-run','--output','--environment-file','--ledger-file'],
    PrepareAdvanceSaved:['--mode','--ci-run','--output','--material'],DispatchReviewed:['--mode','--grant','--approved-sha','--action','--plan-sha'],
    AdvanceReviewed:['--mode','--manifest','--approved-sha'],PrepareInspectSaved:['--mode','--ci-run','--output','--material'],
    AdvanceInspectReviewed:['--mode','--manifest','--approved-sha']}[a['--mode']];
  must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');if(a['--output'])outPath(a['--output']);
  if(a['--mode']==='DispatchReviewed')must(D.modes.includes(a['--action'])&&digest(a['--plan-sha']),'TARGET');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:LOCAL_PUBLICATION.state==='PUBLISHED'?'A604_OPERATOR_SOURCE_PUBLISHED_REQUIRES_REVIEWED_GRANT':'A604_OPERATOR_CODE_AVAILABLE_PUBLICATION_CLOSED',jobId:D.jobId,webLoginRequired:false,
    githubEnvironmentApproval:'human-owner-required',privateReads:0,sqlConnections:0,awsCalls:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGOPTIONS','PGSERVICE'].some(k=>process.env[k]),'ENVIRONMENT');await noLinks(BASE);
  const head=git(['rev-parse','HEAD']).trim(),collect=()=>pins({roots:ROOTS}),clean=()=>must(git(['rev-parse','HEAD']).trim()===head&&
    git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','CLEAN_SOURCE');clean();await compatibility(head);
  if(a['--mode']==='PreparePackageSaved'){
    const out=outPath(a['--output']);await absent(out);const ci=await readCi(a['--ci-run'],head),inputs=await loadSealedPackageInputs();
    const candidate=await preparePackageCandidate({...inputs,createdAt:Date.now()});clean();await mkdir(out);
    await write(out+'/candidate.json',candidate);const r={outcome:'A604_PACKAGE_CANDIDATE_PREPARED_NOT_APPROVED',sourceCommit:head,ci,
      sourcePins:await collect(),archives:inputs.archives,packageSha256:candidate.packageSha256,basisSha256:candidate.basisSha256,packageKey:candidate.packageKey,
      proposedNewExpiresAt:candidate.proposedNewExpiresAt,newFactsWindowApproved:false,approvedForUpload:false,
      configurationContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,executionAuthorized:false};
    await write(out+'/result.json',r);console.log(JSON.stringify({...r,sourcePins:r.sourcePins.length,archives:r.archives.length}));return r;
  }
  const binding=await publicationAt(head,Date.now()),policy=createA604Policy({publication:binding}),runtime=createA604Runtime({publication:binding});
  const isInspect=['PrepareInspectSaved','AdvanceInspectReviewed'].includes(a['--mode']),publishSlot=isInspect?INSPECT_PUBLISH_SLOT:PUBLISH_SLOT;
  const ops=(isInspect?createA604InspectPublisherOperations:createA604PublisherOperations)({publication:binding});
  const proposer=isInspect?createInspectProposer({publication:binding}):args=>proposeReviewSuccessor({...args,rebuildPackage:runtime.rebuild},
    {assertBinding:p=>assertA604Publication(p,A604_PROFILE,Date.now()),assertScope:assertA604PlanScope});
  const materialOptions={rebuild:runtime.rebuild,propose:proposer,objectCount:isInspect?6:4,expectedMode:isInspect?'RunOnce':'Review'};
  if(a['--mode']==='PrepareGrantSaved'){
    const out=outPath(a['--output']);await absent(out);for(const mode of D.modes)await absent(slot(mode));
    const ep=await json(evidence(a['--environment-file'])),ledger=await json(evidence(a['--ledger-file'])),now=Date.now();
    for(const saved of [ep,ledger])assertPreparationReadiness(saved,now);
    must(ledger.sourceCommit===head&&ledger.counts?.writes===0&&ledger.counts.configReads===1&&ledger.counts.connections===1&&
      ledger.counts.queries<=45&&await sha256Hex(ledger.snapshot)===HANDOFF.actualAfterSha256&&
      ledger.plans.every(p=>p.jobId!==D.jobId),'READINESS_BASELINE');
    const g=await policy.grant({sourceCommit:head,pins:await collect(),ci:await readCi(a['--ci-run'],head),environment:ep.environment,
      history:oldHistory(ledger.plans),auth:await authMetadataV6(),key:await keyMetadata(D.keyPath),issuedAt:now});
    clean();await mkdir(out);await write(out+'/grant.json',g);console.log(JSON.stringify({outcome:'A604_GRANT_PREPARED_NOT_APPROVED',grantSha256:g.grantSha256}));return g;
  }
  if(['PrepareAdvanceSaved','PrepareInspectSaved'].includes(a['--mode'])){
    const out=outPath(a['--output']);await absent(out);await absent(publishSlot);const materialFile=evidence(a['--material']);
    const v=await savedMaterial(materialFile,binding,materialOptions);
    const review=await ops.makeReview({binding,basis:v.basis,baseline:v.baseline,reviewEntry:v.entry,requestEvidence:REQUEST_EVIDENCE,
      action:{operation:isInspect?'AdvanceRunOnce':'AdvanceReview',planSha256:v.entry.planSha256,runId:v.entry.attempt.runId,resultReference:v.resultReference},timing:v.timing,
      pins:await collect(),ci:await readCi(a['--ci-run'],head),auth:await authMetadataV6(),createdAt:Date.now()});
    const extra={materialFile,archives:v.archives},operatorSha256=await sha256Hex({review,extra});clean();await mkdir(out);
    await write(out+'/manifest.json',{review,extra,operatorSha256});console.log(JSON.stringify({outcome:'A604_ADVANCE_PREPARED_NOT_APPROVED',operatorSha256}));return review;
  }
  if(a['--mode']==='DispatchReviewed'){
    const file=evidence(a['--grant']);must(path.basename(file)==='grant.json','GRANT_FILE');const g=await policy.approve(await json(file),a['--approved-sha'],Date.now());
    must(g.sourceCommit===head&&same(await collect(),g.pins),'SOURCE_PINS');const mode=a['--action'],target=a['--plan-sha'],out=BASE+'/techlong-a604-operator-dispatch-'+g.grantSha256+'-'+mode.toLowerCase();
    await absent(slot(mode));await absent(out);await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),start=Date.now();
    const guard=async()=>{await policy.approve(g,a['--approved-sha'],Date.now());clean();must(Date.now()-start<D.runMs&&same(await collect(),g.pins),'RUNTIME_SOURCE');};
    await record('approved-grant',g);const io=createA604DispatchIo({grant:g,mode,planSha256:target,record,guard,
      claim:()=>write(slot(mode),{grantSha256:g.grantSha256,sourceCommit:head,mode,planSha256:target,output:out,consumedAt:Date.now(),retryAllowed:false}),
      verifyCi:async()=>must(same(await readCi(g.ci.runId,head),g.ci),'CI_DRIFT')});
    const run=createDispatchOperation({definition:D,approve:policy.approve,target:policy.target,history:oldHistory,key:auditKey,historyModes:D.modes});
    const r=await run({grant:g,approved:a['--approved-sha'],mode,planSha256:target,io});console.log(JSON.stringify(r));if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;
  }
  const saved=await json(evidence(a['--manifest'])),m=saved.review,extra=saved.extra;
  must(saved.operatorSha256===a['--approved-sha']&&await sha256Hex({review:m,extra})===saved.operatorSha256&&same(m.binding,binding)&&same(await collect(),m.pins),'ADVANCE_SOURCE_APPROVAL');
  const v=await savedMaterial(evidence(extra.materialFile),binding,materialOptions);must(same(v.archives,extra.archives),'ARCHIVE_DRIFT');
  await ops.verifyReview(m,v.basis,m.manifestSha256,Date.now(),true);await absent(publishSlot);
  const out=BASE+'/techlong-a604-operator-'+(isInspect?'inspect-advance-':'advance-')+saved.operatorSha256;await absent(out);await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v);let token;
  const guard=async()=>{clean();must(same(await collect(),m.pins),'SOURCE_PINS');};
  await record('approved-manifest',saved);const io=createA604PublisherIo({manifest:m,packageValue:v.packageValue,record,assertSource:guard,
    claim:x=>write(publishSlot,{...x,operatorSha256:saved.operatorSha256,output:out,consumedAt:Date.now(),retryAllowed:false}),
    verifyCi:async()=>{must(same(await readCi(m.ci.runId,head),m.ci),'CI_DRIFT');let raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
      token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);raw=undefined;must(token,'GITHUB_AUTH');},githubToken:()=>token});
  try{const r=await ops.runReviewed({manifest:m,basis:v.basis,approved:m.manifestSha256,io,rebuildPackage:runtime.rebuild});console.log(JSON.stringify(r));if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;}
  finally{token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('A604_OPERATOR_STOPPED_NO_RETRY');process.exitCode=1;});
