import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { formatDate } from "@/lib/admin/presentation";
import { getAdminAccount } from "@/lib/auth/account";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import { getAppInstance } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";

export const metadata: Metadata = { title: "应用实例详情" };
export const dynamic = "force-dynamic";

interface InstanceDetailPageProps {
  params: Promise<{ instanceId: string }>;
}

export default async function InstanceDetailPage({ params }: InstanceDetailPageProps) {
  await getAdminAccount();
  const { instanceId } = await params;
  const instance = await getAppInstance(instanceId);

  if (!instance) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该应用实例</strong>
        <Link className="button button-dark button-small" href="/admin/instances">
          返回应用实例列表
        </Link>
      </section>
    );
  }

  const subscriptionIsActive = instance.subscriptionStatus === "active";
  const canActivate = subscriptionIsActive && instance.status !== "active";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">APP INSTANCE DETAIL</p>
          <h1>{instance.name}</h1>
          <p>
            <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
              {appInstanceStatusLabels[instance.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <Link className="button button-ghost button-small" href={`/admin/instances/${instance.id}/edit`}>
            编辑实例
          </Link>
          {instance.status === "active" ? (
            <StatusActionButton
              confirmMessage={`确认暂停“${instance.name}”吗？客户侧将不能再进入该应用。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label="暂停实例"
              nextStatus="suspended"
              tone="danger"
            />
          ) : canActivate ? (
            <StatusActionButton
              confirmMessage={`确认将“${instance.name}”标记为已开通吗？这只更新平台记录，不会执行真实部署。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label={instance.status === "suspended" ? "恢复实例" : "标记为已开通"}
              nextStatus="active"
            />
          ) : null}
        </div>
      </header>

      {!subscriptionIsActive ? (
        <div className="notice notice-danger billing-alert">
          <strong>关联订阅不是有效状态</strong>
          <span>只有有效订阅的客户才允许把实例标记为已开通。请先处理客户订阅，再恢复此实例。</span>
        </div>
      ) : null}

      <div className="detail-grid">
        <section className="module-card">
          <h2>客户与产品</h2>
          <dl className="detail-list">
            <div><dt>企业客户</dt><dd>{instance.workspaceName}</dd></div>
            <div><dt>产品</dt><dd>{instance.productName}</dd></div>
            <div><dt>路径标识</dt><dd><code>{instance.slug}</code></dd></div>
            <div><dt>域名或路径</dt><dd>{instance.domain ?? "未填写"}</dd></div>
            <div><dt>租户标识</dt><dd><code>{instance.tenantKey}</code></dd></div>
          </dl>
        </section>
        <section className="module-card">
          <h2>开通记录</h2>
          <dl className="detail-list">
            <div><dt>实例状态</dt><dd>{appInstanceStatusLabels[instance.status]}</dd></div>
            <div><dt>关联订阅</dt><dd>{instance.subscriptionStatus ? subscriptionStatusLabels[instance.subscriptionStatus] : "未关联"}</dd></div>
            <div><dt>首次开通时间</dt><dd>{instance.provisionedAt ? `${formatDate(instance.provisionedAt)} UTC` : "尚未开通"}</dd></div>
            <div><dt>暂停时间</dt><dd>{instance.suspendedAt ? `${formatDate(instance.suspendedAt)} UTC` : "—"}</dd></div>
            <div><dt>最后更新</dt><dd>{formatDate(instance.updatedAt)} UTC</dd></div>
          </dl>
          <div className="notice notice-neutral">
            这是管理员手动维护的实例记录，不包含部署日志、自动发布或云资源操作。
          </div>
        </section>
      </div>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>客户访问入口</h2>
            <p>入口地址直接来自管理员保存的 access_url。</p>
          </div>
          <a className="button button-dark button-small" href={instance.accessUrl} rel="noreferrer" target="_blank">
            打开入口
          </a>
        </div>
        <div className="instance-url-value">{instance.accessUrl}</div>
      </section>
    </>
  );
}
