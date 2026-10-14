# D002 C4b：激活前准确隔离核对（待 SQL 只读批准）

2026-10-14 America/Winnipeg。[C4a 候选](./aws-auto-deployment-aurora-dual-mode-c4a-application-candidate.md)之后直接推进真实激活输入。本轮只新增一次有界的管理目录核对，不恢复 schema、不扩展F3c9或Grant generation支线。尚未执行数据库核对，更没有启用应用登录或部署。

## 已完成的 AWS 只读事实

Source SDK身份核对1次通过；C4b Review-r1共19次SDK/CLI元数据调用完成，SQL连接/查询、云写、Secret值读取及新槽消费均0。Source仍为准确IAM user，Express集群/唯一writer的物理ID、创建时间、17.9、endpoint、标签与C3g前置binding一致，IAM auth/IAG启用、Min0/Max1/pause300保持，账户FREE/ACTIVE，准确postgres connect simulation allowed且无missing context。模拟不是实际数据库连接或任务角色权限证明。

三个实际既有角色均匹配准确ARN/RoleId：

| 使用方 | 角色 / RoleId | 当前元数据 |
| --- | --- | --- |
| 应用 | TechlongSandboxTaskRole / AROAV3GNMXTZLH2AU5I5G | inline0、attached0 |
| lifecycle | TechlongSandboxTenantLifecycleTaskRole / AROAV3GNMXTZDIWVT3BKN | ImmutableReceiptsAndGenerationSecretRead、attached0 |
| ECS execution | TechlongSandboxTaskExecutionRole / AROAV3GNMXTZJHJWAN4IR | PullSandboxImageAndRuntimeSecrets、attached0 |

三者均使用现有TechlongSandboxServiceRoleBoundary，PolicyId ANPAV3GNMXTZHXSTCQBZC、默认v3、digest `f2d2533515558b1afbca3e275f530c9a6cbf4421fac68581a496cc4939abb89f`；两个inline digest与前置历史相同。原始trust/policy仅保存在本地私有iam-metadata.json，公开续接摘要仅保存准确标识及hash；没有新增/替换policy或role，metadata不等于effective permission验收。

固定Secret名称 `techlong/sandbox/tenant/a0da1748bc4d5419/runtime/g1` 的DescribeSecret返回不存在，ARN/version仍null。没有GetSecretValue、私密材料读取/生成、CreateSecret或五键Secret；未来创建前仍需fresh核对，当前不存在不构成名称预留或跨服务CAS。

## 新的待审范围

清单SHA：`4de95e9036fd7b87e57b2f67689f26bcc1561d43ed5327dc408ce18fe7af3121`。

准备：2026-10-14 20:53:27.942 UTC / Winnipeg15:53:27.942 CDT。到期：2026-10-15 02:53:27.942 UTC / Winnipeg **2026-10-14 21:53:27.942 CDT**。过期时在连接/槽消费前拒绝，不能把本页或C4a候选SHA当批准；只读刷新Review不重放SQL或消费旧槽。

仅使用Source临时凭据经ATS信任根/hostname验证的TLS，连接准确Express endpoint的postgres管理库一次；没有租户库连接、app身份登录、恢复/migration或业务表查询。登录前重新核对准确Source、物理binding、账户plan及管理connect simulation，检查临时凭据快照至少剩120秒，并用快照再次STS核验。

固定6次query依次为：

1. BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY。
2. SET LOCAL search_path = pg_catalog（只影响本事务）。
3. 查当前库/角色OID、current/session user、17.9版本、transaction read-only/isolation和backend TLS。
4. 查准确app角色16456的NOLOGIN/NOINHERIT/权限标志、成员、所有权及其它可CONNECT库计数；角色config只返回null或REDACTED，不返回配置内容，绝不读取密码/verifier。
5. 查该准确集群中可连接数据库及准确租户库的OID、owner、CONNECT/PUBLIC CONNECT/ACL元数据，最多32行、结果64KiB；只查系统目录，不查询任何客户表。
6. COMMIT只读事务。失败允许原连接一次ROLLBACK，总query最多7；不重连或重试。

准确tenant DB16459/owner16410、role16456和postgres DB5保持。已有Backend V6 closed classifier检查应用角色仍NOLOGIN且没有elevation/配置/所有权/成员；读取数量与逐库CONNECT结果必须一致。结果仅为ISOLATION_ACTION_REQUIRES_REVIEW或ISOLATION_OBSERVED_NOT_ACTIVATED，永不授权修复或把结果转成旧ready/authority。

