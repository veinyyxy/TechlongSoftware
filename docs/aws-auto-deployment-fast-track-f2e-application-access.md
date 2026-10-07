# F2e：应用数据库授权、实际登录与安全退役

2026-10-07 完成。沿用 50 USD/月目标与最快交付主线；本批次只运行 fresh local PG16.14，不联系源 PG15、AWS 或 Neon，不启用 Worker/默认 CLI，不把数据库登录称为应用 HTTP 登录或租户 ready。

## 固定权限与真实登录

服务端新增 `tenant_application_access.js`，由 prepared composition 暴露单独的 `applicationAccess.activate(exactVerifyTask)`。不增加通用 SQL 命令、不自动改变 lifecycle marker、不靠环境变量开启。要求当前准确 completed prepare reservation、双 OID/ownership/provision fence、SQL verified marker、固定 baseline，以及完整 prepare-v2/cleanup catalog；新任务与已存在 cleanup claim 不兼容。

固定 policy 为 `speedfeast-application-access/v1`：数据库 CONNECT、public schema USAGE、准确 73 张表的 SELECT/INSERT/UPDATE/DELETE、准确 sequences 的 USAGE。无 CREATE/TEMPORARY/TRUNCATE/REFERENCES/TRIGGER、grant option、role membership、default privileges 或 ownership。函数保持已审阅 schema 中的 PUBLIC EXECUTE 定义与 ACL，不新增函数授权。SaaS 控制表也需要业务 DML，不能把数据库 role 授权误称为 API 管理员权限隔离。

迁移后完整逻辑结构/non-application ACL 固定 SHA 为 `a1df988bfa23beca2f8c241872d00913205f1b9348ce14ad800d4d634d835263`。仅在逐对象确认应用 ACL 精确匹配 policy 后，去掉这些准确应用 ACL 计算固定 pin；额外列/函数权限/column grants/default ACL/large objects/foreign server/replication objects 都不被放宽。此 pin 不由生产目标自学习，也不能由 caller 传入替代。

授权、LOGIN 与其目标库权限在一个 tenant transaction 原子提交；失败 rollback，提交响应丢失只能从同一 immutable fence 的完整 active ACL 回读恢复。active replay 是结构/权限只读复验，不重授权限、不重新迁移或检查业务表仍零行。随后必须用同一五键 Secret 中的 database URL 实际 TLS 登录，核对 server/database OID/role，逐表只读访问和 singleton 回读；最后再核对管理 fence。数据库模块与 application session source 仅接收 URL，不接收 HMAC/JWT/支付键。登录失败不撤销已经提交的原子 SQL 授权、不声称 ready；可对准确同一任务复验，或走受批 cleanup。

