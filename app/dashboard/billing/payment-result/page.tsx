import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import {
  paymentStatusLabels,
  paymentStatusTone,
} from "@/lib/billing/presentation";
import {
  cancelPaymentCheckout,
  getPaymentCheckout,
  reconcilePaymentCheckoutFromStripe,
} from "@/lib/payments/management";
import {
  cancelWorkspacePurchaseOrder,
  getWorkspacePurchaseOrder,
  reconcilePurchaseOrderFromStripe,
} from "@/lib/purchases/management";

export const metadata: Metadata = { title: "付款结果" };
export const dynamic = "force-dynamic";

interface PaymentResultPageProps {
  searchParams: Promise<{
    checkout_id?: string;
    order_id?: string;
    session_id?: string;
    status?: string;
  }>;
}

export default async function PaymentResultPage({
  searchParams,
}: PaymentResultPageProps) {
  const account = await getDashboardAccount();
  const query = await searchParams;
  const checkoutId =
    typeof query.checkout_id === "string" ? query.checkout_id : "";
  const orderId = typeof query.order_id === "string" ? query.order_id : "";
  const sessionId =
    typeof query.session_id === "string" ? query.session_id : "";
  const cancelled = query.status === "cancelled";

  const purchaseOrder = orderId
    ? cancelled && account.membership.role === "owner"
      ? await cancelWorkspacePurchaseOrder(
          account.workspace.id,
          orderId,
        ).catch(() =>
          getWorkspacePurchaseOrder(account.workspace.id, orderId),
        )
      : sessionId
        ? await reconcilePurchaseOrderFromStripe(
            account.workspace.id,
            orderId,
            sessionId,
          ).catch(() =>
            getWorkspacePurchaseOrder(account.workspace.id, orderId),
          )
        : await getWorkspacePurchaseOrder(account.workspace.id, orderId)
    : null;
  const checkout = !purchaseOrder && checkoutId
    ? cancelled && account.membership.role === "owner"
      ? await cancelPaymentCheckout(
          account.workspace.id,
          checkoutId,
        ).catch(() =>
          getPaymentCheckout(account.workspace.id, checkoutId),
        )
      : sessionId
        ? await reconcilePaymentCheckoutFromStripe(
            account.workspace.id,
            checkoutId,
            sessionId,
          ).catch(() =>
            getPaymentCheckout(account.workspace.id, checkoutId),
          )
        : await getPaymentCheckout(account.workspace.id, checkoutId)
    : null;

  if (!purchaseOrder && !checkout) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到付款返回记录</strong>
        <p>
          付款结果只会显示当前工作区发起的在线付款。请返回订阅与账单页面查看记录。
        </p>
        <Link
          className="button button-dark button-small"
          href="/dashboard/billing"
        >
          返回订阅与账单
        </Link>
      </section>
    );
  }

  const record = purchaseOrder ?? checkout!;
  const paymentStatus = record.paymentStatus ?? "pending";
  const confirmed = purchaseOrder
    ? purchaseOrder.status === "paid" && paymentStatus === "paid"
    : checkout!.status === "completed" && paymentStatus === "paid";
  const confirmedNeedsReview = confirmed && (
    purchaseOrder
      ? Boolean(purchaseOrder.failureReason)
      : checkout!.subscriptionStatus !== "active" ||
        Boolean(checkout!.attentionNote)
  );
  const failed =
    paymentStatus === "failed" || record.status === "failed";
  const wasCancelled =
    paymentStatus === "canceled" ||
    record.status === "canceled" ||
    record.status === "expired";
  const tone = confirmedNeedsReview
    ? "warning"
    : confirmed
      ? "active"
      : failed
        ? "danger"
        : "warning";
  const title = confirmedNeedsReview
    ? "付款已确认，需人工处理"
    : confirmed
      ? "付款已确认"
      : failed
        ? "付款未成功"
        : wasCancelled
          ? "付款已取消"
          : "正在确认付款结果";
  const message = confirmedNeedsReview
    ? (purchaseOrder?.failureReason ?? checkout?.attentionNote) ??
      "Stripe 已确认收款，但对应订阅已发生变化，请联系管理员核对。"
    : confirmed
      ? "您的付款已确认，订阅已由服务器更新，系统正在等待平台管理员检查并开通应用。"
      : failed
        ? "Stripe 尚未完成这笔付款。您可以返回后重新发起付款，或联系平台管理员。"
        : wasCancelled
          ? "您没有完成本次付款，订阅和应用实例都不会被自动开通。"
          : "系统正在通过 Stripe 支付通知和服务器端查询核对最终付款状态，请稍后刷新此页面。";
  const refreshHref = purchaseOrder
    ? `/dashboard/billing/payment-result?order_id=${purchaseOrder.id}`
    : `/dashboard/billing/payment-result?checkout_id=${checkout!.id}`;

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">PAYMENT RESULT</p>
        <h1>{title}</h1>
        <p>
          此页面显示服务器保存的订单和付款状态，不会仅凭浏览器返回结果判定付款成功。
        </p>
      </header>
      <div className={`notice notice-${tone} billing-alert`}>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <section className="module-card payment-result-card">
        <dl className="detail-list">
          <div>
            <dt>产品</dt>
            <dd>{record.productName}</dd>
          </div>
          <div>
            <dt>套餐</dt>
            <dd>{record.planName}</dd>
          </div>
          {purchaseOrder ? (
            <div>
              <dt>订单类型</dt>
              <dd>
                {purchaseOrder.orderType === "renewal" ? "订阅续费" : "新订阅购买"}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>金额</dt>
            <dd>{formatMoney(record.amount, record.currency)}</dd>
          </div>
          <div>
            <dt>付款状态</dt>
            <dd>
              <span
                className={`status-pill status-${paymentStatusTone(paymentStatus)}`}
              >
                {paymentStatusLabels[paymentStatus]}
              </span>
            </dd>
          </div>
          <div>
            <dt>付款来源</dt>
            <dd>Stripe Checkout</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatDate(record.createdAt)} UTC</dd>
          </div>
          {record.failureReason ? (
            <div>
              <dt>失败说明</dt>
              <dd>{record.failureReason}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <div className="header-actions">
        <Link className="button button-dark" href="/dashboard/billing">
          返回订阅与账单
        </Link>
        {!confirmed && !wasCancelled ? (
          <Link className="button button-ghost" href={refreshHref}>
            刷新付款状态
          </Link>
        ) : null}
      </div>
    </>
  );
}
