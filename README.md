# 餐饮 SaaS 平台

面向企业客户的 SaaS 平台，逐步实现用户、企业工作区、套餐、收费和餐饮订单系统实例管理。

当前已在阶段 8 基础上完成客户自助购买一期、Neon PostgreSQL 迁移、自有认证一期，并建立 AWS Sandbox S0–S3 执行基础：企业用户可用邮箱密码注册/登录，选择管理员维护的共享套餐并配置允许的租户参数；只有 Stripe 已验证 Webhook 才会创建或续期订阅、准备待开通实例并生成可审计的 AWS 目标计划。S0 提供静态费用与权限护栏，S1 提供部署状态机与任务，S2 加固订单服务控制契约，S3 新增默认关闭的独立 Worker、STS/CloudFormation Adapter、两小时 TTL 清理和 mTLS 控制边界。当前所有执行 gate 保持关闭，未配置租户数据库和 mTLS transport 时也会 fail closed；普通网站启动和测试不会调用 AWS 或创建云资源。

## 已实现

- 使用应用自有的邮箱密码完成注册和登录，不再依赖 ChatGPT 账号。
- 密码使用随机盐和 PBKDF2-SHA256 哈希保存；连续失败会触发临时账号锁定。
- 登录态使用数据库保存的随机会话 Token，浏览器只接收 `HttpOnly`、`SameSite=Lax` Cookie。
- 企业用户自助注册时自动创建企业工作区和 `owner` 成员关系。
- 管理员创建的客户不会获得默认密码；管理员可生成 48 小时有效的一次性激活链接，由客户自行设置密码。
- 企业工作区状态：`active`、`suspended`、`disabled`。
- 工作区成员角色：`owner`、`member`。
- 用户表中的 `is_platform_admin` 平台管理员标记。
- 平台管理员邮箱允许名单。
- 客户控制台、成员页面和工作区设置基础页。
- 管理员概览、用户列表和工作区列表基础页。
- 服务端工作区成员校验和平台管理员校验。
- 无权限页面及统一的 `401` / `403` API 响应。
- 管理员客户列表、搜索、状态筛选和客户详情。
- 创建、编辑、暂停及恢复企业客户工作区。
- 创建、编辑、启用及停用套餐。
- 管理员可以创建应用实例模板、维护草稿版本、发布不可变版本和归档旧版本。
- 模板配置字段区分客户需求与套餐参数；餐饮订单系统新版本会带入与 `SAAS_CONTROL.md` 对齐的 23 项动态字段，套餐参数由后端读取，不能由客户覆盖。
- 模板部署标识和 AWS 部署计划驱动都采用受控允许名单，不接受脚本、密钥或任意部署命令。
- 每个套餐必须归属一个产品；同名套餐可存在于不同产品中，套餐创建后不能跨产品转移。
- 每个套餐必须绑定同一产品下的已发布实例模板版本；套餐创建后不能更换模板版本。
- 选择模板版本后，套餐表单会直接展开模板参数：`plan` 参数在套餐中以 number / boolean / null 原生类型固定，`customer` 参数可设置默认值并在购买或创建订阅时填写。
- 套餐价格使用最小货币单位保存，功能和限制保存在数据库中。
- 客户详情和客户控制台读取当前套餐、订阅状态和应用实例状态。
- 客户 Owner 自助选择共享套餐并填写模板允许的实例配置；付款成功后系统根据套餐、模板版本和配置快照自动创建订阅，不会为每个客户复制一条套餐记录。
- 管理员仍可查看和编辑客户订阅；手动创建订阅仅作为特殊客户或故障恢复的应急兜底。
- 创建订阅时根据套餐绑定的模板解析实例配置，并把模板版本和已解析配置固定在订阅中。
- 订阅支持 `manual_pending`、`active`、`past_due`、`paused`、`canceled`。
- 一个工作区可保留多个产品、多个历史订阅；同一工作区的同一产品同一时间只允许一个当前订阅。
- 创建订阅时只显示所选产品下的套餐，服务端和数据库都会阻止跨产品套餐组合。
- `manual_pending`、`active`、`past_due`、`paused` 视为当前订阅，`canceled` 视为历史订阅；取消后可为同一产品重新创建订阅。
- 管理员可以暂停、恢复和取消订阅。
- 管理员手工录入并筛选付款记录。
- 付款金额使用最小货币单位整数保存。
- 付款状态支持 `pending`、`paid`、`failed`、`canceled`。
- 客户只读查看本工作区的订阅、当前账期和付款历史。
- 非有效订阅或最近付款失败时，客户控制台显示明显提醒。
- 内置一个可分配产品：`餐饮订单系统`（`restaurant-order-system`）。
- 管理员可以创建、编辑、筛选和查看客户应用实例。
- 应用实例关联工作区、产品，并可选关联订阅。
- 新应用实例从订阅复制模板版本和配置快照；管理员不能在实例编辑页任意更换这些归属。客户结束旧订阅后重新购买同一产品时，系统会把唯一实例安全重绑到新订阅、刷新受控配置快照并恢复为 `pending`，等待重新开通。
- 应用实例通过关联订阅读取对应套餐，管理员实例列表和详情会显示该套餐；实例表不重复保存 `plan_id`。
- 应用实例状态支持 `pending`、`active`、`suspended`、`failed`。
- 只有关联有效订阅的实例允许被标记为 `active`。
- 管理员可以暂停和恢复应用实例；所有实例管理接口均要求平台管理员权限。
- 客户只能查看自己工作区的“我的应用”、应用状态和管理员登记的访问地址。
- 买家端 `access_url` 与卖家端 `seller_apk_url` 由管理员在后端记录中维护；平台不会自动部署或修改餐饮订单系统。
- 客户 Dashboard 显示企业名称、当前套餐、订阅状态、当前周期结束时间和最近付款状态。
- 客户 Dashboard 显示餐饮订单系统状态与管理员登记的访问地址；仅在有效订阅、已开通实例和有效 URL 同时满足时显示进入按钮。
- `manual_pending`、付款已确认但未开通、订阅异常、服务暂停、开通失败和未创建实例均有明确客户侧提示。
- 健康检查会返回当前发布阶段；被暂停或停用的工作区会收到明确提示，不会被循环跳转回受限的客户控制台。
- 客户工作区 Owner 可自行选择套餐、填写模板允许的客户参数并跳转至 Stripe Checkout；管理员预先创建的 `manual_pending` 订阅仍可继续使用原有付款入口。
- Checkout 金额、币种和套餐名称只由后端套餐记录生成；前端不会提交价格或付款状态。
- Stripe Webhook 使用原始请求体和签名密钥验证事件，保存事件摘要并按事件 ID 去重。
- 已验证的 Stripe 付款会写入付款记录并激活或更新订阅；若该工作区尚无餐饮订单系统实例，会自动创建一条 `pending` 待开通记录。
- 自动创建的实例没有访问入口且绝不会直接开通；管理员必须填写有效的买家端 `access_url` 后才可标记为已开通，并可同时维护卖家端 `seller_apk_url`。
- 每个工作区的每个产品最多一条应用实例，避免重复 Webhook 或重复付款生成多个入口；实例来源可区分“付款成功自动创建”和管理员手动创建。
- 管理员“补建遗漏实例”只选择订阅，企业、产品和套餐归属全部从订阅自动确定，不允许手工指定其他企业。
- 管理员原有的手动订阅、手动付款记录和订阅状态调整能力继续保留；付款记录标记来源为 Stripe 或人工记录。
- 企业客户可在“选择套餐”查看所有已启用、可购买的产品套餐，价格、功能、限制和模板参数全部来自后端。
- 只有工作区 `owner` 可以发起购买、续费、取消待付款订单或设置到期取消；普通成员只有查看权限。
- 客户新购先创建 `subscription_purchase_orders`，不会在浏览器或付款前创建有效订阅。
- Stripe Webhook 会再次核对服务器订单金额和币种；成功后才创建 `customer_checkout` 来源订阅，续费则延长原订阅周期。
- 客户可以对有效或逾期订阅发起同套餐续费，并可为有效订阅设置或撤销“周期结束后取消”；本期不提供即时取消、升级、降级或按比例计费。
- `workspace_product_entitlements` 按工作区和产品保存当前订阅与唯一应用实例的对应关系；重新购买不会重复创建同产品实例。
- 管理员可在“购买订单”查看客户新购/续费订单、Stripe 状态、关联订阅和失败原因。
- 套餐绑定版本化的受控 AWS 部署资源档位，档位会随购买订单和订阅快照固定，客户不能自行篡改；当前 Sandbox 环境策略只允许 `standard-v1`，历史或生产目标档位不能绕过 Sandbox 的 Cell、任务数和数据库限制。
- 已验证付款在生成或复用 `pending` 应用实例后，还会幂等生成一条 `app_instance_deployments` 计划记录，描述共享层、Cell 层和租户层资源的逻辑目标。
- S1 已建立持久化部署环境、状态机、可租约任务、步骤执行记录、预检和 CloudFormation 租户模板渲染基础；渲染产物不包含 Secret 值，也不会被提交到 AWS。
- `DEPLOYMENT_WORKER_ENABLED=false` 与 `AWS_APPLY_ENABLED=false` 是默认安全边界；单独开启 Apply 变量仍会被数据库环境、执行绑定、参数、清理计划、STS 身份和未配置 Adapter 等其余门禁拒绝。Apply 关闭时，已启用 Worker 仍允许通过严格身份门禁的 cleanup/rollback 删除到期资源；要停止所有 AWS 调用必须关闭 Worker。
- Sandbox 的未来数据库目标限定为最多一个 Aurora PostgreSQL Serverless v2 Cell；每个租户在该 Cell 内使用独立 database 和 role，订单服务继续使用该租户数据库自己的 `public.*`。

