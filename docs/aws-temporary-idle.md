# 临时测试止费与恢复方案（正式上线前移除）

2026-10-31，America/Winnipeg。用户已同意本方案，并要求只完成临时措施、文档可追溯、与正式代码隔离。**本轮交付代码和合成测试，不调用 AWS、不盘点当前资源、不启动 watch、不安装云端调度或 IAM。默认关闭。** 原部署/店铺菜单验收主线不变，旧事实、批准和 TTL 不延期。

## 已确认的范围

| 对象 | 临时闲置时 | 恢复时 |
| --- | --- | --- |
| ECS/Fargate service | 保存原副本数，暂停已登记的扩缩容，desiredCount=0；确认运行/待启动任务归零 | 依赖和新绑定核对后，恢复原副本数及原扩缩容状态 |
| 明确登记的独立 Fargate task | 停止 | 不自动重放，避免重复业务/部署写入 |
| 明确登记的直接 ECS Scheduler / EventBridge rule | 保存配置并禁用 | 仅恢复原先启用且未过期的周期来源；at 一次性计划不重放 |
| 明确登记的 NAT Gateway、Interface Endpoint、EIP | 先备份配置；确认计算已停，再删 NAT 路由/NAT/端点，等待消失后释放选定 EIP | 新建必要 NAT EIP、NAT、路由和端点，输出新旧映射；不为原本闲置的 EIP 重新付费占位 |
| ALB / RDS | 可选择复用现有停止工具：删除已备份 ALB、停止指定数据库 | 复用现有恢复工具，再检查新 ARN/DNS/目标组等绑定 |
| VPC、RDS 必需 subnet/安全组、数据库数据/备份、部署引用的 ECR 镜像 | 保留，不删除 | 继续复用 |

