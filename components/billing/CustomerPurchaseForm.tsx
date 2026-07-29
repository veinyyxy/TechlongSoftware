"use client";

import { FormEvent, useState } from "react";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "@/lib/templates/validation";

interface CustomerPurchaseFormProps {
  endpoint: string;
  planId: string;
  planName: string;
  renewalSubscriptionId?: string | null;
  schema: TemplateConfigurationSchema;
  initialConfiguration: TemplateConfiguration;
}

export function CustomerPurchaseForm({
  endpoint,
  planId,
  planName,
  renewalSubscriptionId = null,
  schema,
  initialConfiguration,
}: CustomerPurchaseFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const instanceConfiguration: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.source !== "customer") continue;
      const rawValue = formData.get(`instanceConfiguration.${field.key}`);
      if (field.type === "boolean") {
        instanceConfiguration[field.key] = rawValue === "on";
      } else if (field.type === "number") {
        const value = String(rawValue ?? "").trim();
        if (value) instanceConfiguration[field.key] = Number(value);
      } else {
        const value = String(rawValue ?? "").trim();
        if (value) instanceConfiguration[field.key] = value;
      }
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId,
          renewalSubscriptionId,
          instanceConfiguration,
        }),
      });
      const payload = (await response.json()) as {
        data?: { checkoutUrl?: string } | null;
        error?: {
          message?: string;
          fields?: Record<string, string[]>;
        } | null;
      };
      if (!response.ok || !payload.data?.checkoutUrl) {
        setMessage(
          payload.error?.message ??
            "暂时无法创建付款页面，请稍后重试。",
        );
        setFieldErrors(payload.error?.fields ?? {});
        return;
      }
      window.location.assign(payload.data.checkoutUrl);
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string) =>
    fieldErrors[`instanceConfiguration.${key}`]?.[0];

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        {schema.fields.map((field) => {
          const value = initialConfiguration[field.key] ?? "";
          if (field.source === "plan_limit") {
            return (
              <label className="form-field" key={field.key}>
                <span>{field.label}</span>
                <input disabled value={String(value || "由套餐确定")} />
                <small>此项由套餐限制决定，购买时不能修改。</small>
              </label>
            );
          }
          if (renewalSubscriptionId) {
            return (
              <label className="form-field" key={field.key}>
                <span>{field.label}</span>
                <input
                  disabled
                  value={
                    field.type === "boolean"
                      ? value
                        ? "是"
                        : "否"
                      : String(value)
                  }
                />
                <small>续费沿用当前实例配置。</small>
              </label>
            );
          }
          if (field.type === "boolean") {
            return (
              <label className="check-field" key={field.key}>
                <input
                  defaultChecked={Boolean(value)}
                  name={`instanceConfiguration.${field.key}`}
                  type="checkbox"
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>此项会保存到待开通应用实例配置。</small>
                </span>
              </label>
            );
          }
          return (
            <label className="form-field" key={field.key}>
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  defaultValue={String(value)}
                  name={`instanceConfiguration.${field.key}`}
                  required={field.required}
                >
                  {!field.required ? <option value="">不设置</option> : null}
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  defaultValue={String(value)}
                  max={field.max}
                  min={field.min}
                  name={`instanceConfiguration.${field.key}`}
                  required={field.required}
                  type={field.type === "number" ? "number" : field.type}
                />
              )}
              {fieldError(field.key) ? (
                <small className="form-error">
                  {fieldError(field.key)}
                </small>
              ) : null}
            </label>
          );
        })}
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button
          className="button button-dark"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "正在创建安全付款页面…"
            : `确认 ${planName} 并前往 Stripe`}
        </button>
      </div>
    </form>
  );
}
