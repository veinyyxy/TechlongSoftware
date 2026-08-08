import type { Metadata } from "next";
import Link from "next/link";
import { CancelAtPeriodEndButton } from "@/components/billing/CancelAtPeriodEndButton";
import { CheckoutSubscriptionButton } from "@/components/billing/CheckoutSubscriptionButton";
import { PendingPurchaseOrderActions } from "@/components/billing/PendingPurchaseOrderActions";
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
import {
  listPurchaseOrders,
  reconcileWorkspaceExpiredSubscriptions,
} from "@/lib/purchases/management";

export const metadata: Metadata = { title: "订阅与账单" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const account = await getDashboardAccount();
  await reconcileWorkspaceExpiredSubscriptions(account.workspace.id);
  const [billing, purchaseOrders] = await Promise.all([
    getWorkspaceBillingSummary(account.workspace.id),
    listPurchaseOrders({ workspaceId: account.workspace.id }),
  ]);
  const pendingPurchaseOrders = purchaseOrders.filter(
    (order) => order.status === "draft" || order.status === "checkout_pending",
  );
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
        <p>按产品查看、续费和管理当前订阅，同时保留完整历史订阅与付款记录。</p>
        <div className="header-actions">
          <Link className="button button-dark button-small" href="/dashboard/plans">
            选择套餐
          </Link>
        </div>
      </header>

      {!currentSubscriptions.length ? (
        <div className="notice notice-warning billing-alert">
          <strong>暂无当前订阅</strong>
          <span>您可以从平台发布的套餐中自行选择并通过 Stripe 付款。</span>
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
            。您可以重新发起付款，或联系平台运营人员核对。
          </span>
        </div>
      ) : null}

      {pendingPurchaseOrders.length ? (
        <section className="data-panel">
          <div className="data-panel-heading">
            <div>
              <h2>待付款订单</h2>
              <p>继续 Stripe Checkout，或取消后重新配置套餐</p>
            </div>
          </div>
          <div className="app-instance-grid">
            {pendingPurchaseOrders.map((order) => (
              <article className="app-instance-card" key={order.id}>
                <div className="app-instance-card-heading">
                  <div>
                    <p className="page-kicker">{order.productName}</p>
                    <h2>{order.planName}</h2>
                  </div>
                  <span
                    className={`status-pill status-${order.paymentStatus === "failed" ? "danger" : "warning"}`}
                  >
                    {order.paymentStatus === "failed" ? "付款失败，可重试" : "等待付款"}
                  </span>
                </div>
                <dl className="app-instance-summary">
                  <div>
                    <dt>订单金额</dt>
                    <dd>{formatMoney(order.amount, order.currency)}</dd>
                  </div>
                  <div>
                    <dt>计费周期</dt>
                    <dd>{order.billingInterval === "year" ? "按年" : "按月"}</dd>
                  </div>
                  <div>
                    <dt>实例模板</dt>
                    <dd>{order.templateName} · v{order.templateVersion}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatDate(order.createdAt)} UTC</dd>
                  </div>
                </dl>
                {order.paymentStatus === "failed" && order.failureReason ? (
                  <div className="notice notice-danger compact-notice">
                    {order.failureReason}
                  </div>
                ) : null}
                {account.membership.role === "owner" ? (
                  <PendingPurchaseOrderActions
                    checkoutUrl={order.checkoutUrl}
                    endpoint={`/api/workspaces/${account.workspace.id}/purchase-orders/${order.id}`}
                  />
                ) : (
                  <div className="notice notice-warning compact-notice">
                    仅工作区 Owner 可以继续付款或取消订单。
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
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
              const legacyPayable = subscription.status === "manual_pending";
              const renewable =
                subscription.status === "active" ||
                subscription.status === "past_due";
              const purchasablePlan =
                plan?.status === "active" &&
                plan.productId === subscription.productId &&
                plan.priceAmount > 0;
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
                    <div>
                      <dt>实例模板</dt>
                      <dd>{subscription.templateName} · v{subscription.templateVersion}</dd>
                    </div>
                  </dl>

                  {Object.keys(subscription.instanceConfiguration).length ? (
                    <div className="notice notice-neutral compact-notice">
                      实例配置：
                      {Object.entries(subscription.instanceConfiguration)
                        .map(([key, value]) => `${key}=${String(value)}`)
                        .join("，")}
                    </div>
                  ) : null}

                  {plan?.features.length ? (
                    <ul className="value-list">
                      {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                  ) : null}

                  {legacyPayable && subscription.productStatus !== "active" ? (
                    <div className="notice notice-danger compact-notice">
                      当前产品已停用，不能发起在线付款，请联系平台管理员。
                    </div>
                  ) : legacyPayable && !plan ? (
                    <div className="notice notice-danger compact-notice">
                      当前套餐暂不可用，请联系平台管理员检查配置。
                    </div>
                  ) : legacyPayable && !purchasablePlan ? (
                    <div className="notice notice-warning compact-notice">
                      当前套餐已停用或无需在线付款，请联系平台管理员确认付款方式。
                    </div>
                  ) : (legacyPayable || renewable) && !onlinePaymentEnabled ? (
                    <div className="notice notice-warning compact-notice">
                      Stripe 在线付款正在配置中，请暂时使用人工付款流程。
                    </div>
                  ) : (legacyPayable || renewable) && account.membership.role !== "owner" ? (
                    <div className="notice notice-warning compact-notice">
                      仅工作区 Owner 可以发起在线付款。
                    </div>
                  ) : legacyPayable && plan && purchasablePlan ? (
                    <CheckoutSubscriptionButton
                      endpoint={`/api/workspaces/${account.workspace.id}/checkout`}
                      planName={`${subscription.productName} · ${plan.name}`}
                      subscriptionId={subscription.id}
                    />
                  ) : renewable && plan && purchasablePlan ? (
                    <div className="plan-card-actions">
                      <Link
                        className="button button-dark button-small"
                        href={`/dashboard/plans/${plan.id}/purchase?renew=${subscription.id}`}
                      >
                        {subscription.status === "past_due" ? "续费并恢复" : "续费"}
                      </Link>
                      {subscription.status === "active" ? (
                        <CancelAtPeriodEndButton
                          cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
                          endpoint={`/api/workspaces/${account.workspace.id}/subscriptions/${subscription.id}/cancel-at-period-end`}
                        />
                      ) : null}
                    </div>
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
            <strong>尚未购买产品套餐</strong>
            <p>选择平台发布的套餐并完成 Stripe 付款后，系统会创建订阅。</p>
            <Link className="button button-dark button-small" href="/dashboard/plans">
              选择套餐
            </Link>
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
        在线付款通过 Stripe Checkout 完成；付款结果仅由支付 Webhook 写入。验证付款后，系统会自动创建订阅、pending 应用实例和 AWS plan-only 部署计划；本阶段不会调用 AWS。
        <Link href="/dashboard/billing/payment-result">查看最近一次付款返回状态</Link>
      </div>
    </>
  );
}
