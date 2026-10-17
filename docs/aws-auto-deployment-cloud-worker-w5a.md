# W5a：单次 worker 云化，先移除本地永久槽依赖

2026-10-17。沿用50 USD/月目标和已有批准边界；W4c真实闭环已通过，不再重复部署验收，不重启F3c9支线，也不发布Sites。

## 决策与本次交付

首轮云执行采用 **GitHub Actions单次Node worker + AWS短期OIDC角色**，继续部署到现有AWS承载。复用已有Actions体系，不先为worker再建常驻ECS服务、ALB或数据库。这是过渡执行器，不改变最后整套平台迁AWS的目标。

本次只实现云化的第一个必要组件：独立DynamoDB永久执行journal，以及无AWS凭据的CI服务验证。**未安装表/角色、未启用云worker、未接入旧W4入口，也未读取Secret值或原私密包。** 现有成功回执和F盘旧槽保留，不迁移、删除或复位。

代码：`lib/deployments/execution/cloud-worker-journal-v1.ts`。生产SDK工厂显式接收短期session credentials，固定区域/服务endpoint、maxAttempts=1，无AWS Login、profile、默认凭据链、CLI或F盘路径。调用该工厂本身会读既有表的两项元数据；本轮没有调用生产工厂。

## 围栏语义

候选专属表名 `techlong-sandbox-deployment-worker-journal-v1`（账户402010193138，ca-central-1），**不复用external epoch authority表**。pk=`JOB#准确jobId`，sk=`STAGE#阶段`；不把manifest、request、Actions run/attempt或generation放进主键，因此换清单/重跑不能获得同job的新槽。

五阶段严格顺序：

`run → claim_job → create_workload → private_control_load → atomic_complete`

- run：带`attribute_not_exists(pk)`的Put；四个后续阶段：同事务检查上一个槽的完整binding/表ID/state，再条件Put新槽。无Update/Delete/重置/租约接管API，不用短时幂等token模拟永久去重。
- binding固定job/request、manifest/code/前驱receipt SHA、窗口、Actions仓库/run/attempt/commit及五个action/contract SHA；每次消费另记准确effect SHA。此组件只记录调用者给出的effect，不代替composition root重算SQL/请求或验证批准。
- 所有槽在对应副作用**之前**消费；ACK后只允许当前进程前进一步，不允许新进程根据既有槽继续。发送异常、ACK丢失、重复、过期或顺序错误即停止，无应用/SDK重试。ACK返回时窗口已过也停止。
- 独立Inspect用一次TransactGetItems取五槽事务快照。ABSENT/PARTIAL/ALL_SLOTS_CONSUMED都**不是**部署成功或重试批准；成功仍要同job数据库回执、准确云UUID及认证GET证据。
- 校验准确TableArn/TableId、ACTIVE、pk/sk字符串键、无二级索引/复制、删除保护开启、TTL完全关闭。实际TableId必须在以后安装的独立回读中固定，不能把同名重建表当原表。记录不带TTL。

使用AWS公开的[条件写语义](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)与[事务读写语义](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)。这些围栏限制正常受审代码的重放，**不是DynamoDB/Neon/CloudFormation跨服务原子事务，也不是对任意可写表身份的防篡改保证**。失去ACK可能留下已消费但未发生副作用的槽，人工只读调查；不能以“状态未知”为由换job或表规避。

运行角色以后不得拥有删除表、更新表/TTL、删除/更新item或恢复表的权限。管理员并发更改、同名表替换的读写间竞态并未被TableId预检彻底消除；表ID也不能恢复被删除的journal。真实IAM/TLS、持久性和灾难恢复需在安装范围另审并验收。

## 验证与执行边界

