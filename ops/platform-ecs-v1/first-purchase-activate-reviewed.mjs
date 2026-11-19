// One exact sandbox activation; importing this module does not contact providers.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROOT, EVIDENCE, absent, directory, environment, git, noLinks, pins, readText, writeOnce } from '../platform-image-source-v2/files.mjs';
import { createAws, verifySnapshot } from '../platform-image-source-v2/aws.mjs';
import { createGithub } from '../platform-image-source-v2/github.mjs';
import { runControlled, errorCode } from '../platform-image-source-v2/runner.mjs';
import { dahliaFirstPurchaseSourceContext, dahliaSealedSizeFix } from '../platform-registration-publish-v1/source.mjs';
import { dahliaFirstPurchaseProtocol as firstPurchaseProtocol } from '../platform-registration-publish-v1/contract.mjs';
import { canonical, hash, same } from './contract.mjs';
import { buildFirstPurchaseActivationTemplates, scope, draft } from './first-purchase-activation.mjs';
import { firstPurchaseAws } from './first-purchase-activation-aws.mjs';
import { firstPurchaseDatabase } from './first-purchase-activation-db.mjs';
import { validSandboxPurchaseScope } from '../../lib/purchases/sandbox-first-purchase-config.ts';

const reviewPath='docs/evidence/sandbox-first-purchase-dahlia-size-fix-activation.review.json';
const riskDoc='docs/aws-sandbox-first-purchase-dahlia-size-fix-activation-review.md';
const ciPath='docs/evidence/sandbox-first-purchase-dahlia-size-fix-publisher.observed.json';
const continuationPath='docs/evidence/sandbox-first-purchase-dahlia-continuation.review.json';
const continuationRisk='docs/aws-sandbox-first-purchase-dahlia-continuation-review.md';
const continuationReceipt='docs/evidence/sandbox-first-purchase-dahlia-size-fix-activation-stopped.json';
const continuationReceiptSha='d57d6b13f303b3b78fabbfb4898d8ee5342b91b96b7f083c5b09dc66ce3fbcc4';
const aclRecoveryPath='docs/evidence/sandbox-first-purchase-dahlia-acl-recovery.review.json';
const aclRecoveryRisk='docs/aws-sandbox-first-purchase-dahlia-acl-recovery-review.md';
const aclRecoveryStop='docs/evidence/sandbox-first-purchase-dahlia-continuation-stopped.json';
const aclRecoveryStopSha='3708792734536c482a49081c07edf10b699eae166f0ad026b23c56f03f7777e6';
const aclRecoveryFix=Object.freeze({commit:'614d8ca2efc95548fad53675b69aab88be42fe50',pg18CiRun:44429410826,
  file:'ops/platform-ecs-v1/first-purchase-activation-db.mjs'});
const approvalDocChanges=[reviewPath,continuationPath,aclRecoveryPath,'docs/aws-auto-deployment-execution-runbook.md','docs/aws-auto-deployment-mainline.md',
  'docs/aws-sandbox-first-purchase-activation-preparation.md'];
const checkoutScopeHash='7359ccf32c3bebd4c4b754caac4cdfbdd471a8202c9206f67a298a8f020ca0fc';
const code=(ok,g)=>{if(!ok)throw Error('FIRST_PURCHASE_REVIEW_'+g);};
const local=path.join(ROOT,'.local-secrets');
const privateName='sandbox-first-purchase-stripe-test.json', signingName='sandbox-first-purchase-stripe-webhook-test.json';
const prefix='techlong-platform-recovery-image-v1';
const slot=path.join(local,'sandbox-first-purchase-dahlia-14480476839-size-fix.intent.json');
const continuationSlot=path.join(local,'sandbox-first-purchase-dahlia-14480476839-remaining.intent.json');
const aclRecoverySlot=path.join(local,'sandbox-first-purchase-dahlia-14480476839-acl-fix.intent.json');
const previous=Object.freeze({
  approvedSha256:'8b35a3584a5b71e3eb74d7950e66a403cfe2ce3806db434febc04edee0abf25d',
  resultPath:'techlong-platform-recovery-image-v1-74c452f0d964045a2928105f22d2a34b/activation-result.json',
  resultSha256:'b6cb5a44db47c77f6605f422dba0df1a64564b0f0645f2e2f6459826262104e0',
  intentFile:'sandbox-first-purchase-activation-v1.intent.json',
  publisherIntentFile:'techlong-sandbox-first-purchase-ecr-b344a2e3.intent.json',
});
const stoppedDahlia=Object.freeze({
  approvedSha256:'a237b03defde391c17b5471422303090fd3c2bd9333a9fb6d8a6cf39c55f5040',
  receipt:'docs/evidence/sandbox-first-purchase-dahlia-activation-stopped.json',
  receiptSha256:'800af4a4f560a3d84a0e34f553a2be440c89a249b2d517b56680960fa61d2c33',
  resultPath:'techlong-platform-recovery-image-v1-c020226941a9213629cdae255ddcb9d8/activation-result.json',
  intentFile:'sandbox-first-purchase-dahlia-14480476839.intent.json',
  publisherIntentFile:'techlong-sandbox-first-purchase-ecr-cdfa2e16.intent.json',
  runId:44421699935,
});
const total=95*60000, approvalWindow=24*3600000, preflightMax=10*60000;
const continuationTotal=60*60000, platformContinuationMetadata=200, publisherReadMetadata=17;
export const dahliaEndpoint=Object.freeze({
  url:draft.runtimeMaterial.stripeEndpoint,
  apiVersion:'2026-05-27.dahlia',
  events:Object.freeze(['charge.refunded','checkout.session.completed','checkout.session.expired','payment_intent.payment_failed','payment_intent.succeeded']),
});
const meta={stripeAuthenticatedGets:5,stripeApiWrites:0,operatorStripeDashboardEndpointCreatesIfAbsent:0,
  sourceSts:11,awsMetadata:440,gitHubGets:213,githubCredentialLoads:1,fixedArtifactDownloadsInWorkflow:1,
  workflowGitHubApiGets:3,workflowSts:2,workflowRoleSessions:1,workflowExplicitEcrReads:3,
  stripePrivateFiles:2,configReads:1,neonTlsConnections:3,neonSqlSubmissions:76,anonymousTechnicalGets:2};
