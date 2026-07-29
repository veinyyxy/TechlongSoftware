import type { Metadata } from "next";
import { AppInstanceTemplateForm } from "@/components/admin/AppInstanceTemplateForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listProducts } from "@/lib/instances/management";

export const metadata: Metadata = { title: "新建应用实例模板" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await getAdminAccount();
  const products = await listProducts({ status: "active" });
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW INSTANCE BLUEPRINT</p>
        <h1>新建应用实例模板</h1>
        <p>先创建产品级模板，再为模板创建并发布不可变版本。</p>
      </header>
      <section className="form-panel">
        {products.length ? (
          <AppInstanceTemplateForm
            mode="create"
            products={products.map(({ id, name }) => ({ id, name }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建模板</strong>
            <p>需要至少一个启用中的产品。</p>
          </div>
        )}
      </section>
    </>
  );
}
