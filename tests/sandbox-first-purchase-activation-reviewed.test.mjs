import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dahliaEndpoint, makeFirstPurchaseReview, validateFirstPurchaseReview, verifyDahliaStripeEndpoint,
  makeContinuationReview, validateContinuationReview, makeAclRecoveryReview, validateAclRecoveryReview,
  makeSourceRefreshReview, validateSourceRefreshReview,
  runFirstPurchaseStages } from '../ops/platform-ecs-v1/first-purchase-activate-reviewed.mjs';
import { buildFirstPurchaseActivationTemplates, checkoutRepairHostingTarget, billingRepairHostingTarget, draft } from '../ops/platform-ecs-v1/first-purchase-activation.mjs';
import { DAHLIA_FIRST_PURCHASE_CANDIDATE as candidate, FIRST_PURCHASE_CANDIDATE as oldCandidate,
  CHECKOUT_REPAIR_CANDIDATE as repair, BILLING_REPAIR_CANDIDATE as billing } from '../ops/platform-registration-publish-v1/contract.mjs';
import { dahliaSealedSizeFix } from '../ops/platform-registration-publish-v1/source.mjs';

test('Billing Hosting advances only the verified Checkout image and provenance',()=>{
  const dahlia='sha256:'+'1'.repeat(64),rev16='sha256:'+'2'.repeat(64),next='sha256:'+'3'.repeat(64);
  const proof=(c,manifestDigest)=>({locked:true,artifactId:c.artifactId,sourceRecipeSha256:c.sourceRecipeSha256,
    sourceTreeOid:c.sourceTreeOid,imageConfigDigest:c.imageConfigDigest,manifestDigest});
  const {hosting}=buildFirstPurchaseActivationTemplates({workspaceId:'wsp_'+'a'.repeat(24),planId:'pln_'+'b'.repeat(32),
    publisher:proof(candidate,dahlia),secret:{arn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/first-purchase-v1-AbCd09',
      versionId:'c34ca659-9a24-4f3e-b16f-ec824f32bc5f'}});
  const current=checkoutRepairHostingTarget(hosting,proof(repair,rev16),dahlia), copied=structuredClone(current);
  const target=billingRepairHostingTarget(current,proof(billing,next),rev16);
  assert.equal(target.stackId,current.stackId);
  assert.deepEqual(target.expectedChanges,['TaskDefinition:Modify:True','Service:Modify:False']);
  const expected=structuredClone(current.template);
  expected.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image=expected.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image.replace(rev16,next);
  expected.Metadata.ImageSource='sha256:'+billing.sourceRecipeSha256;
  expected.Metadata.ImageConfigDigest=billing.imageConfigDigest;
  assert.deepEqual(target.template,expected);
  assert.deepEqual(current,copied);
  assert.throws(()=>billingRepairHostingTarget(hosting,proof(billing,next),dahlia),/REPAIR_BASE_TEMPLATE/);
  assert.throws(()=>billingRepairHostingTarget(current,proof(repair,next),rev16),/REPAIR_PUBLISHER_PROOF/);
});

