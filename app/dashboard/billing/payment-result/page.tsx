import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import { paymentStatusLabels, paymentStatusTone } from "@/lib/billing/presentation";
import {
  cancelPaymentCheckout,
  getPaymentCheckout,
} from "@/lib/payments/management";

export const metadata: Metadata = { title: "付款结果" };
export const dynamic = "force-dynamic";

interface PaymentResultPageProps {
  searchParams: Promise<{ checkout_id?: string; status?: string }>;
}

export default async function PaymentResultPage({ searchParams }: PaymentResultPageProps) {
  const account = await getDashboardAccount();
  const query = await searchParams;
  const checkoutId = typeof query.checkout_id === "string" ? query.checkout_id : "";
  const cancelled = query.status === "cancelled";
  const checkout = checkoutId
    ? cancelled
      ? await cancelPaymentCheckout(account.workspace.id, checkoutId)
      : await getPaymentCheckout(account.workspace.id, checkoutId)
    : null;

  if (!checkout) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到付款返回记录</strong>
        <p>付款结果只会显示当前工作区发起的在线付款。请返回订阅与账单页面查看记录。</p>
        <Link className="button button-dark button-small" href="/dashboard/billing">返回订阅与账单</Link>
      </section>
    );
  }

  const confirmed = checkout.paymentStatus === "paid" && checkout.status === "completed";
  const confirmedNeedsReview =
    confirmed &&
    (checkout.subscriptionStatus !== "active" || Boolean(checkout.attentionNote));
  const failed = checkout.paymentStatus === "failed" || checkout.status === "failed";
  const wasCancelled = checkout.paymentStatus === "canceled" || checkout.status === "canceled" || checkout.status === "expired";
  const tone = confirmedNeedsReview ? "warning" : confirmed ? "active" : failed ? "danger" : "warning";
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
    ? checkout.attentionNote ??
      "Stripe 已确认收款，但这笔付款对应的订阅已经结束或被替代。平台不会自动开通，请联系管理员核对。"
    : confirmed
      ? "您的付款已确认，系统正在开通中。平台会创建待开通记录，管理员仍需填写入口并手动标记为已开通。"
    : failed
      ? "Stripe 尚未完成这笔付款。您可以返回后重新发起付款，或联系平台管理员。"
      : wasCancelled
        ? "您没有完成本次付款，订阅和应用实例都不会被自动开通。"
        : "已从支付页面返回，但最终付款状态仍以后端收到并验证的支付通知为准。请稍后刷新此页面。";

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">PAYMENT RESULT</p>
        <h1>{title}</h1>
        <p>此页面不会自行确认付款，状态来自平台已验证的支付记录。</p>
      </header>
      <div className={`notice notice-${tone} billing-alert`}>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <section className="module-card payment-result-card">
        <dl className="detail-list">
          <div><dt>产品</dt><dd>{checkout.productName}</dd></div>
          <div><dt>套餐</dt><dd>{checkout.planName}</dd></div>
          <div><dt>金额</dt><dd>{formatMoney(checkout.amount, checkout.currency)}</dd></div>
          <div>
            <dt>付款状态</dt>
            <dd><span className={`status-pill status-${paymentStatusTone(checkout.paymentStatus)}`}>{paymentStatusLabels[checkout.paymentStatus]}</span></dd>
          </div>
          <div><dt>付款来源</dt><dd>Stripe Checkout</dd></div>
          <div><dt>创建时间</dt><dd>{formatDate(checkout.createdAt)} UTC</dd></div>
          {checkout.failureReason ? <div><dt>失败说明</dt><dd>{checkout.failureReason}</dd></div> : null}
        </dl>
      </section>
      <div className="header-actions">
        <Link className="button button-dark" href="/dashboard/billing">返回订阅与账单</Link>
        {!confirmed && !wasCancelled ? <Link className="button button-ghost" href={`/dashboard/billing/payment-result?checkout_id=${checkout.id}`}>刷新付款状态</Link> : null}
      </div>
    </>
  );
}
