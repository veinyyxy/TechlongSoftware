import type { Metadata } from "next";
import { SubscriptionForm } from "@/components/admin/SubscriptionForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listCustomers, listPlans } from "@/lib/admin/management";
import { listSubscriptions } from "@/lib/billing/management";

export const metadata: Metadata = { title: "新建订阅" };
export const dynamic = "force-dynamic";

export default async function NewSubscriptionPage() {
  await getAdminAccount();
  const [customers, plans, subscriptions] = await Promise.all([
    listCustomers(),
    listPlans({ status: "active" }),
    listSubscriptions(),
  ]);
  const subscribedWorkspaceIds = new Set(
    subscriptions.map((subscription) => subscription.workspaceId),
  );
  const availableCustomers = customers.filter(
    (customer) => !subscribedWorkspaceIds.has(customer.id),
  );

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW MANUAL SUBSCRIPTION</p>
        <h1>创建客户订阅</h1>
        <p>选择企业客户和套餐，默认创建“人工待确认”订阅，供客户确认套餐选项并完成 Stripe 付款。</p>
      </header>
      <section className="form-panel">
        {availableCustomers.length && plans.length ? (
          <SubscriptionForm
            customers={availableCustomers.map(({ id, name }) => ({ id, name }))}
            mode="create"
            plans={plans.map(({ id, name }) => ({ id, name }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建订阅</strong>
            <p>
              需要至少一个启用套餐，以及一个尚未创建订阅的企业客户。
            </p>
          </div>
        )}
      </section>
    </>
  );
}
