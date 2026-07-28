import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { getAdminAccount } from "@/lib/auth/account";
import {
  listSubscriptions,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import {
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "@/lib/billing/presentation";
import { isSubscriptionStatus } from "@/lib/billing/validation";
import { formatDate, formatMoney } from "@/lib/admin/presentation";

export const metadata: Metadata = { title: "订阅管理" };
export const dynamic = "force-dynamic";

interface SubscriptionsPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function SubscriptionsPage({
  searchParams,
}: SubscriptionsPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: SubscriptionStatus | "" = isSubscriptionStatus(params.status)
    ? params.status
    : "";
  const subscriptions = await listSubscriptions({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">MANUAL SUBSCRIPTIONS</p>
          <h1>订阅管理</h1>
          <p>按企业客户与产品维护当前订阅，并保留取消后的历史记录。</p>
        </div>
        <Link
          className="button button-dark button-small"
          href="/admin/subscriptions/new"
        >
          新建订阅
        </Link>
      </header>

      <AdminSearchFilters
        action="/admin/subscriptions"
        query={query}
        queryPlaceholder="客户、邮箱、产品或套餐"
        status={status}
        statusOptions={[
          { value: "manual_pending", label: "人工待确认" },
          { value: "active", label: "有效" },
          { value: "past_due", label: "逾期" },
          { value: "paused", label: "已暂停" },
          { value: "canceled", label: "已取消" },
        ]}
      />

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>客户订阅</h2>
            <p>共显示 {subscriptions.length} 条记录</p>
          </div>
        </div>
        {subscriptions.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>产品</th>
                  <th>套餐</th>
                  <th>状态</th>
                  <th>当前周期</th>
                  <th>到期处理</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td>
                      <strong>{subscription.workspaceName}</strong>
                      <span>{subscription.workspaceStatus}</span>
                    </td>
                    <td>
                      <strong>{subscription.productName}</strong>
                      <span>{subscription.productSlug}</span>
                    </td>
                    <td>
                      <strong>{subscription.planName}</strong>
                      <span>
                        {formatMoney(
                          subscription.planPriceAmount,
                          subscription.planCurrency,
                        )}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill status-${subscriptionStatusTone(
                          subscription.status,
                        )}`}
                      >
                        {subscriptionStatusLabels[subscription.status]}
                      </span>
                    </td>
                    <td>
                      <strong>{formatDate(subscription.currentPeriodStart)} UTC</strong>
                      <span>至 {formatDate(subscription.currentPeriodEnd)} UTC</span>
                    </td>
                    <td>
                      {subscription.cancelAtPeriodEnd ? "到期取消" : "继续保留"}
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={`/admin/subscriptions/${subscription.id}`}
                      >
                        查看详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>没有找到订阅</strong>
            <p>调整筛选条件，或者为客户创建第一条订阅。</p>
          </div>
        )}
      </section>
    </>
  );
}
