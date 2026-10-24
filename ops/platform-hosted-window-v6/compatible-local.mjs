// One reviewed normal-rollback UpdateStack, only after a separately verified fresh Review.
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {environment,git,pins as collectPins,readText,writeOnce,noLinks,absent} from '../platform-image-source-v2/files.mjs';
import {readLocalCiV6} from '../platform-local-v6/local.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {N,J,verifyResume,newResumePlan} from '../platform-review-v6/resume.mjs';
import {sourceCompatibility} from './compatibility.mjs';
import {compatibleCloud} from './compatible-cloud.mjs';
import {W,must,same,hash,makeWindowReview,validateWindow,validateIntent,readyResume,verifyUpdated,runCompatibleOnce} from './compatible.mjs';
const ROOT='E:/NodejsProject/TechlongSoftware',BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-hosted-window-v6/compatible.mjs','ops/platform-hosted-window-v6/compatible-cloud.mjs',
  'ops/platform-hosted-window-v6/compatible-local.mjs','tests/platform-compatible-window-v6.test.mjs',W.riskFile,
  '.github/workflows/platform-cloud-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,3000000));
async function write(f,v){assertEvidenceSafeV5(v);await writeOnce(f,v);}
async function source(expected){const head=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||head===expected),'CLEAN_MAIN');return head;}
async function directory(p){p=path.resolve(p);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8n-compatible-window-[a-z0-9-]+$/.test(path.basename(p)),'DIRECTORY');await noLinks(BASE);return p;}
async function publication(file){file=path.resolve(file);must(path.basename(file)==='manifest.json'&&path.dirname(path.dirname(file)).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8n-review-resume-[a-z0-9-]+$/.test(path.basename(path.dirname(file))),'PUBLICATION_PATH');
  const text=await readText(file,3000000),v=JSON.parse(text);await verifyResume(v,v.manifestSha256,Date.now());
  return {path:file,rawSha256:hash(text),manifestSha256:v.manifestSha256,kind:'ReviewResume',sourceCommit:v.sourceCommit,jobId:J.jobId,
    preservedPlanHashes:v.oldPlans.map(p=>p.planSha256).sort()};}
async function recovery(){const raw=await readText(W.recoveryFile,3000000);must(hash(raw)===W.recoverySha,'RECOVERY_HASH');
  const r=JSON.parse(raw),parents=[{path:W.recoveryFile,rawSha256:W.recoverySha},...r.artifacts];
  for(const p of parents)must(hash(await readText(p.path,3000000))===p.rawSha256,'RECOVERY_PARENT');return {recovery:r,parents};}
async function reviewReady(m){const ref=await publication(m.publication.path);must(same(ref,m.publication),'PUBLICATION_DRIFT');
  const pub=await json(ref.path),dir=path.dirname(ref.path),next=await json(dir+'-run/proposed-plan.json'),r=await json(dir+'-inspect/result.json'),
    slot=await json(N.slot),inspectSlot=await json(N.inspectSlot),checked=await newResumePlan(next.plan,pub,pub.createdAt,Date.now());
  must(same(next,checked)&&slot.manifestSha256===ref.manifestSha256&&inspectSlot.manifestSha256===ref.manifestSha256&&
    r.planSha256===checked.planSha256&&r.actionSha256===checked.actionSha256&&r.riskSha256===checked.plan.riskSha256&&
    r.planExpiresAt===checked.plan.expiresAt,'REVIEW_EVIDENCE');return readyResume(r,m,Date.now());}
export async function main(args=process.argv.slice(2)){
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'PLATFORM');
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='Prepare'?['--mode','--output','--publication-manifest','--ci-run']:['--mode','--output','--manifest','--approved-sha'];
  must(['Prepare','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'MODE');
  const out=await directory(a['--output']);await absent(out);await absent(mode==='Inspect'?W.inspectSlot:W.slot);
  const h=await recovery(),head=await source(),pin=()=>collectPins({roots:ROOTS});let m;
  if(mode!=='Prepare'){
    const file=path.resolve(a['--manifest']);await directory(path.dirname(file));must(path.basename(file)==='manifest.json'&&
      out===path.dirname(file)+(mode==='Inspect'?'-inspect':'-run'),'MANIFEST_OUTPUT');m=validateWindow(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');
    must(head===m.sourceCommit&&same(await pin(),m.pins)&&same(h.parents,m.parents)&&same(await sourceCompatibility(head),m.compatibility),'SOURCE_PARENTS');
  }
  const c=await compatibleCloud({recovery:h.recovery,...(mode==='RunReviewed'?{manifest:m,approved:a['--approved-sha']}: {})});
  try{
    if(mode==='Prepare'){
      const ci=await readLocalCiV6(a['--ci-run'],head),pub=await publication(a['--publication-manifest']);must(pub.sourceCommit===head,'SAME_SOURCE');
      const inventory=await c.snapshot();m=makeWindowReview({sourceCommit:head,pins:await pin(),ci,publication:pub,baseline:inventory.baseline,
        parents:h.parents,nonce:randomBytes(16).toString('hex'),createdAt:Date.now(),compatibility:await sourceCompatibility(head)});
      await source(head);await absent(W.slot);await absent(W.inspectSlot);await mkdir(out);await write(out+'/inventory.json',inventory);await write(out+'/manifest.json',m);
      const r={outcome:'COMPATIBLE_WINDOW_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit:head,expiresAtUtc:new Date(m.expiresAt).toISOString(),
        latestStartAtUtc:new Date(m.latestStartAt).toISOString(),awsWrites:0,privateReads:0,sqlConnections:0,slotsConsumed:0,reviewPublicationRequired:true};
      await write(out+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
    }
    await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),assertSource=async()=>{
      await source(m.sourceCommit);must(same(await pin(),m.pins)&&same((await recovery()).parents,m.parents),'SOURCE_PINS');};
    if(mode==='RunReviewed'){
      await absent(W.inspectSlot);await readLocalCiV6(m.ci.runId,m.sourceCommit);await record('approved-manifest',m);
      const r=await runCompatibleOnce({manifest:m,approved:a['--approved-sha'],io:{...c,assertSource,record,reviewReady:()=>reviewReady(m),
        claim:()=>write(W.slot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false}),wait:()=>new Promise(r=>setTimeout(r,10000))}});
      console.log(JSON.stringify(r,null,2));if(r.outcome.includes('REQUIRES_INSPECT'))process.exitCode=1;return r;
    }
    const file=path.resolve(a['--manifest']),slot=await json(W.slot),intent=await json(path.dirname(file)+'-run/update-intent.json');
    must(slot.manifestSha256===m.manifestSha256,'RUN_BINDING');validateIntent(m,intent);
    await write(W.inspectSlot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false});
    try{const observed=await c.read();await record('observed',observed);
      const verified=verifyUpdated(observed.rawMetadata,observed.extra,intent.controlLease,m.baseline.ids,m.sourceCommit,intent.request.ClientRequestToken,intent.intentAt);
      const r={outcome:'COMPATIBLE_WINDOW_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',verified,controlLease:intent.controlLease,
        controlAcceptancePassed:false,workflowDispatched:false,retryAllowed:false};await record('result',r);console.log(JSON.stringify(r,null,2));return r;
    }catch{const r={outcome:'COMPATIBLE_WINDOW_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await record('result',r);console.log(JSON.stringify(r));process.exitCode=1;return r;}
  }finally{c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'COMPATIBLE_WINDOW_ENTRY_STOPPED_NO_RETRY',code:/^COMPATIBLE_WINDOW_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    errorType:/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'Unknown',retryAllowed:false}));process.exitCode=1;
});
