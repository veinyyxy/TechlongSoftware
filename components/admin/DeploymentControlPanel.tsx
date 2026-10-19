"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ControllerView } from '@/lib/deployments/controller-v6/controller';

export function DeploymentControlPanel({instanceId,view}:{instanceId:string;view:ControllerView}) {
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function act(operation:'observe'|'approve_and_dispatch',p:ControllerView['plans'][number]) {
    if(busy || !view.enabled)return;
    if(operation==='approve_and_dispatch' && !window.confirm(`确认批准 ${p.mode} 的单次调度？\n计划 ${p.planSha256}\n动作 ${p.actionSha256}\n风险 ${p.riskSha256}\n成功或未知均不自动重试，GitHub 环境仍需人工批准。`))return;
    setBusy(true);setMessage('');
    try {
      const response=await fetch(`/api/admin/instances/${encodeURIComponent(instanceId)}/deployment-control`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(operation==='observe'
          ? {operation,planSha256:p.planSha256}:{operation,planSha256:p.planSha256,actionSha256:p.actionSha256,riskSha256:p.riskSha256})});
      setMessage(response.ok?'操作返回；请核对最新记录。GitHub 运行成功不等于部署验收通过。':'结果需只读核对，不要重试提交。');
    }catch{setMessage('连接结果不明，请只刷新记录，不要重试提交。');}
    finally{if(operation==='observe')setBusy(false);router.refresh(); /* submissions stay busy until a fresh server view */}
  }
  return <section className="module-card" aria-labelledby="deployment-control-title">
    <p className="page-kicker">CONTROLLED DEPLOYMENT · APPROVAL LEDGER</p><h2 id="deployment-control-title">部署操作控制器</h2>
    <p>{view.enabled?'每个阶段需准确计划、动作及风险 SHA 批准；不会代批 GitHub 环境或自动重试。':'控制器尚未启用：代码已接线，待受审身份/发布绑定、数据库安装与密钥接入。此处不读取私钥、不调度或部署。'}</p>
    {view.plans.map(p=><article className="notice notice-warning" key={p.planSha256}>
      <strong>{p.mode} · {p.state}</strong><p>任务 <code>{p.jobId}</code></p>
      <p>准确范围：ca-central-1 / techlong-sandbox-tenant-9c5ee9e64509dcad；最多 {p.effects.createStackCalls} 次建栈、{p.effects.resourcesMax} 项承载资源、{p.effects.authenticatedApplicationGets} 次认证 GET。</p>
      <p>计划 <code>{p.planSha256}</code><br/>动作 <code>{p.actionSha256}</code><br/>风险版本 <code>{p.riskSha256}</code></p>
      <p>期限 {new Date(p.expiresAt).toISOString()}；源码 <code>{p.sourceCommit}</code></p>
      <a className="table-link" href={`https://github.com/veinyyxy/TechlongSoftware/blob/${p.sourceCommit}/docs/aws-auto-deployment-platform-w6b-controller-implementation.md`} target="_blank" rel="noopener noreferrer">核对该源码版本的风险说明 ↗</a>
      <p>{p.status ? `${p.status} / ${p.conclusion ?? '未结束'}`:'尚无确认的运行结果'}。{p.evidenceAttested?'已有受信证据摘要；部署结论仍需匹配业务回执。':'未有受信独立证据，不能判定部署验收通过。'}</p>
      {p.url?<a className="table-link" href={p.url} target="_blank" rel="noopener noreferrer">GitHub run {p.runId} ↗</a>:null}
      {p.state==='AWAITING_APPROVAL'?<button type="button" className="button button-dark button-small" disabled={busy || !view.enabled} onClick={()=>act('approve_and_dispatch',p)}>批准并单次调度 {p.mode}</button>:null}
      {p.runId?<button type="button" className="button button-ghost button-small" disabled={busy || !view.enabled} onClick={()=>act('observe',p)}>只读查询准确 run（保存观察结果）</button>:null}
    </article>)}
    {message?<p role="status">{message}</p>:null}
    <p>UNKNOWN 或永久槽占用后无重试按钮；查询会保存观察记录，但不批准、重跑或创建承载资源。</p>
  </section>;
}
