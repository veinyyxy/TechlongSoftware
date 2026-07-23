import type { Metadata } from "next";

export const metadata: Metadata = { title: "客户控制台" };

const foundationItems = [
  ["客户路由与响应式布局", "READY"],
  ["工作区上下文与成员身份", "NEXT"],
  ["真实套餐、付款与实例数据", "LATER"],
] as const;

export default function DashboardPage() {
  return (
    <>
      <header className="page-header">
        <h1>客户控制台</h1>
        <p>这里将汇总企业工作区的套餐、付款状态和餐饮订单系统入口。</p>
      </header>
      <div className="readiness-grid">
        <article className="readiness-card">
          <small>当前套餐</small>
          <strong>尚未连接</strong>
          <p>套餐数据将在管理模块完成后接入。</p>
        </article>
        <article className="readiness-card">
          <small>付款状态</small>
          <strong>尚未连接</strong>
          <p>首版由管理员手动记录状态。</p>
        </article>
        <article className="readiness-card">
          <small>应用状态</small>
          <strong>尚未开通</strong>
          <p>等待应用实例模块提供真实记录。</p>
        </article>
      </div>
      <div className="dashboard-columns">
        <section className="module-card">
          <h2>基础建设进度</h2>
          <p>这不是业务模拟数据，只展示本项目的真实实施状态。</p>
          <ul className="foundation-checklist">
            {foundationItems.map(([label, state]) => (
              <li key={label}>
                <span>{label}</span>
                <span className={`check-state ${state !== "READY" ? "pending" : ""}`}>{state}</span>
              </li>
            ))}
          </ul>
        </section>
        <aside className="module-card">
          <h2>下一阶段</h2>
          <p>建立账号、平台管理员和工作区成员角色，并在服务端执行权限校验。</p>
          <div className="notice">
            目前没有登录或数据写入入口，避免让未实现的功能看起来可用。
          </div>
        </aside>
      </div>
    </>
  );
}
