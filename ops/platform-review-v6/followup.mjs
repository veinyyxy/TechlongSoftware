// W8j operator preparation/publication only; import performs no I/O.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {assertHeldPlatformJobV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {continueCloudContextV5,providerPublicV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
export const J=Object.freeze({jobId:'job_6e2e115c80301595512f11fb',priorJobId:'job_c6cb047ac3ff30ed51ba9f34',
  runtimeSourceCommit:'f3cea2da7d26dfc09726c4cbc52cab40217340c6',
  receiptSha256:'96713476e019d487deaceae860146708af2a949b88bd474b8209ab4a72e25588',
  lineageSha256:'7ad860d750474ab8e3a9eb50539e736cab5c4e1d67da0ee390caecc836b406c1',
  lineageKey:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w8j-job_6e2e115c80301595512f11fb-v1.json',
  slot:'F:/ChatGPT_workshop/techlong-w8j-review-plan.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-w8j-review-plan-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8j-review-publication.md',
  heldFile:'F:/ChatGPT_workshop/techlong-w8i-held-request-20261023-a-inspect/state.json',
  heldFileSha256:'f11a1859f1aba5f1f3d89666793ca65f7bdd688bfe857ada9bbccf69464c9401',
  lineageFile:'F:/ChatGPT_workshop/techlong-platform-w8j-lineage-prepared-20261023.json',
  lineageFileSha256:'67cadcb955b379d478338018c438f997e9dc415ce289919c21373bc0cfe300b9',
  evidenceFile:'F:/ChatGPT_workshop/techlong-platform-w8i-followup-verified-20261023.json',
  evidenceSha256:'ad09b8aa4d52d0fc538e81a1aeb89e2b9cd0fe18e8341d0fdda7496642424b25'});
