# D002 C3c：准确两角色只读诊断清单已就绪，待具体SHA批准

2026-10-14 America/Winnipeg。承接[C3b实际执行停止](./aws-auto-deployment-aurora-dual-mode-c3-executed.md)：原reserve已提交两NOLOGIN角色，但没有租户库，安装/独立Inspect两槽均永久消费。本小步只准备定位原角色校验的拒绝条件，**不重跑安装、不修改/删除/接管角色，不创建数据库或扩展F3c9**。

## 当前待审SHA与新只读证据

用户重新login后，Review r3和独立InspectMetadata r1均通过；Source/准确cluster-writer/PG17.9/FREE-ACTIVE与历史一致，两轮各5次直接metadata，SQL连接/云写/诊断槽消费均0。元数据回读结论 `PHYSICAL_ONLY_ROLE_STATE_NOT_REOBSERVED`：**本轮尚未重新读取SQL角色目录**。

- 待确认SHA：`25dce03675001fc6ff269cb5a0322a63d9baca9f2c5125ee6d462eef5d5918d2`。
- 生成：2026-10-14 11:08:21.746 UTC / Winnipeg06:08:21.746 CDT；截止：**2026-10-14 17:08:21.746 UTC / Winnipeg12:08:21.746 CDT**。过期不执行、不自动延期。
- 私有清单：`F:/ChatGPT_workshop/techlong-d002-express-c3-role-review-20261014-r3/manifest.json`。
- 独立事实：`F:/ChatGPT_workshop/techlong-d002-express-c3-role-metadata-20261014-r1/facts.json`，11:08:35.549 UTC，字节SHA `f2ba12e4bf9c4beb6404970c1546d76f98705a547947193d5213535d728fc1bc`；除观察时间外与Review事实一致。Source connect模拟allowed不是SQL目录成功证明。
- 错误SHA的实际Root负例 `F:/ChatGPT_workshop/techlong-d002-express-c3-role-negative-20261014-r1` 返回 `EXPRESS_C3_ROLE_FRESH_APPROVAL_REQUIRED`，在AWS/SQL前拒绝，metadata/连接/query/槽消费全0。

需确认：按这个SHA仅一次固定只读连接/五条query，读取下文准确两角色的属性/成员关系并比较原reserve谓词；不修改/删除/接管角色或建库，不restore/migrate、不改AWS/Neon/Secret/IAM/ECS，不重放原安装；接受下文完整风险和新诊断永久槽单次消费。

## 准确对象和有限查询

现有cluster `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、PG17.9及原writer物理历史保持。管理连接仍是 `postgres` 数据库OID5 / 角色OID16410，TLS/ATS/hostname/SNI与原owned会话门禁复用；不是app/runtime权限。

- app角色：`tenant_a0da1748bc4d5419_role`，准确OID16456。
- guard角色：`tl_prepare_96c4e91750c441e3aab2de2609f7f029`，准确OID16457。
- 仅查询准确租户库名称 `tenant_a0da1748bc4d5419_db` 是否仍不存在。
- 原nonce、完整scope及bootstrap SHA来自已批准清单1df7e2f7...；原Run停止、INTENT、独立结果和两槽的五个字节SHA逐一核对。旧210 code entries+2原生工具保持，新增本地入口/纯诊断器后为212 entries；**不重新执行工具、编译archive或构建镜像**。

`ops/aws-sandbox/scripts/review-aurora-express-c3-roles.mjs` 只有Review、单次受审Run、InspectMetadata：

1. Review只核对冻结代码/历史和5次直接AWS只读元数据，生成6小时fresh SHA；SQL连接0，不消费诊断槽。
2. 具体SHA批准后，最多1个物理管理连接、5次固定query：既有身份SELECT → `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → 原固定catalog SELECT → 新固定成员/context SELECT → COMMIT。没有DDL/DML、advisory锁、schema或业务表读取。
3. 新SELECT在同一只读快照内核对事务read-only、creator INHERIT/CREATEROLE、`createrole_self_grant`，准确角色的成员/父关系完整计数及确定排序的有限列表（各最多17条，明确truncated）。原catalog的成员列表仍是旧代码的最多3条，不冒充全量。
4. 原冻结 `verifyStage(...,'reserve')` 再运行，但只作比较；逐项记录OID/名称/属性/ownership、ADMIN/INHERIT/SET和grantor拒绝条件。**不放宽原校验器、不自动学习新的合法授权模型**。即便当前匹配，也不唯一倒填原来失败原因，更不授权继续prepare。
5. 固定query白名单/准确参数、30秒connect、90秒SQL总时限、临时snapshot至少剩5分钟、同份STS/签名及前后物理核对；Run最多9次直接metadata、无重试。后继InspectMetadata仅5次云只读、SQL0，不额外连接数据库。

