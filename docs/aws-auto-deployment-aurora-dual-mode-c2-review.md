# D002 C2a：最小 Express 真实事实验证，待批准

2026-10-13 America/Winnipeg。后继 [C1 生命周期接线](./aws-auto-deployment-aurora-dual-mode-c1-lifecycle.md)。**本批只读准备完成，尚未创建 Express、连接数据库或验收租户。** 不升级 account plan，不扩大 F3c9，不重新开启旧 Grant 系列。

## 已核对的真实前置

2026-10-14 01:34 UTC 的新清单回读：Source 为账号402010193138的固定 `techlong-sandbox-dev` IAM user，账户 `FREE / ACTIVE`。ca-central-1 无 DB cluster；有一个 `speedfeast-postgres-prod` 独立 RDS 实例，必须保留，不属于本清单。区域通用 quota 为 cluster 0/40、instance 1/40；这是区域通用 quota，不是证明 Free Plan 的跨区域剩余额度。Free Plan 额外限制仍由服务执行，区域查空不能保证创建成功。[Free Tier 限制](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-free-tier.html)

区域默认 Aurora PostgreSQL 为 **17.9**，支持最小0 ACU；创建后仍冻结实际版本，不能冒用原16.14 baseline验收。现有 RDS service-linked role ID 为 `AROAV3GNMXTZAUVFEZZNN`。Source 从 Administrators group 继承 AdministratorAccess，无用户 boundary；10项创建/描述/连接/删除权限模拟均allowed。**不需要新 IAM 安装**；模拟不证明所有 SCP、服务条件、网络或 SQL 权限，脚本范围保护也不是新 IAM 最小权限围栏。

旧 Full 栈仍 `ROLLBACK_COMPLETE`，准确UUID `ede4f290-c758-11f1-8050-06ffda7a3477` 保留；公钥 Secret、原业务五行、凭据包、F3c9和所有已消费槽不动。

## 本次可批准的准确范围

| 项目 | 限定范围 |
| --- | --- |
| 一次直接云写 | `CreateDBCluster`，准确名 `techlong-sandbox-express-d001` / ca-central-1 / 固定账号；`WithExpressConfiguration=true` |
| 容量与清理前置 | `MinCapacity=0 / MaxCapacity=1 / SecondsUntilAutoPause=300`，`DeletionProtection=false`；服务默认 Aurora Standard，实际回读不符则停止，不补写修正 |
| 服务侧资源 | 一个 cluster、一个服务自动生成的 serverless writer、internet access gateway；不另调 CreateDBInstance，不建立客户 VPC/ALB/ECS/Secret |
| 一次 SQL 会话 | 固定 `postgres` database/user，Source AWS Login 临时凭据在内存签名，五ATS root/hostname/SNI校验；BEGIN READ ONLY、身份SELECT、管理员catalog SELECT、COMMIT，共4条 |
| 云回读 | 真实ARN、clusterResourceId、writer ARN/resourceId/创建时间、准确nonce tags、IAM/gateway/VPC标志、容量、engine/endpoint/port；SQL前后再核对 |
| 明确不授权 | SQL DDL/DML、创建租户角色/DB、恢复73表、迁移、Secret值读取或创建、IAM写、Neon/authority/activation/job、ECS、付费Cell、旧资源删除或自动重试 |

Express 的单次创建包含托管 writer；本机直连仅做管理员只读取证，不是新的生产入口，也没有伪造租户 runtime Secret 或 Fargate authority。[Express 创建与网络/认证约束](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html)

只读结果明确 `ADMIN_READONLY_OBSERVED_NOT_TENANT_VERIFIED / lifecycleCompatible=false / runtimeEnabled=false`。管理员catalog属性只能说明观察到的属性；没有实际证明 CREATE DATABASE/ROLE、应用 IAM 登录、隔离、baseline、migration 或 ready。真实网关 endpoint 格式/SQL版本/角色选项不符时拒绝，不自动放宽 C1 或旧Full条件。

## 费用与接管责任

