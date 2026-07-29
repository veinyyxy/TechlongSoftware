"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CancelAtPeriodEndButtonProps {
  endpoint: string;
  cancelAtPeriodEnd: boolean;
}

export function CancelAtPeriodEndButton({
  endpoint,
  cancelAtPeriodEnd,
}: CancelAtPeriodEndButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function updateSetting() {
    const nextValue = !cancelAtPeriodEnd;
    if (
      nextValue &&
      !window.confirm(
        "确认设置为当前计费周期结束后取消？在周期结束前仍可继续使用，也可以撤销此设置。",
      )
    ) {
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelAtPeriodEnd: nextValue }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string } | null;
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "订阅设置更新失败。");
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
      <button
        className="button button-ghost button-small"
        disabled={pending}
        onClick={updateSetting}
        type="button"
      >
        {pending
          ? "正在保存…"
          : cancelAtPeriodEnd
            ? "撤销到期取消"
            : "周期结束后取消"}
      </button>
      {message ? <small className="form-error">{message}</small> : null}
    </div>
  );
}
