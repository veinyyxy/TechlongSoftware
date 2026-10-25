// Synthetic successor history, not a production archive or configuration file.
import {nextFixture,nextAfter,NEXT_AT} from './platform-task-transfer-next-v6.mjs';
import {cycleFixture} from './platform-cycle-v6.mjs';
import {NEXT,makeNextTransferProfile} from '../../ops/platform-request-v6/transfer-next.mjs';
import {normalizedState} from '../../ops/platform-request-v6/transfer.mjs';
import {makeTransferredAnchor,TRANSFERRED_CYCLE} from '../../ops/platform-review-v6/transferred-cycle.mjs';
import {SUCCESSOR_BASE,compileSuccessorReview} from '../../ops/platform-review-v6/successor-cycle.mjs';
import {J} from '../../ops/platform-review-v6/followup.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {windowLease} from '../../ops/platform-hosted-window-v6/contract.mjs';
export async function successorFixture(at=NEXT_AT){
  const f=await nextFixture(at),prior=f.before.ledger.plans.find(p=>p.job_id===NEXT.oldJobId),oldSha=prior.plan_sha;
  prior.body.inputs.installation=canonicalJson({key:`worker-v5/${prior.body.instanceId}/installation/${B.platform.installationSha256}.json`,
    sha256:TRANSFERRED_CYCLE.installationObjectSha256,versionId:'synthetic-installation'});
  prior.body.inputs.lineage=canonicalJson({key:J.lineageKey,sha256:J.lineageSha256,versionId:'synthetic-lineage'});
  const v=await validatePlan(prior.body,B.platform,prior.body.preparedAt);Object.assign(prior,{plan_sha:v.planSha256,action_sha:v.actionSha256});
  for(const r of [...f.before.ledger.approvals,...f.before.ledger.attempts])if(r.plan_sha===oldSha)r.plan_sha=v.planSha256;
  f.before=normalizedState(f.before);
  const txProfile=makeNextTransferProfile({...f.facts,baselineSha256:await sha256Hex(f.before),ledgerSha256:await sha256Hex(f.before.ledger)}),
    profile={target:NEXT,reader:txProfile.reader,verifyReadback:txProfile.verifyReadback,anchorSchema:'techlong/held-successor-review-anchor/v6'};
  const anchor=await makeTransferredAnchor({before:f.before,after:nextAfter(f.before,at),transferredAt:at},profile),legacy=await cycleFixture(at);
  const input={...legacy.m,anchor,createdAt:at+1000,preparation:{...legacy.m.preparation,jobId:NEXT.newJobId,oldJobId:NEXT.oldJobId,
    anchorSha256:anchor.anchorSha256,factsAt:at,createdAt:at+1000,expiresAt:at+48*3600000,parentTaskClosureSha256:SUCCESSOR_BASE.taskClosureSha256,
    parentHostingClosureSha256:SUCCESSOR_BASE.windowClosureSha256,baseline:{...legacy.m.preparation.baseline,rootEventId:SUCCESSOR_BASE.rootEventId,
      ids:{...legacy.m.preparation.baseline.ids,TaskDefinition:SUCCESSOR_BASE.definition},oldLease:windowLease(at-7200000,SUCCESSOR_BASE.sourceCommit)}}};
  const m=await compileSuccessorReview(input,profile);return {at,input,m,profile,anchor,prior,current:{state:anchor.after,newLedger:{plans:[],approvals:[],attempts:[]}}};
}
