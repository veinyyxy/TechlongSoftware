# D002 C3a：Express 管理写会话与独立 NOLOGIN 数据库准备代码

2026-10-13 America/Winnipeg。沿用D001首轮单租户交付、D002双模式和[已成功的C2b真实连接](./aws-auto-deployment-aurora-dual-mode-c2-diagnostic-executed.md)。**本阶段完成管理会话 transport 和有限 prepare SQL port，未执行SQL写、未完成完整写生命周期或部署。** 不恢复F3c9，不重建现有Express，不增加Grant探针阶段。

## 本次实际变更

- 新 `aurora_management_sessions_v3.js`：面向真实PG17.9的可写IAM管理会话及管理/租户双库会话。30秒连接、120秒总transport窗口；每个物理连接最多一次内存签名、默认仅ECS metadata凭据，无password/本机profile/Secret fallback。ATS根链、hostname/SNI、客户端TLS、服务端TLS=true、真实database OID、管理role OID、用户名/session_user、PG170009、UTF8、read_only=off与固定pg_catalog search_path全部核对。任一会话丢失销毁整组，结束有界、错误不输出原文/token，不自动重连或回滚业务。
- 双仓同字节 `aurora-express-bootstrap-v3.cjs`：纯编译器，五字段业务scope的canonical SHA绑定tenant名称、第一代、准确cluster物理target与nonce。**pre-Secret数据不是runtime binding**，不补假Secret ARN来绕过v2；JSON克隆不能成为Backend编译程序品牌。
- 新 `aurora_express_bootstrap_provider_v3.js`：固定NOLOGIN prepare port。必须由以后受审根提供owned session和持久阶段journal。占名拒绝；阶段提交前记录意图，提交后捕获目录SHA及真实role/guard/database OID。失响应即停，不adopt、IF NOT EXISTS、补齐、自动补偿或重放。
- 平台 `buildDatabaseTaskConfigurationV2` 的**新Express app候选**显式 `PGPOOL_CONNECTION_TIMEOUT_MS=30000`；Full不加此项，旧backend连接模块/原默认10秒不直接修改。没有更新任何实际TaskDefinition或服务。
- 两镜像既有断网自检增补V3模块、15条固定程序、非执行品牌检查；默认CLI/v2写拒绝、Full默认入口、所有runtime flag保持。

这些低层port不是准入根：**没有可执行的新CLI/审批SHA，没有消费新永久槽，没有把v2只读准入token换成写token**。Source显式凭据注入只会在下一受审本地bootstrap根中设计；当前默认不从本机AWS Login取凭据。

## 准备程序准确范围

| 阶段 | 固定程序 | 后置核对 |
| --- | --- | --- |
| reserve | BEGIN；新app与nonce guard各NOLOGIN/NOINHERIT、无提升权限、PASSWORD NULL；准确所有权comment；guard仅授予postgres ADMIN/INHERIT/SET；COMMIT | 两实际role OID、comment、属性、父路径及仅postgres成员；app不拥有对象 |
| quarantine | 一次CREATE DATABASE，template0/UTF8，准确guard所有权，ALLOW_CONNECTIONS=false；不在事务中执行 | 真实database OID、准确guard OID/owner、禁止连接、无外来ACL/metadata |
| promote | BEGIN；转准确postgres所有权；仅撤销**新库**PUBLIC全部权限；准确comment；允许连接；删除仅本次guard；COMMIT | 原role/database OID不变、实际管理role OID等于数据库owner、PUBLIC/外来ACL关闭、app仍NOLOGIN、guard缺失 |

