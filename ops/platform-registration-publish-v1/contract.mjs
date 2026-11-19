// Exact overlay lineages; no caller-supplied artifact or repository.
import { readFileSync } from 'node:fs';
import { P, hash, same, must } from '../platform-image-publication-v2/plan.mjs';
import { RETAINED as BASE_IMAGES, C as OLD_PLATFORM } from '../platform-recovery-image-v1/candidate.mjs';
import { lockedPublisherFoundation } from '../platform-image-recovery-v2/publisher-foundation.mjs';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const brief = load('../../docs/evidence/sandbox-registration-ecr-publication.prepared.json');
const observed = load('../../docs/evidence/sandbox-registration-platform-candidate.observed.json');
const replacement = load('../../docs/evidence/sandbox-first-purchase-replacement.observed.json');
const activation = load('../../docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json');
const dahliaObserved = load('../../docs/evidence/sandbox-first-purchase-dahlia.observed.json');
const dahliaPrepared = load('../../docs/evidence/sandbox-first-purchase-dahlia.prepared.json');
const checkoutReviewPath = new URL('../../docs/evidence/sandbox-first-purchase-checkout-repair-rollout.review.json',import.meta.url);
const source = brief.source;
const a = source.artifact;
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
must(source.buildRunId === '44343705697' && a.id === '14444752398' && source.buildAttempt === 1 &&
  observed.workflow.orchestrationCommit === source.orchestrationCommit && observed.source.sourceTreeOid === source.sourceTreeOid &&
  observed.source.sourceRecipeSha256 === source.sourceRecipeSha256 && Object.entries(a).every(([k,v]) => same(observed.artifact[k], v)), 'REGISTRATION_OBSERVED_PINS');

export const C = Object.freeze({ ...P,
  // Core publish receipt calls this sourceCommit; it identifies only the GitHub
  // orchestrator. The actual image tree and recipe are separately pinned here.
  sourceCommit: source.orchestrationCommit, runId: Number(source.buildRunId), workflowId: source.producerWorkflowId,
  artifactId: Number(a.id), artifactName: a.name, artifactBytes: a.zipBytes, artifactDigest: a.zipDigest, artifactExpiresAt: a.expiresAtUtc,
  archiveSha256: a.imageArchiveSha256, imageConfigDigest: a.imageConfigDigest, archiveBytes: a.imageArchiveBytes, scanSummarySha256: a.scanSummarySha256,
  sourceRecipeSha256: source.sourceRecipeSha256, sourceTreeOid: source.sourceTreeOid,
  targetTag: brief.target.singleProposedImmutableTag, callerFile:'sandbox-registration-image-publish-v1.yml',
  reusableFile:'sandbox-registration-image-publish-job-v1.yml',
});
const w=replacement.workflow, e=replacement.evidence, pinned=activation.candidate;
must(w.runAttempt===1 && w.conclusion==='success' && w.event==='workflow_dispatch' && w.branch==='main' && w.repositoryId===C.repositoryId &&
  e.runId===44370472025 && e.artifactId===14457164929 && pinned.runId===e.runId && pinned.artifactId===e.artifactId && pinned.recipeSha256===e.sourceRecipeSha256 &&
  pinned.sourceTreeOid===e.sourceTreeOid && pinned.artifactZipDigest===e.artifactZipDigest && pinned.imageConfigDigest===e.imageConfigDigest &&
  pinned.expiresAtUtc===e.expiresAtUtc && e.syntheticPlnCallbackSmokePassed && e.freshOsHighCriticalGatePassed &&
  pinned.publisherTagProposed==='sandbox-first-purchase-b344a2e3-r44370472025','FIRST_PURCHASE_OBSERVED_PINS');
