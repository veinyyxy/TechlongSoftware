import type { Metadata } from "next";
import { AppInstanceForm } from "@/components/admin/AppInstanceForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listSubscriptions } from "@/lib/billing/management";
import { listAppInstances } from "@/lib/instances/management";

export const metadata: Metadata = { title: "创建应用实例" };
export const dynamic = "force-dynamic";

export default async function NewInstancePage() {
  await getAdminAccount();
  const [subscriptions, instances] = await Promise.all([
    listSubscriptions(),
    listAppInstances(),
  ]);
  const eligibleSubscriptions = subscriptions.filter(
    (subscription) =>
      subscription.status !== "canceled" &&
      !instances.some(
        (instance) =>
          instance.workspaceId === subscription.workspaceId &&
          instance.productId === subscription.productId,
      ),
  );

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW APP INSTANCE</p>
        <h1>补建餐饮订单系统实例</h1>
        <p>
          仅用于补建未自动生成的订阅实例；企业、产品和套餐由所选订阅自动确定。
        </p>
      </header>
      <section className="form-panel">
        {eligibleSubscriptions.length ? (
          <AppInstanceForm
            mode="create"
            products={[]}
            subscriptions={eligibleSubscriptions.map((subscription) => ({
              id: subscription.id,
              workspaceId: subscription.workspaceId,
              workspaceName: subscription.workspaceName,
              productId: subscription.productId,
              productName: subscription.productName,
              planName: subscription.planName,
              status: subscription.status,
            }))}
          />
        ) : (
          <div className="empty-state">
            <strong>没有需要补建的应用实例</strong>
            <p>
              真实付款成功后系统会自动创建待开通实例；已有实例或已取消订阅不会在这里重复显示。
            </p>
          </div>
        )}
      </section>
    </>
  );
}
