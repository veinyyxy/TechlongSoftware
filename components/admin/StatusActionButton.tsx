"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface StatusActionButtonProps {
  endpoint: string;
  nextStatus: string;
  label: string;
  confirmMessage: string;
  tone?: "danger" | "default";
}

export function StatusActionButton({
  endpoint,
  nextStatus,
  label,
  confirmMessage,
  tone = "default",
}: StatusActionButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function runAction() {
    if (!window.confirm(confirmMessage)) return;

    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string } | null;
      };

      if (!response.ok) {
        setError(payload.error?.message ?? "操作没有完成，请稍后重试。");
        return;
      }
      router.refresh();
    } catch {
      setError("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-action">
      <button
        className={`button button-small ${
          tone === "danger" ? "button-danger" : "button-dark"
        }`}
        disabled={pending}
        onClick={runAction}
        type="button"
      >
        {pending ? "处理中…" : label}
      </button>
      {error ? <p className="form-error compact-error">{error}</p> : null}
    </div>
  );
}
