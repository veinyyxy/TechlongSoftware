import type { Metadata } from "next";
import { AppInstanceForm } from "@/components/admin/AppInstanceForm";
import { listCustomers } from "@/lib/admin/management";
import { getAdminAccount } from "@/lib/auth/account";
import { listSubscriptions } from "@/lib/billing/management";
import { listProducts } from "@/lib/instances/management";

export const metadata: Metadata = { title: "创建应用实例" };
export const dynamic = "force-dynamic";

export default async function NewInstancePage() {
  await getAdminAccount();
  const [customers, products, subscriptions] = await Promise.all([
    listCustomers(),
    listProducts({ status: "active" }),
    listSubscriptions(),
  ]);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW APP INSTANCE</p>
        <h1>创建餐饮订单系统实例</h1>
        <p>手动登记客户入口和租户标识，不会自动部署应用。</p>
      </header>
      <section className="form-panel">
        {customers.length && products.length ? (
          <AppInstanceForm
            customers={customers.map(({ id, name }) => ({ id, name }))}
            mode="create"
            products={products.map(({ id, name }) => ({ id, name }))}
            subscriptions={subscriptions.map((subscription) => ({
              id: subscription.id,
              workspaceId: subscription.workspaceId,
              planName: subscription.planName,
              status: subscription.status,
            }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建实例</strong>
            <p>需要至少一个企业客户和启用中的餐饮订单系统产品。</p>
          </div>
        )}
      </section>
    </>
  );
}
