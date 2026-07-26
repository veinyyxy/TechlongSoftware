export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "admin-customer-and-plan-management",
  stack: [
    "TypeScript",
    "React 19",
    "Next.js 16",
    "Tailwind CSS 4",
    "Drizzle ORM",
    "Cloudflare Worker",
  ],
  mvpFlow: [
    "管理员配置数据库套餐",
    "管理员创建企业客户",
    "分配当前套餐并维护客户状态",
    "客户查看自己的服务状态",
    "后续阶段记录订阅与开通",
  ],
  scopes: [
    {
      index: "01",
      title: "客户运营",
      description: "平台管理员维护企业工作区、联系人和服务状态。",
      items: ["客户搜索", "新建与编辑", "暂停与恢复"],
    },
    {
      index: "02",
      title: "套餐目录",
      description: "价格、功能和限制全部来自数据库配置。",
      items: ["套餐搜索", "价格与周期", "启用与停用"],
    },
    {
      index: "03",
      title: "权限边界",
      description: "继续复用工作区隔离和 platform_admin 服务端守卫。",
      items: ["管理员接口校验", "客户数据隔离", "只读状态占位"],
    },
  ],
} as const;
