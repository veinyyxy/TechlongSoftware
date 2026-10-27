// Explicit source capability only. Never construct publication from env/JSON.
import {releaseReady,commit,digest} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertReferenceV6,CLOUD_V6 as C} from '../platform-cloud-v6/contract.mjs';
import {recoveryPackageKey} from '../platform-recovery-v1/package.mjs';
import {A604_JOB,A604_RISK} from './profile.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
export const must=(v,c)=>{if(!v)throw Error('A604_PROTOCOL_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
// A reviewed reusable embeds the descriptor as SOURCE, not an input/env JSON.
// Its own future SHA and caller main cannot be embedded in that same tree.
// Only these four self-reference slots may be derived; OIDC+STS subsequently
// verify the actual caller/source and reusable pin before private operations.
export async function bindA604WorkflowPublication(template,sourceCommit,reusableCommit){
  must(template?.state==='PUBLISHED'&&template.sourceCommit===null&&template.release?.reusableCommit===null&&
    template.activation?.sourceCommit===null&&template.activation.releaseSha256===null&&commit(sourceCommit)&&commit(reusableCommit),'WORKFLOW_PUBLICATION_TEMPLATE');
  const p=structuredClone(template);p.sourceCommit=sourceCommit;p.release.reusableCommit=reusableCommit;
  p.activation.sourceCommit=sourceCommit;p.activation.releaseSha256=await sha256Hex(p.release);return freeze(p);
}
export async function assertA604Publication(p,profile,at){
  must(p?.schema==='techlong/a604-protocol-publication/v1'&&p.state==='PUBLISHED','NOT_PUBLISHED');
  must(profile?.newJobId===A604_JOB&&profile.oldJobId!==A604_JOB&&profile.validMs===48*3600000&&
    p.protocol==='recovery-envelope/v1'&&commit(p.sourceCommit)&&commit(p.frozenSourceCommit)&&releaseReady(p.release)&&
    p.release.installationSha256===C.installationSha256&&p.riskFile===A604_RISK&&digest(p.basisSha256)&&
    p.profileSha256===await sha256Hex(profile),'PUBLICATION_BINDING');
  assertReferenceV6(p.packageReference,recoveryPackageKey(p.basisSha256));
  const a=p.factsApproval;
  must(a?.state==='APPROVED'&&digest(a.manifestSha256)&&a.profileSha256===p.profileSha256&&
    a.factsAt===profile.factsAt&&a.databaseCheckedAt===profile.databaseCheckedAt&&a.observedBy===profile.observedBy&&
    a.expiresAt===profile.factsAt+profile.validMs&&a.originalBasisExtended===false&&
    Number.isSafeInteger(at)&&at>=profile.observedBy&&at<a.expiresAt,'NEW_FACTS_WINDOW_NOT_APPROVED_OR_EXPIRED');
  must(p.activation?.schema==='techlong/recovery-bridge-activation/v1'&&p.activation.state==='PUBLISHED'&&
    p.activation.protocol===p.protocol&&p.activation.sourceCommit===p.sourceCommit&&p.activation.frozenSourceCommit===p.frozenSourceCommit&&
    p.activation.releaseSha256===await sha256Hex(p.release),'ACTIVATION');return p;
}
export function assertA604PlanScope(plan,p){
  must(plan?.jobId===A604_JOB&&plan.sourceCommit===p.sourceCommit&&plan.riskSha256===p.release.riskSha256&&
    plan.inputs.lineage===canonicalJson(p.packageReference),'PLAN_SCOPE');
}
