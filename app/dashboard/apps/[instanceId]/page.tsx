import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import { getAppInstance } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import {
  canEnterCustomerApplication,
  getCustomerApplicationMessage,
  hasRecordedAccessUrl,
} from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "应用详情" };
export const dynamic = "force-dynamic";

interface CustomerAppDetailPageProps {
  params: Promise<{ instanceId: string }>;
}

export default async function CustomerAppDetailPage({ params }: CustomerAppDetailPageProps) {
  const account = await getDashboardAccount();
  const { instanceId } = await params;
  const instance = await getAppInstance(instanceId);
  if (!instance || instance.workspaceId !== account.workspace.id) notFound();
  const billing = await getWorkspaceBillingSummary(account.workspace.id);
  const subscription =
    billing.currentSubscriptions.find(
      (item) => item.productId === instance.productId,
    ) ??
    billing.subscriptions.find((item) => item.id === instance.subscriptionId) ??
    null;
  const currentPeriodEnd = subscription?.currentPeriodEnd ?? null;

  const canEnter =
    canEnterCustomerApplication({
      subscriptionStatus: subscription?.status ?? instance.subscriptionStatus,
      currentPeriodEnd,
      appInstanceStatus: instance.status,
      accessUrl: instance.accessUrl,
    });
  const canDownloadSellerApk =
    canEnterCustomerApplication({
      subscriptionStatus: subscription?.status ?? instance.subscriptionStatus,
      currentPeriodEnd,
      appInstanceStatus: instance.status,
      accessUrl: instance.sellerApkUrl,
    });
  const statusMessage = getCustomerApplicationMessage({
    productName: instance.productName,
    subscriptionStatus: subscription?.status ?? instance.subscriptionStatus,
    currentPeriodEnd,
    appInstanceStatus: instance.status,
    accessUrl: instance.accessUrl,
  });
  const noticeTone = canEnter
    ? "active"
    : instance.status === "pending"
      ? "warning"
      : "danger";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">APPLICATION DETAIL</p>
          <h1>{instance.name}</h1>
          <p>
            <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
              {appInstanceStatusLabels[instance.status]}
            </span>
          </p>
        </div>
        <Link className="button button-ghost button-small" href="/dashboard/apps">
          返回我的应用
        </Link>
      </header>

      <div className={`notice notice-${noticeTone} billing-alert`}>
        <strong>{appInstanceStatusLabels[instance.status]}</strong>
        <span>{statusMessage}</span>
      </div>

      <div className="detail-grid">
        <section className="module-card">
          <h2>应用信息</h2>
          <dl className="detail-list">
            <div><dt>产品</dt><dd>{instance.productName}</dd></div>
            <div><dt>实例名称</dt><dd>{instance.name}</dd></div>
            <div><dt>域名或路径</dt><dd>{instance.domain ?? instance.slug}</dd></div>
            <div><dt>买家端入口</dt><dd>{hasRecordedAccessUrl(instance.accessUrl) ? instance.accessUrl : "平台管理员尚未登记"}</dd></div>
            <div><dt>卖家端 APK</dt><dd>{hasRecordedAccessUrl(instance.sellerApkUrl) ? instance.sellerApkUrl : "平台管理员尚未登记"}</dd></div>
          </dl>
        </section>
        <section className="module-card">
          <h2>服务状态</h2>
          <dl className="detail-list">
            <div><dt>实例状态</dt><dd>{appInstanceStatusLabels[instance.status]}</dd></div>
            <div><dt>订阅状态</dt><dd>{subscription ? subscriptionStatusLabels[subscription.status] : "未关联"}</dd></div>
            <div><dt>已开通时间</dt><dd>{instance.provisionedAt ? `${formatDate(instance.provisionedAt)} UTC` : "尚未开通"}</dd></div>
            <div><dt>最后更新</dt><dd>{formatDate(instance.updatedAt)} UTC</dd></div>
          </dl>
        </section>
      </div>

      {Object.keys(instance.configurationSnapshot).length ? (
        <section className="module-card">
          <h2>实例配置</h2>
          <dl className="detail-list">
            {Object.entries(instance.configurationSnapshot).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "boolean" ? (value ? "是" : "否") : value}</dd>
              </div>
            ))}
          </dl>
          <div className="notice notice-neutral">
            这是实例创建时从订阅模板生成的配置快照；如需调整，请联系平台管理员。
          </div>
        </section>
      ) : null}

      {canEnter ? (
        <div className="app-detail-entry">
          <a className="button button-dark" href={instance.accessUrl} rel="noreferrer" target="_blank">
            进入买家端
          </a>
          {canDownloadSellerApk ? (
            <a className="button button-ghost" href={instance.sellerApkUrl} rel="noreferrer" target="_blank">
              下载卖家端 APK
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