共**15条提交语句（含4条事务控制、11条DDL）**，不含会话身份SELECT、目录回读及合作advisory lock。此统计是未来程序范围，本轮实际SQL调用为0。管理角色自动ADMIN-only成员及准确guard显式成员仅允许postgres/rdsadmin grantor且完整选项受检；这是PG17受审候选，不是已观察的新role托管行为。[PostgreSQL 17角色属性](https://www.postgresql.org/docs/17/role-attributes.html)

终态仅 `NOLOGIN_PREPARED_NOT_RESTORED`，不是ready、IAM应用登录或lifecycleCompatible。没有设置应用密码、加入rds_iam、给app授权、创建表/迁移/首位商户账号、获取Secret值、安装IAM、启用任务/worker或删除既有资源。

## 准确租户候选与不可混淆的事实

私有输入 `F:/ChatGPT_workshop/techlong-d002-express-c3a-candidate-input-20261014.json` 由此前五条sandbox业务实际回执和独立回读记录派生；包含准确workspace/app/product/environment/cell scope。本批没有再查询或修改Neon。

- stableIdentity：`a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d`。
- 拟新库 `tenant_a0da1748bc4d5419_db`、拟app role `tenant_a0da1748bc4d5419_role`；**尚未创建/证明查空**。guard为私有nonce派生，不与任何旧role共用。
- 仅现有 `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` / 原官方endpoint；历史C2b管理库OID5、管理role OID16410是下一fresh回读的预期，不当当前事实或新role OID。
- 原archive与manifest在本批重新读取文件字节并核对双pin：`1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`、`62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。仍是73表schema-only，不导出原业务数据。

**此候选没有有效期/执行批准，不能拿候选SHA当执行清单SHA。** 候选canonical SHA `b15c541f4c008db9af7c3cc6f42e126e8477b3a374ccf5e2d3cb2410c2bbb8c7` 仅用于后续追溯，不能运行；[非秘密继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3a.prepared.json)明确历史事实、未执行状态与剩余接线。后续根必须绑定准确代码、fresh AWS身份/cluster/writer/账户、SQL权限/查空、baseline/SQL pins、完整阶段和失败接管范围，安装不可复位attempt后才可运行；旧槽不动。

## 隔离与恢复的剩余项——集中完成，不另走支线

PG默认PUBLIC持有数据库CONNECT/TEMPORARY；对某租户REVOKE不能抵消PUBLIC所得。当前prepare仅关闭**新租户库**的PUBLIC，app仍NOLOGIN，因此**尚未符合v2目录中的other_connectable_databases=0，不能拿prepared候选通过它**。下一启用方案需fresh目录核对，逐一列明postgres/template1等非客户库的PUBLIC CONNECT变更及影响，不擅自做全局REVOKE，不放宽原检查。[PostgreSQL 17权限](https://www.postgresql.org/docs/17/ddl-priv.html)

下一交付块集中补齐：

1. 原73表空baseline的PG17.9 restore/结构/零行/容量证明及SaaS migration。复用固定archive、offline pg_restore16.14编译器和owned Node pg事务，不把IAM token传给子进程。原PG16.14结构hash和成功回执**不是PG17.9证明**，不简单改版本或照用旧marker。
2. 一个本地Source受审bootstrap执行根，绑定准确程序/资源、有限调用、fresh审批、永久意图与真实OID记录、独立Inspect。尽量将prepare/restore/migrate做成一次具体审核的有限包，而不是逐个Grant/小探针；不把本地Source成功当Fargate authority。
3. 随后真实Secret-v2固定四键、HMAC首位密码、app rds_iam/NOINHERIT和默认库隔离、准确task-role connect IAM。Secret-v2/新authority/activation门禁保留；每项实际写入仍明确资源和范围批准，不新造通用工厂。

现有cluster可能继续计费，50USD/月是目标非硬cap。未来SQL若部分提交或失响应，禁止自动down/delete/retry；nonce/OID阶段回读后人工接管。旧C2空集群清理材料不能自动用于已安装租户的状态，新增租户后的清理须绑定其实际OID/owner/会话/业务状态重新审核。旧Full失败栈、生产RDS、公钥Secret、Neon/业务记录、F3c9和所有历史槽保留。

## 验证与继续位置

Backend5项新测试和连接/准入相邻测试通过；平台8项新相邻测试、typecheck/定向lint、Backend类型/语法、无网络模块自检通过。测试只校验transport/OID/丢失、固定SQL/占名/失败journal/未知CREATE响应，没有用大批模拟代替真实PG17验收。双仓compiler LF SHA `2d037718ecaa80b52e3dd6358b2f48e8490ba6a1d855d68b7447ac75ceef8c08`；**原183项历史pin entries全部保持**。Backend用户`.vscode/settings.json`不提交。

Backend初版 `924a4a0bca52b7bf517df2fee36818f774eb85f0` 的[完整CI38512764956](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38512764956)和[双镜像38512765027](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38512765027)均success。独立两job回读构建/自检/生产依赖和OS门禁/导出/保留全部通过；app04:42:55、lifecycle04:42:52 UTC实际日志均有V3模块存在、bootstrapRootEnabled=false及网络/SQL0的自检帧。

复核新增pg_catalog search_path固定后，最终源码已推送 `733e73037df2fb69cb7ef7608bbcae3ab032504b`。[最终CI38513274829](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38513274829)与[最终双镜像38513274884](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38513274884)均success；独立回读app job115686364584、lifecycle job115686364769所有步骤success，两个最终镜像实际V3自检帧均通过，不能用前一版本成功替代它们。只回读Actions/artifact metadata和已脱敏自检帧，不下载/复算整个镜像归档；artifact ZIP digest不是ECR/OCI image digest。

没有ECR发布、AWS写、SQL连接/写入、Secret值、Neon写或任务部署；没有执行原C2/C2b Run或任何旧清单。三个旧消费槽原文件保持，两个删除槽缺失，本批无新执行槽。**下次从上面三项剩余接线继续，不重复已经通过的管理员诊断或历史构建。**
