// New Alpine image lineage. Historical v1 pins and approved factories stay intact.
import {createHash} from 'node:crypto';
import {lockedPublisherFoundation,PUBLISHER_V2 as V} from '../platform-image-recovery-v2/publisher-foundation.mjs';
export const P=Object.freeze({repository:'veinyyxy/TechlongSoftware',repositoryId:1323312747,actorId:'14145707',ownerId:'14145707',
  sourceCommit:'4209fcab429b868e253ea2d7263dfe2189187232',runId:39692352506,workflowId:391864582,
  artifactId:12388759351,artifactBytes:307758788,
  artifactName:'platform-web-image-4209fcab429b868e253ea2d7263dfe2189187232-39692352506',
  artifactDigest:'sha256:74cf0fa61cc2a6ba9192050fbe63b0872785afc65239445f146395c3b361e478',
  artifactExpiresAt:'2026-10-24T23:18:27Z',
  imageConfigDigest:'sha256:2338439ea316a6189d50281f5d25a0a1c2a2ca1f4455494253f20bcbd8f6f9ae',
  archiveSha256:'31578b890954ab675b1ef4c1f90424af82f519fd09b0b1a2cfac4fb1b0e5b30c',
  account:V.account,region:V.region,role:V.role,roleArn:`arn:aws:iam::${V.account}:role/${V.role}`,roleId:'AROAV3GNMXTZID6CJJBA2',
  stackId:`arn:aws:cloudformation:${V.region}:${V.account}:stack/${V.stack}/701257e0-cd89-11f1-be5e-02452f6c634b`,
  ecrRepository:'techlong-sandbox-platform-web',registry:`${V.account}.dkr.ecr.${V.region}.amazonaws.com`,
  targetTag:'platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1',
  environment:'techlong-sandbox-deploy',subject:'repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy',
  reusableFile:'platform-image-publish-job-v2.yml',callerFile:'platform-image-publish-v2.yml',
  scannerVersion:'0.75.0',scannerSha256:'c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f'});
