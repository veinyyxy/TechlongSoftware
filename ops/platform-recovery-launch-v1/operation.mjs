// Operator-side composition only. No default ports, credentials or network.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {hostedRuntimeLeaseV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {exactRunV6,assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {verifyRecoveryRequestReadback} from '../platform-recovery-v1/request.mjs';
import {recoveryData} from '../platform-recovery-v1/basis.mjs';
import {assertRecoveryBinding,assertRecoveryPlanScope} from '../platform-recovery-control-v1/binding.mjs';
import {assertHandoffBudget,HANDOFF_LIMITS} from '../platform-operations-v6/handoff.mjs';
import {validateRequestEvidence} from './request-evidence.mjs';
import {assertReviewSession} from '../platform-recovery-handoff-v1/session.mjs';
export const RISK='docs/aws-auto-deployment-recovery-launch-readiness.md';
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_LAUNCH_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>/^[a-f0-9]{64}$/.test(v??'');
const operations=['PublishReview','AdvanceReview'];
export const slotFor=operation=>{must(operations.includes(operation),'OPERATION');return 'F:/ChatGPT_workshop/techlong-recovery-launch-v1-'+operation+'.intent.json';};
export async function makeReview({binding,basis,sourceCommit,pins,ci,auth,requestEvidence,hostingManifestSha256,hostingIntentFile,action,createdAt}){
  await assertRecoveryBinding(binding);const d=recoveryData(basis,createdAt);
  validateRequestEvidence(requestEvidence,basis);
  must(sourceCommit===binding.sourceCommit&&d.target.newJobId==='job_9b57b43a6b88f37202b29170'&&basis.basisSha256===binding.basisSha256,'BINDING');
  must(operations.includes(action?.operation)&&same(Object.keys(action).sort(),action.operation==='PublishReview'?['operation']:['operation','planSha256','resultReference','runId']),'ACTION');
  if(action.operation==='AdvanceReview'){
    must(digest(action.planSha256)&&/^[1-9][0-9]{0,15}$/.test(action.runId),'EXACT_REVIEW');
    const ref=action.resultReference;assertReferenceV6(ref,ref?.key);
    must(new RegExp('^worker-v5/'+S.instanceId+'/'+d.target.newJobId+'/[a-f0-9]{64}/run-'+action.runId+'-1/platform-result-v6\\.json$').test(ref.key),'RESULT_KEY');
  }
  must(digest(hostingManifestSha256)&&/^F:\/ChatGPT_workshop\/techlong-(?:w9p-recovery-hosting|recovery-hosting-continuation|recovery-handoff)-[a-z0-9-]+\/update-intent\.json$/.test(hostingIntentFile),'HOSTING_INTENT');
  must(Array.isArray(pins)&&pins.length>=20&&pins.every(p=>digest(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length,'PINS');
  must(ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&ci.testedSourceCommit,'CI');
  must(auth?.contentRead===false&&Number.isSafeInteger(auth.length)&&auth.length>0&&auth.length<=131072&&digest(auth.aclSha256),'AUTH_METADATA');
  const expiresAt=Math.min(createdAt+86400000,basis.expiresAt);must(expiresAt>createdAt+35*60000,'BASIS_WINDOW');
  const body={schema:'techlong/recovery-launch-review/v1',binding,basisSha256:basis.basisSha256,sourceCommit,pins,ci,auth,
    requestEvidence,hostingManifestSha256,hostingIntentFile,action,createdAt,expiresAt,latestStartAt:expiresAt-120000,
    slot:slotFor(action.operation),riskFile:RISK,
    effects:{configurationContentReadsMax:1,tlsConnectionsMax:2,sqlQueriesMax:100,stsGetsMax:1,s3GetsMax:6,githubRunGetsMax:2,
      ciGithubGetsMax:3,ownerWriteSubmissionsMax:action.operation==='PublishReview'?1:3,awsWrites:0,dispatches:0,privateKeyReads:0,secretValueReads:0,retries:0},
    risks:{ownerCredentialBroaderThanOperation:true,wholeConfigInMemory:true,providerLogs:true,nonAtomic:true,notCrossServiceCas:true,
      permanentSlotNeverReset:true,ambiguousCommitNoRetry:true,noAutomaticCompensation:true,nonzeroFeesPossible:true},
    executionAuthorized:false};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyReview(m,basis,approved,at){
  must(same(m,await makeReview({...m,basis}))&&approved===m.manifestSha256&&at>=m.createdAt&&at<m.latestStartAt,'APPROVAL');
  recoveryData(basis,at);
}
export async function verifyBaseline(basis,snapshot,operation,binding,requestEvidence){
  validateRequestEvidence(requestEvidence,basis);
  const d=recoveryData(basis,basis.createdAt),j=snapshot.jobs.find(v=>v.id===d.target.newJobId);
  must(j,'HELD_JOB');const ledger=snapshot.ledger,newPlans=ledger.plans.filter(p=>p.job_id===j.id),ids=new Set(newPlans.map(p=>p.plan_sha));
  const old={...snapshot,ledger:{plans:ledger.plans.filter(p=>!ids.has(p.plan_sha)),approvals:ledger.approvals.filter(p=>!ids.has(p.plan_sha)),
    attempts:ledger.attempts.filter(p=>p.job_id!==j.id)}};
  await verifyRecoveryRequestReadback(basis,old,requestEvidence.transactionAt);
  const newApprovals=ledger.approvals.filter(p=>ids.has(p.plan_sha)),newAttempts=ledger.attempts.filter(p=>p.job_id===j.id);
  if(operation==='PublishReview')must(newPlans.length+newApprovals.length+newAttempts.length===0,'REVIEW_SLOT_OCCUPIED');
  else{
    must(newPlans.length===1&&newApprovals.length===1&&newAttempts.length===1,'REVIEW_HISTORY');
    assertRecoveryPlanScope(newPlans[0].body,binding);
    must(newPlans[0].body.mode==='Review','REVIEW_HISTORY_MODE');
  }
}
export async function runReviewed({manifest:m,basis,approved,lease,readyAt,io,now=Date.now,rebuildPackage,handoffSession}){
  // Invalid approvals cannot acquire even a metadata/credential port.
  await verifyReview(m,basis,approved,now());const startedAt=now();let db,claimed=false,phase='PREFLIGHT',submissions=0;
  const guard=async()=>{
    await verifyReview(m,basis,approved,now());await io.assertSource(m);
    must(hostedRuntimeLeaseV6(JSON.stringify(lease),m.binding.release,now())&&lease.sourceCommit===m.sourceCommit,'LEASE');
    if(handoffSession!==undefined)assertReviewSession(handoffSession,{review:m,lease,readyAt,at:now()});
    else must(Number.isSafeInteger(readyAt)&&now()>=readyAt&&now()-readyAt<180000,'HUMAN_READY');
    must(now()>=startedAt&&now()-startedAt<120000,'OPERATION_DEADLINE');
    if(m.action.operation==='PublishReview')must(lease.expiresAt-now()>15*60000,'REVIEW_WINDOW');
  };
  try{
    await guard();await io.verifyCi(m);await io.verifySourceIdentity();db=await io.open(m);
    await verifyBaseline(basis,await db.snapshot(),m.action.operation,m.binding,m.requestEvidence);await guard();
    await io.claim({manifestSha256:approved,sourceCommit:m.sourceCommit,operation:m.action.operation,retryAllowed:false});claimed=true;
    const common={basis,release:m.binding.release,sourceCommit:m.sourceCommit,frozenSourceCommit:m.binding.frozenSourceCommit,
      activation:m.binding.activation,now,...(rebuildPackage?{rebuildPackage}:{} )};
    const allow=[m.binding.packageReference],cache=new Map();
    const readObject=async r=>{must(allow.some(v=>same(v,r)),'OBJECT_ALLOWLIST');const k=canonicalJson(r);
      if(!cache.has(k))cache.set(k,await io.readObject(r));return cache.get(k);};
    const publish=writeOwner=>createRecoveryPublisher({...common,ports:{guard,readObject,readHeldJob:db.readHeldJob,loadPlan:db.loadPlan,readRun:io.readRun,writeOwner}});
    if(m.action.operation==='PublishReview'){
      phase='PUBLISH_REVIEW';const installation=await io.installationReference();allow.push(installation);
      const p=publish(async q=>{must(submissions===0,'WRITE_BUDGET');await io.record('proposed-review',q);
        await verifyBaseline(basis,await db.snapshot(),'PublishReview',m.binding,m.requestEvidence);await guard();submissions++;await db.writeOwner(q);});
      const v=await p.publishReview({installationReference:installation,recoveryPackageReference:m.binding.packageReference});
      const saved=await db.loadPlan(v.planSha256);must(same(saved.plan,v.plan)&&saved.attempt===null,'REVIEW_READBACK');
      const r={outcome:'REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL',...v,submissions,dispatches:0,retryAllowed:false};await io.record('result',r);return r;
    }
    phase='VALIDATE_REVIEW_CONTENT';const a=m.action,e=await db.loadPlan(a.planSha256),v=await validatePlan(e.plan,m.binding.release,e.plan.preparedAt);
    assertRecoveryPlanScope(e.plan,m.binding);must(v.planSha256===a.planSha256&&e.actionSha256===v.actionSha256&&e.plan.mode==='Review'&&
      ['ACKNOWLEDGED','OBSERVED'].includes(e.attempt?.state)&&e.attempt.runId===a.runId&&e.attempt.proofSha256===null,'REVIEW_LEDGER');
    const rawRun=await io.readRun(a.runId);exactRunV6(rawRun,{runId:a.runId,sourceCommit:m.sourceCommit,workflowId:m.binding.release.workflowId,reusableCommit:m.binding.release.reusableCommit});
    allow.push(a.resultReference,JSON.parse(e.plan.inputs.installation));
    const result=(await readObject(a.resultReference)).value;
    must(a.resultReference.key===resultKeyV6(e.plan.jobId,result.manifestSha256,a.runId),'EXACT_RESULT');
    assertReferenceV6(result.cloudReportReference,`worker-v5/${S.instanceId}/${e.plan.jobId}/${result.manifestSha256}/manifest.json`);
    allow.push(result.cloudReportReference);const envelope=(await readObject(result.cloudReportReference)).value;
    const virtual={...structuredClone(e),attempt:{...e.attempt,state:'OBSERVED',status:'completed',conclusion:'success'}};let proof;
    const verifier=createRecoveryPublisher({...common,ports:{guard,readObject,loadPlan:async sha=>{must(sha===a.planSha256,'EXACT_PLAN');return virtual;},
      readRun:async id=>{must(id===a.runId,'EXACT_RUN');return rawRun;},writeOwner:async q=>{must(!proof,'VIRTUAL_PROOF');proof=q;}}});
    const attestation=await verifier.attestResult(a.planSha256,a.resultReference);
    const budget=async()=>{await guard();assertHandoffBudget(envelope.innerManifest,lease,now());};await budget();
    // Only after full content reconstruction: one observation, one proof, one reserved plan.
    await verifyBaseline(basis,await db.snapshot(),'AdvanceReview',m.binding,m.requestEvidence);await budget();
    phase='OBSERVE_REVIEW';submissions++;await db.observe(a.planSha256,a.runId);
    let next;const p=publish(async q=>{
      await budget();if(submissions===1){must(same(q,proof),'EXACT_PROOF');phase='ATTEST_REVIEW';submissions++;await db.writeOwner(q);}
      else{
        must(submissions===2&&!next,'WRITE_BUDGET');const candidate=await validatePlan(JSON.parse(q.values[3]),m.binding.release,now());
        must(candidate.plan.mode==='RunOnce'&&candidate.plan.inputs.manifestSha===envelope.recoveryReviewSha256&&
          candidate.plan.predecessor?.proofSha256===attestation.proofSha256,'SUCCESSOR');
        const plan={...candidate.plan,expiresAt:Math.min(candidate.plan.expiresAt,envelope.innerManifest.jobPlan.claimBy-HANDOFF_LIMITS.reserveMs,lease.expiresAt-HANDOFF_LIMITS.reserveMs)};
        next=await validatePlan(plan,m.binding.release,now());await io.record('proposed-runonce',next);await budget();
        phase='PUBLISH_RUNONCE';submissions++;await db.writeOwner(ownerQueryV6('plan',next));
      }
    });
    must(same(await p.attestResult(a.planSha256,a.resultReference),attestation),'PROOF_DRIFT');await p.publishSuccessor(a.planSha256,a.resultReference);
    const saved=await db.loadPlan(next.planSha256),prior=await db.loadPlan(a.planSha256);
    must(same(saved.plan,next.plan)&&saved.attempt===null&&prior.attempt.proofSha256===attestation.proofSha256,'SUCCESSOR_READBACK');
    const r={outcome:'RUNONCE_PUBLISHED_REQUIRES_HUMAN_APPROVAL',...next,submissions,cloudClaimBy:envelope.innerManifest.jobPlan.claimBy,
      dispatches:0,executionApproved:false,retryAllowed:false};await io.record('result',r);return r;
  }catch(e){
    const r={outcome:'RECOVERY_LAUNCH_STOPPED_REQUIRES_READBACK',phase,claimed,submissions,retryAllowed:false,
      code:/^[A-Z][A-Z0-9_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD'};await io.record('stopped',r);return r;
  }finally{try{await db?.close();}finally{await io.close();}}
}
