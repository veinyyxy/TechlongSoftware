import type { Metadata } from "next";
import Link from "next/link";
import { platformConfig } from "@/config/platform";

export const metadata: Metadata = {
  title: "客户服务 Dashboard",
  description: "餐饮 SaaS 平台的客户服务状态、账单和应用入口。",
};

export default function Home() {
  return (
    <main>
      <header className="marketing-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>{platformConfig.name}</span>
        </Link>
        <nav className="marketing-nav" aria-label="主要导航">
          <a href="#scope">阶段范围</a>
          <Link href="/login">登录</Link>
          <Link href="/register">注册</Link>
          <Link className="button button-dark button-small" href="/dashboard">
            进入控制台
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">CUSTOMER SELF-SERVICE · STRIPE</p>
          <h1>让每个企业客户一眼看清，<br />自己的餐饮订单系统是否可用。</h1>
          <p className="hero-description">
            客户 Dashboard 汇总套餐、订阅周期、付款记录、应用状态与访问入口。
            只有服务状态和入口地址都有效时，客户才能进入自己的餐饮订单系统。
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/dashboard">
              登录客户控制台
            </Link>
            <Link className="button button-ghost" href="/register">创建企业账号</Link>
          </div>
          <p className="hero-note">
            客户可自行选择套餐并在线付款；应用入口仍由平台管理员检查、填写和手动开通，不包含自动部署。
          </p>
        </div>

        <div className="foundation-board" aria-label="MVP 开通流程">
          <div className="board-heading">
            <div>
              <span className="board-kicker">MVP OPERATING LOOP</span>
              <h2>客户服务闭环</h2>
            </div>
            <span className="status-pill status-foundation">试运行检查就绪</span>
          </div>
          <ol className="process-list">
            {platformConfig.mvpFlow.map((step, index) => (
              <li key={step}>
                <span className="process-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{step}</span>
                <span className="process-line" aria-hidden="true" />
              </li>
            ))}
          </ol>
          <div className="board-footer">
            <span>数据隔离边界</span>
            <strong>企业工作区 workspace_id</strong>
          </div>
        </div>
      </section>

      <section className="section" id="scope">
        <div className="section-heading">
          <p className="eyebrow">FIRST RELEASE</p>
          <h2>只做能形成真实运营闭环的能力</h2>
          <p>当前版本支持客户自助选择套餐和 Stripe 一次性预付费，同时保留管理员人工订阅、付款记录与最终开通流程，不自动创建云资源。</p>
        </div>
        <div className="scope-grid">
          {platformConfig.scopes.map((scope) => (
            <article className="scope-card" key={scope.title}>
              <span className="scope-number">{scope.index}</span>
              <h3>{scope.title}</h3>
              <p>{scope.description}</p>
              <ul>
                {scope.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section architecture-section" id="architecture">
        <div className="architecture-copy">
          <p className="eyebrow">MODULAR MONOLITH</p>
          <h2>快速上线，也保留清晰的扩展边界</h2>
          <p>
            单一 TypeScript 项目承载公共站点、客户控制台、管理端与 API。
            业务代码按领域拆分，Neon PostgreSQL 持久化客户、套餐、订阅、付款记录与应用实例；后续可沿当前边界扩展真实部署能力。
          </p>
          <div className="architecture-tags">
            {platformConfig.stack.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className="layer-stack" aria-label="系统分层">
          <div><span>01</span><strong>Presentation</strong><small>公共站点 · 客户端 · 管理端</small></div>
          <div><span>02</span><strong>Application</strong><small>用例 · 权限 · 工作区上下文</small></div>
          <div><span>03</span><strong>Domain</strong><small>客户 · 套餐 · 订阅 · 实例</small></div>
          <div><span>04</span><strong>Infrastructure</strong><small>数据库 · 邮件 · 支付 · 部署</small></div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div>
          <strong>{platformConfig.name}</strong>
          <p>客户自助购买一期 · Stripe 付款 · 管理员人工开通。</p>
        </div>
        <div className="footer-links">
          <Link href="/dashboard">客户侧</Link>
          <Link href="/admin">管理端</Link>
          <Link href="/login">登录</Link>
          <a href="/api/health">健康检查</a>
        </div>
      </footer>
    </main>
  );
}