PUBLIC 权限会作用于新用户，单独 REVOKE 某个 role 并不能抵消 PUBLIC CONNECT。因此激活前只读核验该 role 对所有其他 connectable databases 都无 CONNECT；不满足则 `TENANT_APPLICATION_CELL_CONNECT_OPEN` 拒绝，没有自动跨库 revoke。fresh local fixture 显式关闭 postgres/template1/cell_admin 的 PUBLIC CONNECT；未来真实 Cell bootstrap/RDS 默认数据库硬化必须单独按 fresh SHA 审阅。参考 [PG16 GRANT 权限合并语义](https://www.postgresql.org/docs/16/sql-grant.html)。

## 退役与删除

prepared composition 使用独立编译的 `PostgresTenantApplicationCleanupProvider`；默认旧 `PostgresTenantNormalCleanupProvider` 仍只接受 NOLOGIN/owner-only，不能用 boolean 放宽。所有原始 prepare rows、旧 registry 和 v1/v2 pins 保留，不新增或自动安装生产 journal。

active cleanup 在共享 management lock 下先确认准确 predecessor/OID/完整 active schema ACL，关闭验证源自有会话，再永久记录 destroying claim。管理事务原子执行准确 role NOLOGIN、撤销其准确 database CONNECT、准确 database ALLOW_CONNECTIONS false；不关闭其他库、不删除 schema 权限、不强制终止会话。

随后检查准确 database OID 的所有现有会话。存在会话返回 `TENANT_APPLICATION_SESSIONS_ACTIVE`，不 DROP；调用方须先停止 workload/关闭 pool，重入同一 cleanup fence 后才继续 database-first/role/tombstone 删除。不能用 NOLOGIN 推断旧会话已断开，也不使用 FORCE、pg_terminate_backend、DROP OWNED 或 wildcard。原 claim 不复位，退役不自动重新开放连接。数据库缺失/提交响应丢失恢复和后继 generation 释放继续复用 F2d 准确 tombstone；旧 replay 只证明旧 OIDs absent。参考 [PG16 ALLOW_CONNECTIONS](https://www.postgresql.org/docs/16/sql-alterdatabase.html) 和 [DROP DATABASE](https://www.postgresql.org/docs/16/sql-dropdatabase.html)。

## 真实证据

最终目录：`F:/ChatGPT_workshop/techlong-pg16-application-access-20261007-f2e4`。

- 收据 `access-receipt.json` SHA：`f7d34f3f883cc70ec8321550add7801e1e37fcc8a5da93018e32ad55c11246aa`。
- outcome：`APPLICATION_ACCESS_RETIREMENT_REAL_PG16_VERIFIED`。
- 非 superuser cell_admin、TLS/SCRAM 真实验证：激活前 NOLOGIN；其他库 CONNECT 开放时拒绝；部分授权 rollback；COMMIT 已成功但响应丢失恢复；登录 source diagnostics 脱敏；实际应用 TLS 登录/只读重放；业务 UPDATE rollback；DDL/TRUNCATE/SET ROLE/CREATE DATABASE/TEMPORARY 与其他库连接拒绝。
- 额外 TRUNCATE grant 同时阻止 activation 和 cleanup，且 cleanup claim 尚未产生；移除本地测试漂移后，retirement 保留旧会话可查询，禁止重新激活，调用方关闭会话后准确删除；下一代资源创建、旧 cleanup replay 保留新 OIDs、独立只读 psql 终态回读通过。
- `isolatedServerStopped=true`、managementSuperuser/sourceMutationPerformed/cloudMutationPerformed/baselineApproved/runtimeEnabled 均 false。

另一个 fresh local 实例 `F:/ChatGPT_workshop/techlong-pg16-lifecycle-cleanup-20261007-f2e-regression` 完整复验 F2d 的部分 prepare、SQL 链、NoLOGIN cleanup、DROP/terminal COMMIT 响应丢失、新 generation 与旧 replay。cleanup receipt SHA `d01cb539016080c99d6380745b70be5f6ccac5ae93ff6a7c4446ee46fb143336`，原 record/journal pins 不变。

本批次 75 项 Node 定向回归、28 项 Python 严格 baseline 校验与 backend typecheck 通过。五个实例由独立 pg_ctl status 证明停止。f2e1 为固定结构校准；f2e2/3 的退役后 activation 前置检查失败保留，f2e4 为最终闭环，原路径回归独立保存。私有 catalog、archive、manifest、TLS keys、clusters 和完整 receipts 不入 Git。

第一代测试 database/role 被准确删除，原 OID 不可恢复；永久准备/清理记录和候选 archive 保留，第二代仍为停止实例中的证据。没有开发源库或云资源删除。

## 下一步：F2f

固定 RDS owned-session factory（endpoint/CA/timeout/Secret 生命周期）、应用登录 source、生产 CLI 的 SQL verify 与 activation 组合/幂等恢复、扩展任务 receipt、镜像打包/readback。SQL verified 与 databaseLoginVerified 保持不同证据；不能直接把旧生产 verify replay 接到已 active 的业务库，也不能重新要求运行后的业务表零行。

随后准备 F3 的真实 Cell bootstrap 硬化、authority/权限/模板/镜像/baseline fresh SHA 和费用清单；50 USD/月不是付费资源执行批准。F2e 未批准/上传 production baseline、升级实际管理库、创建 paid Cell、运行 ECS/Worker 或复用任何过期 Grant。
