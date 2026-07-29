import type { Metadata } from "next";
import Link from "next/link";
import { AppInstanceTemplateVersionForm } from "@/components/admin/AppInstanceTemplateVersionForm";
import { getAdminAccount } from "@/lib/auth/account";
import {
  getAppInstanceTemplate,
  listAppInstanceTemplateVersions,
} from "@/lib/templates/management";

export const metadata: Metadata = { title: "新建模板版本" };
export const dynamic = "force-dynamic";

interface NewTemplateVersionPageProps {
  params: Promise<{ templateId: string }>;
}

export default async function NewTemplateVersionPage({
  params,
}: NewTemplateVersionPageProps) {
  await getAdminAccount();
  const { templateId } = await params;
  const [template, versions] = await Promise.all([
    getAppInstanceTemplate(templateId),
    listAppInstanceTemplateVersions({ templateId }),
  ]);
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
  const nextVersion = Math.max(0, ...versions.map((version) => version.version)) + 1;
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">NEW BLUEPRINT VERSION</p>
        <h1>为 {template.name} 创建版本</h1>
        <p>版本发布后不可修改；后续调整必须创建更高版本。</p>
      </header>
      <section className="form-panel">
        <AppInstanceTemplateVersionForm
          defaultVersion={nextVersion}
          mode="create"
          templateId={template.id}
        />
      </section>
    </>
  );
}