export const FIRST_PURCHASE_CANDIDATE=Object.freeze({...C,sourceCommit:w.orchestrationCommit,runId:e.runId,workflowId:w.workflowId,
  artifactId:e.artifactId,artifactName:e.artifactName,artifactBytes:e.artifactZipBytes,artifactDigest:e.artifactZipDigest,artifactExpiresAt:e.expiresAtUtc,
  archiveSha256:e.archiveSha256,imageConfigDigest:e.imageConfigDigest,archiveBytes:e.archiveBytes,scanSummarySha256:e.scanSummarySha256,
  sourceRecipeSha256:e.sourceRecipeSha256,sourceTreeOid:e.sourceTreeOid,targetTag:pinned.publisherTagProposed});
const dw=dahliaObserved.workflow, de=dahliaObserved.evidence, dp=dahliaPrepared.candidate;
must(dw.runAttempt===1&&dw.conclusion==='success'&&dw.event==='workflow_dispatch'&&dw.branch==='main'&&dw.repository===C.repository&&
  dw.repositoryId===C.repositoryId&&dw.file===dahliaPrepared.reviewScope.workflow&&dw.workflowId===dahliaPrepared.reviewScope.workflowId&&
  de.runId===44418072086&&de.artifactId===14480476839&&de.artifactName==='sandbox-first-purchase-overlay-cdfa2e16-44418072086'&&
  de.sourceRecipeSha256===dp.recipeSha256&&de.sourceTreeOid===dp.sourceTreeOid&&de.syntheticDahliaCallbackSmokePassed===true&&
  de.freshOsHighCriticalGatePassed===true&&dahliaObserved.proofBoundary.artifactMetadataAndExactSuccessfulJobSealLogCompared===true&&
  dahliaObserved.proofBoundary.registryManifestDigest===null,'DAHLIA_FIRST_PURCHASE_OBSERVED_PINS');
export const DAHLIA_FIRST_PURCHASE_CANDIDATE=Object.freeze({...C,sourceCommit:dw.orchestrationCommit,runId:de.runId,workflowId:dw.workflowId,
  artifactId:de.artifactId,artifactName:de.artifactName,artifactBytes:de.artifactZipBytes,artifactDigest:de.artifactZipDigest,
  artifactExpiresAt:de.expiresAtUtc,archiveSha256:de.archiveSha256,imageConfigDigest:de.imageConfigDigest,
  archiveBytes:de.archiveBytes,scanSummarySha256:de.scanSummarySha256,sourceRecipeSha256:de.sourceRecipeSha256,
  sourceTreeOid:de.sourceTreeOid,targetTag:'sandbox-first-purchase-cdfa2e16-r44418072086'});

const checkoutText=readFileSync(checkoutReviewPath,'utf8').replace(/\r\n/g,'\n');
export const CHECKOUT_REVIEW_SHA='d4ead3f7379f307db598160d1752f8e9a6baa36ce27f314c17f6df91d61e90c4';
must(hash(checkoutText)===CHECKOUT_REVIEW_SHA,'CHECKOUT_REVIEW_BYTES');
const checkout=JSON.parse(checkoutText);
const cw=checkout.observedBuild,ce=cw.evidence;
must(cw.repository===C.repository&&cw.repositoryId===C.repositoryId&&cw.workflowPath===dw.file&&cw.workflowId===dw.workflowId&&
  cw.branch==='main'&&cw.event==='workflow_dispatch'&&cw.attempt===1&&cw.conclusion==='success'&&
  ce.runId===44442817443&&ce.artifactId===14491468132&&ce.noAwsIdentity&&ce.syntheticCallbackPassed&&ce.freshOsHighCriticalGatePassed&&
  cw.registryManifestDigest===null,'CHECKOUT_OBSERVED_PINS');
export const CHECKOUT_REPAIR_CANDIDATE=Object.freeze({...C,sourceCommit:cw.head,runId:ce.runId,workflowId:cw.workflowId,
  artifactId:ce.artifactId,artifactName:ce.artifactName,artifactBytes:ce.artifactZipBytes,artifactDigest:ce.artifactZipDigest,
  artifactExpiresAt:ce.expiresAtUtc,archiveSha256:ce.archiveSha256,imageConfigDigest:ce.imageConfigDigest,
  archiveBytes:ce.archiveBytes,scanSummarySha256:ce.scanSummarySha256,sourceRecipeSha256:ce.sourceRecipeSha256,
  sourceTreeOid:ce.sourceTreeOid,targetTag:checkout.scope.proposedExactImmutableTag});

