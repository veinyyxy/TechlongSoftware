# 餐饮 SaaS 平台

面向企业客户的 SaaS 平台项目骨架，用于逐步实现客户、套餐、订阅、付款记录和餐饮订单系统实例管理。

当前只完成 Foundation 阶段：公共入口、客户控制台、平台管理端、领域边界与健康检查。没有实现真实登录、数据库写入、在线付款或自动部署。

## 技术栈

- TypeScript
- React 19
- Next.js 16 API / App Router 风格
- Vinext + Vite
- Tailwind CSS 4
- Drizzle ORM
- Cloudflare Worker / Sites

采用模块化单体，优先降低 MVP 的开发和部署复杂度。数据库将在下一实施阶段确认；详情见 [docs/architecture.md](./docs/architecture.md)。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

其他命令：

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

复制 `.env.example` 为 `.env.local` 后可覆盖平台显示名称。任何服务端密钥都不得使用 `NEXT_PUBLIC_` 前缀。

## 当前路由

- `/`：项目公共入口与 MVP 范围
- `/dashboard`：企业客户控制台
- `/dashboard/apps`：我的应用
- `/dashboard/billing`：订阅与账单
- `/dashboard/settings`：工作区设置
- `/admin`：平台管理概览
- `/admin/customers`：客户管理
- `/admin/plans`：套餐管理
- `/admin/subscriptions`：订阅管理
- `/admin/payments`：付款记录
- `/admin/instances`：应用实例
- `/admin/audit`：操作日志
- `/api/health`：健康检查

业务页面目前只固定路由和信息架构，并明确显示“尚未连接”；没有伪造可操作功能或客户数据。

## 下一阶段建议

按 `implementation-steps/01-foundation-and-roles.md` 实现：

1. 账号与会话。
2. 平台管理员、Owner、Admin、Member 角色。
3. 工作区上下文。
4. 服务端权限校验。
5. 首批数据库迁移与对应测试。
