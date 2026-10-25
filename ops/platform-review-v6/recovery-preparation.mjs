// Preparation only: immutable local history + CI metadata. No live state collector.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environment,git,ROOT,readText,writeOnce,absent,noLinks,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {K,P,H} from '../platform-hosted-window-v6/contract.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {CYCLE_ROOTS} from './cycle-local.mjs';
const must=(ok,code)=>{if(!ok)throw Error('RECOVERY_PREPARATION_'+code);};
export const RECOVERY=Object.freeze({jobId:'job_6a1129afcebfc9fb580517c9',runId:'40165734067',
  planSha256:'b8cf5e3cd3d7b41e01ff52bd8c7a5958858c3066ccb00c7fe509cbba9be597db',
  oldSourceCommit:'320be62add8fad5ad3f05ff40d44612b0b87e493',rootEventId:'cf550b50-d034-11f1-92cf-06fff46e9227',
  execution:{file:'F:/ChatGPT_workshop/techlong-w8w-review-handoff-stopped-independently-verified-20261025-a.json',
    rawSha256:'aba7a69b78b0790f5e56eebd2d1c92b88a98387c36268f5b3fd578e501da8394'},
  diagnostic:{file:'F:/ChatGPT_workshop/techlong-w8w-fixed-manifest-diagnostic-completed-verified-20261025-a.json',
    rawSha256:'a0bb1cce6fd76b3a017fecea821b61e4a84071012dcfa9b4c3e273a78545f2ea'},
  riskFile:'docs/aws-auto-deployment-platform-w8x-recovery-preparation.md'});
export const RECOVERY_READ_SCOPE=Object.freeze({awsMetadataMax:75,cloudSnapshotsMax:1,configContentReadsMax:1,verifiedTlsNeonConnectionsMax:1,
  readOnlySqlQueriesMax:45,s3Gets:0,githubDeploymentRunGets:0,secretValueReads:0,pemReads:0,cloudWrites:0,sqlWrites:0,
  ownerProofWrites:0,ownerObservationWrites:0,planWrites:0,workflowDispatches:0,appTokens:0,executionSlots:0,automaticRetries:0});
export const RECOVERY_ROOTS=[...CYCLE_ROOTS,'ops/platform-review-v6/recovery-preparation.mjs','ops/platform-review-v6/operator-failure.mjs',
  'ops/platform-review-v6/cycle-reads.mjs','ops/platform-review-v6/current-cloud.mjs','ops/platform-review-v6/current-database.mjs',
  'tests/platform-operator-failure-v6.test.mjs','tests/platform-recovery-preparation-v6.test.mjs',RECOVERY.riskFile];