const writes={publisherGrantUpdates:1,publisherRevokeUpdates:1,protectedDispatch:1,topLevelEcrPush:1,
  neonInstallTransactions:1,newEmptySecret:1,newPolicy:1,newSecretVersion:1,accessChangeSetCreate:1,accessChangeSetExecute:1,
  hostingChangeSetCreate:1,hostingChangeSetExecute:1,checkoutOrTaskBusinessWrites:0,repeats:0,deletes:0};
const candidate=firstPurchaseProtocol.P;
const pub=dahliaFirstPurchaseSourceContext(dahliaSealedSizeFix);
const normalize=t=>t.replaceAll('\r\n','\n');
const fingerprint=x=>hash(canonical(x));

export function makeFirstPurchaseReview({implementationCommit,nonce,issuedAt,riskSha256},ciEvidence){
  code(ciEvidence?.status==='NO_AWS_PUBLISHER_AND_CALLER_CI_VERIFIED'&&ciEvidence.repositoryId===candidate.repositoryId&&
    ciEvidence.workflowId===422828156&&ciEvidence.callerWorkflowId===422829965&&ciEvidence.publishDispatched===false&&
    ciEvidence.awsIdentity===false&&ciEvidence.executionAuthorized===false&&
    ciEvidence.reusable?.commit===pub.S.reusableCommit&&ciEvidence.reusable.runId===pub.S.reusableCiRun&&
    ['reusable','caller'].every(k=>/^[a-f0-9]{40}$/.test(ciEvidence[k]?.commit??'')&&Number.isSafeInteger(ciEvidence[k].runId)&&
      ciEvidence[k].runId>0&&ciEvidence[k].conclusion==='success'&&ciEvidence[k].headBranch==='main'&&
      ciEvidence[k].event==='push'&&ciEvidence[k].attempt===1),'CI_PINS');
  const issued=Date.parse(issuedAt);
  const artifactEnd=Date.parse(candidate.artifactExpiresAt);
  const hardStop=Math.min(issued+approvalWindow+total,artifactEnd);
  const latestStart=hardStop-total;
  code(/^[a-f0-9]{40}$/.test(implementationCommit)&&/^[a-f0-9]{32}$/.test(nonce)&&/^[a-f0-9]{64}$/.test(riskSha256)&&
    Number.isFinite(issued)&&issued>=Date.parse(ciEvidence.observedAtUtc)&&issued<latestStart,'REVIEW_WINDOW');
  return {schema:'techlong/sandbox-first-purchase-activation-reviewed/v4',implementationCommit,nonce,issuedAt,riskSha256,
    latestStartUtc:new Date(latestStart).toISOString(),hardStopUtc:new Date(hardStop).toISOString(),totalMinutesMax:95,
    preflight:{freshReadbacksAfterApprovalAndBeforeFirstRemoteWrite:true,maxMinutesBeforeFirstRemoteWrite:10,
      originalSnapshotEndedUtc:draft.originalSnapshot.usableBeforeUtc,originalSnapshotUse:'expected baseline only, never current authority',
      exactTenantImageManifestAndExistingKmsPolicy:true},
    artifactExpiresAtUtc:candidate.artifactExpiresAt,
    priorAttempt:{...previous,requireNoRemoteWriteAndNoPublisherIntent:true},
    stoppedDahlia:{...stoppedDahlia,requireSkippedPushAndLocked:true,preserveBothUsedSlots:true},
    sourceCi:{publisherRun:ciEvidence.caller.runId,publisherCommit:ciEvidence.caller.commit,reusableRun:pub.S.reusableCiRun,
      reusableCommit:pub.S.reusableCommit,callerWorkflowId:ciEvidence.callerWorkflowId,postgres18Run:44374702186},
    target:{...scope,workspaceIdSha256:checkoutScopeHash,originalNeonProjectionSha256:draft.originalSnapshot.privateReceiptSha256.neon,
      originalAwsProjectionSha256:draft.originalSnapshot.privateReceiptSha256.aws},
    candidate:{buildRun:candidate.runId,attempt:1,artifact:candidate.artifactId,zipSha256:candidate.artifactDigest,archiveBytes:candidate.archiveBytes,
      configDigest:candidate.imageConfigDigest,recipe:candidate.sourceRecipeSha256,tree:candidate.sourceTreeOid,
      exactTag:candidate.targetTag,repository:candidate.ecrRepository,publisherStack:candidate.stackId,environment:candidate.environment},
    stripe:{endpoint:dahliaEndpoint.url,events:dahliaEndpoint.events,apiVersion:dahliaEndpoint.apiVersion,firstPurchasePaymentMethod:'card',
      mode:'sandbox / your account / snapshot',credentialFilename:privateName,signingFilename:signingName,
      newSecretName:draft.runtimeMaterial.newSecretName},
    limits:meta,writes,safety:'Only this one window; always revoke the temporary ECR Grant after any possible submission. Keep managed CFN rollback; no additional recovery, write retry, payment, job claim or full worker.'};
}

export function validateFirstPurchaseReview(text,approvedSha,now=Date.now(),ciEvidence=JSON.parse(readFileSync(path.join(ROOT,ciPath),'utf8'))){
  code(/^[a-f0-9]{64}$/.test(approvedSha??'')&&hash(normalize(text))===approvedSha,'APPROVAL_SHA');
  const m=JSON.parse(text);
  code(m?.schema==='techlong/sandbox-first-purchase-activation-reviewed/v4','REVIEW_FORMAT');
  code(same(m,makeFirstPurchaseReview(m,ciEvidence))&&Date.parse(m.issuedAt)<=now&&now<Date.parse(m.latestStartUtc)&&
    now+total<Date.parse(m.artifactExpiresAtUtc),'REVIEW_EXPIRED_OR_CHANGED');
  return m;
}

