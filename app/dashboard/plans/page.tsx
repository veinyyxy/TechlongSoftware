import type { Metadata } from "next";
import Link from "next/link";
import { listPlans } from "@/lib/admin/management";
import { formatMoney } from "@/lib/admin/presentation";
import { getDashboardAccount } from "@/lib/auth/account";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import { subscriptionStatusLabels } from "@/lib/billing/presentation";
import { hasStripePaymentConfiguration } from "@/lib/payments/stripe";
import { reconcileWorkspaceExpiredSubscriptions } from "@/lib/purchases/management";

export const metadata: Metadata = { title: "购买套餐" };
export const dynamic = "force-dynamic";

export default async function CustomerPlansPage() {
  const account = await getDashboardAccount();
  await reconcileWorkspaceExpiredSubscriptions(account.workspace.id);
  const [plans, billing] = await Promise.all([
    listPlans({ status: "active" }),
    getWorkspaceBillingSummary(account.workspace.id),
  ]);
  const availablePlans = plans.filter(
    (plan) =>
      plan.productStatus === "active" &&
      plan.templateStatus === "active" &&
      plan.templateVersionStatus === "published" &&
      plan.priceAmount > 0,
  );
  const products = new Map<
    string,
    { name: string; plans: typeof availablePlans }
  >();
  for (const plan of availablePlans) {
    const group = products.get(plan.productId) ?? {
      name: plan.productName,
      plans: [],
    };
    group.plans.push(plan);
    products.set(plan.productId, group);
  }
  const currentByProduct = new Map(
    billing.currentSubscriptions.map((subscription) => [
      subscription.productId,
      subscription,
    ]),
  );
  const onlinePaymentEnabled = hasStripePaymentConfiguration();

  return (
    <>
      <header className="page-header">
        <p className="page-kicker">PRODUCTS & PLANS</p>
        <h1>选择套餐</h1>
        <p>
          套餐价格、功能和实例参数均来自平台配置。付款成功后才会创建或续期订阅，应用仍由平台管理员人工开通。
        </p>
      </header>

      {!onlinePaymentEnabled ? (
        <div className="notice notice-warning billing-alert">
          <strong>Stripe 在线付款正在配置中</strong>
          <span>当前暂不能创建真实付款订单，请联系平台管理员。</span>
        </div>
      ) : null}

      {[...products.entries()].map(([productId, product]) => {
        const current = currentByProduct.get(productId);
        return (
          <section className="data-panel plan-purchase-panel" key={productId}>
            <div className="data-panel-heading">
              <div>
                <h2>{product.name}</h2>
                <p>
                  {current
                    ? `当前订阅：${current.planName} · ${subscriptionStatusLabels[current.status]}`
                    : "尚未订阅，可选择一个套餐购买"}
                </p>
              </div>
              {current ? (
                <Link
                  className="button button-ghost button-small"
                  href="/dashboard/billing"
                >
                  管理当前订阅
                </Link>
              ) : null}
            </div>
            <div className="plan-purchase-grid">
              {product.plans.map((plan) => (
                <article className="plan-purchase-card" key={plan.id}>
                  <div>
                    <p className="page-kicker">
                      {plan.templateName} · v{plan.templateVersion}
                    </p>
                    <h3>{plan.name}</h3>
                    <p>{plan.description || "平台配置的标准服务套餐。"}</p>
                  </div>
                  <strong className="plan-purchase-price">
                    {formatMoney(plan.priceAmount, plan.currency)}
                    <small>/{plan.billingInterval === "year" ? "年" : "月"}</small>
                  </strong>
                  {plan.features.length ? (
                    <ul className="value-list compact-list">
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="plan-card-actions">
                    {current ? (
                      <span className="status-pill status-warning">
                        已有当前订阅
                      </span>
                    ) : account.membership.role !== "owner" ? (
                      <span className="muted-copy">
                        仅工作区 Owner 可以购买
                      </span>
                    ) : onlinePaymentEnabled ? (
                      <Link
                        className="button button-dark button-small"
                        href={`/dashboard/plans/${plan.id}/purchase`}
                      >
                        选择并配置
                      </Link>
                    ) : (
                      <span className="muted-copy">在线付款尚未启用</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {!products.size ? (
        <section className="empty-state standalone-empty">
          <strong>暂无可购买套餐</strong>
          <p>平台管理员尚未发布可在线购买的产品套餐。</p>
        </section>
      ) : null}
    </>
  );
}
