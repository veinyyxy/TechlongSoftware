// Bounded orchestration only. Explicit approved IO is supplied by live.mjs.
import path from 'node:path';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {exactRunV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {LIMITS,validateReviewMetadata,intentName} from '../platform-operator-v6/review.mjs';
import {recoveryData,must,same} from '../platform-recovery-v1/basis-core.mjs';
import {assertRecoveryBinding,assertRecoveryPlanScope,RECOVERY_RISK} from './binding.mjs';
import {verifyRecoveryContent} from './content.mjs';
export const RECOVERY_FOLLOWUP=Object.freeze({...LIMITS,maxObjects:16,reserveMs:10*60000,pollMs:25000});
export {intentName as recoveryFollowupIntentName};
export async function makeRecoveryFollowupReview({input,binding,basis,operatorSourceCommit,pins,key,createdAt}){
  await assertRecoveryBinding(binding);const d=recoveryData(basis,createdAt);
  must(input?.schema==='techlong/recovery-followup-input/v1'&&input.plan?.mode==='RunOnce'&&/^[1-9][0-9]{0,15}$/.test(input.runId)&&
    /^[a-f0-9]{64}$/.test(input.innerManifestSha256)&&Number.isSafeInteger(input.workloadExpiresAt)&&
    input.workloadExpiresAt>input.plan.preparedAt&&d.target.newJobId===input.plan.jobId&&basis.basisSha256===binding.basisSha256,'FOLLOWUP_INPUT');
  assertRecoveryPlanScope(input.plan,binding);await validatePlan(input.plan,binding.release,input.plan.preparedAt);
  for(const p of [input.keyPath,input.evidenceRoot])must(typeof p==='string'&&path.isAbsolute(p)&&!/[\r\n\0]/.test(p)&&p.length<2048,'FOLLOWUP_PATH');
  validateReviewMetadata({operatorSourceCommit,pins,key,createdAt});
  const expiresAt=Math.min(createdAt+LIMITS.validMs,input.workloadExpiresAt,basis.expiresAt);
  must(expiresAt-createdAt>=LIMITS.runMs,'FOLLOWUP_PREPARATION_WINDOW');
  const body={schema:'techlong/recovery-followup-review/v1',input,binding,basisSha256:basis.basisSha256,operatorSourceCommit,pins,key,createdAt,
    expiresAt,lastStartAt:expiresAt-LIMITS.runMs,resultKey:resultKeyV6(input.plan.jobId,input.plan.inputs.manifestSha,input.runId),
    effects:{inspectDispatchesMax:1,appKeyReadsMax:1,githubReadCredentialLoadsMax:1,appInstallationTokensMax:1,appTokenRevocationsMax:1,
      sourceCredentialLoadsMax:6,sourceStsGetsMax:6,s3VersionedGetsMax:16,s3LatestHeadsMax:2,githubRunGetsMax:80,
      cloudInspectDatabaseSecretReadsMax:1,cloudInspectReadOnlyTransactionsMax:3,cloudInspectEvidencePutsMax:2,
      runOnceDispatches:0,jobClaims:0,cloudResourceWrites:0,databaseWrites:0,platformLedgerWrites:0,localSecretValueReads:0,localSqlConnections:0,automaticRetries:0},
    policy:{waitForRunOnce:true,minInspectReserveMs:RECOVERY_FOLLOWUP.reserveMs,requiresHumanEnvironmentApproval:true,sharedInspectPermanentSlot:true,
      noHistoricalReplay:true,noPersistedLedgerImport:true,noPlatformAcceptanceFlagChange:true,preparationIsNotApproval:true},
    risks:{privateKeyAndCredentialsInMemory:true,installationTokenHasActionsWrite:true,providerAndLocalLogsPossible:true,memoryErasureNotGuaranteed:true,
      metadataIsNotCas:true,ackMayBeUnknown:true,revocationMayFail:true,expiryDoesNotCancelInFlight:true,nonzeroCost:true,
      permanentSlotNeverReset:true,noAutomaticRetryOrCompensation:true,humanApprovalCanMissTtl:true},riskFile:RECOVERY_RISK};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyRecoveryFollowupReview(m,approved,basis,binding,at,starting=false){
  must(same(binding,m.binding)&&same(m,await makeRecoveryFollowupReview({...m,binding,basis}))&&approved===m.manifestSha256&&
    Number.isSafeInteger(at)&&at>=m.createdAt&&at<m.expiresAt&&(!starting||at<m.lastStartAt),'FOLLOWUP_APPROVAL_OR_EXPIRED');
  must(m.operatorSourceCommit===binding.sourceCommit&&m.operatorSourceCommit===m.input.plan.sourceCommit,'FOLLOWUP_HISTORICAL_SOURCE');
}
export function assertRecoveryPolledRun(raw,id,binding){
  must(['queued','requested','waiting','pending','in_progress','completed'].includes(raw?.status)&&
    (raw.status==='completed'?['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(raw.conclusion):raw.conclusion===null),'FOLLOWUP_RUN_STATUS');
  exactRunV6({...raw,status:'completed',conclusion:'success'},{runId:id,sourceCommit:binding.sourceCommit,
    workflowId:binding.release.workflowId,reusableCommit:binding.release.reusableCommit});
  if(raw.status==='completed')must(raw.conclusion==='success','FOLLOWUP_RUN_FAILED');return raw.status==='completed';
}
export async function followRecoveryRunOnce({manifest:m,approved,basis,binding,io,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),rebuildPackage}){
  await verifyRecoveryFollowupReview(m,approved,basis,binding,now(),true);
  let phase='PREFLIGHT',ack=null,claimAttempted=false,claimed=false,runReads=0;
  const readRun=async id=>{must(++runReads<=LIMITS.maxRunGets,'FOLLOWUP_RUN_GET_BUDGET');return io.readRun(id);};
  const budget=(reserve=RECOVERY_FOLLOWUP.reserveMs)=>must(Number.isSafeInteger(io.deadline)&&now()+reserve<
    Math.min(io.deadline,m.expiresAt,m.input.workloadExpiresAt,basis.expiresAt),'FOLLOWUP_INSUFFICIENT_WINDOW');
  const content=(plan,id,run,ref,deriveInspectPlan=false)=>verifyRecoveryContent({binding,basis,plan,runId:id,run,
    resultReference:ref,readObject:io.readObject,deriveInspectPlan,now,rebuildPackage});
  try{
    budget();await io.guard();await io.preflight();await io.guard();budget();phase='PERMANENT_SLOT';claimAttempted=true;await io.claim();claimed=true;
    phase='WAIT_RUNONCE';await io.record('awaiting-runonce-terminal',{runId:m.input.runId,resultKey:m.resultKey,deadline:Math.min(io.deadline,m.expiresAt)-RECOVERY_FOLLOWUP.reserveMs,noRerun:true});
    let original;for(let n=0;n<LIMITS.maxPolls;n++){await io.guard();budget();const raw=await readRun(m.input.runId);
      if(assertRecoveryPolledRun(raw,m.input.runId,binding)){original=raw;break;}if(n+1<LIMITS.maxPolls)await sleep(RECOVERY_FOLLOWUP.pollMs);}
    must(original,'FOLLOWUP_RUNONCE_NOT_TERMINAL');await io.record('runonce-terminal',original);phase='ORIGINAL_CONTENT';await io.guard();budget();
    const ref=await io.discoverExecutionResult(m.input.runId),prior=await content(m.input.plan,m.input.runId,original,ref,true);
    must(prior.attestation.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED','FOLLOWUP_RUNONCE_SUCCESS_REQUIRED');
    const envelope=(await io.readObject(prior.attestation.manifestReference)).value;
    must(envelope.innerManifest.workload.workloadExpiresAt===m.input.workloadExpiresAt&&
      envelope.innerManifest.manifestSha256===m.input.innerManifestSha256,'FOLLOWUP_TTL_OR_INNER_DRIFT');
    await io.record('original-content',prior);const plan=prior.derivedInspectPlan.plan;await io.record('inspect-plan',prior.derivedInspectPlan);
    await io.guard();budget();phase='INSPECT_DISPATCH';ack=await io.dispatch(plan);must(ack.runId!==m.input.runId,'FOLLOWUP_INDEPENDENT_RUN');
    phase='HUMAN_ENVIRONMENT';await io.record('awaiting-human-environment',{...ack,mode:'Inspect',deadline:Math.min(io.deadline,m.expiresAt),
      workloadExpiresAt:m.input.workloadExpiresAt,noRerun:true,requiresHumanApproval:true});
    let terminal;for(let n=0;n<LIMITS.maxPolls;n++){await io.guard();budget(0);const raw=await readRun(ack.runId);
      if(assertRecoveryPolledRun(raw,ack.runId,binding)){terminal=raw;break;}if(n+1<LIMITS.maxPolls)await sleep(RECOVERY_FOLLOWUP.pollMs);}
    must(terminal,'FOLLOWUP_INSPECT_NOT_TERMINAL');await io.record('inspect-terminal',terminal);phase='INDEPENDENT_CONTENT';await io.guard();budget(0);
    const resultReference=await io.discoverResult(ack.runId),verified=await content(plan,ack.runId,terminal,resultReference);
    must(verified.independentCloudAcceptanceVerified,'FOLLOWUP_ACCEPTANCE_NOT_PROVED');await io.record('independent-content',verified);
    if(io.bundle)await io.record('bundle',await io.bundle(plan,ack.runId,terminal,resultReference));await io.guard();budget(0);
    const result={outcome:'RECOVERY_FOLLOWUP_INDEPENDENT_INSPECT_VERIFIED_NOT_IMPORTED',jobId:plan.jobId,executionRunId:m.input.runId,
      inspectRunId:ack.runId,sourceCommit:plan.sourceCommit,manifestSha256:m.manifestSha256,checkedAt:now(),independentCloudAcceptanceVerified:true,
      platformLedgerVerified:false,platformLedgerWrites:0,proofImported:false,platformAcceptanceFlagChanged:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch(e){const result={outcome:'RECOVERY_FOLLOWUP_UNCONFIRMED_NO_RETRY',phase,ack:ack??io.knownAck?.()??null,claimAttempted,claimed,
    safeCode:/^(?:RECOVERY_V1|PLATFORM_OPERATOR|CONTROL)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:null,
    detailsWithheld:true,independentCloudAcceptanceVerified:false,retryAllowed:false};await io.record('result',result);return result;
  }finally{await io.close();}
}