test('Checkout targets exactly the existing Hosting stack and only swaps image provenance',()=>{
  const baselineDigest='sha256:a27f4a5d101f884205d8e455fc68beeaadbc7136d190cf9ebf6c5055d9e50670';
  const nextDigest='sha256:'+'7'.repeat(64);
  const proof=(p,manifestDigest={})=>({locked:true,artifactId:p.artifactId,sourceRecipeSha256:p.sourceRecipeSha256,
    sourceTreeOid:p.sourceTreeOid,imageConfigDigest:p.imageConfigDigest,manifestDigest});
  const {hosting}=buildFirstPurchaseActivationTemplates({
    workspaceId:'wsp_'+'a'.repeat(24),planId:'pln_'+'b'.repeat(32),publisher:proof(candidate,baselineDigest),
    secret:{arn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/first-purchase-v1-AbCd09',
      versionId:'c34ca659-9a24-4f3e-b16f-ec824f32bc5f'},
  });
  const before=structuredClone(hosting.template);
  const target=checkoutRepairHostingTarget(hosting,proof(repair,nextDigest),baselineDigest);
  assert.equal(target.stackId,hosting.stackId);
  assert.deepEqual(target.expectedChanges,['TaskDefinition:Modify:True','Service:Modify:False']);
  const actual=structuredClone(target.template), old=before.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  const box=actual.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(box.Image,old.Image.replace(baselineDigest,nextDigest));box.Image=old.Image;
  assert.equal(actual.Metadata.ImageSource,'sha256:'+repair.sourceRecipeSha256);
  assert.equal(actual.Metadata.ImageConfigDigest,repair.imageConfigDigest);
  actual.Metadata.ImageSource=before.Metadata.ImageSource;
  actual.Metadata.ImageConfigDigest=before.Metadata.ImageConfigDigest;
  assert.deepEqual(actual,before);assert.deepEqual(hosting.template,before);
  assert.throws(()=>checkoutRepairHostingTarget(hosting,{...proof(repair,nextDigest),locked:false},baselineDigest),/REPAIR_PUBLISHER_PROOF/);
  assert.throws(()=>checkoutRepairHostingTarget(hosting,proof(candidate,nextDigest),baselineDigest),/REPAIR_PUBLISHER_PROOF/);
});

test('approved envelope binds scope and stops on changed bytes or expired window',()=>{
  const now=Date.parse('2026-11-19T01:00:00.000Z');
  const fixture={status:'NO_AWS_PUBLISHER_AND_CALLER_CI_VERIFIED',repositoryId:candidate.repositoryId,workflowId:422828156,
    callerWorkflowId:422829965,publishDispatched:false,awsIdentity:false,executionAuthorized:false,observedAtUtc:new Date(now-1000).toISOString(),
    reusable:{commit:dahliaSealedSizeFix.reusableCommit,runId:dahliaSealedSizeFix.reusableCiRun,conclusion:'success',headBranch:'main',event:'push',attempt:1},
    caller:{commit:'e'.repeat(40),runId:123,conclusion:'success',headBranch:'main',event:'push',attempt:1}};
  const inputs={implementationCommit:'a'.repeat(40),nonce:'b'.repeat(32),riskSha256:'c'.repeat(64),issuedAt:new Date(now).toISOString()};
  const m=makeFirstPurchaseReview(inputs,fixture);
  const hash=s=>createHash('sha256').update(s).digest('hex'),text=JSON.stringify(m);
  const validate=(bytes,at=now)=>validateFirstPurchaseReview(bytes,hash(bytes),at,fixture);
  assert.equal(validate(text).candidate.artifact,14480476839);
  assert.equal(m.candidate.archiveBytes,307792511);
  assert.equal(m.stoppedDahlia.preserveBothUsedSlots,true);
  assert.throws(()=>makeFirstPurchaseReview(inputs,{...fixture,reusable:{...fixture.reusable,runId:1}}),/CI_PINS/);
  assert.equal(m.priorAttempt.requireNoRemoteWriteAndNoPublisherIntent,true);
  assert.equal(m.stripe.firstPurchasePaymentMethod,'card');
  assert.equal(m.preflight.originalSnapshotEndedUtc,draft.originalSnapshot.usableBeforeUtc);
  assert.equal(m.preflight.freshReadbacksAfterApprovalAndBeforeFirstRemoteWrite,true);
  assert.equal(m.limits.operatorStripeDashboardEndpointCreatesIfAbsent,0);
  assert.ok(Date.parse(m.preflight.originalSnapshotEndedUtc)<now);
  assert.equal(Date.parse(m.latestStartUtc)-now,24*3600000);
  assert.equal(Date.parse(m.hardStopUtc)-Date.parse(m.latestStartUtc),95*60000);
  assert.ok(Date.parse(m.hardStopUtc)<=Date.parse(m.artifactExpiresAtUtc));
  const prior=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-activation-consolidated.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(hash(prior),'f90d46880a9e60a33982f06dd50881a115662a7ae32068f54400da23ef961715');
  assert.throws(()=>validate(prior),/FORMAT/);
  const oldV2=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-activation-renewed.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(hash(oldV2),'8b35a3584a5b71e3eb74d7950e66a403cfe2ce3806db434febc04edee0abf25d');
  assert.throws(()=>validate(oldV2),/FORMAT/);
  const oldDahlia=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-dahlia-activation.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(hash(oldDahlia),m.stoppedDahlia.approvedSha256);
  assert.throws(()=>validate(oldDahlia),/FORMAT/);
  assert.throws(()=>validate(text,Date.parse(m.latestStartUtc)),/EXPIRED/);
  const changed=JSON.stringify({...m,writes:{...m.writes,accessChangeSetExecute:2}});
  assert.throws(()=>validate(changed),/CHANGED/);
});

