export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "app-instance-provisioning",
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
    "管理员登记餐饮订单系统入口",
    "手动开通或暂停客户实例",
    "客户查看并进入自己的应用",
  ],
  scopes: [
    {
      index: "01",
      title: "实例记录",
      description: "将餐饮订单系统与企业工作区、订阅和租户标识关联。",
      items: ["客户工作区", "关联订阅", "访问地址"],
    },
    {
      index: "02",
      title: "手动开通",
      description: "管理员维护开通状态，不调用任何云服务或部署系统。",
      items: ["等待开通", "已开通", "暂停与失败"],
    },
    {
      index: "03",
      title: "客户入口",
      description: "客户只读取本工作区的状态与管理员登记的应用入口。",
      items: ["状态提醒", "应用详情", "安全进入"],
    },
  ],
} as const;
