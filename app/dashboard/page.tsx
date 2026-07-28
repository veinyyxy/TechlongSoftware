import type { Metadata } from "next";
import Link from "next/link";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";
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
  selectCurrentProductSubscription,
} from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "客户控制台" };
export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams?: Promise<{ product?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const account = await getDashboardAccount();
  const [members, billing, instances] = await Promise.all([
    listWorkspaceMembers(account.workspace.id),
    getWorkspaceBillingSummary(account.workspace.id),
    listWorkspaceAppInstances(account.workspace.id),
  ]);
  const requestedProductId = (await searchParams)?.product ?? "";
  const subscription = selectCurrentProductSubscription(
    billing.currentSubscriptions,
    requestedProductId,
  );
  const selectedProductId =
    subscription?.productId ??
    instances.find((instance) => instance.productId === requestedProductId)?.productId ??
    instances[0]?.productId ??
    null;
  const recentPayment =
    billing.payments.find(
      (payment) => payment.subscriptionId === subscription?.id,
    ) ?? null;
  const recentPaymentFailed = recentPayment?.status === "failed";
  const primaryInstance =
    instances.find(
      (instance) =>
        instance.productId === selectedProductId && instance.status === "active",
    ) ??
    instances.find(
      (instance) =>
        instance.productId === selectedProductId && instance.status === "pending",
    ) ??
    instances.find((instance) => instance.productId === selectedProductId) ??
    null;
  const serviceNotice = getCustomerServiceNotice({
    productName: subscription?.productName ?? primaryInstance?.productName ?? null,
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    latestPaymentStatus: recentPayment?.status ?? null,
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
  const selectedProductName =
    subscription?.productName ?? primaryInstance?.productName ?? "应用系统";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">企业工作区</p>
          <h1>欢迎回来，{account.user.name}</h1>
          <p>查看 {account.workspace.name} 的产品订阅、账单和应用服务状态。</p>
        </div>
        {account.user.isPlatformAdmin ? (
          <Link className="button button-dark button-small" href="/admin">
            进入平台管理端
          </Link>
        ) : null}
      </header>

      {billing.currentSubscriptions.length > 1 ? (
        <nav aria-label="订阅产品切换" className="header-actions">
          {billing.currentSubscriptions.map((item) => (
            <Link
              className={`button button-small ${
                item.productId === selectedProductId ? "button-dark" : "button-ghost"
              }`}
              href={`/dashboard?product=${encodeURIComponent(item.productId)}`}
              key={item.productId}
            >
              {item.productName}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="readiness-grid">
        <article className="readiness-card">
          <small>企业名称</small>
          <strong>{account.workspace.name}</strong>
          <p>工作区状态：{account.workspace.status}</p>
        </article>
        <article className="readiness-card">
          <small>当前套餐</small>
          <strong>{subscription?.planName ?? "尚未分配"}</strong>
          <p>
            {subscription
              ? formatMoney(
                  subscription.planPriceAmount,
                  subscription.planCurrency,
                )
              : "由平台管理员按产品维护"}
          </p>
          {subscription ? (
            <p>{subscription.productName} · 产品{subscription.productStatus === "active" ? "已启用" : "已停用"}</p>
          ) : null}
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
            {recentPayment
              ? paymentStatusLabels[recentPayment.status]
              : "暂无记录"}
          </strong>
          <p>
            {recentPayment
              ? formatMoney(recentPayment.amount, recentPayment.currency)
              : "尚无付款记录"}
          </p>
        </article>
        <article className="readiness-card readiness-card-wide">
          <small>{selectedProductName}</small>
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
              进入{selectedProductName}
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
          <p>当前工作区可查看订阅、手动付款记录和已验证的 Stripe 在线付款状态。</p>
          <div className="notice notice-neutral">
            可从“订阅与账单”查看管理员配置的订阅和套餐选项，并进入安全付款页面；应用实例仍由平台管理员手动开通。
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
