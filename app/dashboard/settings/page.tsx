import type { Metadata } from "next";
import { getDashboardAccount } from "@/lib/auth/account";
import { canManageWorkspace } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "工作区设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const account = await getDashboardAccount();
  const canManage = canManageWorkspace(account.membership.role);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">WORKSPACE SETTINGS</p>
        <h1>工作区设置</h1>
        <p>本阶段提供真实工作区信息和权限状态，不开放后续业务配置。</p>
      </header>
      <section className="settings-grid">
        <article className="module-card">
          <h2>企业资料</h2>
          <dl className="detail-list">
            <div><dt>工作区名称</dt><dd>{account.workspace.name}</dd></div>
            <div><dt>工作区状态</dt><dd>{account.workspace.status}</dd></div>
            <div><dt>工作区编号</dt><dd><code>{account.workspace.id}</code></dd></div>
          </dl>
        </article>
        <article className="module-card">
          <h2>我的权限</h2>
          <dl className="detail-list">
            <div><dt>成员角色</dt><dd>{account.membership.role}</dd></div>
            <div><dt>管理企业资料</dt><dd>{canManage ? "允许" : "不允许"}</dd></div>
            <div><dt>跨工作区访问</dt><dd>禁止</dd></div>
          </dl>
        </article>
      </section>
    </>
  );
}