01:34 UTC重新获取 [AWS ca-central-1 RDS公开价格feed](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ca-central-1/index.json)，publication为2026-10-06：Aurora PostgreSQL Standard计算 **0.14 USD/ACU·小时**、存储0.11 USD/GB·月、I/O 0.22 USD/百万次。按2小时、持续1ACU估计，**仅计算0.28 USD**；假设1GB存储同期约0.000301 USD。未扣credits，另有实际I/O、transfer/backup/提供者日志等变量；公开页/feed未确认独立gateway费率，**不把未找到的价项视作免费**。[Aurora计费口径](https://aws.amazon.com/rds/aurora/pricing/)

0.5ACU持续730小时仅计算51.10USD，1ACU为102.20USD；50USD/月仍是目标，不能宣称整套常驻符合预算。5分钟空闲auto-pause不是保证、消费上限或销毁；未暂停/失败遗留会持续消耗费用或credits。目标在运行后2小时内决定继续使用还是按新SHA清理，**没有安装定时删除**；本脚本最多观察20分钟，已进入的单次API另受45秒超时约束。

## 完整风险与准确清理

- 复用既有管理员 Source，凭据自动刷新可能失败；代码不是权限降权。身份读取、签名、RDS回读与操作之间仍有并发窗口，无跨服务CAS。
- 一次创建也可能只部分成功；返回丢失或本地保存失败可能留下收费资源。创建和SQL尝试槽在各调用前永久消费，失败不复位、不补齐、不重放。只读Inspect可重新核对，但不会重试SQL。
- public IPv4 gateway/IAM认证和客户端认证TLS并不等于租户隔离证明；服务端TLS可能报告false/null，必须原样记录。元数据、管理员查询、认证与网络行为可能进入服务端/提供者日志；临时token不写文件、Secret、task env、控制台或receipt。
- 默认engine/服务托管字段与实际网关格式可能不满足当前严格检查。停止时先保存证据，不自动改版本、网关、权限或SQL条件。旧PG16.14证据不泛化到PG17.9。
- 价格变量、未确认gateway费率、未自动暂停与遗留资源，使上述估算不是费用硬上限；账户不能被脚本自动升级。
- 清理入口已编码，但**本次创建批准不授权删除**。需捕获实际创建receipt和cluster/writer身份，再生成独立 `CleanupReview`、新SHA明确批准。最多一次准确writer DeleteDBInstance及一次准确cluster DeleteDBCluster，先等writer缺失再删除cluster；skip final snapshot并删除automated backups，数据不可恢复。各删除有独立永久槽，不FORCE、不终止会话、不自动恢复失败步骤。
- 清理前比对实际ARN/resourceId/创建时间/tags/成员与创建receipt；仍不能消除按identifier删除的并发重建/客户写入竞态。若后续已装租户或改变用途，不能照搬此清理材料，应重新审核完整业务/会话范围。异常身份、缺失receipt、并发变化、删除pending或凭据失败需要人工接管，不能把“已提交”当已删除。

## 新清单与执行入口

最新 **r2**：`F:/ChatGPT_workshop/techlong-d002-express-c2-review-20261014-r2/manifest.json`。

- manifest SHA：`b883fbeacbb0ae473f408f296f805a31c50bd865730e3b4d7a2af45387101671`
- 有效至 **2026-10-14 07:34:54.750 UTC / Winnipeg 02:34:54.750 CDT**。执行前重新核对30秒内事实、Source身份、FREE/ACTIVE、默认版本、已有SLR身份、查空/配额/模拟和8项代码pins；过期或漂移不消费创建槽、不写AWS，需要新Review，不重跑旧失败Run。
- 固定新槽名 `techlong-d002-express-c2-{create,sql-inspect,writer-delete,cluster-delete}.permanent-slot.json`。本批均未消费；r1历史审阅及负向测试记录保留。

获明确批准后才执行（由本任务执行，不要求现在运行）：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-aurora-express-c2.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-d002-express-c2-review-20261014-r2/manifest.json --approved-sha b883fbeacbb0ae473f408f296f805a31c50bd865730e3b4d7a2af45387101671 --output F:/ChatGPT_workshop/techlong-d002-express-c2-run-20261014-r1
```

Run后另用新目录 `--mode Inspect --manifest <原manifest>` 做独立RDS只读回读，不重连SQL。`CleanupReview`另外接受 `--receipt <实际Run/created.json>`；`CleanupRun`仅接受其 `cleanup-manifest.json` 新SHA。清理实际API缺失需独立新进程再次描述准确对象确认；未执行、不提前生成虚构writer ARN的批准。

## 本批验证与唯一继续位置

平台12项新/相邻检查、Backend20项新/相邻检查、两仓types、定向lint零warning及syntax通过。Admin探针测试使用明确mock，不宣称实机；CLI无效SHA负向检查在任何AWS/SQL调用前拒绝，写入/会话计数均0（首次受沙箱realpath限制，独立许可检查得到准确拒绝代码；历史保留）。原172源码pin entries全部匹配，用户Backend `.vscode/settings.json`不提交。没有新依赖或runtime flag更改；两仓按既有授权直接提交推送main。

Backend准确提交 `e3c019b4a11b1b7689bb899649a3a21b5e60e8df`、平台代码提交 `99b1ffc388107bac6483001669c3aac71b8274bb` 已推送并独立回读远端main一致。01:40 UTC独立GitHub回读：[完整Backend CI38496797219](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38496797219)的check/docker，以及[镜像候选38496797120](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38496797120)的app/lifecycle，attempt1四job全部success。两个候选构建、自检、安全门禁与导出通过；未下载复算归档、未ECR发布、不是Express实机证明。该CI证据只记录文档，不改变r2的8项代码pins或批准SHA。

**下一步仅等待本新SHA的创建+只读会话批准**。通过后依据真实事实补剩余C1写适配及有限角色/空baseline验收范围，再推进D001单租户ready；不把这一个管理员连接检查扩成新的支线，也不视作本次获准 SQL写/安装/部署。
