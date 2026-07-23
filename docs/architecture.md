# SaaS 平台项目架构

## 当前阶段

本仓库只完成可以继续开发的项目骨架，不实现真实登录、收费、客户管理或实例开通。

第一版运营闭环固定为：

```text
管理员配置套餐
→ 管理企业客户工作区
→ 手动记录订阅和付款状态
→ 手动创建餐饮订单系统实例
→ 客户查看真实状态和应用入口
```

## 技术选择

- 模块化单体：保持一个部署单元，减少 MVP 运维成本。
- TypeScript + React + Next.js 风格路由：公共站点、客户控制台、管理端和 API 共享类型。
- Vinext + Cloudflare Worker：保持 Next.js 开发体验，并可快速发布到边缘运行环境。
- Tailwind CSS 4：提供基础设计系统；当前页面主要使用项目级语义样式。
- Drizzle ORM：后续接入数据库时保留显式 Schema 与迁移文件。
- Zod：将在账号和业务写接口阶段用于环境变量和输入验证。

数据库供应商尚未最终确认。模板保留 D1 接入能力；如果现有餐饮系统或团队要求 PostgreSQL，可在接入数据阶段切换 Drizzle 驱动，不影响当前页面与领域边界。

## 目录边界

```text
app/
├── page.tsx                 公共入口
├── dashboard/               企业客户侧
├── admin/                   平台管理侧
└── api/                     HTTP 接口
components/
├── foundation/              当前阶段说明组件
└── shell/                   客户端与管理端外壳
config/                      产品级配置
lib/
├── api/                     API 响应约定
└── domain/                  领域类型与权限词汇
db/                          数据库 Schema（下一阶段接入）
drizzle/                     数据库迁移
docs/                        架构和决策记录
tests/                       构建产物测试
worker/                      Cloudflare Worker 入口
```

## 目标领域模型

所有客户业务数据必须通过 `workspace_id` 隔离。

```text
User ──< WorkspaceMember >── Workspace
                                  │
                                  ├── Subscription ── Plan
                                  ├── PaymentRecord
                                  ├── AppInstance ── Product
                                  └── AuditLog
```

第一批目标表：

- `users`
- `workspaces`
- `workspace_members`
- `plans`
- `subscriptions`
- `payment_records`
- `products`
- `app_instances`
- `audit_logs`

本阶段没有创建数据库表，因此没有迁移变化。

## 强制边界

- 普通用户只能读取当前工作区的数据。
- 平台管理员权限与工作区 Owner/Admin 权限必须分离。
- 页面隐藏不能代替服务端权限检查。
- 所有写接口需要输入验证、审计记录和幂等策略。
- 金额使用最小货币单位，时间以 UTC 保存。
- 密钥只从环境变量读取，不进入客户端或仓库。

## 待确认

1. 平台正式名称。
2. 现有餐饮订单系统技术栈及多租户方式。
3. 客户入口使用子域名、独立域名还是路径。
4. MVP 数据库采用 PostgreSQL 还是 D1。
5. 登录方式及邮件服务。
6. 套餐、币种与计费周期。
7. SaaS 平台与餐饮订单系统的数据库关系。
