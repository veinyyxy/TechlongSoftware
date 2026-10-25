// Local candidate composition only. Not imported by a deployed workflow/route.
// Reuse all V5 provider/claim/completion/Inspect guards; never accept a serialized
// recovery basis as a substitute for reconstructing its actual evidence.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {createCloudWorkerRootV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import {recoveryData,assertRetirement,must,same,freeze} from './basis.mjs';

export async function recoveryEnvelope(basis,innerManifest,at){
  const d=recoveryData(basis,at);
  must(innerManifest.schema==='techlong/cloud-worker-review/v5'&&innerManifest.jobPlan.jobId===d.target.newJobId&&
    same(innerManifest.predecessor,d.context.predecessor),'RECOVERY_INNER_SCOPE');
  const {manifestSha256,...innerBody}=innerManifest;must(await sha256Hex(innerBody)===manifestSha256,'RECOVERY_INNER_HASH');
  const body={schema:'techlong/retired-unaccepted-worker-review/v1',basis,innerManifest,createdAt:at,
    expiresAt:Math.min(basis.expiresAt,innerManifest.workload.workloadExpiresAt),
    disposition:{historicalIndependentAcceptance:false,recoveryBasisIsNotAcceptance:true,newIndependentInspectRequired:true,executionApproved:false}};
  return freeze({...body,recoveryReviewSha256:await sha256Hex(body)});
}
export function createRecoveryWorker({basis,dependencies,authorize,observeRetirement,now=Date.now,rootFactory=createCloudWorkerRootV5}){
  must([authorize,observeRetirement,now,rootFactory].every(f=>typeof f==='function'),'WORKER_CAPABILITIES');let used=false;
  const enter=async(mode,reviewSha256=null)=>{
    must(!used,'WORKER_MEMORY_ONCE');used=true;const d=recoveryData(basis,now());
    await authorize({mode,basisSha256:basis.basisSha256,reviewSha256,jobId:d.target.newJobId});
    const fresh=await observeRetirement();
    must(Number.isSafeInteger(fresh.observedAt)&&fresh.observedAt<=now()&&now()-fresh.observedAt<30000,'FRESH_RETIREMENT_REQUIRED');
    await assertRetirement(fresh.retirement,d.target,d.provider,d.manifest,fresh.observedAt);recoveryData(basis,now());
    // The original provider rechecks namespace emptiness and external authority
    // inside inspectBefore. Retirement alone is never a proof of either one.
    return rootFactory({...dependencies,context:d.context,now});
  };
  const validate=async(review,approved,starting)=>{
    must(same(review,await recoveryEnvelope(basis,review.innerManifest,review.createdAt))&&approved===review.recoveryReviewSha256&&
      now()>=review.createdAt&&now()<review.expiresAt,'WORKER_APPROVAL_OR_EXPIRED');
    if(starting)assertRunWindowV3(review.innerManifest,now());return review.innerManifest;
  };
  return Object.freeze({runtimeEnabled:false,productionEntryInstalled:false,
    async review({jobId,signal}){
      const d=recoveryData(basis,now());must(jobId===d.target.newJobId,'EXACT_RECOVERY_JOB');
      const root=await enter('Review'),result=await root.review({jobId,signal});
      return {review:await recoveryEnvelope(basis,result.manifest,now()),innerSaved:result.saved,executionApproved:false};
    },
    async runOnce({review,approvedRecoveryReviewSha256,signal}){
      const m=await validate(review,approvedRecoveryReviewSha256,true),root=await enter('RunOnce',approvedRecoveryReviewSha256);
      // Recheck after the potentially slow retirement request, before opening DB
      // or handing any mutation capability to the old root.
      await validate(review,approvedRecoveryReviewSha256,true);
      return root.runOnce({manifest:m,approvedManifestSha256:m.manifestSha256,signal});
    },
    async inspect({review,approvedRecoveryReviewSha256,executionRun,executionReportReference,signal}){
      const m=await validate(review,approvedRecoveryReviewSha256,false),root=await enter('Inspect',approvedRecoveryReviewSha256);
      await validate(review,approvedRecoveryReviewSha256,false);
      return root.inspect({manifest:m,executionRun,executionReportReference,signal});
    },
  });
}