function readContinuationFacts(){
  const read=p=>normalize(readFileSync(path.join(ROOT,p),'utf8'));
  const raw=read(continuationReceipt),outer=read(reviewPath);
  code(hash(raw)===continuationReceiptSha,'CONTINUATION_EVIDENCE');
  const stopped=JSON.parse(raw),old=JSON.parse(outer),p=stopped.publisher;
  code(hash(outer)===stopped.approvalSha256&&p.runConclusion==='success'&&p.runAttempt===1&&p.dispatchCount===1&&
    p.artifactId===candidate.artifactId&&p.revokedRoleReadBackLocked===true&&p.revokeAcknowledged===true&&
    p.independentPublicationProofRecorded===false&&stopped.preflight.verified===true&&
    !stopped.neonInstallExecuted&&!stopped.newSecretWritten&&!stopped.platformUpdated&&!stopped.retryAllowed,'CONTINUATION_PREDECESSOR');
  return {old,stopped};
}

export function makeContinuationReview({implementationCommit,nonce,issuedAt,riskSha256}){
  const {old,stopped}=readContinuationFacts(),issued=Date.parse(issuedAt);
  const start=Math.min(issued+approvalWindow,Date.parse(old.latestStartUtc),Date.parse(old.hardStopUtc)-continuationTotal);
  code(/^[a-f0-9]{40}$/.test(implementationCommit??'')&&/^[a-f0-9]{32}$/.test(nonce??'')&&nonce!==old.nonce&&
    /^[a-f0-9]{64}$/.test(riskSha256??'')&&issued>=Date.parse(stopped.completedAtUtc)&&issued<start,'CONTINUATION_WINDOW');
  return {schema:'techlong/sandbox-first-purchase-post-publication/v1',implementationCommit,nonce,issuedAt,riskSha256,
    latestStartUtc:new Date(start).toISOString(),hardStopUtc:old.hardStopUtc,totalMinutesMax:60,
    preflight:{...old.preflight,firstWriteRequiresIndependentEcrAndLockedProof:true},
    predecessor:{approvalSha256:stopped.approvalSha256,receiptSha256:continuationReceiptSha,runId:stopped.publisher.runId,
      dispatchCommit:stopped.publisher.head,preserveBothUsedSlots:true},
    sourceCi:old.sourceCi,target:old.target,candidate:old.candidate,stripe:old.stripe,
    limits:{sourceSts:5,awsMetadata:platformContinuationMetadata+publisherReadMetadata,githubApiGets:0,githubCredentialLoads:0,
      artifactDownloads:0,stripePrivateFiles:2,stripeAuthenticatedGets:5,configReads:1,neonTlsConnections:3,
      neonSqlSubmissions:76,anonymousTechnicalGets:2},
    writes:{...old.writes,publisherGrantUpdates:0,publisherRevokeUpdates:0,protectedDispatch:0,topLevelEcrPush:0},
    safety:'Verify existing immutable ECR manifest and Locked, then finish original narrow installation and access/hosting update only. No publishing, retries, cleanup, test checkout, or worker enablement.'};
}

export function validateContinuationReview(text,approvedSha,now=Date.now()){
  code(/^[a-f0-9]{64}$/.test(approvedSha??'')&&hash(normalize(text))===approvedSha,'APPROVAL_SHA');
  const m=JSON.parse(text);
  code(m?.schema==='techlong/sandbox-first-purchase-post-publication/v1','CONTINUATION_FORMAT');
  code(same(m,makeContinuationReview(m))&&Date.parse(m.issuedAt)<=now&&now<Date.parse(m.latestStartUtc)&&
    now+continuationTotal<=Date.parse(m.hardStopUtc),'CONTINUATION_EXPIRED_OR_CHANGED');
  return m;
}

function readAclRecoveryFacts(){
  const read=p=>normalize(readFileSync(path.join(ROOT,p),'utf8'));
  const raw=read(aclRecoveryStop),prior=read(continuationPath);
  code(hash(raw)===aclRecoveryStopSha,'ACL_RECOVERY_STOP_EVIDENCE');
  const stopped=JSON.parse(raw),previous=validateContinuationReview(prior,stopped.approvalSha256,Date.parse(JSON.parse(prior).issuedAt));
  const p=stopped.existingPublication;
  code(stopped.outcome==='STOPPED_BEFORE_NEON_INSTALL_COMMIT'&&stopped.neon.failedBeforeCommitIntent===true&&
    stopped.neon.installCommitSent===false&&stopped.neon.error==='FIRST_PURCHASE_DB_INSTALLED_ROLE_OR_ACL'&&
    stopped.awsWrites===0&&!stopped.secretWritten&&!stopped.platformUpdated&&!stopped.retryAllowed&&
    stopped.preflight.verified===true&&p.locked===true&&p.runId===previous.predecessor.runId&&
    p.artifactId===candidate.artifactId&&p.imageConfigDigest===candidate.imageConfigDigest,'ACL_RECOVERY_PREDECESSOR');
  return {previous,stopped};
}

export function makeAclRecoveryReview(input){
  const {previous,stopped}=readAclRecoveryFacts(),p=stopped.existingPublication;
  const base=makeContinuationReview(input);
  code(input.nonce!==previous.nonce&&Date.parse(input.issuedAt)>=Date.parse(stopped.completedAtUtc)&&
    Date.parse(base.latestStartUtc)<=Date.parse(previous.latestStartUtc)&&base.hardStopUtc===previous.hardStopUtc,
    'ACL_RECOVERY_WINDOW');
  return {...base,schema:'techlong/sandbox-first-purchase-after-acl-correction/v1',
    fix:aclRecoveryFix,predecessor:{...base.predecessor,preCommitStopApprovalSha256:stopped.approvalSha256,
      preCommitStopReceiptSha256:aclRecoveryStopSha,installCommitSent:false},
    preflight:{...previous.preflight,requireVacantInstallationObjectsBeforeWrite:true,
      publisherLockEvidence:'reuse exact previous independent receipt',firstWriteRequiresFreshExactEcrDigest:true},
    existingImage:{manifestDigest:p.manifestDigest,imageConfigDigest:p.imageConfigDigest,layerCount:p.layerCount,
      lockedProofReceiptSha256:p.independentReceiptSha256},
    limits:{...base.limits,sourceSts:4,awsMetadata:platformContinuationMetadata+1},
    safety:'Require fresh absence of prior install objects; reuse prior Locked proof with one exact ECR manifest check, then finish the original narrow installation. No publisher changes, redeploy of image, retries, cleanup or test checkout.'};
}

