// One source descriptor publication. No runtime provisioning, keys or dispatch.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {createHash} from 'node:crypto';
import {validatePublicationSourceV6} from '../platform-publication-v6/plan.mjs';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
import {assertRecoveryPublication,RECOVERY_RISK} from '../platform-recovery-control-v1/binding.mjs';
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_BINDING_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const hash=v=>createHash('sha256').update(typeof v==='string'||v instanceof Uint8Array?v:canonicalJson(v)).digest('hex');
export const M=Object.freeze({target:'ops/platform-recovery-control-v1/binding.mjs',beforeSha256:'7834879ce920e0fad53185460e21f29dab7c9b45a52061f6e77d584b1a2b1110',
  slot:'F:/ChatGPT_workshop/techlong-w9m-recovery-binding.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-w9m-recovery-binding.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-w9m-recovery-binding-review.md',runtimeRiskFile:RECOVERY_RISK,
  runtimeRiskSha256:'09eab6e5c56119faed3c3f7eb3f952ad99a7a9d6b08f535b6e5e9280f4dc115b',
  runtimeSource:'0494b2be7b0f559ac991533137dfb1b0388ac7a9',reusableCommit:'4c09548ab9852a4f3e948f0686f8c81251cda73b',
  closureSha256:'30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374',
  packageReference:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0.json',
    versionId:'Zz5fH5Javs900ZrmMrgi3QhBzFbCNkPm',sha256:'07d9d9475033b35cc6a38597946c40a8389ccd4409c177122878590e94975ce7'},
  basisSha256:'c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0',basisExpiresAt:1793126877695,validMs:24*3600000,
  publicationProof:'F:/ChatGPT_workshop/techlong-w9k-publication-completed-verified-20261025-a.json',
  publicationProofSha256:'97eae297a9093e832b13fda14f6de317b4d5e6ca4a1c118a55b65036c1199ed1',
  packageProof:'F:/ChatGPT_workshop/techlong-w9l-package-completed-verified-20261026-a.json',
  packageProofSha256:'f76f8c27ea1e7a12a69a652678c6d56dbbbdd945879f7b3653be56a1509dc365',
  layoutFile:'F:/ChatGPT_workshop/techlong-w9k-recovery-publication-inspect-20261025-a/independent-layout.json',
  layoutRawSha256:'e1be8963ddbec57187a26610a8c5b483d393a41618a2d7407200503f520c6ef0'});
