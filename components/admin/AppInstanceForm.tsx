"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppInstanceStatus } from "@/lib/instances/validation";

interface ProductOption {
  id: string;
  name: string;
}

interface SubscriptionOption {
  id: string;
  workspaceId: string;
  workspaceName: string;
  productId: string;
  productName: string;
  planName: string;
  status: string;
}

interface AppInstanceFormProps {
  mode: "create" | "edit";
  instanceId?: string;
  products: ProductOption[];
  subscriptions: SubscriptionOption[];
  initial?: {
    workspaceId: string;
    workspaceName: string;
    productId: string;
    subscriptionId: string | null;
    name: string;
    slug: string;
    domain: string | null;
    accessUrl: string;
    sellerApkUrl: string;
    tenantKey: string;
    status: AppInstanceStatus;
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

export function AppInstanceForm({
  mode,
  instanceId,
  products,
  subscriptions,
  initial,
}: AppInstanceFormProps) {
  const router = useRouter();
  const workspaceId = initial?.workspaceId ?? "";
  const [productId, setProductId] = useState(initial?.productId ?? "");
  const [subscriptionId, setSubscriptionId] = useState(
    initial?.subscriptionId ?? "",
  );
  const [status, setStatus] = useState<AppInstanceStatus>(
    initial?.status ?? "pending",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const availableSubscriptions = useMemo(
    () => {
      const current = subscriptions.filter(
        (subscription) => subscription.status !== "canceled",
      );
      if (mode === "create") return current;
      return current.filter(
        (subscription) =>
          subscription.workspaceId === workspaceId &&
          subscription.productId === productId,
      );
    },
    [mode, subscriptions, workspaceId, productId],
  );
  const selectedSubscription = availableSubscriptions.find(
    (subscription) => subscription.id === subscriptionId,
  );
  const activeSubscriptionRequired =
    status === "active" && selectedSubscription?.status !== "active";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeSubscriptionRequired) {
      setMessage("标记为已开通前，必须选择该客户的一条有效订阅。");
      return;
    }

    setPending(true);
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const sharedFields = {
      subscriptionId: String(formData.get("subscriptionId") ?? ""),
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      domain: String(formData.get("domain") ?? ""),
      accessUrl: String(formData.get("accessUrl") ?? ""),
      sellerApkUrl: String(formData.get("sellerApkUrl") ?? ""),
      tenantKey: String(formData.get("tenantKey") ?? ""),
      status: String(formData.get("status") ?? ""),
    };
    const payload =
      mode === "create"
        ? sharedFields
        : {
            ...sharedFields,
            workspaceId: String(formData.get("workspaceId") ?? ""),
            productId: String(formData.get("productId") ?? ""),
          };

    try {
      const endpoint =
        mode === "create"
          ? "/api/admin/instances"
          : `/api/admin/instances/${instanceId}`;
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

      const savedId = result.data?.id ?? instanceId;
      router.push(`/admin/instances/${savedId}`);
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
        {mode === "create" ? (
          <label className="form-field form-field-wide">
            <span>关联订阅</span>
            <select
              name="subscriptionId"
              onChange={(event) => setSubscriptionId(event.target.value)}
              required
              value={subscriptionId}
            >
              <option disabled value="">请选择需要补建实例的订阅</option>
              {availableSubscriptions.map((subscription) => (
                <option key={subscription.id} value={subscription.id}>
                  {subscription.workspaceName} · {subscription.productName} · {subscription.planName}
                </option>
              ))}
            </select>
            <small>
              企业、产品和套餐归属由订阅自动确定，不能在此手工指定。
            </small>
            {selectedSubscription ? (
              <small>
                当前归属：{selectedSubscription.workspaceName} · {selectedSubscription.productName} · {selectedSubscription.planName}
              </small>
            ) : null}
            {fieldError("subscriptionId") ? <small className="form-error">{fieldError("subscriptionId")}</small> : null}
          </label>
        ) : (
          <>
            <label className="form-field form-field-wide">
              <span>企业客户</span>
              <input aria-label="企业客户" disabled value={initial?.workspaceName} />
              <input name="workspaceId" type="hidden" value={workspaceId} />
            </label>
            <label className="form-field">
              <span>产品</span>
              <select
                name="productId"
                onChange={(event) => {
                  setProductId(event.target.value);
                  setSubscriptionId("");
                }}
                required
                value={productId}
              >
                <option disabled value="">请选择产品</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
              {fieldError("productId") ? <small className="form-error">{fieldError("productId")}</small> : null}
            </label>
            <label className="form-field">
              <span>关联订阅（可选）</span>
              <select
                name="subscriptionId"
                onChange={(event) => setSubscriptionId(event.target.value)}
                value={subscriptionId}
              >
                <option value="">暂不关联订阅</option>
                {availableSubscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.planName} · {subscription.status}
                  </option>
                ))}
              </select>
              <small>仅显示该企业在所选产品下的订阅；若状态设为“已开通”，必须选择一条有效订阅。</small>
              {fieldError("subscriptionId") ? <small className="form-error">{fieldError("subscriptionId")}</small> : null}
            </label>
          </>
        )}
        <label className="form-field">
          <span>实例名称</span>
          <input defaultValue={initial?.name} maxLength={100} name="name" required />
          {fieldError("name") ? <small className="form-error">{fieldError("name")}</small> : null}
        </label>
        <label className="form-field">
          <span>路径标识 slug</span>
          <input defaultValue={initial?.slug} maxLength={80} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="northshore-orders" required />
          {fieldError("slug") ? <small className="form-error">{fieldError("slug")}</small> : null}
        </label>
        <label className="form-field">
          <span>域名或路径（可选）</span>
          <input defaultValue={initial?.domain ?? ""} maxLength={253} name="domain" placeholder="orders.example.com 或 /northshore" />
          {fieldError("domain") ? <small className="form-error">{fieldError("domain")}</small> : null}
        </label>
        <label className="form-field">
          <span>租户标识 tenant_key</span>
          <input defaultValue={initial?.tenantKey} maxLength={64} name="tenantKey" pattern="[a-z0-9][a-z0-9_-]{1,63}" placeholder="northshore" required />
          {fieldError("tenantKey") ? <small className="form-error">{fieldError("tenantKey")}</small> : null}
        </label>
        <label className="form-field form-field-wide">
          <span>买家端入口 access_url</span>
          <input
            defaultValue={initial?.accessUrl}
            maxLength={2048}
            name="accessUrl"
            placeholder="https://orders.example.com"
            required={status === "active"}
            type="url"
          />
          <small>客户访问餐饮订单系统买家端的完整网址。激活前必须填写。</small>
          {fieldError("accessUrl") ? <small className="form-error">{fieldError("accessUrl")}</small> : null}
        </label>
        <label className="form-field form-field-wide">
          <span>卖家端 APK 下载地址 seller_apk_url（可选）</span>
          <input
            defaultValue={initial?.sellerApkUrl}
            maxLength={2048}
            name="sellerApkUrl"
            placeholder="https://downloads.example.com/restaurant-seller.apk"
            type="url"
          />
          <small>填写管理员确认可用的 APK 下载链接；未填写时客户侧不会显示下载按钮。</small>
          {fieldError("sellerApkUrl") ? <small className="form-error">{fieldError("sellerApkUrl")}</small> : null}
        </label>
        <label className="form-field">
          <span>实例状态</span>
          <select
            name="status"
            onChange={(event) => setStatus(event.target.value as AppInstanceStatus)}
            value={status}
          >
            <option value="pending">等待开通</option>
            <option value="active">已开通</option>
            <option value="suspended">服务已暂停</option>
            <option value="failed">开通失败</option>
          </select>
          {fieldError("status") ? <small className="form-error">{fieldError("status")}</small> : null}
        </label>
      </div>
      {activeSubscriptionRequired ? (
        <div className="notice notice-danger">
          只有关联有效订阅的客户才允许将实例标记为“已开通”。请先选择有效订阅，或将状态保留为等待开通。
        </div>
      ) : null}
      {status === "active" ? (
        <div className="notice notice-neutral">
          标记为已开通前，请确认已经填写有效的买家端入口；保存时会再次校验。卖家端 APK 地址可以稍后补充。
        </div>
      ) : null}
      <div className="notice notice-neutral">
        此页面只维护开通记录与客户入口，不会调用云服务、Docker、Kubernetes 或支付平台。
      </div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending || activeSubscriptionRequired} type="submit">
          {pending ? "保存中…" : mode === "create" ? "补建应用实例" : "保存修改"}
        </button>
        <button className="button button-ghost" disabled={pending} onClick={() => router.back()} type="button">
          取消
        </button>
      </div>
    </form>
  );
}