## 当前没有实现

- Paddle、自动续扣、Stripe 订阅模式、退款自动化、优惠券和复杂发票系统。
- 复杂发票、优惠券和自动退款。
- S3 Worker 与 CloudFormation adapter 边界已经存在，但真实 Tenant Database、ELBv2/EC2 Shared Cell 安全证明、mTLS Control/配置编译 adapter 仍为 fail-closed，`applyRuntimeReady=false`；因此当前不会真实创建云资源，也不包含 Aurora Cell 创建、租户 database/role/Secret 生命周期、DNS 变更或自动回写正式入口。
- 平台尚未调用订单服务 S2 控制接口，也没有建立生产 mTLS 通道；模板部署驱动和 `app_instance_deployments` 仍不会触发真实自动部署。
- 多产品市场。
- 成员邀请和角色变更。
- 邮箱验证、忘记密码/重置密码、MFA、邮件自动发送和第三方 OAuth。
- 面向公网的 IP 级限流、验证码和完整安全告警。

当前认证一期适合本地和受控测试。密码不会以明文保存；正式公开上线前仍应补齐邮箱验证、密码重置、IP 级限流和安全监控。

## 技术栈

- TypeScript
- React 19
- Next.js 16 API / App Router 风格
- Vinext + Vite
- Tailwind CSS 4
- Drizzle ORM + Neon PostgreSQL
- Vinext + Vite 本地运行（可后续部署到自有托管环境）

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
copy .env.example .env.local
npm run dev
```

在 `.env.local` 设置 Neon 和 Stripe 服务端配置：

```env
DATABASE_URL=postgresql://app_user:password@example-pooler.neon.tech/neondb?sslmode=require
AUTH_SESSION_DAYS=7
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
AWS_REGION=ca-central-1
AWS_DEFAULT_CELL_KEY=cell-sandbox-1
AWS_DEPLOYMENT_ENVIRONMENT_KEY=aws-sandbox-ca-central-1
AWS_APPLY_ENABLED=false
AWS_SANDBOX_ACCOUNT_ID=402010193138
AWS_SANDBOX_BUDGET_LIMIT_USD=10
AWS_SANDBOX_TTL_SECONDS=7200
AWS_SANDBOX_MAX_CELLS=1
AWS_SANDBOX_MAX_TENANTS=1
AWS_SANDBOX_BASE_DOMAIN=sandbox.techlong.cloud
```

首次切换现有 Neon 数据库时，先应用增量迁移，再初始化或重置一个平台管理员密码：

```powershell
npm run db:postgres:migrate
$env:AUTH_BOOTSTRAP_EMAIL="admin@example.com"
$env:AUTH_BOOTSTRAP_NAME="平台管理员"
$env:AUTH_BOOTSTRAP_PASSWORD="请替换为至少12字符的临时密码"
npm run auth:bootstrap-admin
Remove-Item Env:AUTH_BOOTSTRAP_PASSWORD
npm run dev
```

`auth:bootstrap-admin` 会复用同邮箱的现有用户，并设置 `is_platform_admin=1`；重复运行会重置该管理员密码并注销其旧会话。不要把真实密码写入 `.env.example`、源码或 Git。

常用命令：

```bash
npm run db:generate
npm run db:postgres:init
npm run db:postgres:migrate
npm run auth:bootstrap-admin
npm run typecheck
npm run build
npm run lint
npm test
```

## 环境变量与管理员初始化

`NEXT_PUBLIC_PLATFORM_NAME` 仅用于公开品牌名称。`AUTH_SESSION_DAYS` 控制自有登录会话有效天数，可设为 1–30，默认 7 天。平台管理员权限只由数据库 `users.is_platform_admin` 决定，不再通过邮箱允许名单自动提升。

`DATABASE_URL` 是服务端使用的 Neon PostgreSQL pooled connection string。本地通过未提交的 `.env.local` 配置，未来部署时应使用目标托管平台的 secret；不要添加 `NEXT_PUBLIC_` 前缀，也不要把真实连接串提交到 Git。`npm run db:postgres:init` 只用于初始化全新的空 `public` schema，检测到已有表时会拒绝执行；已有数据库使用 `npm run db:postgres:migrate`。

Stripe 一期只需要服务端环境变量：`STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`。本地测试使用 `sk_test_...` 和 Stripe CLI 生成的 `whsec_...`；生产环境在目标托管平台配置对应的 secret。两者都不能以公开环境变量、前端代码或 Git 提交方式保存。

AWS Sandbox 固定目标为 Account `402010193138`、Region `ca-central-1`、月预算 `10 USD`、TTL `7200` 秒、最多一个 Cell 和一个租户、基础域名 `sandbox.techlong.cloud`。默认 `DEPLOYMENT_WORKER_ENABLED=false`、`AWS_APPLY_ENABLED=false`；单独修改任一变量都不能执行。数据库环境开关、assumed-role STS 身份、严格参数、cleanup 记录、租户数据库迁移和 mTLS 控制对账必须同时通过。这些变量不代表资源已创建。

AWS CLI v2 已位于 `D:\Amazon\AWSCLIV2\aws.exe`，当前终端 PATH 可能尚未刷新。在真实 Windows 用户上下文中已验证 Profile `techlong-sandbox-user`：Region 为 `ca-central-1`，STS Account 为 `402010193138`，身份是 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；核验没有读取或输出密钥。该 IAM User 已绑定 MFA，本机也已配置不含密钥的 `techlong-sandbox-provisioner` AssumeRole Profile。S3-A CloudFormation Bootstrap 已部署受限角色、TTL Janitor、不可变 ECR、受控 CodeBuild 与私有源码 Bucket；最新 Distroless 应用镜像已通过构建期运行时 smoke test 和 ECR 零发现扫描，但尚未写入 execution binding，也没有启动 Worker。仍未创建 Cell、ALB、ECS、Aurora、VPC 或 DNS。进入真实租户 Apply 前，应继续把该 IAM User 收敛为只允许 AssumeRole，并让 Worker 使用专用角色的短期凭据；不要在仓库或 `.env.local` 中配置长期 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`。

