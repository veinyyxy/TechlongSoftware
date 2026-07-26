import type { Metadata } from "next";
import Link from "next/link";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import {
  appInstanceStatusLabels,
  formatMoney,
} from "@/lib/admin/presentation";
import {
  paymentStatusLabels,
  subscriptionStatusLabels,
} from "@/lib/billing/presentation";

export const metadata: Metadata = { title: "客户控制台" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const account = await getDashboardAccount();
  const [members, customer, billing] = await Promise.all([
    listWorkspaceMembers(account.workspace.id),
    getCustomer(account.workspace.id),
    getWorkspaceBillingSummary(account.workspace.id),
  ]);
  const subscription = billing.subscription;
  const subscriptionIsActive = subscription?.status === "active";
  const recentPaymentFailed = billing.recentPayment?.status === "failed";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">企业工作区</p>
          <h1>欢迎回来，{account.user.name}</h1>
          <p>查看当前工作区、套餐与服务状态。</p>
        </div>
        {account.user.isPlatformAdmin ? (
          <Link className="button button-dark button-small" href="/admin">
            进入平台管理端
          </Link>
        ) : null}
      </header>

      <div className="readiness-grid">
        <article className="readiness-card">
          <small>当前工作区</small>
          <strong>{account.workspace.name}</strong>
          <p>状态：{account.workspace.status}</p>
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
          <p>由平台管理员手动维护。</p>
        </article>
      </div>

      {!subscriptionIsActive ? (
        <div className="notice notice-danger billing-alert">
          <strong>订阅当前不是有效状态</strong>
          <span>
            {subscription
              ? `当前状态：${subscriptionStatusLabels[subscription.status]}。`
              : "尚未创建订阅。"}
            请联系平台运营人员。
          </span>
        </div>
      ) : null}

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
              <span className="check-state pending">
                {customer
                  ? appInstanceStatusLabels[customer.appInstanceStatus]
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
        </aside>
      </div>
    </>
  );
}
