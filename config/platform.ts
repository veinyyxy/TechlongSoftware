export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "foundation",
  stack: [
    "TypeScript",
    "React 19",
    "Next.js 16",
    "Tailwind CSS 4",
    "Drizzle ORM",
    "Cloudflare Worker",
  ],
  mvpFlow: [
    "管理员配置套餐",
    "建立企业客户工作区",
    "记录订阅与付款状态",
    "创建应用实例并填写地址",
    "客户查看状态并进入系统",
  ],
  scopes: [
    {
      index: "01",
      title: "企业客户侧",
      description: "让客户明确知道买了什么、是否付款、服务是否可用。",
      items: ["工作区上下文", "套餐与付款状态", "应用实例与访问入口"],
    },
    {
      index: "02",
      title: "平台管理侧",
      description: "为运营人员提供可审计的手动管理流程。",
      items: ["客户与套餐管理", "订阅与付款记录", "实例开通与暂停"],
    },
    {
      index: "03",
      title: "本阶段边界",
      description: "只完成可运行骨架，后续按阶段逐项接入真实能力。",
      items: ["不接在线自动扣款", "不接自动部署流水线", "不实现多产品市场"],
    },
  ],
} as const;
