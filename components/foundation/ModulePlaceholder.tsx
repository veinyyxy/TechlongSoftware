interface ModulePlaceholderProps {
  title: string;
  description: string;
  capabilities: readonly string[];
}

export function ModulePlaceholder({
  title,
  description,
  capabilities,
}: ModulePlaceholderProps) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <section className="placeholder-panel">
        <h2>模块边界已建立</h2>
        <p>
          当前页面用于固定路由和信息架构。真实数据、写操作和权限检查将在对应实施阶段接入。
        </p>
        <ul className="placeholder-list">
          {capabilities.map((capability) => <li key={capability}>{capability}</li>)}
        </ul>
      </section>
    </>
  );
}
