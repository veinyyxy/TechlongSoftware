import type { Metadata } from "next";
import Link from "next/link";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";

export const metadata: Metadata = { title: "客户控制台" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const account = await getDashboardAccount();
  const members = await listWorkspaceMembers(account.workspace.id);

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">企业工作区</p>
          <h1>欢迎回来，{account.user.name}</h1>
          <p>账号、工作区与成员权限已经接入真实持久化数据。</p>
        </div>
        {account.user.isPlatformAdmin ? (
          <Link className="button button-dark button-small" href="/admin">
            进入平台管理端
          </Link>
        ) : null}
      </header>

      <div className="readiness-grid">
        <article className="readiness-card">
          <small>当前工作区</small>
          <strong>{account.workspace.name}</strong>
          <p>状态：{account.workspace.status}</p>
        </article>
        <article className="readiness-card">
          <small>我的角色</small>
          <strong>{account.membership.role}</strong>
          <p>{account.membership.role === "owner" ? "可管理工作区基础信息" : "可访问工作区内容"}</p>
        </article>
        <article className="readiness-card">
          <small>团队成员</small>
          <strong>{members.length}</strong>
          <p>成员数据仅在当前工作区范围内读取。</p>
        </article>
      </div>

      <div className="dashboard-columns">
        <section className="module-card">
          <h2>阶段 1 已启用</h2>
          <p>以下能力已连接服务器端身份和数据库。</p>
          <ul className="foundation-checklist">
            <li><span>ChatGPT 登录与退出</span><span className="check-state">READY</span></li>
            <li><span>首次登录创建企业工作区</span><span className="check-state">READY</span></li>
            <li><span>工作区成员权限隔离</span><span className="check-state">READY</span></li>
            <li><span>平台管理员独立权限</span><span className="check-state">READY</span></li>
          </ul>
        </section>
        <aside className="module-card">
          <h2>后续阶段</h2>
          <p>套餐、订阅、付款和应用实例仍未接入，本阶段不会展示虚构状态。</p>
          <div className="notice notice-neutral">
            下一阶段可以开始实现客户和套餐管理。
          </div>
        </aside>
      </div>
    </>
  );
}
