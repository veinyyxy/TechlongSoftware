"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "@/lib/templates/validation";

interface PlanFormProps {
  mode: "create" | "edit";
  planId?: string;
  products?: Array<{
    id: string;
    name: string;
    status: "active" | "inactive";
  }>;
  templateVersions?: Array<{
    id: string;
    productId: string;
    templateName: string;
    version: number;
    configurationSchema: TemplateConfigurationSchema;
    defaultConfiguration: TemplateConfiguration;
  }>;
  initial?: {
    productId: string;
    productName: string;
    templateVersionId: string;
    templateName: string;
    templateVersion: number;
    templateConfigurationSchema: TemplateConfigurationSchema;
    templateDefaultConfiguration: TemplateConfiguration;
    templateConfiguration: TemplateConfiguration;
    name: string;
    description: string;
    priceAmount: number;
    currency: string;
    billingInterval: "month" | "year";
    features: string[];
    limits: Record<string, string>;
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

function parsePrice(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}

function parseLimits(value: string): {
  limits: Record<string, string>;
  error: string;
} {
  const limits: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      return { limits: {}, error: "每个限制项请使用“名称=值”的格式。" };
    }
    const key = line.slice(0, separator).trim();
    const limitValue = line.slice(separator + 1).trim();
    if (!key || !limitValue) {
      return { limits: {}, error: "限制项名称和值都不能为空。" };
    }
    limits[key] = limitValue;
  }
  return { limits, error: "" };
}

