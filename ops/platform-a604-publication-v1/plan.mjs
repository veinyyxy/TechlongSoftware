// Fixed publication SOURCE capability. Only local candidates are produced here.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {A604_PROFILE,A604_RISK} from '../platform-a604-cloud-v1/profile.mjs';
import {bindA604WorkflowPublication,assertA604Publication} from '../platform-a604-cloud-v1/contract.mjs';
import {a604CloudWorkflows} from '../platform-a604-cloud-v1/workflows.mjs';
import {CLOUD_V6 as C} from '../platform-cloud-v6/contract.mjs';
import {FROZEN_V6} from '../platform-activation-v6/publication.mjs';
import {U,validatePublicationSourceV6,reconcilePublicationLayoutV6} from '../platform-publication-v6/plan.mjs';
import {hash,INLINE_SHA,BOUNDARY_SHA} from '../platform-recovery-publication-v1/plan.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
export {hash};
export const must=(v,c)=>{if(!v)throw Error('A604_PUBLICATION_'+c);},same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const sha=v=>/^[a-f0-9]{40}$/.test(v??''),digest=v=>/^[a-f0-9]{64}$/.test(v??'');
export const F=freeze({...FROZEN_V6,sourceCommit:'72a29559f914768a8df57c8e3e6b4ed940697e54',
  closureSha256:'f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269'});
export const Q=freeze({...U,slot:'F:/ChatGPT_workshop/techlong-a604-publication-v1.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-a604-publication-v1.inspect.intent.json',validMs:24*3600000,
  bindingFile:'ops/platform-a604-operator-v1/scope.mjs',bindingBeforeSha256:'1fdc462565f35137204d3785fe3720c94092cdb22a4659e5edd48a4560a5631f',
  templateBeforeSha256:'9129228d16f91bf6eac6b24e6c2ad4aba6d50161a04fdf91a857d0fb9ab4fc96',
  oldReusable:'4c09548ab9852a4f3e948f0686f8c81251cda73b',riskFile:'docs/aws-auto-deployment-a604-workflow-publication-review.md',
  packageProof:'F:/ChatGPT_workshop/techlong-a604-package-executed-verified-20261027-a.json',
  packageProofRawSha256:'fa960d1bc00b990dd63985063b980f1a277f3773dd49cce844453076fafd055f',awsMetadataMax:180,githubGetsMax:160});
export const REFERENCE=freeze({key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40.json',
  versionId:'WKWNfTsDXkQ5lZuqQRIG7YZw.4PERCEt',sha256:'03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e'});
export const FACTS=freeze({state:'APPROVED',manifestSha256:'af800cdbe26b61f96a8454522a8c0e94f215aa72b0834c22bc83101fbf79ebce',
  profileSha256:'cfebd33eaf335e16801d0836efcf2f02b06b62eac4134ffed62d4e8c9e5202b7',factsAt:1793109984483,
  databaseCheckedAt:1793109995619,observedBy:1793109995619,expiresAt:1793282784483,originalBasisExtended:false});
export function publicationTemplate(){return freeze({schema:'techlong/a604-protocol-publication/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',
  sourceCommit:null,frozenSourceCommit:F.sourceCommit,release:{state:'PUBLISHED',workflowId:'390829326',actorId:'344813947',reusableCommit:null,
    closureSha256:F.closureSha256,identityProofSha256:F.identityProofSha256,installationSha256:C.installationSha256,
    riskSha256:'e017491cc8e8ae88d914f7a82371196fc996f0874c5ca9549b0e1215c7131849'},
  basisSha256:'61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40',packageReference:REFERENCE,
  profileSha256:FACTS.profileSha256,factsApproval:FACTS,activation:{schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',
    protocol:'recovery-envelope/v1',sourceCommit:null,frozenSourceCommit:F.sourceCommit,releaseSha256:null},riskFile:A604_RISK});}
export function texts(reusable){must(sha(reusable),'REUSABLE');return a604CloudWorkflows({...F,reusableCommit:reusable},{publication:publicationTemplate()});}
export function bindingText(original,reusable){must(hash(original)===Q.bindingBeforeSha256&&sha(reusable),'BINDING_SOURCE');
  const line="export const LOCAL_PUBLICATION=freeze({state:'UNPUBLISHED',template:A604_PUBLICATION,reusableCommit:null});";
  must(original.split(line).length===2,'BINDING_SHAPE');return original.replace(line,'export const LOCAL_PUBLICATION=freeze('+JSON.stringify({state:'PUBLISHED',template:publicationTemplate(),reusableCommit:reusable})+');')
    .replace('A604_JOB,A604_PROFILE,A604_PUBLICATION','A604_JOB,A604_PROFILE');}
export function trustTemplate(template,reusable){must(sha(reusable)&&hash(template)===Q.templateBeforeSha256,'ORIGINAL_TEMPLATE');
  const next=structuredClone(template),key='token.actions.githubusercontent.com:job_workflow_ref',eq=next.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
  const before='veinyyxy/TechlongSoftware/'+Q.reusable+'@'+Q.oldReusable;must(eq[key]===before,'OLD_TRUST');const after='veinyyxy/TechlongSoftware/'+Q.reusable+'@'+reusable;eq[key]=after;
  const restored=structuredClone(next);restored.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[key]=before;
  must(same(restored,template),'TRUST_ONLY');return {template:next,changes:[{claim:'job_workflow_ref',before,after}]};}
