import { CONTROL_SCOPE as S, must, keys, obj, commit, digest, assertExact } from '../../lib/deployments/controller-v6/contract.ts';
import { validateWorkflowInputV5 } from '../cloud-worker/workflow-input-v5.mjs';
export const CLOUD_V6 = Object.freeze({ ...S, environment:'techlong-sandbox-deploy',
  identityWorkflow:'platform-controller-identity-v6.yml', reusableWorkflow:'cloud-worker-platform-job-v6.yml',
  actorLogin:'techlong-sandbox-controller[bot]', roleId:'AROAV3GNMXTZK5O45RG24',
  roleArn:'arn:aws:iam::402010193138:role/TechlongSandboxGitHubDeploymentWorkerRole',
  installationSha256:'0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1',
  legacyClosureSha256:'70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac',
  oidcSubject:'repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy' });
// Candidate summary only. The actual release descriptor is supplied as literals
// by a separately reviewed, commit-pinned reusable workflow (no self-hash cycle).
// The platform's own UNPUBLISHED binding is unchanged and cannot use this parser.
export const CLOUD_RELEASE_V6=Object.freeze({state:'UNPUBLISHED',sourceCommit:null,reusableCommit:null,
  closureSha256:null,identityProofSha256:null,actorId:null,installationSha256:null});
