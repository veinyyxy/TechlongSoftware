export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "manual-subscription-and-payment",
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
    "手工创建客户订阅",
    "记录线下付款结果",
    "客户查看订阅与账单状态",
    "后续阶段开通应用实例",
  ],
  scopes: [
    {
      index: "01",
      title: "手工订阅",
      description: "管理员为客户选择套餐，并维护周期与订阅状态。",
      items: ["创建与编辑", "周期设置", "暂停与取消"],
    },
    {
      index: "02",
      title: "付款记录",
      description: "管理员以最小货币单位录入线下付款结果。",
      items: ["待付款", "已付款", "付款失败"],
    },
    {
      index: "03",
      title: "客户账单",
      description: "客户只能读取自己工作区下的订阅与付款状态。",
      items: ["状态提醒", "账期查看", "付款历史"],
    },
  ],
} as const;
