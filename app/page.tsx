import type { Metadata } from "next";
import Link from "next/link";
import { platformConfig } from "@/config/platform";

export const metadata: Metadata = {
  title: "项目基础",
  description: "餐饮 SaaS 平台的产品定位、MVP 边界与项目入口。",
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
          <a href="#scope">MVP 范围</a>
          <a href="#architecture">架构</a>
          <Link href="/dashboard">客户控制台</Link>
          <Link className="button button-dark button-small" href="/admin">
            管理端预览
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">FOUNDATION · 阶段 0</p>
          <h1>先把运营闭环搭稳，<br />再逐步接入自动化。</h1>
          <p className="hero-description">
            为企业客户管理套餐、付款状态和餐饮订单系统实例。
            第一版采用管理员手动确认与开通，降低上线风险。
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/dashboard">
              预览客户侧结构
            </Link>
            <a className="button button-ghost" href="#architecture">
              查看技术边界
            </a>
          </div>
          <p className="hero-note">
            平台正式名称、支付服务与现有餐饮系统对接方式仍待确认。
          </p>
        </div>

        <div className="foundation-board" aria-label="MVP 开通流程">
          <div className="board-heading">
            <div>
              <span className="board-kicker">MVP OPERATING LOOP</span>
              <h2>人工开通闭环</h2>
            </div>
            <span className="status-pill status-foundation">骨架就绪</span>
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
          <p>本阶段提供导航、页面边界、领域模型和健康检查，不虚构已完成的登录、付款或部署能力。</p>
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
            业务代码按领域拆分，后续接入数据库和认证时无需重写页面结构。
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
          <p>项目骨架 · 等待下一阶段接入身份与工作区。</p>
        </div>
        <div className="footer-links">
          <Link href="/dashboard">客户侧</Link>
          <Link href="/admin">管理端</Link>
          <a href="/api/health">健康检查</a>
        </div>
      </footer>
    </main>
  );
}
