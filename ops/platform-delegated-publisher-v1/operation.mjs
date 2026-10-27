// Separately approved three-write publisher. No Web lease or import-time I/O.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {assertRecoveryBinding,assertRecoveryPlanScope} from '../platform-recovery-control-v1/binding.mjs';
import {verifyRecoveryRequestReadback} from '../platform-recovery-v1/request.mjs';
import {validateRequestEvidence} from '../platform-recovery-launch-v1/request-evidence.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {proposeReviewSuccessor,reviewTiming} from './successor.mjs';
export const RISK='docs/aws-auto-deployment-delegated-publisher-live-v1.md';
export const SLOT='F:/ChatGPT_workshop/techlong-delegated-publisher-advance-v1.intent.json';
export const must=(v,c)=>{if(!v)throw Error('DELEGATED_PUBLISHER_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const HISTORY=['636676cb2faed296b492797942328486b4089962fa23cf5ceb36ca0cdc3b461e'];
const safeCode=e=>/^[A-Z][A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD';
// Source-selected fixtures may exercise other histories; the CLI uses only the
// literal default. No flag/material/manifest selects this capability.
export function createPublisherOperations({historicalPlanShas=HISTORY}={}){
  const history=[...historicalPlanShas].sort();must(history.length>0&&history.length<=4&&history.every(digest)&&new Set(history).size===history.length,'HISTORY_PROFILE');
  async function verifyBaseline({basis,snapshot,entry,requestEvidence,binding}){
    validateRequestEvidence(requestEvidence,basis);await assertRecoveryBinding(binding);
    assertRecoveryPlanScope(entry.plan,binding);
    const s=normalizedState(snapshot),job=entry.plan.jobId,plans=s.ledger.plans.filter(p=>p.job_id===job),ids=new Set(plans.map(p=>p.plan_sha));
    must(same([...ids].sort(),[...history,entry.planSha256].sort())&&plans.length===ids.size,'COMPLETE_TARGET_HISTORY');
    const old={...s,ledger:{plans:s.ledger.plans.filter(p=>!ids.has(p.plan_sha)),approvals:s.ledger.approvals.filter(a=>!ids.has(a.plan_sha)),
      attempts:s.ledger.attempts.filter(a=>a.job_id!==job)}};
    await verifyRecoveryRequestReadback(basis,old,requestEvidence.transactionAt);
    for(const p of plans){const v=await validatePlan(p.body,binding.release,p.body.preparedAt);
      must(p.plan_sha===v.planSha256&&p.action_sha===v.actionSha256&&p.risk_sha===v.plan.riskSha256&&p.mode==='Review'&&p.body.jobId===job,'HISTORICAL_PLAN');}
    const seed=plans.find(p=>p.plan_sha===entry.planSha256),approvals=s.ledger.approvals.filter(a=>ids.has(a.plan_sha)),attempts=s.ledger.attempts.filter(a=>a.job_id===job);
    must(same(seed.body,entry.plan)&&approvals.length===1&&approvals[0].plan_sha===entry.planSha256&&approvals[0].admin_id===ADMIN&&
      attempts.length===1&&attempts[0].plan_sha===entry.planSha256&&attempts[0].mode==='Review'&&attempts[0].state==='ACKNOWLEDGED'&&
      attempts[0].run_id===entry.attempt.runId&&attempts[0].run_status===null&&attempts[0].conclusion===null&&attempts[0].proof_sha===null,'ACTUAL_ACK_HISTORY');
    must(entry.attempt.state==='ACKNOWLEDGED'&&entry.attempt.proofSha256===null&&entry.attempt.status==null&&entry.attempt.conclusion==null,'INITIAL_ATTEMPT');
    return s;
  }
  async function makeReview({binding,basis,baseline,reviewEntry,requestEvidence,action,timing,pins,ci,auth,createdAt}){
    await assertRecoveryBinding(binding);must(binding.basisSha256===basis.basisSha256,'BINDING');
    const s=await verifyBaseline({basis,snapshot:baseline,entry:reviewEntry,requestEvidence,binding});
    must(action?.operation==='AdvanceReview'&&action.planSha256===reviewEntry.planSha256&&action.runId===reviewEntry.attempt.runId&&
      same(Object.keys(action).sort(),['operation','planSha256','resultReference','runId']),'ACTION');
    assertReferenceV6(action.resultReference,action.resultReference.key);
    must(new RegExp('^worker-v5/'+reviewEntry.plan.instanceId+'/'+reviewEntry.plan.jobId+'/[a-f0-9]{64}/run-'+action.runId+'-1/platform-result-v6\\.json$').test(action.resultReference.key),'RESULT_SCOPE');
    must(Number.isSafeInteger(createdAt)&&Number.isSafeInteger(timing?.preparedAt)&&Number.isSafeInteger(timing.workloadExpiresAt)&&
      timing.claimBy===timing.preparedAt+900000,'TIMING');
    const budget=reviewTiming({jobPlan:timing,workload:{workloadExpiresAt:timing.workloadExpiresAt}},basis.expiresAt,createdAt);
    must(budget.expiresAt>createdAt+120000,'PREPARE_WINDOW');
    must(ci?.sourceCommit===binding.sourceCommit&&ci.testedSourceCommit===binding.sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success','CI');
    must(Array.isArray(pins)&&pins.length>=20&&pins.every(p=>typeof p.file==='string'&&digest(p.sha256))&&new Set(pins.map(p=>p.file)).size===pins.length,'PINS');
    must(auth?.contentRead===false&&auth.length>0&&auth.length<=131072&&digest(auth.aclSha256),'AUTH_METADATA');
    const body={schema:'techlong/delegated-publisher-review/v1',sourceCommit:binding.sourceCommit,binding,basisSha256:basis.basisSha256,
      baseline:s,baselineSha256:await sha256Hex(s),reviewEntry,requestEvidence,action,timing,pins,ci,auth,createdAt,expiresAt:budget.expiresAt,
      latestStartAt:budget.expiresAt-120000,protectedHistoricalPlanShas:history,slot:SLOT,riskFile:RISK,
      effects:{configurationContentReadsMax:1,tlsConnectionsMax:2,sqlQueriesMax:100,stsGetsMax:1,s3GetsMax:4,githubRunGetsMax:2,ciGithubGetsMax:3,
        observationsMax:1,proofWritesMax:1,planWritesMax:1,awsWrites:0,dispatches:0,privateKeyReads:0,secretValueReads:0,retries:0},
      policy:{webLeaseRequired:false,preserveOldHistory:true,independentReadbackRequired:true,permanentSlotNeverReset:true,
        dynamicSuccessorUsesPinnedRulesOnly:true,githubEnvironmentApproval:'human-owner-required'},executionAuthorized:false};
    assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
  }
  async function verifyReview(m,basis,approved,at,starting=false){
    must(same(m,await makeReview({...m,basis}))&&m.manifestSha256===approved&&Number.isSafeInteger(at)&&at>=m.createdAt&&
      at<(starting?m.latestStartAt:m.expiresAt),'APPROVAL_OR_EXPIRED');return m;
  }
  function verifyPublished(beforeInput,afterInput,entry,proposal){
    const before=normalizedState(beforeInput),after=normalizedState(afterInput),seed=entry.planSha256,next=proposal.successor;
    const added=after.ledger.plans.filter(p=>p.plan_sha===next.planSha256),attempt=after.ledger.attempts.find(a=>a.plan_sha===seed);
    must(added.length===1&&same(added[0].body,next.plan)&&added[0].action_sha===next.actionSha256&&added[0].risk_sha===next.plan.riskSha256&&
      added[0].job_id===entry.plan.jobId&&added[0].mode==='RunOnce'&&Date.parse(added[0].expires_at)===next.plan.expiresAt,'PUBLISHED_PLAN');
    must(attempt?.state==='OBSERVED'&&attempt.run_status==='completed'&&attempt.conclusion==='success'&&
      attempt.proof_sha===proposal.attestation.proofSha256&&typeof attempt.observed_at==='string'&&Number.isFinite(Date.parse(attempt.observed_at)),'PUBLISHED_PROOF');
    after.ledger.plans=after.ledger.plans.filter(p=>p.plan_sha!==next.planSha256);
    const original=before.ledger.attempts.find(a=>a.plan_sha===seed);
    for(const k of ['state','run_status','conclusion','proof_sha','observed_at'])attempt[k]=original[k];
    must(same(before,after),'PRESERVED_BUSINESS_HISTORY_AND_PROTECTION');return true;
  }
  async function runReviewed({manifest:m,basis,approved,io,now=Date.now,rebuildPackage}){
    await verifyReview(m,basis,approved,now(),true);const startedAt=now();let db,phase='PREFLIGHT',claimed=false,claimAttempted=false,submissions=0;
    const guard=async()=>{await verifyReview(m,basis,approved,now());must(now()-startedAt>=0&&now()-startedAt<120000,'OPERATION_DEADLINE');await io.assertSource(m);};
    try{
      await guard();await io.verifyCi(m);await io.verifySourceIdentity();db=await io.open(m);
      const entry=await db.loadPlan(m.action.planSha256);must(same(entry,m.reviewEntry),'REVIEW_DRIFT');
      must(same(await verifyBaseline({basis,snapshot:await db.snapshot(),entry,requestEvidence:m.requestEvidence,binding:m.binding}),m.baseline),'BASELINE_DRIFT');
      const cache=new Map(),readObject=async ref=>{await guard();const key=canonicalJson(ref);if(!cache.has(key)){
        must(cache.size<4,'OBJECT_BUDGET');cache.set(key,await io.readObject(ref));}return structuredClone(cache.get(key));};
      const run=await io.readRun(m.action.runId),proposal=await proposeReviewSuccessor({binding:m.binding,basis,entry,run,
        resultReference:m.action.resultReference,readObject,now,...(rebuildPackage?{rebuildPackage}:{})});
      must(proposal.timing.claimBy===m.timing.claimBy&&proposal.timing.workloadExpiresAt===m.timing.workloadExpiresAt,'REAL_TIMING_BINDING');
      await guard();must(same(await io.readRun(m.action.runId),run),'RUN_DRIFT');
      must(same(normalizedState(await db.snapshot()),m.baseline),'PRE_WRITE_BASELINE_DRIFT');
      const budget=async()=>{await guard();must(proposal.successor.plan.expiresAt>now()+60000,'LATE_SUCCESSOR');};
      await budget();phase='CLAIM';claimAttempted=true;await io.claim({manifestSha256:approved,reviewPlanSha256:entry.planSha256,runId:m.action.runId});claimed=true;
      await io.record('publisher-intent',{manifestSha256:approved,proposal});
      phase='OBSERVE';await budget();submissions++;await db.observe(entry.planSha256,m.action.runId);
      const observed=await db.loadPlan(entry.planSha256);must(observed.attempt?.state==='OBSERVED'&&observed.attempt.runId===m.action.runId&&
        observed.attempt.status==='completed'&&observed.attempt.conclusion==='success'&&observed.attempt.proofSha256===null&&same(observed.plan,entry.plan),'OBSERVATION_READBACK');
      phase='PROOF';await budget();submissions++;await db.writeOwner(proposal.proposedOwnerQueries[0]);
      const proof=await db.loadPlan(entry.planSha256);must(proof.attempt?.proofSha256===proposal.attestation.proofSha256&&same(proof.plan,entry.plan)&&
        proof.attempt.state==='OBSERVED'&&proof.attempt.runId===m.action.runId&&proof.attempt.status==='completed'&&proof.attempt.conclusion==='success','PROOF_READBACK');
      phase='PUBLISH';await budget();submissions++;await db.writeOwner(proposal.proposedOwnerQueries[1]);
      phase='INDEPENDENT_READBACK';const saved=await db.loadPlan(proposal.successor.planSha256);
      must(same(saved.plan,proposal.successor.plan)&&saved.attempt===null,'SUCCESSOR_READBACK');
      verifyPublished(m.baseline,await db.snapshot(),entry,proposal);await guard();
      const r={outcome:'DELEGATED_RUNONCE_PUBLISHED_REQUIRES_SEPARATE_DISPATCH',...proposal.successor,submissions,
        sourceCommit:m.sourceCommit,reviewRunId:m.action.runId,proofSha256:proposal.attestation.proofSha256,independentReadbackVerified:true,
        dispatches:0,webLeaseUsed:false,executionApproved:false,retryAllowed:false};await io.record('result',r);return r;
    }catch(e){const r={outcome:'DELEGATED_PUBLISHER_STOPPED_REQUIRES_READBACK',phase,claimAttempted,claimed,submissions,code:safeCode(e),retryAllowed:false};
      await io.record('result',r);return r;
    }finally{try{await db?.close();}finally{await io.close();}}
  }
  return Object.freeze({makeReview,verifyReview,verifyBaseline,verifyPublished,runReviewed});
}
export const publisherOperations=createPublisherOperations();
