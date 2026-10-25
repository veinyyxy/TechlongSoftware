// Fixed single-cycle approval contract. No I/O, credential lookup or activation.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {TRANSFER as T} from '../platform-request-v6/transfer.mjs';
import {K,P,H,windowLease,windowTemplate,verifyWindowMetadata} from '../platform-hosted-window-v6/contract.mjs';
import {compatibleUpdateDraft} from '../platform-hosted-window-v6/recovery.mjs';
import {rootEvent} from '../platform-hosted-window-v6/compatible.mjs';
import {makeTransferredAnchor} from './transferred-cycle.mjs';
export const must=(ok,c)=>{if(!ok)throw Error('HOSTED_CYCLE_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const CYCLE=Object.freeze({jobId:T.newJobId,runMs:35*60000,updateWaitMs:5*60000,
  slot:'F:/ChatGPT_workshop/techlong-w8u-hosted-cycle.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-w8u-hosted-cycle-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8u-execution-review.md'});
export const CYCLE_SCOPE=Object.freeze({updateStackMax:1,logicalUpdates:['TaskDefinition','Service'],normalCloudFormationFailureRollback:true,
  runConfigReadsMax:1,runNeonConnectionsMax:2,ownerPlanSubmissionsMax:2,ownerProofSubmissionsMax:1,ownerObservationSubmissionsMax:1,
  s3VersionGetsMax:4,githubRunGetsMax:80,githubJobsGetsMax:1,githubJobLogsGetsMax:1,downloadedLogBytesMax:2000000,
  runSqlQueriesMax:600,runAwsMetadataMax:240,sourceRefreshLoadsMax:6,
  inspectConfigReadsMax:1,inspectNeonConnectionsMax:1,inspectSqlQueriesMax:60,inspectAwsMetadataMax:75,
  publicPageGetsMax:1,controlMinutes:30,iamWrites:0,secretValueReads:0,pemReads:0,s3Puts:0,parentWorkflowDispatches:0,
  parentJobClaims:0,parentTenantCreates:0,automaticStopCleanupRetryOrOperatorRollback:false});
export async function makeCycleReview({sourceCommit,pins,ci,compatibility,preparation,anchor,auth,nonce,createdAt,riskSha256}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    pins.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'SOURCE_CI');
  must(preparation?.schema==='techlong/current-pipeline-preparation/v6'&&preparation.jobId===T.newJobId&&
    preparation.productionWriteEntryReady===false&&preparation.preparationIsNotWriteApproval===true&&
    same(preparation.newControlCounts,{plans:0,approvals:0,attempts:0})&&preparation.baseline?.stackId===K.stackId&&
    preparation.baseline.stackStatus==='UPDATE_COMPLETE'&&preparation.baseline.healthy===true&&preparation.baseline.iamLayoutUnchanged===true&&
    preparation.baseline.ids.TaskDefinition===`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:4`&&
    anchor.jobId===T.newJobId&&anchor.anchorSha256===preparation.anchorSha256,'PREPARATION');
  must(compatibility?.executionSourceCommit===sourceCommit&&compatibility.imageSourceCommit===H.imageSource&&compatibility.protectedRuntimeCodeUnchanged===true&&
    compatibility.cloudClosureSha256===B.platform.closureSha256&&auth?.contentRead===false&&auth.length>0&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&
    /^[a-f0-9]{32}$/.test(nonce)&&/^[a-f0-9]{64}$/.test(riskSha256)&&Number.isSafeInteger(createdAt)&&createdAt>=preparation.createdAt&&
    createdAt<preparation.expiresAt-CYCLE.runMs,'INPUTS_OR_PREPARATION_EXPIRED');
  must(same(anchor,await makeTransferredAnchor(anchor)),'ANCHOR');
  const body={schema:'techlong/transferred-hosted-cycle-review/v6',sourceCommit,pins,ci,compatibility,preparation,anchor,auth,nonce,createdAt,
    expiresAt:preparation.expiresAt,latestStartAt:preparation.expiresAt-CYCLE.runMs,riskSha256,riskFile:CYCLE.riskFile,binding:B,scope:CYCLE_SCOPE,
    windowTemplateSha256:await sha256Hex(windowTemplate(sourceCommit)),
    clocks:'30min from actual UpdateStack intent; Review2h minted only after human page readiness; original cloud claim15min not extended',
    prerequisites:'Fresh unchanged hosting and exact held task; no new-job plans/approval/attempt; final source and CI frozen. Manual platform and GitHub approvals remain required.',
    independentInspect:'One separately invoked read-only window/control inspection; NOT workload acceptance or permission to dispatch cloud Inspect.',
    risks:{nonAtomicNotCas:true,normalFailureRollbackAndOldRevisionCleanup:true,serviceDowntime:true,credentialsMemoryAndProviderLogs:true,
      sourceRefreshMayFail:true,ownerCredentialNotRowLimited:true,partialOrUnknownWritesMayPersist:true,logsReadIntoMemory:true,
      feesContinueAfterLease:true,noAutomaticRetryDeleteCompensationResetOrExtension:true},preparationIsNotExecutionApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateCycleReview(m,sha,at,{inspect=false,running=false}={}){
  must(same(m,await makeCycleReview(m))&&sha===m.manifestSha256,'APPROVAL_SHA');
  must(Number.isSafeInteger(at)&&at>=m.createdAt&&(inspect||at<(running?m.expiresAt:m.latestStartAt)),'APPROVAL_EXPIRED');return m;
}
export function cycleUpdateRequest(m,at){
  must(Number.isSafeInteger(at),'INTENT_TIME');return {...compatibleUpdateDraft(m.sourceCommit,m.nonce,at),ClientRequestToken:'platform-cycle-'+m.nonce};
}
export function verifyCycleWindow(inventory,m,intent){
  must(intent.manifestSha256===m.manifestSha256&&same(intent.request,cycleUpdateRequest(m,intent.intentAt))&&
    same(intent.controlLease,windowLease(intent.intentAt,m.sourceCommit)),'INTENT_BINDING');
  const r=inventory.rawMetadata,e=inventory.extra,root=rootEvent(r);
  must(inventory.iam?.iamLayoutUnchanged===true&&r.stack.Stacks[0].DisableRollback===false&&root.ResourceStatus==='UPDATE_COMPLETE'&&
    root.ClientRequestToken===intent.request.ClientRequestToken&&Date.parse(root.Timestamp)>=intent.intentAt,'UPDATED_ROOT');
  const proof=verifyWindowMetadata(r,intent.controlLease,m.preparation.baseline.ids,true,m.sourceCommit),ids=Object.fromEntries(proof.resources.map(r=>[r.id,r.physicalId]));
  const retired=[...H.retiredTaskDefinitions,K.originalDefinition,m.preparation.baseline.ids.TaskDefinition];
  must(e.stackId===K.stackId&&e.stackPolicy===null&&same(e.changeSets,[])&&same(e.definitions.ACTIVE,[ids.TaskDefinition])&&
    e.definitions.INACTIVE.every(v=>retired.includes(v))&&e.definitions.DELETE_IN_PROGRESS.every(v=>v===m.preparation.baseline.ids.TaskDefinition),'UPDATED_EXTRA');
  return {...proof,rootEventId:root.EventId,normalFailureRollbackEnabled:true,workloadAcceptanceVerified:false};
}
