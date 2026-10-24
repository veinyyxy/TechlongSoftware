// All executable code stays in the repository; F: contains immutable data only.
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {environment,git,readText,writeOnce,noLinks,absent,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {readLocalCiV6} from '../platform-local-v6/local.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {baseline,validate as validateOld,updateInput as oldInput} from './contract.mjs';
import {sourceCompatibility} from './compatibility.mjs';
import {recoveryCloud} from './recovery-cloud.mjs';
import {M,K,must,same,hash,canonical,observe,makeReview,validate,recoverOnce} from './recovery.mjs';
const ROOT='E:/NodejsProject/TechlongSoftware',BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-hosted-window-v6/recovery.mjs','ops/platform-hosted-window-v6/recovery-cloud.mjs',
  'ops/platform-hosted-window-v6/recovery-local.mjs','tests/platform-hosted-recovery-v6.test.mjs',M.riskFile,
  '.github/workflows/platform-cloud-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,3000000));
async function write(f,v){assertEvidenceSafeV5(v);await writeOnce(f,v);}
async function source(expected){const head=git(['rev-parse','HEAD']).trim();
  must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!expected||head===expected),'CLEAN_MAIN');
  return head;}
async function directory(input){const p=path.resolve(input);
  must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&/^techlong-w8m-stack-recovery-[a-z0-9-]+$/.test(path.basename(p)),'DIRECTORY');
  await noLinks(BASE);return p;}
export async function history(){
  must(hash(await readText(M.closureFile,3000000))===M.closureSha,'CLOSURE_HASH');const c=await json(M.closureFile);
  must(c.manifestSha256===M.failureSha&&c.stackId===K.stackId&&c.stackStatus==='UPDATE_FAILED'&&c.updateStackAcknowledgedOnce===true&&
    c.allBaselineResourceIdentitiesUnchanged===true&&c.newLeaseInstalled===false&&c.executionSlotConsumed&&c.inspectSlotConsumed,'FAILURE_CLOSURE');
  const parents=[{path:M.closureFile,rawSha256:M.closureSha},...c.artifacts,
    {path:K.inventoryFile,rawSha256:K.inventorySha256},{path:K.extraFile,rawSha256:K.extraSha256}];
  for(const p of parents)must(hash(await readText(p.path,3000000))===p.rawSha256,'PARENT_HASH');
  const old=validateOld(await json(BASE+'/techlong-w8k-window-20261024-c/manifest.json'),M.failureSha,Date.now(),true),
    original=(await json(K.inventoryFile)).rawMetadata,intent=await json(BASE+'/techlong-w8k-window-20261024-c-run/update-intent.json'),
    ack=await json(BASE+'/techlong-w8k-window-20261024-c-run/update-ack.json');
  must(same(baseline(original,await json(K.extraFile)),old.baseline)&&intent.manifestSha256===M.failureSha&&
    same(intent.request,oldInput(old,intent.intentAt))&&ack.requestSha256===hash(canonical(intent.request))&&ack.sdkAttempts===1,'KNOWN_FAILED_REQUEST');
  return {parents,context:{baseline:old.baseline,original,failedTemplate:JSON.parse(intent.request.TemplateBody),
    failedLease:intent.controlLease,failedToken:intent.request.ClientRequestToken}};
}
export async function main(args=process.argv.slice(2)){
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'PLATFORM');
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='Prepare'?['--mode','--output','--ci-run']:['--mode','--output','--manifest','--approved-sha'];
  must(['Prepare','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'MODE');
  const out=await directory(a['--output']);await absent(out);await absent(mode==='Inspect'?M.inspectSlot:M.slot);
  const h=await history(),pin=()=>collectPins({roots:ROOTS}),head=await source();let m;
  if(mode!=='Prepare'){
    const file=path.resolve(a['--manifest']);await directory(path.dirname(file));must(path.basename(file)==='manifest.json','MANIFEST_PATH');
    must(out===path.dirname(file)+(mode==='Inspect'?'-inspect':'-run'),'RUN_OUTPUT_BINDING');
    if(mode==='RunReviewed')await absent(M.inspectSlot);
    m=validate(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');
    must(head===m.sourceCommit&&same(await pin(),m.pins)&&same((await history()).parents,m.parents)&&
      same(await sourceCompatibility(head),m.compatibility),'SOURCE_PARENTS');
  }
  const c=await recoveryCloud(mode==='RunReviewed'?{manifest:m,approved:a['--approved-sha']}:{});
  try{
    if(mode==='Prepare'){
      const ci=await readLocalCiV6(a['--ci-run'],head),snapshot=await c.snapshot(true),before=observe(snapshot,h.context,{checkPermission:true});
      m=makeReview({sourceCommit:head,pins:await pin(),ci,parents:h.parents,before,nonce:randomBytes(16).toString('hex'),createdAt:Date.now(),
        compatibility:await sourceCompatibility(head)});await source(head);await absent(M.slot);await absent(M.inspectSlot);
      await mkdir(out);await write(out+'/inventory.json',snapshot);await write(out+'/manifest.json',m);
      const r={outcome:'HOSTED_RECOVERY_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit:head,
        expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
        awsWrites:0,privateReads:0,sqlConnections:0,slotsConsumed:0,updateStackAuthorized:false,workflowDispatched:false};
      await write(out+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
    }
    await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v);
    const assertSource=async()=>{await source(m.sourceCommit);must(same(await pin(),m.pins)&&same((await history()).parents,m.parents),'SOURCE_PINS');};
    if(mode==='RunReviewed'){
      await readLocalCiV6(m.ci.runId,m.sourceCommit);await record('approved-manifest',m);
      const r=await recoverOnce({manifest:m,approved:a['--approved-sha'],history:h.context,io:{...c,assertSource,record,
        claim:()=>write(M.slot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false}),
        wait:()=>new Promise(r=>setTimeout(r,10000))}});console.log(JSON.stringify(r,null,2));if(r.outcome.includes('REQUIRES_INSPECT'))process.exitCode=1;return r;
    }
    const file=path.resolve(a['--manifest']),slot=await json(M.slot),intent=await json(path.dirname(file)+'-run/rollback-intent.json');
    must(slot.manifestSha256===m.manifestSha256&&intent.manifestSha256===m.manifestSha256&&same(intent.request,m.request),'RUN_BINDING');
    await write(M.inspectSlot,{manifestSha256:m.manifestSha256,consumedAt:Date.now(),retryAllowed:false});
    try{const v=await c.snapshot(false);await record('observed',v);
      const verified=observe(v,h.context,{recovered:true,token:m.request.ClientRequestToken,intentAt:intent.intentAt});
      const r={outcome:'HOSTED_RECOVERY_INDEPENDENTLY_VERIFIED_NO_NEW_WINDOW',verified,newLease:false,workflowDispatched:false,retryAllowed:false};
      await record('result',r);console.log(JSON.stringify(r,null,2));return r;
    }catch{const r={outcome:'HOSTED_RECOVERY_INSPECT_UNCONFIRMED_NO_RETRY',newLease:false,workflowDispatched:false,retryAllowed:false};
      await record('result',r);console.log(JSON.stringify(r));process.exitCode=1;return r;}
  }finally{c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'HOSTED_RECOVERY_ENTRY_STOPPED_NO_RETRY',code:/^HOSTED_RECOVERY_[A-Z_]+$/.test(e?.message??'')?
    e.message:'DETAILS_WITHHELD',errorType:/^[A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'Unknown',retryAllowed:false}));process.exitCode=1;
});
