// Exact SOURCE and text/CFN proposals only. No network or credential discovery.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {CLOUD_V6 as C} from '../platform-cloud-v6/contract.mjs';
import {FROZEN_V6} from '../platform-activation-v6/publication.mjs';
import {U,validatePublicationSourceV6,reconcilePublicationLayoutV6} from '../platform-publication-v6/plan.mjs';
import {hash,INLINE_SHA,BOUNDARY_SHA} from '../platform-recovery-publication-v1/plan.mjs';
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';
import {createPublicationObjects} from '../platform-a604-publication-v1/objects.mjs';
import {PROFILE,T} from './upload-plan.mjs';
import {createReviewedCycle,bindWorkflowSource,assertPublication,RISK} from './cycle.mjs';
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
import {buyerCompatibilityData,rebuildBuyerBundle,prepareBuyerFromSource,bindBuyerWorkflowSource,assertBuyerPublicationSource,buyerCompatibilityClosure} from './buyer-compatibility.mjs';
import {createCycleComposition} from './composition.mjs';
export {hash};
export const must=(v,c)=>{if(!v)throw Error('CYCLE_PUBLICATION_'+c);},same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const sha=v=>/^[a-f0-9]{40}$/.test(v??''),digest=v=>/^[a-f0-9]{64}$/.test(v??'');
export const F=freeze({...FROZEN_V6,sourceCommit:'0e18a25e15af64010187c9870be3cfa6433aa5de',closureSha256:T.closureSha256});
export const OPERATOR_BEFORE="// Local operator binding only; never part of the frozen cloud closure.\nexport const SELECTED_CYCLE=null;\n";
const prefix='F:/ChatGPT_workshop/techlong-reviewed-cycle-'+T.jobId;
export const Q=freeze({...U,slot:prefix+'-source-publication.intent.json',inspectSlot:prefix+'-source-publication-inspect.intent.json',
  validMs:24*3600000,snapshotMaxAgeMs:5*3600000,bindingFile:'ops/platform-reviewed-cycle-v1/operator-source.mjs',bindingBeforeSha256:hash(OPERATOR_BEFORE),
  templateBeforeSha256:'5bee8aacbb2cce98e69807f9b21da7f0d033abd41c0cd9b0a146494185bc5c75',
  oldReusable:'e658f7b88ab50b4ff3c5653d46866b859fbadfe1',riskFile:'docs/aws-auto-deployment-reviewed-cycle-source-publication.md',
  packageProof:'F:/ChatGPT_workshop/techlong-reviewed-cycle-package-executed-verified-20261028-a.json',
  packageProofRawSha256:'044bae2e914647b6b479c35f5be6c33345eb8d5aef96cabaf50aa3372bc14706',awsMetadataMax:180,githubGetsMax:160});
export const REFERENCE=freeze({key:`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-${T.basisSha256}.json`,
  versionId:'PCD4J0_Ydp1lpa1BzFeKhDbNIEiUK1HC',sha256:T.packageSha256});
export const FACTS=freeze({state:'APPROVED',manifestSha256:'ce3a497b88eaebe1da1200ee242b81cadb73749aac9ac7fd63c5c7774120eb1d',
  profileSha256:T.profileSha256,factsAt:PROFILE.factsAt,databaseCheckedAt:PROFILE.databaseCheckedAt,observedBy:PROFILE.observedBy,
  expiresAt:T.basisExpiresAt,originalBasisExtended:false});
