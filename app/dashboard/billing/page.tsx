import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutSubscriptionButton } from "@/components/billing/CheckoutSubscriptionButton";
import { getPlan } from "@/lib/admin/management";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
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
  const billing = await getWorkspaceBillingSummary(account.workspace.id);
  const currentSubscriptions = billing.currentSubscriptions;
  const historicalSubscriptions = billing.historicalSubscriptions;
  const plans = await Promise.all(
    currentSubscriptions.map((subscription) => getPlan(subscription.planId)),
  );
  const planById = new Map(
    plans
      .filter((plan) => plan !== null)
      .map((plan) => [plan.id, plan]),
  );
  const onlinePaymentEnabled = hasStripePaymentConfiguration();
  const latestFailed = billing.recentPayment?.status === "failed";

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">SUBSCRIPTION & BILLING</p>
        <h1>订阅与账单</h1>
        <p>按产品查看当前订阅、历史订阅和付款记录。历史记录不会因重新订阅而删除。</p>
      </header>

      {!currentSubscriptions.length ? (
        <div className="notice notice-warning billing-alert">
          <strong>暂无当前订阅</strong>
          <span>请联系平台管理员为需要的产品创建新订阅。</span>
        </div>
      ) : (
        currentSubscriptions.map((subscription) => {
          const notice = getCustomerSubscriptionNotice({
            productName: subscription.productName,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
          });
          return notice ? (
            <div
              className={`notice notice-${notice.tone} billing-alert`}
              key={`notice-${subscription.id}`}
            >
              <strong>{subscription.productName}：{notice.title}</strong>
              <span>{notice.message}</span>
            </div>
          ) : null;
        })
      )}

      {latestFailed ? (
        <div className="notice notice-danger billing-alert">
          <strong>最近一笔付款记录失败</strong>
          <span>
            {billing.recentPayment?.productName
              ? `${billing.recentPayment.productName} · `
              : ""}
            金额：
            {formatMoney(
              billing.recentPayment!.amount,
              billing.recentPayment!.currency,
            )}
            。请联系平台运营人员核对付款信息。
          </span>
        </div>
      ) : null}

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>当前订阅</h2>
            <p>每个产品同一时间最多显示一条当前订阅</p>
          </div>
        </div>
        {currentSubscriptions.length ? (
          <div className="app-instance-grid">
            {currentSubscriptions.map((subscription) => {
              const plan = planById.get(subscription.planId) ?? null;
              const payable =
                subscription.status === "manual_pending" ||
                subscription.status === "past_due";
              const purchasablePlan =
                plan?.status === "active" && plan.priceAmount > 0;
              return (
                <article className="app-instance-card" key={subscription.id}>
                  <div className="app-instance-card-heading">
                    <div>
                      <p className="page-kicker">{subscription.productName}</p>
                      <h2>{subscription.planName}</h2>
                    </div>
                    <span
                      className={`status-pill status-${subscriptionStatusTone(
                        subscription.status,
                      )}`}
                    >
                      {subscriptionStatusLabels[subscription.status]}
                    </span>
                  </div>
                  <dl className="app-instance-summary">
                    <div>
                      <dt>产品状态</dt>
                      <dd>{subscription.productStatus === "active" ? "已启用" : "已停用"}</dd>
                    </div>
                    <div>
                      <dt>套餐价格</dt>
                      <dd>
                        {formatMoney(
                          subscription.planPriceAmount,
                          subscription.planCurrency,
                        )}
                        /{subscription.planBillingInterval === "year" ? "年" : "月"}
                      </dd>
                    </div>
                    <div>
                      <dt>当前周期</dt>
                      <dd>
                        {formatDate(subscription.currentPeriodStart)} 至{" "}
                        {formatDate(subscription.currentPeriodEnd)} UTC
                      </dd>
                    </div>
                    <div>
                      <dt>到期处理</dt>
                      <dd>{subscription.cancelAtPeriodEnd ? "周期结束后取消" : "继续保留"}</dd>
                    </div>
                  </dl>

                  {plan?.features.length ? (
                    <ul className="value-list">
                      {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                  ) : null}

                  {payable && subscription.productStatus !== "active" ? (
                    <div className="notice notice-danger compact-notice">
                      当前产品已停用，不能发起在线付款，请联系平台管理员。
                    </div>
                  ) : payable && !plan ? (
                    <div className="notice notice-danger compact-notice">
                      当前套餐暂不可用，请联系平台管理员检查配置。
                    </div>
                  ) : payable && !purchasablePlan ? (
                    <div className="notice notice-warning compact-notice">
                      当前套餐已停用或无需在线付款，请联系平台管理员确认付款方式。
                    </div>
                  ) : payable && !onlinePaymentEnabled ? (
                    <div className="notice notice-warning compact-notice">
                      Stripe 在线付款正在配置中，请暂时使用人工付款流程。
                    </div>
                  ) : payable && account.membership.role !== "owner" ? (
                    <div className="notice notice-warning compact-notice">
                      仅工作区 Owner 可以发起在线付款。
                    </div>
                  ) : payable && plan && purchasablePlan ? (
                    <CheckoutSubscriptionButton
                      endpoint={`/api/workspaces/${account.workspace.id}/checkout`}
                      planName={`${subscription.productName} · ${plan.name}`}
                      subscriptionId={subscription.id}
                    />
                  ) : (
                    <div className="notice notice-neutral compact-notice">
                      当前状态无需发起在线付款。
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>等待平台管理员设置订阅</strong>
            <p>管理员可以在保留历史记录的同时，为产品创建新的订阅。</p>
          </div>
        )}
      </section>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>历史订阅</h2>
            <p>结束的订阅仅供查看，不会被物理删除</p>
          </div>
        </div>
        {historicalSubscriptions.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>产品</th><th>套餐</th><th>状态</th><th>周期</th></tr>
              </thead>
              <tbody>
                {historicalSubscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td><strong>{subscription.productName}</strong></td>
                    <td>{subscription.planName}</td>
                    <td>
                      <span className={`status-pill status-${subscriptionStatusTone(subscription.status)}`}>
                        {subscriptionStatusLabels[subscription.status]}
                      </span>
                    </td>
                    <td>{formatDate(subscription.currentPeriodStart)} 至 {formatDate(subscription.currentPeriodEnd)} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>暂无历史订阅</strong>
            <p>取消订阅后，记录会继续保留在这里。</p>
          </div>
        )}
      </section>

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
                <tr><th>产品与套餐</th><th>金额</th><th>状态</th><th>付款方式</th><th>付款时间</th></tr>
              </thead>
              <tbody>
                {billing.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <strong>{payment.productName ?? "未关联产品"}</strong>
                      <span>{payment.planName ?? "未关联订阅"}</span>
                    </td>
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
                    <td>{payment.paidAt ? `${formatDate(payment.paidAt)} UTC` : "尚未付款"}</td>
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
        在线付款通过 Stripe Checkout 完成；付款结果仅由支付 Webhook 写入。平台只会准备待开通记录，不会自动部署应用。
        <Link href="/dashboard/billing/payment-result">查看最近一次付款返回状态</Link>
      </div>
    </>
  );
}
