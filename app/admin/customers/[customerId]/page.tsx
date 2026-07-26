import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { getAdminAccount } from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import {
  appInstanceStatusLabels,
  billingIntervalLabels,
  formatDate,
  formatMoney,
  subscriptionStatusLabels,
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
              <dt>当前套餐</dt>
              <dd>
                {customer.plan
                  ? `${customer.plan.name} · ${formatMoney(
                      customer.plan.priceAmount,
                      customer.plan.currency,
                    )}/${billingIntervalLabels[customer.plan.billingInterval]}`
                  : "尚未分配"}
              </dd>
            </div>
            <div>
              <dt>订阅状态</dt>
              <dd>{subscriptionStatusLabels[customer.subscriptionStatus]}</dd>
            </div>
            <div>
              <dt>应用实例</dt>
              <dd>{appInstanceStatusLabels[customer.appInstanceStatus]}</dd>
            </div>
          </dl>
          <div className="notice notice-neutral">
            订阅与应用实例为数据库读取字段；本阶段不创建订阅、不收款，也不开通实例。
          </div>
        </section>
      </div>

      {customer.plan ? (
        <section className="data-panel plan-detail-panel">
          <div className="data-panel-heading">
            <div>
              <h2>{customer.plan.name} 套餐内容</h2>
              <p>以下功能和限制来自数据库</p>
            </div>
          </div>
          <div className="plan-content-grid">
            <div>
              <h3>功能</h3>
              {customer.plan.features.length ? (
                <ul className="value-list">
                  {customer.plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              ) : <p className="muted-copy">暂无功能描述</p>}
            </div>
            <div>
              <h3>限制</h3>
              {Object.keys(customer.plan.limits).length ? (
                <dl className="limit-list">
                  {Object.entries(customer.plan.limits).map(([key, value]) => (
                    <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
              ) : <p className="muted-copy">暂无限制配置</p>}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
