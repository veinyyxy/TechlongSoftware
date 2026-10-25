// Synthetic approval data only. No live evidence, credentials or filesystem discovery.
import {transferFixture,expectedAfter,AT} from './platform-task-transfer-v6.mjs';
import {TRANSFER as T} from '../../ops/platform-request-v6/transfer.mjs';
import {makeTransferredAnchor,TRANSFERRED_CYCLE} from '../../ops/platform-review-v6/transferred-cycle.mjs';
import {J} from '../../ops/platform-review-v6/followup.mjs';
import {makeCycleReview} from '../../ops/platform-review-v6/cycle-plan.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {K,P,H,windowLease,windowTemplate} from '../../ops/platform-hosted-window-v6/contract.mjs';
export async function cycleFixture(at=AT){
  const before=await transferFixture(at),old=before.ledger.plans.find(p=>p.body.sourceCommit===T.oldSource),oldSha=old.plan_sha;
  const references={installation:{key:`worker-v5/${old.body.instanceId}/installation/${B.platform.installationSha256}.json`,
    sha256:TRANSFERRED_CYCLE.installationObjectSha256,versionId:'synthetic-installation'},lineage:{key:J.lineageKey,sha256:J.lineageSha256,versionId:'synthetic-lineage'}};
  old.body.inputs.installation=canonicalJson(references.installation);old.body.inputs.lineage=canonicalJson(references.lineage);
  const v=await validatePlan(old.body,B.platform,old.body.preparedAt);Object.assign(old,{plan_sha:v.planSha256,action_sha:v.actionSha256});
  for(const row of [...before.ledger.approvals,...before.ledger.attempts])if(row.plan_sha===oldSha)row.plan_sha=v.planSha256;
  const anchor=await makeTransferredAnchor({before,after:expectedAfter(before,at),transferredAt:at}),sourceCommit='f'.repeat(40);
  const ids=Object.fromEntries(Object.keys(windowTemplate(sourceCommit).Resources).map(n=>[n,n==='TaskDefinition'?`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:4`:'synthetic-'+n]));
  const preparation={schema:'techlong/current-pipeline-preparation/v6',sourceCommit:'e'.repeat(40),jobId:T.newJobId,anchorSha256:anchor.anchorSha256,
    productionWriteEntryReady:false,preparationIsNotWriteApproval:true,newControlCounts:{plans:0,approvals:0,attempts:0},createdAt:at,expiresAt:at+48*3600000,
    baseline:{stackId:K.stackId,stackStatus:'UPDATE_COMPLETE',ids,healthy:true,iamLayoutUnchanged:true,oldLease:windowLease(at-7200000,T.oldSource)}};
  const m=await makeCycleReview({sourceCommit,anchor,preparation,pins:Array.from({length:20},(_,i)=>({file:'synthetic-'+i,sha256:'b'.repeat(64)})),
    ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},compatibility:{executionSourceCommit:sourceCommit,imageSourceCommit:H.imageSource,
      protectedRuntimeCodeUnchanged:true,cloudClosureSha256:B.platform.closureSha256},auth:{contentRead:false,length:1234,aclSha256:'c'.repeat(64)},
    nonce:'d'.repeat(32),createdAt:at,riskSha256:'a'.repeat(64)});
  return {m,at,anchor,sourceCommit,ids};
}
