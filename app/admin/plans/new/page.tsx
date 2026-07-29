import type { Metadata } from "next";
import { PlanForm } from "@/components/admin/PlanForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listProducts } from "@/lib/instances/management";

export const metadata: Metadata = { title: "新建套餐" };
export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  await getAdminAccount();
  const products = await listProducts({ status: "active" });

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW PLAN</p>
        <h1>新建套餐</h1>
        <p>配置真实价格、销售周期、功能和额度限制。</p>
      </header>
      <section className="form-panel">
        {products.length ? (
          <PlanForm
            mode="create"
            products={products.map(({ id, name, status }) => ({
              id,
              name,
              status,
            }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建套餐</strong>
            <p>需要先准备至少一个启用中的产品。</p>
          </div>
        )}
      </section>
    </>
  );
}
