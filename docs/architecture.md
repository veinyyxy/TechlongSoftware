# SaaS 平台架构

## 当前阶段

当前平台已完成阶段 1–8，并将订阅模型升级为按产品保留当前与历史记录。

```text
ChatGPT 登录
→ 同步平台用户
→ 首次登录创建企业工作区
→ 建立 Owner 成员关系
→ 服务端按工作区或平台角色授权
→ 平台管理员维护客户，以及归属于产品的套餐
→ 平台管理员按产品创建订阅并录入付款
→ 客户只读查看本工作区的当前订阅、历史订阅和账单
→ Stripe 确认付款后创建待管理员开通的产品实例
```

Stripe Checkout 与签名 Webhook 已接入。自动续扣和自动部署不在当前版本范围内。

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
                           └── plan_id -> Plan
                           └── Subscription >── Product
                                  ├── Plan
                                  └── PaymentRecord
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

### `plans`

- 必须归属一个产品；套餐创建后不能转移到其他产品。
- 名称在同一产品内唯一，不同产品可以使用相同套餐名称。
- 价格以最小货币单位整数保存。
- 计费周期：`month`、`year`。
- 状态：`active`、`inactive`。
- 功能和限制以 JSON 文本持久化，由管理接口验证后写入。
- 前端只展示数据库读取结果，不保存套餐真值。

### `subscriptions`

- 必须关联一个工作区、一个产品和该产品下的套餐；服务端校验和数据库触发器共同阻止跨产品组合。
- 一个工作区可同时拥有不同产品的当前订阅，并可保留同一产品的多条历史订阅。
- 条件唯一索引只限制当前状态：同一 `(workspace_id, product_id)` 最多一条 `manual_pending`、`active`、`past_due` 或 `paused` 订阅。
- `canceled` 订阅保留为历史记录，不物理删除；取消后可为同一产品创建新订阅。
- 状态：`manual_pending`、`active`、`past_due`、`paused`、`canceled`。
- 保存当前计费周期起止时间和到期后取消标记。
- 保存创建订阅的平台管理员。

### 应用实例与套餐

- 应用实例直接关联工作区、产品，并可选关联订阅。
- 套餐通过 `app_instances.subscription_id → subscriptions.plan_id` 读取。
- `app_instances` 不重复保存 `plan_id`，避免订阅变更后出现两份不一致的套餐数据。

### `payment_records`

- 必须关联工作区，并可选关联订阅。
- 金额使用最小货币单位整数保存。
- 状态：`pending`、`paid`、`failed`。
- 保存手工付款方式、参考号、备注和录入管理员。
- 历史订阅不物理删除，因此付款与订阅的审计关系继续保留。

### 工作区兼容字段

- 联系人和联系邮箱属于企业客户资料。
- `plan_id` 和 `subscription_status` 仅记录兼容摘要，并由当前订阅管理操作同步；客户资料表单不能直接修改它们，多产品订阅真值来自 `subscriptions`。
- `subscription_status` 默认 `not_configured`。
- `app_instance_status` 默认 `not_provisioned`。
- `subscription_status` 由真实订阅记录同步，实例状态仍为后续阶段占位。

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

所有 `/api/admin/customers/**`、`/api/admin/plans/**`、`/api/admin/subscriptions/**` 和 `/api/admin/payments/**` 接口都复用同一个服务端平台管理员守卫。普通客户无法创建或修改客户、套餐、订阅及付款记录。

客户账单接口先验证当前身份及目标工作区成员关系，再使用 `workspace_id` 同时过滤订阅和付款记录，并区分当前订阅与历史订阅。普通客户没有账单写接口，也不能指定其他工作区读取数据。

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
├── admin/                客户与套餐管理
├── billing/              订阅、付款和表单校验
└── domain/               领域词汇
drizzle/                  数据库迁移
tests/                    页面、权限和迁移测试
```

## 第 4 阶段入口条件

- 订阅和付款迁移成功应用。
- 管理员可以创建订阅、维护状态和录入付款。
- 普通用户只能读取本工作区账单，不能修改。
- 非有效订阅和最近付款失败有清楚提醒。
- 所有付款记录都明确标注为手工录入，不代表真实支付。

满足后可以进入应用实例开通阶段。
