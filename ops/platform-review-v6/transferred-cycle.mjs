// New held task only; never republishes, restamps or mutates an old plan.
// Ports have no defaults. Importing this module cannot read private files or start clocks.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {commit,validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {TRANSFER as T,normalizedState,verifyTransferReadback} from '../platform-request-v6/transfer.mjs';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {J} from './followup.mjs';
import {assertReadiness} from '../platform-operations-v6/handoff.mjs';
import {assertHostedHandoffLease} from './hosted-handoff.mjs';
const must=(ok,code)=>{if(!ok)throw Error('TRANSFERRED_REVIEW_'+code);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const TRANSFERRED_CYCLE=Object.freeze({jobId:T.newJobId,oldJobId:T.oldJobId,
  // Object digest includes installationSha256; the key uses the inner body digest.
  installationObjectSha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae',
  reviewMs:7200000,minimumLeaseMs:15*60000,operationMs:120000,
  publicationSlot:'F:/ChatGPT_workshop/techlong-w8s-transferred-review.intent.json',
  handoffSlot:'F:/ChatGPT_workshop/techlong-w8s-hosted-handoff.intent.json'});

export async function makeTransferredAnchor({before,after,transferredAt},profile){
  const target=profile?.target??T;
  await (profile?.verifyReadback??verifyTransferReadback)(before,after,transferredAt);
  const state=normalizedState(after),attempt=state.ledger.attempts.find(a=>a.job_id===target.oldJobId),prior=state.ledger.plans.find(p=>p.plan_sha===attempt?.plan_sha);
  must(prior,'PRIOR_REVIEW');
  const references={installation:JSON.parse(prior.body.inputs.installation),lineage:JSON.parse(prior.body.inputs.lineage)};
  const prefix=`worker-v5/${prior.body.instanceId}/`;
  for(const r of Object.values(references))must(Object.keys(r).sort().join(',')==='key,sha256,versionId'&&
    /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId),'VERSIONED_REFERENCE');
  must(references.installation.key===prefix+`installation/${B.platform.installationSha256}.json`&&
    references.installation.sha256===TRANSFERRED_CYCLE.installationObjectSha256&&references.lineage.key===J.lineageKey&&
    references.lineage.sha256===J.lineageSha256,'EXISTING_IMMUTABLE_LINEAGE');
  const body={schema:profile?.anchorSchema??'techlong/transferred-review-anchor/v6',before:normalizedState(before),after:state,transferredAt,references,
    jobId:target.newJobId,oldJobId:target.oldJobId,priorReviewPlanSha256:prior.plan_sha,
    priorReviewReusableForExecution:false,preparationIsNotApproval:true};
  return {...body,anchorSha256:await sha256Hex(body)};
}
export async function assertTransferredBaseline(anchor,current,profile){
  must(same(anchor,await makeTransferredAnchor(anchor,profile)),'ANCHOR');
  must(same(normalizedState(current.state),anchor.after)&&current.newLedger&&
    Object.keys(current.newLedger).sort().join(',')==='approvals,attempts,plans'&&
    Object.values(current.newLedger).every(v=>Array.isArray(v)&&v.length===0),'LIVE_STATE_OR_NEW_LEDGER_CHANGED');
}
export async function assertTransferredReviewQuery(q,anchor,sourceCommit,now,profile){
  const target=profile?.target??T;
  must(q.text===ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text&&q.values.length===4,'EXACT_PUBLICATION');
  const v=await validatePlan(JSON.parse(q.values[3]),B.platform,now);
  must(v.planSha256===q.values[0]&&v.actionSha256===q.values[1]&&q.values[2]===B.platform.riskSha256&&v.plan.mode==='Review'&&
    v.plan.sourceCommit===sourceCommit&&v.plan.jobId===target.newJobId&&v.plan.expiresAt-v.plan.preparedAt===TRANSFERRED_CYCLE.reviewMs&&
    v.plan.inputs.installation===canonicalJson(anchor.references.installation)&&v.plan.inputs.lineage===canonicalJson(anchor.references.lineage),'PLAN_BINDING');
  return v;
}
export function createTransferredReviewPublisher({anchor:rawAnchor,sourceCommit,lease:rawLease,ports,now=Date.now,profile}){
  const target=profile?.target??T;
  const anchor=structuredClone(rawAnchor),lease=structuredClone(rawLease),scope={sourceCommit,jobId:target.newJobId};must(commit(sourceCommit),'SOURCE');let used=false;
  return Object.freeze({async once(){
    must(!used,'MEMORY_ONCE');used=true;let phase='PRE_APPROVAL',claimAttempted=false,claimed=false,ownerSubmissions=0;
    const startedAt=now();
    try{
      must(same(anchor,await makeTransferredAnchor(anchor,profile)),'ANCHOR');
      const guard=async()=>{
        await ports.assertApproved();await ports.assertSource();
        must(same(await ports.readLease(),lease),'LEASE_CHANGED');
        assertReadiness(await ports.readiness(),scope,now());
        await assertHostedHandoffLease(lease,B.platform,scope,now());
        must(lease.expiresAt-now()>TRANSFERRED_CYCLE.minimumLeaseMs&&now()>=startedAt&&now()-startedAt<TRANSFERRED_CYCLE.operationMs,'PUBLICATION_WINDOW');
      };
      await guard();await ports.assertTransferEvidence(anchor);await assertTransferredBaseline(anchor,await ports.readBaseline(),profile);await guard();
      phase='PERMANENT_CLAIM';claimAttempted=true;await ports.claim();claimed=true;
      phase='RECONSTRUCT_AND_ADMIT';
      const publisher=createTrustedPublisherV6({release:B.platform,sourceCommit,frozenSourceCommit:B.publisher.frozenSourceCommit,now,
        ports:{readObject:async r=>{must(Object.values(anchor.references).some(v=>same(v,r)),'OBJECT_ALLOWLIST');return ports.readObject(r);},
          readHeldJob:async id=>{must(id===scope.jobId,'EXACT_JOB');return ports.readHeldJob(id);},
          async writeOwner(q){
            must(ownerSubmissions===0,'WRITE_BUDGET');const v=await assertTransferredReviewQuery(q,anchor,sourceCommit,now(),profile);
            await ports.record('proposed-review-plan',v);await assertTransferredBaseline(anchor,await ports.readBaseline(),profile);await guard();
            phase='OWNER_PLAN_SUBMISSION';ownerSubmissions++;await ports.writeOwner(q);
          }}});
      const published=await publisher.publishReview({jobId:target.newJobId,installationReference:anchor.references.installation,lineageReference:anchor.references.lineage});
      const result={outcome:'TRANSFERRED_REVIEW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',jobId:target.newJobId,sourceCommit,
        planSha256:published.planSha256,actionSha256:published.actionSha256,riskSha256:B.platform.riskSha256,
        expiresAt:published.plan.expiresAt,ownerSubmissions,conditionalLineagePuts:0,workflowDispatches:0,executionApproved:false,retryAllowed:false};
      await ports.record('result',result);return result;
    }catch{
      const result={outcome:'TRANSFERRED_REVIEW_STOPPED_REQUIRES_READBACK_NO_RETRY',phase,slotClaimAttempted:claimAttempted,slotClaimed:claimed,
        ownerSubmissions,workflowDispatches:0,retryAllowed:false};if(claimAttempted)await ports.record('result',result);return result;
    }finally{await ports.dispose();}
  }});
}
