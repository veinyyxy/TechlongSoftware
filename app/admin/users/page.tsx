import type { Metadata } from "next";
import { getAdminAccount, listAdminUsers } from "@/lib/auth/account";

export const metadata: Metadata = { title: "用户账号" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await getAdminAccount();
  const users = await listAdminUsers();

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">PLATFORM USERS</p>
        <h1>用户账号</h1>
        <p>平台管理员可查看已登录并同步到平台的账号。</p>
      </header>
      <section className="data-panel">
        <div className="data-panel-heading">
          <div><h2>账号列表</h2><p>最多显示最近 100 个账号</p></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>用户</th><th>平台角色</th><th>状态</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong><span>{user.email}</span></td>
                  <td>{user.isPlatformAdmin ? <span className="role-badge">platform_admin</span> : "客户用户"}</td>
                  <td>{user.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
