"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface AppInstanceTemplateFormProps {
  mode: "create" | "edit";
  templateId?: string;
  products: Array<{ id: string; name: string }>;
  initial?: {
    productId: string;
    productName: string;
    name: string;
    description: string;
    status: "active" | "inactive";
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

export function AppInstanceTemplateForm({
  mode,
  templateId,
  products,
  initial,
}: AppInstanceTemplateFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const payload = {
      productId: String(formData.get("productId") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      status: String(formData.get("status") ?? ""),
    };
    try {
      const endpoint =
        mode === "create"
          ? "/api/admin/templates"
          : `/api/admin/templates/${templateId}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ErrorPayload & {
        data?: { id?: string };
      };
      if (!response.ok) {
        setMessage(result.error?.message ?? "保存失败，请检查表单。");
        setFieldErrors(result.error?.fields ?? {});
        return;
      }
      router.push(`/admin/templates/${result.data?.id ?? templateId}`);
      router.refresh();
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];
  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>所属产品</span>
          {mode === "edit" && initial ? (
            <>
              <input disabled value={initial.productName} />
              <input name="productId" type="hidden" value={initial.productId} />
            </>
          ) : (
            <select defaultValue="" name="productId" required>
              <option disabled value="">请选择启用中的产品</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          )}
          <small>模板创建后不能转移到其他产品。</small>
          {fieldError("productId") ? (
            <small className="form-error">{fieldError("productId")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>模板名称</span>
          <input
            defaultValue={initial?.name}
            maxLength={100}
            minLength={2}
            name="name"
            placeholder="例如：餐饮门店标准模板"
            required
          />
          {fieldError("name") ? (
            <small className="form-error">{fieldError("name")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>模板说明</span>
          <textarea
            defaultValue={initial?.description}
            maxLength={500}
            name="description"
            rows={4}
          />
          {fieldError("description") ? (
            <small className="form-error">{fieldError("description")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>模板状态</span>
          <select defaultValue={initial?.status ?? "active"} name="status">
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
          {fieldError("status") ? (
            <small className="form-error">{fieldError("status")}</small>
          ) : null}
        </label>
      </div>
      <div className="notice notice-neutral">
        模板只定义配置蓝图。自动部署驱动在本阶段仅作为受控标识保存，不会执行脚本或创建云资源。
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : mode === "create" ? "创建模板" : "保存修改"}
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
