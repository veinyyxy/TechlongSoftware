# F2c 第二批：真实 prepare 与失败补偿

2026-10-07：已实现并在全新本地 PostgreSQL 16.14 TLS/SCRAM、非 superuser `cell_admin` 上验证 SQL capability。它不是已启用的 AWS production provider；本轮没有源 PG15、AWS 或 Neon 写入，没有付费资源、baseline 批准或 Worker 启用。

## 实现与恢复规则

服务端新增 `services/saas/tenant_prepare_provider.js` 和 additive `db/tenant_prepare_journal.sql`。后者仅安装在本轮新建的隔离实例，不隐式改变旧 cleanup registry。完整 catalog（列、约束、索引、ACL、trigger/function 定义）指纹固定为 `437c901ffaa790c57318f7de874567ae80993becd6dc0430b0911b734860c7da`；结构漂移时在创建或删除之前拒绝。

状态为 `reserved → create_submitted → catalog_bound → prepared`；失败的未完成 prepare 可进入 `compensating → compensated`。记录不能删除、截断、改变 identity/已绑定 OID 或复位终态。所有步骤使用与 cleanup 相同的 management advisory lock 键；调用方必须使用可信独占管理会话，并在最终 RDS 接线时绑定真实 endpoint/CA/session 生命周期。这不防御拥有数据库管理权限且绕过该锁的恶意并发修改。

1. 原同名 database 或 app role 已存在时拒绝，不接管、不删除。一次事务创建 app NOLOGIN role、随机专属 NOLOGIN guard role、ownership comments 与永久 reservation，保存两项准确 role OID。
2. 先提交 CREATE 意图，再以 guard 为 owner、`TEMPLATE template0`、UTF8、禁止连接创建数据库。CREATE 已提交但响应丢失时，只接受由本 reservation 的准确 guard OID 拥有、仍禁止连接且未标记的隔离数据库，再持久化其准确 OID；不是按名称盲目收养。
3. 验证准确 OID、comments、role flags 和有效成员关系后，一次事务将 owner 交给 cell_admin、撤销 PUBLIC database 权限、写入两项 empty marker、设置数据库密码、允许管理连接并删除 guard，journal 进入 prepared。提交后再次实读这些属性。App role 此时仍 NOLOGIN，没有宣布 runtime ready，也没有证明应用账户登录成功。
4. 未完成 prepare 的补偿只删除准确、仍禁止连接的 owned database 和准确 owned role；无 FORCE、DROP OWNED 或 wildcard。数据库删除响应丢失后，按永久 compensating 记录回读并完成角色清理。清理后重放只证明 absent；名字被重新创建时拒绝再次删除，原固定槽位不复位。

数据库模块只接收 `{database_url}`。完整五键 Secret 仍在已有 callback 内校验，HMAC/JWT/支付值不跨 SQL capability 边界。密码不进入 argv、journal、收据或控制台；fixture 关闭 SQL/错误语句日志。未来生产连接和 PostgreSQL 日志策略仍须单独审阅。