export function validateAclRecoveryReview(text,approvedSha,now=Date.now()){
  code(/^[a-f0-9]{64}$/.test(approvedSha??'')&&hash(normalize(text))===approvedSha,'APPROVAL_SHA');
  const m=JSON.parse(text);
  code(m?.schema==='techlong/sandbox-first-purchase-after-acl-correction/v1','ACL_RECOVERY_FORMAT');
  code(same(m,makeAclRecoveryReview(m))&&Date.parse(m.issuedAt)<=now&&now<Date.parse(m.latestStartUtc)&&
    now+continuationTotal<=Date.parse(m.hardStopUtc),'ACL_RECOVERY_EXPIRED_OR_CHANGED');
  return m;
}

export async function runFirstPurchaseStages(ports,{continuation=false}={}){
  await ports.preflight();
  const publisher=await (continuation?ports.inspectPublished():ports.publish());
  code(publisher?.locked===true,'PUBLISHER_LOCK_NOT_PROVED');
  const webhookDatabaseUrl=await ports.install();
  const secret=await ports.store(webhookDatabaseUrl);
  const targets=ports.templates(publisher,secret);
  await ports.update('access',targets.access);
  await ports.update('hosting',targets.hosting);
  await ports.inspect(targets);
}

function sourceGuard(m){
  environment();
  code(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&
    git(['diff','--name-only',m.implementationCommit,'HEAD']).trim().split(/\r?\n/).filter(Boolean).every(x=>approvalDocChanges.includes(x)),
    'LOCAL_MAIN_OR_CODE_DRIFT');
  git(['merge-base','--is-ancestor',m.implementationCommit,'HEAD']);
  const head=git(['rev-parse','HEAD']).trim();
  if(m.schema==='techlong/sandbox-first-purchase-after-acl-correction/v1'){
    git(['merge-base','--is-ancestor',aclRecoveryFix.commit,m.implementationCommit]);
    code(normalize(git(['show',head+':'+aclRecoveryFix.file]))===
      normalize(git(['show',aclRecoveryFix.commit+':'+aclRecoveryFix.file])),'ACL_FIX_CHANGED');
  }
  code(normalize(git(['show',head+':.github/workflows/'+candidate.callerFile]))===
    normalize(git(['show',m.sourceCi.publisherCommit+':.github/workflows/'+candidate.callerFile])),'CALLER_WORKFLOW_DRIFT');
  return head;
}

function privateAcl(...files){
  code(process.platform==='win32','LOCAL_OS');
  const one=s=>"'"+s.replaceAll("'","''")+"'";
  const command=`$ErrorActionPreference='Stop'
$self=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allow=@($self,'S-1-5-18','S-1-5-32-544')
foreach($p in @(${files.map(one).join(',')})){
  $v=Get-Item -LiteralPath $p -Force
  if(($v.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse'}
  $a=Get-Acl -LiteralPath $p
  if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $self){throw 'Owner'}
  $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow'})
  if(@($rules | Where-Object {$_.IdentityReference.Value -notin $allow}).Count -ne 0){throw 'Acl'}
  if(@($rules | Where-Object {$_.IdentityReference.Value -eq $self -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData)}).Count -eq 0){throw 'Read'}
}
'PRIVATE_ACL_OK'`;
  const p=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:32768});
  code(p.status===0&&p.stdout.trim()==='PRIVATE_ACL_OK','PRIVATE_FILE_MISSING_OR_ACL');
}
function excluded(file){
  const rel=path.relative(ROOT,file).replaceAll('\\','/');
  git(['check-ignore','--quiet','--',rel]);
  code(!git(['ls-files','--',rel]).trim(),'PRIVATE_FILE_TRACKED');
}
async function privateJson(p,expected){
  const text=await readText(p,2*1024*1024);
  if(expected)code(hash(text)===expected,'PRIVATE_RECEIPT_CHANGED');
  return JSON.parse(text);
}
async function verifyPriorNoRemoteWrite(){
  const slot=await privateJson(path.join(local,previous.intentFile));
  const result=await privateJson(path.join(EVIDENCE,previous.resultPath),previous.resultSha256);
  code(slot.approvedSha===previous.approvedSha256&&slot.retry===false&&result.approvedSha===previous.approvedSha256&&
    result.outcome==='STOPPED_REQUIRES_INSPECTION'&&result.stage==='necessary-preflight'&&
    result.code==='FIRST_PURCHASE_REVIEW_STRIPE_EXACT_ENDPOINT'&&result.aws?.writes===0&&result.retry===false,'EARLIER_ATTEMPT_NOT_PROVED');
  await absent(path.join(EVIDENCE,previous.publisherIntentFile));
}
async function readDahliaStop(){
  const raw=normalize(await readText(path.join(ROOT,stoppedDahlia.receipt)));
  code(hash(raw)===stoppedDahlia.receiptSha256,'DAHLIA_STOP_RECEIPT_CHANGED');
  const s=JSON.parse(raw),p=s.publisher;
  code(s.approvalSha256===stoppedDahlia.approvedSha256&&p.runId===stoppedDahlia.runId&&p.buildArtifactId===candidate.artifactId&&
    p.awsPublisherSessionAndPushStep==='skipped'&&p.revokeAcknowledged&&p.revokedRoleReadBackLocked&&
    !p.newEcrManifestVerified&&!s.neonInstallExecuted&&!s.newSecretWritten&&!s.platformUpdated&&!s.retryAllowed,'DAHLIA_STOP_NOT_PROVED');
  return s;
}
async function verifyStoppedDahlia(){
  const s=await readDahliaStop();
  const priorSlot=await privateJson(path.join(local,stoppedDahlia.intentFile));
  const priorPublish=await privateJson(path.join(EVIDENCE,stoppedDahlia.publisherIntentFile));
  const final=await privateJson(path.join(EVIDENCE,stoppedDahlia.resultPath),s.finalResultSha256);
  code(priorSlot.approvedSha===s.approvalSha256&&priorSlot.retry===false&&priorPublish.retryAllowed===false&&
    hash(priorPublish.innerReview)===priorPublish.innerSha256&&priorPublish.head===s.publisher.head&&
    JSON.parse(priorPublish.innerReview).candidate.artifactId===candidate.artifactId&&
    final.approvedSha===s.approvalSha256&&final.stage==='publish-and-lock'&&final.outcome==='STOPPED_REQUIRES_INSPECTION'&&
    final.retry===false,'DAHLIA_PRIOR_ATTEMPT_NOT_PROVED');
}
async function verifyContinuationJournal(){
  const {old,stopped}=readContinuationFacts(),p=stopped.publisher,oldSha=stopped.approvalSha256;
  const journal=path.join(EVIDENCE,prefix+'-'+old.nonce);
  const priorSlot=await privateJson(slot);
  const pubSlot=await privateJson(path.join(EVIDENCE,pub.S.intentFile));
  const prev=await privateJson(path.join(journal,'activation-publish-result.json'),p.resultSha256);
  const run=await privateJson(path.join(journal,'activation-publish-run-completed.json'),p.runCompletedSha256);
  const final=await privateJson(path.join(journal,'activation-result.json'),stopped.finalResultSha256);
  const inner=firstPurchaseProtocol.validateReview(pubSlot.innerReview,pubSlot.innerSha256,Date.parse(pubSlot.startedAtUtc));
  code(priorSlot.approvedSha===oldSha&&priorSlot.retry===false&&pubSlot.retryAllowed===false&&
    pubSlot.nonce===old.nonce&&inner.nonce===old.nonce&&pubSlot.head===p.head&&inner.dispatchCommit===p.head&&
    inner.reusableCommit===dahliaSealedSizeFix.reusableCommit&&
    [prev,run,final].every(j=>j.approvedSha===oldSha)&&prev.innerSha256===pubSlot.innerSha256&&
    prev.locked===true&&prev.runId===p.runId&&prev.published===null&&
    same(prev.errors,[{stage:'publication_inspect',code:'PLATFORM_PUBLISH_V2_SOURCE_STS_BUDGET'}])&&
    run.id===p.runId&&run.head_sha===p.head&&run.run_attempt===1&&run.status==='completed'&&run.conclusion==='success'&&
    final.stage==='publish-and-lock'&&final.outcome==='STOPPED_REQUIRES_INSPECTION'&&final.aws?.writes===0&&final.retry===false,
    'CONTINUATION_JOURNAL_CHANGED');
  return inner;
}

