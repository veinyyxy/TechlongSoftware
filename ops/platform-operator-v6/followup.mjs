// Explicitly approved, already-acknowledged RunOnce -> separate Inspect run.
// No live client, credential, file read or dispatch is acquired on import.
import path from 'node:path';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {verifyCloudResultContent} from '../platform-operations-v6/evidence.mjs';
import {assertPolledRun} from './inspect.mjs';
import {LIMITS,exactKeys,must,same,validateReviewMetadata} from './review.mjs';

export const FOLLOWUP=Object.freeze({reserveMs:10*60000,pollMs:25000,
  riskFile:'docs/aws-auto-deployment-w9c-immediate-inspect.md'});
export async function validateFollowupInput(raw){
  const v=structuredClone(raw);exactKeys(v,['schema','plan','runId','workloadExpiresAt','keyPath','evidenceRoot']);
  must(v.schema==='techlong/platform-operator-followup-input/v1'&&/^[1-9][0-9]{0,15}$/.test(v.runId)&&v.plan?.mode==='RunOnce','FOLLOWUP_INPUT');
  await validatePlan(v.plan,B.platform,v.plan.preparedAt);
  must(Number.isSafeInteger(v.workloadExpiresAt)&&v.workloadExpiresAt>v.plan.preparedAt,'FOLLOWUP_TTL');
  for(const p of [v.keyPath,v.evidenceRoot])must(typeof p==='string'&&path.isAbsolute(p)&&!/[\r\n\0]/.test(p)&&p.length<2048,'ABSOLUTE_PATH');
  return v;
}
export async function makeFollowupReview({input,operatorSourceCommit,pins,key,createdAt}){
  input=await validateFollowupInput(input);validateReviewMetadata({operatorSourceCommit,pins,key,createdAt});
  const expiresAt=Math.min(createdAt+LIMITS.validMs,input.workloadExpiresAt);
  must(expiresAt-createdAt>=LIMITS.runMs,'FOLLOWUP_TOO_LATE_TO_PREPARE');
  const body={schema:'techlong/platform-operator-followup-review/v1',input,operatorSourceCommit,pins,key,binding:B,createdAt,expiresAt,
    lastStartAt:expiresAt-LIMITS.runMs,resultKey:resultKeyV6(input.plan.jobId,input.plan.inputs.manifestSha,input.runId),
    effects:{inspectDispatchesMax:1,appKeyReadsMax:1,githubReadCredentialLoadsMax:1,appInstallationTokensMax:1,appTokenRevocationsMax:1,
      sourceCredentialLoadsMax:6,sourceStsGetsMax:6,s3VersionedGetsMax:8,s3LatestHeadsMax:2,githubRunGetsMax:80,
      cloudInspectDatabaseSecretReadsMax:1,cloudInspectReadOnlyTransactionsMax:3,cloudInspectEvidencePutsMax:2,
      runOnceDispatches:0,jobClaims:0,cloudResourceWrites:0,databaseWrites:0,platformLedgerWrites:0,localSecretValueReads:0,localSqlConnections:0,automaticRetries:0},
    policy:{waitForRunOnce:true,requiresHumanEnvironmentApproval:true,minInspectReserveMs:FOLLOWUP.reserveMs,
      exactResultKeyOnly:true,versionSelectedBySingleHeadThenPinned:true,successOutcomeRequired:true,sharedInspectPermanentSlot:true,
      noHistoricalReplay:true,noPersistedLedgerImport:true,noPlatformAcceptanceFlagChange:true,preparationIsNotApproval:true},
    risks:{privateKeyAndReadCredentialInMemory:true,providerAndLocalLogsPossible:true,memoryErasureNotGuaranteed:true,
      installationTokenHasActionsWrite:true,metadataChecksAreNotCas:true,ackMayBeUnknown:true,revocationMayFail:true,
      expiryDoesNotCancelInFlightCalls:true,nonzeroCost:true,permanentSlotNeverReset:true,noAutomaticRetryOrCompensation:true,
      waitingConsumesObservationWindow:true,environmentApprovalMayMissTtl:true},riskFile:FOLLOWUP.riskFile};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyFollowupReview(m,approved,now,starting=false){
  must(same(m,await makeFollowupReview(m))&&approved===m.manifestSha256&&Number.isSafeInteger(now)&&now>=m.createdAt&&now<m.expiresAt&&
    (!starting||now<m.lastStartAt),'FOLLOWUP_APPROVAL_OR_EXPIRED');
  must(m.operatorSourceCommit===m.input.plan.sourceCommit,'HISTORICAL_SOURCE_NO_DISPATCH');
}
export function assertFollowupBudget(m,deadline,at,reserve=FOLLOWUP.reserveMs){
  must(Number.isSafeInteger(deadline)&&Number.isSafeInteger(at)&&at>=m.createdAt&&
    at+reserve<Math.min(deadline,m.expiresAt,m.input.workloadExpiresAt),'FOLLOWUP_INSUFFICIENT_WINDOW');
}
export async function followRunOnceOnce({manifest,approved,io,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  const m=structuredClone(manifest);await verifyFollowupReview(m,approved,now(),true);
  let phase='PREFLIGHT',ack=null,claimAttempted=false,claimed=false;
  const input=m.input,content=(plan,runId,run,ref,deriveInspectPlan=false)=>verifyCloudResultContent({plan,runId,run,resultReference:ref,
    release:B.platform,sourceCommit:input.plan.sourceCommit,frozenSourceCommit:B.publisher.frozenSourceCommit,readObject:io.readObject,deriveInspectPlan,now});
  try{
    assertFollowupBudget(m,io.deadline,now());await io.guard();await io.preflight();await io.guard();
    assertFollowupBudget(m,io.deadline,now());phase='PERMANENT_SLOT';claimAttempted=true;await io.claim();claimed=true;
    phase='WAIT_RUNONCE';await io.record('awaiting-runonce-terminal',{runId:input.runId,resultKey:m.resultKey,
      deadline:Math.min(io.deadline,m.expiresAt)-FOLLOWUP.reserveMs,noRerun:true});
    let original;
    for(let n=0;n<LIMITS.maxPolls;n++){
      await io.guard();assertFollowupBudget(m,io.deadline,now());const raw=await io.readRun(input.runId);
      if(assertPolledRun(raw,input.runId,input.plan.sourceCommit)){original=raw;break;}
      if(n+1<LIMITS.maxPolls)await sleep(FOLLOWUP.pollMs);
    }
    must(original,'FOLLOWUP_RUNONCE_NOT_TERMINAL');await io.record('runonce-terminal',original);
    phase='ORIGINAL_CONTENT';await io.guard();assertFollowupBudget(m,io.deadline,now());
    const ref=await io.discoverExecutionResult(input.runId),prior=await content(input.plan,input.runId,original,ref,true);
    must(prior.attestation.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED','FOLLOWUP_RUNONCE_NOT_SUCCEEDED');
    const originalManifest=await io.readObject(prior.attestation.manifestReference);
    must(originalManifest.value.workload?.workloadExpiresAt===input.workloadExpiresAt,'FOLLOWUP_MANIFEST_TTL_DRIFT');
    await io.record('original-content',prior);const plan=prior.derivedInspectPlan.plan;await io.record('inspect-plan',prior.derivedInspectPlan);
    await io.guard();assertFollowupBudget(m,io.deadline,now());phase='INSPECT_DISPATCH';ack=await io.dispatch(plan);
    must(ack.runId!==input.runId,'INDEPENDENT_RUN');phase='HUMAN_ENVIRONMENT';
    await io.record('awaiting-human-environment',{...ack,mode:'Inspect',deadline:Math.min(io.deadline,m.expiresAt),
      workloadExpiresAt:input.workloadExpiresAt,noRerun:true,requiresHumanApproval:true});
    let terminal;
    for(let n=0;n<LIMITS.maxPolls;n++){
      await io.guard();assertFollowupBudget(m,io.deadline,now(),0);const raw=await io.readRun(ack.runId);
      if(assertPolledRun(raw,ack.runId,plan.sourceCommit)){terminal=raw;break;}
      if(n+1<LIMITS.maxPolls)await sleep(FOLLOWUP.pollMs);
    }
    must(terminal,'OBSERVATION_WINDOW_EXPIRED');await io.record('inspect-terminal',terminal);phase='INDEPENDENT_CONTENT';
    await io.guard();assertFollowupBudget(m,io.deadline,now(),0);
    const resultReference=await io.discoverResult(ack.runId),verified=await content(plan,ack.runId,terminal,resultReference);
    must(verified.independentCloudAcceptanceVerified,'INDEPENDENT_ACCEPTANCE_NOT_PROVED');
    await io.guard();assertFollowupBudget(m,io.deadline,now(),0);await io.record('independent-content',verified);
    if(io.bundle)await io.record('bundle',await io.bundle(plan,ack.runId,terminal,resultReference));
    await io.guard();assertFollowupBudget(m,io.deadline,now(),0);
    const result={outcome:'FOLLOWUP_INDEPENDENT_INSPECT_VERIFIED_NOT_IMPORTED',jobId:plan.jobId,executionRunId:input.runId,inspectRunId:ack.runId,
      sourceCommit:plan.sourceCommit,manifestSha256:m.manifestSha256,checkedAt:now(),immediateFollowup:true,
      independentCloudAcceptanceVerified:true,platformLedgerVerified:false,platformLedgerWrites:0,proofImported:false,
      platformAcceptanceFlagChanged:false,retryAllowed:false};await io.record('result',result);return result;
  }catch(e){
    const result={outcome:'FOLLOWUP_UNCONFIRMED_NO_RETRY',phase,ack:ack??io.knownAck?.()??null,claimAttempted,claimed,
      safeCode:/^(?:PLATFORM_OPERATOR_|PLATFORM_OPERATIONS_|CONTROL_)[A-Z0-9_]+$/.test(e?.message)?e.message:null,
      detailsWithheld:true,independentCloudAcceptanceVerified:false,retryAllowed:false};await io.record('result',result);return result;
  }finally{await io.close();}
}
