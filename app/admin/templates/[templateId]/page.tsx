import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { formatDate } from "@/lib/admin/presentation";
import { getAdminAccount } from "@/lib/auth/account";
import {
  getAppInstanceTemplate,
  listAppInstanceTemplateVersions,
} from "@/lib/templates/management";

export const metadata: Metadata = { title: "应用实例模板详情" };
export const dynamic = "force-dynamic";

interface TemplateDetailPageProps {
  params: Promise<{ templateId: string }>;
}

const versionStatusLabel = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
} as const;

export default async function TemplateDetailPage({
  params,
}: TemplateDetailPageProps) {
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

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">INSTANCE BLUEPRINT DETAIL</p>
          <h1>{template.name}</h1>
          <p>{template.productName} · {template.description || "暂无说明"}</p>
        </div>
        <div className="header-actions">
          <Link
            className="button button-ghost button-small"
            href={`/admin/templates/${template.id}/edit`}
          >
            编辑模板
          </Link>
          <Link
            className="button button-dark button-small"
            href={`/admin/templates/${template.id}/versions/new`}
          >
            创建新版本
          </Link>
        </div>
      </header>
      <div className="notice notice-neutral">
        已发布版本不可修改。套餐绑定具体版本，历史实例保留创建时的模板版本与配置快照。
      </div>
      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>模板版本</h2>
            <p>共 {versions.length} 个版本</p>
          </div>
        </div>
        {versions.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>配置字段</th>
                  <th>部署标识</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td><strong>v{version.version}</strong></td>
                    <td>
                      <strong>{version.configurationSchema.fields.length} 个字段</strong>
                      <span>
                        {version.configurationSchema.fields
                          .map((field) => field.label)
                          .join("、") || "无客户配置字段"}
                      </span>
                    </td>
                    <td>
                      <strong>{version.deploymentDriver}</strong>
                      <span>{version.deploymentWorkflowVersion}</span>
                    </td>
                    <td>
                      <span className={`status-pill status-${version.status}`}>
                        {versionStatusLabel[version.status]}
                      </span>
                    </td>
                    <td>{formatDate(version.updatedAt)} UTC</td>
                    <td>
                      <div className="table-actions">
                        {version.status === "draft" ? (
                          <Link
                            className="table-link"
                            href={`/admin/templates/${template.id}/versions/${version.id}/edit`}
                          >
                            编辑草稿
                          </Link>
                        ) : null}
                        {version.status === "published" ? (
                          <StatusActionButton
                            confirmMessage={`确认归档模板版本 v${version.version} 吗？已绑定套餐和实例仍会保留该版本。`}
                            endpoint={`/api/admin/templates/${template.id}/versions/${version.id}`}
                            label="归档"
                            nextStatus="archived"
                            tone="danger"
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>尚未创建模板版本</strong>
            <p>创建第一个版本并发布后，套餐才能关联这个模板。</p>
          </div>
        )}
      </section>
    </>
  );
}
