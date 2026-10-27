// Explicit local preparation/publication. No App signing, credentials or network on import.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {a604CloudClosure} from '../platform-a604-cloud-v1/closure.mjs';
import {createAppPublicationIo} from '../platform-publication-v6/local.mjs';
import {publishAppOnceV6} from '../platform-publication-v6/plan.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {Q,F,FACTS,REFERENCE,must,same,hash,validateLayout,makeReview,validateApproval,validatePreflight,reconcile} from './plan.mjs';
import {previousTargets,prepareObjects,verifyObjects} from './objects.mjs';
import {assertSnapshotTime,reviewReadiness} from './readiness.mjs';
export const ROOTS=['ops/platform-a604-publication-v1/local.mjs','tests/platform-a604-publication-v1.test.mjs',Q.riskFile,
  Q.bindingFile,Q.caller,Q.reusable,
  'ops/aws-sandbox/reviews/platform-a604-package-v1.executed.json','.github/workflows/platform-recovery-hosting-candidate.yml',
  'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
const json=async f=>JSON.parse(await readText(f,2000000)),write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);},collect=()=>pins({roots:ROOTS});
export function profile(m,{readOnly=false,executionPrestate}={}){
  return {scope:Q,frozen:F,readOnly,executionPrestate,closure:a604CloudClosure,closureCount:104,pins:collect,verifyObjects,validateSource:validateLayout,
    validateApproval,validatePreflight,reconcile,readCi,awsMetadataMax:readOnly?13:Q.awsMetadataMax,githubGetsMax:readOnly?17:Q.githubGetsMax,
    workflowId:file=>file===Q.caller?'390829326':'390829324',
    async verifyExistingTargets(get,parent){must(m.parent===parent,'TARGET_PARENT');for(const o of m.previousTargets.filter(o=>o.file!==Q.bindingFile)){
      const c=await get('contents/'+o.file+'?ref='+parent),w=await get('actions/workflows/'+path.basename(o.file));
      must(c.type==='file'&&c.sha===o.blob&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64').toString('utf8'))===o.normalizedLfSha256&&w.path===o.file&&w.state==='active'&&
        String(w.id)===(o.file===Q.caller?'390829326':'390829324'),'EXISTING_WORKFLOW');}}};
}
export async function savedPackage(){const raw=await readText(Q.packageProof,1000000);must(hash(raw)===Q.packageProofRawSha256,'PACKAGE_PROOF');const p=JSON.parse(raw);
  must(p.outcome==='A604_PACKAGE_UPLOADED_AND_INDEPENDENT_FIXED_VERSION_VERIFIED'&&same(p.reference,REFERENCE)&&same(p.factsApproval,FACTS)&&
    p.permanentSlotsConsumed===true&&p.counts.conditionalPuts===1&&p.counts.independentFixedVersionGets===1&&p.runtimeActivated===false,'PACKAGE_RECEIPT');
  for(const r of p.inventory){must(/^F:\/ChatGPT_workshop\/techlong-a604-package-[A-Za-z0-9/_.-]+\.json$/.test(r.file)&&!r.file.includes('..'),'ARCHIVE_PATH');
    must(hash(await readText(r.file,1000000))===r.rawSha256,'PACKAGE_ARCHIVE');}return {file:Q.packageProof,rawSha256:Q.packageProofRawSha256};}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields={CaptureReadiness:['--mode','--ci-run','--output'],PrepareSaved:['--mode','--ci-run','--output','--readiness'],
    PublishReviewed:['--mode','--output','--manifest','--approved-sha'],Inspect:['--mode','--output','--manifest']}[a['--mode']];
  must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');const dir=v=>/^F:\/ChatGPT_workshop\/techlong-a604-publication-[a-z0-9-]+$/.test(v??'');must(dir(a['--output']),'OUTPUT');
  if(a['--manifest'])must(dir(path.dirname(a['--manifest']).replaceAll('\\','/'))&&path.basename(a['--manifest'])==='manifest.json','MANIFEST');
  if(a['--readiness'])must(dir(path.dirname(a['--readiness']).replaceAll('\\','/'))&&path.basename(a['--readiness'])==='readiness.json','READINESS');return a;}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'A604_PUBLICATION_ENTRY_PREPARATION_ONLY_WITHOUT_APPROVAL',awsCalls:0,privateReads:0,externalWrites:0};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'ENVIRONMENT');await noLinks('F:/ChatGPT_workshop');
  const head=git(['rev-parse','HEAD']).trim(),clean=()=>must(git(['status','--porcelain']).trim()===''&&git(['branch','--show-current']).trim()==='main'&&git(['rev-parse','HEAD']).trim()===head,'CLEAN_SOURCE');
  clean();await compatibility(head);const c=await a604CloudClosure();must(c.pinCount===104&&c.closureSha256===F.closureSha256,'CLOSURE');await savedPackage();
  await absent(a['--output']);
  if(a['--mode']==='CaptureReadiness'){
    const ci=await readCi(a['--ci-run'],head),targets=await previousTargets(head);await mkdir(a['--output']);const io=await createAppPublicationIo(a['--output'],{profile:profile({parent:head,previousTargets:targets},{readOnly:true,capture:true})});
    try{const startedAt=Date.now(),baseline=await io.preflight(head);validateLayout(baseline);clean();const r={sourceCommit:head,ci,startedAt,observedAt:Date.now(),baseline,previousTargets:targets,counts:io.counts(),githubCiGets:3,
      limits:{sts:1,awsServiceMetadata:12,githubGetsTotal:20},externalWrites:0,slotsConsumed:0};
      await write(a['--output']+'/readiness.json',r);console.log(JSON.stringify({outcome:'A604_PUBLICATION_READINESS_CAPTURED',observedAt:r.observedAt,counts:r.counts,githubCiGets:3,externalWrites:0}));return r;
    }catch(e){await write(a['--output']+'/result.json',{outcome:'A604_PUBLICATION_READINESS_STOPPED_NO_RETRY',code:/^A604_PUBLICATION_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e.name,counts:io.counts(),githubCiGets:3,externalWrites:0});throw e;}
    finally{io.dispose();}
  }
  if(a['--mode']==='PrepareSaved'){
    await absent(Q.slot);await absent(Q.inspectSlot);const raw=await readText(a['--readiness'],2000000),saved=JSON.parse(raw);validateLayout(saved.baseline);assertSnapshotTime(saved.observedAt,Date.now());
    must(saved.externalWrites===0&&saved.slotsConsumed===0&&
      saved.counts.push===0&&saved.counts.create===0&&saved.counts.execute===0&&saved.counts.awsMetadata<=13&&saved.counts.githubGets+saved.githubCiGets<=20,'SAVED_READINESS');
    const ci=await readCi(a['--ci-run'],head);let ancestor=false,changedFiles=[];
    if(saved.sourceCommit!==head){git(['merge-base','--is-ancestor',saved.sourceCommit,head]);ancestor=true;
      changedFiles=git(['diff','--name-only',saved.sourceCommit,head]).trim().split(/\r?\n/).filter(Boolean);}
    const prepared=reviewReadiness(saved,{head,rawSha256:hash(raw),ancestor,changedFiles,now:Date.now()});
    await mkdir(a['--output']);const material=await prepareObjects({parent:head,output:a['--output']}),
      m=await makeReview({parent:head,...material,...prepared,pins:await collect(),ci,observedAt:saved.observedAt,createdAt:Date.now()});clean();
    await write(a['--output']+'/manifest.json',m);await write(a['--output']+'/material.json',material);const r={outcome:'A604_PUBLICATION_REVIEW_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,
      parent:head,reusable:m.objects.reusable.commit,caller:m.objects.caller.commit,expiresAt:m.expiresAt,latestStartAt:m.expiresAt-1200000,awsCalls:0,externalWrites:0,refsChanged:0,branchesCreated:0};
    await write(a['--output']+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const m=await json(a['--manifest']);await validateApproval(m,a['--approved-sha'],Date.now(),a['--mode']==='Inspect',a['--mode']==='PublishReviewed');
  if(m.readinessOrigin){const archived=await readText(m.readinessOrigin.snapshotFile,2000000);must(hash(archived)===m.readinessOrigin.snapshotRawSha256,'ORIGIN_ARCHIVE');}
  let prestate;
  const inspect=async out=>{await absent(Q.inspectSlot);await absent(out);await mkdir(out);const io=await createAppPublicationIo(out,{profile:profile(m,{readOnly:true,executionPrestate:prestate})});
    try{await write(Q.inspectSlot,{manifestSha256:m.manifestSha256,output:out,writesAuthorized:0,consumedAt:Date.now(),retryAllowed:false});
      const r=await io.inspect(m);await write(out+'/result.json',{...r,counts:io.counts()});return r;}finally{io.dispose();}};
  if(a['--mode']==='Inspect'){
    const slot=await json(Q.slot);must(slot.manifestSha256===m.manifestSha256&&slot.parent===m.parent&&slot.caller===m.objects.caller.commit&&
      /^F:\/ChatGPT_workshop\/techlong-a604-publication-[a-z0-9-]+$/.test(slot.output),'WRITER_SLOT');prestate=await json(slot.output+'/execution-preflight.json');
    must(hash(prestate)===slot.preflightSha256,'PREFLIGHT_ARCHIVE');const r=await inspect(a['--output']);console.log(JSON.stringify(r));return r;
  }
  await absent(Q.slot);await absent(Q.inspectSlot);await mkdir(a['--output']);const io=await createAppPublicationIo(a['--output'],{profile:profile(m)});let r;
  try{await io.ci(m.ci.runId,m.parent);await write(a['--output']+'/approved-manifest.json',m);r=await publishAppOnceV6({manifest:m,approved:a['--approved-sha'],io,profile:profile(m)});
    await write(a['--output']+'/result.json',{...r,counts:io.counts()});}finally{io.dispose();}
  if(r.outcome==='APP_WORKFLOWS_AND_TRUST_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT'){
    const slot=await json(Q.slot);prestate=await json(a['--output']+'/execution-preflight.json');must(hash(prestate)===slot.preflightSha256,'PREFLIGHT_ARCHIVE');
    const verified=await inspect(a['--output']+'-inspect');console.log(JSON.stringify(verified));return verified;
  }
  process.exitCode=1;console.log(JSON.stringify(r));return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({outcome:'A604_PUBLICATION_STOPPED_NO_RETRY',code:/^A604_PUBLICATION_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e.name}));process.exitCode=1;});
