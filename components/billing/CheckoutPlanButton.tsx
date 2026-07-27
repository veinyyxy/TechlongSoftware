"use client";

import { useState } from "react";

interface CheckoutPlanButtonProps {
  endpoint: string;
  planId: string;
  planName: string;
}

export function CheckoutPlanButton({
  endpoint,
  planId,
  planName,
}: CheckoutPlanButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function beginCheckout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const payload = (await response.json()) as {
        data?: { checkoutUrl?: string } | null;
        error?: { message?: string } | null;
      };
      if (!response.ok || !payload.data?.checkoutUrl) {
        setError(payload.error?.message ?? "暂时无法创建付款页面，请稍后重试。");
        return;
      }
      window.location.assign(payload.data.checkoutUrl);
    } catch {
      setError("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="checkout-action">
      <button className="button button-dark" disabled={pending} onClick={beginCheckout} type="button">
        {pending ? "正在前往付款…" : `选择 ${planName} 并付款`}
      </button>
      {error ? <p className="form-error compact-error">{error}</p> : null}
    </div>
  );
}
