// Saved facts and fixed parents only. Importing/using this loader never opens a
// production connection or reads configuration contents.
import {readText} from '../platform-image-source-v2/files.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {makeTransferredAnchor,assertTransferredBaseline} from './transferred-cycle.mjs';
import {verifyLaunchCurrent} from './cycle-launch-preparation.mjs';
import {validateLaunchReview} from './cycle-launch.mjs';
import {must,same} from './cycle-plan.mjs';
import {SUCCESSOR_BASE as B,SUCCESSOR_REVIEW} from './successor-cycle.mjs';
const TASK='F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a',WINDOW='F:/ChatGPT_workshop/techlong-w8w-hosted-cycle-20261025-a';
export const SUCCESSOR_READY='F:/ChatGPT_workshop/techlong-w8z-readonly-ready.json';
const json=async f=>JSON.parse(await readText(f,3000000));
async function closure(file,digest,count){
  const raw=await readText(file,3000000);must(await sha256Hex(raw)===digest,'SUCCESSOR_PARENT_HASH');const c=JSON.parse(raw);
  must(c.artifacts.length===count&&new Set(c.artifacts.map(a=>a.file)).size===count,'SUCCESSOR_PARENT');
  for(const a of c.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'SUCCESSOR_PARENT_ARTIFACT');return c;
}
export async function successorParents(){
  const t=await closure(B.taskClosure,B.taskClosureSha256,15);
  must(t.schema==='techlong/held-successor-executed-independently-verified/v6'&&t.independentOutcome==='TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'&&
    t.taskState.newHeldJob.id===SUCCESSOR_REVIEW.target.newJobId&&t.taskState.totalJobs===9&&t.retryAllowed===false,'SUCCESSOR_TASK_PARENT');
  const m=await json(TASK+'/manifest.json'),after=await json(TASK+'-inspect/independent-state.json');
  const anchor=await makeTransferredAnchor({before:m.core.baseline,after,transferredAt:t.commitAt},SUCCESSOR_REVIEW);
  const w=await closure(B.windowClosure,B.windowClosureSha256,60),parentManifest=await json(WINDOW+'/manifest.json'),parentIntent=await json(WINDOW+'-run/window-intent.json');
  await validateLaunchReview(parentManifest,w.manifestSha256,parentManifest.createdAt,{inspect:true});
  const hosting={parentManifest,parentIntent};
  hosting.ids=verifySuccessorCurrent(await json(WINDOW+'-inspect/window-inventory.json'),hosting,t.commitAt,{savedRead:true}).ids;
  return {anchor,hosting,parents:[{file:B.taskClosure,rawSha256:B.taskClosureSha256},{file:B.windowClosure,rawSha256:B.windowClosureSha256}]};
}
export function verifySuccessorCurrent(inventory,hosting,at=Date.now(),{savedRead=false}={}){
  return verifyLaunchCurrent(inventory,hosting,at,{savedRead,baseline:B});
}
export async function compileSuccessorPreparation({cloud,database,anchor,hosting,sourceCommit,artifacts,at=Date.now()},profile=SUCCESSOR_REVIEW){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&cloud.awsWrites===0&&cloud.directSecretValueReads===0&&
    cloud.metadataCalls>0&&cloud.metadataCalls<=75&&cloud.checkedAt>=anchor.transferredAt&&cloud.completedAt>=cloud.checkedAt,'SUCCESSOR_CLOUD_READ');
  const c=database.counts,s=database.snapshot;
  must(c.configReadAttempts===1&&c.connectionAttempts===1&&c.retries===0&&c.queries>0&&c.queries<=45&&s.checkedAt>=cloud.completedAt&&s.checkedAt<=at,'SUCCESSOR_DATABASE_READ');
  await assertTransferredBaseline(anchor,s,profile);
  const baseline=verifySuccessorCurrent(cloud,hosting,at),factsAt=Math.min(cloud.checkedAt,s.checkedAt),createdAt=Math.max(cloud.completedAt,s.checkedAt);
  must(Number.isSafeInteger(at)&&at>=createdAt&&at<factsAt+48*3600000&&Array.isArray(artifacts)&&artifacts.length===4&&
    artifacts.every(a=>typeof a.file==='string'&&/^[a-f0-9]{64}$/.test(a.rawSha256)),'SUCCESSOR_FRESHNESS');
  const body={schema:'techlong/current-pipeline-preparation/v6',sourceCommit,jobId:anchor.jobId,oldJobId:anchor.oldJobId,anchorSha256:anchor.anchorSha256,
    productionWriteEntryReady:false,preparationIsNotWriteApproval:true,newControlCounts:Object.fromEntries(Object.entries(s.newLedger).map(([k,v])=>[k,v.length])),
    oldControlCounts:Object.fromEntries(Object.entries(s.state.ledger).map(([k,v])=>[k,v.length])),factsAt,createdAt,expiresAt:factsAt+48*3600000,baseline,
    parentTaskClosureSha256:B.taskClosureSha256,parentHostingClosureSha256:B.windowClosureSha256,artifacts,
    readonlyPermissionConsumed:true,prepareIsNotWriteApproval:true,actualReadCounts:{awsMetadata:cloud.metadataCalls,configContentReads:1,tlsConnections:1,sqlQueries:c.queries},
    actualWriteCounts:{sql:0,aws:0,slots:0,dispatches:0},newJobOccupancyIndependentlyRead:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function loadSuccessorPreparation(at=Date.now()){
  const ready=await json(SUCCESSOR_READY);
  must(ready.schema==='techlong/held-successor-readonly-ready/v6'&&/^F:\/ChatGPT_workshop\/techlong-w8z-readonly-[a-z0-9-]+$/.test(ready.root)&&
    /^[a-f0-9]{64}$/.test(ready.preparationRawSha256),'SUCCESSOR_READY');
  const raw=await readText(ready.root+'/preparation.json',3000000);must(await sha256Hex(raw)===ready.preparationRawSha256,'SUCCESSOR_PREPARATION_HASH');
  const preparation=JSON.parse(raw),parents=await successorParents();
  for(const a of preparation.artifacts){must(a.file.startsWith(ready.root+'/')&&await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'SUCCESSOR_READ_ARTIFACT');}
  const rebuilt=await compileSuccessorPreparation({cloud:await json(ready.root+'/cloud-inventory.json'),database:await json(ready.root+'/database-snapshot.json'),
    ...parents,sourceCommit:preparation.sourceCommit,artifacts:preparation.artifacts,at});
  must(same(preparation,rebuilt)&&ready.manifestSha256===preparation.manifestSha256,'SUCCESSOR_PREPARATION');
  // Full canonical bytes, not just a mutable pointer, are embedded in the later
  // human-approved execution manifest and re-compared by the shared entry.
  must(canonicalJson(preparation).length<3000000,'SUCCESSOR_PREPARATION_SIZE');return {preparation,...parents};
}
