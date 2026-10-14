# D002 C4f：最小 SQL 激活与一次真实 IAM 登录待审

**已消费/仅历史（2026-10-14 Winnipeg）**：用户确认本最终SHA后，唯一Run八语句收到响应但写后核验停止，COMMIT未提交、ROLLBACK收到响应；立即独立Inspect确认原closed/NOLOGIN状态，未尝试应用登录。安装和核验槽永久消费，不得重放、复位或刷新成新尝试。下文0 SQL/槽不存在/待批准均为审阅时事实。[实际回滚证据与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-stopped.md)。

2026-10-14 America/Winnipeg。沿[C4e实际IAM结果](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-executed.md)继续首轮部署主线；本阶段将授权、独立回读和一次应用用户登录放在同一清单，不新增Grant/恢复探针支线。入口与定向检查已完成，**尚未执行SQL、启用LOGIN或消费新槽**。F3c9保持封存，旧`full_password`路径不改。

## 最终清单与准确范围

SHA：`0c32f6f0885938065735b1945586e082eff3e2272e50f02c321d93b7feb943cc`。

准备2026-10-14 18:48:42.474 CDT / 23:48:42.474 UTC；有效至 **Winnipeg 2026-10-15 00:48:42.474 CDT** / 05:48:42.474 UTC。本地清单：`F:/ChatGPT_workshop/techlong-d002-express-c4f-review-20261014-r2/manifest.json`。候选SHA、代码SHA或本文件不替代此执行批准。

目标仅账户402010193138、ca-central-1的现有Express集群`techlong-sandbox-express-d001`，resource ID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，准确端点`techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com:5432`。仅租户库`tenant_a0da1748bc4d5419_db`（OID16459），应用角色`tenant_a0da1748bc4d5419_role`（OID16456），现有postgres管理角色OID16410。

一次Run，使用Source身份签发内存IAM token，以postgres登录准确租户库，在同一事务中执行原C4a受信归档编译的八条语句：

1. 准确租户库CONNECT。
2. public schema USAGE。
3. 准确73表SELECT/INSERT/UPDATE/DELETE，无grant option。
4. 准确7序列USAGE，无SELECT/UPDATE或grant option。
5. 准确应用角色的rds_iam membership SET FALSE。
6. 同一membership INHERIT FALSE。
7. 同一membership ADMIN FALSE。
8. 准确应用角色LOGIN。

表/序列完整名单和准确SQL已绑定清单；不使用ALL TABLES/ALL SEQUENCES，不含DDL/default privileges/新函数授权、密码或其它库权限变更。数据库写权限是持久能力，并包括该租户技术/授权表，不是业务行过滤。现有PUBLIC函数权限保留，不把最小新增权限当成应用无危险行为的证明。

Run写前重新核对准确closed角色、四库完整ACL、原迁移目录及九技术seed/业务count0；写后在同事务核对exact active角色、唯一目标CONNECT增量、准确应用ACL投影后原目录digest不变及行数，再一次COMMIT。角色/库/OID/原owner/成员/非应用ACL、完整目录或行数不匹配时停止；不修改现有业务数据，不重新restore/migrate。

紧随唯一独立Inspect：先另一个postgres TLS只读连接核对准确active或原closed状态。原closed只报告安装未证明，不重放写；部分/外来状态停止。**只有完整active通过**才尝试一次应用用户TLS IAM登录：Source签发该username的token，用READ ONLY事务检查真实current/session user、库/角色OID、TLS两端、受限membership、表DML/序列USAGE的权限元数据及九seed/业务count0。没有测试DML写效果，不读业务行值、不设置密码/SET ROLE或回退密码。

