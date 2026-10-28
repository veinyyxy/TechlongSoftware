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