export const must=(v,c)=>{if(!v)throw Error('PLATFORM_PUBLISH_V2_'+c);};
export const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
// A bound candidate shares the proven protocol, never mutates the legacy P.
export function publicationProtocol(candidate=P){
  const mutable=new Set(['sourceCommit','runId','artifactId','artifactBytes','artifactName','artifactDigest','artifactExpiresAt',
    'imageConfigDigest','archiveSha256','targetTag','reusableFile','callerFile']);
  must(same(Object.keys(candidate).sort(),Object.keys(P).sort())&&Object.keys(P).every(k=>mutable.has(k)||same(candidate[k],P[k]))&&
    /^[a-f0-9]{40}$/.test(candidate.sourceCommit)&&Number.isSafeInteger(candidate.runId)&&candidate.runId>0&&
    Number.isSafeInteger(candidate.artifactId)&&candidate.artifactId>0&&Number.isSafeInteger(candidate.artifactBytes)&&candidate.artifactBytes>0&&
    candidate.artifactName===`platform-web-image-${candidate.sourceCommit}-${candidate.runId}`&&
    /^sha256:[a-f0-9]{64}$/.test(candidate.artifactDigest)&&Number.isFinite(Date.parse(candidate.artifactExpiresAt))&&
    /^sha256:[a-f0-9]{64}$/.test(candidate.imageConfigDigest)&&/^[a-f0-9]{64}$/.test(candidate.archiveSha256)&&
    candidate.targetTag===`platform-sha${candidate.sourceCommit}-r${candidate.runId}-a1`&&
    ((candidate.reusableFile===P.reusableFile&&candidate.callerFile===P.callerFile)||
      (candidate.reusableFile==='platform-image-hosted-publish-job-v2.yml'&&candidate.callerFile==='platform-image-hosted-publish-v2.yml')),'BOUND_CANDIDATE');
  return boundProtocol(Object.freeze({...candidate}));
}
function boundProtocol(P){
function verifyCandidate(run,artifact,now=Date.now()){
  must(run.id===P.runId&&run.head_sha===P.sourceCommit&&run.head_branch==='main'&&run.event==='push'&&run.run_attempt===1&&
    run.status==='completed'&&run.conclusion==='success'&&run.workflow_id===P.workflowId&&
    run.path==='.github/workflows/platform-hosting-candidate.yml'&&run.repository?.id===P.repositoryId,'CANDIDATE_RUN');
  must(artifact.id===P.artifactId&&artifact.name===P.artifactName&&artifact.size_in_bytes===P.artifactBytes&&artifact.digest===P.artifactDigest&&
    artifact.expired===false&&Date.parse(artifact.expires_at)===Date.parse(P.artifactExpiresAt)&&now<Date.parse(P.artifactExpiresAt)&&
    artifact.workflow_run?.id===P.runId&&artifact.workflow_run.head_sha===P.sourceCommit&&
    artifact.workflow_run.repository_id===P.repositoryId&&artifact.workflow_run.head_repository_id===P.repositoryId,'CANDIDATE_ARTIFACT');
}
function validateReview(text,sha,now=Date.now()){
  must(typeof text==='string'&&text.length<20000&&/^[a-f0-9]{64}$/.test(sha)&&hash(text)===sha,'REVIEW_SHA');
  const m=JSON.parse(text);
  must(same(Object.keys(m).sort(),['schema','reusableCommit','dispatchCommit','nonce','issuedAt','expiresAt','grantStartsAt','grantExpiresAt','candidate'].sort())&&
    m.schema==='techlong/platform-image-publication-review/v2'&&/^[a-f0-9]{40}$/.test(m.reusableCommit)&&
    /^[a-f0-9]{40}$/.test(m.dispatchCommit)&&/^[a-f0-9]{32}$/.test(m.nonce)&&same(m.candidate,P),'REVIEW_FIELDS');
  const [issued,end,start,grantEnd]=[m.issuedAt,m.expiresAt,m.grantStartsAt,m.grantExpiresAt].map(Date.parse);
  must([issued,end,start,grantEnd].every(Number.isFinite)&&issued<=now&&now<end&&end-issued<=48*3600000&&
    start>=issued&&grantEnd>start&&grantEnd-start<=3600000&&grantEnd<=end&&end<=Date.parse(P.artifactExpiresAt),'REVIEW_WINDOW');
  return m;
}
function templates(m){
  // Revalidate even when called by a local planner rather than the cloud worker.
  const text=JSON.stringify(m);validateReview(text,hash(text),Date.parse(m.issuedAt));
  const grant=lockedPublisherFoundation(),role=grant.Resources.PlatformImagePublisher.Properties;
  const dates={DateGreaterThanEquals:{'aws:CurrentTime':m.grantStartsAt},DateLessThan:{'aws:CurrentTime':m.grantExpiresAt}};
  role.AssumeRolePolicyDocument.Statement.push({Sid:'OneReviewedPlatformPublicationV2',Effect:'Allow',
    Principal:{Federated:`arn:aws:iam::${P.account}:oidc-provider/token.actions.githubusercontent.com`},Action:['sts:AssumeRoleWithWebIdentity'],
    Condition:{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':P.subject,
      'token.actions.githubusercontent.com:repository_id':String(P.repositoryId),'token.actions.githubusercontent.com:repository_owner_id':P.ownerId,
      'token.actions.githubusercontent.com:actor_id':P.actorId,'token.actions.githubusercontent.com:ref':'refs/heads/main',
      'token.actions.githubusercontent.com:environment':P.environment,
      'token.actions.githubusercontent.com:job_workflow_ref':`${P.repository}/.github/workflows/${P.reusableFile}@${m.reusableCommit}`},...dates}});
  for(const s of role.Policies[0].PolicyDocument.Statement)s.Condition={...s.Condition,...dates};
  const revoke=lockedPublisherFoundation();
  revoke.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument={Version:'2012-10-17',
    Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]};
  return {grant,revoke};
}
function validateCloud(env,m,now=Date.now()){
  must(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===P.repository&&env.GITHUB_REPOSITORY_ID===String(P.repositoryId)&&
    env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_RUN_ATTEMPT==='1'&&
    env.GITHUB_SHA===m.dispatchCommit&&env.GITHUB_ACTOR_ID===P.actorId&&/^[1-9][0-9]{5,19}$/.test(env.GITHUB_RUN_ID)&&
    env.GITHUB_WORKFLOW_REF===`${P.repository}/.github/workflows/${P.callerFile}@refs/heads/main`,'CLOUD_CONTEXT');
  must(!Object.keys(env).some(k=>/^(AWS_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&env[k])&&
    env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','CREDENTIAL_OR_ENDPOINT_OVERRIDE');
  must(now>=Date.parse(m.grantStartsAt)&&now+60000<Date.parse(m.grantExpiresAt),'CLOUD_GRANT_WINDOW');
}
function validateClaims(c,env,m,now=Date.now()){
  must(c.iss==='https://token.actions.githubusercontent.com'&&c.aud==='sts.amazonaws.com'&&c.sub===P.subject&&c.repository===P.repository&&
    c.repository_id===String(P.repositoryId)&&c.repository_owner_id===P.ownerId&&c.actor_id===P.actorId&&
    c.ref==='refs/heads/main'&&c.event_name==='workflow_dispatch'&&c.environment===P.environment&&c.run_id===env.GITHUB_RUN_ID&&
    c.run_attempt==='1'&&c.sha===m.dispatchCommit&&c.workflow_ref===env.GITHUB_WORKFLOW_REF&&
    c.job_workflow_ref===`${P.repository}/.github/workflows/${P.reusableFile}@${m.reusableCommit}`&&c.job_workflow_sha===m.reusableCommit&&
    Number.isSafeInteger(c.exp)&&c.exp*1000>now&&Number.isSafeInteger(c.iat)&&c.iat*1000<=now+300000,'OIDC_CLAIMS');
}
function verifyPublishedManifest(response){
  must((response.failures??[]).length===0&&response.images?.length===1,'ECR_MANIFEST_RESPONSE');
  const i=response.images[0],manifest=JSON.parse(i.imageManifest??'null');
  must(i.registryId===P.account&&i.repositoryName===P.ecrRepository&&i.imageId?.imageTag===P.targetTag&&
    i.imageId.imageDigest==='sha256:'+hash(i.imageManifest)&&manifest?.schemaVersion===2&&
    ['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'].includes(i.imageManifestMediaType)&&
    manifest.config?.digest===P.imageConfigDigest&&Array.isArray(manifest.layers)&&manifest.layers.length>0,'ECR_MANIFEST_IMAGE');
  return {manifestDigest:i.imageId.imageDigest,imageConfigDigest:manifest.config.digest,layerCount:manifest.layers.length};
}
return Object.freeze({P,verifyCandidate,validateReview,templates,validateCloud,validateClaims,verifyPublishedManifest});
}
const legacy=publicationProtocol();
export const {verifyCandidate,validateReview,templates,validateCloud,validateClaims,verifyPublishedManifest}=legacy;
