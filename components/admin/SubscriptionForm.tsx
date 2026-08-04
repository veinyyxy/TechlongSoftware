"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { SubscriptionStatus } from "@/lib/billing/validation";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "@/lib/templates/validation";

interface Option {
  id: string;
  name: string;
}

interface SubscriptionFormProps {
  mode: "create" | "edit";
  subscriptionId?: string;
  defaultWorkspaceId?: string;
  customers: Option[];
  products: Array<Option & { status?: "active" | "inactive" }>;
  plans: Array<
    Option & {
      productId: string;
      templateVersionId: string;
      templateName: string;
      templateVersion: number;
      templateConfigurationSchema: TemplateConfigurationSchema;
      templateDefaultConfiguration: TemplateConfiguration;
      templateConfiguration: TemplateConfiguration;
      limits: Record<string, string>;
    }
  >;
  initial?: {
    workspaceId: string;
    workspaceName: string;
    productId: string;
    productName: string;
    planId: string;
    instanceConfiguration: TemplateConfiguration;
    status: SubscriptionStatus;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

function toUtcInput(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16);
}

function parseUtcInput(value: FormDataEntryValue | null): number {
  const text = String(value ?? "");
  return text ? Date.parse(`${text}:00Z`) : Number.NaN;
}

export function SubscriptionForm({
  mode,
  subscriptionId,
  defaultWorkspaceId,
  customers,
  products,
  plans,
  initial,
}: SubscriptionFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [selectedProductId, setSelectedProductId] = useState(
    initial?.productId ?? "",
  );
  const [selectedPlanId, setSelectedPlanId] = useState(initial?.planId ?? "");
  const [unlimitedFields, setUnlimitedFields] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        Object.entries(initial?.instanceConfiguration ?? {})
          .filter(([, value]) => value === null)
          .map(([key]) => [key, true]),
      ),
  );
  const availablePlans = plans.filter(
    (plan) => plan.productId === selectedProductId,
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const instanceConfiguration: Record<string, unknown> = {};
    for (const field of selectedPlan?.templateConfigurationSchema.fields ?? []) {
      if (field.source !== "customer") continue;
      const formValue = formData.get(`instanceConfiguration.${field.key}`);
      if (
        field.nullable &&
        (field.type === "number" || field.type === "integer") &&
        formData.get(`instanceConfigurationMode.${field.key}`) === "unlimited"
      ) {
        instanceConfiguration[field.key] = null;
      } else if (field.type === "boolean") {
        if (field.required || formValue === "true" || formValue === "false") {
          instanceConfiguration[field.key] =
            formValue === "on" || formValue === "true";
        }
      } else if (field.type === "number" || field.type === "integer") {
        const value = String(formValue ?? "").trim();
        if (value) instanceConfiguration[field.key] = Number(value);
      } else {
        const value = String(formValue ?? "").trim();
        if (value) instanceConfiguration[field.key] = value;
      }
    }
    const payload = {
      workspaceId: String(formData.get("workspaceId") ?? ""),
      productId: String(formData.get("productId") ?? ""),
      planId: String(formData.get("planId") ?? ""),
      status: String(formData.get("status") ?? ""),
      currentPeriodStart: parseUtcInput(formData.get("currentPeriodStart")),
      currentPeriodEnd: parseUtcInput(formData.get("currentPeriodEnd")),
      cancelAtPeriodEnd: formData.get("cancelAtPeriodEnd") === "on",
      instanceConfiguration,
    };

    try {
      const endpoint =
        mode === "create"
          ? "/api/admin/subscriptions"
          : `/api/admin/subscriptions/${subscriptionId}`;
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

      const savedId = result.data?.id ?? subscriptionId;
      router.push(`/admin/subscriptions/${savedId}`);
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
          <span>企业客户</span>
          {mode === "edit" && initial ? (
            <>
              <input
                aria-label="企业客户"
                disabled
                value={initial.workspaceName}
              />
              <input
                name="workspaceId"
                type="hidden"
                value={initial.workspaceId}
              />
            </>
          ) : (
            <select defaultValue={defaultWorkspaceId ?? ""} name="workspaceId" required>
              <option disabled value="">请选择企业客户</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          )}
          {fieldError("workspaceId") ? (
            <small className="form-error">{fieldError("workspaceId")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>订阅产品</span>
          {mode === "edit" && initial ? (
            <>
              <input aria-label="订阅产品" disabled value={initial.productName} />
              <input name="productId" type="hidden" value={initial.productId} />
            </>
          ) : (
            <select
              name="productId"
              onChange={(event) => {
                setSelectedProductId(event.target.value);
                setSelectedPlanId("");
                setUnlimitedFields({});
              }}
              required
              value={selectedProductId}
            >
              <option disabled value="">请选择启用中的产品</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.status === "inactive" ? "（已停用）" : ""}
                </option>
              ))}
            </select>
          )}
          <small>同一客户可以订阅不同产品，但每个产品同一时间只能有一条当前订阅。</small>
          {fieldError("productId") ? (
            <small className="form-error">{fieldError("productId")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>套餐</span>
          <select
            disabled={!selectedProductId || !availablePlans.length}
            name="planId"
            onChange={(event) => {
              setSelectedPlanId(event.target.value);
              const nextPlan = plans.find((plan) => plan.id === event.target.value);
              setUnlimitedFields(
                Object.fromEntries(
                  (nextPlan?.templateConfigurationSchema.fields ?? [])
                    .filter((field) => field.source === "customer" && field.nullable)
                    .map((field) => {
                      const value =
                        initial && Object.hasOwn(initial.instanceConfiguration, field.key)
                          ? initial.instanceConfiguration[field.key]
                          : Object.hasOwn(nextPlan?.templateConfiguration ?? {}, field.key)
                            ? nextPlan?.templateConfiguration[field.key]
                            : nextPlan?.templateDefaultConfiguration[field.key];
                      return [field.key, value === null];
                    }),
                ),
              );
            }}
            required
            value={selectedPlanId}
          >
            <option disabled value="">
              {selectedProductId
                ? "请选择该产品的启用套餐"
                : "请先选择订阅产品"}
            </option>
            {availablePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {selectedProductId && !availablePlans.length ? (
            <small className="form-error">
              该产品目前没有可选套餐，请先在套餐管理中创建。
            </small>
          ) : null}
          {fieldError("planId") ? (
            <small className="form-error">{fieldError("planId")}</small>
          ) : null}
        </label>
        {selectedPlan ? (
          <div className="form-field form-field-wide">
            <span>应用实例模板</span>
            <strong>
              {selectedPlan.templateName} · v{selectedPlan.templateVersion}
            </strong>
            <small>
              保存订阅时会固定这个模板版本；实例生成后，套餐和实例配置不可再修改。
            </small>
          </div>
        ) : null}
        {selectedPlan?.templateConfigurationSchema.fields.map((field) => {
          const existingValue =
            initial && Object.hasOwn(initial.instanceConfiguration, field.key)
              ? initial.instanceConfiguration[field.key]
              : Object.hasOwn(selectedPlan.templateConfiguration, field.key)
                ? selectedPlan.templateConfiguration[field.key]
                : Object.hasOwn(selectedPlan.templateDefaultConfiguration, field.key)
                  ? selectedPlan.templateDefaultConfiguration[field.key]
                  : "";
          if (field.source !== "customer") {
            const fixedValue = field.source === "plan_limit"
              ? selectedPlan.limits[field.limitKey ?? ""] === "unlimited"
                ? field.nullLabel ?? "不限"
                : selectedPlan.limits[field.limitKey ?? ""] ?? "套餐未配置"
              : existingValue === null
                ? field.nullLabel ?? "不限"
                : existingValue === true
                  ? "启用"
                  : existingValue === false
                    ? "停用"
                    : existingValue === "" || existingValue === undefined
                      ? "套餐未配置"
                      : String(existingValue);
            return (
              <label
                className="form-field"
                key={`${selectedPlan.id}:${field.key}`}
              >
                <span>{field.group ? `${field.group} · ` : ""}{field.label}</span>
                <input
                  disabled
                  value={fixedValue}
                />
                <small>此值来自套餐，客户和管理员不能在订阅中覆盖。</small>
                {field.description ? <small>{field.description}</small> : null}
              </label>
            );
          }
          if (field.type === "boolean" && field.required) {
            return (
              <label
                className="check-field"
                key={`${selectedPlan.id}:${field.key}`}
              >
                <input
                  defaultChecked={Boolean(existingValue)}
                  name={`instanceConfiguration.${field.key}`}
                  type="checkbox"
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>由客户需求确定，并保存到订阅配置。</small>
                  {field.description ? <small>{field.description}</small> : null}
                </span>
              </label>
            );
          }
          if (field.type === "boolean") {
            return (
              <label
                className="form-field"
                key={`${selectedPlan.id}:${field.key}`}
              >
                <span>{field.group ? `${field.group} · ` : ""}{field.label}</span>
                <select
                  defaultValue={existingValue === true ? "true" : existingValue === false ? "false" : ""}
                  name={`instanceConfiguration.${field.key}`}
                >
                  <option value="">不设置</option>
                  <option value="true">启用</option>
                  <option value="false">停用</option>
                </select>
                {field.description ? <small>{field.description}</small> : null}
              </label>
            );
          }
          const isUnlimited = unlimitedFields[field.key] ?? existingValue === null;
          return (
            <label
              className="form-field"
              key={`${selectedPlan.id}:${field.key}`}
            >
              <span>{field.group ? `${field.group} · ` : ""}{field.label}{field.unit ? `（${field.unit}）` : ""}</span>
              {field.type === "select" ? (
                <select
                  defaultValue={String(existingValue)}
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
              ) : field.nullable && (field.type === "number" || field.type === "integer") ? (
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
                    defaultValue={existingValue === null ? "" : String(existingValue)}
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
                  defaultValue={String(existingValue)}
                  max={field.max}
                  maxLength={field.maxLength}
                  min={field.min}
                  minLength={field.minLength}
                  name={`instanceConfiguration.${field.key}`}
                  placeholder={field.placeholder}
                  required={field.required}
                  step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
                  pattern={field.type === "color" ? "#[0-9A-Fa-f]{6}" : undefined}
                  type={field.type === "number" || field.type === "integer" ? "number" : field.type === "color" ? "text" : field.type}
                />
              )}
              {field.description ? <small>{field.description}</small> : null}
              {fieldError(`instanceConfiguration.${field.key}`) ? (
                <small className="form-error">
                  {fieldError(`instanceConfiguration.${field.key}`)}
                </small>
              ) : null}
            </label>
          );
        })}
        <label className="form-field">
          <span>订阅状态</span>
          <select
            defaultValue={initial?.status ?? "manual_pending"}
            name="status"
          >
            <option value="manual_pending">人工待确认</option>
            <option value="active">有效</option>
            <option value="past_due">逾期</option>
            <option value="paused">已暂停</option>
            <option value="canceled">已取消</option>
          </select>
          {fieldError("status") ? (
            <small className="form-error">{fieldError("status")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>当前周期开始（UTC）</span>
          <input
            defaultValue={
              initial ? toUtcInput(initial.currentPeriodStart) : undefined
            }
            name="currentPeriodStart"
            required
            type="datetime-local"
          />
          {fieldError("currentPeriodStart") ? (
            <small className="form-error">
              {fieldError("currentPeriodStart")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>当前周期结束（UTC）</span>
          <input
            defaultValue={
              initial ? toUtcInput(initial.currentPeriodEnd) : undefined
            }
            name="currentPeriodEnd"
            required
            type="datetime-local"
          />
          {fieldError("currentPeriodEnd") ? (
            <small className="form-error">
              {fieldError("currentPeriodEnd")}
            </small>
          ) : null}
        </label>
        <label className="check-field form-field-wide">
          <input
            defaultChecked={initial?.cancelAtPeriodEnd}
            name="cancelAtPeriodEnd"
            type="checkbox"
          />
          <span>
            <strong>当前周期结束后取消</strong>
            <small>这里只记录管理员决定，不会触发自动扣款或支付平台操作。</small>
          </span>
        </label>
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : mode === "create" ? "创建订阅" : "保存修改"}
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
