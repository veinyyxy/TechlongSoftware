import type { Metadata } from "next";
import Link from "next/link";
import { StatusActionButton } from "@/components/admin/StatusActionButton";
import { formatDate } from "@/lib/admin/presentation";
import { getAdminAccount } from "@/lib/auth/account";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import { getLatestAppInstanceDeployment } from "@/lib/deployments/management";
import { getDeploymentProfile } from "@/lib/deployments/profiles";
import { getAppInstance } from "@/lib/instances/management";
import {
  appInstanceStatusLabels,
  appInstanceStatusTone,
} from "@/lib/instances/presentation";
import { hasRecordedAccessUrl } from "@/lib/customer-dashboard/presentation";

export const metadata: Metadata = { title: "应用实例详情" };
export const dynamic = "force-dynamic";

interface InstanceDetailPageProps {
  params: Promise<{ instanceId: string }>;
}

export default async function InstanceDetailPage({ params }: InstanceDetailPageProps) {
  await getAdminAccount();
  const { instanceId } = await params;
  const instance = await getAppInstance(instanceId);

  if (!instance) {
    return (
      <section className="empty-state standalone-empty">
        <strong>没有找到该应用实例</strong>
        <Link className="button button-dark button-small" href="/admin/instances">
          返回应用实例列表
        </Link>
      </section>
    );
  }

  const deployment = await getLatestAppInstanceDeployment(instance.id);

  const subscriptionIsActive = instance.subscriptionStatus === "active";
  const hasAccessUrl = hasRecordedAccessUrl(instance.accessUrl);
  const hasSellerApkUrl = hasRecordedAccessUrl(instance.sellerApkUrl);
  const canActivate = subscriptionIsActive && hasAccessUrl && instance.status !== "active";

  return (
    <>
      <header className="page-header page-header-split">
        <div>
          <p className="page-kicker">APP INSTANCE DETAIL</p>
          <h1>{instance.name}</h1>
          <p>
            <span className={`status-pill status-${appInstanceStatusTone(instance.status)}`}>
              {appInstanceStatusLabels[instance.status]}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <Link className="button button-ghost button-small" href={`/admin/instances/${instance.id}/edit`}>
            编辑实例
          </Link>
          {instance.status === "active" ? (
            <StatusActionButton
              confirmMessage={`确认暂停“${instance.name}”吗？客户侧将不能再进入该应用。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label="暂停实例"
              nextStatus="suspended"
              tone="danger"
            />
          ) : canActivate ? (
            <StatusActionButton
              confirmMessage={`确认将“${instance.name}”标记为已开通吗？这只更新平台记录，不会执行真实部署。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label={instance.status === "suspended" ? "恢复实例" : "标记为已开通"}
              nextStatus="active"
            />
          ) : null}
          {instance.status !== "failed" && instance.status !== "active" ? (
            <StatusActionButton
              confirmMessage={`确认将“${instance.name}”标记为开通失败吗？客户将看到失败提示。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label="标记开通失败"
              nextStatus="failed"
              tone="danger"
            />
          ) : null}
          {instance.status !== "suspended" && instance.status !== "active" ? (
            <StatusActionButton
              confirmMessage={`确认暂停“${instance.name}”吗？客户将不能进入该应用。`}
              endpoint={`/api/admin/instances/${instance.id}`}
              label="暂停实例"
              nextStatus="suspended"
              tone="danger"
            />
          ) : null}
        </div>
      </header>

      {!subscriptionIsActive ? (
        <div className="notice notice-danger billing-alert">
          <strong>关联订阅不是有效状态</strong>
          <span>只有有效订阅的客户才允许把实例标记为已开通。请先处理客户订阅，再恢复此实例。</span>
        </div>
      ) : null}
      {subscriptionIsActive && !hasAccessUrl && instance.status !== "active" ? (
        <div className="notice notice-warning billing-alert">
          <strong>尚未登记访问地址</strong>
          <span>请先编辑并填写有效的 access_url，再将此待开通实例标记为已开通。</span>
        </div>
      ) : null}

      <div className="detail-grid">
        <section className="module-card">
          <h2>客户与产品</h2>
          <dl className="detail-list">
            <div><dt>企业客户</dt><dd>{instance.workspaceName}</dd></div>
            <div><dt>产品</dt><dd>{instance.productName}</dd></div>
            <div><dt>创建来源</dt><dd>{instance.provisioningSource === "payment_success" ? "付款成功自动创建" : "管理员手动创建"}</dd></div>
            <div><dt>路径标识</dt><dd><code>{instance.slug}</code></dd></div>
            <div><dt>域名或路径</dt><dd>{instance.domain ?? "未填写"}</dd></div>
            <div><dt>租户标识</dt><dd><code>{instance.tenantKey}</code></dd></div>
          </dl>
        </section>
        <section className="module-card">
          <h2>开通记录</h2>
          <dl className="detail-list">
            <div><dt>实例状态</dt><dd>{appInstanceStatusLabels[instance.status]}</dd></div>
            <div><dt>关联订阅</dt><dd>{instance.subscriptionStatus ? subscriptionStatusLabels[instance.subscriptionStatus] : "未关联"}</dd></div>
            <div><dt>订阅套餐</dt><dd>{instance.subscriptionPlanName ?? "未关联"}</dd></div>
            <div>
              <dt>实例模板</dt>
              <dd>
                {instance.templateName && instance.templateVersion
                  ? `${instance.templateName} · v${instance.templateVersion}`
                  : "旧实例未记录模板版本"}
              </dd>
            </div>
            <div><dt>首次开通时间</dt><dd>{instance.provisionedAt ? `${formatDate(instance.provisionedAt)} UTC` : "尚未开通"}</dd></div>
            <div><dt>暂停时间</dt><dd>{instance.suspendedAt ? `${formatDate(instance.suspendedAt)} UTC` : "—"}</dd></div>
            <div><dt>最后更新</dt><dd>{formatDate(instance.updatedAt)} UTC</dd></div>
          </dl>
          <div className="notice notice-neutral">
            {instance.provisioningSource === "payment_success"
              ? "该记录由已验证的付款成功 Webhook 自动创建；系统同时生成只读 AWS 部署计划，实例不会被直接标记为已开通。"
              : "这是管理员手动维护的实例记录，不包含部署日志、自动发布或云资源操作。"}
          </div>
        </section>
      </div>

      <section className="module-card">
        <h2>AWS 部署计划（DEMO）</h2>
        {deployment ? (
          <>
            <dl className="detail-list">
              <div><dt>计划状态</dt><dd>{deployment.status}</dd></div>
              <div><dt>执行模式</dt><dd>{deployment.mode}（仅规划）</dd></div>
              <div><dt>驱动与版本</dt><dd>{deployment.driver} · {deployment.workflowVersion}</dd></div>
              <div><dt>资源档位</dt><dd>{getDeploymentProfile(deployment.deploymentProfileKey).label}</dd></div>
              <div><dt>AWS 区域 / Cell</dt><dd>{deployment.desiredPlan.region} / {deployment.cellKey}</dd></div>
              <div>
                <dt>ECS Task</dt>
                <dd>
                  {deployment.desiredPlan.resources.tenant.taskDefinition.desiredCount} 个起步，
                  {deployment.desiredPlan.resources.tenant.taskDefinition.cpu} CPU / {deployment.desiredPlan.resources.tenant.taskDefinition.memoryMiB} MiB
                </dd>
              </div>
              <div>
                <dt>独立扩缩容</dt>
                <dd>
                  {deployment.desiredPlan.resources.tenant.autoScaling.minCapacity}–{deployment.desiredPlan.resources.tenant.autoScaling.maxCapacity} 个 Task
                </dd>
              </div>
              <div>
                <dt>数据库隔离</dt>
                <dd>
                  {deployment.desiredPlan.resources.tenant.database.isolation === "dedicated_database"
                    ? `独立数据库目标：${deployment.desiredPlan.resources.tenant.database.dedicatedClusterLogicalName}`
                    : "Cell Aurora 集群内独立 Database + Role"}
                </dd>
              </div>
              <div><dt>租户资源</dt><dd>ECS Service、Task Definition、Target Group、Listener Rule、Secret、日志与成本标签</dd></div>
            </dl>
            <div className="notice notice-warning">
              当前计划不会调用 AWS，也不会生成假的 ARN、正式访问地址或 Secret 值。下一阶段由受控 Worker 执行并回写真实资源标识。
            </div>
          </>
        ) : (
          <div className="empty-state">
            <strong>尚无自动部署计划</strong>
            <p>历史或应急补建实例可能没有计划；客户完成新购买后会由后端自动生成。</p>
          </div>
        )}
      </section>

      <section className="module-card">
        <h2>实例配置快照</h2>
        {Object.keys(instance.configurationSnapshot).length ? (
          <dl className="detail-list">
            {Object.entries(instance.configurationSnapshot).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "boolean" ? (value ? "是" : "否") : value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="empty-state">
            <strong>旧实例没有配置快照</strong>
            <p>新实例会从订阅绑定的模板版本生成不可变配置快照。</p>
          </div>
        )}
        <div className="notice notice-neutral">
          配置快照供后续部署执行器使用；密码等运行时 Secret 不会写入部署计划。
        </div>
      </section>

      <section className="data-panel">
        <div className="data-panel-heading">
          <div>
            <h2>客户服务入口</h2>
            <p>买家端入口和卖家端 APK 地址由管理员维护，客户侧仅在服务可用时展示操作按钮。</p>
          </div>
          {hasAccessUrl ? (
            <a className="button button-dark button-small" href={instance.accessUrl} rel="noreferrer" target="_blank">
              打开买家端
            </a>
          ) : null}
        </div>
        <dl className="detail-list">
          <div><dt>买家端入口</dt><dd>{hasAccessUrl ? instance.accessUrl : "尚未登记"}</dd></div>
          <div>
            <dt>卖家端 APK</dt>
            <dd>
              {hasSellerApkUrl ? (
                <a className="table-link" href={instance.sellerApkUrl} rel="noreferrer" target="_blank">
                  {instance.sellerApkUrl}
                </a>
              ) : "尚未登记"}
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
