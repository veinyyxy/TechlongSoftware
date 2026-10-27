// Explicit exact-profile entry. Preparing uses saved records, never production.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ROOT,environment,git,readText,noLinks,writeOnce,absent,pins} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {openTransferDatabase} from '../platform-request-v6/transfer-live.mjs';
import {readRecoveryRequestState} from '../platform-recovery-v1/request-state.mjs';
import {makeOperatorReview,verifyOperatorReview,runOperatorMode} from '../platform-request-v6/transfer-entry.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {TARGET} from './coordinates.mjs';
import {ENTRY as E,PROFILE as P,must,same} from './profile.mjs';
const BASE='F:/ChatGPT_workshop';
export const ROOTS=['ops/platform-a604-handoff-v1/local.mjs','ops/platform-a604-handoff-v1/binding-candidate.mjs',
  'tests/platform-a604-handoff-v1.test.mjs',E.riskFile,'.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,4000000));
// The frozen reader covers prior generations plus9db/9b. Read the new
// candidate's ledger too: a later racing publish must not escape Inspect.
export async function readCandidateSnapshot(c,options,clocks,readOriginal=readRecoveryRequestState){
  clocks.push(Number((await c.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0].at));
  const state=await readOriginal(c,options),rows=(await c.query(`SELECT
    EXISTS(SELECT FROM public.deployment_jobs WHERE (id=$1 OR dedupe_key=$3) AND deployment_id<>$2) AS foreign_candidate,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p WHERE job_id=$1) AS plans,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.plan_sha),'[]') FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1) AS approvals,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a WHERE job_id=$1) AS attempts`,
  [TARGET.newJobId,state.deployment.id,'express-initialized-v2:'+TARGET.requestId])).rows;
  must(rows.length===1&&rows[0].foreign_candidate===false,'FOREIGN_CANDIDATE');
  for(const k of ['plans','approvals','attempts'])must(Array.isArray(rows[0][k])&&rows[0][k].length<=8,'CANDIDATE_LEDGER');
  state.ledger=Object.fromEntries(['plans','approvals','attempts'].map(k=>[k,[...state.ledger[k],...rows[0][k]]]));
  return normalizedState(state);
}
export async function readSavedBaseline(read=readText,profile=P){
  const f=profile.facts,raw=await read(f.sealFile,4000000);must(await sha256Hex(raw)===f.sealRawSha256,'READ_SEAL_SHA');const seal=JSON.parse(raw);
  must(seal.outcome==='FRESH_BASELINE_AND_FIXED_HANDOFF_PROPOSAL_VERIFIED_NOT_EXECUTABLE'&&seal.sourceCommit===f.sourceCommit&&
    seal.baselineSha256===f.baselineSha256&&seal.checkedAt===f.checkedAt&&seal.candidateJobId===TARGET.newJobId&&seal.candidateExists===false&&
    seal.actualCounts.configurationContentReads===1&&seal.actualCounts.verifiedTlsReadonlyConnections===1&&seal.actualCounts.databaseWrites===0&&seal.rawInventory?.length===10,'READ_SEAL');
  let snapshot;for(const a of seal.rawInventory){must(/^[a-z0-9-]+\.json$/.test(a.file),'ARCHIVE_NAME');const raw=await read(f.evidenceRoot+'/'+a.file,4000000);
    must(await sha256Hex(raw)===a.rawSha256,'RAW_ARCHIVE_SHA');if(a.file==='snapshot.json')snapshot=JSON.parse(raw);}
  must(snapshot?.checkedAt===f.checkedAt&&snapshot.observedAt===f.observedAt&&snapshot.databaseCheckedAt===f.databaseCheckedAt&&snapshot.sourceCommit===f.sourceCommit,'SNAPSHOT_PROVENANCE');
  return profile.assertState(normalizedState(snapshot.state),f.checkedAt);
}
export function parseArgs(args){if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let k=0;k<args.length;k+=2){must(!Object.hasOwn(a,args[k])&&args[k+1]&&!args[k+1].startsWith('--'),'ARGS');a[args[k]]=args[k+1];}
  const fields=a['--mode']==='PrepareSaved'?['--mode','--ci-run','--output']:['--mode','--manifest','--approved-sha'];
  must(['PrepareSaved','RunReviewed','Inspect'].includes(a['--mode'])&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  if(a['--mode']==='PrepareSaved')must(/^F:\/ChatGPT_workshop\/techlong-a604-handoff-[a-z0-9-]+$/.test(a['--output']),'OUTPUT');
  else must(/^F:\/ChatGPT_workshop\/techlong-a604-handoff-[a-z0-9-]+\/manifest\.json$/.test(a['--manifest'])&&/^[a-f0-9]{64}$/.test(a['--approved-sha']),'MANIFEST');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:'A604_HANDOFF_ENTRY_AVAILABLE_NOT_AUTHORIZED',oldJobId:TARGET.oldJobId,newJobId:TARGET.newJobId,
    runtimeCompatible:false,privateReads:0,sqlConnections:0,awsCalls:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');await noLinks(BASE);
  const collect=()=>pins({roots:ROOTS}),source=async m=>{const h=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
    git(['status','--porcelain']).trim()===''&&(!m||h===m.sourceCommit),'SOURCE');await compatibility(h);if(m)must(same(await collect(),m.pins),'PINS');return h;};
  const write=async(file,v)=>{assertEvidenceSafeV5(v);await writeOnce(file,v);};
  if(a['--mode']==='PrepareSaved'){
    const out=a['--output'];await absent(out);await absent(E.slot);await absent(E.inspectSlot);const sourceCommit=await source(),baseline=await readSavedBaseline();
    const m=await makeOperatorReview({baseline,sourceCommit,pins:await collect(),ci:await readCi(a['--ci-run'],sourceCommit),auth:await authMetadataV6(),createdAt:Date.now()},P);
    await source(m);await mkdir(out);await write(out+'/manifest.json',m);const r={outcome:'A604_HANDOFF_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,
      oldJobId:TARGET.oldJobId,newJobId:TARGET.newJobId,latestStartAt:m.latestStartAt,expiresAt:m.expiresAt,configContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,executionApproved:false};
    await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const root=path.dirname(a['--manifest']).replaceAll('\\','/'),m=await json(a['--manifest']),approved=a['--approved-sha'];
  await verifyOperatorReview(m,approved,Date.now(),a['--mode']==='Inspect',P);await source(m);must(same(await readSavedBaseline(),m.core.baseline),'ARCHIVE_BASELINE');
  const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
  const optional=async file=>{try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  async function execute(mode){
    const out=root+(mode==='Inspect'?'-inspect':'-run');await absent(out);await absent(mode==='Inspect'?E.inspectSlot:E.slot);await mkdir(out);
    const record=(name,v)=>write(out+'/'+name+'.json',v);
    const io={assertSource:source,verifyCi:async(id,head)=>must(same(await readCi(id,head),m.ci),'CI_DRIFT'),authMetadata:authMetadataV6,record,
      claimWrite:v=>write(E.slot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),claimInspect:v=>write(E.inspectSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false}),
      writerReceipt:async()=>{const claim=await json(E.slot);must(claim.output===root+'-run'&&same(await json(claim.output+'/approved-manifest.json'),m),'WRITER_RECEIPT');
        return {claim,intent:await optional(claim.output+'/transfer-intent.json')};},
      open:async auth=>{const clocks=[];const db=await openTransferDatabase({auth,contract,record,profile:P,allowTaskUpdate:mode!=='Inspect',
        snapshotReader:(c,options)=>readCandidateSnapshot(c,options,clocks)});
        let closed=false;return {...db,close:async()=>{must(!closed,'CLOSE_ONCE');closed=true;try{await db.close();}finally{await record('counts',{...db.counts(),databaseClockSamples:clocks});}}};}};
    await record('approved-manifest',m);const result=await runOperatorMode({mode,manifest:m,approved,io,profile:P});return {result,output:out};
  }
  const writer=await execute(a['--mode']);let inspector=null;
  // The same approval includes an independent connection/read. Never repeat a
  // writer; only inspect after our own exact permanent claim exists.
  if(a['--mode']==='RunReviewed'){const claim=await optional(E.slot);if(claim&&claim.manifestSha256===approved&&claim.output===root+'-run')inspector=await execute('Inspect');}
  const r={outcome:inspector?.result.outcome??writer.result.outcome,writer,inspector,cloudExecutionApproved:false};console.log(JSON.stringify(r));
  if(!['TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY','TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED'].includes(r.outcome))process.exitCode=1;return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('A604_HANDOFF_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;
});