const billingText=readFileSync(new URL('../../docs/evidence/sandbox-first-purchase-billing-rollout.review.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const billingReceipt=readFileSync(new URL('../../docs/evidence/sandbox-first-purchase-billing-candidate.observed.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const BILLING_REVIEW_SHA='7112a253eddda954c25c5b94f92b259b8895484a07ae127e4531d0d7d746334c';
export const BILLING_CANDIDATE_RECEIPT_SHA='29be08d5cbb2c0004da1a3bf3544094e4900b5afda490d2101f7395514248e8f';
must(hash(billingText)===BILLING_REVIEW_SHA&&hash(billingReceipt)===BILLING_CANDIDATE_RECEIPT_SHA,'BILLING_REVIEW_AND_RECEIPT_BYTES');
const billing=JSON.parse(billingText),bw=JSON.parse(billingReceipt),be=bw.evidence;
must(bw.stage==='EXISTING_CANDIDATE_VERIFIED_READ_ONLY'&&bw.approval===BILLING_REVIEW_SHA&&bw.run?.identityMatches===true&&
  bw.repository===C.repository&&bw.repositoryId===C.repositoryId&&bw.workflowPath===dw.file&&bw.workflowId===dw.workflowId&&
  bw.branch==='main'&&bw.event==='workflow_dispatch'&&bw.attempt===1&&bw.conclusion==='success'&&bw.run.runId===44450853247&&
  be.runId===bw.run.runId&&be.artifactId===14495028924&&be.sourceRecipeSha256===billing.source.recipeSha256&&be.sourceTreeOid===billing.source.tree&&
  be.noAwsIdentity===true&&be.syntheticCallbackPassed===true&&be.freshOsHighCriticalGatePassed===true&&bw.registryManifestDigest===null&&
  bw.counts.dispatches===0,'BILLING_OBSERVED_PINS');
export const BILLING_REPAIR_CANDIDATE=Object.freeze({...C,sourceCommit:bw.head,runId:be.runId,workflowId:bw.workflowId,
  artifactId:be.artifactId,artifactName:be.artifactName,artifactBytes:be.artifactZipBytes,artifactDigest:be.artifactZipDigest,
  artifactExpiresAt:be.expiresAtUtc,archiveSha256:be.archiveSha256,imageConfigDigest:be.imageConfigDigest,
  archiveBytes:be.archiveBytes,scanSummarySha256:be.scanSummarySha256,sourceRecipeSha256:be.sourceRecipeSha256,
  sourceTreeOid:be.sourceTreeOid,targetTag:billing.targets.proposedExactImmutableTag});

function overlayProtocol(S,producerPath,firstPurchase=false,additionalRetained=[]){
function verifyCandidate(run, artifact, now=Date.now()) {
  must(run.id===S.runId && run.head_sha===S.sourceCommit && run.workflow_id===S.workflowId && run.repository?.id===S.repositoryId &&
    run.head_branch==='main' && run.event==='workflow_dispatch' && run.run_attempt===1 && run.path===producerPath &&
    run.status==='completed' && run.conclusion==='success','REGISTRATION_PRODUCER');
  must(artifact.id===S.artifactId && artifact.name===S.artifactName && artifact.size_in_bytes===S.artifactBytes && artifact.digest===S.artifactDigest &&
    artifact.expired===false && Date.parse(artifact.expires_at)===Date.parse(S.artifactExpiresAt) && now<Date.parse(S.artifactExpiresAt) &&
    artifact.workflow_run?.id===S.runId && artifact.workflow_run.head_sha===S.sourceCommit &&
    artifact.workflow_run.repository_id===S.repositoryId && artifact.workflow_run.head_repository_id===S.repositoryId,'REGISTRATION_ARTIFACT_METADATA');
}
function verifyImageReceipt(r) {
  const recipe=r?.sourceRecipe;
  const canonical={base:recipe?.base,fix:recipe?.fix,overlay:recipe?.overlay?.map(f=>({path:f.path,sha256:f.sha256}))};
  // Preserve the producer's recursive sorted-key hashing convention.
  const ordered=(x)=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
  const recipeHash=hash(JSON.stringify(firstPurchase?(recipe??null):ordered(canonical)));
  const kind=firstPurchase?'sandbox-first-purchase-overlay-image':'sandbox-registration-overlay-image';
  const smoke={networkDisabled:true,closedControl:true,healthAndLogin:true,registrationPageGetOnly:true};
  if(firstPurchase)smoke.firstPurchaseSyntheticCallback={outcome:'SANDBOX_FIRST_PURCHASE_SYNTHETIC_CALLBACK_PASSED',
    validOutOfScopeIgnored:true,liveModeIgnored:true,badSignatureRejected:true,exactRouteOnly:true,workerClosed:true};
  must(r?.schema===`techlong/${kind}/v1` && r.orchestrationCommit===S.sourceCommit && r.runId===String(S.runId) && r.runAttempt===1 &&
    r.sourceTreeOid===S.sourceTreeOid && r.sourceRecipeSha256===S.sourceRecipeSha256 && recipeHash===S.sourceRecipeSha256 &&
    r.imageConfigDigest===S.imageConfigDigest && r.archiveFile==='image.tar.gz' && r.archiveBytes===S.archiveBytes && r.archiveSha256===S.archiveSha256 &&
    r.scanSummarySha256===S.scanSummarySha256 && r.os==='linux' && r.architecture==='amd64' && r.awsIdentity===false && r.registryManifestVerified===false &&
    same(r.smoke,smoke),'REGISTRATION_RECEIPT');
  return r;
}
function validateReview(text, sha, now=Date.now()) {
  must(typeof text==='string' && text.length<20000 && hex64.test(sha??'') && hash(text)===sha,'REGISTRATION_REVIEW_SHA');
  const m=JSON.parse(text);
  must(m.schema==='techlong/platform-image-publication-review/v2' && same(m.candidate,S) && hex40.test(m.reusableCommit??'') && hex40.test(m.dispatchCommit??'') &&
    /^[a-f0-9]{32}$/.test(m.nonce??'') && same(Object.keys(m).sort(),['schema','candidate','reusableCommit','dispatchCommit','nonce','issuedAt','expiresAt','grantStartsAt','grantExpiresAt'].sort()),'REGISTRATION_REVIEW_FIELDS');
  const [issued,end,start,grantEnd]=[m.issuedAt,m.expiresAt,m.grantStartsAt,m.grantExpiresAt].map(Date.parse);
  must([issued,end,start,grantEnd].every(Number.isFinite) && issued<=now && now<end && end-issued<=48*3600000 &&
    start>=issued && grantEnd>start && grantEnd-start<=3600000 && grantEnd<=end && end<=Date.parse(S.artifactExpiresAt),'REGISTRATION_REVIEW_WINDOW');
  return m;
}
const ref = m => `${S.repository}/.github/workflows/${S.reusableFile}@${m.reusableCommit}`;
function validateCloud(e,m,now=Date.now()) {
  must(e.GITHUB_ACTIONS==='true' && e.GITHUB_REPOSITORY===S.repository && e.GITHUB_REPOSITORY_ID===String(S.repositoryId) &&
    e.GITHUB_EVENT_NAME==='workflow_dispatch' && e.GITHUB_REF==='refs/heads/main' && e.GITHUB_RUN_ATTEMPT==='1' && e.GITHUB_SHA===m.dispatchCommit &&
    e.GITHUB_ACTOR_ID===S.actorId && /^[1-9][0-9]{5,19}$/.test(e.GITHUB_RUN_ID) &&
    e.GITHUB_WORKFLOW_REF===`${S.repository}/.github/workflows/${S.callerFile}@refs/heads/main`,'REGISTRATION_CLOUD_CONTEXT');
  must(!Object.keys(e).some(k=>/^(AWS_|DATABASE_URL$|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&e[k]) &&
    e.NODE_TLS_REJECT_UNAUTHORIZED!=='0' && now>=Date.parse(m.grantStartsAt) && now+60000<Date.parse(m.grantExpiresAt),'REGISTRATION_CLOUD_BOUNDARY');
}
function validateClaims(c,e,m,now=Date.now()) {
  must(c.iss==='https://token.actions.githubusercontent.com' && c.aud==='sts.amazonaws.com' && c.sub===S.subject && c.repository===S.repository &&
    c.repository_id===String(S.repositoryId) && c.repository_owner_id===S.ownerId && c.actor_id===S.actorId && c.ref==='refs/heads/main' &&
    c.event_name==='workflow_dispatch' && c.environment===S.environment && c.run_id===e.GITHUB_RUN_ID && c.run_attempt==='1' &&
    c.sha===m.dispatchCommit && c.workflow_ref===e.GITHUB_WORKFLOW_REF && c.job_workflow_ref===ref(m) && c.job_workflow_sha===m.reusableCommit &&
    Number.isSafeInteger(c.exp) && c.exp*1000>now && Number.isSafeInteger(c.iat) && c.iat*1000<=now+300000,'REGISTRATION_OIDC_CLAIMS');
}
function templates(m) {
  const raw=JSON.stringify(m);validateReview(raw,hash(raw),Date.parse(m.issuedAt));
  const grant=lockedPublisherFoundation(),role=grant.Resources.PlatformImagePublisher.Properties;
  const date={DateGreaterThanEquals:{'aws:CurrentTime':m.grantStartsAt},DateLessThan:{'aws:CurrentTime':m.grantExpiresAt}};
  role.AssumeRolePolicyDocument.Statement.push({Sid:firstPurchase?'OneSandboxFirstPurchasePublication':'OneSandboxRegistrationPublication',Effect:'Allow',
    Principal:{Federated:`arn:aws:iam::${S.account}:oidc-provider/token.actions.githubusercontent.com`}, Action:['sts:AssumeRoleWithWebIdentity'],
    Condition:{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':S.subject,
      'token.actions.githubusercontent.com:repository_id':String(S.repositoryId),'token.actions.githubusercontent.com:repository_owner_id':S.ownerId,
      'token.actions.githubusercontent.com:actor_id':S.actorId,'token.actions.githubusercontent.com:ref':'refs/heads/main',
      'token.actions.githubusercontent.com:environment':S.environment,'token.actions.githubusercontent.com:job_workflow_ref':ref(m)},...date}});
  const needed=new Set(['ecr:GetAuthorizationToken','ecr:BatchCheckLayerAvailability','ecr:InitiateLayerUpload','ecr:UploadLayerPart',
    'ecr:CompleteLayerUpload','ecr:PutImage','ecr:BatchGetImage','ecr:DescribeImages']);
  for(const s of role.Policies[0].PolicyDocument.Statement) {
    s.Action=s.Action.filter(action=>needed.has(action));s.Condition={...s.Condition,...date};
  }
  const revoke=lockedPublisherFoundation();
  revoke.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument={Version:'2012-10-17',
    Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]};
  return {grant,revoke};
}
const preserved=Object.freeze([...BASE_IMAGES,{digest:brief.target.oldPlatformDigestToPreserve,tag:OLD_PLATFORM.targetTag},
  ...(firstPurchase?[{digest:'sha256:adaa45218a5bfefcc376bf0349eb685f742efb381fc334540347745091bbe323',tag:C.targetTag}]:[]),
  ...additionalRetained]);
function verifyRetained(v) {
  must(!v.nextToken && v.imageDetails?.length===preserved.length,'REGISTRATION_ECR_BASE_COUNT');
  for(const p of preserved) {
    const rows=v.imageDetails.filter(i=>i.imageDigest===p.digest);
    must(rows.length===1 && rows[0].registryId===S.account && rows[0].repositoryName===S.ecrRepository && same(rows[0].imageTags,[p.tag]),'REGISTRATION_ECR_BASE_IMAGE');
  }
  return true;
}
function verifyFinalInventory(v,newDigest) {
  must(digest.test(newDigest??'') && !v.nextToken && v.imageDetails?.length===preserved.length+1 && !preserved.some(p=>p.digest===newDigest),'REGISTRATION_ECR_FINAL_COUNT');
  const rows=v.imageDetails.filter(r=>r.imageDigest===newDigest);
  must(rows.length===1 && rows[0].registryId===S.account && rows[0].repositoryName===S.ecrRepository && same(rows[0].imageTags,[S.targetTag]),'REGISTRATION_ECR_FINAL_TAG');
  return verifyRetained({imageDetails:v.imageDetails.filter(r=>r.imageDigest!==newDigest)});
}
function verifyPublishedManifest(v) {
  must((v.failures??[]).length===0 && v.images?.length===1,'REGISTRATION_ECR_MANIFEST_COUNT');
  const i=v.images[0],m=JSON.parse(i.imageManifest??'null');
  must(i.registryId===S.account && i.repositoryName===S.ecrRepository && i.imageId?.imageTag===S.targetTag &&
    i.imageId.imageDigest==='sha256:'+hash(i.imageManifest??'') && m?.schemaVersion===2 && m.config?.digest===S.imageConfigDigest &&
    Array.isArray(m.layers) && m.layers.length>0 && ['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'].includes(i.imageManifestMediaType), 'REGISTRATION_ECR_MANIFEST');
  return {manifestDigest:i.imageId.imageDigest,imageConfigDigest:S.imageConfigDigest,layerCount:m.layers.length};
}
return Object.freeze({P:S,verifyCandidate,verifyImageReceipt,validateReview,validateCloud,validateClaims,templates,verifyRetained,
  verifyInventory:verifyRetained,verifyFinalInventory,verifyPublishedManifest});
}

export const protocol=overlayProtocol(C,observed.workflow.file);
export const firstPurchaseProtocol=overlayProtocol(FIRST_PURCHASE_CANDIDATE,w.file,true);
export const dahliaFirstPurchaseProtocol=overlayProtocol(DAHLIA_FIRST_PURCHASE_CANDIDATE,dw.file,true);
export const checkoutRepairProtocol=overlayProtocol(CHECKOUT_REPAIR_CANDIDATE,cw.workflowPath,true,[
  {digest:checkout.scope.baselineEcrDigest,tag:DAHLIA_FIRST_PURCHASE_CANDIDATE.targetTag}
]);
export const billingRepairProtocol=overlayProtocol(BILLING_REPAIR_CANDIDATE,bw.workflowPath,true,[
  {digest:checkout.scope.baselineEcrDigest,tag:DAHLIA_FIRST_PURCHASE_CANDIDATE.targetTag},
  {digest:billing.baseline.platformImageManifestDigest,tag:CHECKOUT_REPAIR_CANDIDATE.targetTag},
]);
export const {verifyCandidate,verifyImageReceipt,validateReview,validateCloud,validateClaims,templates,verifyRetained,verifyFinalInventory,verifyPublishedManifest}=protocol;

export function selectOverlayPublication(text,sha,now=Date.now()) {
  must(typeof text==='string' && text.length<20000 && hex64.test(sha??'') && hash(text)===sha,'REGISTRATION_REVIEW_SHA');
  const candidate=JSON.parse(text).candidate;
  const selected=[protocol,firstPurchaseProtocol,dahliaFirstPurchaseProtocol,checkoutRepairProtocol,billingRepairProtocol].find(p=>same(p.P,candidate));
  must(selected,'REGISTRATION_REVIEW_FIELDS');
  return {protocol:selected,review:selected.validateReview(text,sha,now)};
}