只读 `organizations describe-organization` 返回 `AWSOrganizationsNotInUseException`，因此账号当前是 standalone，不属于 AWS Organizations。SCP 当前不可用，本方案也不会为了获得 SCP 而让账号加入 Organizations；S3 使用窄权限 IAM Policy、高风险动作显式 Deny、Permissions Boundary 和专用 AssumeRole 角色组合控制权限。账号类型已经确认，S3 前无需重复把“确认账号类型”列为门禁，除非账号归属后来被人工改变。

账号原有的 `My Zero-Spend Budget`（`1 USD`）保持不变；S3-A 已另行部署按 `Environment=aws-sandbox` 过滤的 `10 USD` Budget，并配置 10/30/50/80/100% 邮件告警。两者都只是有延迟的告警，不是费用硬停。只读 RDS 查询显示 `ca-central-1` 当前提供普通（非 Limitless）Aurora PostgreSQL 16.8–16.14，16.3 不在当前返回列表；S0 的 `>=16.3` 只表示最低兼容约束，真实创建前必须动态核对非 Limitless 版本。S0–S2 基线见 [AWS Sandbox S0–S2 说明](./docs/aws-sandbox-s0-s2.md)，S3 门禁与 Worker 说明见 [AWS Sandbox S3 部署执行器](./docs/aws-sandbox-s3-worker.md)。

