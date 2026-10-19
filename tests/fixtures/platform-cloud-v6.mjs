import {readFile} from 'node:fs/promises';
import {cloudRootFixtureV5} from './cloud-worker-root-v5.mjs';
import {prepareInitializedWorkloadV3} from '../../ops/aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import {CLOUD_EFFECTS_V5} from '../../ops/cloud-worker/cloud-worker-root-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {CLOUD_V6 as C,S,resultKeyV6} from '../../ops/platform-cloud-v6/contract.mjs';
export async function platformFixtureV6() {
  const f=await cloudRootFixtureV5(),at=f.now,objects=new Map(),plans=new Map(),writes=[],calls=[];
  const sourceCommit='f'.repeat(40),frozenSourceCommit='a'.repeat(40),release={state:'PUBLISHED',workflowId:'12345',actorId:S.candidateBotId,
    reusableCommit:'b'.repeat(40),closureSha256:'c'.repeat(64),identityProofSha256:'d'.repeat(64),installationSha256:C.installationSha256,riskSha256:'e'.repeat(64)};
  const binding={state:'PUBLISHED',sourceCommit:frozenSourceCommit,reusableCommit:release.reusableCommit,closureSha256:release.closureSha256,
    identityProofSha256:release.identityProofSha256,actorId:S.candidateBotId,installationSha256:C.installationSha256};
  const closure={closureSha256:binding.closureSha256,legacyClosureSha256:C.legacyClosureSha256};
  async function store(key,value) {
    const reference={key,versionId:'fixture-version',sha256:await sha256Hex(value)};
    objects.set(key,{value:structuredClone(value),versionId:reference.versionId,encryption:'AES256',contentLength:Buffer.byteLength(canonicalJson(value))});return reference;
  }
  const installation=JSON.parse(await readFile(new URL('../../ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',import.meta.url),'utf8'));
  const installationReference=await store(`worker-v5/${S.instanceId}/installation/${C.installationSha256}.json`,installation);
  const workload=await prepareInitializedWorkloadV3({root:f.context.root,jobPlan:f.admission.jobPlan,publicParameters:f.context.publicParameters,
    cell:{stackId:f.context.base.compute.stackId,outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn']
      .map(k=>[k,f.context.base.compute.outputs[k]])),parentTagExpiresAt:f.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}});
  const body={schema:'techlong/cloud-worker-review/v5',...f.admission,workload,predecessor:f.context.predecessor,
    code:{commitSha:sourceCommit,closureSha256:closure.closureSha256},installationSha256:C.installationSha256,
    publicCapsuleSha256:f.context.capsuleSha256,preflightSha256:'9'.repeat(64),effects:CLOUD_EFFECTS_V5,
    riskFile:'docs/aws-auto-deployment-cloud-worker-w5c.md',preparationIsNotExecutionApproval:true};
  const manifest={...body,manifestSha256:await sha256Hex(body)},jobId=f.observed.job.id;
  const manifestReference=await store(`worker-v5/${S.instanceId}/${jobId}/${manifest.manifestSha256}/manifest.json`,manifest);
  const basePlan={schema:'techlong/platform-controller-plan/v6',instanceId:S.instanceId,deploymentId:S.deploymentId,jobId,mode:'Review',
    sourceCommit,releaseSha256:await sha256Hex(release),riskSha256:release.riskSha256,preparedAt:at,expiresAt:at+7200000,predecessor:null,
    inputs:{mode:'Review',job:jobId,installation:canonicalJson(installationReference),manifest:'',manifestSha:'',execution:'',lineage:''}};
  const rawRun=(id,workflowFile=S.workflowFile)=>({id:Number(id),run_attempt:1,event:'workflow_dispatch',head_branch:'main',head_sha:sourceCommit,
    workflow_id:12345,path:'.github/workflows/'+workflowFile,repository:{id:Number(S.repositoryId),full_name:S.repository,owner:{id:Number(S.ownerId)}},
    actor:{id:Number(S.candidateBotId)},triggering_actor:{id:Number(S.candidateBotId)},status:'completed',conclusion:'success',
    referenced_workflows:[{sha:release.reusableCommit,path:`${S.repository}/.github/workflows/${C.reusableWorkflow}@${release.reusableCommit}`}]});
  const run=id=>({repository:S.repository,runId:id,runAttempt:1,commitSha:sourceCommit});
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:S.repository,GITHUB_REPOSITORY_ID:S.repositoryId,GITHUB_REPOSITORY_OWNER_ID:S.ownerId,
    GITHUB_ACTOR_ID:S.candidateBotId,GITHUB_ACTOR:C.actorLogin,GITHUB_TRIGGERING_ACTOR:C.actorLogin,GITHUB_REF:'refs/heads/main',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123456789',GITHUB_SHA:sourceCommit,
    GITHUB_WORKFLOW_REF:`${S.repository}/.github/workflows/${S.workflowFile}@refs/heads/main`,
    TECHLONG_FROZEN_SOURCE_COMMIT:frozenSourceCommit,TECHLONG_REUSABLE_COMMIT:release.reusableCommit,
    ...Object.fromEntries(Object.entries(basePlan.inputs).map(([k,v])=>['TECHLONG_INPUT_'+k.toUpperCase(),v]))};
  let clock=at;
  const ports={
    readObject:async ref=>{calls.push('object:'+ref.key);return structuredClone(objects.get(ref.key));},
    readRun:async id=>{calls.push('run:'+id);return rawRun(id);},
    readHeldJob:async()=>structuredClone(f.observed),loadPlan:async sha=>structuredClone(plans.get(sha)),
    writeOwner:async q=>{writes.push(q);if(q.text.includes('attest_evidence'))plans.get(q.values[0]).attempt.proofSha256=q.values[1];
      else {const p=JSON.parse(q.values[3]);plans.set(q.values[0],{plan:p,planSha256:q.values[0],actionSha256:q.values[1],riskSha256:q.values[2],attempt:null});}},
  };
  async function observedPlan(plan,id) {
    const v=await validatePlan(plan,release,plan.preparedAt);
    plans.set(v.planSha256,{...v,riskSha256:release.riskSha256,attempt:{state:'OBSERVED',runId:id,status:'completed',conclusion:'success',proofSha256:null}});return v;
  }
  async function resultFor(plan,id,patch={}) {
    const value={schema:'techlong/platform-cloud-result/v6',mode:plan.mode,jobId,run:run(id),frozenSourceCommit,
      closureSha256:release.closureSha256,identityProofSha256:release.identityProofSha256,installationSha256:C.installationSha256,
      requestSha256:await sha256Hex(plan.inputs),manifestSha256:manifest.manifestSha256,outcome:'REVIEW_PREPARED_NOT_APPROVED',
      cloudReportReference:manifestReference,executionReference:null,retryAllowed:false,...patch};
    return store(resultKeyV6(jobId,manifest.manifestSha256,id),value);
  }
  return {...f,at,objects,plans,writes,calls,sourceCommit,frozenSourceCommit,release,binding,closure,installation,installationReference,
    manifest,manifestReference,basePlan,env,ports,store,rawRun,run,observedPlan,resultFor,now:()=>clock,tick:n=>{clock+=n;}};
}
