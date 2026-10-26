// Saved-read preparation, explicitly reviewed one-shot update, separate inspection.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {environment,ROOT,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {readCi} from './ci.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {createCloud} from './cloud.mjs';
import {compatibility} from './compatibility.mjs';
import {T,BEFORE,hash,same,must,review,validate,request,verifyObserved,baseline,runOnce,assertReadiness,assertSnapshotTime} from './plan.mjs';
const BASE='F:/ChatGPT_workshop';
const PARENT=BASE+'/techlong-w9o-image-publication-completed-verified-20261026-a.json',PARENT_SHA='ef343562a15d7761d86c1517015e1b445cdd81f79cc9eace40e9d54399be8b78';
export const ROOTS=['ops/platform-recovery-hosting-v1/local.mjs',T.riskFile,'tests/platform-recovery-hosting-v1.test.mjs',
  '.github/workflows/'+T.ciFile,'package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,4000000));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
async function source(expected){const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||h===expected),'CLEAN_SOURCE');return h;}
async function parentEvidence(snapshotFile,audit=false){snapshotFile=path.resolve(snapshotFile);must(path.basename(snapshotFile)==='snapshot.json'&&
  path.dirname(path.dirname(snapshotFile)).toLowerCase()===path.resolve(BASE).toLowerCase()&&/^techlong-w9p-hosting-snapshot-[a-z0-9-]+$/.test(path.basename(path.dirname(snapshotFile))),'SNAPSHOT_PATH');
  const t=await readText(PARENT,3000000);must(hash(t)===PARENT_SHA,'PARENT_SEAL');const p=JSON.parse(t);
  must(p.registry.manifestDigest===T.imageDigest&&p.registry.imageConfigDigest===T.configDigest&&p.independentInspection.locked===true,'PUBLISHED_IMAGE');
  for(const a of p.publicArtifacts)must(hash(await readText(a.file,3000000))===a.rawSha256,'PARENT_ARTIFACT');
  const text=await readText(snapshotFile,4000000),v=JSON.parse(text);must(v.counts.sts===1&&v.counts.metadata<=65&&v.counts.writes===0,'SNAPSHOT');
  assertSnapshotTime(v.checkedAt,Date.now(),audit);
  const proof=await verifyObserved(v.rawMetadata,v.extra,{controlLease:BEFORE.oldLease});must(same(baseline(v.rawMetadata,v.extra,proof),v.baseline),'SAVED_PROOF');
  return {snapshot:v,parents:[{file:PARENT,rawSha256:PARENT_SHA},{file:snapshotFile,rawSha256:hash(text)}]};}
async function directory(p){p=path.resolve(p);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w9p-recovery-hosting-[a-z0-9-]+$/.test(path.basename(p)),'OUTPUT');await noLinks(BASE);return p;}
export async function main(args=process.argv.slice(2)){
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'PLATFORM');
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=mode==='PrepareSaved'?['--mode','--output','--ci-run','--snapshot']:['--mode','--output','--manifest','--approved-sha',...(mode==='RunReviewed'?['--ready-at']:[])];
  must(['PrepareSaved','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'MODE');
  const out=await directory(a['--output']);await absent(out);const h=await source(),pin=()=>pins({roots:ROOTS});let m;
  if(mode==='PrepareSaved'){
    await absent(T.slot);await absent(T.inspectSlot);const e=await parentEvidence(a['--snapshot']),ci=await readCi(a['--ci-run'],h);
    m=review({sourceCommit:h,pins:await pin(),ci,before:e.snapshot.baseline,parents:e.parents,compatibility:await compatibility(h),nonce:randomBytes(16).toString('hex'),issuedAt:Date.now()});
    validate(m,m.manifestSha256,Date.now());await source(h);await mkdir(out);await write(out+'/manifest.json',m);
    const r={outcome:'RECOVERY_HOSTING_UPDATE_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit:h,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),awsCalls:0,privateReads:0,slotsConsumed:0};
    await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const file=path.resolve(a['--manifest']);await directory(path.dirname(file));must(path.basename(file)==='manifest.json','MANIFEST_PATH');
  m=validate(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');must(h===m.sourceCommit&&same(await pin(),m.pins)&&same(await compatibility(h),m.compatibility),'SOURCE_PINS');
  if(mode==='RunReviewed'){
    await absent(T.slot);await absent(T.inspectSlot);const e=await parentEvidence(m.parents[1].file,true);must(same(e.parents,m.parents),'PARENTS');
    const readyAt=Date.parse(a['--ready-at']);const assertHumanReady=async()=>assertReadiness(readyAt,Date.now());
    await assertHumanReady();await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),c=createCloud({manifest:m,approved:a['--approved-sha'],readOnly:false,metadataLimit:240,record});
    try{await record('approved-manifest',m);await record('operator-readiness',{readyAt,notAuthenticationEvidence:true,requiresFreshHumanReply:true});
      const r=await runOnce({manifest:m,approved:a['--approved-sha'],io:{...c,record,assertHumanReady,
        assertSource:async()=>{await source(h);must(same(await pin(),m.pins),'SOURCE_DRIFT');},
        claim:()=>write(T.slot,{manifestSha256:m.manifestSha256,output:out,consumedAt:Date.now(),retryAllowed:false}),wait:()=>new Promise(r=>setTimeout(r,10000))}});
      console.log(JSON.stringify(r));if(r.outcome.includes('REQUIRES_INSPECT'))process.exitCode=1;return r;
    }finally{c.close();}
  }
  const slot=await json(T.slot);must(slot.manifestSha256===m.manifestSha256,'SLOT_BINDING');const intent=await json(slot.output+'/update-intent.json');
  must(intent.manifestSha256===m.manifestSha256&&same(intent.request,request(m,intent.intentAt)),'INTENT');await absent(T.inspectSlot);await mkdir(out);
  await write(T.inspectSlot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false});
  const c=createCloud({manifest:m,readOnly:true,metadataLimit:65,record:(n,v)=>write(out+'/'+n+'.json',v)});try{const observed=await c.observe(intent);await write(out+'/observed.json',observed);
    const r={outcome:'RECOVERY_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',proof:observed.proof,cloudWrites:c.counts.writes,
      controlAcceptancePassed:false,businessDeploymentAccepted:false,retryAllowed:false};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }finally{c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'RECOVERY_HOSTING_ENTRY_STOPPED_NO_RETRY',code:/^RECOVERY_HOSTING_[A-Z_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD',errorType:e.name,retryAllowed:false}));process.exitCode=1;});
