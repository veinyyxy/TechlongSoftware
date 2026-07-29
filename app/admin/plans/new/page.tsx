import type { Metadata } from "next";
import { PlanForm } from "@/components/admin/PlanForm";
import { getAdminAccount } from "@/lib/auth/account";
import { listProducts } from "@/lib/instances/management";
import { listAppInstanceTemplateVersions } from "@/lib/templates/management";

export const metadata: Metadata = { title: "新建套餐" };
export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  await getAdminAccount();
  const [products, templateVersions] = await Promise.all([
    listProducts({ status: "active" }),
    listAppInstanceTemplateVersions({ status: "published" }),
  ]);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW PLAN</p>
        <h1>新建套餐</h1>
        <p>选择实例模板后配置套餐参数、真实价格、销售周期、功能和额度限制。</p>
      </header>
      <section className="form-panel">
        {products.length && templateVersions.length ? (
          <PlanForm
            mode="create"
            products={products.map(({ id, name, status }) => ({
              id,
              name,
              status,
            }))}
            templateVersions={templateVersions
              .filter(
                (version) =>
                  version.templateStatus === "active" &&
                  version.productStatus === "active",
              )
              .map(({
                id,
                productId,
                templateName,
                version,
                configurationSchema,
                defaultConfiguration,
              }) => ({
                id,
                productId,
                templateName,
                version,
                configurationSchema,
                defaultConfiguration,
              }))}
          />
        ) : (
          <div className="empty-state">
            <strong>暂时无法创建套餐</strong>
            <p>
              需要先准备启用中的产品，并在实例模板管理中发布至少一个模板版本。
            </p>
          </div>
        )}
      </section>
    </>
  );
}
