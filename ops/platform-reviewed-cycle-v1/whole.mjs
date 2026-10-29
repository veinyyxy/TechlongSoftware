// Only stage stitching and exact preapproval. Existing operations own every
// mutation, durable audit, ACK, source gate and independent SQL readback.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {completedBusiness} from '../platform-a604-operator-v1/inspect-state.mjs';
import {must,same,assertScope} from './cycle.mjs';
export const WHOLE=Object.freeze({schema:'techlong/reviewed-whole-cycle/v1',maxRunMs:40*60000,
  derivation:'EXISTING_CONTENT_VERIFIERS_AND_SINGLE_DISPATCH_THREE_WRITE_PUBLISHERS_V1'});
// Five concrete adapters: continuousReview; RunOnce dispatch/capture;
// Inspect publisher; Inspect dispatch/capture. No prep/upload is hidden here.
export const LOCAL_LIMITS=Object.freeze({configurationReadsMax:8,tlsConnectionsMax:13,sqlQueriesMax:635,sourceStsMax:8,
  pemReadsMax:3,appTokensMax:3,appDispatchesMax:3,appRevokeAttemptsMax:3,auditPutsMax:3,auditPermissionSimulationsMax:3,
  s3GetsMax:26,monitorGithubGetsMax:258,officialLogDownloadsMax:3,ciGithubGetsMax:21,publisherGithubGetsMax:4,
  environmentGetsMax:6,appHttpMax:30,observationsMax:2,proofWritesMax:2,successorPlanWritesMax:2,seedPlanWritesMax:1,
  beginDispatchMax:3,assertLiveMax:3,acknowledgeMax:3,markUnknownMax:3,awsResourceWrites:0,newJobs:0,newIam:0,secretValueReads:0});
