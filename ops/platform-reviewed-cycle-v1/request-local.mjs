// Shared SOURCE-bound two-row transaction entry. Prepare uses saved facts only.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,absent,noLinks} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {openTransferDatabase} from '../platform-request-v6/transfer-live.mjs';
import {makeOperatorReview,verifyOperatorReview,runOperatorMode} from '../platform-request-v6/transfer-entry.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {REQUEST_SOURCE as R,REQUEST_ENTRY as E,REQUEST_PROFILE as P,REQUEST_RISK,assertRequestOrigin,savedRequestBaseline,requestStateReader} from './request-source.mjs';
const must=(v,c)=>{if(!v)throw Error('REQUEST_ENTRY_'+c);},same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const ROOTS=['ops/platform-reviewed-cycle-v1/request-local.mjs','ops/platform-local-v6/metadata.ps1',REQUEST_RISK,
  'tests/platform-reviewed-cycle-handoff-v1.test.mjs','.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
export function parseArgs(args){
  if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields=a['--mode']==='PrepareSaved'?['--mode','--ci-run','--output']:['--mode','--manifest','--approved-sha'];
  must(['PrepareSaved','RunReviewed','Inspect'].includes(a['--mode'])&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  const root=v=>/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-handoff-[a-z0-9-]+$/.test(v??'');
  if(a['--output'])must(root(a['--output']),'OUTPUT');
  if(a['--manifest'])must(root(path.dirname(a['--manifest']).replaceAll('\\','/'))&&path.basename(a['--manifest'])==='manifest.json'&&/^[a-f0-9]{64}$/.test(a['--approved-sha']),'MANIFEST');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'REQUEST_HANDOFF_SOURCE_PREPARED_NOT_AUTHORIZED',oldJobId:R.target.oldJobId,newJobId:R.target.newJobId,
    productionReads:0,configContentReads:0,sqlConnections:0,awsCalls:0,dispatches:0,executionApproved:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');await noLinks('F:/ChatGPT_workshop');
  const collect=()=>pins({roots:ROOTS}),source=async m=>{const head=git(['rev-parse','HEAD']).trim();
    must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!m||head===m.sourceCommit),'CLEAN_SOURCE');
    await assertRequestOrigin(head);if(m)must(same(await collect(),m.pins),'PINS');return head;};
  const json=async f=>JSON.parse(await readText(f,4000000)),optional=async f=>{try{return await json(f);}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
  if(a['--mode']==='PrepareSaved'){
    const out=a['--output'];await absent(out);await absent(E.slot);await absent(E.inspectSlot);const head=await source(),baseline=await savedRequestBaseline();
    const m=await makeOperatorReview({baseline,sourceCommit:head,pins:await collect(),ci:await readCi(a['--ci-run'],head),auth:await authMetadataV6(),createdAt:Date.now()},P);
    await source(m);await mkdir(out);await write(out+'/manifest.json',m);const result={outcome:'REQUEST_HANDOFF_PREPARED_NOT_APPROVED',sourceCommit:head,
      manifestSha256:m.manifestSha256,origin:await assertRequestOrigin(head),oldJobId:R.target.oldJobId,newJobId:R.target.newJobId,
      latestStartAt:m.latestStartAt,expiresAt:m.expiresAt,configurationContentReads:0,connections:0,awsCalls:0,slotsConsumed:0,executionApproved:false};
    await write(out+'/result.json',result);console.log(JSON.stringify(result));return result;
  }
  const m=await json(a['--manifest']),approved=a['--approved-sha'],root=path.dirname(a['--manifest']).replaceAll('\\','/');
  await verifyOperatorReview(m,approved,Date.now(),a['--mode']==='Inspect',P);await source(m);
  must(same(await savedRequestBaseline(a['--mode']==='Inspect'?R.facts.checkedAt:Date.now()),m.core.baseline),'ARCHIVE_BASELINE');
  const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
  const execute=async mode=>{
    const out=root+(mode==='Inspect'?'-inspect':'-run');await absent(out);await absent(mode==='Inspect'?E.inspectSlot:E.slot);await mkdir(out);
    const record=(n,v)=>write(out+'/'+n+'.json',v),io={assertSource:source,verifyCi:async(id,head)=>must(same(await readCi(id,head),m.ci),'CI_DRIFT'),
      authMetadata:authMetadataV6,record,claimWrite:v=>write(E.slot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
      claimInspect:v=>write(E.inspectSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
      writerReceipt:async()=>{const claim=await json(E.slot);must(claim.output===root+'-run'&&same(await json(claim.output+'/approved-manifest.json'),m),'WRITER_RECEIPT');
        return {claim,intent:await optional(claim.output+'/transfer-intent.json')};},
      open:async auth=>{const clocks=[],db=await openTransferDatabase({auth,contract,record,profile:P,snapshotReader:requestStateReader(m.core.baseline,{clocks}),allowTaskUpdate:mode!=='Inspect'});let closed=false;
        return {...db,close:async()=>{must(!closed,'CLOSE_ONCE');closed=true;try{await db.close();}finally{await record('counts',{...db.counts(),databaseClockSamples:clocks});}}};}};
    await record('approved-manifest',m);return {result:await runOperatorMode({mode,manifest:m,approved,io,profile:P}),output:out};
  };
  const writer=await execute(a['--mode']);let inspector=null;
  if(a['--mode']==='RunReviewed'){const claim=await optional(E.slot);if(claim?.manifestSha256===approved&&claim.output===root+'-run')inspector=await execute('Inspect');}
  const r={outcome:inspector?.result.outcome??writer.result.outcome,writer,inspector,cloudExecutionApproved:false};console.log(JSON.stringify(r));
  if(!['TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY','TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED'].includes(r.outcome))process.exitCode=1;return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('REQUEST_HANDOFF_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;});
