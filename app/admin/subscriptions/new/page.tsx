import type { Metadata } from "next";
import { SubscriptionForm } from "@/components/admin/SubscriptionForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listCustomers, listPlans } from "@/lib/admin/management";
import { listProducts } from "@/lib/instances/management";

export const metadata: Metadata = { title: "新建订阅" };
export const dynamic = "force-dynamic";

interface NewSubscriptionPageProps {
  searchParams?: Promise<{ workspaceId?: string }>;
}

export default async function NewSubscriptionPage({
  searchParams,
}: NewSubscriptionPageProps) {
  await getAdminAccount();
  const requestedWorkspaceId = (await searchParams)?.workspaceId ?? "";
  const [customers, products, plans] = await Promise.all([
    listCustomers(),
    listProducts({ status: "active" }),
    listPlans({ status: "active" }),
  ]);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW MANUAL SUBSCRIPTION</p>
        <h1>创建客户订阅</h1>
        <p>选择企业客户、产品和套餐。已取消的历史订阅会保留，不会阻止客户重新订阅同一产品。</p>
      </header>
      <section className="form-panel">
        {customers.length && products.length && plans.length ? (
          <SubscriptionForm
            customers={customers.map(({ id, name }) => ({ id, name }))}
            defaultWorkspaceId={
              customers.some((customer) => customer.id === requestedWorkspaceId)
                ? requestedWorkspaceId
                : undefined
            }
            mode="create"
            plans={plans.map(({ id, name, productId }) => ({
              id,
              name,
              productId,
            }))}
            products={products.map(({ id, name, status }) => ({ id, name, status }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建订阅</strong>
            <p>
              需要至少一个企业客户、一个启用产品和一个启用套餐。
            </p>
          </div>
        )}
      </section>
    </>
  );
}
