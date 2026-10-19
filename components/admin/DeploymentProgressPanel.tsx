"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DeploymentProgressView } from '@/lib/deployments/deployment-progress-v1';
import { deploymentWindowLabel } from '@/lib/deployments/deployment-progress-v1';

const utc = (v: number) => new Date(v).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
export function DeploymentProgressPanel({ view }: { view: DeploymentProgressView | null }) {
  const router = useRouter(), [clock, setClock] = useState({ asOf: view?.asOf, elapsed: 0 });
  useEffect(() => {
    if (!view?.asOf) return;
    const asOf = view.asOf;
    const start = performance.now();
    const timer = setInterval(() => setClock({ asOf, elapsed: Math.max(0, performance.now() - start) }), 1000);
    return () => clearInterval(timer);
  }, [view?.asOf]);
  if (!view) return null;
  // Server snapshot + monotonic elapsed time; this display never authorizes execution.
  const now = view.asOf + (clock.asOf === view.asOf ? Math.floor(clock.elapsed) : 0), archive = view.archive;
  return <section className="module-card deployment-progress" aria-labelledby="deployment-progress-title">
    <div className="deployment-progress-heading">
      <div><p className="page-kicker">CONTROLLED CLOUD DEPLOYMENT · READ ONLY</p><h2 id="deployment-progress-title">部署进度与验收</h2></div>
      <button className="button button-ghost button-small" type="button" onClick={() => router.refresh()}>刷新平台记录</button>
    </div>
    <div className={`notice ${view.state === 'verified' ? 'notice-neutral' : 'notice-warning'}`}>
      <strong>{view.title}</strong><span>{view.description}</span>
    </div>
    <p>当前任务：<code>{view.currentJobId ?? '无法安全确定'}</code> · 平台记录读取于 {utc(view.asOf)}</p>
    <ol className="deployment-progress-steps" aria-label="受控部署阶段">
      {view.steps.map((step, index) => <li key={step.mode} data-stage-status={step.status}>
        <span className="deployment-progress-number" aria-hidden="true">{index + 1}</span>
        <div><strong>{step.mode === 'Review' ? '云计划审阅' : step.mode === 'RunOnce' ? '实际部署' : '独立验收'}</strong>
          <p>{step.detail}</p>{step.url ? <a className="table-link" href={step.url} target="_blank" rel="noopener noreferrer">GitHub run {step.runId} ↗</a> : null}</div>
      </li>)}
    </ol>
    {archive ? <div className="deployment-progress-archive">
      <h3>{archive.isCurrentJob ? '匹配本次任务的归档证据' : '上次验收归档（不是新任务授权）'}</h3>
      {!archive.isCurrentJob ? <p><code>{archive.jobId}</code> · 新任务不能沿用这些运行或批准 SHA。</p> : null}
      <p>承载标签到期：{utc(archive.expiresAt)} · <span aria-live="off">{deploymentWindowLabel(archive.expiresAt, now)}</span></p>
      <p>倒计时只反映标签时间，不是审批窗口、实时健康或自动停费保证。此页不读取 GitHub 实时审批状态或调用 AWS。</p>
      <details><summary>查看证据摘要与历史运行</summary>
        <dl className="detail-list">
          <div><dt>归档日期</dt><dd>{archive.archivedDate}</dd></div>
          <div><dt>执行代码</dt><dd><code>{archive.sourceCommit}</code></dd></div>
          <div><dt>云计划 SHA</dt><dd><code>{archive.cloudManifestSha256}</code></dd></div>
          <div><dt>完成回执 SHA</dt><dd><code>{archive.receiptSha256}</code></dd></div>
          <div><dt>独立验收 SHA</dt><dd><code>{archive.inspectBodySha256}</code></dd></div>
          {archive.stages.map(s => <div key={s.mode}><dt>{s.mode} 批准</dt><dd>
            <a className="table-link" href={s.url} target="_blank" rel="noopener noreferrer">run {s.runId}</a><br /><code>{s.approvalSha256}</code>
          </dd></div>)}
        </dl>
      </details>
    </div> : <p>暂无与当前数据库回执匹配的独立验收归档；不会用旧成功记录替代。</p>}
    <p className="deployment-progress-boundary">只读面板：不创建或领取任务、不调度或批准 GitHub、不重试、续期或清理资源。新执行仍需 fresh 清单批准，全局自动队列未开启。</p>
  </section>;
}
