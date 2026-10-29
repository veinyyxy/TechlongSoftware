// Exact buyer material adapter, not a new executor. No import-time I/O, env
// selection, credential discovery, queue polling or production SOURCE enabled.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S,prepareInitializedPlatformRequest} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {prepareCloudContextV5,PUBLIC_CAPSULE_SHA256_V5} from '../cloud-worker/cloud-context-v5.mjs';
import {continueCloudContextV5,createCloudWorkerRootV5,assertInstallationV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {normalizedState,assertAdmissionSnapshot} from '../platform-request-v6/state-contract.mjs';
import {runPlatformCloudV6} from '../platform-cloud-v6/runtime.mjs';
import {CLOUD_V6} from '../platform-cloud-v6/contract.mjs';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {cycleCloudClosure} from './closure.mjs';

export const BUYER_SOURCE=null; // A later reviewed publication must select it.
export const BUYER_ORIGINS='https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud,https://buyer.sandbox.techlong.cloud';
export const BUYER_CAPSULE_SHA256='649c3077a5c1316e663f9765c10b4d79a9cc1bc673086de8e50d4ed1ddc92a62';
const originalOrigins='https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud';
const must=(v,c)=>{if(!v)throw Error('BUYER_COMPATIBILITY_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

// Additive SOURCE provenance. Never label this adapter as the old 110-file
// closure: the original pins are verified first and remain byte-for-byte fixed.
export async function buyerCompatibilityClosure(){
  const old=await cycleCloudClosure(),{readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{posix}=await import('node:path');
  const hash=v=>createHash('sha256').update(v).digest('hex'),file='ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs';
  const text=(await readFile(new URL(import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const known=new Set(old.pins.map(p=>p.file));
  for(const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g))
    must(known.has(posix.normalize(posix.join(posix.dirname(file),m[1]))),'UNPINNED_IMPORT');
  const pins=[...old.pins,{file,normalizedLfSha256:hash(text)}].sort((a,b)=>a.file.localeCompare(b.file));
  return {schema:'techlong/buyer-compatibility-closure/v1',pins,pinCount:pins.length,closureSha256:hash(JSON.stringify(pins)),
    previousReviewedCycleClosureSha256:old.closureSha256,legacyClosureSha256:old.legacyClosureSha256};
}

/** The serialized basis is never trusted: recoveryData requires the genuine
 * original compiler capability. Append independently accepted successors BEFORE
 * changing CORS, so the retired/unaccepted recovery gap cannot be skipped. */
export async function prepareBuyerCompatibility({source=BUYER_SOURCE,basis,capsule,links,now=Date.now}){
  must(source?.schema==='techlong/buyer-compatibility-source/v1','SOURCE_NOT_CONFIGURED');
  const s=freeze(structuredClone(source)),at=now(),d=recoveryData(basis,at),history=structuredClone(links);
  must(s.basisSha256===basis.basisSha256&&digest(s.linksSha256)&&Array.isArray(history)&&history.length>0&&
    await sha256Hex(history)===s.linksSha256,'HISTORICAL_BINDING');
  const {capsuleSha256,...body}=structuredClone(capsule??{});
  must(capsuleSha256===BUYER_CAPSULE_SHA256&&await sha256Hex(body)===BUYER_CAPSULE_SHA256&&
    body.publicParameters?.CorsAllowedOrigins===BUYER_ORIGINS,'EXACT_BUYER_MATERIAL');
  const old=structuredClone(body);old.publicParameters.CorsAllowedOrigins=originalOrigins;
  const original=await prepareCloudContextV5({...old,capsuleSha256:PUBLIC_CAPSULE_SHA256_V5});
  must(d.context.capsuleSha256===original.capsuleSha256&&same(d.context.root.material,original.root.material)&&
    same(d.context.publicParameters,original.publicParameters)&&same(d.context.controlFingerprints,original.controlFingerprints),
  'ORIGINAL_MATERIAL_AND_CONTROL');
  const accepted=await continueCloudContextV5(d.context,history);
  must(same(accepted.predecessor,s.predecessor)&&s.predecessor.jobId!==d.context.predecessor.jobId&&
    digest(s.baselineSha256)&&same(Object.keys(s.code??{}).sort(),['closureSha256','commitSha'])&&
    /^[a-f0-9]{40}$/.test(s.code?.commitSha??'')&&digest(s.code?.closureSha256)&&
    same(Object.keys(s.request??{}).sort(),['adminUserId','clientRequestId','jobId','requestId'])&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.request?.clientRequestId??'')&&
    /^job_[a-f0-9]{24}$/.test(s.request?.jobId??'')&&s.request.jobId!==s.predecessor.jobId&&digest(s.request.requestId)&&
    s.request.adminUserId===REQUEST_ADMIN_V6,
  'SOURCE_SCOPE');
  const requestId=await sha256Hex({purpose:'platform-initialized-request/v1',clientRequestId:s.request.clientRequestId,
    adminUserId:s.request.adminUserId,scope:S});
  must(requestId===s.request.requestId&&s.request.jobId==='job_'+(await sha256Hex({purpose:'express-initialized-job/v2',
    deploymentId:S.deploymentId,materialSha256:S.materialSha256,requestId})).slice(0,24),'DETERMINISTIC_REQUEST_SCOPE');
  const context=Object.freeze({...accepted,capsuleSha256:BUYER_CAPSULE_SHA256,publicParameters:freeze(body.publicParameters),
    currentCloudHealthProved:false,executionAuthorized:false,runtimeEnabled:false});
  const guard=()=>{recoveryData(basis,now());return context;};
  async function prepareRequest(state){
    guard();const snapshot=normalizedState(state),at=now();assertAdmissionSnapshot(snapshot.deployment,at);
    must(await sha256Hex(snapshot)===s.baselineSha256&&snapshot.jobs.every(j=>['succeeded','canceled'].includes(j.status)&&
      ['lease_owner','lease_token','lease_expires_at'].every(k=>j[k]===null)),'FULL_TERMINAL_BASELINE');
    const receipt=snapshot.deployment.outputs.expressInitializedWorkerRunsV2?.[s.predecessor.jobId];
    must(await sha256Hex(receipt??null)===s.predecessor.receiptSha256,'LATEST_RECEIPT');
    const request=await prepareInitializedPlatformRequest({deployment:snapshot.deployment,jobs:snapshot.jobs,gateEnabled:true,
      body:{clientRequestId:s.request.clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},
      adminUserId:s.request.adminUserId,now:at});
    must(request.program&&request.existingJobId===null&&request.program.jobId===s.request.jobId&&
      request.requestId===s.request.requestId&&request.program.values[13]===s.predecessor.jobId,'EXACT_SINGLE_INSERT_REQUEST');
    return request; // Pure SQL compilation only; no connection or execution port.
  }
  async function openRoot(dependencies){
    guard();must(dependencies&&!Object.hasOwn(dependencies,'context')&&same(dependencies.code,s.code)&&
      dependencies.run?.commitSha===s.code.commitSha,'CLOUD_SOURCE_BINDING');
    const installation=await assertInstallationV5(dependencies.installation,CLOUD_V6.installationSha256,dependencies.contract);
    const root=createCloudWorkerRootV5({...dependencies,installation,context,now});
    return Object.freeze({runtimeEnabled:false,
      review:args=>{guard();must(args.jobId===s.request.jobId,'EXACT_JOB');return root.review(args);},
      runOnce:args=>{guard();must(args.manifest?.jobPlan?.jobId===s.request.jobId&&args.manifest.jobPlan.requestId===s.request.requestId,'EXACT_JOB');return root.runOnce(args);},
      inspect:args=>{guard();must(args.manifest?.jobPlan?.jobId===s.request.jobId&&args.manifest.jobPlan.requestId===s.request.requestId,'EXACT_JOB');return root.inspect(args);},
    });
  }
  return Object.freeze({context,prepareRequest,openRoot,source:s,runtimeEnabled:false,executionAuthorized:false});
}

/** Candidate cloud mode wiring reuses the original V6 bridge and V5 root.
 * SDK/OIDC/S3 ports and a reviewed SOURCE must be supplied by a later publication;
 * no workflow, IAM trust, installed binding or historical protocol is changed. */
export async function runBuyerCompatibility({source=BUYER_SOURCE,basis,capsule,links,now=Date.now,
  env,binding,closure,ports,dependencies}){
  const compat=await prepareBuyerCompatibility({source,basis,capsule,links,now}),s=compat.source;
  must(closure.schema==='techlong/buyer-compatibility-closure/v1'&&closure.pinCount===111&&
    closure.previousReviewedCycleClosureSha256==='0c6f119def3b10efe592f559b29d4d8f929893a28dbc77a065c2746052aa308d'&&
    env.GITHUB_SHA===s.code.commitSha&&closure.closureSha256===s.code.closureSha256&&
    env.TECHLONG_INPUT_JOB===s.request.jobId&&same(dependencies.code,s.code),'CLOUD_ENTRY_BINDING');
  must(env.TECHLONG_INPUT_LINEAGE===''&&Array.isArray(links),'SOURCE_LINEAGE_ONLY');
  return runPlatformCloudV6({env,binding,closure,ports:{...ports,open:async options=>{
    must(same(options.code,s.code)&&options.run.commitSha===s.code.commitSha,'CLOUD_BRIDGE_CODE');
    const root=await compat.openRoot({...dependencies,installation:options.installation,code:options.code,run:options.run});
    return Object.freeze({...root,dispose:()=>dependencies.dispose?.()});
  }}});
}
