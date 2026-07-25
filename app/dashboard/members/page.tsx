import type { Metadata } from "next";
import {
  getDashboardAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";

export const metadata: Metadata = { title: "团队成员" };
export const dynamic = "force-dynamic";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export default async function MembersPage() {
  const account = await getDashboardAccount();
  const members = await listWorkspaceMembers(account.workspace.id);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">WORKSPACE MEMBERS</p>
        <h1>团队成员</h1>
        <p>只显示当前企业工作区中的成员。成员邀请将在后续阶段实现。</p>
      </header>
      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>{account.workspace.name}</h2>
            <p>{members.length} 位成员</p>
          </div>
          <span className="status-pill status-active">权限已隔离</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>账号状态</th>
                <th>加入时间</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                  </td>
                  <td><span className="role-badge">{member.role}</span></td>
                  <td>{member.status}</td>
                  <td>{formatDate(member.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
