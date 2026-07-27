import type { Metadata } from "next";
import Link from "next/link";
import { AppInstanceForm } from "@/components/admin/AppInstanceForm";
import { listCustomers } from "@/lib/admin/management";
import { getAdminAccount } from "@/lib/auth/account";
import { listSubscriptions } from "@/lib/billing/management";
import { getAppInstance, listProducts } from "@/lib/instances/management";

export const metadata: Metadata = { title: "编辑应用实例" };
export const dynamic = "force-dynamic";

interface EditInstancePageProps {
  params: Promise<{ instanceId: string }>;
}

export default async function EditInstancePage({ params }: EditInstancePageProps) {
  await getAdminAccount();
  const { instanceId } = await params;
  const [instance, customers, products, subscriptions] = await Promise.all([
    getAppInstance(instanceId),
    listCustomers(),
    listProducts(),
    listSubscriptions(),
  ]);

  if (!instance) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该应用实例</strong>
        <Link className="button button-dark button-small" href="/admin/instances">
          返回应用实例列表
        </Link>
      </section>
    );
  }

  const availableProducts = products.filter(
    (product) => product.status === "active" || product.id === instance.productId,
  );

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT APP INSTANCE</p>
        <h1>编辑应用实例</h1>
        <p>可调整入口、租户标识和状态；客户工作区不能在编辑时转移。</p>
      </header>
      <section className="form-panel">
        <AppInstanceForm
          customers={customers.map(({ id, name }) => ({ id, name }))}
          initial={{
            workspaceId: instance.workspaceId,
            workspaceName: instance.workspaceName,
            productId: instance.productId,
            subscriptionId: instance.subscriptionId,
            name: instance.name,
            slug: instance.slug,
            domain: instance.domain,
            accessUrl: instance.accessUrl,
            tenantKey: instance.tenantKey,
            status: instance.status,
          }}
          instanceId={instance.id}
          mode="edit"
          products={availableProducts.map(({ id, name }) => ({ id, name }))}
          subscriptions={subscriptions.map((subscription) => ({
            id: subscription.id,
            workspaceId: subscription.workspaceId,
            planName: subscription.planName,
            status: subscription.status,
          }))}
        />
      </section>
    </>
  );
}
