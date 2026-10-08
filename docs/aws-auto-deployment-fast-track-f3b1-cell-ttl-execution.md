# F3b1：Cell TTL 的一次性持久化执行入口完成，未安装

2026-10-07 Winnipeg / 10-08 UTC。新增 `createPreparedCellTtlJanitor` 与实际 AWS SDK 组合，复用既有准确 Cell 删除执行器，不修改已部署 `cell-janitor.cjs`、历史 PLAN_ONLY 协议、Scheduler 或 Worker 门禁。**这是可执行代码的准备切片，不是完整自动 TTL 上线，也不证明真实 AWS 删除通过。**

本阶段没有 AWS/Neon/源 PostgreSQL API 写入、IAM/调度安装、Lambda 调用、镜像重建/发布、baseline 上传、ECS/付费 Cell。此前 F3a2 的双镜像及 Locked/v6 收尾记录保留，本阶段不重放已消费发布清单。50 USD/月仍只是预算目标。

## 新执行链

```text
准确受审 deletion-plan SHA
  → 强一致读取永久 intent / immutable receipt
  → 已有 receipt：历史回执重放，不宣称新的 live readback
  → 已有 intent：仅 Recover，不再 DeleteStack
  → 无 intent：既有只读 Inspect + SHA 比较
  → 条件写入一次性 intent 槽位 + 独立强一致回读
  → 既有 Execute 再收集完整 fresh evidence / 删除前最终围栏
  → 一次准确 ARN 的 STANDARD DeleteStack
  → 独立确认准确 Stack 缺失
  → 条件发布不可变 receipt + 强一致回读
```

事件只接受 `schemaVersion=1`、`action=execute_reviewed_cell_ttl_cleanup`、`approvedDeletionPlanSha256` 三字段。不能接收任意 Stack、role、强制删除参数、enabled flag 或旧 delete-intent 事件。SHA 是绑定材料，**不是单凭事件字段就产生人类批准或 IAM 权限**；未来安装的实际入口、调用者权限、清理计划和具体资源仍须绑定到新的受审部署范围。

既有 core 的 account402010193138/ca-central-1/cell-sandbox-1、准确 Stack UUID、CloudFormation RoleARN、template/resource inventory、owner/generation/provision+cleanup epoch、强一致 authority、已过 Cell TTL、draining admission 与五类零租户集合围栏全部保留。slot 写入可能耗时，所以它之后重新进入完整 core；不复用写前检查。租户或 authority 在写入期间变化会阻止删除，但不会重置已占槽位。

## 持久化与不确定结果

实际 SDK journal 使用现有 authority table ARN，但只准备了两类**新的、未授予访问的键**：

- `cell-cleanup-intent:<deletionPlanSha256>`：永久一次性槽位，保存准确 INSPECTED plan。
- `cell-cleanup-receipt:<deletionPlanSha256>`：分离的不可变终态回执，保存独立确认后的 DELETED/RECOVERED summary。

两个 item 都为 `authority_key/schema_version/record_json` 三字段，canonical JSON、准确 key 与 plan hash 校验；没有 DynamoDB TTL attribute、Update/Delete/Scan、批量删除或槽位复位。Put 仅 `attribute_not_exists`，Get 全部 `ConsistentRead=true`。这个新 schema 不能被误当现有四字段 schema2 authority；原 `cell:cell-sandbox-1` 不更新。

只有成功取得并回读准确 intent 的 CAS 胜者能够进入 DeleteStack。slot 响应丢失、进程崩溃、提交结果不确定或并发输家，后续调用全部走只读 recovery；仍存在/DELETE_FAILED/无法确认缺失不能写成功回执，不能盲目重发 DeleteStack。若 slot 已写而实际删除前失败，可能永久停在未证明状态，这是失败关闭，不是自动可重试保证。后续处理必须独立核对并另有受审方案，不能自动复位。

receipt 响应丢失时先独立强一致回读；并发 recovery 已写的首份有效回执保留，不覆盖。成功历史回执重放不做新的云缺失证明，并以 `IMMUTABLE_RECEIPT_REPLAYED` 明确区分。错误仅暴露固定 journal code，不包含原始 SDK diagnostic。

实际 SDK 组合为 STS/CloudFormation/DynamoDB 共用一个懒 credential provider，固定 region、`ignoreConfiguredEndpointUrls=true`、`maxAttempts=1`；构造不解析凭据或发送 API。现有 dormant deletion SDK 工厂也补 `maxAttempts=1`，避免超时的 DeleteStack 被底层自动重试。authority 仅暴露 observe/readStrong，不给此 root CAS 能力；强一致零租户 source 仍需单独提供。

## 验证

- 新增 12 项 TTL 执行/持久化/恢复测试，复用原 core 的准确 fixture，不另造删除模拟器；覆盖成功/不可变重放、非法事件/漂移 SHA、slot 响应丢失、DeleteStack 响应丢失和重启、receipt 响应丢失、写槽超时导致 authority 过期、写槽后租户出现、abort、并发、回执篡改/孤儿记录、实际 SDK command/构造默认不调用 source。
- 六文件 cleanup/SDK/PLAN_ONLY/零租户/authority 相邻集共 **102 项通过**，可运行 `npm run test:deployment:cell-ttl`。
- 既有租户 TTL/rollback 和运行时主链 **129 项通过**；顺序 workload→database/role→Secret、lease/epoch 与持久化 phase receipts 不变。
- 旧 production cleanup adapter/grant 验证通过，仍 default-off/PLAN_ONLY、unattached grants。
- typecheck、定向零警告 lint、平台 production build 通过。`deployment:check-runtime` 实际输出 disabled/offline_only、monthlyBudgetTargetUsd50、cloudMutationPerformed/databaseAccessPerformed=false。

这些是协议/SDK 接线验证，provider transport 使用 fixture，没有 AWS 删除、真实 DynamoDB journal 写入或 Neon drain 证明。实际云验证不能由这些测试替代；本阶段也没有新的安装清单 SHA 可执行。

## 继续位置：F3b2

仍缺自动到期/失败事件生产、Neon admission draining→租户 cleanup/rollback 完成→强一致零租户证据→准确 cleanup authority/plan 的协调入口。现有 core **只接受已过 TTL 的稳定完整 Cell**，不会用 ttl event 提前删除失败/部分创建的 Cell；创建失败补偿应复用单独的 author compensation 协议，并另行核对其真实资源删除能力。

下一切片先接这些生产入口与真实零租户 source，编译可部署 Janitor artifact 和最小权限/调度变更材料；不能只把旧 PLAN_ONLY 改为 EXECUTE 或开启旧 Scheduler。最终在具体资源、authority/journal 键、Neon 写范围、期限、运行费用、失败处理与不可恢复删除范围新批准后，才安装/在线验收。baseline、专属 TaskRole、读 cap/Budget、wildcard/mTLS/DNS 和付费 Cell 仍是独立剩余门禁，**F3 整体未完成，Worker 默认 disabled**。
