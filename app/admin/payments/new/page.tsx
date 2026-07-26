import type { Metadata } from "next";
import { PaymentForm } from "@/components/admin/PaymentForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listCustomers } from "@/lib/admin/management";
import { listSubscriptions } from "@/lib/billing/management";

export const metadata: Metadata = { title: "新增付款记录" };
export const dynamic = "force-dynamic";

export default async function NewPaymentPage() {
  await getAdminAccount();
  const [customers, subscriptions] = await Promise.all([
    listCustomers(),
    listSubscriptions(),
  ]);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW MANUAL PAYMENT</p>
        <h1>新增付款记录</h1>
        <p>手动记录客户付款结果，不会发起扣款。</p>
      </header>
      <section className="form-panel">
        {customers.length ? (
          <PaymentForm
            customers={customers.map(({ id, name }) => ({ id, name }))}
            subscriptions={subscriptions.map((subscription) => ({
              id: subscription.id,
              workspaceId: subscription.workspaceId,
              workspaceName: subscription.workspaceName,
              planName: subscription.planName,
            }))}
          />
        ) : (
          <div className="empty-state">
            <strong>尚无企业客户</strong>
            <p>请先创建客户工作区，再录入付款记录。</p>
          </div>
        )}
      </section>
    </>
  );
}
