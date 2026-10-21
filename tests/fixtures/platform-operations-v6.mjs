// Synthetic ports only. No local paths, historical evidence or real accounts.
import {platformFixtureV6} from './platform-cloud-v6.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
export async function operationsFixtureV6(){
  const f=await platformFixtureV6(),scope={sourceCommit:f.sourceCommit,jobId:f.observed.job.id};
  const lease={schema:'techlong/platform-local-runtime-lease/v6',releaseSha256:await sha256Hex(f.release),origin:'http://127.0.0.1:3100',
    sourceCommit:f.sourceCommit,issuedAt:f.at,expiresAt:f.at+1800000};
  const review=await f.observedPlan(f.basePlan,'123456789'),resultReference=await f.resultFor(review.plan,'123456789');
  const readiness=()=>({sourceCommit:scope.sourceCommit,jobId:scope.jobId,checkedAt:f.now(),humanReadyUntil:lease.expiresAt,
    mainFrozen:true,leaseVerified:true,publisherAdapterReady:true,controllerReady:true,independentInspectorReady:true,
    replacementIndependentlyVerified:true,sourceCredentialsReady:true,environmentApprovalPageReady:true});
  const stages=[],effects={claims:0,observations:0,owners:0,disposed:0,objectGets:0};let fail;
  const ports={...f.ports,assertApproved:async()=>{if(fail==='approval')throw Error('unapproved');},assertSource:async()=>{},readiness:async()=>readiness(),
    claim:async()=>{effects.claims++;if(fail==='claim')throw Error('unknown permanent claim ACK');},record:async(n,v)=>stages.push({name:n,value:v}),dispose:async()=>{effects.disposed++;},
    readObject:async r=>{effects.objectGets++;return f.ports.readObject(r);},
    observeRun:async(sha,o)=>{effects.observations++;if(fail==='observe')throw Error('ambiguous observation');
      if(o.url!=='https://github.com/veinyyxy/TechlongSoftware/actions/runs/123456789')throw Error('invalid exact URL');
      Object.assign(f.plans.get(sha).attempt,{state:'OBSERVED',status:o.status,conclusion:o.conclusion});},
    writeOwner:async q=>{effects.owners++;if((fail==='proof'&&q.text.includes('attest_evidence'))||(fail==='plan'&&q.text.includes('publish_plan')))throw Error('ambiguous owner ACK');
      return f.ports.writeOwner(q);},
  };
  return {...f,scope,lease,review,resultReference,readiness,ports,stages,effects,setFailure:value=>{fail=value;}};
}
