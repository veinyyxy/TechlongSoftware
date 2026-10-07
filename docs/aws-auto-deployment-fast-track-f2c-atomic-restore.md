# F2c 第三批：原子 baseline restore

2026-10-07：真实 SQL restore capability 已完成。准确候选在新建本地 PG16.14 TLS/SCRAM、非 superuser `cell_admin` 上通过原子恢复、回滚、连接丢失和提交响应丢失验证；真实 `prepare → restore → migrate → verify` SQL 链路跑通。它不是已上线的 AWS 自动部署链路，应用账户仍 NOLOGIN。

## 恢复实现

服务端新增 `tenant_baseline_program.js`、`tenant_baseline_catalog.js` 和 `tenant_baseline_restore_provider.js`；保留既有 production CLI/factory 的 inspect/cleanup-only destroy 门禁。没有新增 AWS/Neon 调用或 Secret 获取能力。

编译器先复制、核对准确 archive/manifest bytes，使用 PG16.14 `pg_restore --list` 和离线 schema-only SQL 输出，复用现有 Python TOC/profile/零行校验器。在启动、连接目标实例前完成编译；不读取 `.env`，子进程环境去除 PG/AWS/Secret 凭据。只接收有界 custom archive 和明确 hash；占用工作目录不覆盖、不复位。编译结果为进程内冻结且带私有品牌的对象，不接收调用方伪造 SQL、JSON 反序列化对象或自报指纹。

SQL compiler 只移除 renderer 的准确一对外层 `\restrict/\unrestrict`，拒绝额外 client command、不匹配 envelope 和变化的 prologue。词法处理区分注释、引号和 dollar body；顶层只允许所需 schema DDL，不接收 BEGIN/COMMIT、数据写入、角色/数据库管理或任意 SET。renderer 的三个 timeout=0 不执行，其余固定设置使用 LOCAL，search_path 用 transaction-local set_config；borrowed session 原 settings 在结束后恢复。SQL 仍须来源可信、完整 archive SHA 受批，这不是通用 SQL 沙箱。参见 [pg_restore 的离线输出及不可信 dump 警告](https://www.postgresql.org/docs/16/app-pgrestore.html)。

Restore 在与 cleanup 相同的 management advisory lock 下核对准确 prepare journal、数据库/角色 OID、NOLOGIN/ownership/ACL、完整 epoch/operation hash 和 empty 前驱；目标 backend 的实际 datid 也必须等于 journal OID。目标必须真正没有用户表/类型/函数/非默认扩展等，不能用 --clean 覆盖外来对象。

目标事务中执行全部恢复 SQL、73 表零行/profile 校验、固定逻辑结构指纹核对，最后原子更新 database 和 role 的 baseline_restored marker。管理 session 丢失会关闭目标连接，失败路径 rollback；成功后另读 OID 和 committed marker。提交响应丢失时重新连接读回：只有准确 baseline marker、实际零行/profile/catalog 一致才返回 already_applied，重放验证使用 READ ONLY 事务。漂移不自动 repair 或 down migration。

固定 catalog pin 覆盖本候选的列/类型/default、constraints/indexes、静态 sequence 配置、内部与外部 trigger 属性、函数定义/ACL、schema/table ACL、extensions、policies/rules 等逻辑结构。它排除业务行、统计、物理 OID 和自动生成的内部 trigger 名；uuid-ossp extension script owner 名规范化，避免把本地 bootstrap 用户名当作 RDS 用户名。数据库/角色 ownership OID 另由 journal 严格核对。支持的 archive/manifest 对固定在代码中，新候选必须重新审阅 pin；不是目标运行时自动学习。该本地 pin 仍需真实 Aurora 引擎/extension/locale 验收，不能自动容忍差异。

## 固定输入和证据

| 项目 | SHA256 |
| --- | --- |
| archive | `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a` |
| manifest | `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` |
| 原子 restore SQL | `db6508986edd25344fcd8fc5763ccc33e2eea01b4659fb4771660f998640bbda` |
| 验证 SQL | `c676d7d47fe45f50c6c1ccecb0eefdae4b3eb9397ffdf62d8ef89b7a55043303` |
| 结构 catalog pin | `d27dc20410e0cceac97a49bfd72a0bcc7fa197b25d512d2b941df0a70ae1d55b` |

最终目录 `F:/ChatGPT_workshop/techlong-pg16-baseline-restore-20261007-f2c4`，收据 `restore-receipt.json`，SHA `de92cb59884ced7853696c404abb5f75bd37d8ff574407ada5e25b88208bed4f`，结果 `BASELINE_RESTORE_REAL_PG16_VERIFIED`。

实测包括：非空目标拒绝；DDL 完成后、写 marker 前失败的整体 rollback；实际插入一条非受批 singleton 后零行验证拒绝并 rollback；实际终止管理 backend 且观察到 end 后目标事务 rollback；正常 applied 与只读重放；原 session timeout/search_path 等 settings 恢复；旧 epoch 拒绝；独立只读 psql 验 73 表零行/profile，另起只读 Node session 验完整 catalog pin；SQL 四阶段链路产生 1 条 singleton、8 条 entitlement，其余业务表零行；另一数据库 COMMIT 成功但响应丢失，重连证明 already_applied；额外列即使零行仍拒绝重放，不自动 DROP COLUMN 修复。

四个本轮 cluster 均由独立 pg_ctl status 证明已停止，目录全部保留。f2c1 只在 rollback 事务内校准 catalog，未永久安装 baseline；f2c2 首次完整验证成功；f2c3 加入管理连接丢失；f2c4 额外断言注入行确实写入、terminate 提交返回 true 且 end 确实发生，完整复验通过。没有修改原 PG15、原候选、系统 PostgreSQL 安装或系统信任库。

62 项相邻 Node baseline/prepare/SaaS/lifecycle 回归、28 项 Python TOC/profile/manifest 校验、backend typecheck 通过。私有 archive、SQL、manifest、证书/key、cluster、日志和原始收据不提交 Git；仅提交代码、定向测试和脱敏证据说明。本地 fixture task 中的 baseline digest 仅用于本地实施验收，不构成生产 baseline 批准或云对象存在证明。

## 下一步

集中完成生产组合与闭环：prepare partial-state recovery 适配；完成 prepare 后的正常 destroy/journal 与下一代释放；迁移后的应用权限、LOGIN 和真实登录回读；固定 RDS endpoint/CA/Secret/session factory、CLI/receipt 与镜像接线。旧 cleanup registry 未迁移，现有 service 的 partial-state 拒绝边界也未被放宽。

然后进入 F3：实际 Aurora/镜像/权限/authority/ACM/DNS/mTLS 一次集中 readback，并提供明确资源、费用与执行清单。生产 baseline 批准/上传、IAM 安装、付费 Cell 执行和实际不可恢复删除仍按 fresh SHA 单独批准；预算目标 50 USD/月，不自动使用过期 Grant。当前 `baselineApproved=false`、`runtimeEnabled=false`、`sourceMutationPerformed=false`、`cloudMutationPerformed=false`。
