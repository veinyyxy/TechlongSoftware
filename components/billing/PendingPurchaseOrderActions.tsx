"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface PendingPurchaseOrderActionsProps {
  checkoutUrl: string | null;
  endpoint: string;
}

export function PendingPurchaseOrderActions({
  checkoutUrl,
  endpoint,
}: PendingPurchaseOrderActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function cancelOrder() {
    if (
      !window.confirm(
        "确认取消这笔待付款订单吗？系统会先关闭 Stripe 付款页面；若付款已经完成，将改为核对付款并继续正常流程。",
      )
    ) {
      return;
    }

    setPending(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PATCH" });
      const payload = (await response.json()) as {
        error?: { message?: string } | null;
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "待付款订单取消失败。");
        return;
      }
      router.refresh();
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-action">
      <div className="header-actions">
        {checkoutUrl ? (
          <a className="button button-dark button-small" href={checkoutUrl}>
            继续 Stripe 付款
          </a>
        ) : null}
        <button
          className="button button-ghost button-small"
          disabled={pending}
          onClick={cancelOrder}
          type="button"
        >
          {pending ? "正在取消…" : "取消订单"}
        </button>
      </div>
      {!checkoutUrl ? (
        <small>该订单没有可继续使用的付款链接，请取消后重新选择套餐。</small>
      ) : null}
      {message ? <small className="form-error">{message}</small> : null}
    </div>
  );
}
