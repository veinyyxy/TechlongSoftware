import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { getAdminAccount } from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import { listWorkspaceAppInstances } from "@/lib/instances/management";
import {
  appInstanceStatusLabels as instanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import { subscriptionStatusLabels as billingStatusLabels } from "@/lib/billing/presentation";
import {
  appInstanceStatusLabels,
  formatDate,
  formatMoney,
  workspaceStatusLabels,
} from "@/lib/admin/presentation";

export const metadata: Metadata = { title: "客户详情" };
export const dynamic = "force-dynamic";

interface CustomerDetailPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  await getAdminAccount();
  const { customerId } = await params;
  const customer = await getCustomer(customerId);

  if (!customer) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该客户</strong>
        <p>客户可能已被移除，或链接不正确。</p>
        <Link className="button button-dark button-small" href="/admin/customers">
          返回客户列表
        </Link>
      </section>
    );
  }

  const isActive = customer.status === "active";
  const [billing, instances] = await Promise.all([
    getWorkspaceBillingSummary(customer.id),
    listWorkspaceAppInstances(customer.id),
  ]);

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">CUSTOMER DETAIL</p>
          <h1>{customer.name}</h1>
          <p>
            工作区状态：
            <span className={`status-pill status-${customer.status}`}>
              {workspaceStatusLabels[customer.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <Link
            className="button button-ghost button-small"
            href={`/admin/customers/${customer.id}/edit`}
          >
            编辑资料
          </Link>
          <StatusActionButton
            confirmMessage={
              isActive
                ? `确认暂停“${customer.name}”吗？暂停后客户将不能进入工作区后台。`
                : `确认恢复“${customer.name}”吗？恢复后客户可重新进入工作区后台。`
            }
            endpoint={`/api/admin/customers/${customer.id}`}
            label={isActive ? "暂停客户" : "恢复客户"}
            nextStatus={isActive ? "suspended" : "active"}
            tone={isActive ? "danger" : "default"}
          />
        </div>
      </header>

      <div className="detail-grid">
        <section className="module-card">
          <h2>企业资料</h2>
          <dl className="detail-list">
            <div><dt>企业名称</dt><dd>{customer.name}</dd></div>
            <div><dt>联系人</dt><dd>{customer.contactName}</dd></div>
            <div><dt>联系邮箱</dt><dd>{customer.contactEmail}</dd></div>
            <div>
              <dt>Owner 账号</dt>
              <dd>{customer.ownerName}<br />{customer.ownerEmail}</dd>
            </div>
            <div><dt>团队成员</dt><dd>{customer.memberCount}</dd></div>
            <div><dt>创建时间</dt><dd>{formatDate(customer.createdAt)} UTC</dd></div>
          </dl>
        </section>

        <section className="module-card">
          <h2>服务状态</h2>
          <dl className="detail-list">
            <div>
              <dt>当前订阅</dt>
              <dd>{billing.currentSubscriptions.length} 个产品</dd>
            </div>
            <div>
              <dt>历史订阅</dt>
              <dd>{billing.historicalSubscriptions.length} 条记录</dd>
            </div>
            <div>
              <dt>应用实例</dt>
              <dd>{instances.length ? `${instances.length} 个已登记实例` : appInstanceStatusLabels[customer.appInstanceStatus]}</dd>
            </div>
          </dl>
          <div className="notice notice-neutral">
            订阅和应用实例由平台管理员维护；Stripe 只确认付款，不会触发自动部署。
          </div>
          <Link className="table-link" href={`/admin/subscriptions/new?workspaceId=${encodeURIComponent(customer.id)}`}>
            为客户创建订阅 →
          </Link>
        </section>
      </div>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>当前订阅</h2>
            <p>按产品显示；同一产品最多一条当前订阅</p>
          </div>
          <Link className="table-link" href={`/admin/subscriptions/new?workspaceId=${encodeURIComponent(customer.id)}`}>
            创建订阅
          </Link>
        </div>
        {billing.currentSubscriptions.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>产品</th><th>套餐</th><th>状态</th><th>当前周期</th><th>操作</th></tr>
              </thead>
              <tbody>
                {billing.currentSubscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td><strong>{subscription.productName}</strong><span>{subscription.productSlug}</span></td>
                    <td><strong>{subscription.planName}</strong><span>{formatMoney(subscription.planPriceAmount, subscription.planCurrency)}</span></td>
                    <td>{billingStatusLabels[subscription.status]}</td>
                    <td>{formatDate(subscription.currentPeriodStart)} 至 {formatDate(subscription.currentPeriodEnd)} UTC</td>
                    <td><Link className="table-link" href={`/admin/subscriptions/${subscription.id}`}>查看详情</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>暂无当前订阅</strong>
            <p>可以为该客户创建新的产品订阅。</p>
          </div>
        )}
      </section>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>历史订阅</h2>
            <p>取消后的订阅不会被删除</p>
          </div>
        </div>
        {billing.historicalSubscriptions.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>产品</th><th>套餐</th><th>状态</th><th>周期</th><th>操作</th></tr>
              </thead>
              <tbody>
                {billing.historicalSubscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td><strong>{subscription.productName}</strong></td>
                    <td>{subscription.planName}</td>
                    <td>{billingStatusLabels[subscription.status]}</td>
                    <td>{formatDate(subscription.currentPeriodStart)} 至 {formatDate(subscription.currentPeriodEnd)} UTC</td>
                    <td><Link className="table-link" href={`/admin/subscriptions/${subscription.id}`}>查看历史</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>暂无历史订阅</strong>
            <p>取消订阅后，记录会保留在这里。</p>
          </div>
        )}
      </section>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>应用实例</h2>
            <p>客户各产品对应的应用入口</p>
          </div>
          <Link className="table-link" href="/admin/instances/new">
            补建遗漏实例
          </Link>
        </div>
        {instances.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>实例</th><th>状态</th><th>访问地址</th><th>操作</th></tr>
              </thead>
              <tbody>
                {instances.map((instance) => (
                  <tr key={instance.id}>
                    <td>
                      <strong>{instance.name}</strong>
                      <span>{instance.tenantKey}</span>
                    </td>
                    <td>
                      <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
                        {instanceStatusLabels[instance.status]}
                      </span>
                    </td>
                    <td>{instance.accessUrl}</td>
                    <td>
                      <Link className="table-link" href={`/admin/instances/${instance.id}`}>
                        查看详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>尚未创建应用实例</strong>
            <p>创建实例后，客户可以在“我的应用”中看到对应入口。</p>
          </div>
        )}
      </section>

    </>
  );
}
