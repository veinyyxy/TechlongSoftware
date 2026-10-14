import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import {C4D_SCOPE,prepareRuntimeSecretReviewC4d as prepare,assertRuntimeSecretApprovalC4d as approve,
  generateRuntimeSecretMaterialC4d as generate,observeRuntimeSecretC4d as observe,runtimeIamNextStepC4d as iamNext,compileRuntimeSecretExposureC4d as compileExposure} from '../lib/deployments/execution/express-runtime-secret-c4d.ts';
const now=Date.parse('2026-10-14T22:25:00Z'),code='c'.repeat(64),token='8edb6cde-0950-4b69-a72d-c6842a4b6f4b';
const historical=JSON.parse(readFileSync('F:/ChatGPT_workshop/techlong-d002-express-c4c-review-20261014-r2/manifest.json','utf8')).facts;
const policyHistory=JSON.parse(readFileSync('F:/ChatGPT_workshop/techlong-d002-express-c4b-review-20261014-r1/iam-metadata.json','utf8'));
const oldRole=policyHistory.roles.find((r:{name:string})=>r.name==='TechlongSandboxTaskExecutionRole'),oldBoundary=policyHistory.policies[0];
const exposureInput=()=>({roleId:oldRole.roleId,roleArn:oldRole.arn,boundaryArn:oldRole.boundaryArn,boundaryPolicyId:oldBoundary.policyId,
  defaultVersion:oldBoundary.defaultVersion,inlinePolicyNames:['PullSandboxImageAndRuntimeSecrets'],attachedPolicyArns:[],
  inlineDocument:oldRole.inline[0].document,boundaryDocument:oldBoundary.document});
const exposure=()=>compileExposure(exposureInput());
const fixture=()=>prepare({facts:{...structuredClone(historical),observedAt:new Date(now).toISOString()},exposure:exposure(),codeBindingSha256:code,versionToken:token,now});
const metadata=()=>{const r=fixture();return {Name:r.candidate.name,ARN:`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${r.candidate.name}-AbCdEf`,
  Tags:r.candidate.request.Tags,VersionIdsToStages:{[token]:['AWSCURRENT']}};};

