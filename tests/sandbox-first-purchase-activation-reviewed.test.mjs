import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeFirstPurchaseReview, validateFirstPurchaseReview, runFirstPurchaseStages } from '../ops/platform-ecs-v1/first-purchase-activate-reviewed.mjs';
import { buildFirstPurchaseActivationTemplates, draft } from '../ops/platform-ecs-v1/first-purchase-activation.mjs';

test('approved envelope binds scope and stops on changed bytes or expired window',()=>{
  const now=Date.parse('2026-11-18T23:10:00.000Z');
  const m=makeFirstPurchaseReview({implementationCommit:'a'.repeat(40),nonce:'b'.repeat(32),riskSha256:'c'.repeat(64),issuedAt:new Date(now).toISOString()});
  const hash=s=>createHash('sha256').update(s).digest('hex'),text=JSON.stringify(m);
  assert.equal(validateFirstPurchaseReview(text,hash(text),now).candidate.artifact,14457164929);
  assert.equal(m.preflight.originalSnapshotEndedUtc,draft.originalSnapshot.usableBeforeUtc);
  assert.equal(m.preflight.freshReadbacksAfterApprovalAndBeforeFirstRemoteWrite,true);
  assert.equal(m.limits.operatorStripeDashboardEndpointCreatesIfAbsent,0);
  assert.ok(Date.parse(m.preflight.originalSnapshotEndedUtc)<now);
  assert.equal(Date.parse(m.latestStartUtc)-now,24*3600000);
  assert.equal(Date.parse(m.hardStopUtc)-Date.parse(m.latestStartUtc),95*60000);
  assert.ok(Date.parse(m.hardStopUtc)<=Date.parse(m.artifactExpiresAtUtc));
  const prior=readFileSync(new URL('../docs/evidence/sandbox-first-purchase-activation-consolidated.review.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(hash(prior),'f90d46880a9e60a33982f06dd50881a115662a7ae32068f54400da23ef961715');
  assert.throws(()=>validateFirstPurchaseReview(prior,hash(prior),now),/CHANGED/);
  assert.throws(()=>validateFirstPurchaseReview(text,hash(text),Date.parse(m.latestStartUtc)),/EXPIRED/);
  const changed=JSON.stringify({...m,writes:{...m.writes,accessChangeSetExecute:2}});
  assert.throws(()=>validateFirstPurchaseReview(changed,hash(changed),now),/CHANGED/);
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
  const p=draft.candidate, versionId='12345678-abcd-4123-8123-123456789abc';
  const arn='arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/first-purchase-v1-A1B2C3';
  const t=buildFirstPurchaseActivationTemplates({workspaceId:'wsp_'+'a'.repeat(24),planId:'pln_'+'b'.repeat(32),
    publisher:{locked:true,artifactId:p.artifactId,sourceRecipeSha256:p.recipeSha256,sourceTreeOid:p.sourceTreeOid,
      imageConfigDigest:p.imageConfigDigest,manifestDigest:'sha256:'+'a'.repeat(64)},secret:{arn,versionId}});
  const web=t.hosting.template.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(web.Secrets.length,4);assert.equal(web.Secrets[0].Name,'DATABASE_URL');
  assert.ok(web.Secrets.slice(1).every(x=>x.ValueFrom.startsWith(arn+':')&&x.ValueFrom.endsWith('::'+versionId)));
  assert.equal(web.Environment.find(e=>e.Name==='TECHLONG_SANDBOX_FIRST_PURCHASE').Value,'true');
  assert.ok(web.Environment.filter(x=>/ENABLE.*(?:WORKER|CONTROLLER)|(?:WORKER|CONTROLLER).*ENABLED/.test(x.Name)).every(x=>x.Value==='false'));
});
