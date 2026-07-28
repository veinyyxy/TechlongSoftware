import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { getAdminAccount } from "@/lib/auth/account";
import {
  listCustomers,
  type WorkspaceStatus,
} from "@/lib/admin/management";
import {
  appInstanceStatusLabels,
  workspaceStatusLabels,
} from "@/lib/admin/presentation";
import { isWorkspaceStatus } from "@/lib/admin/validation";

export const metadata: Metadata = { title: "客户管理" };
export const dynamic = "force-dynamic";

interface CustomersPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function CustomersPage({
  searchParams,
}: CustomersPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: WorkspaceStatus | "" = isWorkspaceStatus(params.status)
    ? params.status
    : "";
  const customers = await listCustomers({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">CUSTOMER OPERATIONS</p>
          <h1>客户管理</h1>
          <p>创建和维护企业工作区，并查看当前服务状态。</p>
        </div>
        <Link className="button button-dark button-small" href="/admin/customers/new">
          新建客户
        </Link>
      </header>

      <AdminSearchFilters
        action="/admin/customers"
        query={query}
        queryPlaceholder="企业、联系人或邮箱"
        status={status}
        statusOptions={[
          { value: "active", label: "正常" },
          { value: "suspended", label: "已暂停" },
          { value: "disabled", label: "已停用" },
        ]}
      />

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>企业客户</h2>
            <p>共显示 {customers.length} 个匹配工作区</p>
          </div>
        </div>
        {customers.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>企业客户</th>
                  <th>当前订阅</th>
                  <th>应用状态</th>
                  <th>客户状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name}</strong>
                      <span>
                        {customer.contactName} · {customer.contactEmail}
                      </span>
                    </td>
                    <td>
                      {customer.currentSubscriptionCount
                        ? `${customer.currentSubscriptionCount} 个产品`
                        : "暂无当前订阅"}
                    </td>
                    <td>
                      {appInstanceStatusLabels[customer.appInstanceStatus]}
                    </td>
                    <td>
                      <span className={`status-pill status-${customer.status}`}>
                        {workspaceStatusLabels[customer.status]}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={`/admin/customers/${customer.id}`}
                      >
                        查看详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>没有找到客户</strong>
            <p>调整搜索条件，或者创建第一个企业客户。</p>
          </div>
        )}
      </section>
    </>
  );
}
