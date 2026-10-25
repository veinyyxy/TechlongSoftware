// Saved, independently obtained facts only. No AWS, config, DB or credential port.
import {readText} from '../platform-image-source-v2/files.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {K,H,checkIdentities,hash,canonical} from '../platform-hosted-window-v6/contract.mjs';
import {currentParents} from './current-local.mjs';
import {assertTransferredBaseline} from './transferred-cycle.mjs';
import {validateCycleReview,verifyCycleWindow,must} from './cycle-plan.mjs';
import {NEXT_BASE} from './cycle-next.mjs';
const ROOT='F:/ChatGPT_workshop/techlong-w8u-hosted-cycle-20261024-a';
const json=async f=>JSON.parse(await readText(f,3000000));
export function verifyNextCurrent(inventory,witness,now=Date.now()){
  const {legacyManifest,legacyIntent}=witness;
  const proof=verifyCycleWindow(inventory,legacyManifest,legacyIntent),s=inventory.rawMetadata.stack.Stacks[0];
  const ids=Object.fromEntries(proof.resources.map(r=>[r.id,r.physicalId]));
  must(legacyManifest.sourceCommit==='8b2c58c81a10a6c4923bae77f90895d1c3450472'&&
    proof.rootEventId===NEXT_BASE.rootEventId&&ids.TaskDefinition===NEXT_BASE.definition&&proof.controlLease.expiresAt<=now,'NEXT_CURRENT_ROOT');
  checkIdentities(inventory.rawMetadata.resources.StackResourceSummaries,witness.ids??ids,false);
  return {stackId:K.stackId,stackStatus:s.StackStatus,rootEventId:proof.rootEventId,ids,oldLease:proof.controlLease,
    hostingExpiresAt:proof.hostingExpiresAt,templateSha256:templateHash(inventory.rawMetadata.template.TemplateBody),
    tags:[...(s.Tags??[])].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),stackPolicy:null,
    imageDigest:H.imageDigest,healthy:true,iamLayoutUnchanged:true,notNewWindow:true};
}
// The shared hash is synchronous canonical SHA256, matching hosting contracts.
const templateHash=v=>hash(canonical(typeof v==='string'?JSON.parse(v):v));
export async function loadNextPreparation(at=Date.now()){
  const raw=await readText(NEXT_BASE.closure,3000000);must(await sha256Hex(raw)===NEXT_BASE.closureSha256,'NEXT_PARENT_CLOSURE');
  const closure=JSON.parse(raw);
  must(closure.artifacts.length===42&&closure.noHumanPageReceipt===true&&closure.cycleSlotConsumed===true&&
    closure.cycleInspectSlotConsumed===true&&closure.oldJobsHistoryBusinessAndProtectionUnchanged===true,'NEXT_PARENT_STATE');
  for(const a of closure.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'NEXT_PARENT_ARTIFACT');
  const legacyManifest=await json(ROOT+'/manifest.json'),legacyIntent=await json(ROOT+'-run/window-intent.json');
  await validateCycleReview(legacyManifest,closure.manifestSha256,legacyManifest.createdAt,{inspect:true});
  const inventory=await json(ROOT+'-inspect/window-inventory.json'),snapshot=await json(ROOT+'-inspect/control-snapshot.json');
  const parents=await currentParents();await assertTransferredBaseline(parents.anchor,snapshot);
  const hosting={legacyManifest,legacyIntent},baseline=verifyNextCurrent(inventory,hosting,at);hosting.ids=baseline.ids;
  const factsAt=Math.min(inventory.checkedAt,snapshot.checkedAt),createdAt=Math.max(inventory.completedAt,snapshot.checkedAt);
  must(inventory.awsWrites===0&&inventory.directSecretValueReads===0&&inventory.metadataCalls<=75&&
    Number.isSafeInteger(at)&&createdAt>=factsAt&&at>=createdAt&&at<factsAt+48*3600000,'NEXT_FACTS_EXPIRED');
  const body={schema:'techlong/current-pipeline-preparation/v6',sourceCommit:legacyManifest.sourceCommit,jobId:parents.anchor.jobId,
    anchorSha256:parents.anchor.anchorSha256,productionWriteEntryReady:false,preparationIsNotWriteApproval:true,
    newControlCounts:{plans:0,approvals:0,attempts:0},factsAt,createdAt,expiresAt:factsAt+48*3600000,baseline,
    parentClosureSha256:NEXT_BASE.closureSha256,parent:NEXT_BASE.closure,artifacts:closure.artifacts,
    savedIndependentFactsOnly:true,newConfigReads:0,newNeonConnections:0,newServiceCalls:0};
  return {preparation:{...body,manifestSha256:await sha256Hex(body)},anchor:parents.anchor,hosting};
}
