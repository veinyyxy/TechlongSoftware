import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "无权限访问" };

const messages: Record<string, string> = {
  platform_admin: "当前账号不是平台管理员，不能访问平台管理后台。",
  user_status: "当前用户账号不可用，请联系平台管理员。",
  workspace_status: "当前企业工作区已暂停或停用，请联系平台管理员。",
};

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    messages[reason ?? ""] ?? "当前账号无权访问所请求的页面。";

  return (
    <main className="auth-page">
      <section className="auth-card unauthorized-card">
        <span className="unauthorized-code">403</span>
        <p className="eyebrow">ACCESS DENIED</p>
        <h1>无权限访问</h1>
        <p className="auth-description">{message}</p>
        <div className="hero-actions">
          <Link className="button button-primary" href="/dashboard">
            返回客户控制台
          </Link>
          <Link className="button button-ghost" href="/">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