平台首个管理员通过 `npm run auth:bootstrap-admin` 初始化。管理员在“客户管理”创建企业后，需要进入客户详情生成一次性激活链接并发送给 Owner；系统本期不自动发送邮件。

## 上线试运行

发布前依次执行 `npm run lint`、`npm run typecheck`、`npm run build` 和 `npm test`。完整的管理员流程、客户流程、状态提示、权限隔离和数据来源验收步骤见 [上线检查清单](./docs/launch-checklist.md)。Stripe 测试模式、Webhook 与上线操作见 [Stripe 支付操作说明](./docs/stripe-payment-operations.md)。

本地试运行时，应至少使用两个不同浏览器配置文件或一个普通窗口加一个无痕窗口：一个登录平台管理员，另一个注册普通企业客户。主流程应由企业 Owner 自助选择共享套餐、填写参数并完成 Stripe 测试付款；管理员手工订阅仅用于应急验证。支付后待开通流程见 [支付后待开通实例说明](./docs/auto-pending-provisioning.md)，AWS Cell 目标架构见 [AWS ECS Cell 部署与执行基础](./docs/aws-ecs-cell-deployment-demo.md)，S0–S2 操作边界见 [AWS Sandbox S0–S2 说明](./docs/aws-sandbox-s0-s2.md)。