新独立固定本地槽：`F:/ChatGPT_workshop/techlong-d002-express-c4b-isolation-read-v1.permanent-slot.json`。新槽在批准/fresh preflight/TLS工具准备通过后、连接前永久消费；不复用/重置C3g、C3f、V4/V5或任何旧槽。该槽尚未消费。没有AWS槽/资源创建。

## 完整风险与执行边界

- 一次管理SQL连接可唤醒Aurora并产生ACU/I/O费用；50 USD/月是目标，不是硬费用上限或绝对零费用保证，保留资源可能持续收费。
- Source是已有高权限管理员，并非新最小权限边界。IAM token仅留内存；JS/driver擦除是尽力而为，服务端/提供者日志可能记录连接及目录查询元数据。
- 只读事务与AWS回读不是跨服务CAS；并发高权限修改可以使结果过时，当前IAM metadata/simulation不证明真实任务权限或应用IAM登录。
- native DNS/地址选择可能尝试多个解析地址，但不允许第二个逻辑SQL会话；30秒连接/90秒会话、statement/query timeout均有限制，不能保证提供者日志或计费粒度。
- 新槽消费后即使超时、响应丢失、本地保存失败或读结果拒绝，也不自动重试、复位、补齐、清理；可能保留不完整本地证据，需要先核对再另行决定。
- 不执行LOGIN/GRANT/REVOKE/SET ROLE、DDL、业务/authority写，不读Secret值，不新增IAM/ECR/ECS/Cell或改变其他库PUBLIC CONNECT。若有跨库缺口，报告准确库和PUBLIC来源影响，下一具体处置另批。

## 实现与验证

新增平台纯模块express-activation-inventory-c4b.cjs、严格CLI review-express-activation-c4b.mjs、5项针对性测试；测试/syntax/定向ESLint均通过，没有重跑离线历史大套件。脚本Review仅AWS metadata，Inspect要求fresh SHA；AWS API whitelist无任何write或GetSecretValue，SQL whitelist绑定准确语句和参数；旧240源码/2工具/7项历史文件先核对，再增加3项当前源码共243 pins。没有native archive编译或Backend执行源码改动，C4a已验Backend153efbc/云两镜像保持。

初次启动仅Windows路径正反斜杠比较在参数阶段拒绝，AWS/SQL/槽均0且未创建输出；已规范化路径后完成唯一Review-r1。真实CLI错误批准SHA测试返回C4B_FRESH_READ_APPROVAL_REQUIRED，stopped记录metadata/SQL/槽均0，证明在凭据/AWS/SQL/slot之前拒绝；该拒绝记录保留，不作为执行尝试。

本地manifest：`F:/ChatGPT_workshop/techlong-d002-express-c4b-review-20261014-r1/manifest.json`。code binding `bb553f2dc37df3633409bb83af442f782308a353e699e2d0945e6637608ccce1`，SQL plan `2c3ad97b4323bb5cdd953012876abe2ad755b3ed347f67baffcaf972c2bcb406`。[紧凑继续位置与文件字节SHA](../ops/aws-sandbox/reviews/aurora-express-c4b-isolation.prepared.json)。代码和非秘密证据按既有授权直接提交/推送两个main；SQL核对仍待本份具体批准，不自动执行。

## 唯一继续位置

用户明确确认本SHA与上述只读范围/风险后，才执行一次Inspect并保存实际隔离结果；如Source不可用或窗口过期，在连接和槽消费前停止并先刷新只读材料。随后根据真实目录事实集中准备必要的隔离处置、准确app/lifecycle IAM connect、四键Secret与execution-role读权限及真正runtime-ready/初始化接线，再fresh批准实际写与ECR→ECS部署。发现共享PUBLIC CONNECT时不能静默全局REVOKE；无需另建通用授权或恢复探针支线。

SQL语义依据：[PG17权限查询函数](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)支持指定角色/数据库的CONNECT核对及PUBLIC pseudo-role；[pg_database目录](https://www.postgresql.org/docs/17/catalog-pg-database.html)提供库级OID、owner、连接开关与ACL。本轮只是依据这些接口实现固定查询，尚无SQL实机结果。
