import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RECOVERY,RECOVERY_READ_SCOPE,makeRecoveryPreparation,parseRecoveryArgs} from '../ops/platform-review-v6/recovery-preparation.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {H,P} from '../ops/platform-hosted-window-v6/contract.mjs';
function fixture(){const sourceCommit='f'.repeat(40),at=Date.parse('2026-10-25T12:00:00Z'),reference={key:'synthetic-manifest',versionId:'synthetic',sha256:'a'.repeat(64)};
  return {sourceCommit,createdAt:at,pins:Array.from({length:20},(_,i)=>({file:'synthetic-'+i,sha256:'a'.repeat(64)})),
    ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},compatibility:{executionSourceCommit:sourceCommit,imageSourceCommit:H.imageSource,
      protectedRuntimeCodeUnchanged:true,cloudClosureSha256:B.platform.closureSha256},auth:{contentRead:false,length:1,aclSha256:'a'.repeat(64)},
    history:{sourceCommit:RECOVERY.oldSourceCommit,reviewPlanSha256:RECOVERY.planSha256,reviewRunId:RECOVERY.runId,allFourExecutionSlotsConsumed:true,
      independentInspectConsumed:true,noRunOncePlan:true,verified:{rootEventId:RECOVERY.rootEventId,taskDefinition:`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:7`},
      newControlCounts:{plans:1,approvals:1,attempts:1},newJob:{id:RECOVERY.jobId,status:'pending',attempts:0,maxAttempts:1,leaseOwner:null,reviewRequired:true,cloudExecutionAuthorized:false},
      newReviewAttempt:{state:'ACKNOWLEDGED',runId:RECOVERY.runId,proofSha256:null},oldJobsHistoryBusinessAndProtectionUnchanged:true,discovery:{manifestReference:reference}},
    diagnostic:{sourceCommit:RECOVERY.oldSourceCommit,reviewRunId:RECOVERY.runId,reviewRunStatus:'completed',reviewRunConclusion:'success',fixedObject:reference,
      originalFailureReproduced:false,originalFailureCauseStillUnproved:true,diagnosticReadScopeConsumed:true,virtualObservedStateWasOnlyInMemory:true,
      computedProofNotStoredInDatabase:true,databaseFreshlyRead:false,result:{outcome:'FIXED_MANIFEST_AND_EXACT_REVIEW_RUN_VERIFIED_READONLY'},
      offlineReconstruction:{outcome:'CACHED_REVIEW_FULL_RECONSTRUCTION_VERIFIED_NO_WRITE'},originalSafeApprovalWindowNowClosed:true,
      originalCloudClaimBy:at-10000,originalReservedApprovalLatestAt:at-490000,recordedAt:new Date(at-1000).toISOString()}};
}
test('recovery prepares only a bounded new read, never reuses stale claim or virtual proof as execution authority',async()=>{
  const m=await makeRecoveryPreparation(fixture());assert.equal(m.cloudExecutionEntryReady,false);assert.equal(m.readPreparationIsNotApproval,true);
  assert.equal(m.historicalFactsAreNotCurrentState,true);assert.equal(m.lastKnown.controlCounts.plans,1);assert.equal(m.lastKnown.proofSha256,null);
  assert.deepEqual(m.nextProposedRead.scope,RECOVERY_READ_SCOPE);assert.equal(m.nextProposedRead.scope.cloudWrites,0);assert.equal(m.nextProposedRead.scope.s3Gets,0);
  assert.equal(m.stageEffects.awsCalls,0);assert.equal(m.expiresAt,m.createdAt+48*3600000);assert(m.forbidden.includes('extend old manifest claimBy'));
});
for(const [name,change] of Object.entries({source:x=>{x.ci.sourceCommit='0'.repeat(40);},cloud:x=>{x.compatibility.cloudClosureSha256='0'.repeat(64);},
  auth:x=>{x.auth.contentRead=true;},ledger:x=>{x.history.newControlCounts.plans=0;},job:x=>{x.history.newJob.attempts=1;},
  proof:x=>{x.history.newReviewAttempt.proofSha256='a'.repeat(64);},root:x=>{x.history.verified.rootEventId='wrong';},
  diagnosis:x=>{x.diagnostic.originalFailureCauseStillUnproved=false;},reference:x=>{x.diagnostic.fixedObject={...x.diagnostic.fixedObject,versionId:'wrong'};},
  virtual:x=>{x.diagnostic.computedProofNotStoredInDatabase=false;},future:x=>{x.createdAt=x.diagnostic.originalCloudClaimBy-1;}}))
test('recovery rejects altered '+name+' history or scope',async()=>{const x=fixture();change(x);await assert.rejects(makeRecoveryPreparation(x));});
test('preparation CLI has no run, retry, mutation, config-read or alternative source mode',()=>{
  assert.equal(parseRecoveryArgs(['--ci-run','12345','--output','out'])['--ci-run'],'12345');
  for(const a of [['--mode','RunReviewed','--output','out'],['--ci-run','12345','--retry','yes'],['--ci-run','12345','--ci-run','12345'],
    ['--ci-run','12345','--output','out','--allow-config-read','yes']])assert.throws(()=>parseRecoveryArgs(a));
});
test('preparation source contains no live service or private material entry',async()=>{
  const text=await readFile(new URL('../ops/platform-review-v6/recovery-preparation.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/new .*Client|readAuthV6|currentCloudInventory\(|readCurrentDatabaseOnce\(|GetObjectCommand|UpdateStackCommand|GetSecretValue/);
});
