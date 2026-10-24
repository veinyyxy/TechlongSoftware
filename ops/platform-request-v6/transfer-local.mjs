// Explicit Windows production entry. Importing it does not read private files or connect.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environment,git,pins as collectPins,noLinks,readText,writeOnce,absent,ROOT} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {openTransferDatabase} from './transfer-live.mjs';
import {ENTRY,must,prepareOperator,verifyOperatorReview,runOperatorMode} from './transfer-entry.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
const BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-request-v6/transfer-local.mjs','ops/platform-request-v6/transfer-state.mjs','ops/platform-request-v6/transfer-live.mjs',
  'ops/platform-local-v6/metadata.ps1',
  'ops/platform-request-v6/transfer-entry.mjs','ops/platform-request-v6/transfer.mjs','ops/platform-request-v6/verify-transfer-pg.mjs',I.sql,
  'ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql','tests/platform-task-transfer-v6.test.mjs','tests/platform-task-transfer-entry-v6.test.mjs',
  'tests/fixtures/platform-task-transfer-v6.mjs','.github/workflows/platform-cloud-candidate.yml',ENTRY.riskFile,'package.json','package-lock.json'];
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function parseTransferArgs(args){
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n])&&typeof args[n+1]==='string','ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='Prepare'?['--mode','--output','--ci-run','--allow-config-read']:['--mode','--output','--manifest','--approved-sha'];
  must(['Prepare','RunReviewed','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'ARGS');
  must(mode!=='Prepare'||a['--allow-config-read']==='yes','PRIVATE_READ_NOT_ACKNOWLEDGED');return {mode,a};
}
async function directory(file){const p=path.resolve(file);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  /^techlong-w8r-task-transfer-[a-z0-9-]+$/.test(path.basename(p)),'OUTPUT_PATH');await noLinks(BASE);return p;}
async function json(file){return JSON.parse(await readText(file,2000000));}
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function main(args=process.argv.slice(2)){
  const {mode,a}=parseTransferArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  const out=await directory(a['--output']);await absent(out);await absent(mode==='Inspect'?ENTRY.inspectSlot:ENTRY.slot);
  const sourcePins=()=>collectPins({roots:ROOTS}),source=async m=>{
    const head=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!m||head===m.sourceCommit),'CLEAN_FROZEN_SOURCE');
    await sourceCompatibility(head);if(m)must(same(await sourcePins(),m.pins),'SOURCE_PINS');return head;};
  let m,root;
  if(mode!=='Prepare'){
    const file=path.resolve(a['--manifest']);must(path.basename(file)==='manifest.json','MANIFEST_PATH');root=await directory(path.dirname(file));
    must(out===root+(mode==='Inspect'?'-inspect':'-run'),'OUTPUT_BINDING');m=await json(file);
    await verifyOperatorReview(m,a['--approved-sha'],Date.now(),mode==='Inspect');await source(m);
  }else await absent(ENTRY.inspectSlot);
  const contract=sqlContract((await readText(path.resolve(ROOT,I.sql),2000000)).replaceAll('\r\n','\n'));
  await mkdir(out,{mode:0o700});const record=async(n,v)=>{must(['manifest','approved-manifest','result','stopped','preflight','transfer-intent','independent-state'].includes(n),'RECORD_NAME');
    assertEvidenceSafeV5(v);await writeOnce(path.join(out,n+'.json'),v);};
  const io={assertSource:source,sourcePins,verifyCi:readLocalCiV6,authMetadata:authMetadataV6,record,
    open:auth=>openTransferDatabase({auth,contract,record}),
    claimWrite:v=>writeOnce(ENTRY.slot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
    claimInspect:v=>writeOnce(ENTRY.inspectSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
    writerReceipt:async()=>{
      const claim=await json(ENTRY.slot);must(claim.output===root+'-run','WRITER_OUTPUT');
      must(same(await json(path.join(claim.output,'approved-manifest.json')),m),'WRITER_MANIFEST');
      return {claim,intent:await optional(path.join(claim.output,'transfer-intent.json'))};}};
  let result;
  if(mode==='Prepare')result=await prepareOperator({ciRun:a['--ci-run'],io});
  else{await record('approved-manifest',m);result=await runOperatorMode({mode,manifest:m,approved:a['--approved-sha'],io});}
  console.log(JSON.stringify({...result,output:out}));
  if(!['TASK_TRANSFER_PREPARED_NOT_APPROVED','TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK',
    'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY','TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED'].includes(result.outcome))process.exitCode=1;
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'TASK_TRANSFER_ENTRY_STOPPED_NO_RETRY',code:/^(?:TRANSFER_ENTRY|TRANSFER_STATE|TASK_TRANSFER)_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    sqlState:/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:null,retryAllowed:false,executionApproved:false}));process.exitCode=1;
});
