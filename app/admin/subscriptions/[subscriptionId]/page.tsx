import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { getAdminAccount } from "@/lib/auth/account";
import {
  getSubscription,
  listPaymentRecords,
} from "@/lib/billing/management";
import {
  paymentStatusLabels,
  paymentStatusTone,
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "@/lib/billing/presentation";
import { formatDate, formatMoney } from "@/lib/admin/presentation";

export const metadata: Metadata = { title: "订阅详情" };
export const dynamic = "force-dynamic";

interface SubscriptionDetailPageProps {
  params: Promise<{ subscriptionId: string }>;
}

export default async function SubscriptionDetailPage({
  params,
}: SubscriptionDetailPageProps) {
  await getAdminAccount();
  const { subscriptionId } = await params;
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该订阅</strong>
        <Link
          className="button button-dark button-small"
          href="/admin/subscriptions"
        >
          返回订阅列表
        </Link>
      </section>
    );
  }

  const payments = await listPaymentRecords({ subscriptionId });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">SUBSCRIPTION DETAIL</p>
          <h1>{subscription.workspaceName}</h1>
          <p>
            <span
              className={`status-pill status-${subscriptionStatusTone(
                subscription.status,
              )}`}
            >
              {subscriptionStatusLabels[subscription.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <Link
            className="button button-ghost button-small"
            href={`/admin/subscriptions/${subscription.id}/edit`}
          >
            编辑订阅
          </Link>
          {subscription.status === "paused" ||
          subscription.status === "canceled" ? (
            <StatusActionButton
              confirmMessage={`确认把“${subscription.workspaceName}”的订阅恢复为有效状态吗？`}
              endpoint={`/api/admin/subscriptions/${subscription.id}`}
              label="恢复订阅"
              nextStatus="active"
            />
          ) : (
            <StatusActionButton
              confirmMessage={`确认暂停“${subscription.workspaceName}”的订阅吗？客户侧会立即看到暂停提醒。`}
              endpoint={`/api/admin/subscriptions/${subscription.id}`}
              label="暂停订阅"
              nextStatus="paused"
              tone="danger"
            />
          )}
          {subscription.status !== "canceled" ? (
            <StatusActionButton
              confirmMessage={`确认取消“${subscription.workspaceName}”的订阅吗？这是手动状态变更，不会联系支付平台。`}
              endpoint={`/api/admin/subscriptions/${subscription.id}`}
              label="取消订阅"
              nextStatus="canceled"
              tone="danger"
            />
          ) : null}
        </div>
      </header>

      <div className="detail-grid">
        <section className="module-card">
          <h2>订阅信息</h2>
          <dl className="detail-list">
            <div><dt>企业客户</dt><dd>{subscription.workspaceName}</dd></div>
            <div><dt>套餐</dt><dd>{subscription.planName}</dd></div>
            <div>
              <dt>套餐价格</dt>
              <dd>
                {formatMoney(
                  subscription.planPriceAmount,
                  subscription.planCurrency,
                )}
              </dd>
            </div>
            <div>
              <dt>订阅状态</dt>
              <dd>{subscriptionStatusLabels[subscription.status]}</dd>
            </div>
            <div>
              <dt>到期取消</dt>
              <dd>{subscription.cancelAtPeriodEnd ? "是" : "否"}</dd>
            </div>
          </dl>
        </section>
        <section className="module-card">
          <h2>计费周期</h2>
          <dl className="detail-list">
            <div>
              <dt>开始时间</dt>
              <dd>{formatDate(subscription.currentPeriodStart)} UTC</dd>
            </div>
            <div>
              <dt>结束时间</dt>
              <dd>{formatDate(subscription.currentPeriodEnd)} UTC</dd>
            </div>
            <div>
              <dt>创建人</dt>
              <dd>{subscription.createdByName}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatDate(subscription.updatedAt)} UTC</dd>
            </div>
          </dl>
          <div className="notice notice-neutral">
            此订阅由管理员手动维护，不会自动扣款或触发应用实例开通。
          </div>
        </section>
      </div>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>关联付款记录</h2>
            <p>{payments.length} 条管理员手动记录</p>
          </div>
          <Link className="table-link" href="/admin/payments/new">
            新增付款记录
          </Link>
        </div>
        {payments.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>金额</th><th>状态</th><th>付款方式</th><th>记录时间</th></tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
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
                    <td>{formatDate(payment.createdAt)} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>尚无付款记录</strong>
            <p>可由管理员手动录入待确认、成功或失败的付款状态。</p>
          </div>
        )}
      </section>
    </>
  );
}
