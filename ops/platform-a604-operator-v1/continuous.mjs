// Additional approval BEFORE Review dispatch, never an upgrade of a Review-only grant.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {assertA604Publication,assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {A604_PROFILE} from '../platform-a604-cloud-v1/profile.mjs';
import {proposeReviewSuccessor} from '../platform-delegated-publisher-v1/successor.mjs';
import {REQUEST_EVIDENCE} from './publisher.mjs';
import {D,PUBLISH_SLOT} from './scope.mjs';
export const CONTINUOUS=Object.freeze({schema:'techlong/a604-continuous-review/v1',
  slot:'F:/ChatGPT_workshop/techlong-a604-continuous-review-v1.intent.json',
  riskFile:'docs/aws-auto-deployment-a604-continuous-review.md',maxRunMs:20*60000,pollMs:15000,pollsMax:80});
const must=(v,c)=>{if(!v)throw Error('A604_CONTINUOUS_'+c);},same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const safe=e=>/^[A-Z][A-Z0-9_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD';
const defaults={D,CONTINUOUS,PUBLISH_SLOT,assertA604Publication,assertA604PlanScope};
export function createContinuousReviewFlow({policy,publisher,runtime,profile=A604_PROFILE,requestEvidence=REQUEST_EVIDENCE,now=Date.now,capability}){
  const D=capability?.definition??defaults.D,CONTINUOUS=capability?.continuous??defaults.CONTINUOUS,PUBLISH_SLOT=capability?.publishSlot??defaults.PUBLISH_SLOT,
    assertA604Publication=capability?.assertPublication??defaults.assertA604Publication,assertA604PlanScope=capability?.assertScope??defaults.assertA604PlanScope;
  async function makeReview({grant,createdAt}){
    await policy.approve(grant,grant.grantSha256,createdAt);
    must(Number.isSafeInteger(createdAt)&&createdAt>=grant.issuedAt&&createdAt<grant.reviewLatestStartAt&&
      grant.policy.jobId===D.jobId&&grant.policy.approveGithubEnvironment===false,'GRANT_OR_START');
    const body={schema:CONTINUOUS.schema,sourceCommit:grant.sourceCommit,grant,createdAt,latestStartAt:grant.reviewLatestStartAt,
      expiresAt:Math.min(grant.seed.plan.expiresAt,grant.expiresAt),slot:CONTINUOUS.slot,publisherSlot:PUBLISH_SLOT,riskFile:CONTINUOUS.riskFile,
      derivation:'EXISTING_A604_CONTENT_VERIFIER_AND_THREE_WRITE_PUBLISHER_V1',
      effects:{reviewDispatchMax:1,runOnceDispatchMax:0,configurationReadsMax:3,tlsConnectionsMax:5,sqlQueriesMax:245,
        sourceStsMax:3,auditPermissionSimulationsMax:1,auditPutsMax:1,pemReadsMax:1,appTokensMax:1,appRevokeAttemptsMax:1,
        captureS3GetsMax:4,publisherS3GetsMax:4,monitorGithubGetsMax:86,officialLogDownloadsMax:1,ciGithubGetsMax:9,
        observationsMax:1,proofWritesMax:1,runOncePlanWritesMax:1,resourceWrites:0,newIam:0,secretValueReads:0},
      cloudReview:{installationReference:grant.seed.plan.inputs.installation,inheritedInstalledContract:true,
        databaseSecretValueReadsMax:1,controlSecretReads:0,outerS3PutsMax:2,resourceWrites:0,ddbWrites:0},
      policy:{humanGithubApprovalRequired:true,approveGithubEnvironment:false,noDeadlineExtension:true,noSlotReset:true,
        noResumeOrAutomaticRetry:true,independentReadbackRequired:true,chatApprovalBetweenReviewAndPublication:false},executionAuthorized:false};
    return freeze({...body,manifestSha256:await sha256Hex(body)});
  }
  async function verify(m,approved,at,starting=false){
    must(same(m,await makeReview(m))&&m.manifestSha256===approved&&at>=m.createdAt&&at<m.expiresAt&&
      (!starting||at<m.latestStartAt),'APPROVAL_OR_EXPIRED');await policy.approve(m.grant,m.grant.grantSha256,at);return m;
  }
  let used=false;
  async function run({manifest:input,approved,io}){
    const m=freeze(structuredClone(input));await verify(m,approved,now(),true);must(!used,'MEMORY_ONCE');used=true;
    const started=now();let phase='PREFLIGHT',claimed=false,ack=null,derived=null;
    const guard=async()=>{await verify(m,approved,now());must(now()>=started&&now()-started<CONTINUOUS.maxRunMs,'RUN_DEADLINE');await io.assertSource();};
    try{
      await guard();await io.assertUnused();await io.verifyCi();
      phase='CLAIM';await io.claim({outerSha256:approved,grantSha256:m.grant.grantSha256,sourceCommit:m.sourceCommit});claimed=true;
      await io.record('approved-continuous-review',m);
      phase='REVIEW_DISPATCH';ack=await io.dispatchReview(m.grant,guard);
      must(ack.outcome==='DELEGATED_DISPATCH_ACKNOWLEDGED_REQUIRES_USER_GITHUB_APPROVAL'&&ack.mode==='Review'&&
        ack.planSha256===m.grant.seed.planSha256&&/^[1-9][0-9]{0,15}$/.test(ack.runId),'DISPATCH_ACK');
      await io.record('continuous-dispatch-ack',ack);await guard();phase='WAIT_REVIEW';
      const run=await io.waitReview(ack,Math.min(started+CONTINUOUS.maxRunMs,m.expiresAt),guard);
      must(String(run.id)===ack.runId&&run.status==='completed'&&run.conclusion==='success','REVIEW_NOT_SUCCESS');
      await guard();phase='CAPTURE';const c=await io.capture(ack,run,guard),g=m.grant,binding=g.binding;
      must(c.entry.planSha256===g.seed.planSha256&&same(c.entry.plan,g.seed.plan)&&c.entry.attempt?.runId===ack.runId&&
        c.entry.attempt.state==='ACKNOWLEDGED'&&c.objects.length===4&&new Set(c.objects.map(o=>canonicalJson(o.reference))).size===4,'CAPTURE_SCOPE');
      const object=r=>{const found=c.objects.find(o=>same(o.reference,r));must(found,'EXACT_OBJECT');return structuredClone(found.object);};
      const basis=await runtime.rebuild(object(binding.packageReference).value);
      const propose=capability?.proposeReview??proposeReviewSuccessor;
      const proposal=await propose({binding,basis,entry:c.entry,run,resultReference:c.resultReference,
        readObject:async r=>object(r),now,rebuildPackage:runtime.rebuild},
      {assertBinding:p=>assertA604Publication(p,profile,now()),assertScope:assertA604PlanScope});
      const envelope=object(proposal.manifestReference).value,inner=runtime.innerManifest?runtime.innerManifest(envelope):envelope.innerManifest;
      phase='DERIVE';derived=await publisher.makeReview({binding,basis,baseline:c.snapshot,reviewEntry:c.entry,requestEvidence,
        action:{operation:'AdvanceReview',planSha256:g.seed.planSha256,runId:ack.runId,resultReference:c.resultReference},
        timing:{preparedAt:inner.jobPlan.preparedAt,claimBy:proposal.timing.claimBy,workloadExpiresAt:proposal.timing.workloadExpiresAt},
        pins:g.pins,ci:g.ci,auth:g.auth,createdAt:now()});
      must(derived.slot===PUBLISH_SLOT&&derived.action.operation==='AdvanceReview'&&derived.action.runId===ack.runId&&
        same(derived.binding,binding)&&same(derived.pins,g.pins)&&same(derived.auth,g.auth)&&same(derived.ci,g.ci)&&
        derived.effects.observationsMax===1&&derived.effects.proofWritesMax===1&&derived.effects.planWritesMax===1&&
        derived.effects.awsWrites===0&&derived.effects.dispatches===0,'DERIVED_SCOPE');
      // This new inner SHA is covered ONLY by the separately approved outer
      // derivation rule. No JSON-provided inner review or arbitrary SQL enters.
      await io.record('derived-publisher-review',{outerSha256:approved,review:derived});await guard();
      phase='PUBLISH';const publisherIo=await io.publisherIo(derived,c,guard);
      const result=await publisher.runReviewed({manifest:derived,basis,approved:derived.manifestSha256,io:publisherIo,now,rebuildPackage:runtime.rebuild});
      must(result.outcome==='DELEGATED_RUNONCE_PUBLISHED_REQUIRES_SEPARATE_DISPATCH'&&result.independentReadbackVerified===true&&
        result.reviewRunId===ack.runId&&result.plan?.mode==='RunOnce'&&result.plan.jobId===g.policy.jobId&&
        result.plan.predecessor.planSha256===g.seed.planSha256&&result.plan.predecessor.runId===ack.runId&&
        result.submissions===3&&result.dispatches===0,'PUBLISH_REQUIRES_READBACK');
      const done={outcome:'CONTINUOUS_REVIEW_VERIFIED_RUNONCE_PLAN_PUBLISHED_NOT_DISPATCHED',outerSha256:approved,
        reviewRunId:ack.runId,publisherManifestSha256:derived.manifestSha256,successor:result,runOnceDispatched:false,
        actualDeploymentAccepted:false,retryAllowed:false};await io.record('continuous-result',done);return done;
    }catch(e){const stopped={outcome:'CONTINUOUS_REVIEW_STOPPED_REQUIRES_READBACK',phase,claimed,knownAck:ack,
      derivedManifestSha256:derived?.manifestSha256??null,code:safe(e),retryAllowed:false,runOnceDispatched:false};
      await io.record('continuous-result',stopped);return stopped;
    }finally{await io.close();}
  }
  return Object.freeze({makeReview,verify,run});
}
