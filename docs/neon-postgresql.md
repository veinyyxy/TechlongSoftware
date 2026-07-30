# Neon PostgreSQL 操作说明

## 当前状态

应用的主数据库是 Neon PostgreSQL。运行时只通过服务端环境变量 `DATABASE_URL` 连接 Neon；浏览器代码不会读取数据库连接串。

原 Sites D1 数据库暂时保留为迁移前回滚备份，但应用请求不再读写 D1。确认 Neon 版本稳定并完成独立备份前，不要删除 D1 绑定或数据。

## 本地连接

在项目根目录创建未提交的 `.env.local`：

```env
DATABASE_URL=postgresql://app_user:password@example-pooler.neon.tech/neondb?sslmode=require
AUTH_SESSION_DAYS=7
```

本地启动：

```bash
npm ci
npm run db:postgres:migrate
npm run dev
```

pgAdmin、DBeaver 或 `psql` 可以使用同一套 Neon 主机、数据库、用户、密码与 SSL 参数查看表结构。应用运行时建议使用 Neon 的 pooled 地址；执行需要持久会话的管理任务时可使用 Neon 提供的 direct 地址。

## 新空数据库初始化

`db/postgres-schema.sql` 是当前权威 DDL。仅对没有任何业务表的全新 `public` schema 执行：

```bash
npm run db:postgres:init
```

脚本发现已有表会立即停止，不会覆盖现有数据库。生产结构变更应新增可审查、可回滚的 PostgreSQL migration，不要重复运行初始化脚本。已有数据库通过 `npm run db:postgres:migrate` 应用 `db/postgres-migrations` 中尚未执行的迁移，脚本会校验已执行文件的 SHA-256，防止事后篡改。

## 数据与安全

- 金额按最小货币单位的 `bigint` 保存，应用只接受安全整数。
- JSON 配置使用 `jsonb`，数据库约束要求对象结构。
- 当前订阅条件唯一索引、产品/套餐/模板关系以及已发布模板不可变规则均由 PostgreSQL 约束或触发器保护。
- `DATABASE_URL`、Stripe 密钥和 Webhook 密钥只能保存在本地未提交环境文件或目标托管平台的 secret。
- 生产运行长期不建议使用数据库 owner 账号；完成迁移后应创建最小权限应用角色并轮换已经共享过的凭据。

## 回滚边界

切换前的 D1 快照仍可作为数据级回退来源，但 Neon 上线后的新写入不会自动同步回 D1。若需要回滚，必须先停止写入、导出 Neon 增量并制定合并方案，不能直接把运行时切回旧 D1，否则会丢失切换后的数据。
