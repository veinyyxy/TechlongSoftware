# 餐饮 SaaS 平台

面向企业客户的 SaaS 平台，逐步实现用户、企业工作区、套餐、收费和餐饮订单系统实例管理。

当前完成阶段 1：平台基础与角色权限。

## 已实现

- 使用 OpenAI Sites 的 ChatGPT 登录完成身份验证。
- 首次登录自动同步平台用户。
- 首次登录自动创建企业工作区和 `owner` 成员关系。
- 企业工作区状态：`active`、`suspended`、`disabled`。
- 工作区成员角色：`owner`、`member`。
- 用户表中的 `is_platform_admin` 平台管理员标记。
- 平台管理员邮箱允许名单。
- 客户控制台、成员页面和工作区设置基础页。
- 管理员概览、用户列表和工作区列表基础页。
- 服务端工作区成员校验和平台管理员校验。
- 无权限页面及统一的 `401` / `403` API 响应。

## 本阶段没有实现

- 套餐管理。
- 订阅和付款。
- 应用实例开通。
- 真实支付。
- 自动部署业务流程。
- 成员邀请和角色变更。
- 密码注册、密码存储和密码重置。

登录由 OpenAI Sites 处理，平台不会保存 ChatGPT 密码。首次 ChatGPT 登录等同于创建平台账号。

## 技术栈

- TypeScript
- React 19
- Next.js 16 API / App Router 风格
- Vinext + Vite
- Tailwind CSS 4
- Drizzle ORM + Cloudflare D1
- Cloudflare Worker / OpenAI Sites

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
copy .env.example .env.local
npm run dev
```

在 `.env.local` 设置本地管理员允许名单：

```env
PLATFORM_ADMIN_EMAILS=you@example.com
```

常用命令：

```bash
npm run db:generate
npm run build
npm run lint
npm test
```

## 数据库

逻辑 D1 绑定名为 `DB`。数据库结构位于 `db/schema.ts`，迁移文件位于 `drizzle/`。

阶段 1 创建：

- `users`
- `workspaces`
- `workspace_members`

所有客户业务查询必须通过 `workspace_id` 和成员关系限制范围。平台管理员是唯一允许跨工作区读取基础数据的角色。

## 当前路由

公共路由：

- `/`
- `/login`
- `/register`
- `/unauthorized`
- `/api/health`

客户路由：

- `/dashboard`
- `/dashboard/members`
- `/dashboard/settings`
- `/api/account`
- `/api/workspaces/:workspaceId`

管理员路由：

- `/admin`
- `/admin/users`
- `/admin/workspaces`
- `/api/admin/overview`

保留的后续阶段占位路由不会出现在当前导航中。

## 下一阶段

确认阶段 1 的账号、工作区和管理员权限后，可以执行：

`implementation-steps/02-admin-customer-and-plan-management.md`
