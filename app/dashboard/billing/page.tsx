import type { Metadata } from "next";
import { getDashboardAccount } from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import {
  paymentStatusLabels,
  paymentStatusTone,
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "@/lib/billing/presentation";
import { getCustomerSubscriptionNotice } from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "订阅与账单" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const account = await getDashboardAccount();
  const [billing, customer] = await Promise.all([
    getWorkspaceBillingSummary(account.workspace.id),
    getCustomer(account.workspace.id),
  ]);
  const subscription = billing.subscription;
  const latestFailed = billing.recentPayment?.status === "failed";
  const subscriptionNotice = subscription
    ? getCustomerSubscriptionNotice({
        subscriptionStatus: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
    : null;

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">SUBSCRIPTION & BILLING</p>
        <h1>订阅与账单</h1>
        <p>查看平台管理员为当前工作区记录的订阅与付款状态。</p>
      </header>

      {subscriptionNotice ? (
        <div className={`notice notice-${subscriptionNotice.tone} billing-alert`}>
          <strong>{subscriptionNotice.title}</strong>
          <span>{subscriptionNotice.message}</span>
        </div>
      ) : !subscription ? (
        <div className="notice notice-warning billing-alert">
          <strong>尚未创建订阅</strong>
          <span>平台管理员尚未为此工作区创建订阅。</span>
        </div>
      ) : null}

      {latestFailed ? (
        <div className="notice notice-danger billing-alert">
          <strong>最近一笔付款记录失败</strong>
          <span>
            金额：
            {formatMoney(
              billing.recentPayment!.amount,
              billing.recentPayment!.currency,
            )}
            。请联系平台运营人员核对付款信息。
          </span>
        </div>
      ) : null}

      <div className="detail-grid">
        <section className="module-card">
          <h2>当前订阅</h2>
          <dl className="detail-list">
            <div>
              <dt>套餐</dt>
              <dd>{subscription?.planName ?? customer?.planName ?? "尚未分配"}</dd>
            </div>
            <div>
              <dt>订阅状态</dt>
              <dd>
                {subscription ? (
                  <span
                    className={`status-pill status-${subscriptionStatusTone(
                      subscription.status,
                    )}`}
                  >
                    {subscriptionStatusLabels[subscription.status]}
                  </span>
                ) : "尚未创建"}
              </dd>
            </div>
            <div>
              <dt>当前周期</dt>
              <dd>
                {subscription
                  ? `${formatDate(subscription.currentPeriodStart)} 至 ${formatDate(
                      subscription.currentPeriodEnd,
                    )} UTC`
                  : "尚未设置"}
              </dd>
            </div>
            <div>
              <dt>到期处理</dt>
              <dd>
                {subscription
                  ? subscription.cancelAtPeriodEnd
                    ? "当前周期结束后取消"
                    : "未设置到期取消"
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="module-card">
          <h2>最近付款</h2>
          {billing.recentPayment ? (
            <dl className="detail-list">
              <div>
                <dt>金额</dt>
                <dd>
                  {formatMoney(
                    billing.recentPayment.amount,
                    billing.recentPayment.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>付款状态</dt>
                <dd>
                  <span
                    className={`status-pill status-${paymentStatusTone(
                      billing.recentPayment.status,
                    )}`}
                  >
                    {paymentStatusLabels[billing.recentPayment.status]}
                  </span>
                </dd>
              </div>
              <div>
                <dt>付款方式</dt>
                <dd>{billing.recentPayment.paymentMethod}</dd>
              </div>
              <div>
                <dt>记录时间</dt>
                <dd>{formatDate(billing.recentPayment.createdAt)} UTC</dd>
              </div>
            </dl>
          ) : (
            <div className="empty-state compact-empty">
              <strong>尚无付款记录</strong>
              <p>付款状态将由平台管理员手动录入。</p>
            </div>
          )}
        </section>
      </div>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>付款记录</h2>
            <p>仅显示当前工作区的数据</p>
          </div>
        </div>
        {billing.payments.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>金额</th><th>状态</th><th>付款方式</th><th>付款时间</th></tr>
              </thead>
              <tbody>
                {billing.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatMoney(payment.amount, payment.currency)}</td>
                    <td>
                      <span className={`status-pill status-${paymentStatusTone(payment.status)}`}>
                        {paymentStatusLabels[payment.status]}
                      </span>
                    </td>
                    <td>
                      <strong>{payment.paymentMethod}</strong>
                      <span>{payment.reference ?? "无参考号"}</span>
                    </td>
                    <td>
                      {payment.paidAt
                        ? `${formatDate(payment.paidAt)} UTC`
                        : "尚未付款"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>尚无付款记录</strong>
            <p>这里不会提供客户修改或自行标记付款的操作。</p>
          </div>
        )}
      </section>

      <div className="notice notice-neutral billing-disclaimer">
        本页面显示的是管理员手动维护的记录，不代表已接入在线支付、自动扣款或发票系统。
      </div>
    </>
  );
}
