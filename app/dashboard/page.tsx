import type { Metadata } from "next";
import Link from "next/link";
import { getDashboardAccount } from "@/lib/auth/account";
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
  const [customer, billing, instances] = await Promise.all([
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
  const hasSellerApkUrl = hasRecordedAccessUrl(primaryInstance?.sellerApkUrl);
  const canDownloadSellerApk = primaryInstance
    ? canEnterCustomerApplication({
        subscriptionStatus: subscription?.status ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        appInstanceStatus: primaryInstance.status,
        accessUrl: primaryInstance.sellerApkUrl,
      })
    : false;
  const planName = subscription?.planName ?? customer?.plan?.name ?? "尚未分配";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">订阅服务中心</p>
          <h1>我的订阅与服务</h1>
          <p>查看当前套餐、订阅状态，以及餐饮订单系统的买家端和卖家端入口。</p>
        </div>
        {account.user.isPlatformAdmin ? (
          <Link className="button button-dark button-small" href="/admin">
            进入平台管理端
          </Link>
        ) : null}
      </header>

      <div className="readiness-grid">
        <article className="readiness-card">
          <small>订阅套餐</small>
          <strong>{planName}</strong>
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
        <article className="readiness-card readiness-card-wide">
          <small>买家端入口地址</small>
          <strong>{canEnter ? "买家端已开放" : "暂不可用"}</strong>
          <p>{hasPrimaryAccessUrl ? primaryInstance?.accessUrl : "平台管理员尚未登记买家端入口"}</p>
          {canEnter && primaryInstance ? (
            <a
              className="button button-dark button-small dashboard-entry"
              href={primaryInstance.accessUrl}
              rel="noreferrer"
              target="_blank"
            >
              进入买家端
            </a>
          ) : null}
        </article>
        <article className="readiness-card readiness-card-wide">
          <small>卖家端 APK 下载地址</small>
          <strong>{canDownloadSellerApk ? "卖家端可下载" : "暂不可用"}</strong>
          <p>{hasSellerApkUrl ? primaryInstance?.sellerApkUrl : "平台管理员尚未登记卖家端 APK 地址"}</p>
          {canDownloadSellerApk && primaryInstance ? (
            <a
              className="button button-dark button-small dashboard-entry"
              href={primaryInstance.sellerApkUrl}
              rel="noreferrer"
              target="_blank"
            >
              下载卖家端 APK
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
          <h2>订阅服务概览</h2>
          <p>以下套餐、付款和应用状态均来自平台后台记录。</p>
          <ul className="foundation-checklist">
            <li><span>订阅套餐</span><span className="check-state">{planName}</span></li>
            <li>
              <span>订阅状态</span>
              <span className="check-state">
                {subscription ? subscriptionStatusLabels[subscription.status] : "尚未创建"}
              </span>
            </li>
            <li>
              <span>最近付款</span>
              <span className="check-state">
                {billing.recentPayment
                  ? `${paymentStatusLabels[billing.recentPayment.status]} · ${formatMoney(
                      billing.recentPayment.amount,
                      billing.recentPayment.currency,
                    )}`
                  : "暂无记录"}
              </span>
            </li>
            <li>
              <span>订阅系统</span>
              <span className={`status-pill status-${primaryInstance ? appInstanceStatusTone(primaryInstance.status) : "neutral"}`}>
                {primaryInstance
                  ? appInstanceStatusLabels[primaryInstance.status]
                  : "尚未开通"}
              </span>
            </li>
          </ul>
        </section>
        <aside className="module-card">
          <h2>管理我的订阅</h2>
          <p>查看套餐明细、计费周期和付款记录，或进入应用详情查看服务状态。</p>
          <div className="notice notice-neutral">
            付款完成后，平台管理员会检查并开通餐饮订单系统；买家端入口和卖家端 APK 将在这里更新。
          </div>
          <Link className="table-link" href="/dashboard/billing">
            查看订阅与账单 →
          </Link>
          <Link className="table-link" href="/dashboard/apps">
            查看我的应用 →
          </Link>
        </aside>
      </div>
    </>
  );
}
