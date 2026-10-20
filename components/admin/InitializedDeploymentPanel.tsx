"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { projectInitializedDeployment } from '@/lib/deployments/initialized-platform-request-v1';
type View = ReturnType<typeof projectInitializedDeployment>['view']&{reviewedRequest?:{clientRequestId:string;jobId:string;expiresAt:number}|null};
const utc = (v: number) => new Date(v).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
export function InitializedDeploymentPanel({ instanceId, deploymentId, view }: { instanceId: string; deploymentId: string; view: View }) {
  const router = useRouter(), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fallbackRequestId] = useState(() => crypto.randomUUID());
  const clientRequestId=view.reviewedRequest?.clientRequestId??fallbackRequestId;
  if (!view.supported) return null;
  async function submit() {
    if (!view.canRequest || pending || submitted || !window.confirm('仅创建一个待审恢复请求，不创建 AWS 资源。具体执行清单仍需另行批准。是否继续？')) return;
    setPending(true); setSubmitted(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/instances/${encodeURIComponent(instanceId)}/initialized-deployment`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientRequestId, deploymentId, intent: 'restore_initialized_workload' }),
      });
      const result = await response.json();
      setMessage(response.ok ? '待审请求已登记，尚未授权云执行。' : result.error?.message ?? '结果需要核对，请刷新列表。');
      router.refresh();
    } catch { setMessage('提交结果未知。请刷新列表核对，不要再次点击或更换请求标识。'); }
    finally { setPending(false); }
  }
  const labels = { awaiting_review: '待审（不会被普通队列领取）', running: '运行中', succeeded: '已完成', stopped: '已停止／需核对' };
  return <section className="module-card">
    <h2>已初始化租户 · 受控承载</h2>
    <div className={`notice ${view.state === 'expired' ? 'notice-warning' : 'notice-neutral'}`}>
      <strong>{view.state === 'verified_window_open' ? '最近一次单任务验收通过，固定承载窗口未到期' : view.state === 'expired' ? '固定承载窗口已到期' : '缺少可匹配的受控验收回执'}</strong>
      <span>这是已保存回执，不是实时 AWS 健康探测。到期不代表资源已清理或全部停费；实例历史 ready 状态不会在这里改写。</span>
    </div>
    {view.latest ? <dl className="detail-list">
      <div><dt>本次任务</dt><dd><code>{view.latest.jobId}</code></dd></div>
      <div><dt>最近认证回读</dt><dd>{utc(view.latest.checkedAt)}</dd></div>
      <div><dt>固定到期</dt><dd>{utc(view.latest.expiresAt)}</dd></div>
      <div><dt>准确承载栈</dt><dd><code>{view.latest.stackId}</code></dd></div>
      <div><dt>实际镜像</dt><dd><code>{view.latest.imageRevision}</code></dd></div>
    </dl> : null}
    <p>{view.reason}</p>
    {view.reviewedRequest?<p>本窗口仅登记固定任务 <code>{view.reviewedRequest.jobId}</code>；截止 {utc(view.reviewedRequest.expiresAt)}。刷新不会更换请求标识；报错或结果不明请勿重试。</p>:null}
    <button className="button button-dark button-small" type="button" onClick={submit} disabled={!view.canRequest || pending || submitted}>
      {pending ? '登记中…' : '创建待审恢复请求'}
    </button>
    {message ? <p role="status">{message}</p> : null}
    {view.jobs.length ? <ul>{view.jobs.map(j => <li key={j.id}><code>{j.id}</code> · {labels[j.phase]}</li>)}</ul> : null}
    <p>请求入口{view.requestGateEnabled ? '已开启' : '默认关闭，待单独批准'}；具体清单批准与单次 worker 仍是独立步骤。全局自动队列未开启。</p>
  </section>;
}
