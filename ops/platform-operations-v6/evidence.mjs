// Operator content verification, NOT verification of a persisted control ledger.
// The publisher's SQL-shaped outputs are captured only; no SQL writer is exposed.
import {validatePlan,releaseReady,commit} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {exactRunV6,externalInputsV6} from '../platform-cloud-v6/contract.mjs';
import {must,same} from './contract.mjs';

export async function verifyCloudResultContent({plan:rawPlan,runId,run,resultReference:rawReference,release:rawRelease,sourceCommit,frozenSourceCommit,readObject,
  deriveInspectPlan=false,now=Date.now}){
  const plan=structuredClone(rawPlan),release=structuredClone(rawRelease),resultReference=structuredClone(rawReference);
  must(releaseReady(release)&&commit(sourceCommit)&&commit(frozenSourceCommit)&&plan.sourceCommit===sourceCommit&&
    ['RunOnce','Inspect'].includes(plan.mode)&&(!deriveInspectPlan||plan.mode==='RunOnce'),'CONTENT_SCOPE');
  exactRunV6(run,{runId,sourceCommit,workflowId:release.workflowId,reusableCommit:release.reusableCommit});
  const expected=await validatePlan(plan,release,plan.preparedAt),metadata=structuredClone(run),cache=new Map();let captures=0;
  const entry={...expected,riskSha256:plan.riskSha256,
    attempt:{state:'OBSERVED',runId,status:'completed',conclusion:'success',proofSha256:null}};
  const publisher=createTrustedPublisherV6({release,sourceCommit,frozenSourceCommit,now,ports:{
    async loadPlan(sha){must(sha===expected.planSha256,'EXACT_PLAN');return entry;},
    async readRun(id){must(id===runId,'EXACT_RUN');return metadata;},
    async readObject(reference){const key=canonicalJson(reference);if(!cache.has(key)){
      must(cache.size<8,'CONTENT_OBJECT_BUDGET');cache.set(key,structuredClone(await readObject(reference)));}return cache.get(key);},
    async writeOwner(q){captures++;
      if(captures===1){must(q.text===ownerQueryV6('proof',{planSha256:expected.planSha256,proofSha256:'a'.repeat(64)}).text&&
        q.values.length===2&&q.values[0]===expected.planSha256&&/^[a-f0-9]{64}$/.test(q.values[1]),'MEMORY_PROOF');
        entry.attempt.proofSha256=q.values[1];
      }else must(deriveInspectPlan&&captures===2&&q.text===ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text,'MEMORY_PLAN');
    },
  }});
  const attestation=await publisher.attestResult(expected.planSha256,resultReference);
  must(attestation.mode===plan.mode&&attestation.run.runId===runId,'CONTENT_MODE');
  let derivedInspectPlan=null;
  if(deriveInspectPlan){derivedInspectPlan=await publisher.publishSuccessor(expected.planSha256,resultReference);
    const next=derivedInspectPlan.plan;externalInputsV6(next.inputs);
    must(next.mode==='Inspect'&&next.jobId===plan.jobId&&next.sourceCommit===sourceCommit&&next.predecessor.planSha256===expected.planSha256&&
      next.predecessor.runId===runId&&next.predecessor.proofSha256===attestation.proofSha256&&
      next.inputs.installation===plan.inputs.installation&&next.inputs.lineage===plan.inputs.lineage&&
      same(JSON.parse(next.inputs.manifest),attestation.manifestReference),'DERIVED_INSPECT_BINDING');
  }
  must(captures===(deriveInspectPlan?2:1),'CONTENT_CAPTURE_COUNT');
  return {attestation,derivedInspectPlan,contentVerified:true,
    independentCloudAcceptanceVerified:plan.mode==='Inspect'&&attestation.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED',platformLedgerVerified:false,physicalOwnerWrites:0,
    proofImported:false,successorPublished:false,executionApproved:false};
}
