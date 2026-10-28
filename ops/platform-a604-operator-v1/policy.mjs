import {validatePlan,CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {environmentProof} from '../platform-delegated-approval-v1/policy.mjs';
import {assertA604Publication,assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {A604_PROFILE,HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {D} from './scope.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
export const must=(v,c)=>{if(!v)throw Error('A604_OPERATOR_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const auditKey=(sha,mode)=>{must(digest(sha)&&D.modes.includes(mode),'AUDIT_SCOPE');return `worker-v5/${S.instanceId}/${D.jobId}/a604-delegation-v1/${sha}/${mode}.json`;};
export const slot=mode=>{must(D.modes.includes(mode),'MODE');return D.slotPrefix+mode+'.intent.json';};
export const INSTALLATION=Object.freeze({key:`worker-v5/${S.instanceId}/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json`,
  sha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae',versionId:'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV'});
const OLD_JOBS=['job_6e2e115c80301595512f11fb','job_6a1129afcebfc9fb580517c9','job_9db8466fd95cef0c23ad6bfc','job_9b57b43a6b88f37202b29170'];
export function oldHistory(rows){
  must(Array.isArray(rows)&&rows.length<=50,'HISTORY_ROWS');
  const values=rows.filter(r=>OLD_JOBS.includes(r.jobId)).map(r=>({jobId:r.jobId,planSha256:r.planSha256,actionSha256:r.actionSha256,
    riskSha256:r.riskSha256,sourceCommit:r.sourceCommit,mode:r.mode,expiresAt:r.expiresAt,runId:r.runId??null,
    state:r.state??null,proofSha256:r.proofSha256??null,runStatus:r.runStatus??null,conclusion:r.conclusion??null}));
  must(values.length===8&&values.every(r=>[r.planSha256,r.actionSha256,r.riskSha256].every(digest))&&
    new Set(values.map(r=>r.planSha256)).size===8,'HISTORY_COMPLETE');return values.sort((a,b)=>a.planSha256.localeCompare(b.planSha256));
}
const D_DEFAULT=D,oldHistoryDefault=oldHistory,assertPublicationDefault=assertA604Publication,assertScopeDefault=assertA604PlanScope;
export function createA604Policy({publication,profile:rawProfile=A604_PROFILE,baselineSha256=HANDOFF.actualAfterSha256,capability}={}){
  // Code-selected composition only; legacy CLI never accepts a capability.
  const D=capability?.definition??D_DEFAULT,oldHistory=capability?.history??oldHistoryDefault,
    assertA604Publication=capability?.assertPublication??assertPublicationDefault,assertA604PlanScope=capability?.assertScope??assertScopeDefault;
  const binding=freeze(structuredClone(publication)),profile=freeze(structuredClone(rawProfile));
  const seed=async at=>{await assertA604Publication(binding,profile,at);return validatePlan({schema:'techlong/platform-controller-plan/v6',
    instanceId:S.instanceId,deploymentId:S.deploymentId,jobId:D.jobId,mode:'Review',sourceCommit:binding.sourceCommit,
    releaseSha256:await sha256Hex(binding.release),riskSha256:binding.release.riskSha256,preparedAt:at,expiresAt:Math.min(at+7200000,profile.factsAt+profile.validMs),
    inputs:{mode:'Review',job:D.jobId,installation:canonicalJson(INSTALLATION),manifest:'',manifestSha:'',execution:'',lineage:canonicalJson(binding.packageReference)},predecessor:null},binding.release,at);};
  async function grant({sourceCommit,pins,ci,environment,history,key,auth,issuedAt}){
    await assertA604Publication(binding,profile,issuedAt);must(sourceCommit===binding.sourceCommit,'SOURCE');
    const ep=environmentProof({name:environment.name,protection_rules:environment.protectionRules,
      can_admins_bypass:environment.canAdminsBypass,deployment_branch_policy:environment.deploymentBranchPolicy});
    must(same(history,oldHistory(history))&&pins?.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>digest(p.sha256))&&
      ci?.sourceCommit===sourceCommit&&ci.testedSourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
      auth?.contentRead===false&&auth.length>0&&auth.length<=131072&&digest(auth.aclSha256)&&key?.contentRead===false&&
      key.length>0&&key.length<=16000&&digest(key.protectionSha256),'GRANT_INPUT');
    const s=await seed(issuedAt),body={schema:D.schema,sourceCommit,pins,ci,binding,seed:s,environment:ep,history,key,auth,issuedAt,
      expiresAt:Math.min(issuedAt+86400000,profile.factsAt+profile.validMs),reviewLatestStartAt:s.plan.expiresAt-D.runMs,
      baselineSha256,profileSha256:await sha256Hex(profile),riskFile:D.riskFile,delegatedActor:{kind:'local_operator',delegatorAdminId:D.admin,humanWebClick:false},
      policy:{jobId:D.jobId,modes:D.modes,dispatchesPerMode:1,githubEnvironmentApproval:'human-owner-required',approveGithubEnvironment:false,
        oldHostedLeaseRequired:false,extendWorkerDeadlines:false,createStackMax:1,resourcesMax:7,authenticatedGetsMax:2,newIam:0,deleteResources:0,
        changeSecrets:0,createBusinessJobs:0,monthlyBudgetTargetUsd:50,hardCostCap:false},
      limits:{configReadsPerAttempt:1,tlsConnectionsPerAttempt:2,localSqlQueriesPerAttempt:100,keyReadsPerAttempt:1,stsPerAttempt:1,
        auditPutsPerAttempt:1,appTokenIssuesPerAttempt:1,appDispatchesPerAttempt:1,appRevokeAttemptsPerAttempt:1},retryAllowed:false};
    return {...body,grantSha256:await sha256Hex(body)};
  }
  const approve=async(g,approved,at)=>{must(same(g,await grant(g))&&g.grantSha256===approved&&at>=g.issuedAt&&at<g.expiresAt,'GRANT_APPROVAL');
    await assertA604Publication(binding,profile,at);return g;};
  async function target(g,e,load,at){
    const v=await validatePlan(e.plan,binding.release,at),p=v.plan;assertA604PlanScope(p,binding);
    must(e.planSha256===v.planSha256&&e.actionSha256===v.actionSha256&&e.riskSha256===p.riskSha256&&e.attempt===null,'TARGET');
    if(p.mode==='Review')must(same(v,g.seed),'EXACT_SEED');
    else{const parent=await load(p.predecessor.planSha256),q=await validatePlan(parent.plan,binding.release,parent.plan.preparedAt);assertA604PlanScope(q.plan,binding);
      must(parent.planSha256===q.planSha256&&parent.actionSha256===q.actionSha256&&parent.attempt?.state==='OBSERVED'&&
        parent.attempt.status==='completed'&&parent.attempt.conclusion==='success'&&parent.attempt.runId===p.predecessor.runId&&
        parent.attempt.proofSha256===p.predecessor.proofSha256&&digest(parent.attempt.proofSha256),'TRUSTED_PARENT');
      if(p.mode==='RunOnce')must(same(q,g.seed),'REVIEW_ANCHOR');else{
        must(p.mode==='Inspect'&&q.plan.mode==='RunOnce','INSPECT_PARENT');const r=await load(q.plan.predecessor.planSha256);
        must(r.planSha256===g.seed.planSha256&&same(r.plan,g.seed.plan)&&r.attempt?.state==='OBSERVED'&&r.attempt.status==='completed'&&
          r.attempt.conclusion==='success'&&r.attempt.proofSha256===q.plan.predecessor.proofSha256&&r.attempt.runId===q.plan.predecessor.runId,'INSPECT_ANCHOR');}}
    return v;
  }
  return Object.freeze({grant,approve,target,seed});
}
