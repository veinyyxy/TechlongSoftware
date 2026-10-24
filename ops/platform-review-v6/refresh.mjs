// One append-only Review refresh. Import has no I/O or credential discovery.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {J,assertFollowupHeld} from './followup.mjs';
export const R=Object.freeze({jobId:J.jobId,
  oldPlanSha256:'efeff7c2bbd24c9869cd6daccb43bdb106940ba12720fee6853c085cbdeed4e6',
  oldActionSha256:'1e6c0570cf3e5a1e8c806893c2f44d37910028840d01c26b3579fa4d573799b2',
  oldSource:'02bc4c26a22e4e81141e7426f521e4bb0a51fe6f',
  oldPlanFile:'F:/ChatGPT_workshop/techlong-w8j-review-plan-20261023-b-run/proposed-plan.json',
  oldPlanFileSha256:'abed43046ffa416194e6d185c7654b3d41103c9ce2492c2aade4bdc14e11a974',
  publicationFile:'F:/ChatGPT_workshop/techlong-platform-w8j-publication-verified-20261023-b.json',
  publicationFileSha256:'70169b2f9086bb9857ec5b6cdc4a45e2a134410457dfc623789d5ccaff4fbca2',
  readOnlyFile:'F:/ChatGPT_workshop/techlong-platform-w8k-recovery-readonly-20261023-b.json',
  readOnlyFileSha256:'d8cd5f3733ef3d8cb3e91744fe18848ab473a04340c84c89d21134502eebb1c5',
  lineageVersion:'pin8XHJzZaadT7HU.rnn2POdD06xPphz',
  slot:'F:/ChatGPT_workshop/techlong-w8l-review-refresh.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8l-review-refresh-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8l-review-refresh.md',validMs:48*3600000,runMs:120000});