test('one sequence: no downstream writes if fresh preflight or publisher lock proof fails',async()=>{
  const calls=[];
  const port=(label,v)=>(...args)=>{calls.push([label,...args]);return v;};
  const ports={preflight:port('preflight'),publish:port('publish',{locked:true}),install:port('install','dsn'),
    store:port('store',{arn:'stub'}),templates:port('templates',{access:'a',hosting:'h'}),update:port('update'),inspect:port('inspect')};
  await assert.rejects(runFirstPurchaseStages({...ports,preflight:()=>{calls.push(['fresh-preflight']);throw Error('MISMATCH');}}),/MISMATCH/);
  assert.deepEqual(calls,[['fresh-preflight']]);
  calls.length=0;
  await assert.rejects(runFirstPurchaseStages({...ports,publish:port('publish',{locked:false})}),/LOCK_NOT_PROVED/);
  assert.deepEqual(calls,[['preflight'],['publish']]);
  calls.length=0;await runFirstPurchaseStages(ports);
  assert.deepEqual(calls.map(c=>c[0]),['preflight','publish','install','store','templates','update','update','inspect']);
  assert.deepEqual(calls.slice(5,7),[['update','access','a'],['update','hosting','h']]);
});

test('continuation binds the successful run and cannot expand publishing or original time',()=>{
  const read=name=>readFileSync(new URL(`../docs/evidence/${name}.json`,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const prior=read('sandbox-first-purchase-dahlia-size-fix-activation.review');
  const original=JSON.parse(prior),now=Date.parse('2026-11-19T00:30:00Z');
  const approval={implementationCommit:'a'.repeat(40),nonce:'b'.repeat(32),riskSha256:'c'.repeat(64),issuedAt:new Date(now).toISOString()};
  const make=()=>makeContinuationReview(approval);
  const hash=s=>createHash('sha256').update(s).digest('hex'),m=make(),text=JSON.stringify(m);
  assert.equal(validateContinuationReview(text,hash(text),now).predecessor.runId,44425786946);
  assert.equal(m.predecessor.approvalSha256,hash(prior));
  assert.equal(m.predecessor.preserveBothUsedSlots,true);
  assert.deepEqual(m.candidate,original.candidate);
  assert.deepEqual(m.target,original.target);
  assert.deepEqual(m.stripe,original.stripe);
  assert.equal(m.hardStopUtc,original.hardStopUtc);
  assert.equal(m.limits.githubApiGets,0);
  assert.equal(m.limits.artifactDownloads,0);
  assert.equal(m.limits.sourceSts,5);
  assert.equal(m.limits.awsMetadata,217);
  for(const operation of ['publisherGrantUpdates','publisherRevokeUpdates','protectedDispatch','topLevelEcrPush'])
    assert.equal(m.writes[operation],0);
  assert.throws(()=>validateContinuationReview(prior,hash(prior),now),/CONTINUATION_FORMAT/);
  assert.throws(()=>makeContinuationReview({...approval,nonce:original.nonce}),/CONTINUATION_WINDOW/);
  assert.throws(()=>validateContinuationReview(text,hash(text),Date.parse(m.latestStartUtc)),/EXPIRED/);
  const widened=JSON.stringify({...m,writes:{...m.writes,protectedDispatch:1}});
  assert.throws(()=>validateContinuationReview(widened,hash(widened),now),/CHANGED/);
});

test('continuation never calls the publication port and does not install if its independent read fails',async()=>{
  const calls=[];
  const port=(label,v)=>(...args)=>{calls.push([label,...args]);return v;};
  const ports={preflight:port('preflight'),publish:()=>{throw Error('MUST_NOT_PUBLISH');},inspectPublished:port('read-ecr-and-lock',{locked:true}),
    install:port('install','dsn'),store:port('store',{arn:'stub'}),templates:port('templates',{access:'a',hosting:'h'}),
    update:port('update'),inspect:port('inspect')};
  await assert.rejects(runFirstPurchaseStages({...ports,inspectPublished:()=>{throw Error('TAG_NOT_PROVED');}},{continuation:true}),/TAG_NOT_PROVED/);
  assert.deepEqual(calls,[['preflight']]);
  calls.length=0;
  await runFirstPurchaseStages(ports,{continuation:true});
  assert.deepEqual(calls.map(c=>c[0]),['preflight','read-ecr-and-lock','install','store','templates','update','update','inspect']);
});

test('ACL correction review binds the stopped install and the exact already verified image',()=>{
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const prior=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-dahlia-continuation.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const old=JSON.parse(prior),now=Date.parse('2026-11-19T00:45:00Z');
  const input={implementationCommit:'a'.repeat(40),nonce:'b'.repeat(32),riskSha256:'c'.repeat(64),issuedAt:new Date(now).toISOString()};
  const m=makeAclRecoveryReview(input),text=JSON.stringify(m);
  assert.deepEqual(validateAclRecoveryReview(text,hash(text),now),m);
  assert.equal(m.predecessor.preCommitStopApprovalSha256,hash(prior));
  assert.equal(m.predecessor.installCommitSent,false);
  assert.equal(m.preflight.requireVacantInstallationObjectsBeforeWrite,true);
  assert.equal(m.existingImage.manifestDigest,'sha256:a27f4a5d101f884205d8e455fc68beeaadbc7136d190cf9ebf6c5055d9e50670');
  assert.equal(m.fix.pg18CiRun,44429410826);
  assert.equal(m.latestStartUtc,old.latestStartUtc);
  assert.equal(m.hardStopUtc,old.hardStopUtc);
  assert.equal(m.limits.sourceSts,4);
  assert.equal(m.limits.awsMetadata,201);
  assert.deepEqual(m.writes,old.writes);
  assert.throws(()=>validateAclRecoveryReview(prior,hash(prior),now),/ACL_RECOVERY_FORMAT/);
  assert.throws(()=>makeAclRecoveryReview({...input,nonce:old.nonce}),/ACL_RECOVERY_WINDOW/);
  const changed=JSON.stringify({...m,existingImage:{...m.existingImage,manifestDigest:'sha256:'+'a'.repeat(64)}});
  assert.throws(()=>validateAclRecoveryReview(changed,hash(changed),now),/EXPIRED_OR_CHANGED/);
});

test('Source refresh binds the confirmed vacancy without extending it or replaying the stopped review',()=>{
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const old=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-dahlia-acl-recovery.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const now=Date.parse('2026-11-19T01:15:00.000Z');
  const input={implementationCommit:'a'.repeat(40),nonce:'b'.repeat(32),riskSha256:'c'.repeat(64),issuedAt:new Date(now).toISOString()};
  const m=makeSourceRefreshReview(input),text=JSON.stringify(m);
  assert.deepEqual(validateSourceRefreshReview(text,hash(text),now),m);
  assert.equal(m.predecessor.sourceStopApprovalSha256,hash(old));
  assert.equal(m.preflight.verifySourceBeforeConsumingSlot,true);
  assert.equal(m.preflight.neonVacancy.recheckInsideInstallBeforeDdl,true);
  assert.equal(m.latestStartUtc,'2026-11-19T05:47:53.061Z');
  assert.equal(m.hardStopUtc,JSON.parse(old).hardStopUtc);
  assert.equal(m.limits.neonTlsConnections,2);
  assert.equal(m.limits.sourceSts,4);
  assert.deepEqual(m.writes,JSON.parse(old).writes);
  assert.throws(()=>validateSourceRefreshReview(old,hash(old),now),/SOURCE_REFRESH_FORMAT/);
  assert.throws(()=>makeSourceRefreshReview({...input,nonce:JSON.parse(old).nonce}),/SOURCE_REFRESH_WINDOW/);
  assert.throws(()=>validateSourceRefreshReview(text,hash(text),Date.parse(m.latestStartUtc)),/EXPIRED/);
});

test('Hosting pins the new version and retains the old Web connection and closed worker',()=>{
  const versionId='12345678-abcd-4123-8123-123456789abc';
  const arn='arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/first-purchase-v1-A1B2C3';
  const fixture={workspaceId:'wsp_'+'a'.repeat(24),planId:'pln_'+'b'.repeat(32),secret:{arn,versionId}};
  const publisher={...candidate,locked:true,manifestDigest:'sha256:'+'a'.repeat(64)};
  const t=buildFirstPurchaseActivationTemplates({...fixture,publisher});
  assert.throws(()=>buildFirstPurchaseActivationTemplates({...fixture,publisher:{...publisher,...oldCandidate}}),/PUBLISHER_RECEIPT/);
  const web=t.hosting.template.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(web.Secrets.length,4);assert.equal(web.Secrets[0].Name,'DATABASE_URL');
  assert.ok(web.Secrets.slice(1).every(x=>x.ValueFrom.startsWith(arn+':')&&x.ValueFrom.endsWith('::'+versionId)));
  assert.equal(web.Environment.find(e=>e.Name==='TECHLONG_SANDBOX_FIRST_PURCHASE').Value,'true');
  assert.ok(web.Environment.filter(x=>/ENABLE.*(?:WORKER|CONTROLLER)|(?:WORKER|CONTROLLER).*ENABLED/.test(x.Name)).every(x=>x.Value==='false'));
});

test('only the existing signed Dahlia destination and five unchanged events qualify',()=>{
  const endpoint={id:'we_syntheticOnly',url:dahliaEndpoint.url,object:'webhook_endpoint',livemode:false,status:'enabled',
    application:null,api_version:'2026-05-27.dahlia',enabled_events:[...dahliaEndpoint.events].reverse()};
  const list=(...data)=>({object:'list',has_more:false,data});
  assert.doesNotThrow(()=>verifyDahliaStripeEndpoint(list(endpoint),endpoint.id));
  assert.throws(()=>verifyDahliaStripeEndpoint(list({...endpoint,api_version:'2026-10-28.endive'}),endpoint.id),/ENDPOINT_VERSION/);
  assert.throws(()=>verifyDahliaStripeEndpoint(list({...endpoint,enabled_events:['checkout.session.completed']}),endpoint.id),/ENDPOINT_EVENTS/);
  assert.throws(()=>verifyDahliaStripeEndpoint(list(endpoint,{...endpoint,id:'we_other'}),endpoint.id),/ENDPOINT_IDENTITY/);
  assert.throws(()=>verifyDahliaStripeEndpoint(list(endpoint),'we_other'),/ENDPOINT_IDENTITY/);
});
