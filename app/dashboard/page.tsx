import type { Metadata } from "next";
import Link from "next/link";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";
import { getCustomer } from "@/lib/admin/management";
import {
  appInstanceStatusLabels,
  formatMoney,
  subscriptionStatusLabels,
} from "@/lib/admin/presentation";

export const metadata: Metadata = { title: "客户控制台" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const account = await getDashboardAccount();
  const [members, customer] = await Promise.all([
    listWorkspaceMembers(account.workspace.id),
    getCustomer(account.workspace.id),
  ]);

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">企业工作区</p>
          <h1>欢迎回来，{account.user.name}</h1>
          <p>查看当前工作区、套餐与服务状态。</p>
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
          <small>当前套餐</small>
          <strong>{customer?.plan?.name ?? "尚未分配"}</strong>
          <p>
            {customer?.plan
              ? formatMoney(customer.plan.priceAmount, customer.plan.currency)
              : "由平台管理员维护"}
          </p>
        </article>
        <article className="readiness-card">
          <small>订阅状态</small>
          <strong>
            {customer
              ? subscriptionStatusLabels[customer.subscriptionStatus]
              : "尚未配置"}
          </strong>
          <p>第 3 阶段将接入人工订阅记录。</p>
        </article>
      </div>

      <div className="dashboard-columns">
        <section className="module-card">
          <h2>工作区服务概览</h2>
          <p>以下状态来自当前工作区的数据库记录。</p>
          <ul className="foundation-checklist">
            <li><span>工作区状态</span><span className="check-state">{account.workspace.status}</span></li>
            <li><span>我的角色</span><span className="check-state">{account.membership.role}</span></li>
            <li><span>团队成员</span><span className="check-state">{members.length}</span></li>
            <li>
              <span>应用实例</span>
              <span className="check-state pending">
                {customer
                  ? appInstanceStatusLabels[customer.appInstanceStatus]
                  : "尚未开通"}
              </span>
            </li>
          </ul>
        </section>
        <aside className="module-card">
          <h2>阶段边界</h2>
          <p>当前套餐可读取，但订阅、付款和应用实例业务尚未接入。</p>
          <div className="notice notice-neutral">
            当前页面没有套餐购买或付款按钮，避免形成无法工作的入口。
          </div>
        </aside>
      </div>
    </>
  );
}
