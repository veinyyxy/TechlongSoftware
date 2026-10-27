// Synthetic only: no local archived business rows, private files or network.
import {recoveryFixture} from './platform-recovery-v1.mjs';
import {compileRecoveryRequest} from '../../ops/platform-recovery-v1/request.mjs';
import {recoveryBasisCompiler,recoveryData} from '../../ops/platform-recovery-v1/basis-core.mjs';
import {normalizedState} from '../../ops/platform-request-v6/state-contract.mjs';
import {makeRecoveryPackage,recoveryPackageKey} from '../../ops/platform-recovery-v1/package.mjs';
import {createRecoveryWorker} from '../../ops/platform-recovery-v1/worker.mjs';
import {loadNeonContractV5} from '../../ops/cloud-worker/neon-contract-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {A604_JOB,A604_RISK} from '../../ops/platform-a604-cloud-v1/profile.mjs';
import {a604CloudClosure} from '../../ops/platform-a604-cloud-v1/closure.mjs';
let cachedClosure;
export async function a604Fixture(){
  const f=await recoveryFixture(),old=await compileRecoveryRequest(f.basis,f.at),at=f.at+2000;
  const projection=f.makeAfter(old);Object.assign(projection.jobs.find(j=>j.id===old.jobId),{status:'canceled',completed_at:f.at+500,updated_at:f.at+500});
  const profile={...f.profile,newJobId:A604_JOB,clientRequestId:'17004827-71da-4e61-9bb3-26cbf6fbb1ba',
    requestId:'3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9',stateSha256:await sha256Hex(normalizedState(projection)),
    factsAt:f.at+500,databaseCheckedAt:f.at+1000,observedBy:f.at+1000};
  const compile=recoveryBasisCompiler(profile),inputs={...f.input,state:projection,createdAt:at},basis=await compile(inputs);
  const objects=[...f.objects.entries()].map(([key,object])=>({reference:{key,versionId:object.versionId,sha256:null},object:structuredClone(object)}));
  for(const v of objects)v.reference.sha256=await sha256Hex(v.object.value);
  const pkg=await makeRecoveryPackage({basis,inputs,objects}),pkgRef=await f.store(recoveryPackageKey(basis.basisSha256),pkg);
  const closure=cachedClosure??=await a604CloudClosure();
  const release={...f.release,reusableCommit:'6'.repeat(40),closureSha256:closure.closureSha256};
  const profileSha256=await sha256Hex(profile),publication={schema:'techlong/a604-protocol-publication/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',
    sourceCommit:f.sourceCommit,frozenSourceCommit:f.sourceCommit,release,basisSha256:basis.basisSha256,packageReference:pkgRef,profileSha256,riskFile:A604_RISK,
    factsApproval:{state:'APPROVED',manifestSha256:'7'.repeat(64),profileSha256,factsAt:profile.factsAt,databaseCheckedAt:profile.databaseCheckedAt,
      observedBy:profile.observedBy,expiresAt:profile.factsAt+profile.validMs,originalBasisExtended:false},
    activation:{schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',
      sourceCommit:f.sourceCommit,frozenSourceCommit:f.sourceCommit,releaseSha256:await sha256Hex(release)}};
  const next=await compileRecoveryRequest(basis,at),job={...projection.jobs.find(j=>j.id===old.jobId),id:A604_JOB,dedupe_key:next.values[2],status:'pending',
    payload:next.payload,completed_at:null,created_at:at,updated_at:at};
  const observed={...structuredClone(f.observed),job:{...job,payload:canonicalJson(job.payload)},jobs:[...projection.jobs,job],
    requester:{id:ADMIN,status:'active',is_platform_admin:1},checkedAt:at};
  observed.jobs=[...projection.jobs,structuredClone(observed.job)];
  const data=recoveryData(basis,at),events=[],puts=[];
  const dependencies={installation:f.installation,contract:await loadNeonContractV5(),code:{commitSha:f.sourceCommit,closureSha256:closure.closureSha256},
    run:f.run('123456797'),openDatabase:async()=>({verify:async()=>{},read:async()=>structuredClone(observed)}),
    evidence:{verify:async()=>{},put:async(name,scope,value)=>{events.push('innerEvidence');return f.store(`worker-v5/${scope.jobId}/${scope.manifestSha256}/${name}`,value);}},
    provider:{readCell:async()=>({stackId:data.context.base.compute.stackId,
      outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,data.context.base.compute.outputs[k]])),
      parentTagExpiresAt:data.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
      inspectBefore:async()=>({namespacesAbsent:true,retiredPredecessor:data.context.predecessor.stackId,cloudWrites:0})}};
  const env={...f.env,GITHUB_RUN_ID:'123456797',TECHLONG_FROZEN_SOURCE_COMMIT:f.sourceCommit,TECHLONG_REUSABLE_COMMIT:release.reusableCommit,
    TECHLONG_RECOVERY_PROTOCOL:'recovery-envelope/v1',TECHLONG_INPUT_JOB:A604_JOB,TECHLONG_INPUT_LINEAGE:canonicalJson(pkgRef)};
  const ports={signal:AbortSignal.timeout(20000),read:async ref=>{events.push('read');return structuredClone(f.objects.get(ref.key).value);},
    open:async options=>{events.push('open');const worker=createRecoveryWorker({basis:options.basis,dependencies,
      authorize:async()=>{},observeRetirement:async()=>({retirement:f.retirement,observedAt:at}),now:()=>at});
      return {...worker,dispose:async()=>events.push('dispose')};},
    put:async(key,value)=>{puts.push({key,value});return f.store(key,value);}};
  const rawRun=id=>({...f.rawRun(id),referenced_workflows:[{sha:release.reusableCommit,
    path:`veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-platform-job-v6.yml@${release.reusableCommit}`}]});
  return {...f,at,profile,projection,basis,pkg,pkgRef,closure,release,publication,observed,env,ports,events,puts,rawRun,readObject:f.ports.readObject,now:()=>at};
}