## 数据库

当前生产主数据库为 Neon PostgreSQL，应用只从服务端 `DATABASE_URL` 读取连接串。权威 DDL 位于 `db/postgres-schema.sql`，Drizzle 模型位于 `db/postgres-schema.ts` 和 `db/postgres-relations.ts`；`drizzle.config.ts` 已切换为 PostgreSQL。

原 Sites D1 的逻辑绑定名仍为 `DB`，但不再承载应用请求，只暂时保留为切换前的回滚备份。`db/schema.ts` 与 `drizzle/*.sql` 是旧 D1 结构和迁移历史，不能用来初始化 Neon。迁移、连接和回滚注意事项见 [Neon PostgreSQL 操作说明](./docs/neon-postgresql.md)。

以下列表记录业务数据结构的演进；这些表已经完整映射到 PostgreSQL。

阶段 1 创建：

- `users`
- `workspaces`
- `workspace_members`

阶段 2 新增：

- `plans`
- `workspaces.contact_name`
- `workspaces.contact_email`
- `workspaces.plan_id`
- `workspaces.subscription_status`
- `workspaces.app_instance_status`

阶段 3 新增：

- `subscriptions`
- `payment_records`

阶段 4 新增：

- `products`
- `app_instances`

阶段 7 新增：

- `payment_checkout_sessions`
- `payment_webhook_events`
- `payment_records.provider`
- `payment_records.provider_payment_id`
- `payment_records.provider_event_id`
- `payment_records.failure_reason`

阶段 8 新增：

- `app_instances.provisioning_source`（`manual` / `payment_success`）
- `app_instances` 的 `(workspace_id, product_id)` 唯一约束，当前 MVP 每个工作区仅允许一个产品实例

