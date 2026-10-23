import {P,hash,same,must,publicationProtocol} from '../platform-image-publication-v2/plan.mjs';
export {P,hash,same,must};
export const S=Object.freeze({reusableCommit:'c35dd66e1207181b9591056e1202cfb84ffcf010',
  reusableCiRun:39695238725,reusableCiWorkflow:392289399,
  sourceCiFile:'platform-image-source-v2-candidate.yml',riskFile:'docs/aws-platform-hosting-w7j-source-review.md',
  publicReviewFile:'ops/aws-sandbox/reviews/platform-publication-w7j.review.json',
  intentFile:'techlong-platform-publication-v2.source.intent.json',
  scope:{cloudFormationUpdateStack:2,githubWorkflowDispatch:1,roleSessions:1,topLevelDockerPush:1,
    grantSeconds:3600,stsSeconds:900,gitCredentialLoads:1,awsSecretValueReads:0,appPrivateKeyReads:0,
    sqlConnections:0,resourceCreates:0,resourceDeletes:0,deployments:0}});
export function sourceReview({protocol=publicationProtocol(),settings=S}={}){
const {P,templates}=protocol,S=settings;
function validateOuter(text,sha,now=Date.now()){
  must(typeof text==='string'&&text.length<100000&&hash(text)===sha,'SOURCE_APPROVAL_SHA');const m=JSON.parse(text);
  const keys=['schema','issuedAt','expiresAt','latestStartAt','nonce','operatorSourceCommit','sourceCiRunId','callerWorkflowId',
    'sourcePins','riskSha256','candidate','reusableCommit','scope'];
  must(same(Object.keys(m).sort(),keys.sort())&&m.schema===(S.schema??'techlong/platform-image-source-review/v2')&&same(m.candidate,P)&&
    same(m.scope,S.scope)&&m.reusableCommit===S.reusableCommit&&/^[a-f0-9]{40}$/.test(m.operatorSourceCommit)&&
    /^[a-f0-9]{32}$/.test(m.nonce)&&/^[a-f0-9]{64}$/.test(m.riskSha256)&&
    Number.isSafeInteger(m.sourceCiRunId)&&m.sourceCiRunId>0&&Number.isSafeInteger(m.callerWorkflowId)&&m.callerWorkflowId>0,'SOURCE_REVIEW_FIELDS');
  const issued=Date.parse(m.issuedAt),end=Date.parse(m.expiresAt),latest=Date.parse(m.latestStartAt);
  must([issued,end,latest].every(Number.isFinite)&&issued<=now&&now<=latest&&latest===end-3600000&&
    end-issued>3600000&&end-issued<=48*3600000&&end<=Date.parse(P.artifactExpiresAt),'SOURCE_REVIEW_WINDOW');
  must(Array.isArray(m.sourcePins)&&m.sourcePins.length>5&&m.sourcePins.length<100&&
    m.sourcePins.every(p=>same(Object.keys(p).sort(),['file','sha256'])&&typeof p.file==='string'&&!p.file.includes('..')&&
      !p.file.includes('\\')&&!p.file.startsWith('/')&&/^[a-f0-9]{64}$/.test(p.sha256))&&
    new Set(m.sourcePins.map(p=>p.file)).size===m.sourcePins.length,'SOURCE_PINS');
  return m;
}
function innerReview(m,head,now=Date.now()){
  const text=JSON.stringify(m);validateOuter(text,hash(text),now);must(/^[a-f0-9]{40}$/.test(head),'SOURCE_HEAD');
  return {schema:'techlong/platform-image-publication-review/v2',reusableCommit:S.reusableCommit,dispatchCommit:head,nonce:m.nonce,
    issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
    grantStartsAt:new Date(now).toISOString(),grantExpiresAt:new Date(now+3600000).toISOString(),candidate:{...P}};
}
function updateRequest(inner,phase){
  must(['grant','revoke'].includes(phase),'SOURCE_UPDATE_PHASE');
  return {StackName:P.stackId,TemplateBody:JSON.stringify(templates(inner)[phase],null,2)+'\n',
    ClientRequestToken:`${S.tokenPrefix??'platform-publication-v2'}-${inner.nonce}-${phase}`,Capabilities:['CAPABILITY_NAMED_IAM'],
    DisableRollback:true,Parameters:[]}; // Tags omitted = preserve stack tags. No RoleARN or macros.
}
function validateGithubLayout(v){
  must(v.user?.id===Number(P.actorId)&&v.user.login==='veinyyxy'&&v.repo?.id===P.repositoryId&&v.repo.full_name===P.repository&&
    v.repo.owner?.id===Number(P.ownerId),'SOURCE_GITHUB_ACCOUNT');
  must(v.oidc?.use_default===true&&v.oidc.use_immutable_subject===true&&
    v.oidc.sub_claim_prefix==='repo:veinyyxy@14145707/TechlongSoftware@1323312747','SOURCE_OIDC_LAYOUT');
  const e=v.environment,reviewers=e?.protection_rules?.find(r=>r.type==='required_reviewers');
  must(e?.id===24613410405&&e.name===P.environment&&e.can_admins_bypass===false&&
    e.deployment_branch_policy?.custom_branch_policies===true&&e.deployment_branch_policy.protected_branches===false&&
    reviewers?.prevent_self_review===false&&reviewers.reviewers?.length===1&&reviewers.reviewers[0].type==='User'&&
    reviewers.reviewers[0].reviewer?.id===Number(P.actorId)&&v.branches?.total_count===1&&v.branches.branch_policies?.length===1&&
    v.branches.branch_policies[0].name==='main'&&v.branches.branch_policies[0].type==='branch','SOURCE_ENVIRONMENT');
}
function verifyRun(run,{id,workflowId,head}){
  must(run.id===id&&run.workflow_id===workflowId&&run.repository?.id===P.repositoryId&&run.head_sha===head&&run.head_branch==='main'&&
    run.event==='workflow_dispatch'&&run.run_attempt===1&&run.path===`.github/workflows/${P.callerFile}`&&
    run.actor?.id===Number(P.actorId)&&run.triggering_actor?.id===Number(P.actorId)&&
    run.referenced_workflows?.some(w=>w.sha===S.reusableCommit&&w.path===`${P.repository}/.github/workflows/${P.reusableFile}@${S.reusableCommit}`),'SOURCE_DISPATCH_RUN');
}
return Object.freeze({P,S,validateOuter,innerReview,updateRequest,validateGithubLayout,verifyRun,verifyCandidate:protocol.verifyCandidate});
}
export const {validateOuter,innerReview,updateRequest,validateGithubLayout,verifyRun}=sourceReview();
