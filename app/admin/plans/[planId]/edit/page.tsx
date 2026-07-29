import type { Metadata } from "next";
import Link from "next/link";
import { PlanForm } from "@/components/admin/PlanForm";
import { getAdminAccount } from "@/lib/auth/account";
import { getPlan } from "@/lib/admin/management";

export const metadata: Metadata = { title: "编辑套餐" };
export const dynamic = "force-dynamic";

interface EditPlanPageProps {
  params: Promise<{ planId: string }>;
}

export default async function EditPlanPage({ params }: EditPlanPageProps) {
  await getAdminAccount();
  const { planId } = await params;
  const plan = await getPlan(planId);

  if (!plan) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该套餐</strong>
        <Link className="button button-dark button-small" href="/admin/plans">
          返回套餐列表
        </Link>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT PLAN</p>
        <h1>编辑 {plan.name}</h1>
        <p>修改后列表和客户详情将读取最新数据库内容。</p>
      </header>
      <section className="form-panel">
        <PlanForm
          initial={{
            productId: plan.productId,
            productName: plan.productName,
            name: plan.name,
            description: plan.description,
            priceAmount: plan.priceAmount,
            currency: plan.currency,
            billingInterval: plan.billingInterval,
            features: plan.features,
            limits: plan.limits,
          }}
          mode="edit"
          planId={plan.id}
        />
      </section>
    </>
  );
}
