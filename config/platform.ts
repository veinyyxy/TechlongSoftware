export const platformConfig = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "餐饮 SaaS 平台",
  productName: "餐饮订单系统",
  phase: "foundation-and-roles",
  stack: [
    "TypeScript",
    "React 19",
    "Next.js 16",
    "Tailwind CSS 4",
    "Drizzle ORM",
    "Cloudflare Worker",
  ],
  mvpFlow: [
    "用户使用 ChatGPT 完成登录",
    "同步平台用户账号",
    "首次登录创建企业工作区",
    "建立 Owner 成员关系",
    "服务端校验工作区或平台权限",
  ],
  scopes: [
    {
      index: "01",
      title: "用户账号",
      description: "由 OpenAI Sites 处理身份验证，平台只保存必要的账号资料。",
      items: ["登录与退出", "首次登录注册", "当前用户信息"],
    },
    {
      index: "02",
      title: "企业工作区",
      description: "企业工作区是客户数据的唯一租户边界。",
      items: ["工作区持久化", "Owner / Member", "成员范围查询"],
    },
    {
      index: "03",
      title: "平台管理员",
      description: "平台管理员与客户 Owner 完全分离，并由服务端授权。",
      items: ["管理员允许名单", "用户与工作区只读视图", "无权限页面"],
    },
  ],
} as const;
