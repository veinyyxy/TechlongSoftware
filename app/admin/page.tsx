import type { Metadata } from "next";

export const metadata: Metadata = { title: "管理概览" };

export default function AdminPage() {
  return (
    <>
      <header className="page-header">
        <h1>管理概览</h1>
        <p>面向平台运营人员的客户、收费与实例开通工作台。</p>
      </header>
      <div className="readiness-grid">
        <article className="readiness-card">
          <small>企业客户</small>
          <strong>—</strong>
          <p>等待客户管理阶段接入。</p>
        </article>
        <article className="readiness-card">
          <small>有效订阅</small>
          <strong>—</strong>
          <p>等待订阅管理阶段接入。</p>
        </article>
        <article className="readiness-card">
          <small>运行实例</small>
          <strong>—</strong>
          <p>等待实例开通阶段接入。</p>
        </article>
      </div>
      <section className="placeholder-panel">
        <h2>首版运营闭环</h2>
        <p>管理员完成以下记录后，客户控制台才展示对应真实状态。</p>
        <ul className="placeholder-list">
          <li>创建企业工作区并关联负责人</li>
          <li>为工作区选择有效套餐</li>
          <li>手动确认订阅与付款状态</li>
          <li>创建实例、填写地址并标记已开通</li>
        </ul>
      </section>
    </>
  );
}
