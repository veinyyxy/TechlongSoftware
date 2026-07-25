# SaaS 平台架构

## 当前阶段

阶段 1 已实现身份、用户、企业工作区、成员关系和平台管理员边界。

```text
ChatGPT 登录
→ 同步平台用户
→ 首次登录创建企业工作区
→ 建立 Owner 成员关系
→ 服务端按工作区或平台角色授权
```

套餐、订阅、付款、应用实例和自动部署没有进入本阶段。

## 身份方案

部署环境使用 OpenAI Sites 提供的 Sign in with ChatGPT：

- `/signin-with-chatgpt`、`/signout-with-chatgpt` 和 `/callback` 由平台负责。
- 应用从受信任请求头读取当前用户邮箱和可选姓名。
- 首次登录时在 D1 中创建或更新 `users` 记录。
- 平台不保存密码、OAuth Token 或 ChatGPT 会话 Cookie。

身份验证不等于工作区授权。每个服务端页面和 API 都会继续检查平台角色或工作区成员关系。

## 数据模型

```text
User
├── is_platform_admin
└── WorkspaceMember >── Workspace
                           └── owner_id -> User
```

### `users`

- 唯一规范化邮箱。
- 账号状态：`active`、`disabled`。
- `is_platform_admin` 区分平台管理员和客户角色。
- 管理员身份由服务器端 `PLATFORM_ADMIN_EMAILS` 允许名单授予。

### `workspaces`

- 企业客户的数据隔离边界。
- 状态：`active`、`suspended`、`disabled`。
- `owner_id` 指向工作区所有者。

### `workspace_members`

- 连接用户和企业工作区。
- 当前 MVP 角色：`owner`、`member`。
- `(workspace_id, user_id)` 唯一，防止重复成员关系。

## 服务端权限

```text
请求
├── 没有身份 → 401 或登录跳转
├── 用户被禁用 → 403
├── 工作区被暂停/禁用 → 403
├── 平台管理员 → 可读取所有工作区基础数据
└── 普通用户
    ├── 是目标工作区成员 → 允许
    └── 不是目标工作区成员 → 403
```

页面隐藏不作为安全边界。`/api/workspaces/:workspaceId` 会在服务端验证成员关系，`/api/admin/overview` 会验证 `is_platform_admin`。

## 平台管理员初始化

生产环境通过 Sites 配置：

```env
PLATFORM_ADMIN_EMAILS=owner@example.com,second-admin@example.com
```

允许名单中的用户登录后会被提升为平台管理员。移除允许名单不会自动降级已经提升的管理员，避免配置误操作导致平台失去所有管理员；需要显式数据库操作才能降级。

## 目录边界

```text
app/
├── login/ register/      登录和首次注册入口
├── dashboard/            工作区成员页面
├── admin/                平台管理员页面
└── api/                  受保护的 HTTP 接口
components/
├── auth/                 身份页面组件
└── shell/                客户端和管理端外壳
db/
├── schema.ts             D1 / Drizzle Schema
└── index.ts              D1 绑定入口
lib/
├── auth/                 账号同步和权限规则
├── api/                  统一 API 响应
└── domain/               领域词汇
drizzle/                  数据库迁移
tests/                    页面、权限和迁移测试
```

## 第 2 阶段入口条件

- D1 迁移成功应用。
- 至少一个 `platform_admin` 可以进入 `/admin`。
- 普通用户只能查看自己的工作区。
- 登录、退出和首次工作区创建验证通过。

满足后可以进入客户与套餐管理阶段。
