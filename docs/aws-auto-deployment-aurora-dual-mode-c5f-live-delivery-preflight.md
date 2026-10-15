# C5f：首次认领与真实 workload 请求已编译，只读预检发现阻断

2026-10-15 America/Winnipeg。接续已完成 C5d 计算层和 C5e 本地控制材料来源验证，仍只推进同一个首轮交付闭环，不扩展 F3c9、恢复探针或发布支线。

**本阶段完成的是具体请求编译与真实只读预检，不是部署完成，也没有新的写入批准。** `executionCliAvailable=false`、`authorityCurrentlyInstalled=false`、`runtimeEnabled=false`、`readyVerified=false`。本轮没有 AWS/IAM/Secret/Neon/authority 写、Aurora SQL、私密包或 Secret 值读取、执行槽消费、job/TTL 启动。

## 新实现

- `express-live-delivery-plan-v1.ts`：绑定 C5c 准确新 deployment、C5d 新 UUID/模板/六项输出、C5e 已保存的非秘密回执、现有固定版本 Secret 和两份已发布镜像，编译真实七资源 workload、DNS 及首次 DDB authority 条件事务。没有重读私密包，不改旧 Full validator。
- 公钥 Secret 引用完整固定为 `ARN:::VERSION`，四键 runtime Secret 版本保持；既有通用 validator 仍保持原 base-ARN 规则，新独立入口精确绑定完整引用，不放宽旧路径。
- workload `ExpiresAt` 为 UTC **16:44:56.000** / Winnipeg **11:44:56.000 CDT**，不超过计算栈标签 **16:44:56.246Z**。为渲染计算的 `renderRequestedAt` 不是实际 job 创建时间。两个标签都不自动删除或停费。
- `express-first-claim-program-v1.ts`：九条 bound SQL，拟在单个 SERIALIZABLE 事务内锁定准确 active sandbox/pending app/active subscription，核对现有 5000 cents policy 与 first-absence，追加 deployment、direct-running 单次 job、planned resource、claimed event、pending_external epoch1 和 prepared event，共六行。没有 upsert、owner 转移、DDL、旧行改写或伪造 verified/active；环境 `apply_enabled=0` 保持。此编译器不连接或提交 SQL。
- `review-express-live-delivery-v1.mjs` 只有只读 Review；`explain-express-first-claim-v1.ts` 强制 READ ONLY 及 `EXPLAIN (ANALYZE FALSE)`，没有执行上述 INSERT 的入口。

具体后继 AWS 请求是：一次 DDB `TransactWriteItems`（aurora-v2 key 缺失条件检查 + legacy key 缺失条件 Put，只创建 legacy epoch1）；一次七资源 `CreateStack`；一次准确域名 A alias `CREATE`，不 UPSERT/DELETE。**这只是三个直接 API 请求草案，不是总写次数、IAM/Neon 激活或 provision 完整范围，也不是执行清单。** CFN 内部会创建资源且 `OnFailure=ROLLBACK`，后续审批须明确该回滚可能删除本次新资源并可能遗留收费对象。

## 真实预检

最终目录：`F:/ChatGPT_workshop/techlong-express-c5f-review-20261015-r3/`；UTC **15:21:40.177** / Winnipeg **10:21:40.177 CDT** 保存结果：`EXACT_DEPLOYMENT_CANDIDATE_HAS_PREFLIGHT_BLOCKERS`。

- AWS `ValidateTemplate` 接受七资源模板，无 IAM capability：LogGroup、TaskDefinition、TargetGroup、三条 ListenerRule、Service。栈名 `techlong-sandbox-tenant-9c5ee9e64509dcad`。
- 准确新计算栈仍独立核验通过；workload 栈、service、target group、tenant DNS 均未占用，business priorities 100/101、control priority 100 无冲突；两份固定 ECR digest 真实存在。
- hosted zone `Z01473621BTTHKXBGOOEJ`；目标 `first-acceptance.sandbox.techlong.cloud`。DDB 两套 key 和 Neon deployment/job/resource/operation 仍未认领。
- Source 创建栈/pass-role/初始 DDB/DNS、app 准确 IAM connect、execution 固定 Secret 版本及 ECR 的模拟为 allowed；这不证明实际服务调用、KMS、Secret 内容、应用登录或 ready。
- Neon READ ONLY SERIALIZABLE 事务接受全部九条非执行 EXPLAIN，计划结果 SHA `958c2378619d9ca509b2a60ba52bcf0fe09e365e536a680c33af2c080517e815`。没有应用锁或实际 INSERT；不是关系触发器、提交、并发无冲突或全部业务条件满足的运行时证明。
- r3 主进程计数 SDK 只读43次、CLI只读8次、限流重试0；计数不含独立计算层/控制面子进程或之后的定向核对。r1/r2 的只读限流中断记录保留，没有写重试或消费槽。

