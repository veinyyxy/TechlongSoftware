import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { getAdminAccount } from "@/lib/auth/account";
import {
  listPaymentRecords,
  type PaymentStatus,
} from "@/lib/billing/management";
import {
  paymentStatusLabels,
  paymentStatusTone,
} from "@/lib/billing/presentation";
import { isPaymentStatus } from "@/lib/billing/validation";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { reconcilePendingStripeCheckouts } from "@/lib/payments/management";

export const metadata: Metadata = { title: "付款记录" };
export const dynamic = "force-dynamic";

interface PaymentsPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: PaymentStatus | "" = isPaymentStatus(params.status)
    ? params.status
    : "";
  await reconcilePendingStripeCheckouts().catch(() => undefined);
  const payments = await listPaymentRecords({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">PAYMENT RECORDS</p>
          <h1>付款记录</h1>
          <p>查看管理员手动录入与 Stripe 在线支付写入的客户付款结果。</p>
        </div>
        <Link
          className="button button-dark button-small"
          href="/admin/payments/new"
        >
          新增付款记录
        </Link>
      </header>

      <AdminSearchFilters
        action="/admin/payments"
        query={query}
        queryPlaceholder="客户、参考号或付款方式"
        status={status}
        statusOptions={[
          { value: "pending", label: "待确认" },
          { value: "paid", label: "已付款" },
          { value: "failed", label: "付款失败" },
          { value: "canceled", label: "已取消" },
        ]}
      />

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>付款记录</h2>
            <p>共显示 {payments.length} 条记录</p>
          </div>
        </div>
        {payments.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>企业客户</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>付款方式</th>
                  <th>付款时间</th>
                  <th>记录人</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <strong>{payment.workspaceName}</strong>
                      <span>{payment.planName ?? "未关联订阅"}</span>
                    </td>
                    <td>{formatMoney(payment.amount, payment.currency)}</td>
                    <td>
                      <span
                        className={`status-pill status-${paymentStatusTone(
                          payment.status,
                        )}`}
                      >
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
                    <td>{payment.recordedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>没有找到付款记录</strong>
            <p>调整筛选条件，或者录入第一条人工付款结果。</p>
          </div>
        )}
      </section>
      <div className="notice billing-disclaimer">
        管理员仍可新增和维护手动付款记录。Stripe 付款会通过已验证的 Webhook 或服务器端状态核对更新。
      </div>
    </>
  );
}
