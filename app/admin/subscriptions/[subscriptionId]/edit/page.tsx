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

  const availablePlans = plans.filter(
    (plan) => plan.status === "active" || plan.id === subscription.planId,
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
          customers={[]}
          initial={{
            workspaceId: subscription.workspaceId,
            workspaceName: subscription.workspaceName,
            planId: subscription.planId,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }}
          mode="edit"
          plans={availablePlans.map(({ id, name }) => ({ id, name }))}
          subscriptionId={subscription.id}
        />
      </section>
    </>
  );
}