PG16 非 superuser 自动获得创建角色的 ADMIN-only 成员资格，但并不自动继承其权限。本实现仅为专属 guard 增加管理账户的 SET/INHERIT 权限，并验证所有 grantee 均为该管理账户，guard 不具有 LOGIN/CREATEDB/CREATEROLE 等能力；成功后删除 guard 和成员关系。参见 [PG16 role attributes](https://www.postgresql.org/docs/16/role-attributes.html)。CREATE DATABASE 不能包含在事务块内，因此使用持久化 quarantine/OID 恢复而不是声称全流程一个事务；参见 [CREATE DATABASE](https://www.postgresql.org/docs/16/sql-createdatabase.html)、[ALTER DATABASE](https://www.postgresql.org/docs/16/sql-alterdatabase.html)。

## 真实验收证据

最终目录：`F:/ChatGPT_workshop/techlong-pg16-prepare-20261007-f2c10`。

- 收据：`prepare-receipt.json`
- SHA256：`97a880aafa6f74676c670d46d17dde7a53b40b9a027afa4fb10c7875a91ed8d2`
- 结果：`PREPARE_REAL_PG16_VERIFIED`
- `managementSuperuser=false`、`actualTlsVerified=true`、`isolatedServerStopped=true`
- `sourceMutationPerformed=false`、`cloudMutationPerformed=false`、`baselineApproved=false`、`runtimeEnabled=false`

实际验证：新建与 prepared 重放；reservation COMMIT、CREATE DATABASE、最终 promotion COMMIT 响应丢失后重新连接恢复；promotion 中途失败事务回滚；DROP DATABASE 响应丢失后的补偿恢复及重放；旧 epoch 拒绝；外来 database 名称拒绝且未写 journal；同名 app role 以不同 OID 重建后拒绝删除；database ACL 新增外来 grantee 时拒绝 prepared 重放，撤回该测试授权后准确重放通过；ACL 与 trigger 两层阻止 journal DELETE/TRUNCATE，终态禁止复位；完整 catalog 漂移拒绝创建。独立只读 psql 进程核验四项 prepared、一项 compensated、清理资源 absent、运行角色 NOLOGIN；另一个目标连接实读 prepared database 没有业务表。

十个本轮新实例均由独立 pg_ctl status 证明停止，所有目录保留，不覆盖失败证据。早期真实测试揭示 guard 缺少继承 ownership 权限，以及 bootstrap ADMIN grantor 与显式 grantor 不同；已依据实际 PG16 行为和官方说明修正有效成员验证。一次测试错误地期望 DELETE 首先触发 guard，实际上闭合 ACL 已先拒绝；现在分别验 ACL 和 trigger，并在继续使用 provider 前恢复、核对准确 ACL。f2c6 是首次完整成功，f2c7 验数据库-only Secret API；f2c8 的 DROP DATABASE 遇到 15 秒本地超时并已停止，f2c9 仅用隔离 fixture 的 45 秒 statement/50 秒 query 等待时限完成复验，f2c10 最后验证外来 database ACL 拒绝并完整复验通过。生产连接/任务时限未改变。

45 项 Node prepare/lifecycle/production/SaaS 相邻回归与 backend typecheck 通过，包括 DDL literal 的引号/反斜杠转义；metadata 在 SQL 内限制返回大小，DDL literal 使用显式 escape string，不依赖 session 的 standard_conforming_strings 设置。平台只读本地 runtime 诊断仍返回 disabled、50 USD/月目标，未访问数据库或云。新工具、DDL、代码和文档入 Git；cluster、私有证书/key、密码、SQL 回读文件和原始收据不提交。

## 继续位置

下一小阶段实现 `restore_approved_baseline`：绑定受审 immutable archive/manifest SHA，离线严格编译 profile；准确 empty ownership/OID 前驱下，在目标事务里原子恢复、验证零业务行并更新 baseline marker，验证 rollback/提交响应丢失恢复。原 73 表候选仍未获得生产恢复批准。

其后必须完成 prepare recovery 与 service 的 partial-state 门禁适配、已完成 prepare 的正常 destroy/journal 终态与新 generation 释放、实际 RDS endpoint/CA/Secret/session 工厂、CLI/receipt 和镜像接线。当前 service 仍在 partial observation 时拒绝，不能把这个模块直接插入旧 factory 便宣称恢复链已接通。完成 prepare 的 normal cleanup 与本 journal 的协同尚未验证，原 cleanup registry 没有被静默迁移。

原 production CLI/factory 仍仅 inspect/cleanup-only destroy，平台 runtime/apply/cleanup readiness 均保持 false。Aurora/应用账户登录/ECS/Worker/对外地址验收仍待后续 fresh SHA 云清单，不能用本地证明替代。
