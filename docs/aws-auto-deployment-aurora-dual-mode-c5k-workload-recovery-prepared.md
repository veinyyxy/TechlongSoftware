# C5k：workload-only 恢复清单已接线，待 Source 只读核验

> **后续只读Review已通过**：Source刷新后r2完成30 SDK + 14 CLI + 1 Neon只读；新SHA `4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10`，提交截止Winnipeg 2026-10-16 01:04:28.726 CDT，尚未获准或执行创建。见[最终清单与准确范围](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-review.md)。以下为保留的本地准备/r1停止记录，不覆盖后续状态。

用户已同意“先准备恢复清单”，**未授权创建/续租/初始化**。当前 `LOCAL_SCOPE_COMPILED_WAITING_FOR_SOURCE_READONLY`，没有可批准执行的 fresh manifest SHA。不要把本地 request SHA 当成执行SHA。

## 本轮收缩后的交付

K1只恢复同一租户的承载：一次新 `CreateStack`，七项workload资源，复用现有Cell、Aurora、角色、固定Secret和DNS，使用已发布UUIDv8修复镜像；新物理UUID不得冒充旧已删除UUID。旧Janitor保持启用，仅新workload提议独立八小时期限（两小时审批，至少六小时剩余）；这是现有7200秒环境TTL的**待批准单次人工例外**，不改环境policy/父tag/全局调度。

K1保持旧job/lease/原desired_plan/plan_hash/artifact_ref/generation/epoch原样，不借过期lease、不新建job、不重置attempts，不写ready/authority，不POST、不连Aurora。历史计划仍旧镜像，故新承载成功也不能宣称原平台计划完成。K2在K1后另审只读初始化状态，然后才决定是否需要单次provision及带原值/CAS的job/plan/新stack协调；已初始化不得再POST。完整范围与风险见[固定风险文件](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-risk.md)。

## 已实现/验证

- 纯计划：从准确旧模板派生，20项参数显式重用，镜像/revision同步；只更新workload期限和准确恢复Metadata，五种允许资源类型、25分钟CFN超时、OnFailure=ROLLBACK；无IAM/Secret/DNS/数据库资源。
- Review/Run/Inspect接线：当前Source及既有CFN/task IAM全文、旧七资源删除、父Cell、空闲workload namespace/日志/target/listener优先级、ECR manifest/config/扫描、固定Secret元数据、启用Janitor、SDK强一致DDB两个键、Neon控制面单SELECT、ValidateTemplate。Run才有一次CreateStack入口和新的固定永久槽，写前重新读、准确SHA/代码/历史/窗口绑定，独立Inspect不复写。
- 独立八小时期限不关闭旧Janitor。Run校验原平台原状；存在新job/live lease、plan/owner/epoch/权限/namespace等漂移即停止，不自动修复。
- 8项新定向及8项相邻回归通过，typecheck、定向lint（0 warning）、语法检查通过。本地Check已用真实历史文件完整编译计划，AWS/SQL/私密/写/槽均0。尚未得到完整现场Review，不把入口已实现称为已实机验收。
- 前一阶段aurora-v2 CLI读取未知，本轮先用SDK两次GetItem强一致读取：aurora-v2缺失，legacy完整记录匹配，item canonical SHA `ede2c5dd0c096c8256c9f8e47c590d07e3a11bd4075d2094e824350c7f85783e`。无增权或DDB写；这是该次只读工具输出，不是后续Run可复用的当前证明，也不倒填上次CLI失败的唯一原因。

## 唯一未完成项及继续命令

真实 `Review r1` 在第一项Source SDK身份调用处遇到 `WORKLOAD_RECOVERY_SOURCE_REFRESH_REQUIRED`；没有SQL事务、私密读取、云写或槽消费。失败目录保留，不重跑它。

用户完成 `aws login --profile techlong-sandbox-user` 并回复“Source已刷新”后，在 `E:/NodejsProject/TechlongSoftware` 运行一次新目录只读Review：

```powershell
node ops/aws-sandbox/scripts/review-express-workload-recovery-v1.mjs --mode Review --output F:/ChatGPT_workshop/techlong-express-c5k-review-20261016-r2
```

该命令只有只读和ValidateTemplate，不执行CreateStack。若r2已有目录用新后缀，不删除或覆盖；尚未消费新的固定写槽，不从失败推导写重试授权。现场不符先保存具体差异，不安装权限或伪造absence。

完整Review通过后再公布最终manifest SHA、准确两个截止时间和费用范围，并请求明确单次创建及完整风险批准；批准之前不运行Run。随后Run及新进程Inspect均通过，才进入K2。不要重做候选构建/ECR发布、旧17槽或F3c9。

本轮所有实际AWS/平台/业务写入、Aurora连接、Secret值/原私密包读取、应用调用、永久写槽消费均0。网络核对AWS公开加拿大价格用于预算说明，不代表账单总额；现有收费资源仍在，50USD/月非cap。证据和下一步状态见[准备状态索引](../ops/aws-sandbox/reviews/aurora-dual-mode-c5k-workload-recovery.local-prepared.json)。
