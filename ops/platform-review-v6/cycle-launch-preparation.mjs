// Reuse the later independent W8v read. This loader never reconnects to services.
import {readText} from '../platform-image-source-v2/files.mjs';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {K,H,checkIdentities,hash,canonical} from '../platform-hosted-window-v6/contract.mjs';
import {currentParents} from './current-local.mjs';
import {assertTransferredBaseline} from './transferred-cycle.mjs';
import {validateNextCycleReview} from './cycle-next.mjs';
import {verifyCycleWindow,must} from './cycle-plan.mjs';
import {LAUNCH_BASE} from './cycle-launch.mjs';
const ROOT='F:/ChatGPT_workshop/techlong-w8v-hosted-cycle-20261024-a',json=async f=>JSON.parse(await readText(f,3000000));
export function verifyLaunchCurrent(inventory,witness,now=Date.now(),{savedRead=false,baseline=LAUNCH_BASE}={}){
  const {parentManifest,parentIntent}=witness,proof=verifyCycleWindow(inventory,parentManifest,parentIntent),s=inventory.rawMetadata.stack.Stacks[0];
  const ids=Object.fromEntries(proof.resources.map(r=>[r.id,r.physicalId]));
  must(parentManifest.sourceCommit===baseline.sourceCommit&&proof.rootEventId===baseline.rootEventId&&
    ids.TaskDefinition===baseline.definition&&(savedRead||proof.controlLease.expiresAt<=now),'LAUNCH_CURRENT_ROOT_OR_ACTIVE_LEASE');
  checkIdentities(inventory.rawMetadata.resources.StackResourceSummaries,witness.ids??ids,false);
  const template=inventory.rawMetadata.template.TemplateBody;
  return {stackId:K.stackId,stackStatus:s.StackStatus,rootEventId:proof.rootEventId,ids,oldLease:proof.controlLease,
    hostingExpiresAt:proof.hostingExpiresAt,templateSha256:hash(canonical(typeof template==='string'?JSON.parse(template):template)),
    tags:[...(s.Tags??[])].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),stackPolicy:null,
    imageDigest:H.imageDigest,healthy:true,iamLayoutUnchanged:true,notNewWindow:true};
}
export async function loadLaunchPreparation(at=Date.now()){
  const raw=await readText(LAUNCH_BASE.closure,3000000);must(await sha256Hex(raw)===LAUNCH_BASE.closureSha256,'LAUNCH_PARENT_CLOSURE');
  const closure=JSON.parse(raw);must(closure.artifacts.length===43&&closure.noHumanPageReceipt===true&&closure.cycleSlotConsumed===true&&
    closure.cycleInspectSlotConsumed===true&&closure.oldJobsHistoryBusinessAndProtectionUnchanged===true,'LAUNCH_PARENT_STATE');
  for(const a of closure.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'LAUNCH_PARENT_ARTIFACT');
  const parentManifest=await json(ROOT+'/manifest.json'),parentIntent=await json(ROOT+'-run/window-intent.json');
  await validateNextCycleReview(parentManifest,closure.manifestSha256,parentManifest.createdAt,{inspect:true});
  const inventory=await json(ROOT+'-inspect/window-inventory.json'),snapshot=await json(ROOT+'-inspect/control-snapshot.json');
  const parents=await currentParents();await assertTransferredBaseline(parents.anchor,snapshot);
  const hosting={parentManifest,parentIntent},baseline=verifyLaunchCurrent(inventory,hosting,at,{savedRead:true});hosting.ids=baseline.ids;
  const factsAt=Math.min(inventory.checkedAt,snapshot.checkedAt),createdAt=Math.max(inventory.completedAt,snapshot.checkedAt);
  must(inventory.awsWrites===0&&inventory.directSecretValueReads===0&&inventory.metadataCalls<=75&&
    Number.isSafeInteger(at)&&createdAt>=factsAt&&at>=createdAt&&at<factsAt+48*3600000,'LAUNCH_FACTS_EXPIRED');
  const body={schema:'techlong/current-pipeline-preparation/v6',sourceCommit:parentManifest.sourceCommit,jobId:parents.anchor.jobId,
    anchorSha256:parents.anchor.anchorSha256,productionWriteEntryReady:false,preparationIsNotWriteApproval:true,
    newControlCounts:{plans:0,approvals:0,attempts:0},factsAt,createdAt,expiresAt:factsAt+48*3600000,baseline,
    parentClosureSha256:LAUNCH_BASE.closureSha256,parent:LAUNCH_BASE.closure,artifacts:closure.artifacts,
    savedIndependentFactsOnly:true,oldLeaseActiveAtSavedRead:inventory.checkedAt<baseline.oldLease.expiresAt,
    newConfigReads:0,newNeonConnections:0,newServiceCalls:0};
  return {preparation:{...body,manifestSha256:await sha256Hex(body)},anchor:parents.anchor,hosting};
}
