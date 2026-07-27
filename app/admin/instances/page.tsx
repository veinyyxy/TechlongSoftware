import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { formatDate } from "@/lib/admin/presentation";
import { getAdminAccount } from "@/lib/auth/account";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import {
  listAppInstances,
  type AppInstanceStatus,
} from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import { isAppInstanceStatus } from "@/lib/instances/validation";

export const metadata: Metadata = { title: "应用实例管理" };
export const dynamic = "force-dynamic";

interface InstancesPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function InstancesPage({ searchParams }: InstancesPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: AppInstanceStatus | "" = isAppInstanceStatus(params.status)
    ? params.status
    : "";
  const instances = await listAppInstances({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">MANUAL PROVISIONING</p>
          <h1>应用实例管理</h1>
          <p>手动维护客户对应的餐饮订单系统入口与开通状态。</p>
        </div>
        <Link className="button button-dark button-small" href="/admin/instances/new">
          创建应用实例
        </Link>
      </header>

      <AdminSearchFilters
        action="/admin/instances"
        query={query}
        queryPlaceholder="客户、实例、路径、域名或租户标识"
        status={status}
        statusOptions={[
          { value: "pending", label: "等待开通" },
          { value: "active", label: "已开通" },
          { value: "suspended", label: "服务已暂停" },
          { value: "failed", label: "开通失败" },
        ]}
      />

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>餐饮订单系统实例</h2>
            <p>共显示 {instances.length} 条记录</p>
          </div>
        </div>
        {instances.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>企业客户</th>
                  <th>实例</th>
                  <th>状态</th>
                  <th>入口地址</th>
                  <th>关联订阅</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((instance) => (
                  <tr key={instance.id}>
                    <td>
                      <strong>{instance.workspaceName}</strong>
                      <span>{instance.workspaceStatus}</span>
                    </td>
                    <td>
                      <strong>{instance.name}</strong>
                      <span>{instance.productName} · {instance.tenantKey}</span>
                    </td>
                    <td>
                      <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
                        {appInstanceStatusLabels[instance.status]}
                      </span>
                    </td>
                    <td>
                      <strong>{instance.domain ?? instance.slug}</strong>
                      <span>{instance.accessUrl}</span>
                    </td>
                    <td>
                      {instance.subscriptionStatus
                        ? subscriptionStatusLabels[instance.subscriptionStatus]
                        : "未关联"}
                    </td>
                    <td>{formatDate(instance.updatedAt)} UTC</td>
                    <td>
                      <Link className="table-link" href={`/admin/instances/${instance.id}`}>
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
            <strong>没有找到应用实例</strong>
            <p>调整筛选条件，或者为客户创建第一条餐饮订单系统实例。</p>
          </div>
        )}
      </section>
      <div className="notice billing-disclaimer">
        本阶段只保存客户入口和手动开通状态，不会执行真实部署或调用任何云服务。
      </div>
    </>
  );
}
