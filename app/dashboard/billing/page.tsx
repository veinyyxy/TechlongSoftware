import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutPlanButton } from "@/components/billing/CheckoutPlanButton";
import { getDashboardAccount } from "@/lib/auth/account";
import { getCustomer, listPlans } from "@/lib/admin/management";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import {
  paymentStatusLabels,
  paymentStatusTone,
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "@/lib/billing/presentation";
import { getCustomerSubscriptionNotice } from "@/lib/customer-dashboard/presentation";
import { hasStripePaymentConfiguration } from "@/lib/payments/stripe";

export const metadata: Metadata = { title: "订阅与账单" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const account = await getDashboardAccount();
  const [billing, customer, availablePlans] = await Promise.all([
    getWorkspaceBillingSummary(account.workspace.id),
    getCustomer(account.workspace.id),
    listPlans({ status: "active" }),
  ]);
  const subscription = billing.subscription;
  const onlinePaymentEnabled = hasStripePaymentConfiguration();
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
        <p>选择数据库中启用的套餐并安全跳转至 Stripe 付款页面；最终付款结果以后端记录为准。</p>
      </header>

      {subscriptionNotice ? (
        <div className={`notice notice-${subscriptionNotice.tone} billing-alert`}>
          <strong>{subscriptionNotice.title}</strong>
          <span>{subscriptionNotice.message}</span>
        </div>
      ) : !subscription ? (
        <div className="notice notice-warning billing-alert">
          <strong>尚未创建订阅</strong>
          <span>选择套餐并完成在线付款后，系统会确认订阅；餐饮订单系统仍由平台管理员手动开通。</span>
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
                <dt>记录来源</dt>
                <dd>{billing.recentPayment.provider === "stripe" ? "Stripe 在线支付" : "管理员手工记录"}</dd>
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
                      <span>{payment.provider === "stripe" ? "Stripe 在线支付" : "管理员手工记录"}</span>
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

      <section className="data-panel plan-purchase-panel">
        <div className="data-panel-heading">
          <div>
            <h2>选择套餐并在线付款</h2>
            <p>价格、币种、计费周期和功能均来自平台数据库。付款确认后会生成待开通记录，仍需管理员检查后手动开通。</p>
          </div>
        </div>
        {!onlinePaymentEnabled ? (
          <div className="empty-state">
            <strong>在线付款正在配置中</strong>
            <p>平台尚未完成 Stripe Checkout 与支付通知配置，请联系平台管理员使用现有人工付款流程。</p>
          </div>
        ) : account.membership.role !== "owner" ? (
          <div className="empty-state">
            <strong>仅工作区 Owner 可以发起付款</strong>
            <p>请联系企业工作区 Owner 选择套餐并完成付款。</p>
          </div>
        ) : availablePlans.filter((plan) => plan.priceAmount > 0).length ? (
          <div className="plan-purchase-grid">
            {availablePlans.filter((plan) => plan.priceAmount > 0).map((plan) => (
              <article className="plan-purchase-card" key={plan.id}>
                <div>
                  <h3>{plan.name}</h3>
                  <p>{plan.description || "套餐详细说明由平台管理员维护。"}</p>
                </div>
                <strong className="plan-purchase-price">
                  {formatMoney(plan.priceAmount, plan.currency)}
                  <small>/{plan.billingInterval === "year" ? "年" : "月"}</small>
                </strong>
                {plan.features.length ? (
                  <ul className="value-list">
                    {plan.features.slice(0, 4).map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                ) : null}
                <CheckoutPlanButton
                  endpoint={`/api/workspaces/${account.workspace.id}/checkout`}
                  planId={plan.id}
                  planName={plan.name}
                />
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>当前没有可在线购买的套餐</strong>
            <p>请联系平台管理员配置启用的付费套餐。</p>
          </div>
        )}
      </section>

      <div className="notice notice-neutral billing-disclaimer">
        在线付款通过 Stripe Checkout 完成；付款结果仅由支付 Webhook 写入。平台只会自动创建待开通记录，不会自动开通或部署餐饮订单系统。
        <Link href="/dashboard/billing/payment-result">查看最近一次付款返回状态</Link>
      </div>
    </>
  );
}
