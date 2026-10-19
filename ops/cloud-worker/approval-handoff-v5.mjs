// Local-only timing/approval handoff; no cloud code, workflow or IAM changes.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CORRECTED_JOB_DISPATCH_V5 as OLD,prepareCorrectedJobDispatchV5,jobDispatchBodyV5,assertJobReferenceV5} from './corrected-job-dispatch-v5.mjs';
import {assertProbeRunV5} from './verify-install-v5.mjs';
import {assertEvidenceSafeV5} from './cloud-evidence-v5.mjs';
import {requireActivationV5} from './activation/errors-v5.mjs';
const must=(v,c)=>requireActivationV5(v,'HANDOFF_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const APPROVAL_HANDOFF_V5=Object.freeze({...OLD,
  previousSourceCommit:'1b6aafb36130658d79118a189ab61a22cad59301',
  previousRunId:'39174947831',previousReviewRunId:'39173977158',
  failureCheckpointSha256:'aa121edda3a2158297b90c9c181edf90d152d04063e4c97ed2212e86f61b2b35',
  minimumRunOnceRemainingMs:480000,handoffWaitMs:120000,
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5r-approval-handoff.md',
});
const V=APPROVAL_HANDOFF_V5;
export function handoffSlotV5(mode){
  must(['Review','RunOnce','Inspect'].includes(mode),'SLOT_MODE');
  return 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-'+V.jobId+'-'+mode.toLowerCase()+'-v'+(mode==='Review'?'6':'5')+'.permanent-slot.json';
}
export function assertHandoffBudgetV5(mode,cloud,now){
  if(mode==='RunOnce')must(Number.isSafeInteger(now)&&Number.isSafeInteger(cloud?.claimBy)&&cloud.claimBy-now>=V.minimumRunOnceRemainingMs,'INSUFFICIENT_APPROVAL_TIME_NO_DISPATCH');
}
export async function prepareHandoffV5(context){
  const {source,history,mode,cloud,now}=context;
  must(source.files.length>=179&&history.expiredRunOnceEvidenceVerified===true&&history.previousAttemptSourcePinsVerified===172&&
    history.previousRunOnceRunId===V.previousRunId&&history.previousReviewRunId===V.previousReviewRunId&&
    history.previousRunOnceLocalSlotPreserved===true&&history.previousFailureCheckpointSha256===V.failureCheckpointSha256,'PREVIOUS_ATTEMPT_HISTORY');
  if(mode!=='Inspect')must(context.prestate.newAttemptJournal?.allFiveAbsent===true&&context.prestate.newAttemptJournal.tableId==='ea69c69e-1c48-481a-83f0-36393c196d9f'&&
    context.prestate.newAttemptJournal.transactionalFiveEntrySnapshot===true,'CURRENT_JOURNAL_NOT_CLEAR_NO_NEW_ATTEMPT');
  assertHandoffBudgetV5(mode,cloud,now);
  const {manifestSha256:discarded,...prior}=await prepareCorrectedJobDispatchV5(context);void discarded;
  const body={...prior,schema:'techlong/cloud-worker-approval-handoff-review/v5',riskFile:V.riskFile,localPermanentSlot:handoffSlotV5(mode),
    approvalHandoff:{operatorReadyForConsecutiveApprovalsRequired:true,readinessDeclarationIsNotBrowserPresenceProof:true,
      minimumRunOnceRemainingMs:V.minimumRunOnceRemainingMs,cloudClaimWindowChanged:false,automaticDispatch:false,
      reviewToRunOncePreparationReadOnly:true,maximumReadOnlyWaitMs:V.handoffWaitMs}};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function assertHandoffApprovalV5(m,approved,context,now){
  must(/^[a-f0-9]{64}$/.test(approved)&&approved===m.manifestSha256&&now>=m.preparedAt&&now<m.expiresAt&&
    same(m,await prepareHandoffV5({...context,now:m.preparedAt})),'FRESH_EXACT_APPROVAL');
  assertHandoffBudgetV5(m.mode,m.cloud,now);
}
export async function dispatchHandoffV5({manifest:m,approved,context,io,now=Date.now}){
  const approve=p=>assertHandoffApprovalV5(m,approved,{...context,prestate:p},now());
  await approve(m.prestate);const start=now(),prestate=await io.preflight(m.mode);await approve(prestate);
  must(now()-start<180000,'PREFLIGHT_WINDOW');
  await io.consumeSlot(m.mode,{manifestSha256:m.manifestSha256,at:now(),retryAllowed:false});
  await io.record('dispatch-intent',{mode:m.mode,manifestSha256:m.manifestSha256,main:m.source.commit,at:now()});
  const guard=async()=>{await approve(prestate);must(now()-start<240000,'SUBMISSION_WINDOW');await io.assertLocalSource(m);await io.assertCloudWindow(m.mode);
    await approve(prestate);must(now()-start<240000,'SUBMISSION_WINDOW');};
  let request=m.request;
  if(m.executionObject){
    await guard();const ref=await io.putExecutionReference(m.executionObject);await io.record('execution-reference-ack',ref);
    assertJobReferenceV5(ref,m.executionObject.key);must(ref.sha256===await sha256Hex(m.executionObject.body),'EXECUTION_ACK_DIGEST');
    request={...request,body:jobDispatchBodyV5(m.mode,m.cloud,ref)};
  }
  const ack=await io.dispatch(request,guard);await io.record('dispatch-api-ack',ack);
  must(Number.isSafeInteger(ack.workflow_run_id)&&ack.workflow_run_id>0&&ack.html_url==='https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id&&
    ack.run_url==='https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id,'EXACT_RUN_ACK');
  const result={outcome:'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL',mode:m.mode,manifestSha256:m.manifestSha256,
    jobId:V.jobId,runId:String(ack.workflow_run_id),url:ack.html_url,environmentApprovedByController:false,retryAllowed:false};
  await io.record('dispatch-result',result);return result;
}
export async function reviewToRunOnceHandoffV5({manifest:m,runId,io,now=Date.now}){
  must(m.mode==='Review'&&m.schema==='techlong/cloud-worker-approval-handoff-review/v5','REVIEW_HANDOFF_ONLY');
  const start=now();let last;
  for(;;){
    last=await io.readRun(runId);assertProbeRunV5(last,m,runId);
    if(last.status==='completed')break;
    if(now()-start>=V.handoffWaitMs)return {outcome:'HANDOFF_REVIEW_NOT_COMPLETE_NO_DISPATCH',runId,status:last.status,retryAllowed:false};
    await io.sleep(5000);
  }
  const reviewed=await io.observe(m,runId);
  if(last.conclusion!=='success'||reviewed.outcome!=='CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL')return {outcome:'HANDOFF_REVIEW_UNSUCCESSFUL_NO_DISPATCH',reviewed,retryAllowed:false};
  const prepared=await io.prepareRunOnce(reviewed);
  must(prepared.outcome==='PREPARED_NOT_DISPATCHED'&&prepared.cloudMode==='RunOnce'&&prepared.workflowDispatches===0&&prepared.slotConsumed===false,'READ_ONLY_HANDOFF_RESULT');
  return {outcome:'REVIEW_VERIFIED_RUNONCE_PREPARED_REQUIRES_SEPARATE_APPROVAL',reviewRunId:runId,prepared,automaticDispatches:0,environmentApprovedByController:false};
}
export function runOnceHandoffScopeV5(m,cm){
  must(m.mode==='RunOnce'&&m.cloud?.manifestSha256===cm.manifestSha256&&m.source.commit===cm.code.commitSha&&m.expiresAt===cm.jobPlan.claimBy&&
    Object.keys(cm.workload.template.Resources).length===7&&cm.workload.request.OnFailure==='ROLLBACK','SCOPE_EXACT_PLAN');
  const resources=Object.entries(cm.workload.template.Resources).map(([id,r])=>'- '+id+': '+r.Type).join('\n');
  const text=`# 一次 RunOnce 待审范围（未执行）\n\n清单 SHA：${m.manifestSha256}\n云 manifest SHA：${cm.manifestSha256}\n冻结 main：${m.source.commit}\n同任务：${m.jobId}\n\n原 claimBy：${new Date(m.expiresAt).toISOString()}；必须在此前实际领取，不因人工审批延长。\n本机提交前至少保留8分钟；排队/人工延迟仍可能过期，不能保证成功。\n执行 deadline：${new Date(cm.jobPlan.deadline).toISOString()}；承载标签到期：${new Date(cm.workload.workloadExpiresAt).toISOString()}。到期不保证清理/停费。\n\n准确栈名：${cm.workload.stackName}\nCreateStack 请求 SHA：${cm.workload.requestSha256}\n复用父 Cell：${cm.workload.parentStackId}\n\n七资源：\n${resources}\n\n允许一次 GitHub dispatch（人工 environment 批准仍由用户完成）；同任务领取、最多一次七资源 CreateStack、五个永久DDB动作、固定DB及control Secret各一读、最多两次认证GET、原子完成及固定私有前缀条件回执写。不得改IAM/Secret/DNS/父Cell或初始化/改密码，不创建新请求。\n\n这是实际付费部署。50 USD/月是目标不是硬cap。AWS/GitHub/Neon非原子、无跨服务CAS，可能遗留收费资源或已领取任务/永久槽。CreateStack OnFailure=ROLLBACK，CFN可以回滚本次新建资源且可能失败；controller/worker不额外删除、回滚业务、补齐、复位或重试。凭据/JWT/mTLS在云内存/固定链路使用，提供者/管理员日志及内存暴露风险仍在。区域级任务定义读取权限既已存在且持续，不是租户过滤。\n\nRunOnce成功不等于独立验收；Inspect另行fresh批准，不自动运行。原日志/签名URL/私密业务快照不公开。完整风险见 ${V.riskFile} 和 docs/aws-auto-deployment-cloud-worker-w5c.md。\n`;
  assertEvidenceSafeV5(text);return text;
}
