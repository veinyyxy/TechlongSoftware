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
          <small>有效订阅</small>
          <strong>{overview.activeSubscriptions}</strong>
          <p>由管理员手动标记为有效的订阅。</p>
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
          <h2>手动收费状态</h2>
          <p>订阅与付款记录由平台管理员维护。</p>
          <ul className="foundation-checklist">
            <li><span>启用套餐</span><span>{overview.activePlans}</span></li>
            <li><span>有效订阅</span><span>{overview.activeSubscriptions}</span></li>
            <li><span>失败付款</span><span>{overview.failedPayments}</span></li>
          </ul>
          <div className="header-actions">
            <Link className="table-link" href="/admin/subscriptions">订阅管理 →</Link>
            <Link className="table-link" href="/admin/payments">付款记录 →</Link>
          </div>
        </section>
        <section className="module-card">
          <h2>应用实例</h2>
          <p>手动记录客户对应的餐饮订单系统入口与开通状态。</p>
          <ul className="foundation-checklist">
            <li><span>实例总数</span><span>{overview.appInstances}</span></li>
            <li><span>已开通实例</span><span>{overview.activeAppInstances}</span></li>
          </ul>
          <Link className="table-link" href="/admin/instances">应用实例管理 →</Link>
        </section>
      </div>
    </>
  );
}
