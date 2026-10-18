import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dnsTrustChangeV5,dnsReleasePlanV5,DNS_RELEASE_V5 as V} from '../ops/cloud-worker/dns-release-v5.mjs';
import {ROOT_CLOSURE_V5} from '../ops/cloud-worker/activation/runtime-v5.mjs';
import {computeCloudClosureV5} from '../ops/cloud-worker/closure-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const capsule=JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
const source={commit:'a'.repeat(40),runtimeClosureSha256:ROOT_CLOSURE_V5},history={failedReviewPreserved:true},
  release={sourceCommit:source.commit,runtimeCommit:source.commit,reusable:{commit:'b'.repeat(40),parent:source.commit},
    caller:{commit:'c'.repeat(40),parent:'b'.repeat(40)}},
  prestate={main:source.commit,roleId:V.roleId,templateMatchesOld:true},now=1800000000000;
const context={source,history,release,prestate,capsule,now};
test('new trust differs only in exact reusable SHA, no broader wildcard or changed permissions',()=>{
  const r=dnsTrustChangeV5(capsule,release.reusable.commit),copy=structuredClone(r.template),key=r.onlyChange.key;
  copy.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[key]=r.onlyChange.oldValue;
  assert.deepEqual(copy,r.oldTemplate);assert.equal(Object.keys(r.template.Resources).length,5);
  assert.equal(r.onlyChange.oldValue.endsWith('@'+V.oldReusable),true);
  assert.equal(r.onlyChange.newValue.endsWith('@'+release.reusable.commit),true);
  assert.throws(()=>dnsTrustChangeV5(capsule,'main'));assert.throws(()=>dnsTrustChangeV5(capsule,V.oldReusable));
});
test('publication material names exactly two workflow files and trust-only Create/Execute, never dispatch',async()=>{
  const m=await dnsReleasePlanV5(context),{manifestSha256,...body}=m;
  assert.equal(await sha256Hex(body),manifestSha256);assert.equal(m.executionAuthorized,false);assert.equal(m.executableEntryAvailable,false);
  assert.deepEqual(m.actions.publish.onlyFiles,[V.caller,V.reusable]);assert.equal(m.actions.publish.force,false);
  assert.equal(m.actions.foundation.create.StackName,V.stackId);assert.deepEqual(m.actions.foundation.create.Capabilities,['CAPABILITY_NAMED_IAM']);
  assert.equal(m.actions.foundation.create.ResourceTypes,undefined);assert.equal(m.actions.foundation.execute.DisableRollback,true);
  assert.equal(m.actions.foundation.exactTemplateAndTrustOnlyChangeMustBeIndependentlyVerifiedBeforeExecute,true);
  for(const k of ['permissionExpansion','newIamResources','environmentWrites','s3Writes','secretValueReads','neonWrites','workflowDispatches','jobClaims','workloadCreates'])
    assert.equal(m.proposedEffects[k],0);
  assert.equal(m.actualEffects.awsWrites,0);assert.equal(m.actualEffects.slotConsumption,0);
});
test('changed source, stale foundation identity, broken parent chain or old closure cannot become a release plan',async()=>{
  for(const changed of [{source:{...source,runtimeClosureSha256:V.oldClosure}},
    {prestate:{...prestate,main:'d'.repeat(40)}},{prestate:{...prestate,roleId:'wrong'}},
    {prestate:{...prestate,templateMatchesOld:false}},{release:{...release,runtimeCommit:'d'.repeat(40)}},
    {release:{...release,reusable:{...release.reusable,parent:'d'.repeat(40)}}}])
    await assert.rejects(dnsReleasePlanV5({...context,...changed}));
});
test('updated activation digest binds the actual 76-file closure without changing the installed binding',async()=>{
  const c=await computeCloudClosureV5();assert.equal(c.pinCount,76);assert.equal(c.closureSha256,ROOT_CLOSURE_V5);
  assert.notEqual(ROOT_CLOSURE_V5,V.oldClosure);
  const binding=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',import.meta.url),'utf8'));
  assert.equal(binding.installationSha256,'0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1');
});
test('the preparation entry has no remote-write/Secret/dispatch operation and rejects execution modes before I/O',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/dns-release-v5.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/CreateChangeSetCommand|ExecuteChangeSetCommand|GetSecretValueCommand|gitLocalV5\(\['push'|fetch\(/);
  assert.match(code,/PREPARE_ONLY_ARGUMENTS/);assert.match(code,/ONLY_REVIEWED_RUNTIME_EXCEPTIONS/);
  const result=spawnSync(process.execPath,['--experimental-strip-types','ops/cloud-worker/dns-release-v5.mjs','--mode','Publish','--output','F:/ChatGPT_workshop/techlong-w5j-dns-release-not-authorized'],
    {cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:15000,windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/PREPARE_ONLY_ARGUMENTS/);
});
