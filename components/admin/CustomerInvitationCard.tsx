"use client";

import { useState } from "react";

interface CustomerInvitationCardProps {
  customerId: string;
  hasPassword: boolean;
}

interface InvitationResponse {
  data?: {
    invitationUrl?: string;
    expiresAt?: number;
  } | null;
  error?: { message?: string } | null;
}

export function CustomerInvitationCard({
  customerId,
  hasPassword,
}: CustomerInvitationCardProps) {
  const [pending, setPending] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  async function createInvitation() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/customers/${customerId}/invitation`,
        { method: "POST" },
      );
      const result = (await response.json()) as InvitationResponse;
      if (!response.ok || !result.data?.invitationUrl) {
        setMessage(result.error?.message ?? "邀请链接生成失败。");
        return;
      }
      setInvitationUrl(result.data.invitationUrl);
      setExpiresAt(result.data.expiresAt ?? null);
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setMessage("邀请链接已复制。");
    } catch {
      setMessage("浏览器未允许自动复制，请手动复制链接。");
    }
  }

  return (
    <section className="module-card">
      <h2>账号登录</h2>
      {hasPassword ? (
        <div className="notice notice-success">
          <strong>Owner 已设置密码</strong>
          <span>该客户可使用 Owner 邮箱从登录页进入平台。</span>
        </div>
      ) : (
        <>
          <div className="notice notice-neutral">
            <strong>Owner 尚未设置密码</strong>
            <span>生成一次性链接并发送给客户。系统本期不会自动发邮件。</span>
          </div>
          <button
            className="button button-dark button-small"
            disabled={pending}
            onClick={createInvitation}
            type="button"
          >
            {pending ? "生成中…" : invitationUrl ? "重新生成邀请链接" : "生成邀请链接"}
          </button>
          {invitationUrl ? (
            <div className="invitation-result">
              <label className="form-field">
                <span>一次性激活链接</span>
                <input readOnly value={invitationUrl} />
              </label>
              {expiresAt ? (
                <small>
                  有效期至 {new Date(expiresAt).toLocaleString("zh-CN")}
                </small>
              ) : null}
              <button
                className="button button-ghost button-small"
                onClick={copyInvitation}
                type="button"
              >
                复制链接
              </button>
            </div>
          ) : null}
        </>
      )}
      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
