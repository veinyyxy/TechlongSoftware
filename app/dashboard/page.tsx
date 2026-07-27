import type { Metadata } from "next";
import Link from "next/link";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import {
  formatDate,
  formatMoney,
} from "@/lib/admin/presentation";
import {
  paymentStatusLabels,
  subscriptionStatusLabels,
} from "@/lib/billing/presentation";
import { listWorkspaceAppInstances } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import {
  canEnterCustomerApplication,
  getCustomerServiceNotice,
  hasRecordedAccessUrl,
} from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "客户控制台" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const account = await getDashboardAccount();
  const [members, customer, billing, instances] = await Promise.all([
    listWorkspaceMembers(account.workspace.id),
    getCustomer(account.workspace.id),
    getWorkspaceBillingSummary(account.workspace.id),
    listWorkspaceAppInstances(account.workspace.id),
  ]);
  const subscription = billing.subscription;
  const recentPaymentFailed = billing.recentPayment?.status === "failed";
  const primaryInstance =
    instances.find((instance) => instance.status === "active") ??
    instances.find((instance) => instance.status === "pending") ??
    instances[0] ??
    null;
  const serviceNotice = getCustomerServiceNotice({
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    latestPaymentStatus: billing.recentPayment?.status ?? null,
    appInstanceStatus: primaryInstance?.status ?? null,
    accessUrl: primaryInstance?.accessUrl ?? null,
  });
  const canEnter = primaryInstance
    ? canEnterCustomerApplication({
        subscriptionStatus: subscription?.status ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        appInstanceStatus: primaryInstance.status,
        accessUrl: primaryInstance.accessUrl,
      })
    : false;
  const hasPrimaryAccessUrl = hasRecordedAccessUrl(primaryInstance?.accessUrl);

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">企业工作区</p>
          <h1>欢迎回来，{account.user.name}</h1>
          <p>查看 {account.workspace.name} 的套餐、账单和餐饮订单系统服务状态。</p>
        </div>
        {account.user.isPlatformAdmin ? (
          <Link className="button button-dark button-small" href="/admin">
            进入平台管理端
          </Link>
        ) : null}
      </header>

      <div className="readiness-grid">
        <article className="readiness-card">
          <small>企业名称</small>
          <strong>{account.workspace.name}</strong>
          <p>工作区状态：{account.workspace.status}</p>
        </article>
        <article className="readiness-card">
          <small>当前套餐</small>
          <strong>{subscription?.planName ?? customer?.plan?.name ?? "尚未分配"}</strong>
          <p>
            {subscription
              ? formatMoney(
                  subscription.planPriceAmount,
                  subscription.planCurrency,
                )
              : customer?.plan
                ? formatMoney(customer.plan.priceAmount, customer.plan.currency)
              : "由平台管理员维护"}
          </p>
        </article>
        <article className="readiness-card">
          <small>订阅状态</small>
          <strong>
            {subscription
              ? subscriptionStatusLabels[subscription.status]
              : "尚未创建"}
          </strong>
          <p>
            {subscription
              ? `当前周期结束：${formatDate(subscription.currentPeriodEnd)} UTC`
              : "当前周期尚未设置"}
          </p>
        </article>
        <article className="readiness-card">
          <small>最近付款状态</small>
          <strong>
            {billing.recentPayment
              ? paymentStatusLabels[billing.recentPayment.status]
              : "暂无记录"}
          </strong>
          <p>
            {billing.recentPayment
              ? formatMoney(billing.recentPayment.amount, billing.recentPayment.currency)
              : "由平台管理员手动录入"}
          </p>
        </article>
        <article className="readiness-card readiness-card-wide">
          <small>餐饮订单系统</small>
          <strong>
            {primaryInstance ? appInstanceStatusLabels[primaryInstance.status] : "尚未开通"}
          </strong>
          <p>{hasPrimaryAccessUrl ? primaryInstance?.accessUrl : "平台管理员尚未登记有效访问入口"}</p>
          {canEnter && primaryInstance ? (
            <a
              className="button button-dark button-small dashboard-entry"
              href={primaryInstance.accessUrl}
              rel="noreferrer"
              target="_blank"
            >
              进入餐饮订单系统
            </a>
          ) : null}
        </article>
      </div>

      <div className={`notice notice-${serviceNotice.tone} billing-alert`}>
        <strong>{serviceNotice.title}</strong>
        <span>{serviceNotice.message}</span>
      </div>

      {recentPaymentFailed ? (
        <div className="notice notice-danger billing-alert">
          <strong>最近付款状态：{paymentStatusLabels.failed}</strong>
          <span>请进入“订阅与账单”查看记录，并联系平台运营人员核对。</span>
        </div>
      ) : null}

      <div className="dashboard-columns">
        <section className="module-card">
          <h2>工作区服务概览</h2>
          <p>以下状态来自当前工作区的数据库记录。</p>
          <ul className="foundation-checklist">
            <li><span>工作区状态</span><span className="check-state">{account.workspace.status}</span></li>
            <li><span>我的角色</span><span className="check-state">{account.membership.role}</span></li>
            <li><span>团队成员</span><span className="check-state">{members.length}</span></li>
            <li>
              <span>应用实例</span>
              <span className={`status-pill status-${primaryInstance ? appInstanceStatusTone(primaryInstance.status) : "neutral"}`}>
                {primaryInstance
                  ? appInstanceStatusLabels[primaryInstance.status]
                  : "尚未开通"}
              </span>
            </li>
          </ul>
        </section>
        <aside className="module-card">
          <h2>订阅与付款</h2>
          <p>当前工作区可以只读查看管理员手动记录的订阅和付款状态。</p>
          <div className="notice notice-neutral">
            不支持在线付款、自动扣款或客户自行修改状态。
          </div>
          <Link className="table-link" href="/dashboard/billing">
            查看订阅与账单 →
          </Link>
          <Link className="table-link" href="/dashboard/apps">
            查看我的应用 →
          </Link>
          {primaryInstance && hasPrimaryAccessUrl ? (
            <span className="muted-copy">当前入口已由平台管理员登记。</span>
          ) : null}
        </aside>
      </div>
    </>
  );
}