async function verifyExistingPublication(m,inner,record){
  const aws=await createAws({protocol:firstPurchaseProtocol,request:pub.updateRequest,sourceLogin:true,
    readOnly:true,metadataLimit:publisherReadMetadata,stsLimit:2});
  try{
    const view=await aws.snapshot(), proof=await aws.published();
    code(verifySnapshot(view,firstPurchaseProtocol.templates(inner).revoke).locked,'CONTINUATION_PUBLISHER_NOT_LOCKED');
    firstPurchaseProtocol.verifyFinalInventory(view.images,proof.verified.manifestDigest);
    const result={locked:true,artifactId:candidate.artifactId,sourceRecipeSha256:candidate.sourceRecipeSha256,
      sourceTreeOid:candidate.sourceTreeOid,...proof.verified,runId:m.predecessor.runId};
    await record('existing-publication-independently-verified',result);return result;
  }finally{aws.close();}
}

async function readAclRecoveryJournal(){
  const {previous,stopped}=readAclRecoveryFacts(),p=stopped.existingPublication;
  const journal=path.join(EVIDENCE,prefix+'-'+previous.nonce);
  const used=await privateJson(continuationSlot);
  const proof=await privateJson(path.join(journal,'activation-existing-publication-independently-verified.json'),p.independentReceiptSha256);
  const final=await privateJson(path.join(journal,'activation-result.json'),stopped.finalResultSha256);
  code([used,proof,final].every(j=>j.approvedSha===stopped.approvalSha256)&&used.retry===false&&final.retry===false&&
    final.outcome==='STOPPED_REQUIRES_INSPECTION'&&final.stage==='install-neon'&&final.code===stopped.neon.error&&
    final.aws?.writes===0&&proof.locked===true&&proof.artifactId===p.artifactId&&proof.runId===p.runId&&
    proof.manifestDigest===p.manifestDigest&&proof.imageConfigDigest===p.imageConfigDigest&&proof.layerCount===p.layerCount&&
    proof.sourceRecipeSha256===candidate.sourceRecipeSha256&&proof.sourceTreeOid===candidate.sourceTreeOid,'ACL_RECOVERY_JOURNAL_CHANGED');
  for(const marker of ['db-commit-intent','db-commit-ack','secret-create-intent'])await absent(path.join(journal,'activation-'+marker+'.json'));
  return proof;
}

