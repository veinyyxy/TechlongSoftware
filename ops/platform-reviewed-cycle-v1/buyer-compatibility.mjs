// Exact buyer material adapter, not a new executor. No import-time I/O, env
// selection, credential discovery, queue polling or production SOURCE enabled.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S,prepareInitializedPlatformRequest} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {prepareCloudContextV5,PUBLIC_CAPSULE_SHA256_V5} from '../cloud-worker/cloud-context-v5.mjs';
import {continueCloudContextV5,createCloudWorkerRootV5,assertInstallationV5,assertCloudManifestV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {recoveryData,freeze} from '../platform-recovery-v1/basis-core.mjs';
import {normalizedState,assertAdmissionSnapshot} from '../platform-request-v6/state-contract.mjs';
import {runPlatformCloudV6} from '../platform-cloud-v6/runtime.mjs';
import {CLOUD_V6,assertReferenceV6,exactRunV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {cycleCloudClosure} from './closure.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {recoveryBasisCompiler} from '../platform-recovery-v1/basis-core.mjs';
import {loadNeonContractV5} from '../cloud-worker/neon-contract-v5.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertEvidenceSafeV5,evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {validatePlan,releaseReady} from '../../lib/deployments/controller-v6/contract.ts';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import {admitPlatformJobV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {bindWorkflowSource,createReviewedCycle,RISK} from './cycle.mjs';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {STSClient,GetCallerIdentityCommand,AssumeRoleWithWebIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {createCloudSessionV5} from '../cloud-worker/cloud-session-v5.mjs';
import {createCloudInitializedAwsV5} from '../cloud-worker/aws-initialized-workload-v5.mjs';
import {createCloudEvidenceV5,EVIDENCE_V5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {createFixedControlSecretLoaderV5} from '../cloud-worker/cloud-control-v5.mjs';
import {validateDatabaseMaterialV5} from '../cloud-worker/cloud-application-v5.mjs';
import {createNarrowNeonV5,createNeonRpcTransportV5} from '../cloud-worker/neon-persistence-v5.mjs';
import {openDynamoCloudWorkerJournalV1} from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';
import {validateCloudRunV6,externalInputsV6,releaseFromWorkflowV6,validateOidcClaimsV6} from '../platform-cloud-v6/contract.mjs';

export const BUYER_SOURCE=null; // A later reviewed publication must select it.
export const BUYER_ORIGINS='https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud,https://buyer.sandbox.techlong.cloud';
export const BUYER_CAPSULE_SHA256='649c3077a5c1316e663f9765c10b4d79a9cc1bc673086de8e50d4ed1ddc92a62';
const originalOrigins='https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud';
const must=(v,c)=>{if(!v)throw Error('BUYER_COMPATIBILITY_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const prepared=new WeakMap();
export function buyerCompatibilityData(capability,at){
  const d=prepared.get(capability);must(d,'SOURCE_CAPABILITY_REQUIRED');recoveryData(d.basis,at);return d;
}
// Preserve the old four self-reference rules; the two explicit buyer context
// references below are the only additional derived fields, never free inputs.
export async function bindBuyerWorkflowSource(source,sourceCommit,reusableCommit){
  must(source?.publication?.schema==='techlong/buyer-context-publication/v1'&&source.publication.protocol==='platform-v6/buyer-context'&&
    source.publication.buyerContextSha256===null&&source.buyer?.schema==='techlong/buyer-context-selection/v1'&&
    source.buyer.source?.code?.commitSha===null,'WORKFLOW_SOURCE_TEMPLATE');
  const bound=structuredClone(await bindWorkflowSource(source,sourceCommit,reusableCommit));
  bound.buyer.source.code.commitSha=sourceCommit;
  bound.publication.buyerContextSha256=await sha256Hex(bound.buyer.source);return freeze(bound);
}
export async function prepareBuyerFromSource(source,bundle,{now=Date.now}={}){
  must(source?.buyer?.schema==='techlong/buyer-context-selection/v1'&&source.publication?.schema==='techlong/buyer-context-publication/v1'&&
    source.publication.protocol==='platform-v6/buyer-context'&&await sha256Hex(bundle)===source.publication.packageReference?.sha256,'SELECTED_BUNDLE');
  const basis=await rebuildRecoveryPackage(bundle.originalPackage,recoveryBasisCompiler(source.buyer.originalProfile));
  must(basis.basisSha256===source.publication.basisSha256&&source.buyer.source.code.commitSha===source.publication.sourceCommit&&
    await sha256Hex(source.buyer.source)===source.publication.buyerContextSha256,'SELECTED_SOURCE_BINDING');
  const compat=await prepareBuyerCompatibility({source:source.buyer.source,basis,capsule:bundle.capsule,links:bundle.links,now});
  await rebuildBuyerBundle(compat,bundle);return compat;
}

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
  const result=Object.freeze({context,prepareRequest,openRoot,source:s,runtimeEnabled:false,executionAuthorized:false});
  prepared.set(result,Object.freeze({basis,target:d.target,context,source:s,now}));return result;
}

// Source-pinned public bundle only. Rebuild the genuine historical basis rather
// than deserializing a capability, and keep the current terminal baseline apart
// from the historical recovery state. Neither fact window is extended.
export async function rebuildBuyerBundle(compat,bundle){
  const d=buyerCompatibilityData(compat,compatibilityNow(compat)),s=d.source;
  must(bundle?.schema==='techlong/buyer-context-bundle/v1'&&
    same(Object.keys(bundle).sort(),['baseline','capsule','links','originalPackage','schema']),'BUNDLE_FIELDS');
  const basis=await rebuildRecoveryPackage(bundle.originalPackage,recoveryBasisCompiler(d.target));
  must(same(basis,d.basis),'BUNDLE_HISTORICAL_BASIS');
  const rebuilt=await prepareBuyerCompatibility({source:s,basis,capsule:bundle.capsule,links:bundle.links,now:d.now});
  const baseline=normalizedState(bundle.baseline);await rebuilt.prepareRequest(baseline);
  must(same(rebuilt.context.predecessor,d.context.predecessor),'BUNDLE_ACCEPTED_CONTEXT');
  return {basis,baseline,compat:rebuilt};
}
function compatibilityNow(c){const d=prepared.get(c);must(d,'SOURCE_CAPABILITY_REQUIRED');return d.now();}

/** Native evidence adapter for the already verified buyer context. Reuses the
 * V5 manifest reconstruction, installed binding, V6 run/plan/ref contracts and
 * original owner queries. This owns no connection, dispatch or cloud executor. */
export function createBuyerPublisher({compat,publication,ports,now=Date.now}){
  const d=buyerCompatibilityData(compat,now()),p=freeze(structuredClone(publication)),job=d.source.request.jobId;
  const prefix=`worker-v5/${S.appInstanceId}/`,cache=new Map();
  async function gate(){
    buyerCompatibilityData(compat,now());
    must(p.schema==='techlong/buyer-context-publication/v1'&&p.protocol==='platform-v6/buyer-context'&&p.state==='PUBLISHED'&&
      releaseReady(p.release)&&p.sourceCommit===d.source.code.commitSha&&p.release.closureSha256===d.source.code.closureSha256&&
      /^[a-f0-9]{40}$/.test(p.frozenSourceCommit??'')&&p.basisSha256===d.basis.basisSha256&&
      p.release.installationSha256===CLOUD_V6.installationSha256,'PUBLISHER_BINDING');
    await ports.guard();
  }
  async function read(ref){
    assertReferenceV6(ref,ref.key);must(ref.key.startsWith(prefix),'PUBLISHER_REFERENCE');const key=canonicalJson(ref);
    if(!cache.has(key)){
      must(cache.size<6,'PUBLISHER_OBJECT_BUDGET');const o=await ports.readObject(ref);
      must(o?.versionId===ref.versionId&&o.encryption==='AES256'&&Number.isSafeInteger(o.contentLength)&&
        o.contentLength>0&&o.contentLength<=1000000&&await sha256Hex(o.value)===ref.sha256,'PUBLISHER_OBJECT');
      assertEvidenceSafeV5(o.value);cache.set(key,freeze(structuredClone(o.value)));
    }return cache.get(key);
  }
  const publish=async plan=>{await gate();const v=await validatePlan(plan,p.release,now());await gate();await ports.writeOwner(ownerQueryV6('plan',v));return {...v,executionApproved:false};};
  async function verified(sha,reference){
    await gate();const entry=await ports.loadPlan(sha),v=await validatePlan(entry.plan,p.release,entry.plan.preparedAt),plan=entry.plan,a=entry.attempt;
    must(v.planSha256===sha&&entry.actionSha256===v.actionSha256&&plan.jobId===job&&plan.sourceCommit===p.sourceCommit&&
      plan.inputs.lineage===''&&a?.state==='OBSERVED'&&a.status==='completed'&&a.conclusion==='success','PUBLISHER_LEDGER');
    const run=exactRunV6(await ports.readRun(a.runId),{runId:a.runId,sourceCommit:p.sourceCommit,workflowId:p.release.workflowId,reusableCommit:p.release.reusableCommit});
    await rebuildBuyerBundle(compat,await read(p.packageReference));
    const result=await read(reference);
    must(same(Object.keys(result).sort(),['schema','mode','jobId','run','frozenSourceCommit','closureSha256','identityProofSha256',
      'installationSha256','requestSha256','manifestSha256','outcome','cloudReportReference','executionReference','retryAllowed'].sort())&&
      result.schema==='techlong/platform-cloud-result/v6'&&result.jobId===job&&result.mode===plan.mode&&same(result.run,run)&&
      result.frozenSourceCommit===p.frozenSourceCommit&&result.closureSha256===p.release.closureSha256&&
      result.identityProofSha256===p.release.identityProofSha256&&result.installationSha256===CLOUD_V6.installationSha256&&
      result.requestSha256===await sha256Hex(plan.inputs)&&result.retryAllowed===false,'PUBLISHER_RESULT');
    assertReferenceV6(reference,resultKeyV6(job,result.manifestSha256,run.runId));
    const manifestReference=plan.mode==='Review'?result.cloudReportReference:JSON.parse(plan.inputs.manifest);
    assertReferenceV6(manifestReference,evidenceKeyV5('manifest.json',{jobId:job,manifestSha256:result.manifestSha256}));
    const manifest=await read(manifestReference),contract=await loadNeonContractV5(),ir=JSON.parse(plan.inputs.installation);
    assertReferenceV6(ir,`${prefix}installation/${CLOUD_V6.installationSha256}.json`);
    const installation=await assertInstallationV5(await read(ir),CLOUD_V6.installationSha256,contract);
    must(manifest.jobPlan?.jobId===job&&manifest.jobPlan.requestId===d.source.request.requestId&&
      manifest.manifestSha256===result.manifestSha256&&(plan.mode==='Review'||plan.inputs.manifestSha===manifest.manifestSha256),'PUBLISHER_MANIFEST');
    await assertCloudManifestV5(manifest,{context:d.context,contract,installation,code:d.source.code});
    let report=null;
    if(plan.mode==='Review')must(result.outcome==='REVIEW_PREPARED_NOT_APPROVED'&&result.executionReference===null,'PUBLISHER_REVIEW');
    else{
      assertReferenceV6(result.cloudReportReference,evidenceKeyV5(plan.mode==='RunOnce'?'run.json':'inspect.json',{jobId:job,manifestSha256:manifest.manifestSha256,run}));
      report=await read(result.cloudReportReference);
      must(report.jobId===job&&report.manifestSha256===manifest.manifestSha256&&same(report.run,run)&&report.retryAllowed===false&&
        (report.outcome??report.result?.outcome)===result.outcome,'PUBLISHER_REPORT');
      if(plan.mode==='RunOnce'){
        must(report.schema==='techlong/cloud-worker-run/v5'&&result.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'&&
          report.journal?.state==='ALL_SLOTS_CONSUMED'&&digest(report.result.receiptSha256),'PUBLISHER_EXECUTION');
        assertReferenceV6(result.executionReference,`${prefix}${job}/${manifest.manifestSha256}/execution-reference-${run.runId}-v1.json`);
        must(same(await read(result.executionReference),{executionRun:run,executionReportReference:result.cloudReportReference}),'PUBLISHER_DESCRIPTOR');
      }else{
        const {inspectSha256,...body}=report;
        must(report.schema==='techlong/cloud-worker-independent-inspect/v5'&&report.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED'&&
          report.executionRun?.runId===plan.predecessor.runId&&report.executionRun.runId!==run.runId&&report.executionRun.commitSha===p.sourceCommit&&
          report.journal?.state==='ALL_SLOTS_CONSUMED'&&digest(report.receiptSha256)&&digest(report.providerObservationSha256)&&
          await sha256Hex(body)===inspectSha256&&report.cloudWrites===0&&report.databaseWrites===0&&report.privateControlReads===0&&
          Number.isSafeInteger(report.checkedAt)&&report.checkedAt<=now()+30000&&report.checkedAt<manifest.workload.workloadExpiresAt&&
          result.executionReference===null,'PUBLISHER_INDEPENDENT_INSPECT');
      }
    }
    const body={schema:'techlong/platform-cloud-attestation/v6',planSha256:sha,run,mode:plan.mode,jobId:job,
      resultReference:reference,manifestReference,reportReference:result.cloudReportReference,outcome:result.outcome};
    return {entry,result,manifest,report,attestation:{...body,proofSha256:await sha256Hex(body)}};
  }
  return Object.freeze({
    async publishReview({installationReference}){
      await gate();const at=now();await rebuildBuyerBundle(compat,await read(p.packageReference));
      assertReferenceV6(installationReference,`${prefix}installation/${CLOUD_V6.installationSha256}.json`);
      await assertInstallationV5(await read(installationReference),CLOUD_V6.installationSha256,await loadNeonContractV5());
      await admitPlatformJobV4({root:d.context.root,predecessor:d.context.predecessor,observed:await ports.readHeldJob(job),now:now()});
      return publish({schema:'techlong/platform-controller-plan/v6',instanceId:S.appInstanceId,deploymentId:S.deploymentId,
        jobId:job,mode:'Review',sourceCommit:p.sourceCommit,releaseSha256:await sha256Hex(p.release),riskSha256:p.release.riskSha256,
        preparedAt:at,expiresAt:Math.min(at+7200000,d.basis.expiresAt),predecessor:null,
        inputs:{mode:'Review',job,installation:canonicalJson(installationReference),manifest:'',manifestSha:'',execution:'',lineage:''}});
    },
    async attestResult(sha,ref){const v=await verified(sha,ref);must(v.entry.attempt.proofSha256===null,'PUBLISHER_PROOF_OCCUPIED');
      await gate();await ports.writeOwner(ownerQueryV6('proof',v.attestation));return v.attestation;},
    async publishSuccessor(sha,ref){
      const v=await verified(sha,ref);must(v.entry.attempt.proofSha256===v.attestation.proofSha256&&v.entry.plan.mode!=='Inspect','PUBLISHER_PARENT');
      const plan=structuredClone(v.entry.plan),at=now();plan.mode=plan.mode==='Review'?'RunOnce':'Inspect';plan.inputs.mode=plan.mode;
      plan.preparedAt=at;plan.expiresAt=Math.min(at+7200000,d.basis.expiresAt,v.manifest.workload.workloadExpiresAt);
      plan.predecessor={planSha256:sha,runId:v.entry.attempt.runId,proofSha256:v.attestation.proofSha256};
      plan.inputs.manifest=canonicalJson(v.attestation.manifestReference);plan.inputs.manifestSha=v.manifest.manifestSha256;
      if(plan.mode==='RunOnce'){assertRunWindowV3(v.manifest,at);plan.expiresAt=Math.min(plan.expiresAt,v.manifest.jobPlan.claimBy-480000,v.manifest.workload.workloadExpiresAt-90*60000);}
      else{plan.inputs.execution=canonicalJson(v.result.executionReference);must(plan.expiresAt>at+10*60000,'PUBLISHER_INSPECT_RESERVE');}
      must(plan.expiresAt>at+60000,'PUBLISHER_SUCCESSOR_WINDOW');return publish(plan);
    },
  });
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

// Concrete ports for the EXISTING root; no executor, credential discovery or
// private I/O during construction. A serialized context cannot select them.
export async function createBuyerApplication({compat,installation:raw,code,run,credentials,now=Date.now}){
  const d=buyerCompatibilityData(compat,now());
  must(same(code,d.source.code)&&run.commitSha===code.commitSha,'SDK_CODE_BINDING');
  const contract=await loadNeonContractV5(),installation=await assertInstallationV5(raw,CLOUD_V6.installationSha256,contract),
    session=createCloudSessionV5({credentials,expected:{...run,roleId:installation.roleId},now}),cfg=session.clientConfig(),
    sm=new SecretsManagerClient({...cfg,endpoint:'https://secretsmanager.ca-central-1.amazonaws.com'}),
    provider=createCloudInitializedAwsV5(d.context.base,session),evidence=createCloudEvidenceV5(session);
  let opened=false;
  const dispose=()=>{provider.dispose();evidence.dispose();sm.destroy();};
  const secretRead=(ref,signal)=>sm.send(new GetSecretValueCommand({SecretId:ref.arn,VersionId:ref.versionId,VersionStage:'AWSCURRENT'}),
    {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  try{return Object.freeze({...await compat.openRoot({installation,contract,code,run,provider,evidence,
    async openDatabase(signal){
      must(!opened,'DATABASE_SECRET_ONCE');opened=true;const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
      try{session.assertIdentity(await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal}));}finally{sts.destroy();}
      const ref=installation.databaseSecret,r=await secretRead(ref,signal);
      must(r.ARN===ref.arn&&r.VersionId===ref.versionId&&r.Name==='techlong/sandbox/deployment-worker/neon-control-v1'&&
        r.VersionStages?.length===1&&r.VersionStages[0]==='AWSCURRENT'&&!r.SecretBinary&&typeof r.SecretString==='string'&&
        Buffer.byteLength(r.SecretString)<=12000,'DATABASE_SECRET_FIXED_VERSION');
      const url=await validateDatabaseMaterialV5(JSON.parse(r.SecretString),installation.neon.endpointSha256);
      return createNarrowNeonV5({transport:createNeonRpcTransportV5(url),contract,expected:installation.neon});
    },
    loadControl:({beforeRead,signal})=>createFixedControlSecretLoaderV5({reference:installation.controlSecret,
      expected:d.context.controlFingerprints,getSecretValue:input=>secretRead({arn:input.SecretId,versionId:input.VersionId},signal),beforeRead}).loadOnce(signal),
    openJournal:(binding,signal)=>openDynamoCloudWorkerJournalV1({binding,tableId:installation.tableId,signal,credentials:cfg.credentials}),dispose}),dispose});
  }catch(e){dispose();throw e;}
}

// Common native publication guard for both production bootstrap and preparation.
// Receipt values must already be source-bound; this function invents none.
export async function assertBuyerPublicationSource(source,at,{anchor}={}){
  const cycle=await createReviewedCycle(source,{anchor}),p=source.publication,b=source.buyer,s=b?.source,a=p?.factsApproval,
    end=Math.min(b?.originalProfile?.factsAt+b?.originalProfile?.validMs,cycle.profile.factsAt+cycle.profile.validMs);
  must(b?.schema==='techlong/buyer-context-selection/v1'&&s?.schema==='techlong/buyer-compatibility-source/v1'&&
    p?.schema==='techlong/buyer-context-publication/v1'&&p.protocol==='platform-v6/buyer-context'&&p.state==='PUBLISHED'&&
    p.riskFile===RISK&&p.cycleId===cycle.cycleId&&releaseReady(p.release)&&/^[a-f0-9]{40}$/.test(p.frozenSourceCommit??'')&&
    p.release.installationSha256===CLOUD_V6.installationSha256&&p.profileSha256===await sha256Hex(cycle.profile)&&
    p.basisSha256===s.basisSha256&&digest(p.basisSha256)&&p.sourceCommit===s.code?.commitSha&&
    p.release.closureSha256===s.code?.closureSha256&&await sha256Hex(s)===p.buyerContextSha256&&
    s.request?.jobId===cycle.profile.newJobId&&s.request.requestId===cycle.profile.requestId&&
    s.request.clientRequestId===cycle.profile.clientRequestId&&s.baselineSha256===cycle.profile.stateSha256,'LIVE_SOURCE');
  assertReferenceV6(p.packageReference,`worker-v5/${S.appInstanceId}/lineage/buyer-context-v1-${p.packageReference?.sha256}.json`);
  must(a?.state==='APPROVED'&&digest(a.manifestSha256)&&a.profileSha256===p.profileSha256&&
    a.factsAt===cycle.profile.factsAt&&a.databaseCheckedAt===cycle.profile.databaseCheckedAt&&a.observedBy===cycle.profile.observedBy&&
    a.expiresAt===end&&a.originalBasisExtended===false&&Number.isSafeInteger(at)&&at>=a.observedBy&&at<end,'LIVE_FACTS');
  must(p.activation?.schema==='techlong/buyer-context-activation/v1'&&p.activation.state==='PUBLISHED'&&
    p.activation.protocol===p.protocol&&p.activation.sourceCommit===p.sourceCommit&&p.activation.frozenSourceCommit===p.frozenSourceCommit&&
    p.activation.releaseSha256===await sha256Hex(p.release),'LIVE_ACTIVATION');return cycle;
}
async function buyerJson(body,limit){
  must(body,'LIVE_BODY');const reader=body.getReader(),chunks=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;
    if(size>limit){await reader.cancel();must(false,'LIVE_SIZE');}chunks.push(r.value);}}finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
}
export async function runBuyerLive(env,closure,{source=BUYER_SOURCE,anchor}={}){
  must(source,'SOURCE_NOT_CONFIGURED');
  const bound=await bindBuyerWorkflowSource(source,env.GITHUB_SHA,env.TECHLONG_REUSABLE_COMMIT),at=Date.now();
  await assertBuyerPublicationSource(bound,at,{anchor});const p=bound.publication,b=releaseFromWorkflowV6(env),run=validateCloudRunV6(env,b,closure);
  must(closure.schema==='techlong/buyer-compatibility-closure/v1'&&closure.pinCount===111&&closure.closureSha256===p.release.closureSha256&&
    same(b,{state:p.release.state,sourceCommit:p.frozenSourceCommit,reusableCommit:p.release.reusableCommit,
      closureSha256:p.release.closureSha256,identityProofSha256:p.release.identityProofSha256,actorId:p.release.actorId,
      installationSha256:p.release.installationSha256})&&run.commitSha===p.sourceCommit,'LIVE_RELEASE');
  const input=externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage']
    .map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
  must(input.job===bound.profile.newJobId&&input.lineage==='','LIVE_INPUT');
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.actions.githubusercontent.com')&&!endpoint.username&&!endpoint.password&&
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string'&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0,'LIVE_OIDC_ENDPOINT');
  endpoint.searchParams.set('audience','sts.amazonaws.com');
  const response=await fetch(endpoint,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  must(response.status===200,'LIVE_OIDC_RESPONSE');const oidc=await buyerJson(response.body,20000);
  must(typeof oidc.value==='string'&&oidc.value.length<15000&&oidc.value.split('.').length===3,'LIVE_OIDC_TOKEN');
  validateOidcClaimsV6(JSON.parse(Buffer.from(oidc.value.split('.')[1],'base64url').toString('utf8')),env,b,Date.now());
  const cfg={region:CLOUD_V6.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true},sts=new STSClient(cfg);let authSts,s3;
  try{
    const r=await sts.send(new AssumeRoleWithWebIdentityCommand({RoleArn:CLOUD_V6.roleArn,RoleSessionName:`Deploy-${run.runId}-1`,
      WebIdentityToken:oidc.value,DurationSeconds:3600}),{abortSignal:AbortSignal.timeout(30000)}),v=r.Credentials;
    must(v?.AccessKeyId&&v.SecretAccessKey&&v.SessionToken&&v.Expiration?.getTime()>Date.now()+60000,'LIVE_TEMPORARY_CREDENTIALS');
    const credentials={accessKeyId:v.AccessKeyId,secretAccessKey:v.SecretAccessKey,sessionToken:v.SessionToken,expiration:v.Expiration};
    authSts=new STSClient({...cfg,credentials});const who=await authSts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(who.Account===EVIDENCE_V5.owner&&who.UserId===CLOUD_V6.roleId+`:Deploy-${run.runId}-1`&&
      who.Arn===`arn:aws:sts::${EVIDENCE_V5.owner}:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${run.runId}-1`,'LIVE_ROLE_ID');
    s3=new S3Client({...cfg,credentials});const signal=AbortSignal.timeout(3600000),allowed=new Set([p.packageReference,
      ...['installation','manifest','execution'].filter(k=>input[k]).map(k=>JSON.parse(input[k]))].map(canonicalJson));let reads=0,puts=0;
    const read=async ref=>{
      await assertBuyerPublicationSource(bound,Date.now(),{anchor});must(++reads<=4&&allowed.has(canonicalJson(ref)),'LIVE_READ_SCOPE');
      const r=await s3.send(new GetObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:ref.key,VersionId:ref.versionId}),
        {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(r.VersionId===ref.versionId&&r.ServerSideEncryption==='AES256'&&r.ContentLength>0&&r.ContentLength<=1000000,'LIVE_OBJECT_METADATA');
      const value=await buyerJson(r.Body.transformToWebStream(),1000000);assertEvidenceSafeV5(value);must(await sha256Hex(value)===ref.sha256,'LIVE_OBJECT_SHA');return value;
    };
    const bundle=await read(p.packageReference),compat=await prepareBuyerFromSource(bound,bundle);
    const ports={signal,read,open:options=>createBuyerApplication({...options,compat,credentials:async()=>credentials}),
      async writeResult(key,value){return put(key,value);},async writeExecution(key,value){return put(key,value);}};
    async function put(key,value){
      await assertBuyerPublicationSource(bound,Date.now(),{anchor});
      const manifestSha=value.manifestSha256??input.manifestSha,valid=key===resultKeyV6(input.job,manifestSha,run.runId)||
        input.mode==='RunOnce'&&key===`worker-v5/${S.appInstanceId}/${input.job}/${input.manifestSha}/execution-reference-${run.runId}-v1.json`;
      must(valid&&++puts<=2,'LIVE_PUT_SCOPE');assertEvidenceSafeV5(value);const Body=canonicalJson(value),sha=await sha256Hex(value);
      must(Buffer.byteLength(Body)<=1000000,'LIVE_PUT_SIZE');
      const r=await s3.send(new PutObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:key,Body,IfNoneMatch:'*',
        ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(sha,'hex').toString('base64')}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(r.VersionId&&r.ServerSideEncryption==='AES256','LIVE_PUT_ACK');return {key,versionId:r.VersionId,sha256:sha};
    }
    return await runPlatformCloudV6({env,binding:b,closure,ports});
  }finally{authSts?.destroy();s3?.destroy();sts.destroy();}
}
