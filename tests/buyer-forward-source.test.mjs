import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buyerForwardProtocol} from '../ops/platform-registration-publish-v1/contract.mjs';
import {sourceReview,S} from '../ops/platform-image-source-v2/review.mjs';
import {BUYER_SOURCE,BUYER_SOURCE_LIMITS,approvedBuyerForwardSource,buyerSourceContext,prepareBuyerForwardSource}
  from '../ops/platform-registration-publish-v1/buyer-forward-source.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const checkTime=Date.parse('2026-11-21T20:00:00.000Z');
const schema='techlong/sandbox-fc41597f-buyer-forward-source-review/v1';
const base=sourceReview({protocol:buyerForwardProtocol,settings:{...S,reusableCommit:BUYER_SOURCE.reusableCommit,
  scope:BUYER_SOURCE_LIMITS,schema,tokenPrefix:'buyer-forward-35ec0afb-fc41597f'}});
const context=buyerSourceContext(buyerForwardProtocol,base);
const sample=()=>({schema,issuedAt:'2026-11-21T19:00:00.000Z',expiresAt:BUYER_SOURCE.factsNotUsableAtOrAfterUtc,
  latestStartAt:'2026-11-21T21:38:05.916Z',nonce:'a'.repeat(32),operatorSourceCommit:BUYER_SOURCE.callerCommit,
  sourceCiRunId:BUYER_SOURCE.callerCiRun,callerWorkflowId:BUYER_SOURCE.callerWorkflowId,
  sourcePins:Array.from({length:6},(_,i)=>({file:'fixed/source-'+i+'.mjs',sha256:'b'.repeat(64)})),riskSha256:'c'.repeat(64),
  candidate:buyerForwardProtocol.P,reusableCommit:BUYER_SOURCE.reusableCommit,scope:BUYER_SOURCE_LIMITS});
const validate=(m,now=checkTime)=>{
  const text=JSON.stringify(m);return context.validateOuter(text,sha(text),now);
};

test('buyer Source only arms original artifact/immutable caller, audited CI, budget and current window',()=>{
  const input=sample();assert.deepEqual(validate(input),input);
  const inner=context.innerReview(input,BUYER_SOURCE.callerCommit,checkTime);
  assert.equal(inner.candidate.artifactId,14714442097);
  assert.equal(inner.reusableCommit,BUYER_SOURCE.reusableCommit);
  assert.equal(Date.parse(inner.grantExpiresAt)-Date.parse(inner.grantStartsAt),3600000);
  assert.throws(()=>context.innerReview(input,'d'.repeat(40),checkTime),/BUYER_SOURCE_CALLER_HEAD/);
  for(const field of ['sourceCiRunId','callerWorkflowId','operatorSourceCommit']){
    const bad={...input,[field]:typeof input[field]==='number'?input[field]+1:'e'.repeat(40)};
    assert.throws(()=>validate(bad),/BUYER_SOURCE_APPROVED_WORKFLOW_PINS/);
  }
  assert.throws(()=>validate({...input,candidate:{...input.candidate,artifactId:14714442098}}),/SOURCE_REVIEW_FIELDS/);
  assert.throws(()=>validate({...input,scope:{...BUYER_SOURCE_LIMITS,awsMetadata:BUYER_SOURCE_LIMITS.awsMetadata+1}}),/SOURCE_REVIEW_FIELDS/);
  assert.throws(()=>validate({...input,expiresAt:'2026-11-21T23:00:00.000Z',latestStartAt:'2026-11-21T22:00:00.000Z'}),/BUYER_SOURCE_FACTS_EXPIRED/);
  const revoke=context.updateRequest(inner,'revoke');
  const grant=context.updateRequest(inner,'grant');
  assert.equal(revoke.StackName,inner.candidate.stackId);assert.equal(grant.StackName,revoke.StackName);
  assert.match(revoke.ClientRequestToken,/^buyer-forward-35ec0afb-fc41597f-[a-f0-9]{32}-revoke$/);
  assert.deepEqual(JSON.parse(revoke.TemplateBody),buyerForwardProtocol.templates(inner).revoke);
  assert.equal(BUYER_SOURCE.intentFile,'techlong-sandbox-fc41597f-buyer-forward-14714442097.intent.json');
});

test('Source cannot run from the preparation draft, a stale package or another operator hash',()=>{
  const operatorSha256='f'.repeat(64);
  const source={schema:'techlong/sandbox-fc41597f-buyer-forward-source-section/v1',operatorSha256,
    checkout:'not-read-by-this-test',review:sample()};
  const pack={schema:'techlong/sandbox-first-open-publish-and-install/v1',status:'READY_FOR_EXECUTION',
    jobId:'job_fc41597f9b5ba8e02b338ecf',authorization:{firstOpenApproved:false,windowAllocated:false},
    reuse:{preparationNotUsableAtOrAfterUtc:BUYER_SOURCE.factsNotUsableAtOrAfterUtc},platformPublication:{source}};
  const approve=(x,now=checkTime,digest=operatorSha256)=>{
    const text=JSON.stringify(x);return approvedBuyerForwardSource(text,sha(text),digest,now);
  };
  assert.deepEqual(approve(pack),source);
  assert.throws(()=>approve({...pack,status:'STATIC_SCOPE_PINNED_NOT_EXECUTABLE'}),/COMBINED_APPROVAL_SCOPE/);
  assert.throws(()=>approve({...pack,authorization:{...pack.authorization,firstOpenApproved:true}}),/COMBINED_APPROVAL_SCOPE/);
  assert.throws(()=>approve(pack,Date.parse('2026-11-21T21:38:06Z')),/COMBINED_APPROVAL_SCOPE/);
  assert.throws(()=>approve(pack,checkTime,'1'.repeat(64)),/OPERATOR_PIN/);
  assert.throws(()=>approvedBuyerForwardSource(JSON.stringify(pack),'1'.repeat(64),operatorSha256,checkTime),/COMBINED_APPROVAL_SHA/);
});

test('the working development checkout cannot stand in for pinned clean main',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)).replace(/[\\/]$/,'');
  await assert.rejects(prepareBuyerForwardSource(root,{now:checkTime}),/BUYER_SOURCE_(?:CLEAN_EXACT_MAIN|GIT)/);
});
