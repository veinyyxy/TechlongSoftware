// Trusted publisher adapter ONLY. No HTTP route, credential discovery, CLI,
// connection, automatic poller, raw-SQL input or activation on module import.
import {readFile} from 'node:fs/promises';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {releaseReady,validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {loadNeonContractV5} from '../cloud-worker/neon-contract-v5.mjs';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
import {assertCloudManifestV5,assertInstallationV5,continueCloudContextV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {assertEvidenceSafeV5,evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {admitPlatformJobV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import {CLOUD_V6 as C,S,must,digest,commit,keys,obj,assertExact,assertReferenceV6,exactRunV6,resultKeyV6} from './contract.mjs';
const prefix=`worker-v5/${S.instanceId}/`;
export function ownerQueryV6(kind,value) {
  // Returned only to a separately authorized owner/publisher port; NEVER the
  // platform controller's narrow service credential, browser or owner fallback.
  if(kind==='plan')return {text:'SELECT deployment_control_v6.publish_plan($1,$2,$3,$4::jsonb)',
    values:[value.planSha256,value.actionSha256,value.plan.riskSha256,canonicalJson(value.plan)]};
  must(kind==='proof' && digest(value.planSha256) && digest(value.proofSha256),'CONTROL_V6_OWNER_OPERATION');
  return {text:'SELECT deployment_control_v6.attest_evidence($1,$2)',values:[value.planSha256,value.proofSha256]};
}
export function createTrustedPublisherV6({release,sourceCommit,frozenSourceCommit,ports,now=Date.now}) {
  const gate=()=>must(releaseReady(release) && commit(sourceCommit) && commit(frozenSourceCommit) &&
    release.installationSha256===C.installationSha256,'CONTROL_V6_PUBLISHER_UNPUBLISHED');
  async function read(reference) {
    keys(obj(reference),['key','sha256','versionId']);
    must(typeof reference.key==='string' && reference.key.startsWith(prefix) && /^[A-Za-z0-9/_.-]+$/.test(reference.key) &&
      !reference.key.includes('..') && digest(reference.sha256) && /^[A-Za-z0-9._-]{1,256}$/.test(reference.versionId),'CONTROL_V6_PUBLISHER_REFERENCE');
    const r=await ports.readObject(reference);
    must(r.versionId===reference.versionId && r.encryption==='AES256' && Number.isSafeInteger(r.contentLength) &&
      r.contentLength>0 && r.contentLength<=1000000,'CONTROL_V6_PUBLISHER_METADATA');
    assertEvidenceSafeV5(r.value);must(await sha256Hex(r.value)===reference.sha256,'CONTROL_V6_PUBLISHER_DIGEST');return r.value;
  }
  async function context(inputs) {
    const contract=await loadNeonContractV5(),ir=JSON.parse(inputs.installation);
    assertReferenceV6(ir,prefix+`installation/${C.installationSha256}.json`);
    const installation=await assertInstallationV5(await read(ir),C.installationSha256,contract);
    const capsule=JSON.parse(await readFile(new URL('../cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
    const links=inputs.lineage?await read(JSON.parse(inputs.lineage)):[];
    const ctx=await continueCloudContextV5(await prepareCloudContextV5(capsule),links);
    return {context:ctx,installation,contract,code:{commitSha:sourceCommit,closureSha256:release.closureSha256}};
  }
  async function publish(plan) {
    const valid=await validatePlan(plan,release,now());
    await ports.writeOwner(ownerQueryV6('plan',valid)); // once, no catch/retry/merge
    return {...valid,executionApproved:false};
  }
  async function verifiedResult(planSha,resultReference) {
    gate();must(digest(planSha),'CONTROL_V6_PLAN_SHA');
    const entry=await ports.loadPlan(planSha),v=await validatePlan(entry.plan,release,entry.plan.preparedAt);
    must(v.planSha256===planSha && entry.actionSha256===v.actionSha256 && entry.plan.sourceCommit===sourceCommit &&
      entry.attempt?.state==='OBSERVED' && entry.attempt.status==='completed' && entry.attempt.conclusion==='success' &&
      /^[1-9][0-9]{0,15}$/.test(entry.attempt.runId),'CONTROL_V6_PROOF_LEDGER');
    const p=await read(resultReference);keys(obj(p),['schema','mode','jobId','run','frozenSourceCommit','closureSha256','identityProofSha256',
      'installationSha256','requestSha256','manifestSha256','outcome','cloudReportReference','executionReference','retryAllowed']);
    const plan=entry.plan,run=exactRunV6(await ports.readRun(entry.attempt.runId),{runId:entry.attempt.runId,sourceCommit,
      workflowId:release.workflowId,reusableCommit:release.reusableCommit});
    assertExact(p.run,run,'CONTROL_V6_PROOF_RUN');
    assertReferenceV6(resultReference,resultKeyV6(plan.jobId,p.manifestSha256,run.runId));
    must(p.schema==='techlong/platform-cloud-result/v6' && p.mode===plan.mode && p.jobId===plan.jobId &&
      p.frozenSourceCommit===frozenSourceCommit && p.closureSha256===release.closureSha256 &&
      p.identityProofSha256===release.identityProofSha256 && p.installationSha256===C.installationSha256 &&
      p.requestSha256===await sha256Hex(plan.inputs) && p.retryAllowed===false,'CONTROL_V6_PROOF_BINDING');
    const manifestReference=plan.mode==='Review'?p.cloudReportReference:JSON.parse(plan.inputs.manifest);
    assertReferenceV6(manifestReference,evidenceKeyV5('manifest.json',{jobId:plan.jobId,manifestSha256:p.manifestSha256}));
    const manifest=await read(manifestReference);
    must(manifest.jobPlan?.jobId===plan.jobId && manifest.manifestSha256===p.manifestSha256 &&
      (plan.mode==='Review' || p.manifestSha256===plan.inputs.manifestSha),'CONTROL_V6_PROOF_MANIFEST');
    await assertCloudManifestV5(manifest,await context(plan.inputs));
    if(plan.mode==='Review')must(p.outcome==='REVIEW_PREPARED_NOT_APPROVED' && p.executionReference===null,'CONTROL_V6_REVIEW_PROOF');
    else {
      assertReferenceV6(p.cloudReportReference,evidenceKeyV5(plan.mode==='RunOnce'?'run.json':'inspect.json',
        {jobId:plan.jobId,manifestSha256:p.manifestSha256,run}));
      const report=await read(p.cloudReportReference);assertExact(report.run,run,'CONTROL_V6_REPORT_RUN');
      must(report.manifestSha256===p.manifestSha256 && (report.outcome??report.result?.outcome)===p.outcome &&
        report.retryAllowed===false,'CONTROL_V6_REPORT_BINDING');
      if(plan.mode==='RunOnce') {
        must(report.schema==='techlong/cloud-worker-run/v5' && report.jobId===plan.jobId &&
          ['NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED','INSPECT_REQUIRED_NO_RETRY'].includes(p.outcome),'CONTROL_V6_RUN_PROOF');
        assertReferenceV6(p.executionReference,prefix+`${plan.jobId}/${p.manifestSha256}/execution-reference-${run.runId}-v1.json`);
        const e=await read(p.executionReference);
        assertExact(e,{executionRun:run,executionReportReference:p.cloudReportReference},'CONTROL_V6_EXECUTION_DESCRIPTOR');
      } else {
        const {inspectSha256,...body}=report;
        must(report.schema==='techlong/cloud-worker-independent-inspect/v5' && report.jobId===plan.jobId &&
          p.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED' && report.executionRun?.runId===plan.predecessor.runId &&
          report.executionRun.commitSha===sourceCommit && report.executionRun.runId!==run.runId &&
          report.journal?.state==='ALL_SLOTS_CONSUMED' && digest(report.receiptSha256) && digest(report.providerObservationSha256) &&
          inspectSha256===await sha256Hex(body) && report.cloudWrites===0 && report.databaseWrites===0 && report.privateControlReads===0 &&
          Number.isSafeInteger(report.checkedAt) && report.checkedAt<=now()+30000 && p.executionReference===null,'CONTROL_V6_INSPECT_PROOF');
      }
    }
    const body={schema:'techlong/platform-cloud-attestation/v6',planSha256:planSha,run,mode:plan.mode,jobId:plan.jobId,
      resultReference,manifestReference,reportReference:p.cloudReportReference,outcome:p.outcome};
    return {entry,manifest,proof:p,attestation:{...body,proofSha256:await sha256Hex(body)}};
  }
  return {
    async publishReview({jobId,installationReference,lineageReference=null}) {
      gate();const at=now();
      const inputs={mode:'Review',job:jobId,installation:canonicalJson(installationReference),manifest:'',manifestSha:'',execution:'',
        lineage:lineageReference?canonicalJson(lineageReference):''};
      const plan={schema:'techlong/platform-controller-plan/v6',instanceId:S.instanceId,deploymentId:S.deploymentId,jobId,mode:'Review',
        sourceCommit,releaseSha256:await sha256Hex(release),riskSha256:release.riskSha256,preparedAt:at,expiresAt:at+7200000,inputs,predecessor:null};
      await validatePlan(plan,release,at);const ctx=await context(inputs);
      const admitted=await admitPlatformJobV4({root:ctx.context.root,predecessor:ctx.context.predecessor,observed:await ports.readHeldJob(jobId),now:now()});
      must(admitted.jobPlan.jobId===jobId,'CONTROL_V6_REQUEST_JOB');return publish(plan);
    },
    async attestResult(planSha,reference) {
      const v=await verifiedResult(planSha,reference);
      must(v.entry.attempt.proofSha256===null,'CONTROL_V6_ATTESTATION_OCCUPIED');
      await ports.writeOwner(ownerQueryV6('proof',v.attestation));return v.attestation;
    },
    async publishSuccessor(planSha,reference) {
      const v=await verifiedResult(planSha,reference),prior=v.entry.plan,at=now();
      must(v.entry.attempt.proofSha256===v.attestation.proofSha256 && prior.mode!=='Inspect','CONTROL_V6_PREDECESSOR_ATTESTATION');
      const plan=structuredClone(prior);plan.mode=prior.mode==='Review'?'RunOnce':'Inspect';plan.inputs.mode=plan.mode;
      plan.preparedAt=at;plan.expiresAt=at+7200000;
      plan.predecessor={planSha256:planSha,runId:v.entry.attempt.runId,proofSha256:v.attestation.proofSha256};
      plan.inputs.manifest=canonicalJson(v.attestation.manifestReference);plan.inputs.manifestSha=v.proof.manifestSha256;
      if(plan.mode==='RunOnce') {
        assertRunWindowV3(v.manifest,at);
        plan.expiresAt=Math.min(plan.expiresAt,v.manifest.jobPlan.claimBy,v.manifest.workload.workloadExpiresAt-90*60000);
      } else plan.inputs.execution=canonicalJson(v.proof.executionReference);
      return publish(plan); // publication is not approval or a workflow dispatch
    },
  };
}
