import type { Metadata } from "next";
import Link from "next/link";
import {
  getAdminAccount,
  getPlatformOverview,
} from "@/lib/auth/account";

export const metadata: Metadata = { title: "管理概览" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await getAdminAccount();
  const overview = await getPlatformOverview();

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">PLATFORM ADMIN</p>
          <h1>管理概览</h1>
          <p>平台管理员可以读取全部用户和企业工作区基础信息。</p>
        </div>
        <Link className="button button-ghost button-small" href="/dashboard">
          返回客户控制台
        </Link>
      </header>
      <div className="readiness-grid">
        <article className="readiness-card">
          <small>用户账号</small>
          <strong>{overview.users}</strong>
          <p>已完成首次登录同步的账号。</p>
        </article>
        <article className="readiness-card">
          <small>企业工作区</small>
          <strong>{overview.workspaces}</strong>
          <p>当前平台中的租户边界。</p>
        </article>
        <article className="readiness-card">
          <small>成员关系</small>
          <strong>{overview.memberships}</strong>
          <p>用户与工作区之间的角色记录。</p>
        </article>
      </div>
      <section className="placeholder-panel">
        <h2>管理员权限范围</h2>
        <p>当前只开放用户和工作区只读基础视图，未进入客户管理、套餐或收费阶段。</p>
        <ul className="placeholder-list">
          <li>查看平台用户及管理员标记</li>
          <li>查看企业工作区和成员数量</li>
          <li>普通用户访问管理端时服务端拒绝</li>
          <li>套餐、付款、应用实例保持未实现</li>
        </ul>
      </section>
    </>
  );
}