客户自助购买一期新增：

- `subscription_purchase_orders`：保存新购/续费订单、套餐与模板快照、服务器金额、Stripe 会话和处理状态
- `workspace_product_entitlements`：保存 `(workspace_id, product_id)` 对应的当前订阅和唯一应用实例
- `subscriptions.creation_source`：区分 `admin_manual` 与 `customer_checkout`
- `payment_webhook_events.purchase_order_id`：把已验证 Stripe 事件关联到客户购买订单

AWS Cell 部署计划与 S1 执行基础新增：

- `plans.deployment_profile_key`：管理员为共享套餐选择的受控资源档位
- `subscription_purchase_orders.deployment_profile_key`：购买时固定的套餐资源档位快照
- `subscriptions.deployment_profile_key`：付款成功后固定到订阅的资源档位快照
- `deployment_environments`：保存受控环境、预期 Account/Region、Cell、域名和策略快照；`apply_enabled` 在当前 Sandbox 保持关闭
- `app_instance_deployments`：保存应用实例对应的目标计划、哈希、幂等键、环境关联、状态和非敏感输出；不保存凭据或 Secret 值
- `deployment_jobs`：保存 Apply/回滚/校正/清理任务的幂等键、租约、重试与死信状态；独立 Worker 已存在，但 `applyRuntimeReady=false` 且真实 Adapter 未配置，当前不会创建 AWS 资源
- `deployment_step_runs`：保存每个部署步骤的输入哈希、尝试次数、结果摘要和脱敏错误，支持将来的可审计执行

自有认证一期新增：

- `user_credentials`：保存加盐密码哈希、算法迭代次数和登录失败锁定状态
- `auth_sessions`：保存会话 Token 的 SHA-256 摘要和过期时间，不保存浏览器收到的原始 Token
- `auth_invitations`：保存管理员为既有客户生成的一次性激活邀请摘要
- `schema_migrations`：记录已应用的 PostgreSQL 增量迁移及校验和

多产品订阅升级：

- `subscriptions.product_id`（必填）
- `plans.product_id`（迁移回填并由数据库触发器强制必填）
- 套餐名称唯一约束改为 `(product_id, name)`
- 移除 `subscriptions.workspace_id` 的旧唯一约束
- 当前订阅的 `(workspace_id, product_id)` 条件唯一约束
- `payment_checkout_sessions.subscription_id`（必填）及进行中 Checkout 唯一约束

应用实例模板扩展：

- `app_instance_templates`：归属产品的模板主记录
- `app_instance_template_versions`：草稿、已发布、已归档的版本记录
- `plans.template_version_id`：套餐绑定的不可变模板版本
- `plans.template_configuration`：套餐级参数与客户参数默认值（保留原生 number / boolean / null）
- `subscriptions.template_version_id` 与 `subscriptions.instance_configuration`
- `app_instances.template_version_id` 与 `app_instances.configuration_snapshot`
- 默认写入并复用“餐饮订单系统标准模板 v1”，旧套餐和订阅由迁移安全回填
- 数据库触发器阻止跨产品模板、套餐/订阅模板不匹配、已发布版本内容修改以及实例快照与订阅不匹配
- 模板 Schema v2 使用 `outputPath` 将版本快照编译为订单系统的 `entitlements`、`default_store` 和非敏感 `first_owner` JSON；订单控制面本身不接收 XML

订阅必须关联 `workspace`、`product` 和该产品下的 `plan`。数据库使用触发器阻止产品与套餐不匹配，并使用条件唯一索引保证同一 `(workspace_id, product_id)` 同一时间最多一个当前订阅，同时保留已取消订阅作为历史记录；其他产品的当前订阅互不影响。付款记录关联 `workspace`，并可选关联订阅。`amount` 使用最小货币单位整数，避免浮点金额误差。应用实例关联 `workspace`、`product`，并可选关联订阅；对应套餐通过订阅读取，不在实例表重复保存。实例同时保存管理员填写的买家端 `access_url`、卖家端 `seller_apk_url`、`domain` / `slug` 和 `tenant_key`。

