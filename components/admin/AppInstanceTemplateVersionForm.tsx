"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "@/lib/templates/validation";

interface AppInstanceTemplateVersionFormProps {
  mode: "create" | "edit";
  templateId: string;
  versionId?: string;
  defaultVersion?: number;
  initial?: {
    version: number;
    configurationSchema: TemplateConfigurationSchema;
    defaultConfiguration: TemplateConfiguration;
    deploymentDriver: string;
    deploymentWorkflowVersion: string;
    status: "draft" | "published";
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

const schemaExample = {
  fields: [
    {
      key: "storeName",
      label: "店铺名称",
      type: "text",
      source: "customer",
      required: true,
    },
    {
      key: "theme",
      label: "店铺主题风格",
      type: "select",
      source: "customer",
      required: true,
      options: ["classic", "warm", "minimal"],
    },
    {
      key: "visitorLimit",
      label: "访问人数限制",
      type: "number",
      source: "plan_limit",
      required: true,
      limitKey: "访问人数限制",
      min: 1,
    },
  ],
};

export function AppInstanceTemplateVersionForm({
  mode,
  templateId,
  versionId,
  defaultVersion,
  initial,
}: AppInstanceTemplateVersionFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    let configurationSchema: unknown;
    let defaultConfiguration: unknown;
    try {
      configurationSchema = JSON.parse(
        String(formData.get("configurationSchema") ?? ""),
      );
    } catch {
      setFieldErrors({ configurationSchema: ["配置字段必须是有效 JSON。"] });
      return;
    }
    try {
      defaultConfiguration = JSON.parse(
        String(formData.get("defaultConfiguration") ?? ""),
      );
    } catch {
      setFieldErrors({ defaultConfiguration: ["默认配置必须是有效 JSON。"] });
      return;
    }

    const payload = {
      version: Number(formData.get("version")),
      configurationSchema,
      defaultConfiguration,
      deploymentDriver: String(formData.get("deploymentDriver") ?? ""),
      deploymentWorkflowVersion: String(
        formData.get("deploymentWorkflowVersion") ?? "",
      ),
      status: String(formData.get("status") ?? ""),
    };
    setPending(true);
    try {
      const endpoint =
        mode === "create"
          ? `/api/admin/templates/${templateId}/versions`
          : `/api/admin/templates/${templateId}/versions/${versionId}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ErrorPayload;
      if (!response.ok) {
        setMessage(result.error?.message ?? "保存失败，请检查表单。");
        setFieldErrors(result.error?.fields ?? {});
        return;
      }
      router.push(`/admin/templates/${templateId}`);
      router.refresh();
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (name: string) =>
    fieldErrors[name]?.[0] ??
    Object.entries(fieldErrors).find(([key]) => key.startsWith(`${name}.`))?.[1]?.[0];

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="form-field">
          <span>版本号</span>
          <input
            defaultValue={initial?.version ?? defaultVersion ?? 1}
            disabled={mode === "edit"}
            max={10000}
            min={1}
            name="version"
            required
            type="number"
          />
          {mode === "edit" ? (
            <input name="version" type="hidden" value={initial?.version} />
          ) : null}
          {fieldError("version") ? (
            <small className="form-error">{fieldError("version")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>保存状态</span>
          <select defaultValue={initial?.status ?? "draft"} name="status">
            <option value="draft">保存为草稿</option>
            <option value="published">发布并允许套餐使用</option>
          </select>
          {fieldError("status") ? (
            <small className="form-error">{fieldError("status")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>配置字段定义（JSON）</span>
          <textarea
            defaultValue={JSON.stringify(
              initial?.configurationSchema ?? schemaExample,
              null,
              2,
            )}
            name="configurationSchema"
            required
            rows={20}
          />
          <small>
            source=customer 由订阅表单填写；source=plan_limit 从套餐限制读取。目前支持 text、select、number、boolean、color。
          </small>
          {fieldError("configurationSchema") ? (
            <small className="form-error">
              {fieldError("configurationSchema")}
            </small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>客户字段默认值（JSON）</span>
          <textarea
            defaultValue={JSON.stringify(
              initial?.defaultConfiguration ?? {
                theme: "classic",
              },
              null,
              2,
            )}
            name="defaultConfiguration"
            required
            rows={8}
          />
          <small>
            套餐限制字段不能在这里设置默认值；密码、令牌和密钥不能存入模板配置。
          </small>
          {fieldError("defaultConfiguration") ? (
            <small className="form-error">
              {fieldError("defaultConfiguration")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>部署驱动标识</span>
          <input
            defaultValue={initial?.deploymentDriver ?? "manual"}
            disabled
            name="deploymentDriver"
            required
          />
          <input name="deploymentDriver" type="hidden" value="manual" />
          {fieldError("deploymentDriver") ? (
            <small className="form-error">
              {fieldError("deploymentDriver")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>部署流程版本</span>
          <input
            defaultValue={initial?.deploymentWorkflowVersion ?? "v1"}
            name="deploymentWorkflowVersion"
            required
          />
          {fieldError("deploymentWorkflowVersion") ? (
            <small className="form-error">
              {fieldError("deploymentWorkflowVersion")}
            </small>
          ) : null}
        </label>
      </div>
      <div className="notice notice-warning">
        已发布版本不可修改。需要调整字段、默认值或部署标识时，请创建新的模板版本。
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : mode === "create" ? "创建模板版本" : "保存草稿"}
        </button>
        <button
          className="button button-ghost"
          disabled={pending}
          onClick={() => router.back()}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}
