export type FieldErrors = Record<string, string[]>;

export type AppInstanceStatus = "pending" | "active" | "suspended" | "failed";

export interface AppInstanceInput {
  workspaceId: string;
  productId: string;
  subscriptionId: string | null;
  name: string;
  slug: string;
  domain: string | null;
  accessUrl: string;
  tenantKey: string;
  status: AppInstanceStatus;
}

export interface ValidationResult<T> {
  data: T | null;
  errors: FieldErrors;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addError(errors: FieldErrors, field: string, message: string) {
  errors[field] = [...(errors[field] ?? []), message];
}

function validId(value: string): boolean {
  return value.length >= 4 && value.length <= 100;
}

export function isValidAppInstanceAccessUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isAppInstanceStatus(
  value: unknown,
): value is AppInstanceStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "failed"
  );
}

export function canActivateAppInstance(
  subscriptionStatus: string | null,
): boolean {
  return subscriptionStatus === "active";
}

export function validateAppInstanceInput(
  value: unknown,
): ValidationResult<AppInstanceInput> {
  const input = asRecord(value);
  const errors: FieldErrors = {};
  const workspaceId = asTrimmedString(input.workspaceId);
  const productId = asTrimmedString(input.productId);
  const subscriptionId = asTrimmedString(input.subscriptionId);
  const name = asTrimmedString(input.name);
  const slug = asTrimmedString(input.slug).toLowerCase();
  const domain = asTrimmedString(input.domain);
  const accessUrl = asTrimmedString(input.accessUrl);
  const tenantKey = asTrimmedString(input.tenantKey).toLowerCase();
  const status = input.status;

  if (!validId(workspaceId)) {
    addError(errors, "workspaceId", "请选择企业客户。");
  }
  if (!validId(productId)) {
    addError(errors, "productId", "请选择产品。");
  }
  if (subscriptionId && !validId(subscriptionId)) {
    addError(errors, "subscriptionId", "订阅标识不正确。");
  }
  if (name.length < 2 || name.length > 100) {
    addError(errors, "name", "实例名称需要为 2–100 个字符。");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    addError(errors, "slug", "路径标识只能使用小写字母、数字和连字符。");
  }
  if (domain && (domain.length > 253 || /\s/.test(domain))) {
    addError(errors, "domain", "域名或路径不能包含空格，且不超过 253 个字符。");
  }
  if (accessUrl.length > 2048 || (accessUrl && !isValidAppInstanceAccessUrl(accessUrl))) {
    addError(errors, "accessUrl", "请输入有效的 http:// 或 https:// 访问地址。");
  }
  if (status === "active" && !isValidAppInstanceAccessUrl(accessUrl)) {
    addError(errors, "accessUrl", "标记为已开通前，必须填写有效的 http:// 或 https:// 访问地址。");
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(tenantKey)) {
    addError(errors, "tenantKey", "租户标识需为 2–64 位小写字母、数字、下划线或连字符。");
  }
  if (!isAppInstanceStatus(status)) {
    addError(errors, "status", "请选择有效的实例状态。");
  }

  return {
    data:
      Object.keys(errors).length === 0
        ? {
            workspaceId,
            productId,
            subscriptionId: subscriptionId || null,
            name,
            slug,
            domain: domain || null,
            accessUrl,
            tenantKey,
            status: status as AppInstanceStatus,
          }
        : null,
    errors,
  };
}