export function PlanForm({
  mode,
  planId,
  products = [],
  templateVersions = [],
  initial,
}: PlanFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [selectedProductId, setSelectedProductId] = useState(
    initial?.productId ?? "",
  );
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState(
    initial?.templateVersionId ?? "",
  );
  const availableTemplateVersions = templateVersions.filter(
    (version) => version.productId === selectedProductId,
  );
  const selectedTemplateVersion = templateVersions.find(
    (version) => version.id === selectedTemplateVersionId,
  );
  const selectedTemplateSchema =
    selectedTemplateVersion?.configurationSchema ??
    initial?.templateConfigurationSchema ??
    { fields: [] };
  const selectedTemplateDefaults =
    selectedTemplateVersion?.defaultConfiguration ??
    initial?.templateDefaultConfiguration ??
    {};
  const requiredLimitKeys = selectedTemplateSchema.fields
    .filter((field) => field.source === "plan_limit")
    .map((field) => field.limitKey)
    .filter((key): key is string => Boolean(key));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const priceAmount = parsePrice(String(formData.get("price") ?? ""));
    const parsedLimits = parseLimits(String(formData.get("limits") ?? ""));
    if (priceAmount === null) {
      setFieldErrors({ priceAmount: ["请输入最多两位小数的非负金额。"] });
      return;
    }
    if (parsedLimits.error) {
      setFieldErrors({ limits: [parsedLimits.error] });
      return;
    }
    const templateConfiguration: Record<string, unknown> = {};
    for (const field of selectedTemplateSchema.fields) {
      const fieldValue = formData.get(`templateParameter.${field.key}`);
      if (field.source === "plan_limit") {
        const limitValue = String(fieldValue ?? "").trim();
        if (field.limitKey && limitValue) {
          parsedLimits.limits[field.limitKey] = limitValue;
        }
        continue;
      }
      if (field.type === "boolean") {
        templateConfiguration[field.key] = fieldValue === "on";
      } else if (field.type === "number") {
        const value = String(fieldValue ?? "").trim();
        if (value) templateConfiguration[field.key] = Number(value);
      } else {
        const value = String(fieldValue ?? "").trim();
        if (value) templateConfiguration[field.key] = value;
      }
    }

    const features = String(formData.get("features") ?? "")
      .split(/\r?\n/)
      .map((feature) => feature.trim())
      .filter(Boolean);
    const payload = {
      productId: String(formData.get("productId") ?? ""),
      templateVersionId: String(formData.get("templateVersionId") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      priceAmount,
      currency: String(formData.get("currency") ?? ""),
      billingInterval: String(formData.get("billingInterval") ?? ""),
      features,
      limits: parsedLimits.limits,
      templateConfiguration,
    };

    setPending(true);
    try {
      const endpoint =
        mode === "create" ? "/api/admin/plans" : `/api/admin/plans/${planId}`;
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

      router.push("/admin/plans");
      router.refresh();
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];
  const limitsValue = initial
    ? Object.entries(initial.limits)
        .filter(([key]) => !requiredLimitKeys.includes(key))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
    : "";

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>所属产品</span>
          {mode === "edit" && initial ? (
            <>
              <input aria-label="所属产品" disabled value={initial.productName} />
              <input
                name="productId"
                type="hidden"
                value={initial.productId}
              />
            </>
          ) : (
            <select
              name="productId"
              onChange={(event) => {
                setSelectedProductId(event.target.value);
                setSelectedTemplateVersionId("");
              }}
              required
              value={selectedProductId}
            >
              <option disabled value="">
                请选择套餐所属产品
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          )}
          <small>套餐创建后不能转移到其他产品。</small>
          {fieldError("productId") ? (
            <small className="form-error">{fieldError("productId")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>实例模板版本</span>
          {mode === "edit" && initial ? (
            <>
              <input
                aria-label="实例模板版本"
                disabled
                value={`${initial.templateName} · v${initial.templateVersion}`}
              />
              <input
                name="templateVersionId"
                type="hidden"
                value={initial.templateVersionId}
              />
            </>
          ) : (
            <select
              disabled={
                !selectedProductId || !availableTemplateVersions.length
              }
              name="templateVersionId"
              onChange={(event) =>
                setSelectedTemplateVersionId(event.target.value)
              }
              required
              value={selectedTemplateVersionId}
            >
              <option disabled value="">
                {selectedProductId
                  ? "请选择已发布的实例模板版本"
                  : "请先选择所属产品"}
              </option>
              {availableTemplateVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.templateName} · v{version.version}
                </option>
              ))}
            </select>
          )}
          <small>
            套餐创建后不能更换模板版本；需要升级模板时请创建新套餐。
          </small>
          {requiredLimitKeys.length ? (
            <small>
              此模板要求的套餐限制：{requiredLimitKeys.join("、")}
            </small>
          ) : null}
          {selectedProductId &&
          mode === "create" &&
          !availableTemplateVersions.length ? (
            <small className="form-error">
              该产品没有已发布的模板版本，请先在实例模板管理中创建并发布。
            </small>
          ) : null}
          {fieldError("templateVersionId") ? (
            <small className="form-error">
              {fieldError("templateVersionId")}
            </small>
          ) : null}
        </label>
        {selectedTemplateSchema.fields.length ? (
          <div className="form-field form-field-wide">
            <span>应用实例模板参数</span>
            <small>
              套餐固定参数会写入套餐限制；客户参数是订阅时的默认值，创建客户订阅时仍可按实际需求覆盖。
            </small>
          </div>
        ) : null}
        {selectedTemplateSchema.fields.map((field) => {
          const parameterKey = `${selectedTemplateVersionId || initial?.templateVersionId}:${field.key}`;
          const value =
            field.source === "plan_limit"
              ? initial?.limits[field.limitKey ?? ""] ?? ""
              : initial?.templateConfiguration[field.key] ??
                selectedTemplateDefaults[field.key] ??
                "";
          const helpText =
            field.source === "plan_limit"
              ? `套餐固定值，保存到“${field.limitKey ?? field.label}”限制中，订阅时不能覆盖。`
              : field.required
                ? "套餐默认值；可留空，但创建订阅时必须填写。"
                : "套餐默认值；创建订阅时可以覆盖或不设置。";

          if (field.type === "boolean") {
            return (
              <label className="check-field" key={parameterKey}>
                <input
                  defaultChecked={Boolean(value)}
                  name={`templateParameter.${field.key}`}
                  type="checkbox"
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>{helpText}</small>
                </span>
              </label>
            );
          }

          return (
            <label className="form-field" key={parameterKey}>
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  defaultValue={String(value)}
                  name={`templateParameter.${field.key}`}
                >
                  <option value="">订阅时填写</option>
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
                  name={`templateParameter.${field.key}`}
                  required={field.source === "plan_limit" && field.required}
                  type={field.type === "number" ? "number" : "text"}
                />
              )}
              <small>{helpText}</small>
              {fieldError(
                field.source === "plan_limit"
                  ? "limits"
                  : `templateConfiguration.${field.key}`,
              ) ? (
                <small className="form-error">
                  {fieldError(
                    field.source === "plan_limit"
                      ? "limits"
                      : `templateConfiguration.${field.key}`,
                  )}
                </small>
              ) : null}
            </label>
          );
        })}
        <label className="form-field form-field-wide">
          <span>套餐名称</span>
          <input
            defaultValue={initial?.name}
            maxLength={80}
            minLength={2}
            name="name"
            placeholder="例如：Basic"
            required
          />
          {fieldError("name") ? (
            <small className="form-error">{fieldError("name")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>套餐说明</span>
          <textarea
            defaultValue={initial?.description}
            maxLength={500}
            name="description"
            placeholder="说明套餐适用的客户和场景"
            rows={3}
          />
          {fieldError("description") ? (
            <small className="form-error">{fieldError("description")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>价格</span>
          <input
            defaultValue={
              initial ? (initial.priceAmount / 100).toFixed(2) : "0.00"
            }
            inputMode="decimal"
            min="0"
            name="price"
            required
          />
          {fieldError("priceAmount") ? (
            <small className="form-error">{fieldError("priceAmount")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>币种</span>
          <input
            defaultValue={initial?.currency ?? "CAD"}
            maxLength={3}
            minLength={3}
            name="currency"
            pattern="[A-Za-z]{3}"
            required
          />
          {fieldError("currency") ? (
            <small className="form-error">{fieldError("currency")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>计费周期</span>
          <select
            defaultValue={initial?.billingInterval ?? "month"}
            name="billingInterval"
          >
            <option value="month">每月</option>
            <option value="year">每年</option>
          </select>
          {fieldError("billingInterval") ? (
            <small className="form-error">
              {fieldError("billingInterval")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>功能列表</span>
          <textarea
            defaultValue={initial?.features.join("\n")}
            name="features"
            placeholder={"基础订单管理\n菜单配置\n营业数据导出"}
            rows={7}
          />
          <small>每行一项，内容会保存到数据库。</small>
          {fieldError("features") ? (
            <small className="form-error">{fieldError("features")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>其他额度与限制</span>
          <textarea
            defaultValue={limitsValue}
            name="limits"
            placeholder={"门店数=1\n成员数=5\n每月订单量=5000"}
            rows={7}
          />
          <small>
            每行使用“名称=值”。模板已经显示的固定参数不需要在这里重复填写。
          </small>
          {fieldError("limits") ? (
            <small className="form-error">{fieldError("limits")}</small>
          ) : null}
        </label>
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : mode === "create" ? "创建套餐" : "保存修改"}
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
