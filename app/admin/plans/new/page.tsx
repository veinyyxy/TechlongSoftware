import type { Metadata } from "next";
import { PlanForm } from "@/components/admin/PlanForm";
import { getAdminAccount } from "@/lib/auth/account";

export const metadata: Metadata = { title: "新建套餐" };
export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  await getAdminAccount();

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW PLAN</p>
        <h1>新建套餐</h1>
        <p>配置真实价格、销售周期、功能和额度限制。</p>
      </header>
      <section className="form-panel">
        <PlanForm mode="create" />
      </section>
    </>
  );
}
