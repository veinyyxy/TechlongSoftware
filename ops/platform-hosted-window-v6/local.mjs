// F: stores reviewed data only; all executable implementation lives here.
import {readFile,mkdir,writeFile,access,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {readLocalCiV6} from '../platform-local-v6/local.mjs';
import {environment} from '../platform-image-source-v2/files.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {verifyFollowupPublication,validateFollowupPlan,J} from '../platform-review-v6/followup.mjs';
import {sourceCompatibility} from './compatibility.mjs';
import {cloud} from './cloud.mjs';
import {K,H,must,same,hash,baseline,makeReview,validate,readyReview,runOnce} from './contract.mjs';
const ROOT='E:/NodejsProject/TechlongSoftware',BASE='F:/ChatGPT_workshop';
export const FILES=['ops/platform-hosted-window-v6/contract.mjs','ops/platform-hosted-window-v6/compatibility.mjs','ops/platform-hosted-window-v6/cloud.mjs',
  'ops/platform-hosted-window-v6/local.mjs','ops/platform-hosted-deploy-v6/contract.mjs','ops/platform-hosted-deploy-v6/inspect-defaults.mjs',
  'ops/platform-review-v6/followup.mjs','ops/platform-review-v6/followup-local.mjs','lib/deployments/controller-v6/github.ts',
  'lib/deployments/controller-v6/controller.ts','ops/platform-hosting-v1/control-runtime.mjs','lib/deployments/controller-v6/configuration.ts',
  'tests/platform-hosted-window-v6.test.mjs','.github/workflows/platform-cloud-candidate.yml',K.riskFile];
const json=async f=>JSON.parse(await readFile(f,'utf8'));
async function write(f,v){assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(ROOT+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function source(expected){const s=(await git(['rev-parse','HEAD'])).trim();must((await git(['status','--porcelain'])).trim()===''&&
  (await git(['branch','--show-current'])).trim()==='main'&&(!expected||expected===s),'SOURCE');await sourceCompatibility(s);return s;}
async function directory(value){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8k-window-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(BASE)).toLowerCase()===path.resolve(BASE).toLowerCase(),'DIRECTORY');return p;}
async function publication(file){const p=path.resolve(file);must(path.basename(p)==='manifest.json'&&path.dirname(path.dirname(p)).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8j-review-plan-[a-z0-9-]+$/.test(path.basename(path.dirname(p))),'PUBLICATION_PATH');
  const text=await readFile(p,'utf8'),v=JSON.parse(text);await verifyFollowupPublication(v,v.manifestSha256,Date.now());
  return {path:p,rawSha256:hash(text),manifestSha256:v.manifestSha256,sourceCommit:v.sourceCommit,runtimeSourceCommit:v.runtimeSourceCommit,jobId:J.jobId};}
async function parents(){const p=[{path:K.inventoryFile,rawSha256:K.inventorySha256},{path:K.extraFile,rawSha256:K.extraSha256}];
  for(const r of p)must(hash(await readFile(r.path))===r.rawSha256,'PARENT');return p;}
async function reviewReady(m){const p=await publication(m.publication.path);must(same(p,m.publication),'PUBLICATION_DRIFT');
  const pub=await json(p.path),dir=path.dirname(p.path),r=await json(dir+'-inspect/result.json'),proposed=await json(dir+'-run/proposed-plan.json'),ref=await json(dir+'-run/lineage-reference.json');
  const v=await validateFollowupPlan(proposed.plan,pub,ref),slot=await json(J.slot),inspectSlot=await json(J.inspectSlot);
  must(slot.manifestSha256===p.manifestSha256&&inspectSlot.manifestSha256===p.manifestSha256&&r.planSha256===v.planSha256&&
    r.actionSha256===v.actionSha256&&r.riskSha256===v.plan.riskSha256&&r.planExpiresAt===v.plan.expiresAt,'REVIEW_EVIDENCE');return readyReview(r,m,Date.now());}
export async function main(args=process.argv.slice(2)){
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'PLATFORM');
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=['--mode','--output',...(mode==='Prepare'?['--publication-manifest','--ci-run']:['--manifest','--approved-sha'])];
  must(['Prepare','RunReviewed','Inspect'].includes(mode)&&fields.length===Object.keys(a).length&&fields.every(k=>a[k]),'MODE');
  const output=await directory(a['--output']);await absent(mode==='Inspect'?K.inspectSlot:K.slot);let m;
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit),p=await parents(),inventory=await json(K.inventoryFile),extra=await json(K.extraFile);
    m=makeReview({sourceCommit,pins:await pins(),ci,baseline:baseline(inventory.rawMetadata,extra),publication:await publication(a['--publication-manifest']),
      parents:p,nonce:randomBytes(16).toString('hex'),createdAt:Date.now(),compatibility:await sourceCompatibility(sourceCommit)});await source(sourceCommit);
    await mkdir(output);await write(output+'/manifest.json',m);const result={outcome:'HOSTED_WINDOW_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,
      operatorSourceCommit:sourceCommit,imageSourceCommit:H.imageSource,expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
      awsWrites:0,awsCalls:0,privateReads:0,sqlConnections:0,slotsConsumed:0};await write(output+'/result.json',result);console.log(JSON.stringify(result,null,2));return result;
  }
  const file=path.resolve(a['--manifest']);await directory(path.dirname(file));must(path.basename(file)==='manifest.json','MANIFEST_PATH');m=validate(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins)&&same(await sourceCompatibility(m.sourceCommit),m.compatibility),'PINS');};
  await assertSource();must(same(await parents(),m.parents),'PARENTS');await mkdir(output);
  const c=await cloud(m),record=(n,v)=>write(output+'/'+n+'.json',v);
  try{
    if(mode==='RunReviewed'){
      await readLocalCiV6(m.ci.runId,m.sourceCommit);await write(output+'/approved-manifest.json',m);
      const result=await runOnce({manifest:m,approved:a['--approved-sha'],io:{...c,assertSource,reviewReady:()=>reviewReady(m),record,
        claim:()=>write(K.slot,{manifestSha256:m.manifestSha256,nonce:m.nonce,consumedAt:Date.now(),retryAllowed:false}),wait:()=>new Promise(r=>setTimeout(r,10000))}});
      console.log(JSON.stringify(result,null,2));if(result.outcome.includes('REQUIRES_INSPECT'))process.exitCode=1;return result;
    }
    const slot=await json(K.slot),intent=await json(path.dirname(file)+'-run/update-intent.json');
    must(slot.manifestSha256===m.manifestSha256&&intent.manifestSha256===m.manifestSha256,'RUN_BINDING');
    await write(K.inspectSlot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false});
    try{const observed=await c.observe(intent.controlLease,m.baseline.ids);await record('observed',observed);
      const result={outcome:'HOSTED_WINDOW_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',stackId:K.stackId,controlLease:intent.controlLease,observed,
        controlAcceptancePassed:false,workflowDispatched:false,retryAllowed:false};await record('result',result);console.log(JSON.stringify({outcome:result.outcome,stackId:K.stackId,controlLease:intent.controlLease}));return result;
    }catch{const result={outcome:'HOSTED_WINDOW_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await record('result',result);console.log(JSON.stringify(result));process.exitCode=1;return result;}
  }finally{c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'HOSTED_WINDOW_ENTRY_STOPPED_NO_RETRY',code:/^HOSTED_WINDOW_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',retryAllowed:false}));process.exitCode=1;
});
