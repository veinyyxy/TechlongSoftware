import type { Metadata } from "next";
import Link from "next/link";
import { AppInstanceTemplateForm } from "@/components/admin/AppInstanceTemplateForm";
import { getAdminAccount } from "@/lib/auth/account";
import { getAppInstanceTemplate } from "@/lib/templates/management";

export const metadata: Metadata = { title: "编辑应用实例模板" };
export const dynamic = "force-dynamic";

interface EditTemplatePageProps {
  params: Promise<{ templateId: string }>;
}

export default async function EditTemplatePage({
  params,
}: EditTemplatePageProps) {
  await getAdminAccount();
  const { templateId } = await params;
  const template = await getAppInstanceTemplate(templateId);
  if (!template) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该实例模板</strong>
        <Link className="button button-dark button-small" href="/admin/templates">
          返回模板列表
        </Link>
      </section>
    );
  }
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT INSTANCE BLUEPRINT</p>
        <h1>编辑 {template.name}</h1>
        <p>产品归属不可修改；版本内容在各自版本中管理。</p>
      </header>
      <section className="form-panel">
        <AppInstanceTemplateForm
          initial={{
            productId: template.productId,
            productName: template.productName,
            name: template.name,
            description: template.description,
            status: template.status,
          }}
          mode="edit"
          products={[]}
          templateId={template.id}
        />
      </section>
    </>
  );
}