export function validateLayout(p){validatePublicationSourceV6(p);
  must(hash(p.foundation.template)===Q.templateBeforeSha256&&same(p.iam.trust,p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument)&&
    hash(p.iam.inline[0].document)===INLINE_SHA&&p.iam.boundary.policyId==='ANPAV3GNMXTZK24FGAXCF'&&p.iam.boundary.defaultVersion==='v1'&&
    p.iam.boundary.documentSha256===BOUNDARY_SHA&&hash(p.iam.boundary.document)===BOUNDARY_SHA,'FIXED_LAYOUT');
  trustTemplate(p.foundation.template,F.sourceCommit);return p;
}
export function validateObjects(parent,objects,original){must(sha(parent)&&objects?.reusable?.parent===parent&&objects.caller?.parent===objects.reusable.commit&&
  objects.reusable.file===Q.reusable&&objects.caller.file===Q.caller&&objects.caller.operatorBinding?.file===Q.bindingFile,'OBJECT_CHAIN');
  const rendered=texts(objects.reusable.commit);for(const [o,t] of [[objects.reusable,rendered.reusable],[objects.caller,rendered.caller],[objects.caller.operatorBinding,bindingText(original,objects.reusable.commit)]])
    must(sha(o.blob)&&digest(o.normalizedLfSha256)&&o.normalizedLfSha256===hash(t),'OBJECT_CONTENT');
  for(const o of [objects.reusable,objects.caller])must(sha(o.commit)&&sha(o.tree),'GIT_IDENTITIES');return rendered;}
export async function makeReview({parent,objects,previousTargets,operatorScopeSource,pins,ci,baseline,observedAt,createdAt}){
  validateLayout(baseline);validateObjects(parent,objects,operatorScopeSource);
  must(baseline.main===parent&&Number.isSafeInteger(observedAt)&&observedAt>=FACTS.observedBy&&Number.isSafeInteger(createdAt)&&createdAt>=observedAt&&
    createdAt<Math.min(observedAt+Q.validMs,FACTS.expiresAt)&&pins?.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>digest(p.sha256))&&
    ci?.sourceCommit===parent&&ci.testedSourceCommit===parent&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    same(previousTargets?.map(p=>p.file),[Q.reusable,Q.caller,Q.bindingFile])&&previousTargets.every(p=>sha(p.blob)&&digest(p.normalizedLfSha256))&&
    previousTargets[2].normalizedLfSha256===Q.bindingBeforeSha256,'REVIEW_INPUT');
  const p=await bindA604WorkflowPublication(publicationTemplate(),objects.caller.commit,objects.reusable.commit);await assertA604Publication(p,A604_PROFILE,createdAt);
  const changed=trustTemplate(baseline.foundation.template,objects.reusable.commit),create={StackName:F.stackId,ChangeSetName:'a604-publication-v1-'+objects.caller.commit.slice(0,24),
    ChangeSetType:'UPDATE',TemplateBody:canonicalJson(changed.template),Capabilities:['CAPABILITY_NAMED_IAM'],Description:'A604 pinned reusable trust only; '+objects.reusable.commit};
  must(Buffer.byteLength(create.TemplateBody)<=51200,'TEMPLATE_SIZE');create.ClientToken='a604-publication-create-'+hash(create).slice(0,40);
  const body={schema:'techlong/a604-workflow-publication-review/v1',parent,objects,previousTargets,operatorScopeSource,pins,ci,baseline,observedAt,createdAt,
    expiresAt:Math.min(observedAt+Q.validMs,FACTS.expiresAt),frozen:F,publication:p,packageProof:{file:Q.packageProof,rawSha256:Q.packageProofRawSha256},
    permanentSlot:Q.slot,inspectSlot:Q.inspectSlot,riskFile:Q.riskFile,
    actions:{push:{remote:'github',refspec:objects.caller.commit+':refs/heads/main',force:false},create,
      execute:{StackName:F.stackId,ChangeSetName:'EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true,ClientRequestToken:'a604-publication-execute-'+hash(create).slice(0,40)},
      trustChanges:changed.changes,localFastForward:objects.caller.commit},
    effects:{gitPushAttempts:1,existingWorkflowUpdates:2,localOperatorSourceBindingUpdates:1,newWorkflowFiles:0,createChangeSetAttempts:1,executeChangeSetAttempts:1,
      existingWorkerTrustUpdates:1,localMainFastForwards:1,independentInspectAttempts:1,iamPermissionExpansion:0,newIamResources:0,environmentWrites:0,
      secretValueReads:0,pemReads:0,dispatches:0,sqlConnections:0,packageUploads:0,hostingRenewals:0,workloadCreates:0,automaticWriteRetries:0},
    limits:{awsMetadata:Q.awsMetadataMax,githubGets:Q.githubGetsMax,independentAwsMetadata:13,independentGithubGets:17,executionMs:1200000},
    risks:{crossServiceNonAtomic:true,concurrentChangesNotCas:true,disableFailureRollback:true,oldWorkflowPinLosesRoleAccess:true,
      sourceBindingPublishedBeforeTrustMayRemain:true,partialPublishedWorkflowsOrTrustMayRemain:true,sourceLoginMayExpire:true,
      noAutomaticRollbackDeleteOrReplay:true,permanentSlotsNeverReset:true,lowCostNotZero:true},preparationIsNotExecutionApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function validateApproval(m,approved,at,inspect=false,start=false){must(same(m,await makeReview(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&at>=m.createdAt&&at<m.expiresAt&&(!start||at<m.expiresAt-1200000),'APPROVAL_OR_TOO_LATE');}
export function validatePreflight(actual,m){validateLayout(actual);must(same(actual,m.baseline),'FRESH_BASELINE_DRIFT');}
export function reconcile(actual,m,state,prestate){validatePreflight(prestate,m);return reconcilePublicationLayoutV6(actual,{...m,prestate},state);}