export async function makeRecoveryPreparation({sourceCommit,pins,ci,compatibility,auth,history,diagnostic,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&pins.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&
    pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&ci.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success','SOURCE_CI');
  must(compatibility.executionSourceCommit===sourceCommit&&compatibility.protectedRuntimeCodeUnchanged===true&&compatibility.imageSourceCommit===H.imageSource&&
    compatibility.cloudClosureSha256===B.platform.closureSha256&&
    auth.contentRead===false&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&auth.length>0,'COMPATIBILITY_OR_AUTH');
  must(history.sourceCommit===RECOVERY.oldSourceCommit&&history.reviewPlanSha256===RECOVERY.planSha256&&history.reviewRunId===RECOVERY.runId&&
    history.allFourExecutionSlotsConsumed===true&&history.independentInspectConsumed===true&&history.noRunOncePlan===true&&
    history.verified.rootEventId===RECOVERY.rootEventId&&history.verified.taskDefinition===`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:7`&&
    canonicalJson(history.newControlCounts)===canonicalJson({plans:1,approvals:1,attempts:1})&&history.newJob.id===RECOVERY.jobId&&
    history.newJob.status==='pending'&&history.newJob.attempts===0&&history.newJob.maxAttempts===1&&history.newJob.leaseOwner===null&&
    history.newJob.reviewRequired===true&&history.newJob.cloudExecutionAuthorized===false&&
    history.newReviewAttempt.state==='ACKNOWLEDGED'&&history.newReviewAttempt.runId===RECOVERY.runId&&history.newReviewAttempt.proofSha256===null&&
    history.oldJobsHistoryBusinessAndProtectionUnchanged===true,'HISTORICAL_EXECUTION');
  must(diagnostic.sourceCommit===RECOVERY.oldSourceCommit&&diagnostic.reviewRunId===RECOVERY.runId&&diagnostic.reviewRunStatus==='completed'&&diagnostic.reviewRunConclusion==='success'&&
    canonicalJson(diagnostic.fixedObject)===canonicalJson(history.discovery.manifestReference)&&
    diagnostic.originalFailureReproduced===false&&diagnostic.originalFailureCauseStillUnproved===true&&diagnostic.diagnosticReadScopeConsumed===true&&
    diagnostic.virtualObservedStateWasOnlyInMemory===true&&diagnostic.computedProofNotStoredInDatabase===true&&diagnostic.databaseFreshlyRead===false&&
    diagnostic.result.outcome==='FIXED_MANIFEST_AND_EXACT_REVIEW_RUN_VERIFIED_READONLY'&&
    diagnostic.offlineReconstruction.outcome==='CACHED_REVIEW_FULL_RECONSTRUCTION_VERIFIED_NO_WRITE'&&
    diagnostic.originalSafeApprovalWindowNowClosed===true&&Number.isSafeInteger(createdAt)&&createdAt>=diagnostic.originalCloudClaimBy&&
    createdAt>=Date.parse(diagnostic.recordedAt),'HISTORICAL_DIAGNOSIS');
  const body={schema:'techlong/recovery-read-only-preparation/v6',sourceCommit,pins,ci,compatibility,auth,createdAt,expiresAt:createdAt+48*3600000,
    parents:[RECOVERY.execution,RECOVERY.diagnostic],historicalFactsAreNotCurrentState:true,historicalReadScopesConsumed:true,
    lastKnown:{runtimeSourceCommit:RECOVERY.oldSourceCommit,stackId:K.stackId,rootEventId:RECOVERY.rootEventId,taskDefinition:history.verified.taskDefinition,
      jobId:RECOVERY.jobId,jobStatus:'pending',businessJobAttempts:0,controlCounts:history.newControlCounts,reviewPlanSha256:RECOVERY.planSha256,
      reviewRunId:RECOVERY.runId,reviewAttemptState:'ACKNOWLEDGED',proofSha256:null,reviewDispatchSlotPermanentlyConsumed:true,cloudClaimBy:diagnostic.originalCloudClaimBy,
      reservedApprovalLatestAt:diagnostic.originalReservedApprovalLatestAt,oldAttemptClosed:true},
    nextProposedRead:{permissionGranted:false,profile:P.profile,account:P.account,region:P.region,sourceArn:P.sourceArn,sourceId:P.sourceId,stackId:K.stackId,
      jobId:RECOVERY.jobId,scope:RECOVERY_READ_SCOPE,configuration:'Existing reviewed .env.local owner connection; whole file in memory, exact target and verified TLS',
      intent:'One fresh AWS fixed-resource metadata snapshot and one Neon repeatable-read read-only snapshot; compare full history, ledger, role/protection and admission before proposing a new Review.'},
    forbidden:['reuse old slots or workflows','dispatch another Review for the same job with its permanent job/mode slot occupied',
      'extend old manifest claimBy','persist virtual OBSERVED state or computed diagnostic proof',
      'install IAM or secrets','create or claim tenant workload','write database or cloud','assume old Review success authorizes RunOnce'],
    nextAfterRead:'The current job Review dispatch is permanently occupied under UNIQUE(job_id,mode). Read fresh state before preparing any separately reviewed new held-task transfer; preserve all rows/slots, with no automatic transfer or Review.',
    risks:{wholeConfigInMemory:true,ownerCredentialNotRowLimited:true,providerLogs:true,nonAtomicReadNotCas:true,lowNonzeroFees:true,
      noAutomaticRetryResetOrMutation:true},readPreparationIsNotApproval:true,cloudExecutionEntryReady:false,codeOnlyPreparation:true,
    riskFile:RECOVERY.riskFile,stageEffects:{configContentReads:0,productionNeonConnections:0,awsCalls:0,s3Gets:0,cloudWrites:0,sqlWrites:0,executionSlots:0,dispatches:0}};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export function parseRecoveryArgs(args){
  const a={};must(args.length===4,'ARGS');for(let n=0;n<args.length;n+=2){must(['--ci-run','--output'].includes(args[n])&&!Object.hasOwn(a,args[n])&&typeof args[n+1]==='string','ARGS');a[args[n]]=args[n+1];}
  must(/^[1-9][0-9]{0,15}$/.test(a['--ci-run'])&&a['--output'],'ARGS');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseRecoveryArgs(args);environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase(),'ENVIRONMENT');
  const sourceCommit=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','CLEAN_MAIN');
  const out=path.resolve(a['--output']);must(path.dirname(out).toLowerCase()===path.resolve('F:/ChatGPT_workshop').toLowerCase()&&
    /^techlong-w8x-recovery-[a-z0-9-]+$/.test(path.basename(out)),'OUTPUT');await noLinks(path.dirname(out));await absent(out);
  const parents=[];for(const p of [RECOVERY.execution,RECOVERY.diagnostic]){
    const raw=await readText(p.file,3000000);must(await sha256Hex(raw)===p.rawSha256,'PARENT_DIGEST');const v=JSON.parse(raw);
    for(const f of v.artifacts)must(await sha256Hex(await readText(f.file,3000000))===f.rawSha256,'PARENT_ARTIFACT');parents.push(v);
  }
  const result=await makeRecoveryPreparation({sourceCommit,pins:await collectPins({roots:RECOVERY_ROOTS}),ci:await readLocalCiV6(a['--ci-run'],sourceCommit),
    compatibility:await sourceCompatibility(sourceCommit),auth:await authMetadataV6(),history:parents[0],diagnostic:parents[1],createdAt:Date.now()});
  must(git(['rev-parse','HEAD']).trim()===sourceCommit&&git(['status','--porcelain']).trim()==='','SOURCE_CHANGED');
  assertEvidenceSafeV5(result);await mkdir(out,{mode:0o700});await writeOnce(path.join(out,'manifest.json'),result);
  const summary={outcome:'RECOVERY_READ_ONLY_PREPARATION_REQUIRES_NEW_PERMISSION',manifestSha256:result.manifestSha256,sourceCommit,
    cloudExecutionEntryReady:false,stageEffects:result.stageEffects};await writeOnce(path.join(out,'result.json'),summary);console.log(JSON.stringify({...summary,output:out}));return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('RECOVERY_PREPARATION_STOPPED_NO_LIVE_CALLS');process.exitCode=1;
});
