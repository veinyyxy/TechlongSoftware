// Explicitly approved one-shot read only. No execution/dispatch/owner-write mode.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environment,git,ROOT,readText,writeOnce,noLinks,absent,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {currentCloudInventory} from './current-cloud.mjs';
import {readCurrentDatabaseOnce} from './current-database.mjs';
import {successorParents,compileSuccessorPreparation,verifySuccessorCurrent,SUCCESSOR_READY} from './successor-preparation.mjs';
import {SUCCESSOR_REVIEW} from './successor-cycle.mjs';
import {SUCCESSOR_ROOTS} from './successor-cycle-local.mjs';
import {must,same} from './cycle-plan.mjs';
import {operatorFailure} from './operator-failure.mjs';
export function parseSuccessorCollectArgs(args){
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n])&&typeof args[n+1]==='string','ARGS');a[args[n]]=args[n+1];}
  must(same(Object.keys(a).sort(),['--allow-config-read','--ci-run','--output'])&&a['--allow-config-read']==='yes'&&/^[1-9][0-9]{0,15}$/.test(a['--ci-run'])&&a['--output'],'ARGS');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseSuccessorCollectArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  const sourceCommit=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','CLEAN_FROZEN_MAIN');
  const out=path.resolve(a['--output']).replaceAll('\\','/');must(/^F:\/ChatGPT_workshop\/techlong-w8z-readonly-[a-z0-9-]+$/.test(out),'DIRECTORY');
  await noLinks('F:/ChatGPT_workshop');await absent(out);await absent(SUCCESSOR_READY);
  const ci=await readLocalCiV6(a['--ci-run'],sourceCommit),pins=await collectPins({roots:SUCCESSOR_ROOTS}),compatibility=await sourceCompatibility(sourceCommit),parents=await successorParents();
  await mkdir(out,{mode:0o700});const record=async(n,v)=>{assertEvidenceSafeV5(v);await writeOnce(out+'/'+n+'.json',v);};let reader,cloud,database,phase='READ_INTENT';
  try{
    await record('approved-read-intent',{schema:'techlong/held-successor-read-intent/v6',at:new Date().toISOString(),sourceCommit,ci,pins,compatibility,
      humanAllowedThisPhaseReadOnly:true,jobId:SUCCESSOR_REVIEW.target.newJobId,awsMetadataMax:75,configContentReadsMax:1,verifiedTlsConnectionsMax:1,readonlySqlMax:45,
      secretValueReads:0,pemReads:0,sqlWrites:0,cloudWrites:0,executionSlots:0,dispatches:0,retries:0});
    phase='SOURCE_AND_FIXED_METADATA';reader=await currentCloudInventory({maxMetadata:75});cloud=await reader.snapshot();await record('cloud-inventory',cloud);
    phase='CLOUD_VERIFY';await record('cloud-baseline',verifySuccessorCurrent(cloud,parents.hosting));
    phase='NEON_READONLY';database=await readCurrentDatabaseOnce({auth:await authMetadataV6(),contract:sqlContract((await readText(path.resolve(ROOT,I.sql),3000000)).replaceAll('\r\n','\n')),profile:SUCCESSOR_REVIEW});
    await record('database-snapshot',database);phase='VERIFY_PREPARATION';
    const artifacts=[];for(const n of ['approved-read-intent','cloud-inventory','cloud-baseline','database-snapshot']){
      const file=out+'/'+n+'.json';artifacts.push({file,rawSha256:await sha256Hex(await readText(file,3000000))});}
    const p=await compileSuccessorPreparation({cloud,database,...parents,sourceCommit,artifacts});
    must(git(['rev-parse','HEAD']).trim()===sourceCommit&&git(['status','--porcelain']).trim()===''&&same(await collectPins({roots:SUCCESSOR_ROOTS}),pins),'SOURCE_CHANGED');
    await record('preparation',p);
    const result={outcome:'SUCCESSOR_CURRENT_READONLY_VERIFIED_NO_WRITE_APPROVAL',manifestSha256:p.manifestSha256,sourceCommit,jobId:p.jobId,
      oldControlCounts:p.oldControlCounts,newControlCounts:p.newControlCounts,counts:p.actualReadCounts,sqlWrites:0,cloudWrites:0,slotsConsumed:0,dispatches:0,retries:0,readScopeFullyConsumed:true};
    await record('result',result);await writeOnce(SUCCESSOR_READY,{schema:'techlong/held-successor-readonly-ready/v6',root:out,
      preparationRawSha256:await sha256Hex(await readText(out+'/preparation.json',3000000)),manifestSha256:p.manifestSha256});
    console.log(JSON.stringify({...result,output:out}));return result;
  }catch(e){const r={outcome:'SUCCESSOR_CURRENT_READ_STOPPED_NO_RETRY',phase,failure:operatorFailure(e,'SUCCESSOR_PREPARE',phase),
    counts:{completedCloudMetadata:cloud?.metadataCalls??null,minimumCloudMetadata:reader?.counts.metadata??0,
      database:database?.counts??e.counts??null},sourceFailureBeforePrivateRead:!database&&phase==='SOURCE_AND_FIXED_METADATA',retryAllowed:false,writeApproval:false};
    await record('stopped',r);console.error(JSON.stringify(r));process.exitCode=1;return r;
  }finally{reader?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('SUCCESSOR_CURRENT_READ_PRECHECK_STOPPED_NO_RETRY');process.exitCode=1;});
