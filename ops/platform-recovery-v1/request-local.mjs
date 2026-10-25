// Explicit local request entry. PrepareSaved is metadata/local-archive only.
// No mode runs on import; RunReviewed/Inspect both require an exact fresh SHA.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {git,ROOT,environment,readText,noLinks,absent,writeOnce,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {openTransferDatabase} from '../platform-request-v6/transfer-live.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {loadSavedInputs} from './saved.mjs';
import {prepareRecoveryBasis,must,same} from './basis.mjs';
import {createRecoveryRequestTransaction} from './request.mjs';
import {readRecoveryRequestState} from './request-state.mjs';
import {makeRequestOperatorReview,verifyRequestOperatorReview,runRequestOperator,REQUEST_RISK} from './request-entry.mjs';
import {prepareRecoveryPublication} from './publication.mjs';
export const REQUEST_ROOTS=['ops/platform-recovery-v1/request-local.mjs','ops/platform-recovery-v1/bridge.mjs',
  'ops/platform-local-v6/metadata.ps1','scripts/controller-auth-metadata-v6.ps1',I.sql,
  'package.json','package-lock.json','.github/workflows/platform-cloud-candidate.yml',
  'tests/platform-recovery-entry-bridge-v1.test.mjs','tests/fixtures/platform-recovery-v1.mjs',REQUEST_RISK];
const json=async p=>JSON.parse(await readText(p,3000000));
export function parseRequestArgs(args){
  const f={};must(args.length%2===0,'REQUEST_ARGUMENTS');
  for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(f,args[n])&&typeof args[n+1]==='string'&&!args[n+1].startsWith('--'),'REQUEST_ARGUMENTS');f[args[n]]=args[n+1];}
  const names=f['--mode']==='PrepareSaved'?['--ci-run','--mode','--output']:['--approved-sha','--manifest','--mode','--output'];
  must(same(Object.keys(f).sort(),names)&&['PrepareSaved','RunReviewed','Inspect'].includes(f['--mode']),'REQUEST_ARGUMENTS');
  if(f['--mode']==='PrepareSaved')must(/^[1-9][0-9]{0,15}$/.test(f['--ci-run']),'REQUEST_CI_ID');
  else must(/^F:\/ChatGPT_workshop\/techlong-w9f-request-[a-z0-9-]+\/manifest\.json$/.test(path.resolve(f['--manifest']).replaceAll('\\','/'))&&
    /^[a-f0-9]{64}$/.test(f['--approved-sha']),'REQUEST_MANIFEST_PATH_OR_SHA');
  must(/^F:\/ChatGPT_workshop\/techlong-w9f-request-[a-z0-9-]+$/.test(path.resolve(f['--output']).replaceAll('\\','/')),'REQUEST_OUTPUT');return f;
}
const clean=expected=>{const s=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!expected||s===expected),'REQUEST_CLEAN_SOURCE');return s;};
async function makePorts(m,basis,out){
  const contract=sqlContract((await readText(path.resolve(ROOT,I.sql),3000000)).replaceAll('\r\n','\n'));
  const record=(n,v)=>writeOnce(out+'/'+n+'.json',v);
  const guard=async()=>{clean(m.sourceCommit);must(same(await collectPins({roots:REQUEST_ROOTS}),m.pins),'REQUEST_SOURCE_PINS');};
  return {record,assertSource:guard,verifyCi:readLocalCiV6,authMetadata:authMetadataV6,
    async open(auth,{inspect,assertApproved,claimPermanent}){
      await guard();
      const db=await openTransferDatabase({auth,contract,record,snapshotReader:readRecoveryRequestState,allowTaskUpdate:false,
        transactionFactory:inspect?()=>undefined:args=>createRecoveryRequestTransaction({...args,assertApproved,claimPermanent})});
      return {...db,transaction:inspect?undefined:db.transaction,close:async()=>{try{await record('database-counts',db.counts());}finally{await db.close();}}};
    },
    async claimWrite(v){await guard();await writeOnce(m.writeSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false});},
    async claimInspect(v){await guard();await writeOnce(m.inspectSlot,{...v,output:out,claimedAt:Date.now(),retryAllowed:false});},
    async writerReceipt(){
      const claim=await json(m.writeSlot);must(/^F:\/ChatGPT_workshop\/techlong-w9f-request-[a-z0-9-]+$/.test(claim.output),'REQUEST_WRITER_DIRECTORY');
      await noLinks(claim.output);let intent=null;try{intent=await json(claim.output+'/request-intent.json');}catch(e){if(e.code!=='ENOENT')throw e;}
      return {claim,intent};
    }};
}
export async function main(args=process.argv.slice(2)){
  const f=parseRequestArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'REQUEST_ENVIRONMENT');
  const out=path.resolve(f['--output']).replaceAll('\\','/');await noLinks('F:/ChatGPT_workshop');await absent(out);
  if(f['--mode']==='PrepareSaved'){
    const sourceCommit=clean(),ci=await readLocalCiV6(f['--ci-run'],sourceCommit),pins=await collectPins({roots:REQUEST_ROOTS}),auth=await authMetadataV6();
    const createdAt=Date.now(),inputs=await loadSavedInputs(),objects=new Map();
    const basis=await prepareRecoveryBasis({...inputs,createdAt,readObject:async ref=>{
      const v=await inputs.readObject(ref);objects.set(canonicalJson(ref),{reference:ref,object:v});return v;}});
    const m=await makeRequestOperatorReview({basis,sourceCommit,pins,ci,auth,createdAt});clean(sourceCommit);
    const publication=await prepareRecoveryPublication({basis,inputs,objects:[...objects.values()],sourceCommit,pins,ci,createdAt,requestOperatorSha256:m.manifestSha256});
    await mkdir(out,{mode:0o700});await writeOnce(out+'/manifest.json',m);
    await writeOnce(out+'/publication-package.json',publication.package);await writeOnce(out+'/publication-draft.json',publication.draft);
    const r={outcome:'RECOVERY_REQUEST_OPERATOR_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,
      publicationDraftSha256:publication.draft.draftSha256,packagePublished:false,
      sourceCommit,configurationContentReads:0,sqlConnections:0,slotsConsumed:0,awsCalls:0,dispatches:0,executionAuthorized:false};
    await writeOnce(out+'/result.json',r);console.log(JSON.stringify({...r,output:out}));return r;
  }
  const m=await json(path.resolve(f['--manifest'])),basis=await prepareRecoveryBasis({...await loadSavedInputs(),createdAt:m.basis.createdAt});
  await verifyRequestOperatorReview(m,basis,f['--approved-sha'],Date.now(),{inspect:f['--mode']==='Inspect'});clean(m.sourceCommit);
  must(same(await collectPins({roots:REQUEST_ROOTS}),m.pins),'REQUEST_SOURCE_PINS');
  if(f['--mode']==='RunReviewed')await absent(m.writeSlot);else await absent(m.inspectSlot);
  await mkdir(out,{mode:0o700});await writeOnce(out+'/approved-manifest.json',m);
  const result=await runRequestOperator({mode:f['--mode'],manifest:m,basis,approved:f['--approved-sha'],io:await makePorts(m,basis,out)});
  console.log(JSON.stringify({...result,output:out}));if(!['RECOVERY_HELD_REQUEST_COMMITTED_REQUIRES_INDEPENDENT_READBACK','RECOVERY_HELD_REQUEST_INDEPENDENTLY_VERIFIED','RECOVERY_REQUEST_ABSENT_INDEPENDENTLY_OBSERVED'].includes(result.outcome))process.exitCode=1;
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('RECOVERY_REQUEST_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;
});
