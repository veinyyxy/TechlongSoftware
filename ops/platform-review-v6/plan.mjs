// W6m operator boundary only. Importing performs no I/O or credential discovery.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {continueCloudContextV5,providerPublicV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
import {createTrustedPublisherV6} from '../platform-cloud-v6/publisher.mjs';
export const R=Object.freeze({jobId:'job_fc0309dabebc09367f64153f',priorJobId:'job_ecbf09030d3da7286ea3ef93',
  requestSha:'ff9dc72be5f7c699feaa68c64697c5da16ebc68deb7438d5e6da9398bea5adec',
  slot:'F:/ChatGPT_workshop/techlong-w6m-review-plan.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-w6m-review-plan-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6m-review-plan.md',
  lineageKey:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w6m-job_fc0309dabebc09367f64153f-v1.json',
  receiptSha:'8a44b3547fabf8f9de037aff8415ada396356d5d79b3fe71691eb5abe7ec2d54',
  installation:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json',versionId:'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV',sha256:'695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae'},
  manifest:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/job_ecbf09030d3da7286ea3ef93/a5ea222a8a827638683859f96bbfa8ad1de386e5f489de2f7e06e052f624e362/manifest.json',versionId:'Nn0yPH0AFqq0.lq_D6tz8pmIUIElOoRP',sha256:'c75384030bef9c0814fdaa8a097749a54e314014d4f88f0fad59398272c55131'},
  provider:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/job_ecbf09030d3da7286ea3ef93/a5ea222a8a827638683859f96bbfa8ad1de386e5f489de2f7e06e052f624e362/run-39200300265-1/provider-after.json',versionId:'L8Y4WAgMxgDShdXezE2iRuGvLxP0PUV9',sha256:'7d357b645564b08567708dd054651866cf578ab144aacbc588b6b9ba2c4168f1'},
  inspect:{key:'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/job_ecbf09030d3da7286ea3ef93/a5ea222a8a827638683859f96bbfa8ad1de386e5f489de2f7e06e052f624e362/run-39200910036-1/inspect.json',versionId:'ficRbUpExxWPCN6KCTlUYeEJm3icnwGz',sha256:'1089fe909f978f0746a4863cbb4cf079fc1f9005198c685dc8cf7545ff865e07'}});
