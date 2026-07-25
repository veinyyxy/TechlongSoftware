import Link from "next/link";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import { platformConfig } from "@/config/platform";

interface AuthCardProps {
  mode: "login" | "register";
  user: ChatGPTUser | null;
}

export function AuthCard({ mode, user }: AuthCardProps) {
  const isRegister = mode === "register";

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>{platformConfig.name}</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">STAGE 01 · IDENTITY</p>
        <h1>{isRegister ? "创建企业账号" : "登录 SaaS 平台"}</h1>
        <p className="auth-description">
          {isRegister
            ? "首次使用 ChatGPT 登录后，系统会创建你的平台用户和企业工作区。"
            : "使用 ChatGPT 完成身份验证，进入你的企业工作区。"}
        </p>

        {user ? (
          <div className="signed-in-panel">
            <small>当前已登录</small>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
            <Link className="button button-primary" href="/dashboard">
              进入客户控制台
            </Link>
            <Link className="auth-text-link" href={chatGPTSignOutPath("/")}>
              退出当前账号
            </Link>
          </div>
        ) : (
          <>
            <Link
              className="button button-primary auth-submit"
              href={chatGPTSignInPath("/dashboard")}
            >
              {isRegister ? "使用 ChatGPT 注册" : "使用 ChatGPT 登录"}
            </Link>
            <div className="auth-security-note">
              <strong>身份由 OpenAI Sites 安全处理</strong>
              <span>本应用不会保存或接触你的 ChatGPT 密码。</span>
            </div>
          </>
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
