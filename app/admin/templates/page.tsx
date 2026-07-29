import type { Metadata } from "next";
import Link from "next/link";
import { AdminSearchFilters } from "@/components/admin/AdminSearchFilters";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { getAdminAccount } from "@/lib/auth/account";
import { listAppInstanceTemplates } from "@/lib/templates/management";
import {
  isTemplateStatus,
  type TemplateStatus,
} from "@/lib/templates/validation";

export const metadata: Metadata = { title: "应用实例模板管理" };
export const dynamic = "force-dynamic";

interface TemplatesPageProps {
  searchParams?: Promise<{ q?: string; status?: string }>;
}

export default async function TemplatesPage({
  searchParams,
}: TemplatesPageProps) {
  await getAdminAccount();
  const params = (await searchParams) ?? {};
  const query = params.q?.slice(0, 100) ?? "";
  const status: TemplateStatus | "" = isTemplateStatus(params.status)
    ? params.status
    : "";
  const templates = await listAppInstanceTemplates({ query, status });

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">INSTANCE BLUEPRINTS</p>
          <h1>应用实例模板管理</h1>
          <p>维护产品实例蓝图、配置字段和不可变的发布版本。</p>
        </div>
        <Link
          className="button button-dark button-small"
          href="/admin/templates/new"
        >
          新建实例模板
        </Link>
      </header>
      <AdminSearchFilters
        action="/admin/templates"
        query={query}
        queryPlaceholder="模板名称、说明或产品"
        status={status}
        statusOptions={[
          { value: "active", label: "已启用" },
          { value: "inactive", label: "已停用" },
        ]}
      />
      <section className="data-panel">
        {templates.length ? (
          <div className="table-wrap">
            <table className="data-table data-table-wide">
              <thead>
                <tr>
                  <th>模板</th>
                  <th>所属产品</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                      <span>{template.description || "暂无说明"}</span>
                    </td>
                    <td>
                      <strong>{template.productName}</strong>
                      <span>产品{template.productStatus === "active" ? "已启用" : "已停用"}</span>
                    </td>
                    <td>
                      <strong>{template.versionCount} 个版本</strong>
                      <span>{template.publishedVersionCount} 个已发布</span>
                    </td>
                    <td>
                      <span className={`status-pill status-${template.status}`}>
                        {template.status === "active" ? "已启用" : "已停用"}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link
                          className="table-link"
                          href={`/admin/templates/${template.id}`}
                        >
                          查看版本
                        </Link>
                        <StatusActionButton
                          confirmMessage={
                            template.status === "active"
                              ? `确认停用“${template.name}”吗？已绑定套餐仍保留历史关系，但不能再发布新版本或创建新订阅。`
                              : `确认启用“${template.name}”吗？`
                          }
                          endpoint={`/api/admin/templates/${template.id}`}
                          label={template.status === "active" ? "停用" : "启用"}
                          nextStatus={
                            template.status === "active" ? "inactive" : "active"
                          }
                          tone={template.status === "active" ? "danger" : "default"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>没有找到实例模板</strong>
            <p>调整筛选条件，或者创建第一个产品实例模板。</p>
          </div>
        )}
      </section>
    </>
  );
}