export function releaseFromWorkflowV6(env) {
  return {state:env.TECHLONG_PLATFORM_RELEASE_STATE,sourceCommit:env.TECHLONG_FROZEN_SOURCE_COMMIT,
    reusableCommit:env.TECHLONG_REUSABLE_COMMIT,closureSha256:env.TECHLONG_PLATFORM_CLOSURE_SHA,
    identityProofSha256:env.TECHLONG_APP_IDENTITY_PROOF_SHA,actorId:S.candidateBotId,installationSha256:CLOUD_V6.installationSha256};
}
export function cloudReleaseReadyV6(b) {
  return b?.state==='PUBLISHED' && commit(b.sourceCommit) && commit(b.reusableCommit) && digest(b.closureSha256) &&
    digest(b.identityProofSha256) && b.actorId===S.candidateBotId && b.installationSha256===CLOUD_V6.installationSha256;
}
export function externalInputsV6(input) {
  const v=obj(input);keys(v,['mode','job','installation','manifest','manifestSha','execution','lineage']);
  must(v.job!==S.completedJob,'CONTROL_V6_OLD_JOB');
  validateWorkflowInputV5({...v,installationSha:CLOUD_V6.installationSha256});
  if(v.mode==='Inspect') {
    const e=obj(JSON.parse(v.execution));
    must(new RegExp('^worker-v5/'+S.instanceId+'/'+v.job+'/'+v.manifestSha+'/execution-reference-[1-9][0-9]{0,15}-v1\\.json$').test(e.key),'CONTROL_V6_EXECUTION_KEY');
  }
  for(const name of ['installation','manifest','execution','lineage'])if(v[name]!=='') {
    const r=obj(JSON.parse(v[name]));
    must(/^[A-Za-z0-9/_.-]+$/.test(r.key) && !r.key.includes('..'),'CONTROL_V6_REFERENCE');
    if(name==='lineage')must(r.key.startsWith('worker-v5/'+S.instanceId+'/lineage/'),'CONTROL_V6_LINEAGE_KEY');
  }
  return structuredClone(v);
}
export function validateCloudRunV6(env,b,closure) {
  must(cloudReleaseReadyV6(b),'CONTROL_V6_UNPUBLISHED');
  must(env.GITHUB_ACTIONS==='true' && env.GITHUB_REPOSITORY===S.repository && env.GITHUB_REPOSITORY_ID===S.repositoryId &&
    env.GITHUB_REPOSITORY_OWNER_ID===S.ownerId && env.GITHUB_ACTOR_ID===S.candidateBotId &&
    env.GITHUB_ACTOR===CLOUD_V6.actorLogin && env.GITHUB_TRIGGERING_ACTOR===CLOUD_V6.actorLogin &&
    env.GITHUB_REF==='refs/heads/main' && env.GITHUB_EVENT_NAME==='workflow_dispatch' && env.GITHUB_RUN_ATTEMPT==='1' &&
    commit(env.GITHUB_SHA) && /^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID) &&
    env.GITHUB_WORKFLOW_REF===`${S.repository}/.github/workflows/${S.workflowFile}@refs/heads/main` &&
    env.TECHLONG_FROZEN_SOURCE_COMMIT===b.sourceCommit && env.TECHLONG_REUSABLE_COMMIT===b.reusableCommit &&
    closure.closureSha256===b.closureSha256 && closure.legacyClosureSha256===CLOUD_V6.legacyClosureSha256 &&
    !['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_DEFAULT_PROFILE',
      'AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ROLE_ARN','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].some(k=>env[k]) &&
    env.NODE_TLS_REJECT_UNAUTHORIZED!=='0' && !Object.keys(env).some(k=>/^AWS_ENDPOINT_URL/.test(k)),'CONTROL_V6_RUN_IDENTITY');
  return {repository:S.repository,runId:env.GITHUB_RUN_ID,runAttempt:1,commitSha:env.GITHUB_SHA};
}
export function validateOidcClaimsV6(c,env,b,now) {
  // Claims preflight is NOT signature verification. STS must validate the JWT.
  must(c?.iss==='https://token.actions.githubusercontent.com' && c.aud==='sts.amazonaws.com' && c.sub===CLOUD_V6.oidcSubject &&
    c.repository===S.repository && c.repository_id===S.repositoryId && c.repository_owner_id===S.ownerId &&
    c.actor_id===S.candidateBotId && c.actor===CLOUD_V6.actorLogin && c.ref==='refs/heads/main' && c.sha===env.GITHUB_SHA &&
    c.workflow_ref===`${S.repository}/.github/workflows/${S.workflowFile}@refs/heads/main` && c.workflow_sha===env.GITHUB_SHA &&
    c.runner_environment==='github-hosted' &&
    c.event_name==='workflow_dispatch' && c.run_id===env.GITHUB_RUN_ID && c.run_attempt==='1' && c.environment===CLOUD_V6.environment &&
    c.job_workflow_ref===`${S.repository}/.github/workflows/${CLOUD_V6.reusableWorkflow}@${b.reusableCommit}` &&
    c.job_workflow_sha===b.reusableCommit && Number.isSafeInteger(c.exp) && c.exp*1000>now && c.exp*1000<now+900000 &&
    Number.isSafeInteger(c.nbf) && c.nbf*1000<=now+30000,'CONTROL_V6_OIDC_CLAIMS');
}
export function exactRunV6(raw,{runId,sourceCommit,workflowId,reusableCommit=null,workflowFile=S.workflowFile}) {
  const r=obj(raw),repo=obj(r.repository);
  must(String(r.id)===runId && r.run_attempt===1 && r.event==='workflow_dispatch' && r.head_branch==='main' &&
    r.head_sha===sourceCommit && String(r.workflow_id)===workflowId && r.path===`.github/workflows/${workflowFile}` &&
    String(repo.id)===S.repositoryId && repo.full_name===S.repository && String(obj(repo.owner).id)===S.ownerId &&
    String(obj(r.actor).id)===S.candidateBotId && String(obj(r.triggering_actor).id)===S.candidateBotId &&
    r.status==='completed' && r.conclusion==='success','CONTROL_V6_EXACT_RUN');
  if(reusableCommit)must(Array.isArray(r.referenced_workflows) && r.referenced_workflows.some(w=>
    w.sha===reusableCommit && w.path===`${S.repository}/.github/workflows/${CLOUD_V6.reusableWorkflow}@${reusableCommit}`),'CONTROL_V6_REUSABLE');
  return {repository:S.repository,runId,runAttempt:1,commitSha:sourceCommit};
}
export function resultKeyV6(job,manifestSha,runId) {
  must(/^job_[a-f0-9]{24}$/.test(job) && job!==S.completedJob && digest(manifestSha) && /^[1-9][0-9]{0,15}$/.test(runId),'CONTROL_V6_RESULT_KEY');
  return `worker-v5/${S.instanceId}/${job}/${manifestSha}/run-${runId}-1/platform-result-v6.json`;
}
export function assertReferenceV6(r,key) {
  keys(obj(r),['key','sha256','versionId']);
  must(r.key===key && digest(r.sha256) && typeof r.versionId==='string' && /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId),'CONTROL_V6_OBJECT_REFERENCE');
  return r;
}
export {S,must,keys,obj,commit,digest,assertExact};
