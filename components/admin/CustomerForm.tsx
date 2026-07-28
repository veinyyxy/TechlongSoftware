"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

interface CustomerFormProps {
  mode: "create" | "edit";
  customerId?: string;
  initial?: {
    name: string;
    contactName: string;
    contactEmail: string;
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

export function CustomerForm({
  mode,
  customerId,
  initial,
}: CustomerFormProps) {
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
      name: String(formData.get("name") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
    };

    try {
      const endpoint =
        mode === "create"
          ? "/api/admin/customers"
          : `/api/admin/customers/${customerId}`;
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

      const savedId = result.data?.id ?? customerId;
      router.push(`/admin/customers/${savedId}`);
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
          <span>企业名称</span>
          <input
            defaultValue={initial?.name}
            maxLength={100}
            minLength={2}
            name="name"
            placeholder="例如：北岸餐饮有限公司"
            required
          />
          {fieldError("name") ? (
            <small className="form-error">{fieldError("name")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>联系人</span>
          <input
            defaultValue={initial?.contactName}
            maxLength={100}
            minLength={2}
            name="contactName"
            placeholder="负责人姓名"
            required
          />
          {fieldError("contactName") ? (
            <small className="form-error">{fieldError("contactName")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>联系邮箱</span>
          <input
            defaultValue={initial?.contactEmail}
            maxLength={320}
            name="contactEmail"
            placeholder="owner@example.com"
            required
            type="email"
          />
          {fieldError("contactEmail") ? (
            <small className="form-error">{fieldError("contactEmail")}</small>
          ) : null}
        </label>
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : mode === "create" ? "创建客户" : "保存修改"}
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
