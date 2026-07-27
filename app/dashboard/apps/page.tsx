import type { Metadata } from "next";
import Link from "next/link";
import { getDashboardAccount } from "@/lib/auth/account";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import { listWorkspaceAppInstances } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import {
  canEnterCustomerApplication,
  getCustomerApplicationMessage,
} from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "我的应用" };
export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const account = await getDashboardAccount();
  const [instances, billing] = await Promise.all([
    listWorkspaceAppInstances(account.workspace.id),
    getWorkspaceBillingSummary(account.workspace.id),
  ]);

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">MY APPLICATIONS</p>
        <h1>我的应用</h1>
        <p>查看当前工作区已登记的餐饮订单系统入口和服务状态。</p>
      </header>

      {instances.length ? (
        <section className="app-instance-grid">
          {instances.map((instance) => {
            const canEnter =
              canEnterCustomerApplication({
                subscriptionStatus: instance.subscriptionStatus,
                currentPeriodEnd:
                  billing.subscription?.id === instance.subscriptionId
                    ? billing.subscription.currentPeriodEnd
                    : null,
                appInstanceStatus: instance.status,
                accessUrl: instance.accessUrl,
              });
            return (
              <article className="app-instance-card" key={instance.id}>
                <div className="app-instance-card-heading">
                  <div>
                    <p className="page-kicker">{instance.productName}</p>
                    <h2>{instance.name}</h2>
                  </div>
                  <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
                    {appInstanceStatusLabels[instance.status]}
                  </span>
                </div>
                <p>{getCustomerApplicationMessage({
                  subscriptionStatus: instance.subscriptionStatus,
                  currentPeriodEnd:
                    billing.subscription?.id === instance.subscriptionId
                      ? billing.subscription.currentPeriodEnd
                      : null,
                  appInstanceStatus: instance.status,
                  accessUrl: instance.accessUrl,
                })}</p>
                <dl className="app-instance-summary">
                  <div><dt>访问地址</dt><dd>{instance.accessUrl}</dd></div>
                  <div><dt>租户标识</dt><dd><code>{instance.tenantKey}</code></dd></div>
                </dl>
                {instance.status === "active" && !canEnter ? (
                  <div className="notice notice-danger compact-notice">
                    当前订阅不是有效状态，暂时不能进入应用。
                  </div>
                ) : null}
                <div className="app-instance-actions">
                  <Link className="button button-ghost button-small" href={`/dashboard/apps/${instance.id}`}>
                    查看详情
                  </Link>
                  {canEnter ? (
                    <a className="button button-dark button-small" href={instance.accessUrl} rel="noreferrer" target="_blank">
                      进入餐饮订单系统
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="empty-state standalone-empty">
          <strong>尚未登记应用实例</strong>
          <p>平台管理员开通餐饮订单系统后，入口和服务状态会显示在这里。</p>
        </section>
      )}

      <div className="notice notice-neutral billing-disclaimer">
        应用入口由平台管理员手动维护。本页面不提供修改实例、部署应用或付款操作。
      </div>
    </>
  );
}