VPC 本身不是要靠删除来节省的收费主体；重点是 NAT、接口端点、公网 IPv4 和运行中的计算资源。保留数据库网络骨架，避免恢复数据库却丢失依赖。ECR 是镜像存储，不存在与 ECS task 相同的“暂停”状态；本轮不清空部署镜像。依据：[VPC FAQ](https://aws.amazon.com/vpc/faqs/)、[VPC 定价](https://aws.amazon.com/vpc/pricing/)、[ECS 定价](https://aws.amazon.com/ecs/pricing/)、[ECR 定价](https://aws.amazon.com/ecr/pricing/)。

此方案仅为测试周期的临时成本控制，不是最终生产架构，也不是账号零费用承诺。此前实际 ALB/RDS 停止结果单独记录在[已有工具文档](aws-resource-power-tools.md#本轮实际停止2026-10-31已确认)；不能把本轮写代码当成又一次实际停止。

## 隔离方式与入口

- 实现只在 [ops/temporary-idle](../ops/temporary-idle/core.mjs)，入口为 [scripts/aws-temporary-idle.mjs](../scripts/aws-temporary-idle.mjs)。
- 临时代码单向复用既有 ALB/RDS 辅助工具的本地备份/CLI；旧辅助工具、正式运行模块、Janitor、部署 workflow 均不反向导入它。
- 不修改 package 依赖、不新增 npm 自动钩子、不改变正式部署或清理语义。
- `temporary:true`、`enabled:true`、`--execute`、准确 `--confirm-account` 必须同时满足，才能访问 AWS。否则仅离线预览，不是 AWS 服务端 dry-run，也不代表当前资源存在。
- 使用 Node.js 22.13+、AWS CLI v2 和既有 profile；不读取 `.env`、Secret 值、PEM 或数据库内容。Windows 备份目录用 PowerShell 7 设置受限 ACL。

## 配置与支持边界

复制[默认关闭的样例](../ops/temporary-idle/config.example.json)到本地私有配置。先核对实际资源，再填入准确集群/服务/任务、计划、rule、VPC、NAT、端点和 allocation ID。**样例没有通过本轮在线盘点，不可当作现状清单。** 不把凭据写入 JSON，不使用账号全扫描/模糊前缀清理。

- `services` 为 FARGATE/FARGATE_SPOT；EC2/Managed Instances 不在此工具范围。
- `standaloneTasks` 必须准确 ARN，且不能是 service 管理的 task。
- `schedules` 为 `{name,group}`，`rules` 为 `{name,bus}`。只支持目标直接为所选 ECS cluster 的来源；间接 Lambda 调度或混合非 ECS rule 在写入前拒绝。未登记的外部 CI/人员仍可重新启动任务，本工具不能阻止它们。
- 收费网络目标必须同时满足准确 ID、`vpcIds` 白名单、`requiredNetworkTags` 以及 `acknowledgeNetworkRecreation:true`。支持单地址 zonal public/private NAT、用户管理的 Interface Endpoint、闲置或属于选定 NAT 的 Amazon VPC EIP；regional/多地址 NAT、其他类型/托管端点及未知挂载 EIP 拒绝处理。
- NAT 的路由表也须满足所有权标签。保留 subnet/安全组等依赖；不删除 VPC、网卡、数据库、快照或镜像。不强行分离托管 ENI。
- `expiresAt` 是固定 UTC 时间，例如 `2026-11-01T01:00:00.000Z`，仅 watch 需要。不会延长业务 TTL 或改正式 Janitor 标签。
- `power:null` 表示本轮只处理 ECS/收费网络；以后要一并停止 ALB/RDS，可嵌入[既有 power 配置](../ops/aws-resource-power/config.example.json)，账号/区域/profile 必须相同。必须使用当时真实新 ARN，不复制已删除的旧 ALB ARN冒充当前目标。

## 操作顺序（本轮未执行以下入口）

以下路径是以后人工填好的配置与新备份目录示例，不是已经启用的任务。`idle`/`watch` 的 state 必须尚不存在；每个新周期都使用新目录、当时实际资源 ID 和准确范围。

先离线预览，不查询 AWS：

```powershell
node scripts/aws-temporary-idle.mjs idle --config F:/ChatGPT_workshop/temporary-idle.json --state F:/ChatGPT_workshop/temporary-idle-cycle-001
```

实际执行需另行确定目标和权限范围。仅当确实要执行时，才附加：

```powershell
node scripts/aws-temporary-idle.mjs idle --config F:/ChatGPT_workshop/temporary-idle.json --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --execute --confirm-account 402010193138
```

也可将 `idle` 换为 `watch`：本地进程等待已配置的固定到期时间，然后仅执行一次同样的闲置流程。**watch 不依赖聊天额度，但依赖电脑持续在线、进程存活、网络及届时有效的 CLI 凭据；它不是已安装的云端定时器。** 关机/登录失效会阻止止费，不会自动续期、补跑或建立收费调度资源。本轮没有启动此进程或设置开机任务；若以后需要云端独立到期执行，必须另审准确资源/IAM/安装，不能称本轮已经实现云端自动联动。

实际闲置的顺序固定为：保存 ECS/来源/网络备份 → 暂停来源与扩缩容 → 计算归零并回读暂停状态 → 可选既有 ALB/RDS stop → 删除选定收费网络 → 回读删除/公网 IP 残留。旧 power 工具自己的 ALB/RDS 备份仍在其首次写入前生成。

恢复分三步，**不会一次命令直接把容器拉起**：

```powershell
node scripts/aws-temporary-idle.mjs restore-network --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --execute --confirm-account 402010193138
node scripts/aws-temporary-idle.mjs restore-power --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --power-state F:/ChatGPT_workshop/aws-cost-backup-20261031-a --execute --confirm-account 402010193138
```

第一步仅恢复必要 NAT/EIP/路由/接口端点，ECS 仍为 0；记录新 NAT/端点 ID、EIP 和端点 DNS。第二步复用已有 ALB/RDS 备份恢复；若停用时嵌入 `power` 生成了本周期 `state/power`，可省略 `--power-state`。**旧备份仅供其自身一次恢复，不能再次用于停止或重放恢复。** 上述既有真实备份只允许它原先指定的范围，实际恢复尚未获本轮批准。

接着检查 CFN drift、ALB 新 ARN/DNS、Route53 alias、监听器/目标组以及网络 ID 引用，必要修改单独处理；`--bindings-reviewed` 是操作者确认，不会替你修改这些绑定。完成后才允许：

```powershell
node scripts/aws-temporary-idle.mjs resume-compute --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --power-state F:/ChatGPT_workshop/aws-cost-backup-20261031-a --bindings-reviewed --execute --confirm-account 402010193138
```

恢复计算前要求已有 ALB/RDS 恢复证明、当前数据库 resource ID/available、ALB active、原 service 目标组绑定到新 ALB，以及 service 身份/任务定义/目标组和暂停配置未被别人改动。随后恢复原副本数并等待运行数稳定，再恢复原扩缩容及有效周期来源。独立 task、at 计划不重放；输出始终不把计算恢复当作产品验收成功。

所有模式省略 `--execute` 都是离线预览；恢复预览须已有真实备份。CLI 不在 PATH 时可加 `--aws-cli "D:/Amazon/AWSCLIV2/aws.exe"`；`--wait-seconds` 默认1800，范围0–7200，只控制读取轮询，不自动重试云写。

## 状态、失败与费用限制

`snapshot.json` 在首次临时资源写入前持久化，`journal.json` 保存原状态、动作和新旧映射。目录 ACL 仅当前用户/SYSTEM/Administrators；配置/计划 target 可能含私密元数据，备份留本地、不提交 GitHub。摘要用于检测意外改动，不是防本地管理员的签名。

- 每次写入先记 `SUBMITTING`；ACK 后记 `ACKNOWLEDGED`。网络/权限/进程异常保留状态，停止后继，不自动重试、补齐、回滚、删除锁或清理新建资源。
- 使用本地锁禁止同一备份并行；调用原 ALB/RDS 工具时也使用其备份锁。不要同时部署、编辑这些资源或切换 profile；本地锁不是跨 AWS 服务 CAS。
- 部分步骤成功后可能遗留收费资源或 disabled 来源。先检查备份/journal/准确现状，不简单重跑；不复位既有尝试。
- `TEMPORARY_IDLE_VERIFIED` 只代表本轮选定计算及网络核验通过；不代表全账号无费用。托管公网 IP 若仍存在，返回 `IDLE_WITH_PUBLIC_IP_RESIDUALS` 和退出码2，不强删 ENI。
- `NETWORK_RESTORED_COMPUTE_STILL_IDLE` 不是应用恢复；`TEMPORARY_COMPUTE_RESUMED` 也不是店铺/菜单验收。
- RDS/Aurora 停止最多7天，AWS 后续可能自动启动。watch 是一次到期收尾，**没有持续7天自动再停库的守护功能**。数据库存储/备份、ECR、Secret、S3、CloudFront/日志/流量等仍可能收费；不能保证绝对零费用。参阅 [RDS停止](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)、[Aurora停止](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-cluster-stop-start.html)。

所需 API 白名单见[独立 CLI 适配器](../ops/temporary-idle/cli.mjs)，ALB/RDS 仍受[原白名单](../ops/aws-resource-power/cli.mjs)限制。工具不新增 IAM、不读取数据库或 Secret 内容。实际账号是否有这些权限尚未由本轮证明。

## 正式上线前移除清单

1. 停止显式启动过的临时 watch/外部临时任务；本轮没有安装任何云端或开机调度，所以没有隐藏常驻服务需要猜测。
2. 先按备份恢复正式需要的网络、ALB/RDS、计算及原扩缩容/周期来源，处理 CFN/DNS 引用，核对应用可用。**不能在资源仍被停用时直接删代码，假装已经恢复。**
3. 删除 `ops/temporary-idle/`、`scripts/aws-temporary-idle.mjs`、`tests/temporary-idle.test.mjs`，更新本手册和主线文档的当前状态。正式模块/workflow/Janitor未接入它，无正式接口需要回滚。
4. ALB删除/RDS停止措施同样是临时政策，最终运行流程不能继续自动调用。若既有两个手动辅助工具也不再需要，在确认无其他使用方后一起移除；先移除单向引用它们的临时代码。
5. 私有恢复备份、真实 journal 和历史决策文档保留追溯，不能把删除临时代码等同于删除数据库或审计证据。

## 本轮验证

使用合成 AWS 响应与本地临时文件测试，不启动真实 CLI/入口。覆盖停用顺序/持久备份、暂停回读、扩缩容及周期来源恢复、一次性不重放、收费网络删除/重建/新 ID、未知提交不重试、依赖与外部变更拦截、公网 IP 残留及正式代码隔离。

本轮 `node --test --test-timeout=15000 tests/temporary-idle.test.mjs tests/aws-resource-power.test.mjs`：**54/54通过**（新增32项、原工具22项）。新代码定向 ESLint 零警告、`npm run typecheck`及三个新模块/入口的语法检查均通过。既有111文件部署闭包仍为 `9f6ceb7ccca8ee542bf8cab4ec120ab79571d20fd97356ddbaa831b58e4c745b`。未改正式运行模块、保护 workflow 或依赖；本轮 AWS 调用和实际新工具执行均0。合成测试不等于线上停止/恢复验收，没有启用自动止费。
