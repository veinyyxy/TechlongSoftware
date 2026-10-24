// Production read-only preparation and offline sealing. No execution mode exists.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environment,git,ROOT,readText,writeOnce,noLinks,absent,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {currentCloudInventory,CURRENT_PARENT,verifyCurrentHosting} from './current-cloud.mjs';
import {readCurrentDatabaseOnce} from './current-database.mjs';
import {makeTransferredAnchor,assertTransferredBaseline} from './transferred-cycle.mjs';
const BASE='F:/ChatGPT_workshop',must=(ok,code)=>{if(!ok)throw Error('CURRENT_PREPARE_'+code);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const history=Object.freeze({closure:BASE+'/techlong-w8r-task-transfer-executed-verified-20261024-a.json',
  closureSha:'ea3cd27c1ff9cfa1c9977efa19eb6350682209fcc8b76572a5c8637021e8f6cb',
  before:BASE+'/techlong-w8r-task-transfer-20261024-a/manifest.json',after:BASE+'/techlong-w8r-task-transfer-20261024-a-inspect/independent-state.json',
  at:1792874740085});
export const CURRENT_ROOTS=['ops/platform-review-v6/current-local.mjs','ops/platform-review-v6/current-cloud.mjs',
  'ops/platform-review-v6/current-database.mjs','ops/platform-review-v6/hosted-driver.mjs','ops/platform-review-v6/hosted-handoff.mjs',
  'ops/platform-review-v6/transferred-cycle.mjs','tests/platform-current-prepare-v6.test.mjs','tests/platform-hosted-driver-v6.test.mjs',
  'docs/aws-auto-deployment-platform-w8t-production-preparation.md','.github/workflows/platform-cloud-candidate.yml',I.sql,'package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,3000000));
async function write(file,value){assertEvidenceSafeV5(value);await writeOnce(file,value);}
export function parseCurrentArgs(args){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&typeof args[i+1]==='string','ARGS');a[args[i]]=args[i+1];}
  const collect=a['--mode']==='Collect',fields=collect?['--mode','--ci-run','--allow-config-read','--output']:['--mode','--ci-run','--audit','--output'];
  must(['Collect','PrepareSaved'].includes(a['--mode'])&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k])&&
    /^[1-9][0-9]{0,15}$/.test(a['--ci-run'])&&(!collect||a['--allow-config-read']==='yes'),'ARGS');return a;
}
async function directory(file,prefix){const p=path.resolve(file);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  new RegExp('^techlong-w8t-'+prefix+'-[a-z0-9-]+$').test(path.basename(p)),'PATH');await noLinks(BASE);return p;}
export async function currentParents(){
  const closureRaw=await readText(history.closure,3000000);must(await sha256Hex(closureRaw)===history.closureSha,'TRANSFER_CLOSURE');
  const closure=JSON.parse(closureRaw);
  for(const a of closure.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.sha256,'TRANSFER_PARENT');
  const parentRaw=await readText(CURRENT_PARENT.file,3000000);must(await sha256Hex(parentRaw)===CURRENT_PARENT.rawSha256,'HOSTING_PARENT');
  const before=await json(history.before),after=await json(history.after),anchor=await makeTransferredAnchor({before:before.core.baseline,after,transferredAt:history.at});
  return {anchor,hosting:JSON.parse(parentRaw),references:[{file:history.closure,rawSha256:history.closureSha},CURRENT_PARENT]};
}
export async function validateSavedAudit({cloud,database,anchor,hosting,now=Date.now()}){
  must(cloud.awsWrites===0&&cloud.directSecretValueReads===0&&cloud.completedAt>=cloud.checkedAt&&now>=cloud.completedAt&&
    now-cloud.checkedAt<48*3600000&&cloud.metadataCalls>0&&cloud.metadataCalls<=220,'CLOUD_AUDIT');
  const baseline=verifyCurrentHosting(cloud,hosting,now);
  must(database.counts.configReadAttempts===1&&database.counts.connectionAttempts===1&&database.counts.retries===0&&database.counts.queries>0&&
    database.counts.queries<=45&&database.snapshot.checkedAt>=cloud.checkedAt&&database.snapshot.checkedAt<=now&&now-database.snapshot.checkedAt<48*3600000,'DATABASE_AUDIT');
  await assertTransferredBaseline(anchor,database.snapshot);return baseline;
}
export async function main(args=process.argv.slice(2)){
  const a=parseCurrentArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  const sourceCommit=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','CLEAN_MAIN');
  const ci=await readLocalCiV6(a['--ci-run'],sourceCommit),compatibility=await sourceCompatibility(sourceCommit),parents=await currentParents();
  const collect=a['--mode']==='Collect',out=await directory(a['--output'],collect?'current-prepare':'pipeline-preparation');await absent(out);
  const audit=collect?out:await directory(a['--audit'],'current-prepare');if(!collect)await noLinks(audit);
  await mkdir(out,{mode:0o700});let cloud,database,reader;
  try{
    if(collect){
      await write(out+'/readonly-intent.json',{schema:'techlong/current-prepare-readonly-intent/v6',at:new Date().toISOString(),sourceCommit,
        scope:'Fixed AWS metadata and at most one config read/one TLS readonly Neon connection',executionSlots:0,awsWrites:0});
      reader=await currentCloudInventory();cloud=await reader.snapshot();await write(out+'/cloud-inventory.json',cloud);
      await write(out+'/cloud-baseline.json',verifyCurrentHosting(cloud,parents.hosting));
      const contract=sqlContract((await readText(path.resolve(ROOT,I.sql),3000000)).replaceAll('\r\n','\n')),auth=await authMetadataV6();
      await write(out+'/database-read-intent.json',{at:new Date().toISOString(),configReadLimit:1,connectionLimit:1,readOnly:true,executionSlotsConsumed:0});
      database=await readCurrentDatabaseOnce({auth,contract});await write(out+'/database-snapshot.json',database);
    }else{
      // Existing permitted reads are consumed; this path cannot reconnect or reread .env.
      cloud=await json(audit+'/cloud-inventory.json');database=await json(audit+'/database-snapshot.json');
    }
    const baseline=await validateSavedAudit({cloud,database,...parents}),createdAt=Date.now(),artifacts=[];
    for(const name of ['readonly-intent','cloud-inventory','cloud-baseline','database-read-intent','database-snapshot']){
      const file=path.join(audit,name+'.json');artifacts.push({file,rawSha256:await sha256Hex(await readText(file,3000000))});}
    must(git(['rev-parse','HEAD']).trim()===sourceCommit&&git(['status','--porcelain']).trim()==='','SOURCE_CHANGED');
    const body={schema:'techlong/current-pipeline-preparation/v6',sourceCommit,ci,pins:await collectPins({roots:CURRENT_ROOTS}),compatibility,
      createdAt,expiresAt:Math.min(cloud.checkedAt,database.snapshot.checkedAt)+48*3600000,baseline,anchorSha256:parents.anchor.anchorSha256,
      jobId:parents.anchor.jobId,oldJobId:parents.anchor.oldJobId,immutableReferences:parents.anchor.references,parents:parents.references,artifacts,
      oldControlCounts:Object.fromEntries(Object.entries(database.snapshot.state.ledger).map(([k,v])=>[k,v.length])),
      newControlCounts:Object.fromEntries(Object.entries(database.snapshot.newLedger).map(([k,v])=>[k,v.length])),
      nextRequired:'Separately reviewed exact window update and live owner/S3/GitHub transport adapter; do not publish Review until all adapters and CI are frozen.',
      actualEffects:{configReads:collect?1:0,neonConnections:collect?1:0,awsMetadataCalls:collect?cloud.metadataCalls:0,cloudWrites:0,sqlWrites:0,executionSlots:0,dispatches:0},
      preparationIsNotWriteApproval:true,productionWriteEntryReady:false,readPermissionConsumed:collect};
    const result={...body,manifestSha256:await sha256Hex(body)};await write(out+'/preparation.json',result);
    const summary={outcome:'CURRENT_PIPELINE_PREPARED_READONLY_NOT_EXECUTION_APPROVAL',sourceCommit,manifestSha256:result.manifestSha256,
      newControlCounts:result.newControlCounts,expiresAt:result.expiresAt,productionWriteEntryReady:false,...result.actualEffects};
    await write(out+'/result.json',summary);console.log(JSON.stringify({...summary,output:out}));return summary;
  }catch(e){await write(out+'/stopped.json',{outcome:'CURRENT_PREPARE_STOPPED_NO_RETRY',code:/^(?:CURRENT_(?:PREPARE|DATABASE|CLOUD)|TRANSFERRED_REVIEW)_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    counts:e.counts??null,privateReadWasRequested:collect,retryAllowed:false,writeApproval:false});throw Error('CURRENT_PREPARE_STOPPED_NO_RETRY');
  }finally{reader?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('CURRENT_PREPARE_STOPPED_NO_RETRY');process.exitCode=1;});
