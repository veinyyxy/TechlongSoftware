import type { PaymentStatus, SubscriptionStatus } from "../billing/management";
import type { AppInstanceStatus } from "../instances/validation";

export interface CustomerServiceSnapshot {
  productName?: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: number | null;
  latestPaymentStatus: PaymentStatus | null;
  appInstanceStatus: AppInstanceStatus | null;
  accessUrl: string | null;
}

export interface CustomerStatusNotice {
  tone: "active" | "warning" | "danger" | "neutral";
  title: string;
  message: string;
}

export function selectCurrentProductSubscription<
  T extends { productId: string },
>(
  subscriptions: readonly T[],
  requestedProductId?: string | null,
): T | null {
  return (
    subscriptions.find(
      (subscription) => subscription.productId === requestedProductId,
    ) ??
    subscriptions[0] ??
    null
  );
}

export function hasRecordedAccessUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value?.trim() ?? "");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isSubscriptionExpired(
  status: SubscriptionStatus | null,
  currentPeriodEnd: number | null,
  now = Date.now(),
): boolean {
  return status === "active" && currentPeriodEnd !== null && currentPeriodEnd < now;
}

export function canEnterCustomerApplication(
  input: Pick<
    CustomerServiceSnapshot,
    "subscriptionStatus" | "currentPeriodEnd" | "appInstanceStatus" | "accessUrl"
  >,
  now = Date.now(),
): boolean {
  return (
    input.subscriptionStatus === "active" &&
    !isSubscriptionExpired(input.subscriptionStatus, input.currentPeriodEnd, now) &&
    input.appInstanceStatus === "active" &&
    hasRecordedAccessUrl(input.accessUrl)
  );
}

export function getCustomerSubscriptionNotice(
  input: Pick<
    CustomerServiceSnapshot,
    "productName" | "subscriptionStatus" | "currentPeriodEnd"
  >,
  now = Date.now(),
): CustomerStatusNotice | null {
  const productName = input.productName ?? "订阅产品";
  if (input.subscriptionStatus === "manual_pending") {
    return {
      tone: "warning",
      title: "待确认订阅",
      message: `平台已为您设置待付款订阅。请确认套餐选项并完成付款，付款确认后将为您开通${productName}。`,
    };
  }

  if (
    input.subscriptionStatus === "past_due" ||
    input.subscriptionStatus === "canceled" ||
    isSubscriptionExpired(input.subscriptionStatus, input.currentPeriodEnd, now)
  ) {
    return {
      tone: "danger",
      title: "订阅状态异常",
      message: "您的订阅状态异常，请联系平台管理员。",
    };
  }

  if (input.subscriptionStatus && input.subscriptionStatus !== "active") {
    return {
      tone: "warning",
      title: "订阅当前不可用",
      message: "当前订阅不是有效状态，请联系平台管理员。",
    };
  }

  return null;
}

export function getCustomerServiceNotice(
  input: CustomerServiceSnapshot,
  now = Date.now(),
): CustomerStatusNotice {
  const productName = input.productName ?? "订阅产品";
  const subscriptionNotice = getCustomerSubscriptionNotice(input, now);
  if (subscriptionNotice) return subscriptionNotice;

  if (input.appInstanceStatus === "failed") {
    return {
      tone: "danger",
      title: "开通失败",
      message: "开通失败，请联系平台管理员。",
    };
  }

  if (input.appInstanceStatus === "suspended") {
    return {
      tone: "danger",
      title: "服务已暂停",
      message: `您的${productName}当前已暂停。`,
    };
  }

  if (
    input.latestPaymentStatus === "paid" &&
    input.appInstanceStatus !== "active"
  ) {
    return {
      tone: "warning",
      title: "系统正在开通中",
      message: "您的付款已确认，系统正在开通中。",
    };
  }

  if (
    canEnterCustomerApplication(input, now)
  ) {
    return {
      tone: "active",
      title: `${productName}已开通`,
      message: `您的${productName}已开通。`,
    };
  }

  if (!input.appInstanceStatus) {
    return {
      tone: "neutral",
      title: "尚未开通应用",
      message: `您的${productName}尚未开通。`,
    };
  }

  if (input.appInstanceStatus === "active") {
    return {
      tone: "warning",
      title: "入口暂不可用",
      message: `您的${productName}已开通，但当前访问入口不可用，请联系平台管理员。`,
    };
  }

  return {
    tone: "warning",
    title: "等待开通",
    message: `您的${productName}正在等待开通。`,
  };
}

export function getCustomerApplicationMessage(input: {
  productName?: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd?: number | null;
  appInstanceStatus: AppInstanceStatus;
  accessUrl: string | null;
}): string {
  const productName = input.productName ?? "订阅产品";
  if (input.appInstanceStatus === "failed") {
    return "开通失败，请联系平台管理员。";
  }
  if (input.appInstanceStatus === "suspended") {
    return `您的${productName}当前已暂停。`;
  }
  if (input.appInstanceStatus === "pending") {
    return "等待开通";
  }
  if (isSubscriptionExpired(input.subscriptionStatus, input.currentPeriodEnd ?? null)) {
    return "您的订阅状态异常，请联系平台管理员。";
  }
  if (input.subscriptionStatus !== "active") {
    return "当前订阅不是有效状态，暂时不能进入应用。";
  }
  if (!hasRecordedAccessUrl(input.accessUrl)) {
    return "服务已开通，但平台管理员尚未登记有效访问入口。";
  }
  return `您的${productName}已开通。`;
}
