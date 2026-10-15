# C5c：默认店铺已提交并独立核验

后继：[C5d准确旧栈退役及16资源计算层待审包](./aws-auto-deployment-aurora-dual-mode-c5d-compute-review.md)已完成实际只读核对与执行器，尚无云写；不改变本页已完成seed及其永久槽。

2026-10-15 America/Winnipeg。用户确认[准确执行包及完整风险](./aws-auto-deployment-aurora-dual-mode-c5c-store-seed-review.md)后，按SHA `d53b2572aac78bba7cc007b53315adc8f4edeb9f3d127d909d7e013ff328bfc0`完成唯一一次INSERT和独立只读Inspect。**默认店铺初始化已完成；并未完成provision、部署或initialized ready。**

## 实际结果

- Run于UTC **13:19:12.745**（Winnipeg **08:19:12.745 CDT**）收到COMMIT确认；一连接、22条SQL、仅一次业务INSERT，无upsert或既有行更新。
- 独立新进程Inspect于UTC **13:19:45.842**收到只读事务COMMIT确认；另一连接、12条SQL、业务写0。结果`STORE_SEED_INDEPENDENTLY_OBSERVED_NOT_READY`，与Run实际postcheck完整一致。
- 准确Express集群resource ID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，数据库`tenant_a0da1748bc4d5419_db`/OID16459；两次均为Source签发的postgres/OID16410 TLS/IAM会话。不是ECS task role证明，也没有读取Secret值。
- `stores`实际0→1；UUID `add89a8c-f43e-81b9-8287-0cb6c5c54f87`、code `TECHLONG_SANDBOX`、slug `first-acceptance`、Winnipeg/CAD、active/default、空联系信息及初始时间戳均严格匹配。
- 73表实际计数核对通过：其他业务表仍0；原singleton1和migration entitlements8不变，singleton仍未provision、无external instance/epoch/request/result。没有写店名/主题、商户用户或密码；这些留给原受认证mTLS provision。
- 原bootstrap DB/role comments匹配、临时bootstrap guard仍不存在；角色/四库ACL/完整catalog不变，未改数据库owner、LOGIN或权限。

实际hash如下；它们来自真实查询，不是为通过空库断言而改写过的行向量：

| 项目 | 实际SHA-256 |
| --- | --- |
| 写前73表计数 | `310ee440ffb56b77c6ea0fea8da49af27d31da1fad4fc9da1f44c469b94f09f1` |
| 写后及独立回读73表计数 | `8fb858f29bf407a2e06afb7506078c253c4707e5eead0555483b5dca0ad7451f` |
| 完整catalog（不变） | `ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9` |
| 应用角色（不变） | `941cfda905da13438878f0f5415a2d9bb56a7be217a8d813daef8fde401055d5` |
| 四库ACL（不变） | `9a6a5619d26ca00ec807c83e6dbf3c2f69504b06f93af26eb9b8ce6b86d61c22` |

## 凭据中断与永久槽

此前Run输出目录`F:/ChatGPT_workshop/techlong-express-c5c-store-seed-run-20261015-r1`仅在首个Source身份读取前后返回`STORE_SEED_SOURCE_REFRESH_REQUIRED`；SQL连接/调用/INSERT及槽消费均0，原证据保留。

用户刷新Source后，UTC13:18再次确认原清单仍在15:42:43.354截止前、全部代码pins未变、两槽均空。继续原批准的首次SQL尝试，使用新输出目录r2，未覆写r1、创建新授权窗口或重置槽。

Run永久槽于UTC13:18:47.313消费，Inspect永久槽于13:19:43.258消费；二者绑定原批准SHA并记录`retryAuthorized=false`。**现在两槽均已消费且本步骤完成，禁止再运行Run/Inspect或复位槽，即使清单尚未到期。**

## 证据与执行边界

完整本地证据目录：

- `F:/ChatGPT_workshop/techlong-express-c5c-store-seed-run-20261015-r2/`。
- `F:/ChatGPT_workshop/techlong-express-c5c-store-seed-inspect-20261015-r1/`。
- 对应run-v1、inspect-v1 permanent-slot.json及保留的r1/stopped.json。

[版本化执行capsule](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-store-seed.executed.json)绑定15份文件原始字节hash、实际结果、COMMIT时间及旧凭据失败证据。两次执行code-binding均为已批准`b53b0b11172dce00208de38180e999f73162033548378efd0ae091cbd42bb088`，没有改代码后沿用批准。

本轮资源读取合计STS6、RDS Describe4、IAM模拟2、DDB强一致GetItem4、Neon只读SELECT2；底层凭据获取HTTP另计。两次独立控制面preflight均观察到目标deployment/job/resource/operation为0、两套authority key缺失，仍不是跨服务CAS。AWS资源/权限/Secret/authority/Neon业务写、私密bundle读取、owner/epoch认领、job/TTL及ECS/Cell部署均0；实际SQL业务写仅上述store一条。

50 USD/月仍是目标而非硬上限；两次TLS/IAM连接可能唤醒Aurora并有非零费用，没有自动销毁或承诺零费用。原Full、F3c9封存、旧记录与所有槽保持。本轮只新增结果文档/capsule，不改执行代码或镜像；54项已有测试对应的准确pins已用于真实Run/Inspect，不为文档交接重建镜像或重跑离线全量测试。

## 下一步只回到部署主线

准备计算层16资源/准确旧失败栈处置、首次owner/epoch登记、7资源workload/DNS、准确私密来源及provision→ready闭环的集中执行包；实际删除、新权限/付费资源、私密读取和控制面业务写仍需具体fresh审批。当前未创建job或启动TTL，不提前计时。

**后继必须以“准确store1、技术9seed且未provision”为当前前置状态；不得重放旧C4空业务断言、schema恢复或权限安装。**现有两真实ECR digest和8753546应用源码继续复用；不新开SQL诊断/Grant/F3c9支线。独立seed回读不是完整live delivery root、ECS登录、网址可用或平台ready证明。
