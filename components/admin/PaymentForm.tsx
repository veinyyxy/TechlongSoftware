"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

interface CustomerOption {
  id: string;
  name: string;
}

interface SubscriptionOption {
  id: string;
  workspaceId: string;
  workspaceName: string;
  planName: string;
}

interface PaymentFormProps {
  customers: CustomerOption[];
  subscriptions: SubscriptionOption[];
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

function parseUtcInput(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "");
  return text ? Date.parse(`${text}:00Z`) : null;
}

export function PaymentForm({
  customers,
  subscriptions,
}: PaymentFormProps) {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState("pending");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const availableSubscriptions = useMemo(
    () =>
      subscriptions.filter(
        (subscription) => subscription.workspaceId === workspaceId,
      ),
    [subscriptions, workspaceId],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const amount = parsePrice(String(formData.get("amount") ?? ""));
    if (amount === null) {
      setFieldErrors({ amount: ["请输入最多两位小数的非负金额。"] });
      return;
    }

    const payload = {
      workspaceId: String(formData.get("workspaceId") ?? ""),
      subscriptionId: String(formData.get("subscriptionId") ?? ""),
      amount,
      currency: String(formData.get("currency") ?? ""),
      status: String(formData.get("status") ?? ""),
      paidAt: parseUtcInput(formData.get("paidAt")),
      paymentMethod: String(formData.get("paymentMethod") ?? ""),
      reference: String(formData.get("reference") ?? ""),
      note: String(formData.get("note") ?? ""),
    };

    setPending(true);
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ErrorPayload;
      if (!response.ok) {
        setMessage(result.error?.message ?? "保存失败，请检查表单。");
        setFieldErrors(result.error?.fields ?? {});
        return;
      }

      router.push("/admin/payments");
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
        <label className="form-field">
          <span>企业客户</span>
          <select
            name="workspaceId"
            onChange={(event) => setWorkspaceId(event.target.value)}
            required
            value={workspaceId}
          >
            <option disabled value="">请选择客户</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          {fieldError("workspaceId") ? (
            <small className="form-error">{fieldError("workspaceId")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>关联订阅（可选）</span>
          <select defaultValue="" name="subscriptionId">
            <option value="">不关联订阅</option>
            {availableSubscriptions.map((subscription) => (
              <option key={subscription.id} value={subscription.id}>
                {subscription.planName}
              </option>
            ))}
          </select>
          {fieldError("subscriptionId") ? (
            <small className="form-error">
              {fieldError("subscriptionId")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>金额</span>
          <input
            inputMode="decimal"
            min="0"
            name="amount"
            placeholder="0.00"
            required
          />
          {fieldError("amount") ? (
            <small className="form-error">{fieldError("amount")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>币种</span>
          <input
            maxLength={3}
            minLength={3}
            name="currency"
            pattern="[A-Za-z]{3}"
            placeholder="CAD"
            required
          />
          {fieldError("currency") ? (
            <small className="form-error">{fieldError("currency")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>付款状态</span>
          <select
            name="status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="pending">待确认</option>
            <option value="paid">已付款</option>
            <option value="failed">付款失败</option>
          </select>
          {fieldError("status") ? (
            <small className="form-error">{fieldError("status")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>付款时间（UTC）{status === "paid" ? "" : "（可选）"}</span>
          <input name="paidAt" required={status === "paid"} type="datetime-local" />
          {fieldError("paidAt") ? (
            <small className="form-error">{fieldError("paidAt")}</small>
          ) : null}
        </label>
        <label className="form-field">
          <span>付款方式</span>
          <input
            maxLength={60}
            minLength={2}
            name="paymentMethod"
            placeholder="例如：银行转账"
            required
          />
          {fieldError("paymentMethod") ? (
            <small className="form-error">
              {fieldError("paymentMethod")}
            </small>
          ) : null}
        </label>
        <label className="form-field">
          <span>参考号（可选）</span>
          <input maxLength={120} name="reference" />
          {fieldError("reference") ? (
            <small className="form-error">{fieldError("reference")}</small>
          ) : null}
        </label>
        <label className="form-field form-field-wide">
          <span>内部备注（可选）</span>
          <textarea maxLength={500} name="note" rows={4} />
          {fieldError("note") ? (
            <small className="form-error">{fieldError("note")}</small>
          ) : null}
        </label>
      </div>
      <div className="notice notice-neutral">
        这是一条管理员手动录入的付款记录，不会请求支付平台、扣款或开具发票。
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending} type="submit">
          {pending ? "保存中…" : "创建付款记录"}
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