- `node --experimental-strip-types --test tests/cloud-worker-journal-v1.test.ts`：针对性失败阻断测试，不宣称AWS线上通过。
- `.github/workflows/cloud-worker-journal.yml`：仅contents:read，**无OIDC/仓库Secret/AWS凭据**；ubuntu临时runner启动固定摘要DynamoDB Local 3.3.2容器，端口只绑定runner loopback、关闭telemetry，结束删除本次自有容器。
- `scripts/ci/prove-cloud-worker-journal-v1.mjs`：使用SDK真实调用临时服务，证明五阶段、独立快照、跨对象重复/换清单阻断、并发单ACK、提交后丢ACK、事务前驱失败不遗留下一槽、过期零写。不是仅用Map替身宣称并发通过。
- CI适配层仅将固定生产表ARN转成本地表名，并归一化本地不具备的真实账户/TableId元数据；AWS身份/IAM/TLS/生产持久性**没有在该服务测试中证明**。临时容器、虚构凭据和fixture job不接触Neon或真实任务。
- 本地journal及旧W4相邻回归共17项通过，完整typecheck和定向lint通过；只读CheckSources仍验证旧99 pins（DB/AWS/私密读取/槽消费均0）。云CI结果以随后记录的准确commit/run和artifact为准，未通过前不称最终版本云验证成功。不安装本机Docker Desktop、不复制任何.env/原私密材料给Actions。

官方服务[运行方式](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)、[关闭telemetry](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocalTelemetry.html)、[版本记录](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocalHistory.html)和[固定镜像来源](https://hub.docker.com/r/amazon/dynamodb-local/tags)于本阶段核对。

### 已完成的云CI实证

初版提交`38c2c69`的[run 39070217239](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39070217239)及补充TTL/迟到ACK测试后的最终代码`5eebbe6`的[run 39070352245](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39070352245)均success；各7组真实临时服务验证通过，最终CI另含8项journal测试、完整typecheck及定向lint。两个原始artifact ZIP的GitHub digest/长度及全部4成员独立回读核对，服务日志确认3.3.2，cleanup均证明只移除了本次自有临时容器。

最终ZIP SHA `552898b9d42ee71c57c9d6fd322be0128912475e757a07758cea961e38907ba7`，proof SHA `62ba45ab410f7bc131eefd183d7fecc48002bf45f81e8c11116bcef64890ba0c`，原件目录`F:/ChatGPT_workshop/techlong-w5a-ci-39070352245`。完整代码pins/两轮原件摘要见[准备记录](../ops/aws-sandbox/reviews/cloud-worker-w5a.prepared.json)。这证明候选journal的服务语义，不是已经在AWS安装或云部署通过。

## 唯一继续位置

W5a代码及CI通过后，直接做 **W5b：cloud composition root与最小受控材料**，不再重复journal切片：

1. 给现有provider增加显式云身份/SDK读取组合，去掉本机aws CLI与AWS Login；历史W3/W4已绑定代码不改，保留旧76/99 pins，包清单暂不改。新云根从准确Git commit构建自己的依赖闭包，绑定实际交付字节，不把Windows CRLF原件与Linux checkout混作同一raw hash，也不为适配云端改写旧历史pin。
2. 新根以W4c准确成功receipt(:5/aa96)为前驱，证明沿革及退役事实；不能把原W4固定:4/74a校验改成一个任意配置来绕过审阅。尚无新请求/部署授权。
3. 最小材料只含准确job所需的Neon最小权限连接与本租户认证GET必要的JWT/mTLS材料，固定Secret版本及公开指纹；不得直接上传现有owner/admin DSN。若缺DB角色隔离，作为明确安装变更集中审阅，不扩成另一schema支线。不上传原`private-material.json`（其中有不用的Stripe密钥），不读值来“准备一下”。明确Review→批准→Run→Inspect及持久化公开回执的位置。
4. 代码/工作流接完后，一次给出**具体新OIDC角色、专属journal表、最小Secret/材料和准确单job的资源/费用/风险清单**，再按fresh SHA批准安装与首次云运行。现有镜像发布OIDC角色不可借用。GitHub重跑/并发控制不是永久围栏。

本次不需用户刷新Source、不需提供密码。实际资源安装或材料迁移时再请求所需授权，不把“开始下一步”当作新增IAM/收费部署批准。

W4承载固定到期2026-10-17 01:35:34 CDT已过；本阶段未查询其当前云状态/清理结果，不声称仍在线或全部停费，父Cell/初始化库仍保留。所有旧成功job、ready_at/default store及五个已消费槽不变。
