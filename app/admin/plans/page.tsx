import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { getAdminAccount } from "@/lib/auth/account";
import { listPlans, type PlanStatus } from "@/lib/admin/management";
import {
  billingIntervalLabels,
  formatMoney,
  planStatusLabels,
} from "@/lib/admin/presentation";
import { isPlanStatus } from "@/lib/admin/validation";
import { getDeploymentProfile } from "@/lib/deployments/profiles";

export const metadata: Metadata = { title: "套餐管理" };
export const dynamic = "force-dynamic";

interface PlansPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: PlanStatus | "" = isPlanStatus(params.status)
    ? params.status
    : "";
  const plans = await listPlans({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">PLAN CATALOG</p>
          <h1>套餐管理</h1>
          <p>价格、功能和限制均从数据库读取并由管理员维护。</p>
        </div>
        <Link className="button button-dark button-small" href="/admin/plans/new">
          新建套餐
        </Link>
      </header>

      <AdminSearchFilters
        action="/admin/plans"
        query={query}
        queryPlaceholder="套餐名称或说明"
        status={status}
        statusOptions={[
          { value: "active", label: "已启用" },
          { value: "inactive", label: "已停用" },
        ]}
      />

      <section className="plan-grid">
        {plans.map((plan) => (
          <article className="plan-card" key={plan.id}>
            <div className="plan-card-heading">
              <div>
                <span className={`status-pill status-${plan.status}`}>
                  {planStatusLabels[plan.status]}
                </span>
                <p className="page-kicker">{plan.productName}</p>
                <h2>{plan.name}</h2>
                <span>
                  模板：{plan.templateName} · v{plan.templateVersion}
                </span>
              </div>
              <strong>
                {formatMoney(plan.priceAmount, plan.currency)}
                <small>/{billingIntervalLabels[plan.billingInterval]}</small>
              </strong>
            </div>
            <p>{plan.description || "暂无套餐说明"}</p>
            <div className="plan-summary">
              <span>{plan.features.length} 项功能</span>
              <span>{Object.keys(plan.limits).length} 项限制</span>
              <span>
                {Object.keys(plan.templateConfiguration).length} 项模板默认参数
              </span>
              <span>{getDeploymentProfile(plan.deploymentProfileKey).label}</span>
            </div>
            {plan.features.length ? (
              <ul className="value-list compact-list">
                {plan.features.slice(0, 4).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : null}
            <div className="plan-card-actions">
              <Link
                className="button button-ghost button-small"
                href={`/admin/plans/${plan.id}/edit`}
              >
                编辑套餐
              </Link>
              <StatusActionButton
                confirmMessage={
                  plan.status === "active"
                    ? `确认停用“${plan.name}”吗？停用后它不会出现在可选的有效套餐中。`
                    : `确认重新启用“${plan.name}”吗？`
                }
                endpoint={`/api/admin/plans/${plan.id}`}
                label={plan.status === "active" ? "停用" : "启用"}
                nextStatus={plan.status === "active" ? "inactive" : "active"}
                tone={plan.status === "active" ? "danger" : "default"}
              />
            </div>
          </article>
        ))}
      </section>
      {!plans.length ? (
        <section className="empty-state standalone-empty">
          <strong>没有找到套餐</strong>
          <p>调整筛选条件，或者创建第一个可销售套餐。</p>
        </section>
      ) : null}
    </>
  );
}
