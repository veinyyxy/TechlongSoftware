"use client";

import { FormEvent, useMemo, useState } from "react";
import { ThemeConfigurationEditor } from "@/components/billing/ThemeConfigurationEditor";
import { partitionTemplateFields } from "@/lib/templates/theme-fields";
import type {
  TemplateConfiguration,
  TemplateConfigurationField,
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
  const [unlimitedFields, setUnlimitedFields] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        schema.fields
          .filter((field) => field.source === "customer" && field.nullable)
          .map((field) => [field.key, initialConfiguration[field.key] === null]),
      ),
  );
  const fieldGroups = useMemo(
    () => partitionTemplateFields(schema.fields),
    [schema.fields],
  );
  const customThemeField = schema.fields.find(
    (field) =>
      field.outputPath === "/entitlements/branding.custom_theme.enabled",
  );
  const customThemeEnabled =
    !customThemeField || initialConfiguration[customThemeField.key] !== false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const instanceConfiguration: Record<string, unknown> = {};
    if (!renewalSubscriptionId) {
      for (const field of schema.fields) {
        if (field.source !== "customer") continue;
        const rawValue = formData.get(`instanceConfiguration.${field.key}`);
        if (
          field.nullable &&
          (field.type === "number" || field.type === "integer") &&
          formData.get(`instanceConfigurationMode.${field.key}`) === "unlimited"
        ) {
          instanceConfiguration[field.key] = null;
          continue;
        }
        if (field.type === "boolean") {
          if (field.required || rawValue === "true" || rawValue === "false") {
            instanceConfiguration[field.key] =
              rawValue === "on" || rawValue === "true";
          }
        } else if (field.type === "number" || field.type === "integer") {
          const value = String(rawValue ?? "").trim();
          if (value) instanceConfiguration[field.key] = Number(value);
        } else {
          const value = String(rawValue ?? "").trim();
          if (value) instanceConfiguration[field.key] = value;
        }
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
          payload.error?.message ?? "暂时无法创建付款页面，请稍后重试。",
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

  const displayValue = (
    value: TemplateConfiguration[string],
    nullLabel = "不限",
  ) => {
    if (value === null) return nullLabel;
    if (value === "unlimited") return nullLabel;
    if (value === true) return "启用";
    if (value === false) return "停用";
    if (value === "" || value === undefined) return "未配置";
    return String(value);
  };

  function renderStandardField(field: TemplateConfigurationField) {
    const value = Object.hasOwn(initialConfiguration, field.key)
      ? initialConfiguration[field.key]
      : "";
    const error = fieldError(field.key);

    if (field.source !== "customer") {
      return (
        <label className="form-field" key={field.key}>
          <span>
            {field.group ? `${field.group} · ` : ""}
            {field.label}
            {field.unit ? `（${field.unit}）` : ""}
          </span>
          <input disabled value={displayValue(value, field.nullLabel)} />
          <small>此项由套餐决定，购买时不能修改。</small>
          {field.description ? <small>{field.description}</small> : null}
        </label>
      );
    }

    if (renewalSubscriptionId) {
      return (
        <label className="form-field" key={field.key}>
          <span>
            {field.group ? `${field.group} · ` : ""}
            {field.label}
            {field.unit ? `（${field.unit}）` : ""}
          </span>
          <input disabled value={displayValue(value, field.nullLabel)} />
          <small>续费沿用当前实例配置。</small>
        </label>
      );
    }

    if (field.type === "boolean" && field.required) {
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
            {field.description ? <small>{field.description}</small> : null}
            {error ? <small className="form-error">{error}</small> : null}
          </span>
        </label>
      );
    }

    if (field.type === "boolean") {
      return (
        <label className="form-field" key={field.key}>
          <span>
            {field.group ? `${field.group} · ` : ""}
            {field.label}
          </span>
          <select
            defaultValue={
              value === true ? "true" : value === false ? "false" : ""
            }
            name={`instanceConfiguration.${field.key}`}
          >
            <option value="">不设置</option>
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
          {field.description ? <small>{field.description}</small> : null}
          {error ? <small className="form-error">{error}</small> : null}
        </label>
      );
    }

    const isUnlimited = unlimitedFields[field.key] ?? value === null;
    return (
      <label className="form-field" key={field.key}>
        <span>
          {field.group ? `${field.group} · ` : ""}
          {field.label}
          {field.unit ? `（${field.unit}）` : ""}
        </span>
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
        ) : field.nullable &&
          (field.type === "number" || field.type === "integer") ? (
          <div className="nullable-input-grid">
            <select
              name={`instanceConfigurationMode.${field.key}`}
              onChange={(event) =>
                setUnlimitedFields((current) => ({
                  ...current,
                  [field.key]: event.target.value === "unlimited",
                }))
              }
              value={isUnlimited ? "unlimited" : "value"}
            >
              <option value="unlimited">{field.nullLabel ?? "不限"}</option>
              <option value="value">指定数值</option>
            </select>
            <input
              defaultValue={value === null ? "" : String(value)}
              disabled={isUnlimited}
              max={field.max}
              min={field.min}
              name={`instanceConfiguration.${field.key}`}
              required={field.required && !isUnlimited}
              step={field.type === "integer" ? 1 : "any"}
              type="number"
            />
          </div>
        ) : (
          <input
            defaultValue={String(value)}
            max={field.max}
            maxLength={field.maxLength}
            min={field.min}
            minLength={field.minLength}
            name={`instanceConfiguration.${field.key}`}
            pattern={field.type === "color" ? "#[0-9A-Fa-f]{6}" : undefined}
            placeholder={field.placeholder}
            required={field.required}
            step={
              field.type === "integer"
                ? 1
                : field.type === "number"
                  ? "any"
                  : undefined
            }
            type={
              field.type === "number" || field.type === "integer"
                ? "number"
                : field.type === "color"
                  ? "text"
                  : field.type
            }
          />
        )}
        {field.description ? <small>{field.description}</small> : null}
        {error ? <small className="form-error">{error}</small> : null}
      </label>
    );
  }

  const hasThemeFields =
    fieldGroups.buyerTheme.length > 0 ||
    fieldGroups.merchantTheme.length > 0;
  const themeReadOnly = Boolean(renewalSubscriptionId);

  return (
    <form className="admin-form purchase-configuration-form" onSubmit={handleSubmit}>
      {fieldGroups.basic.length ? (
        <section className="purchase-config-section">
          <div className="purchase-config-heading">
            <span>开通资料</span>
            <h2>店铺与管理员信息</h2>
            <p>这些信息会随订单保存，供平台管理员开通实例时使用。</p>
          </div>
          <div className="form-grid">
            {fieldGroups.basic.map(renderStandardField)}
          </div>
        </section>
      ) : null}

      {hasThemeFields && !customThemeEnabled ? (
        <p className="theme-entitlement-warning">
          当前套餐未启用自定义主题。您仍可保存偏好并查看预览，但订单系统会使用系统默认主题。
        </p>
      ) : null}

      {fieldGroups.buyerTheme.length ? (
        <ThemeConfigurationEditor
          audience="buyer"
          fieldError={fieldError}
          fields={fieldGroups.buyerTheme}
          initialConfiguration={initialConfiguration}
          key={`${planId}:${renewalSubscriptionId ?? "purchase"}:buyer`}
          readOnly={themeReadOnly}
        />
      ) : null}

      {fieldGroups.merchantTheme.length ? (
        <ThemeConfigurationEditor
          audience="merchant"
          fieldError={fieldError}
          fields={fieldGroups.merchantTheme}
          initialConfiguration={initialConfiguration}
          key={`${planId}:${renewalSubscriptionId ?? "purchase"}:merchant`}
          readOnly={themeReadOnly}
        />
      ) : null}

      {fieldGroups.fixed.length ? (
        <section className="purchase-config-section purchase-fixed-section">
          <div className="purchase-config-heading">
            <span>套餐权益</span>
            <h2>套餐已包含</h2>
            <p>以下参数由平台套餐决定，客户购买时不能修改。</p>
          </div>
          <div className="form-grid">
            {fieldGroups.fixed.map(renderStandardField)}
          </div>
        </section>
      ) : null}

      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending
            ? "正在创建安全付款页面…"
            : `确认 ${planName} 并前往 Stripe`}
        </button>
      </div>
    </form>
  );
}
