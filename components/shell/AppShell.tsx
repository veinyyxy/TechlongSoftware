import Link from "next/link";
import { platformConfig } from "@/config/platform";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import type { WorkspaceRole } from "@/lib/auth/permissions";

interface NavigationItem {
  href: string;
  label: string;
}

interface AppShellProps {
  children: React.ReactNode;
  mode: "customer" | "admin";
  user: {
    name: string;
    email: string;
    isPlatformAdmin: boolean;
  };
  workspace: {
    name: string;
    role: WorkspaceRole;
    status: "active" | "suspended" | "disabled";
  };
}

const customerNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/apps", label: "我的应用" },
  { href: "/dashboard/billing", label: "订阅与账单" },
  { href: "/dashboard/members", label: "团队成员" },
  { href: "/dashboard/settings", label: "工作区设置" },
];

const adminNavigation: NavigationItem[] = [
  { href: "/admin", label: "管理概览" },
  { href: "/admin/customers", label: "客户管理" },
  { href: "/admin/plans", label: "套餐管理" },
  { href: "/admin/subscriptions", label: "订阅管理" },
  { href: "/admin/payments", label: "付款记录" },
  { href: "/admin/instances", label: "应用实例管理" },
  { href: "/admin/users", label: "用户账号" },
];

export function AppShell({ children, mode, user, workspace }: AppShellProps) {
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
          <strong>{isAdmin ? "全部企业工作区" : workspace.name}</strong>
          <span className="workspace-meta">
            {isAdmin ? "platform_admin" : workspace.role} · {workspace.status}
          </span>
        </div>
        <span className="nav-group-label">{isAdmin ? "OPERATIONS" : "WORKSPACE"}</span>
        <nav className="side-nav" aria-label={isAdmin ? "管理端导航" : "客户控制台导航"}>
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="user-card">
          <small>{user.isPlatformAdmin ? "平台管理员" : "当前账号"}</small>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <Link href={chatGPTSignOutPath("/")}>退出登录</Link>
        </div>
      </aside>
      <section className="app-main">
        <header className="topbar">
          <p>{isAdmin ? "平台运营视图" : "企业客户视图"}</p>
          <span className="environment-badge">STAGE 05 · CUSTOMER READY</span>
        </header>
        <div className="app-content">{children}</div>
      </section>
    </div>
  );
}
