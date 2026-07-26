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
          <small>启用套餐</small>
          <strong>{overview.activePlans}</strong>
          <p>当前可以继续销售或分配的套餐。</p>
        </article>
      </div>
      <div className="dashboard-columns">
        <section className="module-card">
          <h2>客户运营</h2>
          <p>维护企业资料、工作区状态和当前套餐。</p>
          <ul className="foundation-checklist">
            <li><span>客户总数</span><span>{overview.workspaces}</span></li>
            <li><span>暂停客户</span><span>{overview.suspendedWorkspaces}</span></li>
            <li><span>成员关系</span><span>{overview.memberships}</span></li>
          </ul>
          <Link className="table-link" href="/admin/customers">进入客户管理 →</Link>
        </section>
        <section className="module-card">
          <h2>套餐目录</h2>
          <p>套餐价格、功能与限制由数据库提供。</p>
          <div className="notice notice-neutral">
            本阶段不创建订阅、不接支付，也不执行应用开通。
          </div>
          <Link className="table-link" href="/admin/plans">进入套餐管理 →</Link>
        </section>
      </div>
    </>
  );
}
