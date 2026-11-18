import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dahliaEndpoint, makeFirstPurchaseReview, validateFirstPurchaseReview, verifyDahliaStripeEndpoint,
  runFirstPurchaseStages } from '../ops/platform-ecs-v1/first-purchase-activate-reviewed.mjs';
import { buildFirstPurchaseActivationTemplates, draft } from '../ops/platform-ecs-v1/first-purchase-activation.mjs';
import { DAHLIA_FIRST_PURCHASE_CANDIDATE as candidate, FIRST_PURCHASE_CANDIDATE as oldCandidate } from '../ops/platform-registration-publish-v1/contract.mjs';
import { dahliaSealedSizeFix } from '../ops/platform-registration-publish-v1/source.mjs';

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
