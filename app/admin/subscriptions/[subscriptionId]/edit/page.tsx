import type { Metadata } from "next";
import Link from "next/link";
import { SubscriptionForm } from "@/components/admin/SubscriptionForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listPlans } from "@/lib/admin/management";
import { getSubscription } from "@/lib/billing/management";

export const metadata: Metadata = { title: "编辑订阅" };
export const dynamic = "force-dynamic";

interface EditSubscriptionPageProps {
  params: Promise<{ subscriptionId: string }>;
}

export default async function EditSubscriptionPage({
  params,
}: EditSubscriptionPageProps) {
  await getAdminAccount();
  const { subscriptionId } = await params;
  const [subscription, plans] = await Promise.all([
    getSubscription(subscriptionId),
    listPlans(),
  ]);

  if (!subscription) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该订阅</strong>
        <Link
          className="button button-dark button-small"
          href="/admin/subscriptions"
        >
          返回订阅列表
        </Link>
      </section>
    );
  }

  if (subscription.status === "canceled") {
    return (
      <section className="empty-state standalone-empty">
        <strong>历史订阅不能编辑</strong>
        <p>已取消订阅会原样保留用于账单和审计；如需重新订阅，请创建一条新记录。</p>
        <Link
          className="button button-dark button-small"
          href={`/admin/subscriptions/${subscription.id}`}
        >
          返回订阅详情
        </Link>
      </section>
    );
  }

  const availablePlans = plans.filter(
    (plan) =>
      plan.productId === subscription.productId &&
      (plan.status === "active" || plan.id === subscription.planId),
  );

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT MANUAL SUBSCRIPTION</p>
        <h1>编辑订阅</h1>
        <p>更新套餐、周期和状态；客户工作区不能在编辑时转移。</p>
      </header>
      <section className="form-panel">
        <SubscriptionForm
          key={subscription.id}
          customers={[]}
          initial={{
            workspaceId: subscription.workspaceId,
            workspaceName: subscription.workspaceName,
            productId: subscription.productId,
            productName: subscription.productName,
            planId: subscription.planId,
            instanceConfiguration: subscription.instanceConfiguration,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }}
          mode="edit"
          plans={availablePlans.map(({
            id,
            name,
            productId,
            templateVersionId,
            templateName,
            templateVersion,
            templateConfigurationSchema,
            templateDefaultConfiguration,
            templateConfiguration,
            limits,
          }) => ({
            id,
            name,
            productId,
            templateVersionId,
            templateName,
            templateVersion,
            templateConfigurationSchema,
            templateDefaultConfiguration,
            templateConfiguration,
            limits,
          }))}
          products={[]}
          subscriptionId={subscription.id}
        />
      </section>
    </>
  );
}
