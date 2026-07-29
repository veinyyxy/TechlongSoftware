import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerPurchaseForm } from "@/components/billing/CustomerPurchaseForm";
import { getPlan } from "@/lib/admin/management";
import { formatMoney } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import {
  getSubscription,
  getWorkspaceProductCurrentSubscription,
} from "@/lib/billing/management";

export const metadata: Metadata = { title: "确认套餐购买" };
export const dynamic = "force-dynamic";

interface PurchasePageProps {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ renew?: string }>;
}

export default async function PurchasePage({
  params,
  searchParams,
}: PurchasePageProps) {
  const account = await getDashboardAccount();
  const { planId } = await params;
  const query = await searchParams;
  const plan = await getPlan(planId);
  if (
    !plan ||
    plan.status !== "active" ||
    plan.productStatus !== "active" ||
    plan.templateStatus !== "active" ||
    plan.templateVersionStatus !== "published"
  ) {
    notFound();
  }
  const renewal = query.renew
    ? await getSubscription(query.renew)
    : null;
  const validRenewal =
    renewal &&
    renewal.workspaceId === account.workspace.id &&
    renewal.planId === plan.id &&
    renewal.productId === plan.productId &&
    (renewal.status === "active" || renewal.status === "past_due")
      ? renewal
      : null;
  const current = await getWorkspaceProductCurrentSubscription(
    account.workspace.id,
    plan.productId,
  );
  const blockedByCurrent = current && !validRenewal;
  const initialConfiguration = validRenewal
    ? validRenewal.instanceConfiguration
    : {
        ...plan.templateDefaultConfiguration,
        ...plan.templateConfiguration,
        ...Object.fromEntries(
          plan.templateConfigurationSchema.fields
            .filter((field) => field.source === "plan_limit")
            .map((field) => [
              field.key,
              plan.limits[field.limitKey ?? ""] ?? "",
            ]),
        ),
      };

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">
          {validRenewal ? "RENEW SUBSCRIPTION" : "PURCHASE PLAN"}
        </p>
        <h1>{validRenewal ? "确认续费" : "配置并购买套餐"}</h1>
        <p>
          {plan.productName} · {plan.name} ·{" "}
          {formatMoney(plan.priceAmount, plan.currency)}/
          {plan.billingInterval === "year" ? "年" : "月"}
        </p>
      </header>

      <section className="form-panel">
        <div className="data-panel-heading">
          <div>
            <h2>应用实例参数</h2>
            <p>
              {validRenewal
                ? "续费沿用当前实例配置，不在本流程中更换套餐或模板。"
                : `参数来自 ${plan.templateName} · v${plan.templateVersion}，付款后会保存为待开通实例快照。`}
            </p>
          </div>
        </div>
        {blockedByCurrent ? (
          <div className="notice notice-warning billing-alert">
            <strong>该产品已有当前订阅</strong>
            <span>请返回订阅与账单页面进行续费或管理。</span>
          </div>
        ) : account.membership.role !== "owner" ? (
          <div className="notice notice-warning billing-alert">
            <strong>当前账号只有查看权限</strong>
            <span>只有工作区 Owner 可以购买或续费套餐。</span>
          </div>
        ) : (
          <CustomerPurchaseForm
            endpoint={`/api/workspaces/${account.workspace.id}/purchase-orders`}
            initialConfiguration={initialConfiguration}
            planId={plan.id}
            planName={`${plan.productName} · ${plan.name}`}
            renewalSubscriptionId={validRenewal?.id}
            schema={plan.templateConfigurationSchema}
          />
        )}
      </section>
      <div className="header-actions">
        <Link className="button button-ghost" href="/dashboard/plans">
          返回套餐列表
        </Link>
      </div>
    </>
  );
}
