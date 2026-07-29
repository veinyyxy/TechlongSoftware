import type { Metadata } from "next";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getAdminAccount } from "@/lib/auth/account";
import {
  listPurchaseOrders,
  type PurchaseOrderStatus,
} from "@/lib/purchases/management";

export const metadata: Metadata = { title: "购买订单" };
export const dynamic = "force-dynamic";

const statusLabels: Record<PurchaseOrderStatus, string> = {
  draft: "正在创建",
  checkout_pending: "等待付款",
  paid: "已付款",
  failed: "付款失败",
  canceled: "已取消",
  expired: "已过期",
};

const statusTones: Record<PurchaseOrderStatus, string> = {
  draft: "warning",
  checkout_pending: "warning",
  paid: "active",
  failed: "danger",
  canceled: "neutral",
  expired: "neutral",
};

const statuses = new Set<PurchaseOrderStatus>([
  "draft",
  "checkout_pending",
  "paid",
  "failed",
  "canceled",
  "expired",
]);

interface PurchaseOrdersPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: PurchaseOrdersPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status = statuses.has(params.status as PurchaseOrderStatus)
    ? (params.status as PurchaseOrderStatus)
    : "";
  const orders = await listPurchaseOrders({ query, status });

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">CUSTOMER PURCHASE ORDERS</p>
        <h1>购买订单</h1>
        <p>
          查看客户自行选择套餐后创建的 Stripe 订单、付款结果及生成的订阅。管理员人工订阅和付款流程保持不变。
        </p>
      </header>

      <AdminSearchFilters
        action="/admin/purchase-orders"
        query={query}
        queryPlaceholder="客户、产品、套餐或 Stripe 会话"
        status={status}
        statusOptions={[
          { value: "draft", label: "正在创建" },
          { value: "checkout_pending", label: "等待付款" },
          { value: "paid", label: "已付款" },
          { value: "failed", label: "付款失败" },
          { value: "canceled", label: "已取消" },
          { value: "expired", label: "已过期" },
        ]}
      />

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>客户购买订单</h2>
            <p>共显示 {orders.length} 条记录</p>
          </div>
        </div>
        {orders.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>企业客户</th>
                  <th>产品与套餐</th>
                  <th>类型</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>订阅</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.workspaceName}</strong>
                      <span>{order.createdByName}</span>
                    </td>
                    <td>
                      <strong>{order.productName}</strong>
                      <span>{order.planName}</span>
                    </td>
                    <td>
                      {order.orderType === "renewal" ? "续费" : "新订阅"}
                    </td>
                    <td>{formatMoney(order.amount, order.currency)}</td>
                    <td>
                      <span
                        className={`status-pill status-${statusTones[order.status]}`}
                      >
                        {statusLabels[order.status]}
                      </span>
                      {order.failureReason ? (
                        <span>{order.failureReason}</span>
                      ) : null}
                    </td>
                    <td>
                      <strong>
                        {order.subscriptionId
                          ? "已关联"
                          : order.renewalSubscriptionId
                            ? "等待续费确认"
                            : "付款后创建"}
                      </strong>
                      <span>
                        {order.subscriptionId ??
                          order.renewalSubscriptionId ??
                          "—"}
                      </span>
                    </td>
                    <td>{formatDate(order.createdAt)} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>没有找到购买订单</strong>
            <p>客户从“选择套餐”进入 Stripe 后，订单会显示在这里。</p>
          </div>
        )}
      </section>
    </>
  );
}
