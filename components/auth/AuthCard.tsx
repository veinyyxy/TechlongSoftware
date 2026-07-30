"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { platformConfig } from "@/config/platform";
import { passwordRequirements } from "@/lib/auth/validation";

interface SignedInUser {
  name: string;
  email: string;
}

interface InvitationDetails {
  email: string;
  name: string;
  workspaceName: string;
  expiresAt: number;
}

interface AuthCardProps {
  mode: "login" | "register";
  user: SignedInUser | null;
  returnTo?: string;
  invitationToken?: string | null;
  invitation?: InvitationDetails | null;
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
  data?: { redirectTo?: string };
}

export function AuthCard({
  mode,
  user,
  returnTo = "/dashboard",
  invitationToken = null,
  invitation = null,
}: AuthCardProps) {
  const isRegister = mode === "register";
  const isInvitation = isRegister && Boolean(invitationToken);
  const invitationInvalid = isInvitation && !invitation;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch(
        isRegister ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as ErrorPayload;
      if (!response.ok) {
        setMessage(result.error?.message ?? "操作没有完成，请稍后重试。");
        setFieldErrors(result.error?.fields ?? {});
        return;
      }
      window.location.assign(result.data?.redirectTo ?? "/dashboard");
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>{platformConfig.name}</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">LOCAL ACCOUNT · SECURE SESSION</p>
        <h1>
          {isInvitation
            ? "激活企业账号"
            : isRegister
              ? "创建企业账号"
              : "登录 SaaS 平台"}
        </h1>
        <p className="auth-description">
          {isInvitation
            ? "请确认企业资料并设置登录密码。邀请链接只能使用一次。"
            : isRegister
              ? "使用企业邮箱注册，系统会为你创建企业工作区。"
              : "使用平台账号登录企业工作区或管理员后台。"}
        </p>

        {user ? (
          <div className="signed-in-panel">
            <small>当前已登录</small>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <Link className="button button-primary" href="/dashboard">
              进入客户控制台
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="auth-text-button" type="submit">
                退出当前账号
              </button>
            </form>
          </div>
        ) : invitationInvalid ? (
          <div className="notice notice-danger">
            <strong>邀请链接不可用</strong>
            <span>链接可能已过期或已经使用，请联系平台管理员重新生成。</span>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            {isRegister ? (
              <>
                <label className="form-field">
                  <span>姓名</span>
                  <input
                    defaultValue={invitation?.name}
                    maxLength={100}
                    minLength={2}
                    name="name"
                    required
                  />
                  {fieldError("name") ? (
                    <small className="form-error">{fieldError("name")}</small>
                  ) : null}
                </label>
                {!isInvitation ? (
                  <label className="form-field">
                    <span>企业名称</span>
                    <input
                      maxLength={100}
                      minLength={2}
                      name="workspaceName"
                      placeholder="例如：北岸餐饮有限公司"
                      required
                    />
                    {fieldError("workspaceName") ? (
                      <small className="form-error">
                        {fieldError("workspaceName")}
                      </small>
                    ) : null}
                  </label>
                ) : (
                  <div className="auth-invitation-workspace">
                    <small>受邀企业</small>
                    <strong>{invitation?.workspaceName}</strong>
                  </div>
                )}
              </>
            ) : null}

            <label className="form-field">
              <span>邮箱</span>
              <input
                autoComplete="email"
                defaultValue={invitation?.email}
                maxLength={320}
                name="email"
                placeholder="owner@example.com"
                readOnly={Boolean(invitation)}
                required
                type="email"
              />
              {fieldError("email") ? (
                <small className="form-error">{fieldError("email")}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>密码</span>
              <input
                autoComplete={isRegister ? "new-password" : "current-password"}
                maxLength={128}
                minLength={isRegister ? 12 : undefined}
                name="password"
                required
                type="password"
              />
              {isRegister ? <small>{passwordRequirements}</small> : null}
              {fieldError("password") ? (
                <small className="form-error">{fieldError("password")}</small>
              ) : null}
            </label>
            {isRegister ? (
              <label className="form-field">
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={12}
                  name="passwordConfirmation"
                  required
                  type="password"
                />
                {fieldError("passwordConfirmation") ? (
                  <small className="form-error">
                    {fieldError("passwordConfirmation")}
                  </small>
                ) : null}
              </label>
            ) : null}
            <input name="returnTo" type="hidden" value={returnTo} />
            {invitationToken ? (
              <input
                name="invitationToken"
                type="hidden"
                value={invitationToken}
              />
            ) : null}
            {message ? <p className="form-error form-message">{message}</p> : null}
            <button
              className="button button-primary auth-submit"
              disabled={pending}
              type="submit"
            >
              {pending
                ? "处理中…"
                : isInvitation
                  ? "激活账号并登录"
                  : isRegister
                    ? "创建账号并登录"
                    : "登录"}
            </button>
            <div className="auth-security-note">
              <strong>密码不会以明文保存</strong>
              <span>系统使用加盐 PBKDF2 哈希和仅服务端可读的安全会话 Cookie。</span>
            </div>
          </form>
        )}

        <p className="auth-switch">
          {isRegister ? "已经有账号？" : "首次使用？"}
          <Link href={isRegister ? "/login" : "/register"}>
            {isRegister ? "前往登录" : "创建企业账号"}
          </Link>
        </p>
      </section>
    </main>
  );
}
