# W7l：单一平台 Web NOLOGIN 角色与最小授权

本阶段只为首轮两小时平台 HTTPS 验收准备数据库身份。准备代码、GitHub 临时 PostgreSQL CI 和清单不授权生产写入。实际安装必须另行确认准确原始清单 SHA。安装后仍 **NOLOGIN、未设置密码、未创建 Secret、未部署平台**；50 USD/月是费用目标而非硬性封顶，两小时窗口尚未启动。

## 固定变更

目标角色只有 `techlong_platform_web_acceptance_v1`。当前配置为 NOLOGIN / NOINHERIT / NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS，连接上限 5。准确 SQL 保存在 [no-login.sql](../ops/platform-web-database-role-v1/no-login.sql)，由程序逐条发送，不接受自由 SQL、替代角色或替代目标参数。

七条持久语句限于：

1. 创建上述禁用登录角色，不发送 PASSWORD。
2. 设置该角色默认 `search_path=pg_catalog, public, pg_temp`（临时 schema 放最后）。
3. 对 public schema 授予 USAGE，不授予 CREATE。
4. 对既有 13 张业务/平台表授予 SELECT。
5. 对 user_credentials 的 user_id、password_hash、password_salt、password_iterations、failed_attempts、locked_until 六列授予 SELECT。
6. 对同表 failed_attempts、locked_until、updated_at 三列授予 UPDATE。
7. 对 auth_sessions 授予 SELECT、INSERT、DELETE。

不授予其他业务写、密码修改、DDL、所有权、控制面 schema 或角色父级成员关系；不改默认 ACL。认证与只读实例页面需要的能力不等于完整平台管理员能力，也不承诺部署控制按钮现已启用。

## 准确执行与验收

准备绑定 W7k 2026-10-22T19:29Z 已批准实际目录原件及其 SHA，目标 host/actor/database 只保留本地 F 原件，项目索引只公开指纹。执行前校验干净 main、已通过 CI 的源码、固定文件/风险/SQL/查询哈希、原目录证据和当前本地目标一致；旧只读审批不授权本次安装。原只读槽保持占用。

新批准最长 48 小时，最晚启动为到期前五分钟；每条持久语句及 COMMIT 前再次检查到期。一个新永久槽 `F:/ChatGPT_workshop/techlong-platform-web-db-nologin-v1.intent.json` 用排他创建和 fsync 在连接前消费；不得删除、复位、重放或自动换槽。新执行材料只追加保存在 nonce 目录。

安装仅一次 TLS verify-full 连接、一个 REPEATABLE READ READ WRITE 事务，四条 SET LOCAL（安全 search_path、15 秒 statement_timeout、3 秒 lock_timeout、空 createrole_self_grant）、一次对 15 张表的 ACCESS SHARE 锁、七条元数据 SELECT。完整目录必须与已审原件一致、角色仍缺失、对象 OID/owner/列/ACL/触发器/相关成员关系无漂移。首次 CREATE 前要求预检完成时间不足 30 秒。锁阻塞冲突 DDL 而非普通 DML，不是跨服务或角色/ACL 的 CAS。

七写仅各发送一次。事务内再作七条目录及一条有效权限查询，检查唯一允许差异、NOLOGIN、上限、search_path、准确授权、无额外权限/所有权变更。先持久记录新 Role OID 与提交意图，再提交一次并保存 ACK。安装失败尝试事务 ROLLBACK，不自动发补齐、DROP、REVOKE、down 或再次安装。

成功或失败后都独立尝试第二个连接：一个只读事务、三条 SET LOCAL、七条目录读取；角色存在时另作一条有效权限查询，必须与本轮已记录 Role OID 一致。候选缺失则核验原目录恢复。两连接合计最多 23 条目录 SELECT、七条持久 SQL、一次表锁、七条 SET LOCAL；无业务行/哈希值/函数正文/pg_authid 读取。独立回读不是第二次安装。若写连接、回读、日志保存或结果不明，状态为需要人工核对，不能宣告安装完成或自动重试。

## 必须接受的风险与非承诺

- **PUBLIC 临时表权限保留。** 现有数据库 PUBLIC CONNECT/TEMPORARY、public schema PUBLIC USAGE 不变。单个角色的 REVOKE 不能否定 PUBLIC；有效权限会明确核验 TEMPORARY 为 true。不得宣称完全禁止 DDL、数据库/租户隔离或零权限。通常内建/PUBLIC 函数权利仍存在；目录差异和有效表/列/schema 核验不是完整消除提权路径的证明。
- **授权不是行过滤。** 13 张表 SELECT 覆盖全部行和未来新增列；认证列包含哈希/盐，可用于离线攻击；auth_sessions INSERT 在未来激活后可用于冒充任意用户。这些是受限 Web 身份的固有敏感能力，非一般只读账号。此次不实际读取业务数据或启用登录。
- **创建者自动 ADMIN。** PostgreSQL 非超级用户 CREATEROLE 创建角色会产生创建者 ADMIN 成员关系。事务显式设空 createrole_self_grant，要求自动关系 INHERIT=false、SET=false，不自动撤销该 ADMIN。既有创建者本就拥有数据库并有高权限；它未来仍能改动角色，NOLOGIN 不是不可变安全围栏。不读取密码目录；只能证明此流程未设置密码及实时 NOLOGIN，不声称独立读取证明不存在密码。
- 角色名称属整个集群，当前对象授权只针对绑定数据库；其他数据库的 PUBLIC/现有权利没有穷尽验证。现有高权限本地凭据只经 TLS 发送到准确 Neon 目标，不交给 Web、不上传 CI。Neon 服务端/提供者日志可能保存 SQL/标识；TLS 不消除此风险。
- PostgreSQL 事务通常原子化上述角色/ACL 变更，但网络 COMMIT ACK 丢失、进程终止、日志保存失败、并发与提供者侧角色同步可能导致结果不明或外部状态不同步。独立回读也受快照、并发和连接失败限制。没有跨服务原子性、自动回滚到旧版本或幂等重试承诺；异常残留按新事实另审，不自动修复。
- 短暂表锁/目录锁可能等待或影响其他事务；角色/ACL 并发变化无法用 ACCESS SHARE 完全锁定。严格漂移检查可能合法停止，已消费槽不复位。
- Neon 免费计划不保证绝对零费用、配额不耗用或未来价格不变。CI 使用 GitHub 额度；此次不创建 AWS 资源，不读/写 AWS Secret，不改 IAM、不连接 Aurora、不迁移业务数据、不启用 worker、不部署/删除任何 Cell/ECS。

## 验证界限与下一步

CI 只在固定、临时 PostgreSQL 18.6 服务中，以非超级用户 CREATEROLE 身份证明真实七条 SQL、创建者成员选项、事务失败回滚、独立元数据回读，以及允许认证操作和九种禁止操作。CI 使用假数据，通过 CI 超级用户 SET ROLE 测权；不激活新角色 LOGIN，不使用生产凭据，不证明真实 Neon 安装、TLS 登录或实际管理员验收。PUBLIC TEMP 能力也在 CI 明确测试保留。

实际新 SHA 安装成功后，后续密码/固定 Secret 版本、AWS task 权限及两小时 HTTPS 部署仍分别准备、审批。不得以本清单批准扩展到这些阶段或重启 F3c9/旧租户支线。
