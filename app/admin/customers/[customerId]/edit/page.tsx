import type { Metadata } from "next";
import Link from "next/link";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { getAdminAccount } from "@/lib/auth/account";
import { getCustomer, listPlans } from "@/lib/admin/management";

export const metadata: Metadata = { title: "编辑客户" };
export const dynamic = "force-dynamic";

interface EditCustomerPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function EditCustomerPage({
  params,
}: EditCustomerPageProps) {
  await getAdminAccount();
  const { customerId } = await params;
  const [customer, plans] = await Promise.all([
    getCustomer(customerId),
    listPlans(),
  ]);

  if (!customer) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该客户</strong>
        <Link className="button button-dark button-small" href="/admin/customers">
          返回客户列表
        </Link>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT CUSTOMER</p>
        <h1>编辑客户资料</h1>
        <p>更新企业联系人和当前套餐，不会触发订阅或付款逻辑。</p>
      </header>
      <section className="form-panel">
        <CustomerForm
          customerId={customer.id}
          initial={{
            name: customer.name,
            contactName: customer.contactName,
            contactEmail: customer.contactEmail,
            planId: customer.planId,
          }}
          mode="edit"
          plans={plans.map(({ id, name, status }) => ({ id, name, status }))}
        />
      </section>
    </>
  );
}