export function sourceTemplate(){return freeze({schema:'techlong/reviewed-cycle-source/v1',profile:PROFILE,
  historicalJobIds:['job_202c8dc12a8bf379f3a7c693','job_6a1129afcebfc9fb580517c9','job_6e2e115c80301595512f11fb','job_9b57b43a6b88f37202b29170',
    'job_9db8466fd95cef0c23ad6bfc','job_a60423b885fef3e4326213f7','job_c6cb047ac3ff30ed51ba9f34','job_e4147af2f10faf37b51ec9a3',
    'job_ecbf09030d3da7286ea3ef93','job_fc0309dabebc09367f64153f','job_fe5ced28b698d0bf128e7b42'],historicalPlanCount:14,
  historySha256:'b97a4e7de0c10e2f0902826d4d36ffe1a92e240b4ce02e3dc6ffd2bfa5fc3d91',
  requestEvidence:{schema:'techlong/reviewed-cycle-request-evidence/v1',jobId:T.jobId,requestId:PROFILE.requestId,
    transactionAt:PROFILE.factsAt,independentObservedAt:PROFILE.databaseCheckedAt,
    afterSha256:'c4d28f90e792b935c4fd3f3b99f80775410d481e0bb15e72f4804cf2da0bea52',
    sealRawSha256:'c5b365acc3d812b7102f282a6cc3302aa42fb3e67a3a75d8cf538f594cf954bf'},
  publication:{schema:'techlong/reviewed-cycle-publication/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',riskFile:RISK,cycleId:T.cycleId,
    sourceCommit:null,frozenSourceCommit:F.sourceCommit,release:{state:'PUBLISHED',workflowId:'390829326',actorId:'344813947',reusableCommit:null,
      closureSha256:F.closureSha256,identityProofSha256:F.identityProofSha256,installationSha256:C.installationSha256,
      riskSha256:'28045e69d2ceeed1b3f6fd3da5be3ffc174d19bb0792fa4d4272a31d1ed4f805'},
    basisSha256:T.basisSha256,packageReference:REFERENCE,profileSha256:T.profileSha256,factsApproval:FACTS,
    activation:{schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',sourceCommit:null,
      frozenSourceCommit:F.sourceCommit,releaseSha256:null}}});}
export function texts(reusable){must(sha(reusable),'REUSABLE');const old=recoveryCloudWorkflows({...F,reusableCommit:reusable}),
  needle='      - run: node --experimental-strip-types ops/platform-recovery-cloud-v1/run.mjs';must(old.reusable.split(needle).length===2,'WORKFLOW_SHAPE');
  const code=["import {pathToFileURL} from 'node:url';","const load = rel => import(pathToFileURL(process.cwd()+'/'+rel).href);",
    "const {cycleCloudClosure} = await load('ops/platform-reviewed-cycle-v1/closure.mjs');",
    "const {runCycleLive} = await load('ops/platform-reviewed-cycle-v1/live.mjs');",'const source = '+JSON.stringify(sourceTemplate())+';',
    "try { console.log(JSON.stringify(await runCycleLive(process.env,await cycleCloudClosure(),{source}))); }",
    "catch { console.error('REVIEWED_CYCLE_CLOUD_STOPPED_NO_RETRY'); process.exitCode=1; }"];
  const bootstrap="      - run: |\n          node --experimental-strip-types --input-type=module <<'REVIEWED_CYCLE_BOOTSTRAP'\n"+
    code.map(line=>'          '+line).join('\n')+'\n          REVIEWED_CYCLE_BOOTSTRAP';
  return {...old,reusable:old.reusable.replace(needle,bootstrap),published:false};
}
export function bindingText(original,reusable){must(original===OPERATOR_BEFORE&&sha(reusable),'BINDING_SOURCE');
  return original.replace('export const SELECTED_CYCLE=null;','export const SELECTED_CYCLE=Object.freeze('+JSON.stringify({...sourceTemplate(),reusableCommit:reusable})+');');}
export function trustTemplate(template,reusable){must(sha(reusable)&&hash(template)===Q.templateBeforeSha256,'ORIGINAL_TEMPLATE');
  const next=structuredClone(template),claim='token.actions.githubusercontent.com:job_workflow_ref',eq=next.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals,
    before='veinyyxy/TechlongSoftware/'+Q.reusable+'@'+Q.oldReusable,after='veinyyxy/TechlongSoftware/'+Q.reusable+'@'+reusable;
  must(eq[claim]===before,'OLD_TRUST');eq[claim]=after;const restored=structuredClone(next);
  restored.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim]=before;must(same(restored,template),'TRUST_ONLY');
  return {template:next,changes:[{claim:'job_workflow_ref',before,after}]};}
export function validateLayout(p){validatePublicationSourceV6(p);
  must(hash(p.foundation.template)===Q.templateBeforeSha256&&same(p.iam.trust,p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument)&&
    hash(p.iam.inline[0].document)===INLINE_SHA&&p.iam.boundary.policyId==='ANPAV3GNMXTZK24FGAXCF'&&p.iam.boundary.defaultVersion==='v1'&&
    p.iam.boundary.documentSha256===BOUNDARY_SHA&&hash(p.iam.boundary.document)===BOUNDARY_SHA,'FIXED_LAYOUT');return p;}
