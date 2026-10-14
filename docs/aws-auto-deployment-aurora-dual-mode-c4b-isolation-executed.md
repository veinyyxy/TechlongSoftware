# D002 C4b：实机只读核对完成，发现两个 PUBLIC CONNECT 缺口

2026-10-14 America/Winnipeg。用户确认 [4de95e90...清单及风险](./aws-auto-deployment-aurora-dual-mode-c4b-isolation-review.md)后，仅执行一次固定管理库Inspect。结果是 `ISOLATION_ACTION_REQUIRES_REVIEW`：核对成功，但隔离未通过，不是ready或激活成功。

新本地槽于21:09:41.255 UTC / Winnipeg16:09:41.255 CDT消费。结果文件保存于21:10:03.464 UTC（本地文件时间，非SQL服务器时钟）。实际1个TLS管理库连接、6个固定query、6次AWS/CLI预核对；无ROLLBACK或重试，无租户库连接/业务表查询。准确Source及快照STS、物理Express binding/17.9/FREE ACTIVE/管理connect simulation通过；client TLS和backend TLS均true。

## 实际目录结果

| 数据库 | OID / owner OID | 应用角色 CONNECT | PUBLIC CONNECT | 处理状态 |
| --- | --- | --- | --- | --- |
| template1 | 1 / 16410 | true | true | 真实隔离缺口 |
| postgres | 5 / 16410 | true | true | 真实隔离缺口 |
| rdsadmin | 16384 / 10 | false | false | 保持不动 |
| tenant_a0da1748bc4d5419_db | 16459 / 16410 | false | false | 保持当前关闭状态，应用最小授权另批 |

准确app16456的closed classifier通过，仍NOLOGIN/NOINHERIT、无elevation/配置/所有权/parents/members；ROLE_DIRECTORY的其它可CONNECT库计数2与逐库结果一致。两个缺口的PUBLIC CONNECT均由postgres16410授予、无grant option；两库postgres自身的显式CONNECT/CREATE/TEMPORARY都存在。postgres还有PUBLIC TEMPORARY，本次没有修改或扩大它。

当前“拥有CONNECT”不等于能以NOLOGIN角色实际登录，更不等于读取其它库业务数据；这次没有app登录、业务表读取或其他用户/服务盘点。rdsadmin和准确租户库的PUBLIC路径均关闭。没有重新核验73表/seed或目录93d3...结构，`schemaReverified=false`；IAM/Secret事实沿用C4b Review20:53的元数据，不能当作未来写前实时状态。

本次SQL数据/权限写、AWS写、Secret值读取、LOGIN/GRANT/REVOKE、paid resource创建、ECR/ECS部署均0。runtime/ready、真实任务角色权限与受限rds_iam membership应用登录均未验收。既存资源及本次唤醒可能计费，50 USD/月不是硬上限。

## 结果完整性与不可重放

实际目录digest：`2959d744c2c4fa8e21dfb2b26f0152978ed55f784d76c39757309a955b7000cc`，由受审入口在内存中对实际角色/数据库目录生成。安全observation保存classifier结果和逐库ACL，不保存原始role config/密码或凭据。

执行目录：`F:/ChatGPT_workshop/techlong-d002-express-c4b-inspect-20261014-r1`。独立本地文件核验确认批准SHA、结果/slot计数、两库PUBLIC路径、准确OID/owner、TLS标志和243当前源码pins一致；**没有第二次SQL连接**，不把文件核验说成独立实时数据库回读。[紧凑执行证据与文件字节SHA](../ops/aws-sandbox/reviews/aurora-express-c4b-isolation.executed.json)。

清单4de95e90...及其永久read槽已消费，不再运行Inspect、不刷新它来重放、不复位任何槽。所有C3/V4/V5/F3c9记录保留。此轮只提交结果文档/非秘密证据；执行代码和Backend153efbc已验镜像保持，不发布ECR或部署ECS。

## 下一阶段的准确处置建议（仅数据，不可执行）

继续保持原先“app不能连接其它库”的激活门禁，不把两处缺口默认为可接受。建议在**这个准确Express集群**中，只审阅以下两项候选变更，并与准确租户最小应用授权统一准备：

```sql
-- DATA ONLY：尚无fresh写入清单/执行根/批准，本轮未执行。
REVOKE CONNECT ON DATABASE "template1" FROM PUBLIC RESTRICT;
REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC RESTRICT;
```

保留两库postgres16410的显式CONNECT/CREATE/TEMPORARY以及所有其它既有ACL；不改postgres的PUBLIC TEMPORARY、不修改rdsadmin、tenant现有ACL、allow_connections、数据库owner或业务数据，不终止现有会话。未来具体写入口必须对准确物理cluster/库OID/owner/完整ACL/角色再作fresh同事务核对，出现外来grant或结构/身份变化即停下审阅，不能依据名称猜测或静默补齐。

**影响不是只针对应用角色**：PUBLIC权限对所有角色生效，单独REVOKE app的直接grant不能移除仍存在的PUBLIC路径；撤销上述PUBLIC CONNECT会影响所有依赖这两库PUBLIC权限建立新连接的现有/未来SQL用户和工具。CONNECT在连接启动时检查，不能据此声称已断开现有会话。保留postgres显式授权不等于已证明所有监控、迁移或托管维护消费者不受影响；本轮未盘点它们。[PG17权限规则](https://www.postgresql.org/docs/17/ddl-priv.html)、[REVOKE规则](https://www.postgresql.org/docs/17/sql-revoke.html)。

后续不另建通用授权/探针支线：集中准备上述隔离处置、C4a准确73表/7序列最小授权、四键Secret、app/lifecycle准确IAM connect及execution Secret读权限、真正ready/初始化接线，再沿已有两镜像推进ECR→ECS。实际SQL/Secret/IAM/部署写各按具体资源、fresh SHA及风险另行确认；现在没有新的写批准或可执行SHA，不自动执行这两条候选SQL。
