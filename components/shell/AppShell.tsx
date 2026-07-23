import Link from "next/link";
import { platformConfig } from "@/config/platform";

interface NavigationItem {
  href: string;
  label: string;
}

interface AppShellProps {
  children: React.ReactNode;
  mode: "customer" | "admin";
}

const customerNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "概览" },
  { href: "/dashboard/apps", label: "我的应用" },
  { href: "/dashboard/billing", label: "订阅与账单" },
  { href: "/dashboard/settings", label: "工作区设置" },
];

const adminNavigation: NavigationItem[] = [
  { href: "/admin", label: "管理概览" },
  { href: "/admin/customers", label: "客户管理" },
  { href: "/admin/plans", label: "套餐管理" },
  { href: "/admin/subscriptions", label: "订阅管理" },
  { href: "/admin/payments", label: "付款记录" },
  { href: "/admin/instances", label: "应用实例" },
  { href: "/admin/audit", label: "操作日志" },
];

export function AppShell({ children, mode }: AppShellProps) {
  const isAdmin = mode === "admin";
  const navigation = isAdmin ? adminNavigation : customerNavigation;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>{platformConfig.name}</span>
        </Link>
        <div className="workspace-card">
          <small>{isAdmin ? "平台范围" : "当前工作区"}</small>
          <strong>{isAdmin ? "运营管理端" : "尚未连接工作区"}</strong>
        </div>
        <span className="nav-group-label">{isAdmin ? "OPERATIONS" : "WORKSPACE"}</span>
        <nav className="side-nav" aria-label={isAdmin ? "管理端导航" : "客户控制台导航"}>
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="user-card">
          <small>当前阶段</small>
          <strong>Foundation / 未接入身份</strong>
        </div>
      </aside>
      <section className="app-main">
        <header className="topbar">
          <p>{isAdmin ? "平台运营视图" : "企业客户视图"}</p>
          <span className="environment-badge">FOUNDATION</span>
        </header>
        <div className="app-content">{children}</div>
      </section>
    </div>
  );
}
