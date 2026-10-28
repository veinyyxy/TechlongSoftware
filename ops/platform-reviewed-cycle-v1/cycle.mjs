// One sandbox composition, not a per-job executor or an external profile API.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {releaseReady,commit,digest} from '../../lib/deployments/controller-v6/contract.ts';
import {CLOUD_V6 as C,assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
import {RECOVERY_SCOPE} from '../platform-recovery-v1/profile.mjs';
import {recoveryPackageKey} from '../platform-recovery-v1/package.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
export const RISK='docs/aws-auto-deployment-reviewed-cycle-v1.md';
export const must=(v,c)=>{if(!v)throw Error('REVIEWED_CYCLE_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const capabilities=new WeakSet(),job=v=>/^job_[a-f0-9]{24}$/.test(v??'');
// Historical success/retirement/accepted-lineage anchors remain the original
// compiler's. Only a reviewed request and REAL newly observed baseline vary.
const variable=new Set(['newJobId','clientRequestId','requestId','stateSha256','factsAt','databaseCheckedAt','observedBy','requestSlot']);
export async function createReviewedCycle(source,{anchor=RECOVERY_SCOPE}={}){
  must(source?.schema==='techlong/reviewed-cycle-source/v1','SOURCE_NOT_CONFIGURED');
  const s=freeze(structuredClone(source)),p=s.profile,e=s.requestEvidence;
  must(same(Object.keys(p??{}).sort(),Object.keys(anchor).sort())&&Object.keys(anchor).every(k=>variable.has(k)||same(p[k],anchor[k])),'HISTORICAL_ANCHORS');
  must(job(p.newJobId)&&p.newJobId!==p.oldJobId&&!['job_a60423b885fef3e4326213f7','job_9b57b43a6b88f37202b29170',
    'job_9db8466fd95cef0c23ad6bfc','job_6a1129afcebfc9fb580517c9','job_6e2e115c80301595512f11fb'].includes(p.newJobId)&&digest(p.requestId)&&digest(p.stateSha256)&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.clientRequestId)&&p.validMs===48*3600000&&
    [p.factsAt,p.databaseCheckedAt,p.observedBy].every(Number.isSafeInteger)&&p.factsAt<=p.databaseCheckedAt&&p.databaseCheckedAt<=p.observedBy,'PROFILE');
  must(e?.schema==='techlong/reviewed-cycle-request-evidence/v1'&&e.jobId===p.newJobId&&e.requestId===p.requestId&&
    Number.isSafeInteger(e.transactionAt)&&Number.isSafeInteger(e.independentObservedAt)&&e.transactionAt>=p.factsAt&&e.independentObservedAt>=e.transactionAt&&
    e.independentObservedAt<=p.observedBy&&digest(e.afterSha256)&&digest(e.sealRawSha256),'REAL_REQUEST_EVIDENCE');
  must(Array.isArray(s.historicalJobIds)&&s.historicalJobIds.length>=4&&s.historicalJobIds.length<=19&&
    s.historicalJobIds.every(job)&&new Set(s.historicalJobIds).size===s.historicalJobIds.length&&!s.historicalJobIds.includes(p.newJobId)&&
    s.historicalJobIds.includes(p.oldJobId)&&Number.isSafeInteger(s.historicalPlanCount)&&s.historicalPlanCount>=1&&s.historicalPlanCount<=50&&
    digest(s.historySha256),'HISTORY_SCOPE');
  const cycleId=await sha256Hex({profile:p,requestEvidence:e,historicalJobIds:s.historicalJobIds,
    historicalPlanCount:s.historicalPlanCount,historySha256:s.historySha256});
  // Stable per-cycle slots, independent of grant SHA, output path or retries.
  // Facts/source/publication changes cannot give the SAME job fresh slots.
  const root='techlong-reviewed-cycle-'+p.newJobId;
  const slots=freeze({whole:root+'-whole.intent.json',continuous:root+'-continuous.intent.json',publish:root+'-publish.intent.json',
    inspectPublish:root+'-inspect-publish.intent.json',Review:root+'-Review.intent.json',RunOnce:root+'-RunOnce.intent.json',Inspect:root+'-Inspect.intent.json'});
  const c=freeze({source:s,profile:p,requestEvidence:e,cycleId,slots,riskFile:RISK});capabilities.add(c);return c;
}
export function assertCycle(c){must(capabilities.has(c),'SOURCE_CAPABILITY_REQUIRED');return c;}
export async function bindWorkflowSource(source,sourceCommit,reusableCommit){
  const s=structuredClone(source),p=s?.publication;
  must(p?.state==='PUBLISHED'&&p.sourceCommit===null&&p.release?.reusableCommit===null&&p.activation?.sourceCommit===null&&
    p.activation.releaseSha256===null&&commit(sourceCommit)&&commit(reusableCommit),'WORKFLOW_SOURCE_TEMPLATE');
  p.sourceCommit=sourceCommit;p.release.reusableCommit=reusableCommit;p.activation.sourceCommit=sourceCommit;
  p.activation.releaseSha256=await sha256Hex(p.release);return freeze(s);
}
export async function assertPublication(c,p,at){
  assertCycle(c);const profile=c.profile,a=p?.factsApproval;
  must(p?.schema==='techlong/reviewed-cycle-publication/v1'&&p.state==='PUBLISHED'&&p.cycleId===c.cycleId&&
    p.protocol==='recovery-envelope/v1'&&p.riskFile===RISK&&commit(p.sourceCommit)&&commit(p.frozenSourceCommit)&&releaseReady(p.release)&&
    p.release.installationSha256===C.installationSha256&&p.profileSha256===await sha256Hex(profile)&&digest(p.basisSha256),'PUBLICATION');
  assertReferenceV6(p.packageReference,recoveryPackageKey(p.basisSha256));
  must(a?.state==='APPROVED'&&digest(a.manifestSha256)&&a.profileSha256===p.profileSha256&&a.factsAt===profile.factsAt&&
    a.databaseCheckedAt===profile.databaseCheckedAt&&a.observedBy===profile.observedBy&&a.expiresAt===profile.factsAt+profile.validMs&&
    a.originalBasisExtended===false&&Number.isSafeInteger(at)&&at>=profile.observedBy&&at<a.expiresAt,'FACTS_APPROVAL_OR_EXPIRED');
  must(p.activation?.schema==='techlong/recovery-bridge-activation/v1'&&p.activation.state==='PUBLISHED'&&
    p.activation.protocol===p.protocol&&p.activation.sourceCommit===p.sourceCommit&&p.activation.frozenSourceCommit===p.frozenSourceCommit&&
    p.activation.releaseSha256===await sha256Hex(p.release),'ACTIVATION');return p;
}
export function assertScope(c,plan,p){assertCycle(c);must(plan?.jobId===c.profile.newJobId&&plan.sourceCommit===p.sourceCommit&&
  plan.riskSha256===p.release.riskSha256&&plan.inputs.lineage===canonicalJson(p.packageReference),'PLAN_SCOPE');}
