// Reuse the reviewed Git/CFN publisher; every production writer needs a new SHA.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {createAppPublicationIo} from '../platform-publication-v6/local.mjs';
import {publishAppOnceV6} from '../platform-publication-v6/plan.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {cycleCloudClosure} from './closure.mjs';
import {sourceTemplate,Q,F,FACTS,REFERENCE,must,same,hash,validateLayout,makeReview,validateApproval,validatePreflight,reconcile,
  previousTargets,prepareObjects,verifyObjects} from './publication.mjs';
import {T} from './upload-plan.mjs';
export const ROOTS=['ops/platform-reviewed-cycle-v1/publication-local.mjs','tests/platform-reviewed-cycle-publication-v1.test.mjs',Q.riskFile,
  Q.bindingFile,Q.caller,Q.reusable,'.github/workflows/platform-recovery-hosting-candidate.yml',
  'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
const json=async f=>JSON.parse(await readText(f,2000000)),write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);},collect=()=>pins({roots:ROOTS});
export function profile(m,{readOnly=false,executionPrestate,capture=false}={}){
  return {scope:Q,frozen:F,readOnly,executionPrestate,closure:cycleCloudClosure,closureCount:110,pins:collect,verifyObjects,validateSource:validateLayout,
    validateApproval,validatePreflight,reconcile,readCi,awsMetadataMax:readOnly?13:Q.awsMetadataMax,githubGetsMax:readOnly?17:Q.githubGetsMax,
    workflowId:file=>file===Q.caller?'390829326':'390829324',capture,
    async verifyExistingTargets(get,parent){must(m.parent===parent,'TARGET_PARENT');for(const o of m.previousTargets.filter(o=>o.file!==Q.bindingFile)){
      const c=await get('contents/'+o.file+'?ref='+parent),w=await get('actions/workflows/'+path.basename(o.file));
      must(c.type==='file'&&c.sha===o.blob&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64').toString('utf8'))===o.normalizedLfSha256&&
        w.path===o.file&&w.state==='active'&&String(w.id)===(o.file===Q.caller?'390829326':'390829324'),'EXISTING_WORKFLOW');}}};
}
export async function savedPackage(){const raw=await readText(Q.packageProof,1000000);must(hash(raw)===Q.packageProofRawSha256,'PACKAGE_PROOF');const p=JSON.parse(raw);
  must(p.outcome==='PACKAGE_UPLOADED_AND_INDEPENDENT_FIXED_VERSION_VERIFIED_NO_ACTIVATION'&&same(p.packageReference,REFERENCE)&&same(p.factsApproval,FACTS)&&
    p.slots.permanentlyConsumed===true&&p.actualCounts.conditionalPuts===1&&p.actualCounts.fixedVersionGets===1&&p.runtimeActivated===false,'PACKAGE_RECEIPT');
  for(const row of p.artifacts){must(/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-[A-Za-z0-9/_.-]+\.json$/.test(row.file)&&!row.file.includes('..'),'ARCHIVE_PATH');
    must(hash(await readText(row.file,1000000))===row.rawSha256,'PACKAGE_ARCHIVE');}
  const original=await readText(T.readiness[2].file,100000);must(hash(original)===T.readiness[2].rawSha256,'REQUEST_SOURCE_ARCHIVE');
  const s=JSON.parse(original),template=sourceTemplate();must(same({...template,publication:s.publication},s),'SOURCE_REQUEST_HISTORY');
  return {file:Q.packageProof,rawSha256:Q.packageProofRawSha256};
}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields={CaptureReadiness:['--mode','--ci-run','--output'],PrepareSaved:['--mode','--ci-run','--output','--readiness'],
    PublishReviewed:['--mode','--output','--manifest','--approved-sha'],Inspect:['--mode','--output','--manifest']}[a['--mode']];
  must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');const dir=v=>/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-publication-[a-z0-9-]+$/.test(v??'');must(dir(a['--output']),'OUTPUT');
  if(a['--manifest'])must(dir(path.dirname(a['--manifest']).replaceAll('\\','/'))&&path.basename(a['--manifest'])==='manifest.json','MANIFEST');
  if(a['--readiness'])must(dir(path.dirname(a['--readiness']).replaceAll('\\','/'))&&path.basename(a['--readiness'])==='readiness.json','READINESS');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'CYCLE_SOURCE_PUBLICATION_PREPARATION_ONLY_WITHOUT_EXACT_APPROVAL',awsCalls:0,
    privateContentReads:0,externalWrites:0,dispatches:0};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'ENVIRONMENT');await noLinks('F:/ChatGPT_workshop');
  const head=git(['rev-parse','HEAD']).trim(),clean=()=>must(git(['status','--porcelain']).trim()===''&&git(['branch','--show-current']).trim()==='main'&&git(['rev-parse','HEAD']).trim()===head,'CLEAN_SOURCE');
  clean();await compatibility(head);const c=await cycleCloudClosure();must(c.pinCount===110&&c.closureSha256===F.closureSha256,'CLOSURE');
  git(['diff','--exit-code','--quiet',F.sourceCommit,head,'--',...c.pins.map(p=>p.file)]);await savedPackage();await absent(a['--output']);
  if(a['--mode']==='CaptureReadiness'){
    const ci=await readCi(a['--ci-run'],head),targets=await previousTargets(head);await mkdir(a['--output']);
    const io=await createAppPublicationIo(a['--output'],{profile:profile({parent:head,previousTargets:targets},{readOnly:true,capture:true})});
    try{const startedAt=Date.now(),baseline=await io.preflight(head);validateLayout(baseline);clean();must(baseline.main===head,'CAPTURE_REMOTE_SOURCE');
      const r={sourceCommit:head,ci,startedAt,observedAt:startedAt,captureCompletedAt:Date.now(),baseline,previousTargets:targets,counts:io.counts(),githubCiGets:3,
        limits:{sts:1,awsServiceMetadata:12,githubGetsTotal:20},externalWrites:0,slotsConsumed:0};
      await write(a['--output']+'/readiness.json',r);console.log(JSON.stringify({outcome:'CYCLE_PUBLICATION_READINESS_CAPTURED',observedAt:r.observedAt,
        counts:r.counts,githubCiGets:3,externalWrites:0}));return r;
    }catch(e){await write(a['--output']+'/result.json',{outcome:'CYCLE_PUBLICATION_READINESS_STOPPED_NO_RETRY',code:/^(?:CYCLE|APP)_PUBLICATION_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e.name,
      counts:io.counts(),githubCiGets:3,externalWrites:0});throw e;}finally{io.dispose();}
  }
  if(a['--mode']==='PrepareSaved'){
    await absent(Q.slot);await absent(Q.inspectSlot);const saved=await json(a['--readiness']);validateLayout(saved.baseline);
    must(saved.sourceCommit===head&&saved.baseline.main===head&&saved.observedAt===saved.startedAt&&Number.isSafeInteger(saved.observedAt)&&
      Date.now()>=saved.observedAt&&Date.now()-saved.observedAt<Q.snapshotMaxAgeMs&&saved.externalWrites===0&&saved.slotsConsumed===0&&
      saved.counts.push===0&&saved.counts.create===0&&saved.counts.execute===0&&saved.counts.awsMetadata<=13&&saved.counts.githubGets+saved.githubCiGets<=20,'SAVED_READINESS');
    const ci=await readCi(a['--ci-run'],head);await mkdir(a['--output']);const material=await prepareObjects({parent:head,output:a['--output']}),
      m=await makeReview({parent:head,...material,pins:await collect(),ci,baseline:saved.baseline,observedAt:saved.observedAt,createdAt:Date.now()});clean();
    await write(a['--output']+'/manifest.json',m);await write(a['--output']+'/material.json',material);const r={outcome:'CYCLE_PUBLICATION_REVIEW_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,
      parent:head,reusable:m.objects.reusable.commit,caller:m.objects.caller.commit,expiresAt:m.expiresAt,latestStartAt:m.expiresAt-1200000,
      awsCalls:0,externalWrites:0,refsChanged:0,branchesCreated:0};await write(a['--output']+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const m=await json(a['--manifest']);await validateApproval(m,a['--approved-sha'],Date.now(),a['--mode']==='Inspect',a['--mode']==='PublishReviewed');let prestate;
  const inspect=async out=>{await absent(Q.inspectSlot);await absent(out);await mkdir(out);
    const io=await createAppPublicationIo(out,{profile:profile(m,{readOnly:true,executionPrestate:prestate})});
    try{await write(Q.inspectSlot,{manifestSha256:m.manifestSha256,output:out,writesAuthorized:0,consumedAt:Date.now(),retryAllowed:false});
      const r=await io.inspect(m);await write(out+'/result.json',{...r,counts:io.counts()});return r;}finally{io.dispose();}};
  if(a['--mode']==='Inspect'){
    const slot=await json(Q.slot);must(slot.manifestSha256===m.manifestSha256&&slot.parent===m.parent&&slot.caller===m.objects.caller.commit&&
      /^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-publication-[a-z0-9-]+$/.test(slot.output),'WRITER_SLOT');prestate=await json(slot.output+'/execution-preflight.json');
    must(hash(prestate)===slot.preflightSha256,'PREFLIGHT_ARCHIVE');const r=await inspect(a['--output']);console.log(JSON.stringify(r));return r;
  }
  await absent(Q.slot);await absent(Q.inspectSlot);await mkdir(a['--output']);const io=await createAppPublicationIo(a['--output'],{profile:profile(m)});let result;
  try{await io.ci(m.ci.runId,m.parent);await write(a['--output']+'/approved-manifest.json',m);
    result=await publishAppOnceV6({manifest:m,approved:a['--approved-sha'],io,profile:profile(m)});await write(a['--output']+'/result.json',{...result,counts:io.counts()});
  }finally{io.dispose();}
  if(result.outcome==='APP_WORKFLOWS_AND_TRUST_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT'){
    const slot=await json(Q.slot);prestate=await json(a['--output']+'/execution-preflight.json');must(hash(prestate)===slot.preflightSha256,'PREFLIGHT_ARCHIVE');
    const verified=await inspect(a['--output']+'-inspect');console.log(JSON.stringify(verified));return verified;
  }
  process.exitCode=1;console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({outcome:'CYCLE_PUBLICATION_STOPPED_NO_RETRY',
  code:/^(?:CYCLE|APP)_PUBLICATION_[A-Z0-9_]+$/.test(e?.message??'')?e.message:e.name}));process.exitCode=1;});
