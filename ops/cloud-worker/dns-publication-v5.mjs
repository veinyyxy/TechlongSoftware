// Scoped release orchestration. No network, credential discovery or resource writer here.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {dnsReleasePlanV5,DNS_RELEASE_V5 as V} from './dns-release-v5.mjs';
import {verifyActivationChangeSetV5} from './activation/plan-v5.mjs';
import {requireActivationV5 as must,safeActivationFailureV5} from './activation/errors-v5.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const DNS_PUBLICATION_V5=Object.freeze({riskFile:'docs/aws-auto-deployment-cloud-worker-w5k-dns-publication.md',
  slot:V.proposedSlot,workflowId:388188162,environmentId:24613410405,tableId:'ea69c69e-1c48-481a-83f0-36393c196d9f'});
const P=DNS_PUBLICATION_V5;
export async function prepareDnsPublicationV5(context){
  const base=await dnsReleasePlanV5(context),p=context.prestate;
  must(p.tableId===P.tableId && p.environment?.environmentId===P.environmentId && p.environment.requiredReviewerId===14145707 &&
    p.environment.adminBypass===false && p.environment.mainBranchOnly===true && p.unfinishedDeploymentRuns===0 && p.sourceCiConfirmed===true &&
    /^[a-f0-9]{64}$/.test(p.metadataSha256),'DNS_PUBLICATION_PRESTATE');
  const actions=structuredClone(base.actions);
  actions.foundation.execute.ClientRequestToken='dns-normalization-execute-v5-'+(await sha256Hex(actions.foundation.create)).slice(0,40);
  const body={schema:'techlong/cloud-worker-dns-publication-execution-review/v5',preparedAt:base.preparedAt,expiresAt:base.expiresAt,
    source:base.source,history:base.history,release:base.release,prestate:p,actions,permanentSlot:P.slot,riskFile:P.riskFile,
    effects:{...base.proposedEffects,localMainFastForward:1,permanentLocalSlot:1,automaticWorkflowDispatch:0,automaticWriteRetries:0},
    risks:base.risks,preparationIsNotExecutionApproval:true,executableEntryAvailable:true,
    dynamicChangeSetRule:'Execute only the ARN returned by this exact Create ACK after strict trust-only change and exact template verification; never a name lookup or unrelated Change Set',
    independentNewProcessInspectRequired:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertDnsPublicationApprovalV5(m,approved,context,now){
  must(/^[a-f0-9]{64}$/.test(approved) && m.manifestSha256===approved && now>=m.preparedAt && now<m.expiresAt &&
    same(m,await prepareDnsPublicationV5({...context,now:m.preparedAt})),'DNS_PUBLICATION_FRESH_EXACT_APPROVAL');
}
export function verifyDnsPublicationChangeSetV5(d,m,id,template){
  must(/^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/dns-normalization-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(id) &&
    id.split('/')[1]===m.actions.foundation.create.ChangeSetName && d.ChangeSetId===id &&
    same(template,JSON.parse(m.actions.foundation.create.TemplateBody)),'DNS_PUBLICATION_EXACT_CHANGE_SET');
  return verifyActivationChangeSetV5(d,V.stackId,V.roleName);
}
export async function publishDnsV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=()=>assertDnsPublicationApprovalV5(m,approved,context,now());
  await approve();const start=now(),prestate=await io.preflight(m.source.commit);
  must(same(prestate,m.prestate) && now()-start<180000,'DNS_PUBLICATION_FRESH_PRESTATE');await approve();
  await io.consumeSlot({manifestSha256:m.manifestSha256,at:now(),retryAllowed:false,oldSlotsPreserved:true});
  let phase='SlotConsumed';
  const guard=async()=>{await approve();must(now()-start<1200000,'DNS_PUBLICATION_EXECUTION_WINDOW');await io.assertLocalSource(m);};
  try{
    phase='PublishPreparedWorkflows';await io.record('publish.intent',{manifestSha256:m.manifestSha256,at:now()});
    await guard();const push=await io.publishRelease(m.release,guard);await io.record('publish.ack',push);
    phase='VerifyOldLayoutBeforeCreate';await io.verifyLayout(m,'old',m.release.caller.commit,'before-create');
    phase='CreateTrustOnlyChangeSet';await guard();await io.record('create.intent',{manifestSha256:m.manifestSha256,at:now()});
    const ref=await io.createChangeSet(m.actions.foundation.create,guard);await io.record('create.ack',ref);
    phase='VerifyExactChangeSet';const checked=await io.waitChangeSet(ref,m,guard);await io.record('changeset-verified',checked);
    phase='VerifyOldLayoutBeforeExecute';await io.verifyLayout(m,'old',m.release.caller.commit,'before-execute');
    phase='ExecuteTrustOnlyChangeSet';await guard();await io.record('execute.intent',{manifestSha256:m.manifestSha256,changeSetId:ref.changeSetId,at:now()});
    const execute=await io.executeChangeSet(ref,m,guard);await io.record('execute.ack',execute);
    phase='WaitFoundation';await io.waitFoundation(guard);
    phase='FinalSameProcessReadback';const proof=await io.verifyLayout(m,'new',m.release.caller.commit,'final-layout');
    phase='LocalMainFastForward';await guard();await io.syncLocalMain(m.release);
    const result={outcome:'DNS_VERSION_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',manifestSha256:m.manifestSha256,
      runtimeCommit:m.release.runtimeCommit,reusableCommit:m.release.reusable.commit,callerCommit:m.release.caller.commit,
      changeSetId:ref.changeSetId,proof,counts:io.counts(),independentInspectRequired:true,workflowDispatched:false,retryAllowed:false};
    await io.record('result',result);return result;
  }catch(e){
    const result={outcome:'DNS_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',manifestSha256:m.manifestSha256,phase,
      failure:safeActivationFailureV5(e),counts:io.counts(),independentInspectRequired:true,workflowDispatched:false,retryAllowed:false};
    await io.record('stopped',result);return result;
  }
}