const code=e=>/^[A-Z][A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD';
export function createWholeCycleFlow(composition,{now=Date.now}={}){
  const c=composition,{cycle,slots,policy,continuous,inspectPublisher,runtime,publication:p}=c;
  async function makeReview({grant,createdAt}){
    const first=await continuous.makeReview({grant,createdAt});
    const body={schema:WHOLE.schema,cycleId:cycle.cycleId,sourceCommit:p.sourceCommit,grant,continuous:first,createdAt,
      latestStartAt:first.latestStartAt,expiresAt:first.expiresAt,slot:slots.whole,riskFile:cycle.riskFile,
      derivation:WHOLE.derivation,limits:LOCAL_LIMITS,
      cloud:{modes:['Review','RunOnce','Inspect'],databaseSecretFixedVersionReadsMax:3,controlPrivatePackageReadsMax:1,
        createStackMax:1,workloadResourcesMax:7,authenticatedGetsMax:2,claimTransactionsMax:1,completeTransactionsMax:1,
        durableJournalWritesMax:5,outerS3PutsMax:6,innerS3PutsMax:6,innerS3GetsMax:2,
        innerEvidence:'UNCHANGED_INSTALLED_V5_CONTRACT',newIam:0,deleteResources:0},
      policy:{humanGithubEnvironmentApprovals:3,approveGithubEnvironment:false,deadlineExtension:false,slotReset:false,
        automaticRetry:false,automaticCleanup:false,chatBetweenStages:false,independentInspectRequired:true,finalLedgerProofImported:false},executionAuthorized:false};
    return freeze({...body,manifestSha256:await sha256Hex(body)});
  }
  async function verify(m,approved,at,starting=false){
    must(same(m,await makeReview(m))&&m.manifestSha256===approved&&Number.isSafeInteger(at)&&at>=m.createdAt&&at<m.expiresAt&&
      (!starting||at<m.latestStartAt),'WHOLE_APPROVAL_OR_EXPIRED');await policy.approve(m.grant,m.grant.grantSha256,at);return m;
  }
  const capturedObject=(capture,reference)=>{const values=capture.objects.filter(o=>same(o.reference,reference));must(values.length===1,'CAPTURE_EXACT_OBJECT');return structuredClone(values[0].object);};
  async function validateCapture(capture,plan,ack){
    const entry=capture.entry;must(entry.planSha256===plan.planSha256&&same(entry.plan,plan.plan)&&entry.attempt?.state==='ACKNOWLEDGED'&&
      entry.attempt.runId===ack.runId&&entry.attempt.proofSha256===null&&capture.objects.length===(plan.plan.mode==='RunOnce'?6:5)&&
      new Set(capture.objects.map(o=>JSON.stringify(o.reference))).size===capture.objects.length,'CAPTURE_CHAIN');
    for(const o of capture.objects)must(o.object.versionId===o.reference.versionId&&o.object.encryption==='AES256'&&
      o.object.contentLength>0&&o.object.contentLength<=1000000&&await sha256Hex(o.object.value)===o.reference.sha256,'CAPTURE_BYTES');
  }
  async function finalProof({capture,inspectPlan,inspectAck,runCapture,inspectPublished,run}){
    await validateCapture(capture,inspectPlan,inspectAck);const s=normalizedState(capture.snapshot),id=inspectPlan.planSha256;
    const business=completedBusiness(runCapture.basis,s,{jobId:cycle.profile.newJobId,beforeState:c.capability?.beforeState}),result=capturedObject(capture,capture.resultReference).value,
      report=capturedObject(capture,result.cloudReportReference).value;
    must(report.receiptSha256===await sha256Hex(business.receipt)&&report.providerObservationSha256===business.receipt.providerObservationSha256,'INSPECT_BUSINESS_RECEIPT');
    const approvals=s.ledger.approvals.filter(a=>a.plan_sha===id),attempts=s.ledger.attempts.filter(a=>a.plan_sha===id),a=attempts[0];
    must(approvals.length===1&&approvals[0].admin_id===c.definition.admin&&attempts.length===1&&a.job_id===cycle.profile.newJobId&&
      a.mode==='Inspect'&&a.state==='ACKNOWLEDGED'&&a.run_id===inspectAck.runId&&a.proof_sha===null&&a.run_status===null&&a.conclusion===null,'FINAL_ACK');
    const beforeInspectDispatch=normalizedState({...s,ledger:{...s.ledger,approvals:s.ledger.approvals.filter(a=>a.plan_sha!==id),attempts:s.ledger.attempts.filter(a=>a.plan_sha!==id)}});
    inspectPublisher.verifyPublished(runCapture.snapshot,beforeInspectDispatch,runCapture.entry,
      {successor:inspectPlan,attestation:{proofSha256:inspectPublished.proofSha256}});
    const virtual={...structuredClone(capture.entry),attempt:{...capture.entry.attempt,state:'OBSERVED',status:'completed',conclusion:'success'}};let proofs=0;
    const makePublisher=runtime.publisher??createRecoveryPublisher;
    const bridge=makePublisher({basis:runCapture.basis,release:p.release,sourceCommit:p.sourceCommit,frozenSourceCommit:p.frozenSourceCommit,
      activation:p.activation,now,rebuildPackage:runtime.rebuild,ports:{guard:()=>runtime.guard(),
        loadPlan:async sha=>{must(sha===id,'FINAL_EXACT_PLAN');return virtual;},readRun:async rid=>{must(rid===inspectAck.runId,'FINAL_EXACT_RUN');return run;},
        readObject:async ref=>capturedObject(capture,ref),writeOwner:async query=>{must(++proofs===1&&query.text==='SELECT deployment_control_v6.attest_evidence($1,$2)'&&query.values[0]===id,'FINAL_MEMORY_PROOF_ONLY');}}});
    const proof=await bridge.attestResult(id,capture.resultReference);
    must(proof.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED'&&proof.mode==='Inspect'&&proof.run.runId!==inspectPlan.plan.predecessor.runId,'INDEPENDENT_INSPECT_REQUIRED');return proof;
  }
  let used=false;
  async function run({manifest:raw,approved,io}){
    const m=freeze(structuredClone(raw));await verify(m,approved,now(),true);must(!used,'WHOLE_MEMORY_ONCE');used=true;
    const started=now(),acks={};let phase='PREFLIGHT',claimed=false;
    const guard=async()=>{await verify(m,approved,now());must(now()>=started&&now()-started<WHOLE.maxRunMs,'WHOLE_DEADLINE');await io.assertSource();};
    const dispatch=async(mode,plan)=>{
      const v=await validatePlan(plan.plan,p.release,now());if(c.capability?.assertScope)c.capability.assertScope(v.plan,p);else assertScope(cycle,v.plan,p);must(same(v,plan),'DERIVED_PLAN_HASHES');
      await guard();const ack=await io.dispatch(mode,plan,guard);acks[mode]=ack;
      must(ack.outcome==='DELEGATED_DISPATCH_ACKNOWLEDGED_REQUIRES_USER_GITHUB_APPROVAL'&&ack.mode===mode&&ack.planSha256===plan.planSha256&&
        /^[1-9][0-9]{0,15}$/.test(ack.runId)&&!Object.entries(acks).some(([k,a])=>k!==mode&&a?.runId===ack.runId),'EXACT_DISPATCH_ACK');return ack;
    };
    try{
      await guard();await io.assertUnused();await io.verifyCi();await io.claim({outerSha256:approved,cycleId:cycle.cycleId});claimed=true;
      await io.record('approved-whole-cycle',m);phase='CONTINUOUS_REVIEW';
      const first=await continuous.run({manifest:m.continuous,approved:m.continuous.manifestSha256,io:await io.continuousIo(guard)});
      must(first.outcome==='CONTINUOUS_REVIEW_VERIFIED_RUNONCE_PLAN_PUBLISHED_NOT_DISPATCHED'&&first.successor?.independentReadbackVerified===true,'CONTINUOUS_READBACK');
      acks.Review={runId:first.reviewRunId};
      const next={plan:first.successor.plan,planSha256:first.successor.planSha256,actionSha256:first.successor.actionSha256};
      must(next.plan.mode==='RunOnce'&&next.plan.predecessor.planSha256===m.grant.seed.planSha256&&next.plan.predecessor.runId===first.reviewRunId,'REVIEW_CHAIN');
      phase='RUNONCE_DISPATCH';const ack=await dispatch('RunOnce',next);phase='WAIT_RUNONCE';const run=await io.wait(ack,guard);
      must(run.status==='completed'&&run.conclusion==='success'&&String(run.id)===ack.runId,'RUNONCE_NOT_SUCCESS');
      await guard();phase='CAPTURE_RUNONCE';const captured=await io.capture({...ack,plan:next.plan},run,guard);await validateCapture(captured,next,ack);
      const basis=await runtime.rebuild(capturedObject(captured,p.packageReference).value);captured.basis=basis;
      const envelope=capturedObject(captured,JSON.parse(next.plan.inputs.manifest)).value,
        manifest=runtime.innerManifest?runtime.innerManifest(envelope):envelope.innerManifest;phase='DERIVE_INSPECT';
      const inner=await inspectPublisher.makeReview({binding:p,basis,baseline:captured.snapshot,reviewEntry:captured.entry,requestEvidence:cycle.requestEvidence,
        action:{operation:'AdvanceRunOnce',planSha256:next.planSha256,runId:ack.runId,resultReference:captured.resultReference},
        timing:{preparedAt:manifest.jobPlan.preparedAt,claimBy:manifest.jobPlan.claimBy,workloadExpiresAt:manifest.workload.workloadExpiresAt},
        pins:m.grant.pins,ci:m.grant.ci,auth:m.grant.auth,createdAt:now()});
      must(inner.slot===slots.inspectPublish&&same(inner.binding,p)&&inner.action.operation==='AdvanceRunOnce','DERIVED_INSPECT_SCOPE');
      await io.record('derived-inspect-publisher',{outerSha256:approved,review:inner});await guard();phase='PUBLISH_INSPECT';
      const published=await inspectPublisher.runReviewed({manifest:inner,basis,approved:inner.manifestSha256,now,rebuildPackage:runtime.rebuild,
        io:await io.publisherIo(inner,captured,guard)});
      must(published.outcome==='DELEGATED_INSPECT_PUBLISHED_REQUIRES_SEPARATE_DISPATCH'&&published.independentReadbackVerified===true&&published.submissions===3&&
        published.plan.mode==='Inspect'&&published.plan.predecessor.planSha256===next.planSha256&&published.plan.predecessor.runId===ack.runId,'INSPECT_PUBLICATION_READBACK');
      const inspect={plan:published.plan,planSha256:published.planSha256,actionSha256:published.actionSha256};
      phase='INSPECT_DISPATCH';const inspectAck=await dispatch('Inspect',inspect);phase='WAIT_INSPECT';const inspectRun=await io.wait(inspectAck,guard);
      must(inspectRun.status==='completed'&&inspectRun.conclusion==='success'&&String(inspectRun.id)===inspectAck.runId,'INSPECT_NOT_SUCCESS');
      await guard();phase='FINAL_INDEPENDENT_PROOF';const final=await io.capture({...inspectAck,plan:inspect.plan},inspectRun,guard),proof=await finalProof({capture:final,
        inspectPlan:inspect,inspectAck,runCapture:captured,inspectPublished:published,run:inspectRun});await guard();
      const result={outcome:'WHOLE_CYCLE_INDEPENDENTLY_VERIFIED',outerSha256:approved,cycleId:cycle.cycleId,jobId:cycle.profile.newJobId,
        runIds:Object.fromEntries(Object.entries(acks).map(([k,v])=>[k,v.runId])),proof,finalLedgerProofImported:false,wholeProductAccepted:false,retryAllowed:false};
      await io.record('whole-result',result);return result;
    }catch(e){const stopped={outcome:'WHOLE_CYCLE_STOPPED_REQUIRES_READBACK',phase,claimed,knownAcks:acks,code:code(e),retryAllowed:false};
      await io.record('whole-result',stopped);return stopped;
    }finally{await io.close();}
  }
  return Object.freeze({makeReview,verify,run});
}