test('C4d scopes one version-bound create, one metadata-only inspect and no IAM/SQL/runtime',()=>{
  const r=fixture();assert.equal(r.limits.createSecretCalls,1);assert.equal(r.limits.independentDescribeSecretCalls,1);
  assert.equal(r.limits.iamWrites,0);assert.equal(r.limits.sqlConnections,0);assert.equal(r.limits.secretValueReads,0);
  assert.equal('SecretString' in r.request,false);assert.equal('database_url' in r.request,false);assert.equal('KmsKeyId' in r.request,false);
  assert.deepEqual(r.candidate.scope,C4D_SCOPE);assert.equal(r.executionAuthorized,false);approve(r,r.manifestSha256,code,now+1);
});
test('C4d refuses wrong approval, expiry and rehashed scope drift before runtime work',()=>{
  const r=fixture();assert.throws(()=>approve(r,'0'.repeat(64),code,now+1),/FRESH_APPROVAL/);
  assert.throws(()=>approve(r,r.manifestSha256,code,now+6*3600000),/FRESH_APPROVAL/);
  assert.throws(()=>approve(r,r.manifestSha256,'d'.repeat(64),now+1),/FRESH_APPROVAL/);
  const raw=structuredClone(r);raw.limits.createSecretCalls=2;const {manifestSha256:ignored,...body}=raw;void ignored;
  raw.manifestSha256=db.digest(body);assert.throws(()=>approve(raw,raw.manifestSha256,code,now),/SCOPE_DRIFT/);
});
test('C4d rejects changed physical cluster, non-17.9 and non-UUID version tokens',()=>{
  const r=fixture();assert.throws(()=>prepare({facts:{...r.facts,binding:{...r.facts.binding,clusterResourceId:'cluster-'+'A'.repeat(26)}},exposure:exposure(),codeBindingSha256:code,versionToken:token,now}));
  assert.throws(()=>prepare({facts:{...r.facts,binding:{...r.facts.binding,engineVersion:'17.10'}},exposure:exposure(),codeBindingSha256:code,versionToken:token,now}));
  assert.throws(()=>prepare({facts:r.facts,exposure:exposure(),codeBindingSha256:code,versionToken:'a'.repeat(32),now}));
});
test('C4d generates only four in-memory keys, with real-shaped test payment input and no token/password',()=>{
  // Synthetic fixture strings; not credentials and never passed to AWS.
  const payment={stripeSecretKey:'sk_test_'+'A'.repeat(32),stripeWebhookSecret:'whsec_'+'B'.repeat(32)},m=generate(payment),n=generate(payment);
  assert.deepEqual(Object.keys(m),db.STABLE_SECRET_KEYS);assert.equal(m.stripe_secret_key,payment.stripeSecretKey);
  assert.equal(m.stripe_webhook_secret,payment.stripeWebhookSecret);assert.match(m.hmac_secret_key,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(m.hmac_secret_key,m.jwt_secret_key);assert.notEqual(m.hmac_secret_key,n.hmac_secret_key);
  assert.throws(()=>generate({...payment,stripeSecretKey:'sk_live_'+'A'.repeat(32)}));assert.throws(()=>generate({...payment,database_url:'not-permitted'}));
  assert.throws(()=>generate({...payment,stripeWebhookSecret:'whsec_placeholder_value'}));
});
test('C4d observes exact UUID version and four pinned ECS refs without content/IAM/ready proof',()=>{
  const r=fixture(),o=observe(r,metadata());assert.equal(o.binding.runtimeSecret.versionId,token);assert.equal(o.taskConfiguration.secrets.length,4);
  assert.equal(o.iamPermissionsVerified,false);assert.equal(o.secretValuesRead,false);assert.equal(o.readyVerified,false);
  assert.throws(()=>observe(r,{...metadata(),VersionIdsToStages:{['b'.repeat(32)]:['AWSCURRENT']}}));
  assert.throws(()=>observe(r,{...metadata(),SecretString:'synthetic'}));assert.throws(()=>observe(r,{...metadata(),KmsKeyId:'foreign-key'}));
  assert.throws(()=>observe(r,{...metadata(),ReplicationStatus:[{Region:'us-east-1',Status:'InSync'}]}));
  assert.throws(()=>observe(r,{...metadata(),ReplicationStatus:{Region:'us-east-1'}}));
  assert.throws(()=>observe(r,{...metadata(),PrimaryRegion:'us-east-1'}));
  assert.equal(observe(r,{...metadata(),PrimaryRegion:'ca-central-1',ReplicationStatus:[]}).binding.runtimeSecret.versionId,token);
});
test('C4d IAM next-step has no wildcard/placeholder Secret ARN and is not a policy or installation approval',()=>{
  const r=fixture(),pending=iamNext(r);assert.equal(pending.execution.secretResource,null);assert.equal(pending.execution.versionId,null);
  const ready=iamNext(r,observe(r,metadata()));assert.equal(ready.execution.secretResource,metadata().ARN);
  assert.equal(ready.dataOnlyNotPolicy,true);assert.equal(ready.installationAuthorized,false);
  assert.match(ready.application.connectResource,/\/tenant_a0da1748bc4d5419_role$/);assert.match(ready.lifecycle.connectResource,/\/postgres$/);
  assert.equal(JSON.stringify(ready).includes('*'),false);
});
test('C4d explicitly records existing wildcard read exposure, not zero-IAM-write isolation or effective access proof',()=>{
  const e=exposure();assert.equal(e.newSecretMatchesExistingReadAllowStatements,true);assert.equal(e.effectiveSecretReadVerified,false);
  assert.throws(()=>compileExposure({...exposureInput(),roleId:'foreign'}));
  assert.throws(()=>compileExposure({...exposureInput(),attachedPolicyArns:['foreign']}));
  assert.throws(()=>compileExposure({...exposureInput(),inlineDocument:{Statement:[]}}));
  assert.match(fixture().risks.join(' '),/zero IAM writes/);
});