角色属性NOINHERIT与每条membership的INHERIT/SET是不同检查项，不能以单一角色属性推定所有成员授权选项；这里只准备读取实际目录，不推定Aurora已经采取何种creator授权。[PostgreSQL17 CREATE ROLE](https://www.postgresql.org/docs/17/sql-createrole.html)、[GRANT](https://www.postgresql.org/docs/17/sql-grant.html)。

结果只保存安全布尔/计数/OID、已知管理成员名/授予者及谓词ID；其它名称仅SHA。角色config内容、valid-until文本、原comment、驱动原错误、IAM token/临时keys不落结果；没有读取pg_authid/密码或Secret。目录全量SHA是观察摘要，不是ready结构pin。

## 完整风险——新的SQL连接仍需具体SHA批准

- Source沿用既有管理员，不是新的最小权限IAM；本地只读query限制不改变Source在其它进程的能力。不新增IAM/Secret/任务权限。
- 1个SQL连接可能唤醒留存cluster并产生ACU/I/O费用；50USD/月非硬cap，不安装cleanup。两个角色与旧资源继续保留。
- repeatable-read只保证本事务目录快照，前后AWS回读不是跨服务CAS；并发管理员可修改角色。新OID/名称漂移只报告，不接管、修复或自动删除。
- 当前原校验拒绝条件不等于唯一原事故原因；目录列表有上限，metadata-only不证明SQL角色/成员状态。不会凭“当前匹配”直接恢复写入。
- token/temporary credentials只在内存，JS/driver清零尽力而为；网络、AWS/数据库提供者日志可能暴露连接/SQL元数据。原固定catalog包含角色config/comment的内存读取，但原文不保存/输出。
- 新独立永久槽 `techlong-d002-express-c3-role-diagnostic-v1.permanent-slot.json` 在连接前消费；即使失败/超时/回执写失败，也不复位、补齐或自动重试。旧两槽及历史保留，不以新槽继续原安装。
- 不修改角色、成员或ACL，不创建租户库、不restore/migrate，不改Neon/业务、不设置LOGIN/运行时，不创建/修改AWS资源；任何后续写/已有对象接管另行审阅。

## 已验证与停止历史

3个必要新测试+2个C3相邻测试全部通过，定向eslint零警告、语法及平台typecheck通过。覆盖fresh SHA/过期/代码与历史pin/查询范围、拒绝谓词输出、敏感原文不序列化、OID漂移和非只读事务拒绝；不是实际角色目录或PG17安装成功证明。原Backend生产代码/Full/v2/183历史pins未改，用户`.vscode/settings.json`不提交。

准备r1 `F:/ChatGPT_workshop/techlong-d002-express-c3-role-review-20261014-r1` 泛化停在READ_ONLY_METADATA；保留原回执，不倒填唯一原因。添加CLI安全分类后r2 `...-r2` 返回 `EXPRESS_C3_ROLE_SOURCE_CREDENTIALS_UNAVAILABLE`，metadata计数3、SQL连接/query0、诊断槽未消费、云写0，**没有manifest或可批准SHA**。SDK/CLI依赖均应通过实际Review，不能仅凭单独STS成功跳过。

Source刷新后r3与独立metadata均通过，没有修改执行源码。当前最终code binding `dc5d99e0e5e86171e6e13cfa65cbd3855f48529ea5a5bf6acf1afc3555c8ab9e`；历史SHA `66c9e10bb256e04d54f5f0fb901fffec48f93f4e6cc8e80a55ebf5f4812e8298`。原catalog SQL SHA `6e754b9f6f2b2f61bae1c21637afdb05ff2b826fd4f915cddf421d988cffc0f5`，新固定SELECT SHA `cffba8a1160a9f80d358272b30a91b75e2bb2f924dee724cf32f055a34fde3f5`；都是canonical string digest，不是新的云批准。

## 唯一接续位置

当前只待用户确认SHA `25dce03675001fc6ff269cb5a0322a63d9baca9f2c5125ee6d462eef5d5918d2` 及完整风险；有效窗口内才执行单次只读Run，独立metadata后置回读不额外连接SQL。Source刷新、Review r3和独立metadata r1已经完成，不重复准备/测试/构建。**刷新身份不授权SQL Run，原安装SHA和两旧槽不能重放。**

批准后只执行这一次只读目录诊断，取得真实拒绝条件再准备必要的窄修正/已有对象后继方案；其写入仍fresh另批。不重复旧C2b网络诊断/构建，不换名堆叠角色、不重建cluster或回Grant/F3c9支线。[紧凑接续摘要](../ops/aws-sandbox/reviews/aurora-express-c3c-role-diagnostic.prepared.json)。
