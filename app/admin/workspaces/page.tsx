import type { Metadata } from "next";
import {
  getAdminAccount,
  listAdminWorkspaces,
} from "@/lib/auth/account";

export const metadata: Metadata = { title: "企业工作区" };
export const dynamic = "force-dynamic";

export default async function AdminWorkspacesPage() {
  await getAdminAccount();
  const workspaces = await listAdminWorkspaces();

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">TENANT BOUNDARIES</p>
        <h1>企业工作区</h1>
        <p>平台范围的工作区只读视图；编辑和客户管理属于第 2 阶段。</p>
      </header>
      <section className="data-panel">
        <div className="data-panel-heading">
          <div><h2>工作区列表</h2><p>每个工作区是独立的数据隔离边界</p></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>工作区</th><th>Owner</th><th>成员</th><th>状态</th></tr></thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td><strong>{workspace.name}</strong><span>{workspace.id}</span></td>
                  <td><strong>{workspace.ownerName}</strong><span>{workspace.ownerEmail}</span></td>
                  <td>{workspace.memberCount}</td>
                  <td>{workspace.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
