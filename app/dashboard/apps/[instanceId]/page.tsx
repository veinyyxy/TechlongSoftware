import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import { getAppInstance } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";

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

  const canEnter =
    instance.status === "active" && instance.subscriptionStatus === "active";
  const statusMessage =
    instance.status === "pending"
      ? "等待开通"
      : instance.status === "suspended"
        ? "服务已暂停"
        : instance.status === "failed"
          ? "开通失败，请联系平台管理员"
          : canEnter
            ? "服务已开通，可以进入餐饮订单系统。"
            : "当前订阅不是有效状态，暂时不能进入应用。";

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

      <div className={`notice ${canEnter ? "notice-neutral" : "notice-danger"} billing-alert`}>
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
            <div><dt>访问地址</dt><dd>{instance.accessUrl}</dd></div>
          </dl>
        </section>
        <section className="module-card">
          <h2>服务状态</h2>
          <dl className="detail-list">
            <div><dt>实例状态</dt><dd>{appInstanceStatusLabels[instance.status]}</dd></div>
            <div><dt>订阅状态</dt><dd>{instance.subscriptionStatus ? subscriptionStatusLabels[instance.subscriptionStatus] : "未关联"}</dd></div>
            <div><dt>已开通时间</dt><dd>{instance.provisionedAt ? `${formatDate(instance.provisionedAt)} UTC` : "尚未开通"}</dd></div>
            <div><dt>最后更新</dt><dd>{formatDate(instance.updatedAt)} UTC</dd></div>
          </dl>
        </section>
      </div>

      {canEnter ? (
        <div className="app-detail-entry">
          <a className="button button-dark" href={instance.accessUrl} rel="noreferrer" target="_blank">
            进入餐饮订单系统
          </a>
        </div>
      ) : null}
    </>
  );
}