具体 plan SHA `d9afc3e7780651ddaebc333ddab8dcb09b6e74fecef37d9d3c72ad5d9248b92e` **仅为草案内容 hash，不是用户批准 SHA，不可拿来执行**。完整 public 参数仅保留本地；Git 摘要不复制 Stripe publishable key 值。

## 权限阻断：不把模拟拒绝自动变成授权

当前 provider schema 与实际模拟合并发现 CloudFormation execution role 的 **八个读取 action / 十条 resource 结果**缺口：

| 范围 | action 候选 | 限定目标 |
| --- | --- | --- |
| ECS | ListServiceDeployments、DescribeServiceDeployments | 准确 service / service-deployment 路径 |
| ELB | DescribeTargetGroupAttributes、DescribeTargetHealth、DescribeTags | 准确 target group，及两个既有 listener 下的新 rule 路径 |
| Logs | GetDataProtectionPolicy、DescribeIndexPolicies、DescribeResourcePolicies | 准确 log group；DescribeResourcePolicies 需要无资源作用域的区域限定审阅 |

现有 `TechlongSandboxCloudFormationExecutionBoundary` 同时是该角色的 attached policy 和 boundary，观察到默认 v7、仅保留 v7。**尚未编译或批准其新版本**；后继须核对消费者、完整前态、正反模拟和最小差异。不能照单加入 provider 所有条件性 action；模板没有 Cognito/日志 delivery/index/data-protection 设置，不拟授予这些可选写权限。

另两条拒绝是 ECS execution role 的 `logs:CreateLogStream` / `logs:PutLogEvents`。初步曾把它描述为“路径未覆盖”，**随后读取的 inline 与共享 boundary v4 文本均已包含 `/saas/cell-sandbox-1/tenant-*:*`，所以该归因撤回**。已有模拟仍返回 implicitDeny，根因未证明，不能声称新增 inline 或改共享 boundary 会解决。共享 service boundary 有七个消费者，不应为了此疑点扩大它。

追加的 `inspect-express-log-simulation-v1.mjs` 已实现但**未运行**：工具安全审批拒绝再次读取策略文档，需用户单独允许。准确范围为最多四次 IAM 元数据读取（固定 execution role、inline、现有 boundary/default v4）和四次只读 custom simulation，隔离 exact/star、无 boundary/原 boundary 的结果；不调用任何 mutation、Logs、Secret、SQL 或 ECS。只将现有策略/ARN/模拟结果写入 `F:/ChatGPT_workshop/` 新证据文件，可能暴露基础设施授权布局，但不读凭据或业务数据。没有绕过拒绝或改用间接执行。

## 验证与唯一继续点

16 项相关 tests（其中六项新测试）通过，`npm run typecheck` 和六个新增文件的 targeted ESLint 通过。没有重建镜像、发布 ECR 或重跑已消费 C5e；旧 C5d 53 pins / C5e 61 pins 的源码未修改。新增 Review 输出说明字段属于后续源码版本，r3 原始文件不回填或伪称重跑。

[版本化预检摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5f-live-delivery.preflight.json)保存原始证据 SHA 与本批次文件 pins；这些 pins 仅是交接范围，不是传递闭包的执行批准。

下一步先取得上述有界只读 IAM 核对许可，解释日志模拟矛盾，再集中完成**最小既有 IAM 差异 + 实际 first-claim/authority 激活 + workload/DNS + provision/独立 initialized-ready/原子回写**的单一执行闭环。不要先创建 running job 后再长时间补代码，或以 bootstrap 200 冒充 initialized ready。新的 IAM、私密重载、Secret 值、Neon/authority/SQL 写和真实部署仍须准确 fresh 清单；当前无可执行的新清单。若时间范围已过，先只读复核与重新审阅，不复用旧批准延长标签或删除资源。

现有网络已持续计费；**50 USD/月是目标而非硬上限**。本阶段未新增付费资源，已存在资源不会因标签到期自动停止计费；清理准确计算栈仍须单独批准，不包含既有 Express 数据库与 Secret。

参考：[AWS DynamoDB 事务 IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)、[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)、[ECS 固定 Secret 版本引用](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[CloudWatch Logs action/resource 类型](https://docs.aws.amazon.com/service-authorization/latest/reference/list_logs.html)。文档和模拟均不能替代实际验收。