AWS要求授予rds_iam以使用PostgreSQL IAM认证；官方例子未证明本目标在ADMIN/INHERIT/SET均false时的实际兼容性，必须由本次获批登录核实。[AWS账户规则](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)、[PG17 membership选项](https://www.postgresql.org/docs/17/sql-grant.html)。**Source不是ECS task role**：此登录只能证明该SQL用户/受限membership对Source token的认证兼容及只读查询成功，不能宣称任务角色有效SCP/session/KMS、完整ready、初始化或生产部署通过。

## 准备结果与执行限制

最终Review-r2实际25个AWS/CLI只读元数据调用：三role全部IAM快照、默认v4/保留v3/7个boundary使用者/普通附件0、真实T9CqN5 Secret固定版本、物理17.9/FREE ACTIVE均保持；Source对准确postgres及应用username的connect模拟allowed，模拟不等于实际登录。Review不连SQL，当前SQL角色/schema状态仅历史，不用“已核验”掩盖这个边界。r1及其错误SHA检查保留但不执行；仅在r1后补充失败回执的allowlisted SQLSTATE/固定步骤标签、COMMIT与abort事实（不复制提供者message/detail），程序SQL及权限范围digest未变。两次Review共50metadata，仍0SQL/写/值读取/槽消费。

原归档/两原工具重新编译通过，原private candidate品牌接受、相同JSON复制品拒绝；候选digest仍`bcd5e8ca...`。257当前源码pins+2工具，原254及C4e/C4c/C3g八项实际历史原字节保持。7新事务/批准/失败路径检查、11平台相邻检查及5服务端V6 ACL/角色检查均过（共23）；新编排测试使用明确隔离合成fixture，不冒充实机SQL。typecheck、syntax、定向lint通过。真实CLI错误SHA在LOCAL_BINDING拒绝，凭据/AWS/SQL/槽/原生编译均未进入；两个新槽不存在。[完整文件SHA及唯一继续点](../ops/aws-sandbox/reviews/aurora-express-c4f-application-activation.prepared.json)。

| 模式 | SQL连接 | 正常SQL query | 失败ROLLBACK上限 | 权限/LOGIN语句 |
| --- | --- | --- | --- | --- |
| Run | 管理1 | 21 | 1，仅COMMIT提交前 | 8 |
| Inspect管理 | 管理1 | 8 | 1，仅只读COMMIT提交前 | 0 |
| Inspect应用（仅active） | 应用最多1 | 6 | 1，仅只读COMMIT提交前 | 0 |

每模式AWS元数据上限32，Run/Inspect正常预计26；AWS/IAM/Secret写、Secret值/私密源读取、业务/authority写、AssumeRole、ECR/ECS/Cell均0。TLS使用固定ATS roots/主机名验证/min TLS1.2；单连接超时30秒、单session上限90秒/query上限15秒，初始凭据独立STS且剩余至少5分钟。SDK maxAttempts=1、不重连或重试。两个新槽为`techlong-d002-express-c4f-application-install-v1.permanent-slot.json`与`techlong-d002-express-c4f-application-inspect-v1.permanent-slot.json`（F:/ChatGPT_workshop）。

## 完整风险

- 八条权限/LOGIN变更同事务，但COMMIT后永久生效。现有/未来合格principal可使用73表DML，包括租户技术/授权数据；不是只读运行时或行过滤。现有PUBLIC函数权限保持，未做账户范围访问者盘点。
- NoInherit/SetFalse的认证兼容尚未实证；授权提交后登录失败可能留下已LOGIN/DML角色。不得自动放宽membership、改密码、撤权/down、补齐或应用重试。
- SQL快照、IAM/RDS元数据和COMMIT不是跨服务CAS，不能排除并发高权限改动。原角色、schema、ACL及业务count须在实际写前通过；只读Review历史不证明当前SQL状态。
- COMMIT丢失响应、本地journal/文件失败或独立核验失败可留下未知/已提交状态。提交前允许一次事务abort；提交意图之后不自动ROLLBACK或补偿，下一只能本范围独立Inspect，不重跑Run。
- Inspect先管理核验，再最多一次Source签发的应用账号IAM登录；不是ECS角色会话、KMS/Secret读取或完整ready验收。后继部署必须测试真正任务身份，不能复用这次结论发旧ready token。
- Source高权限管理员凭据/IAM token只留内存，擦除尽力而为；驱动/提供者日志可能留连接、token或查询元数据。凭据/刷新/认证可能失败且不出现MFA提示；不输出凭据/密码/token/私密值。
- 两永久槽在连接前消费，超时或失败不复位、删除、补齐或重试。最多三个SQL连接可能唤醒Aurora并计ACU/I/O费；50 USD/月不是硬cap，既有资源持续费用仍在。
- 不改Secret/IAM/Neon/旧Full/业务/authority，不初始化商户、不部署ECS/Cell、不启通用runtime；保留所有旧记录/槽和封存F3c9。任何后续实际范围需新具体批准。

## 唯一继续步骤

用户确认本SHA、上述8语句及独立核验/一次应用登录范围和完整风险后，才一次Run并立即独立Inspect。若凭据不可用且槽未消费，先只读核对并生成fresh清单，不自动重跑失败入口。成功后直接沿完整ready/首轮初始化接线与ECR→ECS推进；不插入同类权限探针或重启旧支线。Backend153efbc执行源码与已验镜像保持，本轮不需要Docker或重建镜像。
