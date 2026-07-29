# 餐饮 SaaS 平台

面向企业客户的 SaaS 平台，逐步实现用户、企业工作区、套餐、收费和餐饮订单系统实例管理。

当前完成阶段 8，并新增了版本化“应用实例模板管理”：套餐绑定已发布模板版本，订阅保存客户配置，Stripe 付款成功后按该快照创建待开通实例，保留管理员最终开通检查。

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
- 管理员客户列表、搜索、状态筛选和客户详情。
- 创建、编辑、暂停及恢复企业客户工作区。
- 创建、编辑、启用及停用套餐。
- 管理员可以创建应用实例模板、维护草稿版本、发布不可变版本和归档旧版本。
- 模板配置字段区分客户需求（如店铺名称、主题）与套餐限制（如访问人数限制）；套餐限制由后端读取，不能由客户覆盖。
- 当前部署驱动只允许受控的 `manual` 标识，不接受脚本、密钥或任意部署命令。
- 每个套餐必须归属一个产品；同名套餐可存在于不同产品中，套餐创建后不能跨产品转移。
- 每个套餐必须绑定同一产品下的已发布实例模板版本；套餐创建后不能更换模板版本。
- 套餐价格使用最小货币单位保存，功能和限制保存在数据库中。
- 客户详情和客户控制台读取当前套餐、订阅状态和应用实例状态。
- 管理员创建、编辑并查看客户订阅。
- 创建订阅时根据套餐绑定的模板收集实例配置，并把模板版本和已解析配置固定在订阅中。
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
- 新应用实例从订阅复制模板版本和配置快照；实例创建后不能更换产品、订阅、模板版本或配置快照。
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
- 平台管理员先为客户配置待付款订阅；客户工作区 Owner 可在“订阅与账单”查看该订阅的套餐、周期、功能和限制，并确认后跳转至 Stripe Checkout。
- Checkout 金额、币种和套餐名称只由后端套餐记录生成；前端不会提交价格或付款状态。
- Stripe Webhook 使用原始请求体和签名密钥验证事件，保存事件摘要并按事件 ID 去重。
- 已验证的 Stripe 付款会写入付款记录并激活或更新订阅；若该工作区尚无餐饮订单系统实例，会自动创建一条 `pending` 待开通记录。
- 自动创建的实例没有访问入口且绝不会直接开通；管理员必须填写有效的买家端 `access_url` 后才可标记为已开通，并可同时维护卖家端 `seller_apk_url`。
- 每个工作区的每个产品最多一条应用实例，避免重复 Webhook 或重复付款生成多个入口；实例来源可区分“付款成功自动创建”和管理员手动创建。
- 管理员“补建遗漏实例”只选择订阅，企业、产品和套餐归属全部从订阅自动确定，不允许手工指定其他企业。
- 管理员原有的手动订阅、手动付款记录和订阅状态调整能力继续保留；付款记录标记来源为 Stripe 或人工记录。

## 当前没有实现

- Paddle、自动续扣、Stripe 订阅模式、退款自动化、优惠券和复杂发票系统。
- 复杂发票、优惠券和自动退款。
- 自动部署、云资源创建、Docker / Kubernetes 发布和复杂部署日志。
- 模板中的部署驱动目前只保存受控标识，不会执行自动部署流程。
- 多产品市场。
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
npm run typecheck
npm run build
npm run lint
npm test
```

## 环境变量与管理员初始化

`NEXT_PUBLIC_PLATFORM_NAME` 仅用于公开品牌名称。`PLATFORM_ADMIN_EMAILS` 是以逗号分隔的管理员邮箱允许名单，必须配置在本地 `.env.local` 或 Sites 的生产环境变量中，不能提交真实邮箱、密码或密钥。

Stripe 一期只需要服务端环境变量：`STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`。本地测试使用 `sk_test_...` 和 Stripe CLI 生成的 `whsec_...`；生产环境在 Sites 中配置对应的真实值。两者都不能以公开环境变量、前端代码或 Git 提交方式保存。

管理员不通过数据库脚本或密码创建：将真实 ChatGPT 邮箱加入 `PLATFORM_ADMIN_EMAILS` 后，该用户首次使用 ChatGPT 登录时会自动同步为平台用户、创建所属工作区，并获得平台管理员权限。普通企业用户不在允许名单中，首次登录只会创建自己的企业工作区。

不要使用 `sites-screenshot-service-noreply@chatgpt.com` 作为测试客户；它是 Sites 的系统截图服务账号，不能供人工登录。

## 上线试运行

发布前依次执行 `npm run lint`、`npm run typecheck`、`npm run build` 和 `npm test`。完整的管理员流程、客户流程、状态提示、权限隔离和数据来源验收步骤见 [上线检查清单](./docs/launch-checklist.md)。Stripe 测试模式、Webhook 与上线操作见 [Stripe 支付操作说明](./docs/stripe-payment-operations.md)。

在私有 Sites 上试运行时，应至少使用两个真实 ChatGPT 账号：一个在管理员允许名单内，另一个作为普通企业客户。可先在管理员端完成手动流程；也可通过 Stripe 测试付款验证自动待开通流程，详细操作见 [支付后待开通实例说明](./docs/auto-pending-provisioning.md)。

## 数据库

逻辑 D1 绑定名为 `DB`。数据库结构位于 `db/schema.ts`，迁移文件位于 `drizzle/`。

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
- `subscriptions.template_version_id` 与 `subscriptions.instance_configuration`
- `app_instances.template_version_id` 与 `app_instances.configuration_snapshot`
- 默认写入并复用“餐饮订单系统标准模板 v1”，旧套餐和订阅由迁移安全回填
- 数据库触发器阻止跨产品模板、套餐/订阅模板不匹配、已发布版本内容修改以及实例快照与订阅不匹配

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

客户路由：

- `/dashboard`
- `/dashboard/members`
- `/dashboard/settings`
- `/dashboard/billing`
- `/dashboard/billing/payment-result`
- `/dashboard/apps`
- `/dashboard/apps/:instanceId`
- `/api/account`
- `/api/workspaces/:workspaceId`
- `/api/workspaces/:workspaceId/billing`
- `/api/workspaces/:workspaceId/apps`
- `/api/workspaces/:workspaceId/checkout`
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
- `/admin/instances`
- `/admin/instances/new`
- `/admin/instances/:instanceId`
- `/admin/instances/:instanceId/edit`
- `/api/admin/overview`
- `/api/admin/customers`
- `/api/admin/customers/:customerId`
- `/api/admin/plans`
- `/api/admin/plans/:planId`
- `/api/admin/templates`
- `/api/admin/templates/:templateId`
- `/api/admin/templates/:templateId/versions`
- `/api/admin/templates/:templateId/versions/:versionId`
- `/api/admin/subscriptions`
- `/api/admin/subscriptions/:subscriptionId`
- `/api/admin/payments`
- `/api/admin/instances`
- `/api/admin/instances/:instanceId`

保留的后续阶段占位路由不会出现在当前导航中。

## 下一步建议

先在 Stripe 测试模式完成双账号验收、模板→套餐→订阅配置→实例快照链路、Webhook 重复投递和管理员待开通检查，再决定是否配置 Stripe 生产密钥。自动续扣、Stripe 订阅模式、退款、自动部署和多实例仍不属于当前版本。模板使用说明见 [应用实例模板管理](./docs/app-instance-template-management.md)。
