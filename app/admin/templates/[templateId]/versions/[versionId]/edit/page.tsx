import type { Metadata } from "next";
import Link from "next/link";
import { AppInstanceTemplateVersionForm } from "@/components/admin/AppInstanceTemplateVersionForm";
import { getAdminAccount } from "@/lib/auth/account";
import { getAppInstanceTemplateVersion } from "@/lib/templates/management";

export const metadata: Metadata = { title: "编辑模板版本" };
export const dynamic = "force-dynamic";

interface EditTemplateVersionPageProps {
  params: Promise<{ templateId: string; versionId: string }>;
}

export default async function EditTemplateVersionPage({
  params,
}: EditTemplateVersionPageProps) {
  await getAdminAccount();
  const { templateId, versionId } = await params;
  const version = await getAppInstanceTemplateVersion(versionId);
  if (
    !version ||
    version.templateId !== templateId ||
    version.status !== "draft"
  ) {
    return (
      <section className="empty-state standalone-empty">
        <strong>这个模板版本不能编辑</strong>
        <p>只有草稿版本可以修改；已发布版本必须通过创建新版本升级。</p>
        <Link
          className="button button-dark button-small"
          href={`/admin/templates/${templateId}`}
        >
          返回模板详情
        </Link>
      </section>
    );
  }
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">EDIT BLUEPRINT VERSION</p>
        <h1>编辑 {version.templateName} · v{version.version}</h1>
        <p>可以继续保存草稿，也可以在校验通过后发布。</p>
      </header>
      <section className="form-panel">
        <AppInstanceTemplateVersionForm
          initial={{
            version: version.version,
            configurationSchema: version.configurationSchema,
            defaultConfiguration: version.defaultConfiguration,
            deploymentDriver: version.deploymentDriver,
            deploymentWorkflowVersion: version.deploymentWorkflowVersion,
            status: "draft",
          }}
          mode="edit"
          templateId={templateId}
          versionId={version.id}
        />
      </section>
    </>
  );
}
