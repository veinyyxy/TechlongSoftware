export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "testing-and-launch",
  stack: [
    "TypeScript",
    "React 19",
    "Next.js 16",
    "Tailwind CSS 4",
    "Drizzle ORM",
    "Cloudflare Worker",
  ],
  mvpFlow: [
    "管理员创建企业客户与套餐",
    "客户完成安全在线付款或管理员手工记录付款",
    "已验证付款后自动创建待开通实例记录",
    "管理员登记餐饮订单系统入口",
    "手动开通或暂停客户实例",
    "客户在 Dashboard 查看服务状态并进入自己的应用",
  ],
  scopes: [
    {
      index: "01",
      title: "服务概览",
      description: "客户一眼查看企业名称、套餐、订阅周期与最近付款状态。",
      items: ["当前套餐", "订阅周期", "付款状态"],
    },
    {
      index: "02",
      title: "开通状态",
      description: "按订阅、付款和实例状态给出清楚的服务提示。",
      items: ["等待确认", "开通中", "异常提醒"],
    },
    {
      index: "03",
      title: "安全入口",
      description: "仅在订阅、实例和访问地址都有效时显示产品入口。",
      items: ["我的应用", "应用详情", "安全进入"],
    },
  ],
} as const;
