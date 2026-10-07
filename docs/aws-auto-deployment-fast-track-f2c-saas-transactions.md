# F2c 第一批：真实 SaaS 迁移/verify 事务 provider

2026-10-07，America/Winnipeg。沿用交付优先、50 USD/月目标及原云执行批准边界。本批次完成事务内 `migrate_saas / verify` SQL provider；**不是完整 F2c，也没有开放生产 CLI/Worker**。

## 实现

服务端新增 `PostgresTenantSaasTransactionProvider`。它接受已连接的 management/tenant 管理会话，独立验证真实 PG16.14、TLS、数据库/用户名、实际地址/端口一致；未来 RDS composition 仍须绑定准确 RDS endpoint 和 image CA，不把本地 TLS 当成 RDS 在线验收。

在既有 cleanup 同一 management database、同一 stable identity/generation advisory lock 下，核对 database/role 的完整 canonical ownership marker、准确 epoch/operation hash/baseline digest 和前驱 observation。只接受已准备/已恢复的完整资源，不创建、接管或删除缺失/部分资源，不自动采用更高 epoch。目标事务还持有 tenant xact advisory lock；管理连接丢失或取消会中止目标工作。

两项 image-bundled SQL 以 LF 规范化后固定 SHA，不导入读取 `.env` 的开发迁移入口：

- `saas_control.sql`：`4da7a9d7974efa0cbab6196bc21a7618c052c11bec8cdd4390e2e24f0d22c8bf`
- `theme_config.sql`：`eec8838c01101f009b18f838525a64e100e59300c460a52006cb96568c809c14`

迁移、初始化行验收和 database/role 两个阶段 marker 在同一目标事务提交。提交前复查 management fence/存活，提交后独立 management 会话回读；已提交但回执丢失的准确同 epoch 操作可以识别 `already_applied`，不重复初始化。原 `tenant_lifecycle_production.js` 的 CLI/factory 仍仅 inspect/cleanup-only destroy；新增模块不暴露启用开关或 Secret 获取入口。

## 初始化行的准确口径

真实 SQL 内容和实测纠正了此前“两项主题 seed”的简化描述：空 baseline 没有 store，因此本次迁移产生 `saas_instances=1`、`saas_entitlements=8`、`system_config=0`，其余所有业务表为 0 行。8 项 entitlement 的 key/value/type/source/updated_by 逐项匹配固定迁移，singleton 尚无外部实例/配置 epoch。

主题 SQL 实际是两**类**主题（buyer、merchant）× 每个 store × dev/test/staging/prod 四环境，即每 store 最多 8 行；不是无条件插入两行。后续配置下发/门店初始化是独立步骤，不能提前把当前空 Stores 填成源业务数据。

## 真实 PG16 TLS 验证

工具：服务端 `scripts/verify-tenant-saas-transactions-pg16.js`。全新本地 cluster、SCRAM 随机密码、本地短期自签测试 CA、TLS verify-full；没有改系统信任库或源 PG15。fixture 的 `cell_admin` 为非 superuser，拥有 CREATEDB/CREATEROLE，仅新建自己的 management/tenant DB。fixture 的 restore/role setup 不是新 prepare/restore provider 的实现证明。

成功目录：`F:/ChatGPT_workshop/techlong-pg16-saas-transactions-20261007-f2c4`。

收据 SHA：`47628692f09207e3596b221d4318991796ca73be322832543aa46a440b6957e9`，结果 `SAAS_TRANSACTION_REAL_PG16_VERIFIED`。完成时间 `2026-10-07T12:40:57.015Z`。

实际覆盖迁移/verify、程序写入后 marker 提交前故障的回滚、同任务迁移重放、真实 COMMIT 后注入响应丢失并准确恢复、终止本次指定 management backend 后目标事务中止/已提交状态不变、旧 epoch 拒绝。最后另起只读 psql 进程回读 73 张表的初始化/业务行数；临时实例已停止。

前两个本地 fixture 接线错误在 provider 写入前拦截并保留记录，`f2c3` 首次真实事务成功后又验证了连接丢失路径，最终使用 `f2c4` 收据。另起进程复算原 archive/manifest 不变，四个目录均无 postmaster.pid。私有证书/key、archive、cluster、SQL 和收据不提交 Git。

41 项 Node 必要相邻回归、28 项既有 Python baseline/legacy/profile 测试、typecheck、语法与 diff check 通过；不运行旧 IAM 模拟，不连接 AWS/Neon。

## 尚未完成 / 下一步

- 真实 `prepare_empty_database` 的非事务创建、ownership/崩溃恢复和失败清理；`CREATE DATABASE` 不能与后续 COMMENT 放在同一事务，不能忽略未标记创建间隙或盲目接管。
- 真实 `restore_approved_baseline` 的受批 immutable artifact 下载/校验及原子 restore/marker。
- RDS Secret/session composition、跨 epoch adoption、生产 CLI/receipt 接线、镜像构建/readback、实际运行账户权限/登录验收。
- 再进入 fresh baseline/云发布清单和 F3。当前 `baselineApproved=false`、`runtimeEnabled=false`；SQL-stage verified 不是可对外访问的租户 ready，未执行任何 IAM/S3/ECS/Neon 写入。

参考：[CREATE DATABASE 非事务限制](https://www.postgresql.org/docs/16/sql-createdatabase.html)。
