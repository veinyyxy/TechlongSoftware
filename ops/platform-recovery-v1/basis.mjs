// Recovery continuity is NOT accepted lineage. No clients or import-time I/O.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S,projectInitializedDeployment} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
import {continueCloudContextV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {verifyCloudResultContent} from '../platform-operations-v6/evidence.mjs';
import {assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {assertAdmissionSnapshot} from '../platform-request-v6/transfer-state.mjs';
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_V1_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const prefix=`worker-v5/${S.appInstanceId}/`,oldJobId='job_9db8466fd95cef0c23ad6bfc',manifestSha='263eed6e5ff4be1f834b470665a2413d5d1aedb3d24833e1cf89d87fa7fcef59';
export const RECOVERY=freeze({oldJobId,runId:'40204548444',sourceCommit:'fbad7cbae56320108ee0f20e2d46679ab1c00b0d',manifestSha,
  stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/53f32460-d084-11f1-ad5b-0ee0206d8b5f',
  taskDefinitionArn:'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:8',
  receiptSha256:'90b2eaac6b30b074169e94d1754fe47f201eac16b859e48aac80140558e8f116',
  stateSha256:'94213d2f61001e3fd006a3a3c26afdc37bad6cf136210b0bcdad78e4c5c4bfe2',
  retirementSha256:'d703b2ae2e7295fa7ef51e1e5f142884147a9298987ee4e80ebbb90c546e33d4',
  factsAt:1792954077695,databaseCheckedAt:1792954117513,observedBy:1792954117827,validMs:48*3600000,
  clientRequestId:'2afc13c3-1ce8-4ce2-9c71-5b9fded1404f',newJobId:'job_9b57b43a6b88f37202b29170',
  requestId:'6fcf8b8da439ddac097d44fd529ebee0f0eea2644be718f31866243f8fd7b57b',
  requestSlot:'F:/ChatGPT_workshop/techlong-w9e-new-held-request.intent.json',
  resultReference:{key:prefix+oldJobId+'/'+manifestSha+'/run-40204548444-1/platform-result-v6.json',
    versionId:'V4DkcKLhxxLSypjL3wlTsjeN6k2R8.tQ',sha256:'5bec017ad20962160f61b7420d6db58ad97e8a05ecf0b20e55b575fd4931cdd5'}});
const verified=new WeakMap();
export function recoveryData(basis,at){
  const d=verified.get(basis);must(d&&Number.isSafeInteger(at)&&at>=basis.createdAt&&at<basis.expiresAt,'UNVERIFIED_OR_EXPIRED_BASIS');return d;
}
export async function assertRetirement(retirement,profile,provider,manifest,observedBy){
  const r=retirement,rows=r?.resources;
  must(r?.stackId===profile.stackId&&r.status==='DELETE_COMPLETE'&&Date.parse(r.deletionTime)>provider.checkedAt&&
    Date.parse(r.deletionTime)<=observedBy&&rows?.length===7&&new Set(rows.map(v=>v.LogicalResourceId)).size===7&&
    manifest.workload.resourceInventory.length===7&&manifest.workload.resourceInventory.every(e=>rows.some(v=>v.LogicalResourceId===e.logicalId&&
      v.ResourceType===e.type&&v.ResourceStatus==='DELETE_COMPLETE'&&v.PhysicalResourceId===provider.physical[e.logicalId]))&&
    await sha256Hex(r)===profile.retirementSha256,'EXACT_RETIRED_UUID_AND_INVENTORY');
}
// The profile is an explicit TEST/code capability, never recovered from a JSON
// manifest or selected by a production flag. The fixed export below uses RECOVERY.
export function recoveryBasisCompiler(profile){
  const target=freeze(structuredClone(profile));
  must(target.validMs===48*3600000&&target.oldJobId!==target.newJobId&&/^[a-f0-9]{40}$/.test(target.sourceCommit)&&
    [target.receiptSha256,target.stateSha256,target.retirementSha256].every(v=>/^[a-f0-9]{64}$/.test(v)),'PROFILE');
  return async function compile({capsule,state:rawState,retirement,execution,readObject,createdAt}){
    const state=normalizedState(rawState);
    must(Number.isSafeInteger(createdAt)&&createdAt>=target.observedBy&&createdAt<target.factsAt+target.validMs&&
      target.factsAt<=target.databaseCheckedAt&&target.databaseCheckedAt<=target.observedBy,'FACT_WINDOW');
    assertAdmissionSnapshot(state.deployment,createdAt);
    const dedupes=state.jobs.filter(j=>j.dedupe_key!==null&&j.dedupe_key!==undefined).map(j=>j.dedupe_key);
    must(new Set(state.jobs.map(j=>j.id)).size===state.jobs.length&&new Set(dedupes).size===dedupes.length,'JOB_UNIQUENESS');
    must(await sha256Hex(state)===target.stateSha256&&state.jobs.every(j=>['succeeded','canceled'].includes(j.status)&&
      ['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null)),'EXACT_TERMINAL_STATE');
    const receipt=state.deployment.outputs.expressInitializedWorkerRunsV2?.[target.oldJobId],job=state.jobs.find(j=>j.id===target.oldJobId);
    must(job?.status==='succeeded'&&job.attempts===1&&job.max_attempts===1&&job.payload.kind==='express_initialized_workload_v2'&&job.payload.planSha256===receipt?.jobPlanSha256&&
      receipt.jobId===target.oldJobId&&receipt.stackId===target.stackId&&receipt.workloadExpiresAt<target.factsAt&&
      receipt.materialSha256===S.materialSha256&&receipt.configurationHash===S.configurationHash&&receipt.imageUri===S.artifactRef&&
      receipt.initializedVerified===true&&receipt.effectiveConfigurationVerified===true&&receipt.epoch===S.epoch&&receipt.operationHash===S.operationHash&&
      receipt.existingDefaultStoreId===S.existingDefaultStoreId&&receipt.completedBy==='express-initialized-single-job-v2'&&
      await sha256Hex(receipt)===target.receiptSha256,'EXECUTION_RECEIPT');
    const projected=projectInitializedDeployment({deployment:state.deployment,jobs:state.jobs,gateEnabled:false,now:createdAt});
    must(projected.view.state==='expired'&&projected.view.latest?.jobId===target.oldJobId&&same(projected.rawReceipt,receipt),'LATEST_EXPIRED_RECEIPT');
    must(execution.runId===target.runId&&execution.plan.sourceCommit===target.sourceCommit&&execution.plan.jobId===target.oldJobId&&
      execution.plan.mode==='RunOnce'&&execution.plan.inputs.manifestSha===target.manifestSha&&same(execution.resultReference,target.resultReference),'EXECUTION_BINDING');
    const v=await validatePlan(execution.plan,B.platform,execution.plan.preparedAt),entry=state.ledger.plans.find(p=>p.plan_sha===v.planSha256);
    const approval=state.ledger.approvals.find(a=>a.plan_sha===v.planSha256),attempt=state.ledger.attempts.find(a=>a.plan_sha===v.planSha256);
    must(entry?.job_id===target.oldJobId&&entry.mode==='RunOnce'&&entry.action_sha===v.actionSha256&&same(entry.body,execution.plan)&&
      approval?.admin_id===ADMIN&&attempt?.job_id===target.oldJobId&&attempt.mode==='RunOnce'&&attempt.run_id===target.runId&&
      ['ACKNOWLEDGED','OBSERVED'].includes(attempt.state),'ORIGINAL_APPROVED_LEDGER');
    const cache=new Map();
    const read=async ref=>{
      assertReferenceV6(ref,ref.key);must(ref.key.startsWith(prefix),'EVIDENCE_SCOPE');const k=canonicalJson(ref);
      if(!cache.has(k)){
        must(cache.size<8,'OBJECT_BUDGET');const o=await readObject(ref);
        must(o?.versionId===ref.versionId&&o.encryption==='AES256'&&o.contentLength>0&&o.contentLength<=1000000&&
          await sha256Hex(o.value)===ref.sha256,'EVIDENCE_METADATA_OR_HASH');assertEvidenceSafeV5(o.value);cache.set(k,structuredClone(o));
      }return structuredClone(cache.get(k));
    };
    const content=await verifyCloudResultContent({...execution,release:B.platform,sourceCommit:target.sourceCommit,
      frozenSourceCommit:B.publisher.frozenSourceCommit,readObject:read,now:()=>createdAt});
    must(content.attestation.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'&&!content.independentCloudAcceptanceVerified,'EXECUTION_NOT_ACCEPTANCE');
    const manifest=(await read(content.attestation.manifestReference)).value,report=(await read(content.attestation.reportReference)).value;
    must(manifest.manifestSha256===target.manifestSha&&manifest.jobPlan.planSha256===receipt.jobPlanSha256&&manifest.workload.workloadExpiresAt===receipt.workloadExpiresAt&&
      report.result.receiptSha256===target.receiptSha256&&report.independentInspectRequired===true&&report.journal.state==='ALL_SLOTS_CONSUMED','EXECUTION_CONTENT');
    const providerRef=report.savedEvidence['provider-after.json'];
    assertReferenceV6(providerRef,`${prefix}${target.oldJobId}/${target.manifestSha}/run-${target.runId}-1/provider-after.json`);
    const original=(await read(providerRef)).value,provider=Object.fromEntries(['stackId','physical','taskArn','imageUri','checkedAt'].map(k=>[k,original[k]]));
    must(provider.stackId===target.stackId&&provider.physical.TenantTaskDefinition===target.taskDefinitionArn&&Object.keys(provider.physical).length===7&&
      provider.imageUri===S.artifactRef&&provider.checkedAt===receipt.providerCheckedAt&&await sha256Hex(provider)===receipt.providerObservationSha256,'PROVIDER_RECEIPT_BINDING');
    await assertRetirement(retirement,target,provider,manifest,target.observedBy);
    let accepted=await prepareCloudContextV5(capsule);
    if(execution.plan.inputs.lineage)accepted=await continueCloudContextV5(accepted,(await read(JSON.parse(execution.plan.inputs.lineage))).value);
    must(same(accepted.predecessor,manifest.predecessor),'ACCEPTED_HISTORY');
    const body={schema:'techlong/retired-unaccepted-recovery-basis/v1',createdAt,expiresAt:target.factsAt+target.validMs,
      factsAt:target.factsAt,databaseCheckedAt:target.databaseCheckedAt,observedBy:target.observedBy,
      execution:{jobId:target.oldJobId,runId:target.runId,sourceCommit:target.sourceCommit,manifestSha256:target.manifestSha,
        manifestReference:content.attestation.manifestReference,resultReference:target.resultReference,receiptSha256:target.receiptSha256,
        providerReference:providerRef,providerObservationSha256:receipt.providerObservationSha256},
      retirement:{stackId:target.stackId,taskDefinitionArn:target.taskDefinitionArn,inventorySha256:target.retirementSha256},
      stateSha256:target.stateSha256,protection:state.protection,acceptedPredecessor:accepted.predecessor,
      disposition:{executionSucceeded:true,independentAcceptance:false,retired:true,acceptedLineageAppend:false,
        currentAvailabilityProved:false,executionAuthorized:false,preparationIsNotApproval:true}};
    const basis=freeze({...body,basisSha256:await sha256Hex(body)});
    const predecessor=freeze({jobId:target.oldJobId,stackId:target.stackId,taskDefinitionArn:target.taskDefinitionArn,receiptSha256:target.receiptSha256});
    const context=Object.freeze({...accepted,predecessor,base:freeze({...accepted.base,predecessorStackId:target.stackId,predecessorTaskDefinitionArn:target.taskDefinitionArn}),
      recoveryBasisSha256:basis.basisSha256,acceptedPredecessor:accepted.predecessor,currentCloudHealthProved:false,executionAuthorized:false,runtimeEnabled:false});
    verified.set(basis,Object.freeze({target,state:freeze(state),retirement:freeze(structuredClone(retirement)),provider:freeze(provider),manifest:freeze(manifest),context}));return basis;
  };
}
export const prepareRecoveryBasis=recoveryBasisCompiler(RECOVERY);
