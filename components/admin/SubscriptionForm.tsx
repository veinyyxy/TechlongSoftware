"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { SubscriptionStatus } from "@/lib/billing/validation";

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
  plans: Option[];
  initial?: {
    workspaceId: string;
    workspaceName: string;
    productId: string;
    productName: string;
    planId: string;
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = {
      workspaceId: String(formData.get("workspaceId") ?? ""),
      productId: String(formData.get("productId") ?? ""),
      planId: String(formData.get("planId") ?? ""),
      status: String(formData.get("status") ?? ""),
      currentPeriodStart: parseUtcInput(formData.get("currentPeriodStart")),
      currentPeriodEnd: parseUtcInput(formData.get("currentPeriodEnd")),
      cancelAtPeriodEnd: formData.get("cancelAtPeriodEnd") === "on",
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
            <select defaultValue="" name="productId" required>
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
          <select defaultValue={initial?.planId ?? ""} name="planId" required>
            <option disabled value="">请选择启用中的套餐</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          {fieldError("planId") ? (
            <small className="form-error">{fieldError("planId")}</small>
          ) : null}
        </label>
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