async function reuseVerifiedImage(proof,record){
  const aws=await createAws({protocol:firstPurchaseProtocol,sourceLogin:true,readOnly:true,metadataLimit:1,stsLimit:1});
  try{
    const {verified}=await aws.published();
    const {manifestDigest,imageConfigDigest,layerCount,artifactId,sourceRecipeSha256,sourceTreeOid,runId}=proof;
    code(same(verified,{manifestDigest,imageConfigDigest,layerCount}),'ACL_RECOVERY_ECR_DRIFT');
    const result={...verified,artifactId,sourceRecipeSha256,sourceTreeOid,runId,locked:true};
    await record('existing-image-digest-confirmed',{...result,lockProofReused:true});return result;
  }finally{aws.close();}
}
export function verifyDahliaStripeEndpoint(rows,endpointId){
  code(rows.object==='list'&&rows.has_more===false&&Array.isArray(rows.data),'STRIPE_ENDPOINT_LIST');
  const matches=rows.data.filter(x=>{try{
    const u=new URL(x.url);return u.hostname.toLowerCase().replace(/\.$/,'')==='console.sandbox.techlong.cloud'&&
      u.pathname.toLowerCase().replace(/\/+$/,'')==='/api/stripe/webhook';
  }catch{return false;}});
  const w=matches[0];
  code(matches.length===1&&w.id===endpointId&&w.url===dahliaEndpoint.url&&w.object==='webhook_endpoint'&&
    w.livemode===false&&w.status==='enabled'&&w.application==null,'STRIPE_ENDPOINT_IDENTITY');
  code(w.api_version===dahliaEndpoint.apiVersion,'STRIPE_ENDPOINT_VERSION');
  code(Array.isArray(w.enabled_events)&&same([...w.enabled_events].sort(),dahliaEndpoint.events),'STRIPE_ENDPOINT_EVENTS');
}
async function stripeGate(t,s,until){
  const test=/^rk_test_[A-Za-z0-9_]{8,512}$/;
  code(same(Object.keys(t).sort(),['accountId','inspectionKey','runtimeKey'])&&/^acct_[A-Za-z0-9]{6,90}$/.test(t.accountId)&&
    test.test(t.runtimeKey)&&test.test(t.inspectionKey)&&t.runtimeKey!==t.inspectionKey&&
    same(Object.keys(s).sort(),['endpointId','signingSecret'])&&/^we_[A-Za-z0-9]{1,90}$/.test(s.endpointId)&&
    /^whsec_[A-Za-z0-9_]{8,512}$/.test(s.signingSecret),'STRIPE_PRIVATE_SHAPE');
  async function get(route,key){
    code(Date.now()+15000<until,'STRIPE_WINDOW');
    const r=await fetch('https://api.stripe.com'+route,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+key,Accept:'application/json'}});
    if(r.status!==200){await r.body?.cancel().catch(()=>{});code(false,'STRIPE_METADATA_HTTP');}
    code(r.body,'STRIPE_METADATA_BODY');
    const rd=r.body.getReader(),chunks=[];let size=0;
    try{for(;;){const b=await rd.read();if(b.done)break;size+=b.value.length;code(size<=1048576,'STRIPE_METADATA_SIZE');chunks.push(b.value);}}
    finally{await rd.cancel().catch(()=>{});rd.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  for(const k of [t.runtimeKey,t.inspectionKey]){
    const a=await get('/v1/account',k);
    code(a.object==='account'&&a.id===t.accountId,'STRIPE_ACCOUNT');
    const b=await get('/v1/balance',k);
    code(b.object==='balance'&&b.livemode===false,'STRIPE_MODE');
  }
  const rows=await get('/v1/webhook_endpoints?limit=100',t.inspectionKey);
  verifyDahliaStripeEndpoint(rows,s.endpointId);
  return {stripeTestKey:t.runtimeKey,stripeTestWebhookSecret:s.signingSecret};
}

async function publish(m,until,preflightBy,heads,notify,record){
  const latest=until-25*60000, issued=Date.now();
  code(issued+3600000<latest,'INSUFFICIENT_PUBLICATION_AND_UPDATE_TIME');
  const pHead=heads(),commonRoots=['ops/platform-registration-publish-v1/cloud.mjs','ops/platform-registration-publish-v1/artifact.mjs',
    'ops/platform-registration-publish-v1/preflight.sh','ops/platform-registration-publish-v1/extract.py',
    '.github/workflows/'+candidate.reusableFile,'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json',
    'docs/evidence/sandbox-first-purchase-replacement.observed.json','docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json',
    'docs/evidence/sandbox-first-purchase-dahlia.prepared.json','docs/evidence/sandbox-first-purchase-dahlia.observed.json'];
  const sourcePins=await pins({roots:commonRoots});
  for(const f of sourcePins)code(hash(normalize(git(['show',pub.S.reusableCommit+':'+f.file])))===f.sha256,'REUSABLE_FILE_DRIFT');
  const innerOuter={schema:pub.S.schema,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(latest).toISOString(),
    latestStartAt:new Date(latest-3600000).toISOString(),nonce:m.nonce,operatorSourceCommit:m.sourceCi.publisherCommit,
    sourceCiRunId:m.sourceCi.publisherRun,callerWorkflowId:m.sourceCi.callerWorkflowId,sourcePins,
    riskSha256:hash(normalize(await readText(path.join(ROOT,pub.S.riskFile)))),candidate,reusableCommit:pub.S.reusableCommit,scope:pub.S.scope};
  const text=JSON.stringify(innerOuter);
  const request=(inner,phase)=>{
    if(phase==='grant')code(Date.now()<preflightBy,'PREFLIGHT_EXPIRED');
    return pub.updateRequest(inner,phase);
  };
  const a=await createAws({protocol:firstPurchaseProtocol,request,sourceLogin:true,metadataLimit:238,stsLimit:6});
  const g=createGithub({context:pub,maxGets:213});let attempted=false,before,inner;
  const bindings=s=>fingerprint({roleTags:s.role.Role.Tags,stackTags:s.stack.Stacks[0].Tags,boundary:s.boundary.Policy,repository:s.repository.repositories});
  try{
    const result=await runControlled({text,approvedSha:hash(text),review:pub,ports:{
      async preflight(){
        await absent(path.join(EVIDENCE,pub.S.intentFile));
        before=await a.snapshot();
        const now=Date.now(),draftInner=pub.innerReview(innerOuter,pHead,now);
        verifySnapshot(before,firstPurchaseProtocol.templates(draftInner).revoke);firstPurchaseProtocol.verifyRetained(before.images);
        await g.metadata(pHead,innerOuter);
        code(heads()===pHead&&Date.now()-Date.parse(before.startedAtUtc)<120000,'PUBLISHER_PREFLIGHT_DRIFT');return pHead;
      },consume:v=>writeOnce(path.join(EVIDENCE,pub.S.intentFile),v),record:(name,v)=>record('publish-'+name,v),
      async update(r,phase){
        inner=r;
        if(phase==='grant'){
          code(heads()===pHead&&Date.now()<preflightBy&&Date.now()+60000<Date.parse(r.grantExpiresAt)&&
            Date.parse(r.grantExpiresAt)<=latest,'PUBLISHER_WRITE_WINDOW');
          await record('publish-grant-intent',{stack:candidate.stackId});
          const writesBefore=a.counts.writes;
          try{await record('publish-grant-ack',await a.update(r,'grant'));}
          finally{attempted=a.counts.writes>writesBefore;}
          return;
        }
        if(!attempted)return;
        try{await a.settled(Date.now()+10*60000);}catch{/* an attempted grant must still be revoked once */}
        try{await record('publish-revoke-intent',{stack:candidate.stackId});}catch{/* audit I/O must not suppress revoke */}
        await record('publish-revoke-ack',await a.update(r,'revoke'));
      },
      async verify(r,phase){
        await a.settled(Date.now()+10*60000);
        const state=await a.snapshot();verifySnapshot(state,firstPurchaseProtocol.templates(r)[phase]);
        code(bindings(state)===bindings(before),'PUBLISHER_REFERENCE_DRIFT');
        if(phase==='grant')firstPurchaseProtocol.verifyRetained(state.images);
      },
      dispatch(r,txt,sha){code(heads()===pHead,'PUBLISHER_DISPATCH_HEAD');return g.dispatch(r,txt,sha);},
      wait:(ack,r,sha,id)=>g.wait(ack,r,sha,id,async v=>{await record('publish-human-gate',v);notify(v);}),
      async published(){
        const proof=await a.published(),view=await a.snapshot();
        verifySnapshot(view,firstPurchaseProtocol.templates(inner).revoke);
        firstPurchaseProtocol.verifyFinalInventory(view.images,proof.verified.manifestDigest);
        code(bindings(view)===bindings(before),'PUBLISHER_FINAL_DRIFT');return proof.verified;
      },
    }});
    code(result.outcome==='PUBLISHED_AND_INDEPENDENTLY_LOCKED'&&result.locked,'PUBLISHER_STOP');
    const independent=await createAws({protocol:firstPurchaseProtocol,request:pub.updateRequest,sourceLogin:true,readOnly:true,metadataLimit:17,stsLimit:2});
    try{
      const view=await independent.snapshot(), proof=await independent.published();
      verifySnapshot(view,firstPurchaseProtocol.templates(inner).revoke);
      firstPurchaseProtocol.verifyFinalInventory(view.images,proof.verified.manifestDigest);
      code(bindings(view)===bindings(before)&&same(proof.verified,result.published),'PUBLISHER_INDEPENDENT_PROOF');
      const verified={locked:true,artifactId:candidate.artifactId,sourceRecipeSha256:candidate.sourceRecipeSha256,
        sourceTreeOid:candidate.sourceTreeOid,...proof.verified,runId:result.runId};
      await record('publish-independently-verified',verified);return verified;
    }finally{independent.close();}
  }finally{a.close();g.close();}
}

