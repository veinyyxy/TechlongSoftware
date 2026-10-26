// Explicit adapter only; import acquires no key, login session or live client.
import {createInspectTransport,livePorts} from '../platform-operator-v6/live.mjs';
import {pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
import {must,same} from '../platform-recovery-v1/basis-core.mjs';
import {assertRecoveryBinding,recoveryBindingReady,RECOVERY_CONTROL_BINDING,RECOVERY_RISK} from './binding.mjs';
import {verifyRecoveryFollowupReview} from './followup.mjs';
export const CONTROL_ROOTS=['ops/platform-recovery-control-v1/cli.mjs','ops/platform-recovery-control-v1/controller.mjs','tests/platform-recovery-control-v1.test.mjs',
  'ops/platform-operator-v6/key-metadata.ps1',RECOVERY_RISK,'package.json','package-lock.json','.github/workflows/platform-cloud-candidate.yml'];
export async function recoveryControlPins(){
  const closure=await recoveryCloudClosure();return collectPins({roots:[...CONTROL_ROOTS,...closure.pins.map(p=>p.file)]});
}
export function createRecoveryInspectTransport(m,p,binding){
  must(recoveryBindingReady(binding),'TRANSPORT_BINDING_NOT_PUBLISHED');
  return createInspectTransport(m,p,{release:binding.release,maxObjects:16,followup:true,
    expandReferences({reference,object:v,originalReference,ack,sourceCommit,job,mv,input}){
      const original=reference.key===originalReference?.key,inspect=!!ack&&reference.key===resultKeyV6(job,mv,ack.runId);
      if(!original&&!inspect)return [];
      const id=original?input.runId:ack.runId;
      must(v.schema==='techlong/recovery-cloud-result/v1'&&v.mode===(original?'RunOnce':'Inspect')&&v.jobId===job&&
        v.manifestSha256===mv&&v.innerManifestSha256===input.innerManifestSha256&&v.basisSha256===binding.basisSha256&&
        v.run?.runId===id&&v.run.commitSha===sourceCommit,'TRANSPORT_RECOVERY_RESULT');
      assertReferenceV6(v.cloudReportReference,evidenceKeyV5(original?'run.json':'inspect.json',
        {jobId:job,manifestSha256:input.innerManifestSha256,run:v.run}));
      if(!original){must(v.executionReference===null,'TRANSPORT_INSPECT_DESCRIPTOR');return [v.cloudReportReference];}
      assertReferenceV6(v.executionReference,`worker-v5/${S.instanceId}/${job}/${mv}/execution-reference-${id}-v1.json`);
      return [v.cloudReportReference,v.executionReference];
    }});
}
export async function recoveryFollowupLivePorts(m,basis,output,notify,binding=RECOVERY_CONTROL_BINDING){
  await assertRecoveryBinding(binding);await verifyRecoveryFollowupReview(m,m.manifestSha256,basis,binding,Date.now(),true);
  const io=await livePorts(m,output,notify,{verify:(value,sha,at)=>verifyRecoveryFollowupReview(value,sha,basis,binding,at),
    pinSource:recoveryControlPins,transportFactory:(value,p)=>createRecoveryInspectTransport(value,p,binding)});
  return {...io,async bundle(...args){const v=await io.bundle(...args);must(same(v.plan.inputs.lineage,m.input.plan.inputs.lineage),'BUNDLE_PACKAGE_DRIFT');
    return {...v,schema:'techlong/recovery-operator-bundle/v1',binding,basisSha256:basis.basisSha256};}};
}
