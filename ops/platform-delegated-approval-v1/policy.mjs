// Local delegated Web approval only. GitHub environment approval stays human.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {validatePlan,CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {RECOVERY_CONTROL_BINDING as B,bindRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';
export const D=Object.freeze({schema:'techlong/delegated-platform-approval/v1',jobId:'job_9b57b43a6b88f37202b29170',
  admin:ADMIN,environment:'techlong-sandbox-deploy',basisExpiresAt:1793126877695,
  keyPath:'E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem',
  riskFile:'docs/aws-auto-deployment-delegated-web-approval-v1.md',runMs:120000,
  slotPrefix:'F:/ChatGPT_workshop/techlong-delegated-approval-v1-',modes:Object.freeze(['Review','RunOnce','Inspect'])});
export {S};
export const must=(v,c)=>{if(!v)throw Error('DELEGATED_APPROVAL_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const safeCode=e=>/^DELEGATED_APPROVAL_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD';
export function environmentProof(v){
  must(v?.name===D.environment&&Array.isArray(v.protection_rules)&&v.protection_rules.length<=6,'ENVIRONMENT');
  const r=v.protection_rules.filter(r=>r.type==='required_reviewers');
  must(r.length===1&&Array.isArray(r[0].reviewers)&&r[0].reviewers.some(x=>x.type==='User'&&String(x.reviewer?.id)===S.ownerId),'HUMAN_GITHUB_REVIEWER_REQUIRED');
  return {name:D.environment,protectionRules:v.protection_rules,canAdminsBypass:v.can_admins_bypass??null,
    deploymentBranchPolicy:v.deployment_branch_policy??null};
}
export function slot(mode){must(D.modes.includes(mode),'MODE');return D.slotPrefix+mode+'.intent.json';}
export const auditKey=(sha,mode)=>{must(digest(sha)&&D.modes.includes(mode),'AUDIT_KEY');
  return `worker-v5/${S.instanceId}/${D.jobId}/delegated-approval-v1/${sha}/${mode}.json`;};
const INSTALLATION=Object.freeze({key:`worker-v5/${S.instanceId}/installation/${B.release.installationSha256}.json`,
  sha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae',versionId:'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV'});
export async function seedPlan(sourceCommit,issuedAt){
  const binding=await bindRecoveryPublication(B,sourceCommit);
  return validatePlan({schema:'techlong/platform-controller-plan/v6',instanceId:S.instanceId,deploymentId:S.deploymentId,jobId:D.jobId,mode:'Review',sourceCommit,
    releaseSha256:await sha256Hex(binding.release),riskSha256:binding.release.riskSha256,preparedAt:issuedAt,
    expiresAt:Math.min(issuedAt+7200000,D.basisExpiresAt),inputs:{mode:'Review',job:D.jobId,installation:canonicalJson(INSTALLATION),
      manifest:'',manifestSha:'',execution:'',lineage:canonicalJson(B.packageReference)},predecessor:null},binding.release,issuedAt);
}
export function historyProof(rows,seedSha=null){
  must(Array.isArray(rows)&&rows.length<=12,'LEDGER_SNAPSHOT');
  const target=rows.filter(r=>r.jobId===D.jobId&&r.planSha256!==seedSha);
  must(target.length===1,'HISTORY_COUNT');const p=target[0];
  must(p.planSha256==='636676cb2faed296b492797942328486b4089962fa23cf5ceb36ca0cdc3b461e'&&
    p.actionSha256==='0e62672ee48026a5ee18939d6a8b3cfb25b2ed44ba18c9d8b02d3fff62ff36a5'&&
    p.riskSha256===B.release.riskSha256&&p.sourceCommit==='d098cfefd11c8839d5b00fee0701a71ed74aa73c'&&p.mode==='Review'&&
    ['AWAITING_APPROVAL','EXPIRED','UNSUBMITTED'].includes(p.state)&&p.runId===null&&Number.isSafeInteger(p.expiresAt),'OLD_REVIEW_NOT_UNSUBMITTED');
  return [{planSha256:p.planSha256,actionSha256:p.actionSha256,riskSha256:p.riskSha256,sourceCommit:p.sourceCommit,mode:p.mode,
    jobId:D.jobId,expiresAt:p.expiresAt,state:'UNSUBMITTED',runId:null}];
}
export async function grant({sourceCommit,pins,ci,seed,environment,history,key,auth,issuedAt}){
  const binding=await bindRecoveryPublication(B,sourceCommit),s=await validatePlan(seed.plan,binding.release,issuedAt);
  must(same(seed,s)&&same(seed,await seedPlan(sourceCommit,issuedAt))&&s.plan.mode==='Review'&&s.plan.jobId===D.jobId&&s.plan.sourceCommit===sourceCommit&&
    s.plan.inputs.lineage===canonicalJson(B.packageReference),'SEED');
  must(Array.isArray(pins)&&pins.length>=20&&pins.every(p=>typeof p.file==='string'&&digest(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length&&
    ci?.sourceCommit===sourceCommit&&ci.testedSourceCommit===sourceCommit&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&
    Number.isSafeInteger(issuedAt)&&auth?.contentRead===false&&auth.length>0&&auth.length<=131072&&digest(auth.aclSha256)&&
    key?.contentRead===false&&key.length>0&&key.length<=16000&&digest(key.protectionSha256)&&environment?.name===D.environment,'GRANT');
  // A normalized proof still has the real required-reviewer entries. Never turn it into a boolean override.
  const ep=environmentProof({name:environment.name,protection_rules:environment.protectionRules,
    can_admins_bypass:environment.canAdminsBypass,deployment_branch_policy:environment.deploymentBranchPolicy});
  must(same(history,historyProof(history)),'HISTORY');
  const expiresAt=Math.min(issuedAt+86400000,D.basisExpiresAt);
  const body={schema:D.schema,sourceCommit,pins,ci,binding,seed,environment:ep,history,key,auth,issuedAt,
    expiresAt,reviewLatestStartAt:Math.min(seed.plan.expiresAt,expiresAt)-D.runMs,riskFile:D.riskFile,
    delegatedActor:{kind:'local_operator',delegatorAdminId:D.admin,humanWebClick:false,ledgerAdminMeans:'delegating-administrator'},
    policy:{jobId:D.jobId,instanceId:S.instanceId,deploymentId:S.deploymentId,repository:S.repository,region:S.region,modes:D.modes,
      dispatchesPerMode:1,githubEnvironmentApproval:'human-owner-required',approveGithubEnvironment:false,
      oldHostedLeaseRequired:false,extendWorkerDeadlines:false,createStackMax:1,resourcesMax:7,authenticatedGetsMax:2,
      newIam:0,deleteResources:0,changeSecrets:0,createBusinessJobs:0,monthlyBudgetTargetUsd:50,hardCostCap:false},
    limits:{seedPublishMax:1,modeAttemptsMax:3,localSqlQueriesPerAttempt:100,configReadsPerAttempt:1,tlsConnectionsPerAttempt:2,
      keyReadsPerAttempt:1,stsPerAttempt:1,auditPermissionSimulationsPerAttempt:1,auditPutsPerAttempt:1,appTokenIssuesPerAttempt:1,appDispatchesPerAttempt:1,appRevokeAttemptsPerAttempt:1,
      ciGetsPerAttempt:3,environmentGetsPerAttempt:2,cloudReviewEvidencePutsMax:3},
    audit:{location:'existing-private-evidence-bucket',conditionalCreate:true,mustPersistBeforeLedger:true},retryAllowed:false};
  return {...body,grantSha256:await sha256Hex(body)};
}
export async function validateGrant(g,approved,at){must(same(g,await grant(g))&&g.grantSha256===approved,'APPROVAL_SHA');
  must(Number.isSafeInteger(at)&&at>=g.issuedAt&&at<g.expiresAt,'EXPIRED');return g;}
export async function validateTarget(g,entry,loadPlan,at){
  const v=await validatePlan(entry.plan,g.binding.release,at),p=v.plan;
  must(entry.planSha256===v.planSha256&&entry.actionSha256===v.actionSha256&&entry.riskSha256===p.riskSha256&&entry.attempt===null&&
    p.sourceCommit===g.sourceCommit&&p.jobId===D.jobId&&p.instanceId===S.instanceId&&p.deploymentId===S.deploymentId&&
    p.inputs.lineage===canonicalJson(B.packageReference)&&p.riskSha256===g.binding.release.riskSha256,'TARGET');
  if(p.mode==='Review')must(same(v,g.seed),'EXACT_SEED');
  else{
    const parent=await loadPlan(p.predecessor.planSha256),q=await validatePlan(parent.plan,g.binding.release,parent.plan.preparedAt);
    must(parent.planSha256===q.planSha256&&parent.actionSha256===q.actionSha256&&parent.riskSha256===q.plan.riskSha256&&q.plan.sourceCommit===g.sourceCommit&&q.plan.jobId===D.jobId&&
      parent.attempt?.state==='OBSERVED'&&parent.attempt.status==='completed'&&parent.attempt.conclusion==='success'&&
      parent.attempt.runId===p.predecessor.runId&&parent.attempt.proofSha256===p.predecessor.proofSha256&&digest(parent.attempt.proofSha256),'PREDECESSOR');
    if(p.mode==='RunOnce')must(same(q,g.seed),'REVIEW_ANCHOR');
    else{must(p.mode==='Inspect'&&q.plan.mode==='RunOnce','INSPECT_PARENT');
      const seed=await loadPlan(q.plan.predecessor.planSha256);must(seed.planSha256===g.seed.planSha256&&same(seed.plan,g.seed.plan)&&
        seed.attempt?.state==='OBSERVED'&&seed.attempt.status==='completed'&&seed.attempt.conclusion==='success'&&
        seed.attempt.proofSha256===q.plan.predecessor.proofSha256&&seed.attempt.runId===q.plan.predecessor.runId,'INSPECT_ANCHOR');}
  }
  return v;
}