const START='export const RECOVERY_CONTROL_BINDING=Object.freeze(',END=');\nfunction commonReady';
export async function recoveryBindingCandidate(parent){
  must(/^[a-f0-9]{40}$/.test(parent),'PARENT');
  const release={state:'PUBLISHED',workflowId:'390829326',actorId:S.candidateBotId,reusableCommit:M.reusableCommit,
    closureSha256:M.closureSha256,identityProofSha256:'1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca',
    installationSha256:C.installationSha256,riskSha256:M.runtimeRiskSha256};
  const b={schema:'techlong/recovery-control-binding/v1',state:'PUBLISHED',protocol:'recovery-envelope/v1',sourceCommit:null,
    frozenSourceCommit:M.runtimeSource,release,activation:{schema:'techlong/recovery-bridge-activation/v1',state:'PUBLISHED',
      protocol:'recovery-envelope/v1',sourceCommit:null,frozenSourceCommit:M.runtimeSource,releaseSha256:await sha256Hex(release)},
    controllerCodeCommit:parent,basisSha256:M.basisSha256,packageReference:M.packageReference,riskFile:M.runtimeRiskFile};
  await assertRecoveryPublication(b);return b;
}
export async function renderRecoveryBinding(before,parent){
  must(hash(before)===M.beforeSha256&&before.split(START).length===2&&before.split(END).length===2,'EXACT_BEFORE_SOURCE');
  const a=before.indexOf(START)+START.length,b=before.indexOf(END,a),candidate=await recoveryBindingCandidate(parent);
  return before.slice(0,a)+JSON.stringify(candidate,null,2)+before.slice(b);
}
export function validateBindingBaseline(layout){
  validatePublicationSourceV6(layout);
  must(hash(layout.foundation.template)==='9129228d16f91bf6eac6b24e6c2ad4aba6d50161a04fdf91a857d0fb9ab4fc96'&&
    layout.iam.trust.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']===
      S.repository+'/.github/workflows/cloud-worker-platform-job-v6.yml@'+M.reusableCommit&&
    hash(layout.iam.inline[0].document)==='ef09a5c638b600914cf0a29873a705432a5f96ffb9cdc20c6fa16aeaaa157bfd'&&
    layout.iam.boundary.documentSha256==='0551f01ec4398abd89e52997f3a63b35ba84f2b5e68a2d29df09dfc7065a91d6','PUBLISHED_BASELINE');
}
export function validateBindingLive(p,m,{published=false}={}){
  validateBindingBaseline(m.baseline);validateBindingBaseline(p.layout);
  const normalized=structuredClone(p.layout);must(normalized.main===(published?m.object.commit:m.parent),'LIVE_MAIN');normalized.main=m.baseline.main;
  must(same(normalized,m.baseline)&&p.bindingSha256===(published?m.object.sha256:M.beforeSha256),'NON_BINDING_LAYOUT_DRIFT');
  const texts=recoveryCloudWorkflows({...m.binding.release,sourceCommit:M.runtimeSource});
  must(p.workflows.length===2&&same(p.workflows.map(w=>({id:w.id,path:w.path,sha256:w.sha256})),[
    {id:'390829324',path:'.github/workflows/cloud-worker-platform-job-v6.yml',sha256:hash(texts.reusable)},
    {id:'390829326',path:'.github/workflows/cloud-worker-platform-v6.yml',sha256:hash(texts.caller)}]),'LIVE_WORKFLOWS');
}
export async function makeRecoveryBindingReview({parent,object,pins,ci,baseline,createdAt}){
  validateBindingBaseline(baseline);const binding=await recoveryBindingCandidate(parent);
  must(object?.parent===parent&&object.file===M.target&&['commit','tree','blob'].every(k=>/^[a-f0-9]{40}$/.test(object[k]))&&
    /^[a-f0-9]{64}$/.test(object.sha256)&&Number.isSafeInteger(createdAt)&&createdAt<M.basisExpiresAt&&
    ci?.sourceCommit===parent&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&pins.length>=15&&new Set(pins.map(v=>v.file)).size===pins.length&&
    pins.every(v=>/^[a-f0-9]{64}$/.test(v.sha256)),'REVIEW_INPUT');
  const body={schema:'techlong/recovery-binding-publication-review/v1',parent,object,pins,ci,baseline,binding,createdAt,
    expiresAt:Math.min(createdAt+M.validMs,M.basisExpiresAt),permanentSlot:M.slot,inspectSlot:M.inspectSlot,riskFile:M.riskFile,
    proofs:{publication:{file:M.publicationProof,rawSha256:M.publicationProofSha256},package:{file:M.packageProof,rawSha256:M.packageProofSha256},
      layout:{file:M.layoutFile,rawSha256:M.layoutRawSha256}},
    actions:{pushRefspec:object.commit+':refs/heads/main',force:false,localFastForward:object.commit},
    requiredPreflight:{freshCurrentStateNotYetObserved:true,maxMs:180000,main:parent,unmodifiedPublishedLayout:true,unexecutedCandidateBinding:true,
      awsMetadataPerInvocationMax:40,githubGetsPerInvocationMax:100},
    effects:{gitPushAttempts:1,changedBindingFiles:1,localFastForwards:1,independentReadOnlyInspect:1,awsWrites:0,sqlConnections:0,
      packageValueReads:0,secretValueReads:0,pemReads:0,appTokens:0,workflowDispatches:0,leaseWrites:0,serverStarts:0,deployments:0,automaticWriteRetries:0},
    risks:{persistentSourceCapabilityGate:true,matchingRuntimeLeaseStillRequired:true,sourcePublicationMayBeUsedByOtherEnvironments:true,
      crossServiceReadsNotCas:true,gitAndLocalMainNonAtomic:true,partialPublicationMayRemain:true,noAutomaticRollbackDeleteResetOrReplay:true,
      sourceLoginMayExpire:true,metadataMayContainAccountArnOrParameters:true,lowCostNotZero:true},
    runtimeRequirements:{separateFreshLeaseAndDeploymentApproval:true,maxLeaseMs:1800000,releaseAndSourceMustMatch:true,basisExpiresAt:M.basisExpiresAt},
    preparationIsNotApproval:true};return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyRecoveryBindingApproval(m,approved,now,inspect=false){
  must(same(m,await makeRecoveryBindingReview(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt-300000,'APPROVAL_OR_EXPIRED');
}
