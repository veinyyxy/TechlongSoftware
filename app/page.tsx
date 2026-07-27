import type { Metadata } from "next";
import Link from "next/link";
import { platformConfig } from "@/config/platform";

export const metadata: Metadata = {
  title: "应用实例手动开通",
  description: "餐饮 SaaS 平台的管理员应用实例管理与客户应用入口。",
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
          <p className="eyebrow">MANUAL PROVISIONING · 阶段 4</p>
          <h1>让每个企业客户的餐饮订单系统，<br />都有清楚的开通入口。</h1>
          <p className="hero-description">
            平台管理员为企业客户登记餐饮订单系统的访问地址、租户标识与开通状态。
            客户只能查看和进入自己工作区的应用，所有管理操作继续在服务端鉴权。
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/dashboard">
              登录客户控制台
            </Link>
            <Link className="button button-ghost" href="/register">创建企业账号</Link>
          </div>
          <p className="hero-note">
            本阶段只记录入口与开通状态，不代表已经自动部署应用。
          </p>
        </div>

        <div className="foundation-board" aria-label="MVP 开通流程">
          <div className="board-heading">
            <div>
              <span className="board-kicker">MVP OPERATING LOOP</span>
              <h2>人工开通闭环</h2>
            </div>
            <span className="status-pill status-foundation">应用入口已接入</span>
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
          <p>本阶段把客户、订阅和餐饮订单系统入口关联起来，保留人工开通流程，不提前接入自动部署或云服务。</p>
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
            业务代码按领域拆分，D1 持久化客户、套餐、订阅、付款记录与应用实例；后续可沿当前边界扩展真实部署能力。
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
          <p>阶段 4 · 应用实例手动开通。</p>
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