迁移会幂等写入默认产品：`餐饮订单系统` / `restaurant-order-system` / `active`，并将旧订阅安全回填到该产品。工作区上的 `plan_id`、`subscription_status` 和 `app_instance_status` 仅作为兼容状态快照，由订阅和应用实例管理操作同步更新；实际订阅以 `subscriptions` 为准，实际应用实例以 `app_instances` 为准。

所有客户业务查询必须通过 `workspace_id` 和成员关系限制范围。平台管理员是唯一允许跨工作区读取基础数据的角色。

## 当前路由

公共路由：

- `/`
- `/login`
- `/register`
- `/unauthorized`
- `/api/health`
- `/api/auth/login`
- `/api/auth/register`
- `/api/auth/logout`

客户路由：

- `/dashboard`
- `/dashboard/members`
- `/dashboard/settings`
- `/dashboard/billing`
- `/dashboard/billing/payment-result`
- `/dashboard/plans`
- `/dashboard/plans/:planId/purchase`
- `/dashboard/apps`
- `/dashboard/apps/:instanceId`
- `/api/account`
- `/api/workspaces/:workspaceId`
- `/api/workspaces/:workspaceId/billing`
- `/api/workspaces/:workspaceId/apps`
- `/api/workspaces/:workspaceId/checkout`
- `/api/workspaces/:workspaceId/purchase-orders`
- `/api/workspaces/:workspaceId/purchase-orders/:orderId`
- `/api/workspaces/:workspaceId/subscriptions/:subscriptionId/cancel-at-period-end`
- `/api/stripe/webhook`

管理员路由：

- `/admin`
- `/admin/users`
- `/admin/customers`
- `/admin/customers/new`
- `/admin/customers/:customerId`
- `/admin/customers/:customerId/edit`
- `/admin/plans`
- `/admin/plans/new`
- `/admin/plans/:planId/edit`
- `/admin/templates`
- `/admin/templates/new`
- `/admin/templates/:templateId`
- `/admin/templates/:templateId/edit`
- `/admin/templates/:templateId/versions/new`
- `/admin/templates/:templateId/versions/:versionId/edit`
- `/admin/subscriptions`
- `/admin/subscriptions/new`
- `/admin/subscriptions/:subscriptionId`
- `/admin/subscriptions/:subscriptionId/edit`
- `/admin/payments`
- `/admin/payments/new`
- `/admin/purchase-orders`
- `/admin/instances`
- `/admin/instances/new`
- `/admin/instances/:instanceId`
- `/admin/instances/:instanceId/edit`
- `/api/admin/overview`
- `/api/admin/customers`
- `/api/admin/customers/:customerId`
- `/api/admin/customers/:customerId/invitation`
- `/api/admin/plans`
- `/api/admin/plans/:planId`
- `/api/admin/templates`
- `/api/admin/templates/:templateId`
- `/api/admin/templates/:templateId/versions`
- `/api/admin/templates/:templateId/versions/:versionId`
- `/api/admin/subscriptions`
- `/api/admin/subscriptions/:subscriptionId`
- `/api/admin/payments`
- `/api/admin/purchase-orders`
- `/api/admin/instances`
- `/api/admin/instances/:instanceId`

保留的后续阶段占位路由不会出现在当前导航中。

## 下一步建议

先在 Stripe 测试模式完成双账号验收，并在本地验证 S0 静态护栏、S1 状态机/任务幂等性、S2 控制契约以及 S3 “任一 gate 缺失时 AWS 调用为零”、参数允许名单、幂等 Apply 和 retry。真实 AWS Apply 仍须在 assumed-role Profile、STS Account/Role 校验、预算通知、TTL Janitor、最小权限执行角色、DNS 委派、租户数据库 Adapter、mTLS transport 和回滚演练全部通过后单独批准；不得直接开启示例变量。升级/降级、退款和多实例仍不属于当前版本。模板使用说明见 [应用实例模板管理](./docs/app-instance-template-management.md)，S3 启用门禁见 [AWS Sandbox S3 部署执行器](./docs/aws-sandbox-s3-worker.md)。
