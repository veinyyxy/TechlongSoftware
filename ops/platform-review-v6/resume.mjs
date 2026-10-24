// W8n: one explicitly reviewed append after exactly two expired, untouched plans.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {J,assertFollowupHeld} from './followup.mjs';
import {R,LEDGER_SQL,oldReview} from './refresh.mjs';
export {J,R,LEDGER_SQL};
export const N=Object.freeze({jobId:J.jobId,
  priorPlanSha:'bc4bede6b3b61a4556efb2b3ed11f6fb3fae601f50df3770a3d0279efee1fdf6',
  priorActionSha:'db1113b2932d82f333ba494dec1f4063154c0dd4ec228cbd71135f3c60b15fde',
  priorSource:'ea78677b790c3bd29299e040a6e37335f22a7e5e',
  priorFile:'F:/ChatGPT_workshop/techlong-w8l-review-refresh-20261024-b-run/proposed-plan.json',
  priorFileSha:'a8c4ea0ebef862e7f050a49a84c6d23431dd61e11728b6749071f4227a8008e3',
  readOnlyFile:'F:/ChatGPT_workshop/techlong-platform-w8n-held-ledger-readonly-20261024-a.json',
  readOnlySha:'6d5275aae121b5507749a24206ae3773688bc18ef5fd7ec51477a4c42bf16d10',
  recoveryFile:'F:/ChatGPT_workshop/techlong-platform-w8m-recovery-executed-verified-20261024-a.json',
  recoverySha:'4c60da5e9bbaa697f385b1b178b3d5df09c87e8edeeb13a46b78917c3ce9b7dd',
  slot:'F:/ChatGPT_workshop/techlong-w8n-review-resume.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8n-review-resume-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8n-compatible-update-review.md',validMs:48*3600000,runMs:120000});