export const must=(ok,code)=>{if(!ok)throw Error('REVIEW_REFRESH_'+code);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const LEDGER_SQL=`SELECT jsonb_build_object(
  'counts',jsonb_build_object('plans',(SELECT count(*)::int FROM deployment_control_v6.plans WHERE job_id=$1),
    'approvals',(SELECT count(*)::int FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1),
    'attempts',(SELECT count(*)::int FROM deployment_control_v6.dispatch_attempts WHERE job_id=$1)),
  'entries',(SELECT coalesce(jsonb_agg(deployment_control_v6.load_plan(p.plan_sha) ORDER BY p.plan_sha),'[]'::jsonb)
    FROM (SELECT plan_sha FROM deployment_control_v6.plans WHERE job_id=$1 ORDER BY plan_sha LIMIT 3) p)) AS value`;
export async function oldReview(v){
  const checked=await validatePlan(v.plan,B.platform,v.plan.preparedAt);
  must(same(v,checked)&&v.planSha256===R.oldPlanSha256&&v.actionSha256===R.oldActionSha256&&
    v.plan.sourceCommit===R.oldSource&&v.plan.jobId===R.jobId&&v.plan.mode==='Review'&&v.plan.predecessor===null,'OLD_PLAN');return checked;
}
export async function makeRefreshReview({sourceCommit,pins,ci,auth,baseline,oldPlan,references,parents,readOnly,compatibility,createdAt}){
  await oldReview(oldPlan);
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&sourceCommit!==R.oldSource&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&
    ci.status==='completed'&&ci.conclusion==='success'&&pins.length>=15&&new Set(pins.map(p=>p.file)).size===pins.length&&
    pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&Number.isSafeInteger(createdAt)&&createdAt>oldPlan.plan.expiresAt,'SOURCE_CI');
  must(auth?.contentRead===false&&auth.length>0&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&baseline.target.id===R.jobId&&
    baseline.target.status==='pending'&&baseline.target.attempts===0&&baseline.target.leasePresent===false&&
    baseline.target.cloudExecutionAuthorized===false&&baseline.snapshotRows.length===9&&baseline.oldJobs.length===6,'BASELINE');
  must(same(references,{installation:JSON.parse(oldPlan.plan.inputs.installation),lineage:JSON.parse(oldPlan.plan.inputs.lineage)})&&
    references.lineage.key===J.lineageKey&&references.lineage.sha256===J.lineageSha256&&references.lineage.versionId===R.lineageVersion,'REFERENCES');
  must(parents.length>=5&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&
    readOnly.state==='EXACT_OLD_REVIEW_AND_HELD_JOB_READ_ONLY_VERIFIED'&&readOnly.jobId===R.jobId&&
    readOnly.oldPlan.planSha256===R.oldPlanSha256&&readOnly.oldPlan.bodyExactlyUnchanged===true&&readOnly.oldPlan.expired===true&&
    same(readOnly.controlCounts,{plans:1,approvals:0,attempts:0})&&same(readOnly.planHashes,[R.oldPlanSha256])&&
    readOnly.target.rowSha256===baseline.target.rowSha256&&same(readOnly.snapshotRows,baseline.snapshotRows)&&
    same(readOnly.oldJobRows,baseline.oldJobs)&&readOnly.nineSnapshotRowsAndSixOldJobsUnchanged===true&&
    Number.isSafeInteger(readOnly.checkedAt)&&readOnly.checkedAt<=createdAt,'READ_ONLY_PROOF');
  must(compatibility?.executionSourceCommit===sourceCommit&&compatibility.imageSourceCommit===J.imageSourceCommit&&
    compatibility.protectedRuntimeCodeUnchanged===true&&compatibility.cloudClosureSha256===B.platform.closureSha256,'RUNTIME_COMPATIBILITY');
  const body={schema:'techlong/platform-review-refresh/v6',sourceCommit,runtimeSourceCommit:sourceCommit,imageSourceCommit:J.imageSourceCommit,
    pins,ci,auth,baseline,oldPlan,references,parents,readOnly,compatibility,binding:B,scope:R,createdAt,
    expiresAt:createdAt+R.validMs,latestStartAt:createdAt+R.validMs-R.runMs,riskFile:R.riskFile,
    effects:{authFileReadsMax:2,sourceStsReadsMax:2,s3VersionGetsMax:3,explicitReadOnlyTransactionsMax:8,ownerPlanSqlMax:1,
      s3Puts:0,newJobs:0,oldPlanUpdatesOrDeletes:0,approvals:0,dispatches:0,jobClaims:0,hostedUpdates:0,newIam:0,secretValueReads:0,privateKeyReads:0},
    planClock:'One new two-hour Review derived at publication, preserving the exact expired old plan; no hosted lease starts',
    risks:{wholeOwnerFileRead:true,ownerMemoryAndProviderLogs:true,metadataNotCas:true,unknownSqlCommitMayPersist:true,
      newPlanEvidenceMayPersist:true,noAutomaticRetryRollbackResetDeleteOrCompensation:true,existingHostingMayBill:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyRefreshReview(m,approved,now,inspect=false){
  must(same(m,await makeRefreshReview(m))&&approved===m.manifestSha256&&now>=m.createdAt&&
    now<(inspect?m.expiresAt:m.latestStartAt),'APPROVAL_OR_EXPIRED');return m;
}
export async function refreshedPlan(plan,m,notBefore,now){
  const v=await validatePlan(plan,m.binding.platform,plan.preparedAt);
  must(v.plan.mode==='Review'&&v.plan.jobId===R.jobId&&v.plan.sourceCommit===m.sourceCommit&&v.plan.predecessor===null&&
    v.plan.inputs.installation===canonicalJson(m.references.installation)&&v.plan.inputs.lineage===canonicalJson(m.references.lineage)&&
    v.plan.preparedAt>=notBefore&&v.plan.preparedAt<=now&&v.plan.expiresAt===v.plan.preparedAt+7200000&&
    v.planSha256!==R.oldPlanSha256,'NEW_REVIEW_PLAN');return v;
}
export async function assertRefreshLedger(v,m,now,next=null){
  const expected=[m.oldPlan,...(next?[next]:[])];must(same(v?.counts,{plans:expected.length,approvals:0,attempts:0})&&
    v.entries?.length===expected.length&&new Set(v.entries.map(e=>e.planSha256)).size===expected.length&&now>=m.oldPlan.plan.expiresAt,'LEDGER_COUNTS');
  for(const p of expected){const e=v.entries.find(e=>e.planSha256===p.planSha256);
    must(e&&same(e.plan,p.plan)&&e.actionSha256===p.actionSha256&&e.riskSha256===p.plan.riskSha256&&e.attempt===null,'EXACT_LEDGER_ENTRY');}
  return v;
}
export async function publishRefreshOnce({manifest:m,approved,io,now=Date.now}){
  const start=now(),guard=async()=>{await verifyRefreshReview(m,approved,now());must(now()-start<R.runMs,'OPERATION_WINDOW');await io.assertSource();};
  await guard();await io.preflight();await io.claim();let db,phase='SLOT_CONSUMED';
  try{
    await guard();phase='OWNER_READ';db=await io.open(await io.readAuth());
    phase='EXACT_OLD_LEDGER';await assertRefreshLedger(await db.ledger(),m,now());await assertFollowupHeld(await db.readHeldJob(R.jobId),m.baseline,now());
    phase='APPEND_REVIEW';const next=await io.publishReview({db,guard,notBefore:start});await refreshedPlan(next.plan,m,start,now());
    const result={outcome:'REVIEW_REFRESH_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',jobId:R.jobId,runtimeSourceCommit:m.sourceCommit,
      preservedOldPlanSha256:R.oldPlanSha256,planSha256:next.planSha256,actionSha256:next.actionSha256,riskSha256:next.plan.riskSha256,
      planExpiresAt:next.plan.expiresAt,executionApproved:false,dispatches:0,retryAllowed:false};await io.record('result',result);return result;
  }catch{const result={outcome:'REVIEW_REFRESH_PARTIAL_OR_UNKNOWN_NO_RETRY',phase,jobId:R.jobId,retryAllowed:false};await io.record('failure',result);return result;
  }finally{await db?.dispose();await io.dispose();}
}