export function validateObjects(parent,objects,original){must(sha(parent)&&objects?.reusable?.parent===parent&&objects.caller?.parent===objects.reusable.commit&&
  objects.reusable.file===Q.reusable&&objects.caller.file===Q.caller&&objects.caller.operatorBinding?.file===Q.bindingFile,'OBJECT_CHAIN');
  const rendered=texts(objects.reusable.commit);for(const [o,t] of [[objects.reusable,rendered.reusable],[objects.caller,rendered.caller],
    [objects.caller.operatorBinding,bindingText(original,objects.reusable.commit)]])must(sha(o.blob)&&digest(o.normalizedLfSha256)&&hash(t)===o.normalizedLfSha256,'OBJECT_CONTENT');
  for(const o of [objects.reusable,objects.caller])must(sha(o.commit)&&sha(o.tree),'GIT_IDENTITIES');return rendered;}
export const {previousTargets,verifyObjects,prepareObjects}=createPublicationObjects({Q,F,must,same,hash,texts,bindingText,validateObjects});
export async function makeReview({parent,objects,previousTargets,operatorScopeSource,pins,ci,baseline,observedAt,createdAt}){
  validateLayout(baseline);validateObjects(parent,objects,operatorScopeSource);
  must(baseline.main===parent&&Number.isSafeInteger(observedAt)&&observedAt>=FACTS.observedBy&&Number.isSafeInteger(createdAt)&&createdAt>=observedAt&&
    createdAt-observedAt<Q.snapshotMaxAgeMs&&createdAt<FACTS.expiresAt&&pins?.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>digest(p.sha256))&&
    ci?.sourceCommit===parent&&ci.testedSourceCommit===parent&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    same(previousTargets?.map(p=>p.file),[Q.reusable,Q.caller,Q.bindingFile])&&previousTargets.every(p=>sha(p.blob)&&digest(p.normalizedLfSha256))&&
    previousTargets[2].normalizedLfSha256===Q.bindingBeforeSha256,'REVIEW_INPUT');
  const source=await bindWorkflowSource(sourceTemplate(),objects.caller.commit,objects.reusable.commit),cycle=await createReviewedCycle(source);
  await assertPublication(cycle,source.publication,createdAt);const changed=trustTemplate(baseline.foundation.template,objects.reusable.commit),
    create={StackName:F.stackId,ChangeSetName:'cycle-publication-'+objects.caller.commit.slice(0,24),ChangeSetType:'UPDATE',TemplateBody:canonicalJson(changed.template),
      Capabilities:['CAPABILITY_NAMED_IAM'],Description:'Reviewed cycle pinned reusable trust only; '+objects.reusable.commit};
  must(Buffer.byteLength(create.TemplateBody)<=51200,'TEMPLATE_SIZE');create.ClientToken='cycle-publication-create-'+hash(create).slice(0,40);
  const body={schema:'techlong/reviewed-cycle-source-publication-review/v1',parent,objects,previousTargets,operatorScopeSource,pins,ci,baseline,observedAt,createdAt,
    expiresAt:Math.min(observedAt+Q.validMs,FACTS.expiresAt),frozen:F,publication:source.publication,source,
    packageProof:{file:Q.packageProof,rawSha256:Q.packageProofRawSha256},permanentSlot:Q.slot,inspectSlot:Q.inspectSlot,riskFile:Q.riskFile,
    actions:{push:{remote:'github',refspec:objects.caller.commit+':refs/heads/main',force:false},create,
      execute:{StackName:F.stackId,ChangeSetName:'EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,ClientRequestToken:'cycle-publication-execute-'+hash(create).slice(0,40)},
      trustChanges:changed.changes,localFastForward:objects.caller.commit},
    effects:{gitPushAttempts:1,existingWorkflowUpdates:2,localOperatorSourceBindingUpdates:1,newWorkflowFiles:0,createChangeSetAttempts:1,executeChangeSetAttempts:1,
      existingWorkerTrustUpdates:1,localMainFastForwards:1,independentInspectAttempts:1,iamPermissionExpansion:0,newIamResources:0,environmentWrites:0,
      secretValueReads:0,pemReads:0,dispatches:0,sqlConnections:0,packageUploads:0,hostingRenewals:0,workloadCreates:0,automaticWriteRetries:0},
    limits:{awsMetadata:Q.awsMetadataMax,githubGets:Q.githubGetsMax,independentAwsMetadata:13,independentGithubGets:17,executionMs:1200000,snapshotPreparationMaxAgeMs:Q.snapshotMaxAgeMs},
    risks:{crossServiceNonAtomic:true,concurrentChangesNotCas:true,disableFailureRollback:true,oldWorkflowPinLosesRoleAccess:true,
      sourceBindingPublishedBeforeTrustMayRemain:true,partialPublishedWorkflowsOrTrustMayRemain:true,sourceLoginMayExpire:true,
      noAutomaticRollbackDeleteOrReplay:true,permanentSlotsNeverReset:true,lowCostNotZero:true},preparationIsNotExecutionApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateApproval(m,approved,at,inspect=false,start=false){must(same(m,await makeReview(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&at>=m.createdAt&&at<m.expiresAt&&(!start||at<m.expiresAt-1200000),'APPROVAL_OR_TOO_LATE');}
export function validatePreflight(p,m){validateLayout(p);must(same(p,m.baseline),'FRESH_BASELINE_DRIFT');}
export function reconcile(p,m,state,before){validatePreflight(before,m);return reconcilePublicationLayoutV6(p,{...m,prestate:before},state);}

// CODE-selected only; a future reviewed source binds real request/upload proofs.
// Null is checked before configuration, credential or readiness I/O.
export const BUYER_PUBLICATION_SOURCE=null;
export async function createBuyerPublication({compat,bundle,source,requestSnapshot,baseline,operatorScopeSource,now=Date.now}){
  const d=buyerCompatibilityData(compat,now()),rebuilt=await rebuildBuyerBundle(compat,bundle);
  await assertBuyerPublicationSource(source,now(),{anchor:d.target});
  must(same(source.buyer?.source,d.source)&&same(source.buyer.originalProfile,d.target),'BUYER_GENUINE_SOURCE');
  const composition=await createCycleComposition(source,{buyer:compat,buyerBundle:bundle,now,anchor:d.target});
  await composition.capability.verifyRequestReadback(rebuilt.authority,requestSnapshot,source.requestEvidence.transactionAt);
  must(typeof operatorScopeSource==='string'&&operatorScopeSource.startsWith('// Local operator binding only;')&&
    operatorScopeSource.includes('export const SELECTED_CYCLE=Object.freeze('),'BUYER_BEFORE_BINDING');
  validatePublicationSourceV6(baseline);
  const old=baseline.foundation.template,eq=old.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals,
    oldPin=eq['token.actions.githubusercontent.com:job_workflow_ref'],needle='veinyyxy/TechlongSoftware/'+Q.reusable+'@';
  must(oldPin.startsWith(needle)&&sha(oldPin.slice(needle.length))&&same(baseline.iam.trust,old.Resources.WorkerRole.Properties.AssumeRolePolicyDocument),
    'BUYER_BEFORE_TRUST');
  const closure=await buyerCompatibilityClosure();must(closure.closureSha256===d.source.code.closureSha256,'BUYER_CLOSURE');
  const frozen=freeze({...F,sourceCommit:source.publication.frozenSourceCommit,closureSha256:closure.closureSha256}),
    scope=freeze({...Q,slot:'F:/ChatGPT_workshop/techlong-reviewed-cycle-'+d.source.request.jobId+'-source-publication.intent.json',
      inspectSlot:'F:/ChatGPT_workshop/techlong-reviewed-cycle-'+d.source.request.jobId+'-source-publication-inspect.intent.json',
      bindingBeforeSha256:hash(operatorScopeSource),templateBeforeSha256:hash(old),oldReusable:oldPin.slice(needle.length)}),
    before=freeze(structuredClone(baseline)),original=operatorScopeSource,template=structuredClone(source);
  template.publication.sourceCommit=null;template.publication.release.reusableCommit=null;template.publication.activation.sourceCommit=null;
  template.publication.activation.releaseSha256=null;template.publication.buyerContextSha256=null;template.buyer.source.code.commitSha=null;
  // The cloud obtains the same bundle by fixed S3 version, never a local path.
  const cloudTemplate=structuredClone(template);delete cloudTemplate.buyer.bundleFile;
  const layout=p=>{validatePublicationSourceV6(p);must(hash(p.foundation.template)===scope.templateBeforeSha256&&
    hash(p.iam.inline[0].document)===INLINE_SHA&&p.iam.boundary.policyId==='ANPAV3GNMXTZK24FGAXCF'&&
    p.iam.boundary.defaultVersion==='v1'&&p.iam.boundary.documentSha256===BOUNDARY_SHA&&hash(p.iam.boundary.document)===BOUNDARY_SHA&&
    same(p.iam,before.iam)&&same(p.foundation.resources,before.foundation.resources),'BUYER_FIXED_LAYOUT');return p;};
  layout(before);
  const render=reusable=>{
    must(sha(reusable),'BUYER_REUSABLE');const old=cloudWorkflowsV6({...frozen,reusableCommit:reusable}),
      needle='      - run: node --experimental-strip-types ops/platform-cloud-v6/run.mjs';
    must(old.reusable.split(needle).length===2,'BUYER_BOOTSTRAP_SHAPE');
    const code=["import {pathToFileURL} from 'node:url';","const load=rel=>import(pathToFileURL(process.cwd()+'/'+rel).href);",
      "const {runBuyerLive,buyerCompatibilityClosure}=await load('ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs');",
      'const source='+JSON.stringify(cloudTemplate)+';',
      "try { console.log(JSON.stringify(await runBuyerLive(process.env,await buyerCompatibilityClosure(),{source}))); }",
      "catch { console.error('BUYER_CLOUD_STOPPED_NO_RETRY'); process.exitCode=1; }"];
    const bootstrap="      - run: |\n          node --experimental-strip-types --input-type=module <<'BUYER_BOOTSTRAP'\n"+
      code.map(s=>'          '+s).join('\n')+'\n          BUYER_BOOTSTRAP';
    const text=old.reusable.replace(needle,bootstrap);must(!/[EF]:\//.test(text),'BUYER_CLOUD_LOCAL_PATH');
    return {...old,reusable:text,published:false};
  };
  const binding=(text,reusable)=>{must(text===original&&sha(reusable),'BUYER_OLD_BINDING');
    return '// Local operator binding only; never part of the frozen cloud closure.\nexport const SELECTED_CYCLE=Object.freeze('+
      JSON.stringify({...template,reusableCommit:reusable})+');\n';};
  const objects=(parent,o,text)=>{
    must(sha(parent)&&o?.reusable?.parent===parent&&o.caller?.parent===o.reusable.commit&&o.reusable.file===scope.reusable&&
      o.caller.file===scope.caller&&o.caller.operatorBinding?.file===scope.bindingFile,'BUYER_OBJECT_CHAIN');
    const w=render(o.reusable.commit);
    for(const [x,t] of [[o.reusable,w.reusable],[o.caller,w.caller],[o.caller.operatorBinding,binding(text,o.reusable.commit)]])
      must(sha(x.blob)&&digest(x.normalizedLfSha256)&&hash(t)===x.normalizedLfSha256,'BUYER_OBJECT_BYTES');
    for(const x of [o.reusable,o.caller])must(sha(x.commit)&&sha(x.tree),'BUYER_OBJECT_IDS');return w;
  };
  const gitObjects=createPublicationObjects({Q:scope,F:frozen,must,same,hash,texts:render,bindingText:binding,validateObjects:objects});
  async function review(input){
    const {parent,objects:o,previousTargets:targets,operatorScopeSource:text,pins,ci,baseline:state,observedAt,createdAt}=input;
    layout(state);objects(parent,o,text);
    must(same(state,before)&&state.main===parent&&parent===source.publication.sourceCommit&&frozen.sourceCommit===parent&&
      Number.isSafeInteger(observedAt)&&Number.isSafeInteger(createdAt)&&createdAt>=observedAt&&createdAt-observedAt<scope.snapshotMaxAgeMs&&
      createdAt>=source.profile.observedBy&&createdAt<d.authorityExpiresAt&&pins?.length>=20&&pins.every(p=>digest(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length&&
      ci?.sourceCommit===parent&&ci.testedSourceCommit===parent&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
      same(targets?.map(x=>x.file),[scope.reusable,scope.caller,scope.bindingFile])&&targets.every(x=>sha(x.blob)&&digest(x.normalizedLfSha256))&&
      targets[2].normalizedLfSha256===scope.bindingBeforeSha256,'BUYER_REVIEW_INPUT');
    const bound=await bindBuyerWorkflowSource(template,o.caller.commit,o.reusable.commit),buyer=await prepareBuyerFromSource(bound,bundle,{now:()=>createdAt});
    await createCycleComposition(bound,{buyer,buyerBundle:bundle,now:()=>createdAt,anchor:d.target});
    const next=structuredClone(old);next.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[
      'token.actions.githubusercontent.com:job_workflow_ref']=needle+o.reusable.commit;
    const restored=structuredClone(next);restored.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[
      'token.actions.githubusercontent.com:job_workflow_ref']=oldPin;must(same(restored,old),'BUYER_TRUST_ONLY');
    const create={StackName:frozen.stackId,ChangeSetName:'buyer-publication-'+o.caller.commit.slice(0,24),ChangeSetType:'UPDATE',
      TemplateBody:canonicalJson(next),Capabilities:['CAPABILITY_NAMED_IAM'],Description:'Reviewed buyer source and exact reusable trust pin only'};
    must(Buffer.byteLength(create.TemplateBody)<=51200,'BUYER_TEMPLATE_SIZE');create.ClientToken='buyer-publication-create-'+hash(create).slice(0,40);
    const body={schema:'techlong/buyer-source-publication-review/v1',...input,frozen,source:bound,publication:bound.publication,
      permanentSlot:scope.slot,inspectSlot:scope.inspectSlot,riskFile:scope.riskFile,
      expiresAt:Math.min(observedAt+scope.validMs,d.authorityExpiresAt,bound.publication.factsApproval.expiresAt),
      actions:{push:{remote:'github',refspec:o.caller.commit+':refs/heads/main',force:false},create,
        execute:{StackName:frozen.stackId,ChangeSetName:'EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,
          ClientRequestToken:'buyer-publication-execute-'+hash(create).slice(0,40)},
        trustChanges:[{claim:'job_workflow_ref',before:oldPin,after:needle+o.reusable.commit}],localFastForward:o.caller.commit},
      effects:{gitPushAttempts:1,existingWorkflowUpdates:2,localOperatorSourceBindingUpdates:1,newWorkflowFiles:0,createChangeSetAttempts:1,
        executeChangeSetAttempts:1,existingWorkerTrustUpdates:1,localMainFastForwards:1,independentInspectAttempts:1,iamPermissionExpansion:0,
        newIamResources:0,environmentWrites:0,secretValueReads:0,pemReads:0,dispatches:0,sqlConnections:0,packageUploads:0,hostingRenewals:0,
        workloadCreates:0,automaticWriteRetries:0},limits:{awsMetadata:scope.awsMetadataMax,githubGets:scope.githubGetsMax,
        independentAwsMetadata:13,independentGithubGets:17,executionMs:1200000,snapshotPreparationMaxAgeMs:scope.snapshotMaxAgeMs},
      risks:{crossServiceNonAtomic:true,concurrentChangesNotCas:true,disableFailureRollback:true,oldWorkflowPinLosesRoleAccess:true,
        sourceBindingPublishedBeforeTrustMayRemain:true,partialPublishedWorkflowsOrTrustMayRemain:true,sourceLoginMayExpire:true,
        noAutomaticRollbackDeleteOrReplay:true,permanentSlotsNeverReset:true,lowCostNotZero:true},preparationIsNotExecutionApproval:true};
    return {...body,manifestSha256:await sha256Hex(body)};
  }
  const approve=async(m,sha,at,inspect=false,start=false)=>{must(same(m,await review(Object.fromEntries(Object.entries(m).filter(([k])=>
    ['parent','objects','previousTargets','operatorScopeSource','pins','ci','baseline','observedAt','createdAt'].includes(k))))),'BUYER_MANIFEST_CHANGED');
    if(!inspect)must(sha===m.manifestSha256&&at>=m.createdAt&&at<m.expiresAt&&(!start||at<m.expiresAt-1200000),'BUYER_APPROVAL_OR_TOO_LATE');};
  const preflight=(p,m)=>{layout(p);must(same(p,m.baseline),'BUYER_FRESH_BASELINE_DRIFT');};
  return Object.freeze({Q:scope,F:frozen,closure:buyerCompatibilityClosure,closureCount:111,sourceTemplate:()=>freeze(structuredClone(template)),
    texts:render,bindingText:binding,validateLayout:layout,validateObjects:objects,...gitObjects,makeReview:review,validateApproval:approve,
    validatePreflight:preflight,reconcile:(p,m,state,prior)=>{preflight(prior,m);return reconcilePublicationLayoutV6(p,{...m,prestate:prior},state);}});
}