export const must=(v,c)=>{if(!v)throw Error('REVIEW_PLAN_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export async function makeReviewPublicationV6({sourceCommit,pins,ci,auth,receipts,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci.sourceCommit===sourceCommit&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1,'SOURCE_CI');
  must(pins.length>=15&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'PINS');
  must(auth.contentRead===false&&auth.length>0&&/^[a-f0-9]{64}$/.test(auth.aclSha256)&&receipts.length>=3&&
    receipts.every(p=>/^[a-f0-9]{64}$/.test(p.rawSha256))&&Number.isSafeInteger(createdAt),'METADATA');
  must(B.state==='PUBLISHED'&&B.publisher.state==='PUBLISHED'&&await sha256Hex(B.platform)===B.publisher.releaseSha256,'RELEASE');
  const body={schema:'techlong/platform-review-publication/v6',sourceCommit,pins,ci,auth,receipts,createdAt,expiresAt:createdAt+48*3600000,
    binding:B,scope:R,effects:{authFileReadsMax:2,explicitReadOnlyTransactionsMax:8,sourceStsReadsMax:2,s3GetMax:6,
      conditionalLineagePutsMax:1,ownerPlanWritesMax:1,appPrivateKeyReads:0,secretValueReads:0,appTokens:0,dispatches:0,jobClaims:0,workloadCreates:0},
    planClock:'New Review plan is created once at actual publication; original two-hour controller limit remains unchanged.',
    risks:{wholeOwnerFileReadTwice:true,nonAtomicAcrossS3AndDatabase:true,unknownCommitMayPersist:true,metadataNotCas:true,
      partialArtifactsPreserved:true,noAutomaticRetryRollbackDeleteOrReset:true,existingCloudCostsContinue:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyReviewPublicationV6(m,approved,now){
  must(same(m,await makeReviewPublicationV6(m))&&approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
// Match W6l's safe row projection, without exposing raw payloads/leases.
export async function assertHeldObservationV6(o,baseline){
  must(o.job?.id===R.jobId&&o.requester?.id===baseline.adminId&&o.requester.status==='active'&&o.requester.is_platform_admin===1,'REQUESTER');
  const safe=j=>({...Object.fromEntries(['id','deployment_id','job_type','status','attempts','max_attempts','available_at','created_at','updated_at','completed_at'].map(k=>[k,j[k]])),
    payload:typeof j.payload==='string'?JSON.parse(j.payload):j.payload,leasePresent:j.lease_token!==null||j.lease_owner!==null||j.lease_expires_at!==null});
  const snapshot={...o.snapshot,predecessorJob:o.jobs.find(j=>j.id===R.priorJobId)};
  const rows=await Promise.all(Object.entries(snapshot).sort(([a],[b])=>a.localeCompare(b)).map(async([name,v])=>({name,sha256:await sha256Hex(v)})));
  const jobs=await Promise.all(o.jobs.filter(j=>j.id!==R.jobId).sort((a,b)=>a.id.localeCompare(b.id)).map(async j=>
    ({id:j.id,status:j.status,leasePresent:safe(j).leasePresent,rowSha256:await sha256Hex(safe(j))})));
  must(same(rows,baseline.snapshotRows)&&same(jobs,baseline.oldJobs)&&await sha256Hex(safe(o.job))===baseline.target.rowSha256,'HELD_OR_OLD_ROWS_CHANGED');
  must(o.job.status==='pending'&&o.job.attempts===0&&o.job.max_attempts===1&&o.job.available_at===Number.MAX_SAFE_INTEGER&&!safe(o.job).leasePresent,'HELD');
}
export async function rebuildLineageV6({observed,manifest,provider,inspect,capsule}){
  const outputs=typeof observed.snapshot.deployment.outputs==='string'?JSON.parse(observed.snapshot.deployment.outputs):observed.snapshot.deployment.outputs;
  const receipt=outputs.expressInitializedWorkerRunsV2?.[R.priorJobId];must(await sha256Hex(receipt)===R.receiptSha,'RECEIPT');
  const links=[{manifest,receipt,providerObservation:providerPublicV5(provider),inspect}];
  const ctx=await continueCloudContextV5(await prepareCloudContextV5(capsule),links);
  must(ctx.predecessor.jobId===R.priorJobId&&ctx.predecessor.receiptSha256===R.receiptSha,'LATEST_LINEAGE');return links;
}
export async function publishReviewOnceV6({manifest:m,approved,io,now=Date.now}){
  const enteredAt=now();
  const guard=async()=>{await verifyReviewPublicationV6(m,approved,now());must(now()-enteredAt<120000,'OPERATION_WINDOW');await io.assertSource();};
  await guard();await io.preflight();await io.claim();let phase='SLOT_CONSUMED',db;
  try{
    await guard();phase='OWNER_FILE_READ';db=await io.open(await io.readAuth());
    phase='BASELINE';await db.assertEmpty();const first=await db.readHeldJob(R.jobId);await io.assertHeld(first);
    phase='LINEAGE_RECONSTRUCTION';const links=await io.lineage(first);await io.record('lineage',links);await guard();
    phase='LINEAGE_PUT';const ref=await io.putLineage(links);await io.record('lineage-reference',ref);await guard();
    phase='PLAN_PUBLICATION';const publisher=createTrustedPublisherV6({release:m.binding.platform,sourceCommit:m.sourceCommit,
      frozenSourceCommit:m.binding.publisher.frozenSourceCommit,now,ports:{readObject:io.readObject,readHeldJob:async id=>{
        const o=await db.readHeldJob(id);await io.assertHeld(o);return o;},writeOwner:async q=>{
        const v=await validatePlan(JSON.parse(q.values[3]),m.binding.platform,now());
        must(v.plan.sourceCommit===m.sourceCommit&&v.plan.jobId===R.jobId&&v.plan.mode==='Review'&&v.plan.inputs.lineage===canonicalJson(ref)&&
          v.plan.inputs.installation===canonicalJson(R.installation),'EXACT_PLAN');
        await io.record('proposed-plan',v);await guard();await db.writeOwner(q);
      }}});
    const plan=await publisher.publishReview({jobId:R.jobId,installationReference:R.installation,lineageReference:ref});
    const result={outcome:'REVIEW_PLAN_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',jobId:R.jobId,planSha256:plan.planSha256,
      actionSha256:plan.actionSha256,riskSha256:plan.plan.riskSha256,planExpiresAt:plan.plan.expiresAt,dispatches:0,executionApproved:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch{const result={outcome:'REVIEW_PUBLICATION_PARTIAL_OR_UNKNOWN_NO_RETRY',phase,jobId:R.jobId,retryAllowed:false};await io.record('result',result);return result;
  }finally{await db?.dispose();await io.dispose();}
}
