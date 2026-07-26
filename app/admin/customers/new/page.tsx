import type { Metadata } from "next";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listPlans } from "@/lib/admin/management";

export const metadata: Metadata = { title: "新建客户" };
export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  await getAdminAccount();
  const plans = await listPlans();

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW CUSTOMER</p>
        <h1>新建企业客户</h1>
        <p>创建企业工作区、负责人账号和 Owner 成员关系。</p>
      </header>
      <section className="form-panel">
        <CustomerForm
          mode="create"
          plans={plans.map(({ id, name, status }) => ({ id, name, status }))}
        />
      </section>
    </>
  );
}