async function execute(approvedSha,notify,mode){
  const aclRecovery=mode==='FinishAfterAclFix',continuation=aclRecovery||mode==='ContinueReviewed';
  const text=await readText(path.join(ROOT,aclRecovery?aclRecoveryPath:continuation?continuationPath:reviewPath));
  const m=(aclRecovery?validateAclRecoveryReview:continuation?validateContinuationReview:validateFirstPurchaseReview)(text,approvedSha);
  const heads=()=>sourceGuard(m);
  heads();code(hash(normalize(await readText(path.join(ROOT,aclRecovery?aclRecoveryRisk:continuation?continuationRisk:riskDoc))))===m.riskSha256,'RISK_CHANGED');
  const tf=path.join(local,privateName),sf=path.join(local,signingName),config=path.join(ROOT,'.env.local');
  const activeSlot=aclRecovery?aclRecoverySlot:continuation?continuationSlot:slot;
  await absent(activeSlot);
  let oldInner,oldProof;
  if(aclRecovery)oldProof=await readAclRecoveryJournal();
  else if(continuation)oldInner=await verifyContinuationJournal();
  else{
    await verifyPriorNoRemoteWrite();
    await verifyStoppedDahlia();
    await absent(path.join(EVIDENCE,pub.S.intentFile));
  }
  for(const f of [tf,sf,config]){excluded(f);await noLinks(f);}
  privateAcl(local,tf,sf);
  const duration=continuation?continuationTotal:total;
  const start=Date.now(),until=Math.min(Date.parse(m.hardStopUtc),start+duration);
  code(start<Date.parse(m.latestStartUtc)&&until-start===duration,'REVIEW_START_MISSED');
  const preflightBy=start+preflightMax;
  const dir=await directory(prefix+'-'+m.nonce,{prefix});
  const record=(label,v)=>writeOnce(path.join(dir,'activation-'+label+'.json'),{utc:new Date().toISOString(),approvedSha,...v});
  await writeOnce(activeSlot,{approvedSha,startedAt:new Date(start).toISOString(),endsAt:new Date(until).toISOString(),retry:false});
  let stage='preflight',aws,db,stripe;
  const step=(name,work)=>(...args)=>{code(Date.now()<until,'RUN_EXPIRED');stage=name;notify({stage});return work(...args);};
  try{
    const w=await privateJson(path.join(local,'sandbox-first-onboarding-workspace-20261118.json'));
    const projection=await privateJson(path.join(local,'sandbox-first-purchase-readonly-a.neon.result.json'),m.target.originalNeonProjectionSha256);
    const awsFacts=await privateJson(path.join(local,'sandbox-first-purchase-readonly-a.aws.result.json'),m.target.originalAwsProjectionSha256);
    const prior=JSON.parse(await readText(path.join(ROOT,'docs/evidence/sandbox-registration-preflight.review.json'))).target.historicalPrivateTargetReceipt;
    const historic=await privateJson(prior.path,prior.sha256);
    const binding={workspaceId:w.workspaceId,planId:projection.checks.plans[0]?.plan_id,releaseId:scope.tenantReleaseId,imageUri:scope.tenantReleaseImage};
    code(hash(binding.workspaceId)===checkoutScopeHash&&validSandboxPurchaseScope(binding)&&w.releaseId===scope.tenantReleaseId&&
      w.productId===scope.productId&&w.environmentId===scope.environmentId&&w.deploymentProfileKey===scope.profile&&
      awsFacts.outcome==='AWS_READ_ONLY_VERIFIED'&&same(projection.findings,['STANDARD_PLAN_NOT_UNIQUE_OR_INVALID']),'ORIGINAL_FACTS');
    db=firstPurchaseDatabase({rawConfig:await readText(config,65536),historical:historic,projection:projection.checks,binding,deadline:until,record});
    aws=firstPurchaseAws({deadline:until,nonce:m.nonce,versionId:randomUUID(),prior:awsFacts.checks,record,
      ...(continuation?{metadataLimit:platformContinuationMetadata}:{})});
    await runFirstPurchaseStages({
      preflight:step('necessary-preflight',async()=>{const observedFrom=new Date().toISOString();
        if(aclRecovery){
          await db.preflight();
          await record('prior-install-objects-absent',{neonReadOnly:true,rolesAndSchemaAbsent:true});
          await aws.preflight();
        }else{await aws.preflight();await db.preflight();}
        const tc=await privateJson(tf),sc=await privateJson(sf);
        stripe=await stripeGate(tc,sc,preflightBy);
        code(Date.now()<preflightBy,'PREFLIGHT_EXPIRED');
        tc.runtimeKey=undefined;tc.inspectionKey=undefined;sc.signingSecret=undefined;
        await record('preflight-verified',{observedFrom,observedThrough:new Date().toISOString(),
          accountAndEndpointMatch:true,platformAndBusinessBaselineMatch:true});}),
      inspectPublished:step('verify-existing-publication',()=>aclRecovery?reuseVerifiedImage(oldProof,record):verifyExistingPublication(m,oldInner,record)),
      publish:step('publish-and-lock',()=>publish(m,until,preflightBy,heads,notify,record)),
      install:step('install-neon',()=>{if(continuation){heads();code(Date.now()<preflightBy,'PREFLIGHT_EXPIRED');}return db.install();}),
      store:step('store-runtime-secret',async webhookDatabaseUrl=>{try{return await aws.store({...stripe,webhookDatabaseUrl});}finally{stripe=undefined;}}),
      templates:(publisher,secret)=>buildFirstPurchaseActivationTemplates({...binding,publisher,secret}),
      update:(which,t)=>step('update-'+which,()=>aws.update(which,t))(),
      inspect:step('independent-technology-inspect',t=>aws.inspect(t)),
    },{continuation});
    await record('result',{outcome:'SANDBOX_FIRST_PURCHASE_ENABLED_TECHNICALLY_VERIFIED',aws:aws.counts,db:db.limits,businessTest:false,retry:false});
    return {outcome:'SANDBOX_FIRST_PURCHASE_ENABLED_TECHNICALLY_VERIFIED',evidenceDirectory:dir,businessTest:false};
  }catch(e){
    const safe=errorCode(e);
    await record('result',{outcome:'STOPPED_REQUIRES_INSPECTION',stage,code:safe,aws:aws?.counts,db:db?.limits,retry:false}).catch(()=>{});
    return {outcome:'STOPPED_REQUIRES_INSPECTION',stage,code:safe,evidenceDirectory:dir,retry:false};
  }finally{aws?.close();}
}