export const must=(ok,code)=>{if(!ok)throw Error('FOLLOWUP_REVIEW_'+code);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export async function makeFollowupPublication({sourceCommit,pins,ci,auth,baseline,references,receipts,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    pins.length>=15&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'SOURCE_CI');
  must(auth?.contentRead===false&&auth.length>0&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&Number.isSafeInteger(createdAt)&&createdAt>0&&
    baseline.adminId==='usr_4dcd0a09821fde2bb1801f58'&&baseline.target?.id===J.jobId&&baseline.target.status==='pending'&&
    baseline.target.attempts===0&&!baseline.target.leasePresent&&baseline.target.cloudExecutionAuthorized===false&&
    baseline.snapshotRows.length===9&&baseline.oldJobs.length===6,'BASELINE_METADATA');
  must(Object.keys(references).sort().join(',')==='inspect,installation,manifest,priorLineage,provider'&&
    Object.values(references).every(r=>Object.keys(r).sort().join(',')==='key,sha256,versionId'&&
      r.key.startsWith('worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/')&&!r.key.includes('..')&&/^[a-f0-9]{64}$/.test(r.sha256)&&
      /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId))&&receipts.length>=3&&receipts.every(r=>/^[a-f0-9]{64}$/.test(r.rawSha256)),'REFERENCES');
  must(B.state==='PUBLISHED'&&B.publisher.state==='PUBLISHED'&&await sha256Hex(B.platform)===B.publisher.releaseSha256,'RELEASE');
  const body={schema:'techlong/platform-followup-review-publication/v6',sourceCommit,runtimeSourceCommit:J.runtimeSourceCommit,pins,ci,auth,
    baseline,references,receipts,createdAt,expiresAt:createdAt+48*3600000,latestStartAt:createdAt+48*3600000-120000,
    binding:B,scope:J,
    effects:{authFileReadsMax:2,explicitReadOnlyTransactionsMax:8,sourceStsReadsMax:2,s3GetMax:7,conditionalLineagePutsMax:1,ownerPlanWritesMax:1,
      privateKeyReads:0,secretValueReads:0,appTokens:0,dispatches:0,jobClaims:0,workloadCreates:0,cloudLeaseUpdates:0},
    planClock:'A new two-hour Review plan is timestamped once at actual publication; no old plan is extended. No hosted lease starts here.',
    risks:{wholeOwnerFileReadTwice:true,ownerCredentialMemoryAndProviderLogs:true,nonAtomicAcrossS3AndDatabase:true,unknownCommitMayPersist:true,
      metadataNotCas:true,privateVersionedEvidenceMayPersist:true,noAutomaticRetryRollbackDeleteResetOrCompensation:true,existingCloudCostsContinue:true},
    preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyFollowupPublication(m,approved,now,inspect=false){
  must(same(m,await makeFollowupPublication(m))&&approved===m.manifestSha256&&now>=m.createdAt&&now<(inspect?m.expiresAt:m.latestStartAt),'APPROVAL_OR_EXPIRED');
}
export async function assertFollowupHeld(o,baseline,now){
  must(o.job?.id===J.jobId&&o.requester?.id===baseline.adminId&&o.requester.status==='active'&&o.requester.is_platform_admin===1,'REQUESTER');
  assertHeldPlatformJobV4(o.job,now);
  const safe=j=>({...Object.fromEntries(['id','deployment_id','job_type','status','attempts','max_attempts','available_at','created_at','updated_at','completed_at'].map(k=>[k,j[k]])),
    payload:typeof j.payload==='string'?JSON.parse(j.payload):j.payload,leasePresent:j.lease_token!==null||j.lease_owner!==null||j.lease_expires_at!==null});
  const prior=o.jobs.find(j=>j.id===J.priorJobId);must(prior,'PRIOR_JOB');
  const rows=await Promise.all(Object.entries({...o.snapshot,predecessorJob:prior}).sort(([a],[b])=>a.localeCompare(b)).map(async([name,v])=>({name,sha256:await sha256Hex(v)})));
  const jobs=await Promise.all(o.jobs.filter(j=>j.id!==J.jobId).sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>
    ({id:j.id,status:j.status,leasePresent:safe(j).leasePresent,rowSha256:await sha256Hex(safe(j))})));
  must(same(rows,baseline.snapshotRows)&&same(jobs,baseline.oldJobs)&&await sha256Hex(safe(o.job))===baseline.target.rowSha256,'HELD_OR_OLD_ROWS_CHANGED');
}
export async function reconstructFollowupLineage({priorLinks,manifest,provider,inspect,receipt,capsule}){
  must(receipt?.jobId===J.priorJobId&&await sha256Hex(receipt)===J.receiptSha256,'RECEIPT');
  const links=[...priorLinks,{manifest,receipt,providerObservation:providerPublicV5(provider),inspect}];
  const ctx=await continueCloudContextV5(await prepareCloudContextV5(capsule),links);
  must(links.length===2&&ctx.predecessor.jobId===J.priorJobId&&ctx.predecessor.receiptSha256===J.receiptSha256&&
    await sha256Hex(links)===J.lineageSha256,'LINEAGE');return links;
}
export async function validateFollowupPlan(plan,m,reference){
  const v=await validatePlan(plan,m.binding.platform,plan.preparedAt);
  must(v.plan.jobId===J.jobId&&v.plan.mode==='Review'&&v.plan.sourceCommit===m.runtimeSourceCommit&&
    v.plan.inputs.installation===canonicalJson(m.references.installation)&&v.plan.inputs.lineage===canonicalJson(reference)&&
    reference.key===J.lineageKey&&reference.sha256===J.lineageSha256,'EXACT_PLAN');return v;
}
export async function publishFollowupOnce({manifest:m,approved,io,now=Date.now}){
  const at=now(),guard=async()=>{await verifyFollowupPublication(m,approved,now());must(now()-at<120000,'OPERATION_WINDOW');await io.assertSource();};
  await guard();await io.preflight();await io.claim();let db,phase='SLOT_CONSUMED';
  try{
    await guard();phase='OWNER_FILE_READ';db=await io.open(await io.readAuth());
    phase='BASELINE';await db.assertEmpty();const first=await db.readHeldJob(J.jobId);await io.assertHeld(first);
    phase='LINEAGE_RECONSTRUCTION';const links=await io.lineage(first);await io.record('lineage',links);await guard();
    phase='LINEAGE_PUT';const ref=await io.putLineage(links);must(ref.key===J.lineageKey&&ref.sha256===J.lineageSha256,'LINEAGE_ACK');
    await io.record('lineage-reference',ref);await guard();phase='PLAN_PUBLICATION';
    const plan=await io.publishReview({db,reference:ref,guard});await validateFollowupPlan(plan.plan,m,ref);
    const result={outcome:'FOLLOWUP_REVIEW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',jobId:J.jobId,planSha256:plan.planSha256,
      actionSha256:plan.actionSha256,riskSha256:plan.plan.riskSha256,planExpiresAt:plan.plan.expiresAt,
      runtimeSourceCommit:m.runtimeSourceCommit,executionApproved:false,dispatches:0,retryAllowed:false};await io.record('result',result);return result;
  }catch{const result={outcome:'FOLLOWUP_REVIEW_PARTIAL_OR_UNKNOWN_NO_RETRY',phase,jobId:J.jobId,retryAllowed:false};await io.record('result',result);return result;
  }finally{await db?.dispose();await io.dispose();}
}