export const must=(ok,c)=>{if(!ok)throw Error('REVIEW_RESUME_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export async function knownPair(plans,now){
  must(plans?.length===2,'EXACT_OLD_PAIR');await oldReview(plans[0]);
  const p=plans[1],v=await validatePlan(p.plan,B.platform,p.plan.preparedAt);
  must(same(p,v)&&p.planSha256===N.priorPlanSha&&p.actionSha256===N.priorActionSha&&p.plan.sourceCommit===N.priorSource&&
    p.plan.jobId===J.jobId&&p.plan.mode==='Review'&&p.plan.predecessor===null&&same(p.plan.inputs,plans[0].plan.inputs)&&
    plans.every(x=>now>x.plan.expiresAt),'EXACT_EXPIRED_PAIR');return plans;
}
export async function makeResumeReview({sourceCommit,pins,ci,auth,baseline,oldPlans,references,parents,readOnly,compatibility,createdAt}){
  await knownPair(oldPlans,createdAt);
  must(Number.isSafeInteger(createdAt)&&/^[a-f0-9]{40}$/.test(sourceCommit)&&![R.oldSource,N.priorSource].includes(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&
    ci.status==='completed'&&ci.conclusion==='success'&&pins.length>=10&&new Set(pins.map(x=>x.file)).size===pins.length&&
    pins.every(x=>/^[a-f0-9]{64}$/.test(x.sha256))&&parents.length>=10&&parents.every(x=>/^[a-f0-9]{64}$/.test(x.rawSha256)),'SOURCE_PARENTS');
  must(auth?.contentRead===false&&auth.length>0&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&same(auth,readOnly.authMetadata)&&
    baseline.target.id===J.jobId&&baseline.target.status==='pending'&&baseline.target.attempts===0&&baseline.target.leasePresent===false&&
    baseline.target.cloudExecutionAuthorized===false&&baseline.snapshotRows.length===9&&baseline.oldJobs.length===6,'AUTH_BASELINE');
  must(readOnly.state==='EXACT_TWO_EXPIRED_REVIEWS_AND_HELD_JOB_READ_ONLY_VERIFIED'&&readOnly.jobId===J.jobId&&
    same(readOnly.controlCounts,{plans:2,approvals:0,attempts:0})&&same(readOnly.planHashes,oldPlans.map(p=>p.planSha256).sort())&&
    same(readOnly.oldPlans,oldPlans.map(p=>({planSha256:p.planSha256,bodyExactlyUnchanged:true,expired:true,
      sourceCommit:p.plan.sourceCommit,expiresAt:p.plan.expiresAt})))&&same(readOnly.target,baseline.target)&&
    same(readOnly.snapshotRows,baseline.snapshotRows)&&same(readOnly.oldJobRows,baseline.oldJobs)&&readOnly.nineSnapshotRowsAndSixOldJobsUnchanged===true&&
    Number.isSafeInteger(readOnly.checkedAt)&&createdAt>=readOnly.checkedAt,'READ_ONLY_PROOF');
  must(same(references,{installation:JSON.parse(oldPlans[0].plan.inputs.installation),lineage:JSON.parse(oldPlans[0].plan.inputs.lineage)})&&
    references.lineage.versionId===R.lineageVersion&&compatibility?.executionSourceCommit===sourceCommit&&
    compatibility.imageSourceCommit===J.imageSourceCommit&&compatibility.protectedRuntimeCodeUnchanged===true&&
    compatibility.cloudClosureSha256===B.platform.closureSha256,'REFERENCES_OR_RUNTIME');
  const b={schema:'techlong/platform-review-resume/v6',sourceCommit,runtimeSourceCommit:sourceCommit,pins,ci,auth,baseline,oldPlans,references,
    parents,readOnly,compatibility,createdAt,expiresAt:createdAt+N.validMs,latestStartAt:createdAt+N.validMs-N.runMs,binding:B,riskFile:N.riskFile,
    effects:{authFileReadsMax:2,explicitReadOnlyTransactionsMax:8,sourceStsReadsMax:2,s3VersionGetsMax:3,ownerPlanSqlMax:1,
      s3Puts:0,oldPlanUpdatesOrDeletes:0,newJobs:0,newIam:0,secretValueReads:0,privateKeyReads:0,hostedUpdates:0,approvals:0,dispatches:0},
    planClock:'Exactly one new two-hour Review timestamped at publication; two exact expired plans stay untouched; no hosted lease',
    risks:{ownerFileAndProviderMemory:true,notCas:true,unknownCommitMayPersist:true,feesContinue:true,noAutomaticRetryRollbackResetDelete:true},
    preparationIsNotApproval:true};return {...b,manifestSha256:await sha256Hex(b)};
}
export async function verifyResume(m,sha,now,audit=false){must(same(m,await makeResumeReview(m))&&sha===m.manifestSha256&&
  now>=m.createdAt&&now<(audit?m.expiresAt:m.latestStartAt),'APPROVAL_OR_EXPIRED');return m;}
export async function newResumePlan(plan,m,notBefore,now){
  const v=await validatePlan(plan,m.binding.platform,plan.preparedAt);
  must(plan.mode==='Review'&&plan.predecessor===null&&plan.jobId===J.jobId&&plan.sourceCommit===m.sourceCommit&&
    same(plan.inputs,m.oldPlans[0].plan.inputs)&&plan.preparedAt>=notBefore&&plan.preparedAt<=now&&plan.expiresAt===plan.preparedAt+7200000&&
    !m.oldPlans.some(x=>x.planSha256===v.planSha256),'NEW_PLAN');return v;
}
export async function assertResumeLedger(v,m,now,next=null){
  await knownPair(m.oldPlans,now);const expected=[...m.oldPlans,...(next?[next]:[])];
  must(same(v?.counts,{plans:expected.length,approvals:0,attempts:0})&&v.entries?.length===expected.length&&
    new Set(v.entries.map(e=>e.planSha256)).size===expected.length,'EXACT_LEDGER_COUNTS');
  for(const p of expected){const e=v.entries.find(e=>e.planSha256===p.planSha256);
    must(e&&same(e.plan,p.plan)&&e.actionSha256===p.actionSha256&&e.riskSha256===p.plan.riskSha256&&e.attempt===null,'EXACT_LEDGER_BODY');}
  return v;
}
export async function publishResumeOnce({manifest:m,approved,io,now=Date.now}){
  const start=now(),guard=async()=>{await verifyResume(m,approved,now());must(now()-start<N.runMs,'RUN_DEADLINE');await io.assertSource();};
  await guard();await io.preflight();await io.claim();let db,phase='SLOT_CONSUMED';
  try{await guard();phase='OWNER_READ';db=await io.open(await io.readAuth());
    phase='EXACT_TWO_OLD_PLANS';await assertResumeLedger(await db.ledger(),m,now());await assertFollowupHeld(await db.readHeldJob(J.jobId),m.baseline,now());
    phase='APPEND_ONE_REVIEW';const next=await io.publishReview({db,guard,notBefore:start});await newResumePlan(next.plan,m,start,now());
    const result={outcome:'REVIEW_RESUME_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',jobId:J.jobId,runtimeSourceCommit:m.sourceCommit,
      planSha256:next.planSha256,actionSha256:next.actionSha256,riskSha256:next.plan.riskSha256,planExpiresAt:next.plan.expiresAt,
      preservedPlanHashes:m.oldPlans.map(x=>x.planSha256).sort(),executionApproved:false,dispatches:0,retryAllowed:false};
    await io.record('result',result);return result;
  }catch{const r={outcome:'REVIEW_RESUME_PARTIAL_OR_UNKNOWN_NO_RETRY',phase,retryAllowed:false};await io.record('failure',r);return r;}
  finally{await db?.dispose();await io.dispose();}
}