async function cli([mode,value,...extra]){
  if(mode==='PrepareAfterAclFixOffline'&&!value&&!extra.length){
    const implementationCommit=git(['rev-parse','HEAD']).trim();
    await absent(aclRecoverySlot);await absent(path.join(ROOT,aclRecoveryPath));
    const riskSha256=hash(normalize(await readText(path.join(ROOT,aclRecoveryRisk))));
    const m=makeAclRecoveryReview({implementationCommit,nonce:randomBytes(16).toString('hex'),issuedAt:new Date().toISOString(),riskSha256});
    sourceGuard(m);
    await writeOnce(path.join(ROOT,aclRecoveryPath),m);
    return {mode,approvalSha256:hash(normalize(await readText(path.join(ROOT,aclRecoveryPath)))),latestStartUtc:m.latestStartUtc,executed:false};
  }
  if(mode==='PrepareContinuationOffline'&&!value&&!extra.length){
    const implementationCommit=git(['rev-parse','HEAD']).trim();
    await absent(continuationSlot);await absent(path.join(ROOT,continuationPath));
    const riskSha256=hash(normalize(await readText(path.join(ROOT,continuationRisk))));
    const m=makeContinuationReview({implementationCommit,nonce:randomBytes(16).toString('hex'),issuedAt:new Date().toISOString(),riskSha256});
    sourceGuard(m);
    await writeOnce(path.join(ROOT,continuationPath),m);
    return {mode,approvalSha256:hash(normalize(await readText(path.join(ROOT,continuationPath)))),latestStartUtc:m.latestStartUtc,executed:false};
  }
  if(mode==='PrepareOffline'&&!value&&!extra.length){
    const implementationCommit=git(['rev-parse','HEAD']).trim();
    code(git(['status','--porcelain']).trim()===''&&git(['branch','--show-current']).trim()==='main','PREPARE_CLEAN_MAIN');
    await readDahliaStop();
    await absent(slot);await absent(path.join(EVIDENCE,pub.S.intentFile));
    const riskSha256=hash(normalize(await readText(path.join(ROOT,riskDoc))));
    const ciEvidence=JSON.parse(await readText(path.join(ROOT,ciPath)));
    const m=makeFirstPurchaseReview({implementationCommit,nonce:randomBytes(16).toString('hex'),issuedAt:new Date().toISOString(),riskSha256},ciEvidence);
    sourceGuard(m);
    await writeOnce(path.join(ROOT,reviewPath),m);
    const approvedSha=hash(normalize(await readText(path.join(ROOT,reviewPath))));
    return {mode,approvalSha256:approvedSha,latestStartUtc:m.latestStartUtc,executed:false};
  }
  code(['RunReviewed','ContinueReviewed','FinishAfterAclFix'].includes(mode)&&value&&!extra.length,'ARGUMENTS');
  return execute(value,msg=>console.log(JSON.stringify(msg)),mode);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r));if(r.outcome==='STOPPED_REQUIRES_INSPECTION')process.exitCode=1;})
    .catch(e=>{console.error(JSON.stringify({outcome:'NOT_STARTED',code:errorCode(e)}));process.exitCode=1;});
}
