// Fixed W8y entry. PrepareSaved reads sealed public audit files + CI + file ACL
// metadata only. No private content/production connection before Run/Inspect.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environment,git,pins as collectPins,noLinks,readText,writeOnce,absent,ROOT} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {normalizedState} from './transfer.mjs';
import {ROOTS as LEGACY_ROOTS} from './transfer-local.mjs';
import {openTransferDatabase} from './transfer-live.mjs';
import {must,makeOperatorReview,verifyOperatorReview,runOperatorMode} from './transfer-entry.mjs';
import {NEXT,NEXT_ENTRY as E,NEXT_FACTS as F,NEXT_PROFILE as PROFILE} from './transfer-next.mjs';
const BASE='F:/ChatGPT_workshop',freshRoot=BASE+'/techlong-w8x-readonly-source-refreshed-20261025-a';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),rawHash=s=>createHash('sha256').update(s).digest('hex');
export const NEXT_ROOTS=[...new Set([...LEGACY_ROOTS,'ops/platform-request-v6/transfer-next-local.mjs','ops/platform-request-v6/transfer-next.mjs',
  'tests/platform-task-transfer-next-v6.test.mjs','tests/fixtures/platform-task-transfer-next-v6.mjs',E.riskFile])];
export function parseNextArgs(args){
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n])&&typeof args[n+1]==='string','ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='PrepareSaved'?['--mode','--output','--ci-run']:['--mode','--output','--manifest','--approved-sha'];
  must(['PrepareSaved','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'ARGS');return {mode,a};
}
export async function readNextSavedBaseline(read=readText){
  const raw=await read(F.closureFile,3000000);must(rawHash(raw)===F.closureRawSha256,'PARENT_HASH');const c=JSON.parse(raw);
  must(c.schema==='techlong/recovery-fresh-readonly-completed/v6'&&c.artifacts.length===9&&new Set(c.artifacts.map(a=>a.file)).size===9&&
    c.result.outcome==='RECOVERY_FRESH_READONLY_STATE_VERIFIED_NO_MUTATION'&&c.result.newTaskCreated===false&&c.result.recoveryMutationAuthorized===false,'PARENT');
  const values=new Map();for(const a of c.artifacts){must(a.file.startsWith(BASE+'/techlong-w8x-')&&a.file.endsWith('.json'),'PARENT_PATH');
    const text=await read(a.file,3000000);must(rawHash(text)===a.rawSha256,'PARENT_ARTIFACT');values.set(a.file,JSON.parse(text));}
  const d=values.get(freshRoot+'/database-snapshot.json')?.snapshot;must(d?.checkedAt===F.databaseCheckedAt,'DATABASE_SAMPLE');
  const baseline=normalizedState({...d.state,ledger:Object.fromEntries(['plans','approvals','attempts'].map(k=>[k,[...d.state.ledger[k],...d.newLedger[k]]]))});
  await PROFILE.assertState(baseline,F.databaseCheckedAt);return baseline;
}
async function directory(file){const p=path.resolve(file);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8y-held-handoff-[a-z0-9-]+$/.test(path.basename(p)),'OUTPUT_PATH');await noLinks(BASE);return p;}
async function json(file){return JSON.parse(await readText(file,3000000));}
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function main(args=process.argv.slice(2)){
  const {mode,a}=parseNextArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  const out=await directory(a['--output']);await absent(out);await absent(mode==='Inspect'?E.inspectSlot:E.slot);
  const sourcePins=()=>collectPins({roots:NEXT_ROOTS}),source=async m=>{
    const head=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!m||head===m.sourceCommit),'CLEAN_FROZEN_SOURCE');
    await sourceCompatibility(head);if(m)must(same(await sourcePins(),m.pins),'SOURCE_PINS');return head;};
  let m,root,result;
  if(mode!=='PrepareSaved'){
    const file=path.resolve(a['--manifest']);must(path.basename(file)==='manifest.json','MANIFEST_PATH');root=await directory(path.dirname(file));
    must(out===root+(mode==='Inspect'?'-inspect':'-run'),'OUTPUT_BINDING');m=await json(file);
    await verifyOperatorReview(m,a['--approved-sha'],Date.now(),mode==='Inspect',PROFILE);await source(m);
  }else await absent(E.inspectSlot);
  await mkdir(out,{mode:0o700});const record=async(n,v)=>{
    must(['manifest','approved-manifest','result','stopped','preflight','transfer-intent','independent-state','counts'].includes(n),'RECORD_NAME');
    assertEvidenceSafeV5(v);await writeOnce(path.join(out,n+'.json'),v);};
  if(mode==='PrepareSaved'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit),baseline=await readNextSavedBaseline();
    m=await makeOperatorReview({sourceCommit,ci,baseline,pins:await sourcePins(),auth:await authMetadataV6(),createdAt:Date.now()},PROFILE);
    await source(m);await record('manifest',m);
    result={outcome:'TASK_TRANSFER_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit,oldJobId:NEXT.oldJobId,newJobId:NEXT.newJobId,
      factsAtUtc:new Date(F.factsAt).toISOString(),expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
      configContentReads:0,connections:0,sqlMutationSubmissions:0,awsCalls:0,slotsConsumed:0,executionApproved:false};await record('result',result);
  }else{
    const contract=sqlContract((await readText(path.resolve(ROOT,I.sql),2000000)).replaceAll('\r\n','\n'));
    const io={assertSource:source,verifyCi:readLocalCiV6,authMetadata:authMetadataV6,record,
      open:async auth=>{const db=await openTransferDatabase({auth,contract,record,profile:PROFILE});let closed=false;
        return {...db,close:async()=>{must(!closed,'CLOSE_ONCE');closed=true;try{await db.close();}finally{await record('counts',db.counts());}}};},
      claimWrite:v=>writeOnce(E.slot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
      claimInspect:v=>writeOnce(E.inspectSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
      writerReceipt:async()=>{const claim=await json(E.slot);must(claim.output===root+'-run','WRITER_OUTPUT');
        must(same(await json(path.join(claim.output,'approved-manifest.json')),m),'WRITER_MANIFEST');
        return {claim,intent:await optional(path.join(claim.output,'transfer-intent.json'))};}};
    await record('approved-manifest',m);result=await runOperatorMode({mode,manifest:m,approved:a['--approved-sha'],io,profile:PROFILE});
  }
  console.log(JSON.stringify({...result,output:out}));
  if(!['TASK_TRANSFER_PREPARED_NOT_APPROVED','TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK',
    'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY','TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED'].includes(result.outcome))process.exitCode=1;
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'TASK_TRANSFER_ENTRY_STOPPED_NO_RETRY',
    code:/^(?:TRANSFER_ENTRY|TRANSFER_STATE|TASK_TRANSFER)_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    sqlState:/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:null,retryAllowed:false,executionApproved:false}));process.exitCode=1;
});
